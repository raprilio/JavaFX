<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class AudioController
{
    public static function present(array $r): array
    {
        $id = (int) $r['id'];
        return [
            'id' => $id,
            'note_id' => $r['note_id'] !== null ? (int) $r['note_id'] : null,
            'note_title' => $r['note_title'] ?? null,
            'title' => $r['title'],
            'mime_type' => $r['mime_type'],
            'size' => (int) $r['file_size'],
            'duration' => (float) $r['duration'],
            'waveform' => json_decode_array($r['waveform']),
            'created_at' => $r['created_at'],
            'updated_at' => $r['updated_at'],
            'url' => "api/index.php?route=audio/$id/raw",
            'share_count' => (int) ($r['share_count'] ?? 0),
            'shared' => !empty($r['shared']),
            'owner_name' => $r['owner_name'] ?? null,
        ];
    }

    public static function forNote(int $noteId, int $userId): array
    {
        return array_map([self::class, 'present'], DB::all(
            'SELECT * FROM audio_notes WHERE note_id = ? AND user_id = ? AND deleted_at IS NULL ORDER BY id',
            [$noteId, $userId]
        ));
    }

    public static function index(): void
    {
        $u = Auth::require();
        // view=shared: recordings other users shared with me (read-only).
        $shared = Http::query('view') === 'shared';
        $where = $shared
            ? ["EXISTS (SELECT 1 FROM item_shares s WHERE s.item_type = 'audio' AND s.item_id = a.id AND s.user_id = ?)", 'a.deleted_at IS NULL']
            : ['a.user_id = ?', 'a.deleted_at IS NULL' . NoteLock::fileFilter('a.note_id', $u['id'])];
        $params = [$u['id']];
        if ($q = V::str(Http::query('q'), 100)) {
            $where[] = 'a.title LIKE ?';
            $params[] = '%' . addcslashes($q, '%_\\') . '%';
        }
        if ($nid = V::id(Http::query('note_id'))) {
            $where[] = 'a.note_id = ?';
            $params[] = $nid;
        }
        $perPage = V::int(Http::query('per_page'), 1, 100) ?? 30;
        $page = V::int(Http::query('page'), 1) ?? 1;
        $w = implode(' AND ', $where);
        $total = (int) DB::val("SELECT COUNT(*) FROM audio_notes a WHERE $w", $params);
        $rows = DB::all(
            "SELECT a.*, " . ($shared ? "NULL AS note_title, 1 AS shared, o.name AS owner_name" : 'n.title AS note_title') . ",
                    (SELECT COUNT(*) FROM item_shares s2 WHERE s2.item_type = 'audio' AND s2.item_id = a.id) AS share_count
             FROM audio_notes a LEFT JOIN notes n ON n.id = a.note_id LEFT JOIN users o ON o.id = a.user_id
             WHERE $w ORDER BY a.created_at DESC, a.id DESC LIMIT $perPage OFFSET " . (($page - 1) * $perPage),
            $params
        );
        Http::ok(['items' => array_map([self::class, 'present'], $rows), 'total' => $total, 'page' => $page, 'per_page' => $perPage]);
    }

    public static function upload(): void
    {
        $u = Auth::require();
        if (empty($_FILES['file'])) {
            throw new HttpException('No audio received. The recording may exceed the server limit (' . ini_get('post_max_size') . ').', 422);
        }
        $noteId = V::id($_POST['note_id'] ?? null);
        if ($noteId && !DB::val('SELECT id FROM notes WHERE id = ? AND user_id = ?', [$noteId, $u['id']])) {
            throw new HttpException('Note not found.', 404);
        }
        $meta = Uploader::store($_FILES['file'], ['audio'], 'u' . $u['id'] . '/audio');
        $wave = json_decode((string) ($_POST['waveform'] ?? '[]'), true);
        $wave = is_array($wave) ? array_slice(array_map(static fn($v) => round(min(1, max(0, (float) $v)), 3), $wave), 0, 200) : [];
        $title = V::str($_POST['title'] ?? null, 255) ?? ('Recording ' . date('d M Y H:i'));
        $id = DB::insert('audio_notes', [
            'user_id' => $u['id'],
            'note_id' => $noteId,
            'title' => $title,
            'file_path' => $meta['file_path'],
            'file_name' => $meta['file_name'],
            'mime_type' => $meta['mime_type'],
            'file_size' => $meta['file_size'],
            'duration' => max(0, min(86400, V::float($_POST['duration'] ?? 0))),
            'waveform' => json_encode($wave),
        ]);
        if ($noteId) {
            DB::run('UPDATE notes SET updated_at = NOW() WHERE id = ?', [$noteId]);
            NotesController::refreshType($noteId, $u['id']);
        }
        Activity::log('audio.create', 'audio', $id, $title);
        Http::ok(self::present(DB::one('SELECT * FROM audio_notes WHERE id = ?', [$id])));
    }

    public static function raw(int $id): void
    {
        $u = Auth::require();
        $r = DB::one('SELECT * FROM audio_notes WHERE id = ?', [$id]);
        $shared = $r && (int) $r['user_id'] !== $u['id'] && !$r['deleted_at'] && $r['note_id']
            && DB::val('SELECT s.id FROM note_shares s JOIN notes n ON n.id = s.note_id AND n.deleted_at IS NULL WHERE s.note_id = ? AND s.user_id = ?', [$r['note_id'], $u['id']]);
        if ($r && !$shared && (int) $r['user_id'] !== $u['id'] && Shares::role('audio', $id, $u['id'])) {
            $shared = true;
        }
        if (!$r || ((int) $r['user_id'] !== $u['id'] && !$shared)) {
            throw new HttpException('Recording not found.', 404);
        }
        if (!$shared && $r['note_id'] && !NoteLock::unlocked($u['id']) && DB::val('SELECT is_locked FROM notes WHERE id = ?', [$r['note_id']])) {
            throw new HttpException('This recording belongs to a locked note. Enter your notes PIN first.', 423, ['locked' => true]);
        }
        $ext = pathinfo($r['file_path'], PATHINFO_EXTENSION);
        Uploader::serve($r['file_path'], $r['mime_type'], $r['title'] . '.' . $ext);
    }

    public static function update(int $id): void
    {
        $u = Auth::require();
        $r = DB::one('SELECT * FROM audio_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [$id, $u['id']]);
        if (!$r) {
            throw new HttpException('Recording not found.', 404);
        }
        $data = [];
        if (Http::has('title')) {
            $data['title'] = V::str(Http::input('title'), 255, true, 'title');
        }
        if (Http::has('note_id')) {
            $nid = V::id(Http::input('note_id'));
            if ($nid && !DB::val('SELECT id FROM notes WHERE id = ? AND user_id = ?', [$nid, $u['id']])) {
                throw new HttpException('Note not found.', 404);
            }
            $data['note_id'] = $nid;
        }
        DB::update('audio_notes', $data, 'id = ? AND user_id = ?', [$id, $u['id']]);
        foreach (array_filter([$r['note_id'], $data['note_id'] ?? null]) as $nid) {
            NotesController::refreshType((int) $nid, $u['id']);
        }
        Http::ok(self::present(DB::one('SELECT * FROM audio_notes WHERE id = ?', [$id])));
    }
}
