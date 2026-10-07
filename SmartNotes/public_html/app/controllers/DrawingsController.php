<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Handwriting / pen drawings inside notes.
 *
 * Each drawing is two files under uploads/u{id}/drawings/: the vector strokes (JSON, editable later)
 * and a rendered transparent PNG shown in the note. MySQL only stores paths and metadata.
 * The note HTML references a drawing as <figure class="sn-drawing" data-drawing-id="N"><img src="…drawings/N/png…"></figure>.
 */
final class DrawingsController
{
    private const MAX_JSON = 4 * 1024 * 1024;
    private const MAX_PNG = 12 * 1024 * 1024;
    private const MAX_STROKES = 20000;
    private const MAX_POINTS = 600000;
    private const WIDTH = 1000;
    private const MAX_HEIGHT = 6000;
    private const COLOR = '/^#[0-9a-f]{6}$/i';

    public static function present(array $d): array
    {
        $id = (int) $d['id'];
        return [
            'id' => $id,
            'note_id' => (int) $d['note_id'],
            'width' => (int) $d['width'],
            'height' => (int) $d['height'],
            'stroke_count' => (int) $d['stroke_count'],
            'version' => (int) $d['version'],
            'png_url' => "api/index.php?route=drawings/$id/png&v=" . (int) $d['version'],
            'updated_at' => $d['updated_at'],
        ];
    }

    /** The drawing if the user may see it (owner, or the note is shared with them). */
    private static function readable(int $id, int $userId): array
    {
        $d = DB::one('SELECT d.*, n.user_id AS owner_id, n.is_locked, n.deleted_at AS note_deleted FROM note_drawings d JOIN notes n ON n.id = d.note_id WHERE d.id = ?', [$id]);
        if (!$d) {
            throw new HttpException('Drawing not found.', 404);
        }
        if ((int) $d['owner_id'] === $userId) {
            if ((int) $d['is_locked'] && !NoteLock::unlocked($userId)) {
                throw new HttpException('This drawing belongs to a locked note. Enter your notes PIN first.', 423, ['locked' => true]);
            }
            return $d;
        }
        if (!$d['note_deleted'] && DB::val('SELECT 1 FROM note_shares WHERE note_id = ? AND user_id = ?', [$d['note_id'], $userId])) {
            return $d;
        }
        throw new HttpException('Drawing not found.', 404);
    }

    private static function owned(int $id, int $userId): array
    {
        $d = self::readable($id, $userId);
        if ((int) $d['owner_id'] !== $userId) {
            throw new HttpException('Only the owner of the note can change this drawing.', 403);
        }
        return $d;
    }

    public static function show(int $id): void
    {
        $u = Auth::require();
        $d = self::readable($id, $u['id']);
        $json = @file_get_contents(Uploader::absolute($d['data_path']));
        $out = self::present($d);
        $out['data'] = $json !== false ? json_decode($json, true) : null;
        $out['can_edit'] = (int) $d['owner_id'] === $u['id'];
        Http::ok($out);
    }

    public static function png(int $id): void
    {
        $u = Auth::require();
        $d = self::readable($id, $u['id']);
        Uploader::serve($d['png_path'], 'image/png', 'handwriting-' . $id . '.png');
    }

    public static function store(): void
    {
        $u = Auth::require();
        $noteId = V::id(Http::input('note_id')) ?? throw new HttpException('Missing note.', 422);
        $note = NotesController::find($noteId, $u['id']);
        if (NoteLock::hides($note, $u['id'])) {
            throw new HttpException('This note is locked. Enter your notes PIN first.', 423, ['locked' => true]);
        }
        [$json, $meta] = self::validated();
        [$dataPath, $pngPath, $size] = self::writeFiles($u['id'], $json);
        $id = DB::insert('note_drawings', [
            'user_id' => $u['id'],
            'note_id' => $noteId,
            'data_path' => $dataPath,
            'png_path' => $pngPath,
            'width' => self::WIDTH,
            'height' => $meta['h'],
            'stroke_count' => $meta['strokes'],
            'file_size' => $size,
        ]);
        Activity::log('note.drawing', 'note', $noteId, 'Added handwriting');
        Http::ok(self::present(DB::one('SELECT * FROM note_drawings WHERE id = ?', [$id])));
    }

    public static function update(int $id): void
    {
        $u = Auth::require();
        $d = self::owned($id, $u['id']);
        [$json, $meta] = self::validated();
        [$dataPath, $pngPath, $size] = self::writeFiles($u['id'], $json);
        DB::update('note_drawings', [
            'data_path' => $dataPath,
            'png_path' => $pngPath,
            'height' => $meta['h'],
            'stroke_count' => $meta['strokes'],
            'file_size' => $size,
            'version' => (int) $d['version'] + 1,
            'deleted_at' => null,
        ], 'id = ?', [$id]);
        Uploader::delete($d['data_path'], $d['png_path']);
        DB::run('UPDATE notes SET updated_at = NOW() WHERE id = ?', [$d['note_id']]);
        Http::ok(self::present(DB::one('SELECT * FROM note_drawings WHERE id = ?', [$id])));
    }

    /**
     * Validate and normalise the stroke JSON (only known fields, rounded numbers).
     * @return array{0: string, 1: array{h:int, strokes:int}}
     */
    private static function validated(): array
    {
        $raw = Http::input('data');
        if (!is_string($raw) || $raw === '' || strlen($raw) > self::MAX_JSON) {
            throw new HttpException('The drawing is empty or too large.', 422);
        }
        $in = json_decode($raw, true);
        if (!is_array($in) || ($in['v'] ?? null) !== 1 || !is_array($in['strokes'] ?? null)) {
            throw new HttpException('Invalid drawing data.', 422);
        }
        $h = max(200, min(self::MAX_HEIGHT, (int) ($in['h'] ?? 0)));
        $bg = in_array($in['bg'] ?? 'none', ['none', 'lines', 'grid', 'dots'], true) ? $in['bg'] : 'none';
        if (count($in['strokes']) > self::MAX_STROKES) {
            throw new HttpException('The drawing has too many strokes.', 422);
        }
        $points = 0;
        $strokes = [];
        foreach ($in['strokes'] as $s) {
            if (!is_array($s) || !is_array($s['p'] ?? null)) {
                continue;
            }
            $p = array_values($s['p']);
            $n = intdiv(count($p), 3);
            if ($n < 1) {
                continue;
            }
            $points += $n;
            if ($points > self::MAX_POINTS) {
                throw new HttpException('The drawing is too detailed to save.', 422);
            }
            $clean = [];
            for ($i = 0; $i < $n * 3; $i += 3) {
                if (!is_numeric($p[$i]) || !is_numeric($p[$i + 1]) || !is_numeric($p[$i + 2])) {
                    throw new HttpException('Invalid drawing data.', 422);
                }
                $clean[] = round(max(-50, min(self::WIDTH + 50, (float) $p[$i])), 1);
                $clean[] = round(max(-50, min($h + 50, (float) $p[$i + 1])), 1);
                $clean[] = round(max(0, min(1, (float) $p[$i + 2])), 2);
            }
            $strokes[] = [
                't' => ($s['t'] ?? 'pen') === 'hl' ? 'hl' : 'pen',
                'c' => is_string($s['c'] ?? null) && preg_match(self::COLOR, $s['c']) ? strtolower($s['c']) : '#111827',
                's' => round(max(0.5, min(60, (float) ($s['s'] ?? 3))), 1),
                'p' => $clean,
            ];
        }
        $json = json_encode(['v' => 1, 'w' => self::WIDTH, 'h' => $h, 'bg' => $bg, 'strokes' => $strokes], JSON_UNESCAPED_SLASHES);
        return [$json, ['h' => $h, 'strokes' => count($strokes)]];
    }

    /** Write the JSON and the (re-encoded) PNG under uploads/. @return array{0:string,1:string,2:int} */
    private static function writeFiles(int $userId, string $json): array
    {
        $f = $_FILES['png'] ?? null;
        if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name']) && PHP_SAPI !== 'cli') {
            throw new HttpException('The drawing image is missing.', 422);
        }
        if ((int) $f['size'] <= 0 || (int) $f['size'] > self::MAX_PNG) {
            throw new HttpException('The drawing image is too large.', 422);
        }
        $info = @getimagesize($f['tmp_name']);
        if (!$info || $info[2] !== IMAGETYPE_PNG || $info[0] > 2400 || $info[1] > 16000) {
            throw new HttpException('The drawing image is invalid.', 422);
        }
        $rel = 'u' . $userId . '/drawings/' . date('Y/m');
        ensure_dir(SN_UPLOADS . '/' . $rel);
        $name = bin2hex(random_bytes(16));
        $dataPath = "$rel/$name.json";
        $pngPath = "$rel/$name.png";
        if (file_put_contents(SN_UPLOADS . '/' . $dataPath, $json) === false) {
            throw new HttpException('Could not save the drawing.', 500);
        }
        // Re-encode through GD (keeps transparency, drops anything that is not pixels).
        $ok = false;
        if (function_exists('imagecreatefrompng') && ($im = @imagecreatefrompng($f['tmp_name']))) {
            imagealphablending($im, false);
            imagesavealpha($im, true);
            $ok = imagepng($im, SN_UPLOADS . '/' . $pngPath, 6);
            imagedestroy($im);
        }
        if (!$ok && !move_uploaded_file($f['tmp_name'], SN_UPLOADS . '/' . $pngPath) && !copy($f['tmp_name'], SN_UPLOADS . '/' . $pngPath)) {
            @unlink(SN_UPLOADS . '/' . $dataPath);
            throw new HttpException('Could not save the drawing.', 500);
        }
        @chmod(SN_UPLOADS . '/' . $pngPath, 0644);
        return [$dataPath, $pngPath, strlen($json) + (int) filesize(SN_UPLOADS . '/' . $pngPath)];
    }

    // ------------------------------------------------------------ note integration

    /** Drawing ids referenced by note HTML. */
    public static function referenced(string $html): array
    {
        preg_match_all('#data-drawing-id="(\d+)"|route=drawings/(\d+)/png#', $html, $m);
        return array_values(array_unique(array_map('intval', array_filter(array_merge($m[1], $m[2])))));
    }

    /** After a note's text was saved: drawings no longer in the text are soft-deleted (purged after 7 days, so undo still works). */
    public static function syncNote(int $noteId, string $html): void
    {
        $ids = self::referenced($html);
        if ($ids) {
            $in = DB::in($ids);
            DB::run("UPDATE note_drawings SET deleted_at = NULL WHERE note_id = ? AND id IN ($in) AND deleted_at IS NOT NULL", array_merge([$noteId], $ids));
            DB::run("UPDATE note_drawings SET deleted_at = NOW() WHERE note_id = ? AND deleted_at IS NULL AND id NOT IN ($in)", array_merge([$noteId], $ids));
        } else {
            DB::run('UPDATE note_drawings SET deleted_at = NOW() WHERE note_id = ? AND deleted_at IS NULL', [$noteId]);
        }
    }

    /** Copy the drawings of a note for a duplicate and return the HTML pointing at the copies. */
    public static function copyForNote(int $fromNote, int $toNote, int $userId, string $html): string
    {
        $map = [];
        foreach (self::referenced($html) as $old) {
            $d = DB::one('SELECT * FROM note_drawings WHERE id = ? AND note_id = ?', [$old, $fromNote]);
            if (!$d) {
                continue;
            }
            $rel = 'u' . $userId . '/drawings/' . date('Y/m');
            ensure_dir(SN_UPLOADS . '/' . $rel);
            $name = bin2hex(random_bytes(16));
            if (!@copy(Uploader::absolute($d['data_path']), SN_UPLOADS . "/$rel/$name.json") || !@copy(Uploader::absolute($d['png_path']), SN_UPLOADS . "/$rel/$name.png")) {
                continue;
            }
            $map[$old] = DB::insert('note_drawings', [
                'user_id' => $userId, 'note_id' => $toNote, 'data_path' => "$rel/$name.json", 'png_path' => "$rel/$name.png",
                'width' => $d['width'], 'height' => $d['height'], 'stroke_count' => $d['stroke_count'], 'file_size' => $d['file_size'],
            ]);
        }
        if (!$map) {
            return $html;
        }
        return preg_replace_callback('#(data-drawing-id="|route=drawings/)(\d+)#', static fn($m) => $m[1] . ($map[(int) $m[2]] ?? $m[2]), $html) ?? $html;
    }

    /** Files of all drawings of a note (for permanent deletion). */
    public static function filesOfNote(int $noteId): array
    {
        $out = [];
        foreach (DB::all('SELECT data_path, png_path FROM note_drawings WHERE note_id = ?', [$noteId]) as $d) {
            array_push($out, $d['data_path'], $d['png_path']);
        }
        return $out;
    }

    /** Housekeeping: drawings removed from their note more than 7 days ago. */
    public static function purgeRemoved(): int
    {
        $rows = DB::all('SELECT id, data_path, png_path FROM note_drawings WHERE deleted_at IS NOT NULL AND deleted_at < ?', [date('Y-m-d H:i:s', time() - 7 * 86400)]);
        foreach ($rows as $d) {
            Uploader::delete($d['data_path'], $d['png_path']);
            DB::run('DELETE FROM note_drawings WHERE id = ?', [$d['id']]);
        }
        return count($rows);
    }
}
