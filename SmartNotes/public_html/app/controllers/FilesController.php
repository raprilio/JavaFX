<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class FilesController
{
    public static function present(array $r): array
    {
        $id = (int) $r['id'];
        $v = substr(md5((string) $r['updated_at']), 0, 6);
        return [
            'id' => $id,
            'note_id' => $r['note_id'] !== null ? (int) $r['note_id'] : null,
            'task_id' => $r['task_id'] !== null ? (int) $r['task_id'] : null,
            'meeting_id' => $r['meeting_id'] !== null ? (int) $r['meeting_id'] : null,
            'name' => $r['original_name'],
            'mime_type' => $r['mime_type'],
            'kind' => $r['file_kind'],
            'size' => (int) $r['file_size'],
            'width' => $r['width'] !== null ? (int) $r['width'] : null,
            'height' => $r['height'] !== null ? (int) $r['height'] : null,
            'created_at' => $r['created_at'],
            'url' => "api/index.php?route=files/$id/raw",
            'thumb_url' => $r['file_kind'] === 'image' ? "api/index.php?route=files/$id/" . ($r['thumb_path'] ? 'thumb' : 'raw') . "&v=$v" : null,
            'download_url' => "api/index.php?route=files/$id/download",
            'note_title' => $r['note_title'] ?? null,
            'v' => $v,
        ];
    }

    public static function forParent(string $parent, int $parentId, int $userId): array
    {
        $col = ['note' => 'note_id', 'task' => 'task_id', 'meeting' => 'meeting_id'][$parent];
        return array_map([self::class, 'present'], DB::all(
            "SELECT * FROM note_attachments WHERE $col = ? AND user_id = ? AND deleted_at IS NULL ORDER BY id",
            [$parentId, $userId]
        ));
    }

    private static function owned(int $id, int $userId, bool $withTrashed = false): array
    {
        $r = DB::one('SELECT * FROM note_attachments WHERE id = ? AND user_id = ?' . ($withTrashed ? '' : ' AND deleted_at IS NULL'), [$id, $userId]);
        if (!$r) {
            throw new HttpException('File not found.', 404);
        }
        return $r;
    }

    /** Verify the optional parent ids belong to the user. */
    private static function parents(int $userId, array $in): array
    {
        $out = [];
        foreach (['note_id' => 'notes', 'task_id' => 'tasks', 'meeting_id' => 'meetings'] as $k => $t) {
            if (array_key_exists($k, $in)) {
                $id = V::id($in[$k]);
                if ($id && !DB::val("SELECT id FROM `$t` WHERE id = ? AND user_id = ?", [$id, $userId])) {
                    throw new HttpException('Related item not found.', 404);
                }
                $out[$k] = $id;
            }
        }
        return $out;
    }

    public static function index(): void
    {
        $u = Auth::require();
        $where = ['a.user_id = ?', 'a.deleted_at IS NULL'];
        $params = [$u['id']];
        if (in_array(Http::query('kind'), ['image', 'audio', 'document', 'archive', 'other'], true)) {
            $where[] = 'a.file_kind = ?';
            $params[] = Http::query('kind');
        }
        if ($nid = V::id(Http::query('note_id'))) {
            $where[] = 'a.note_id = ?';
            $params[] = $nid;
        }
        if ($q = V::str(Http::query('q'), 100)) {
            $where[] = 'a.original_name LIKE ?';
            $params[] = '%' . addcslashes($q, '%_\\') . '%';
        }
        $sort = ['name' => 'a.original_name ASC', 'size' => 'a.file_size DESC', 'date' => 'a.created_at DESC'][Http::query('sort', 'date')] ?? 'a.created_at DESC';
        $perPage = V::int(Http::query('per_page'), 1, 100) ?? 48;
        $page = V::int(Http::query('page'), 1) ?? 1;
        $w = implode(' AND ', $where);
        $total = (int) DB::val("SELECT COUNT(*) FROM note_attachments a WHERE $w", $params);
        $rows = DB::all(
            "SELECT a.*, n.title AS note_title FROM note_attachments a LEFT JOIN notes n ON n.id = a.note_id
             WHERE $w ORDER BY $sort, a.id DESC LIMIT $perPage OFFSET " . (($page - 1) * $perPage),
            $params
        );
        $sum = DB::one('SELECT COUNT(*) c, COALESCE(SUM(file_size), 0) s FROM note_attachments WHERE user_id = ? AND deleted_at IS NULL', [$u['id']]);
        Http::ok([
            'items' => array_map([self::class, 'present'], $rows),
            'total' => $total, 'page' => $page, 'per_page' => $perPage,
            'summary' => ['count' => (int) $sum['c'], 'size' => (int) $sum['s']],
        ]);
    }

    public static function upload(): void
    {
        $u = Auth::require();
        if (empty($_FILES['file'])) {
            throw new HttpException('No file uploaded. The file may exceed the server limit (' . ini_get('post_max_size') . ').', 422);
        }
        $parents = self::parents($u['id'], $_POST);
        $kinds = match ($_POST['accept'] ?? '') {
            'image' => ['image'],
            default => ['image', 'audio', 'document', 'archive'],
        };
        $meta = Uploader::store($_FILES['file'], $kinds, 'u' . $u['id']);
        $id = DB::insert('note_attachments', array_merge($parents, [
            'user_id' => $u['id'],
            'file_name' => $meta['file_name'],
            'original_name' => $meta['original_name'],
            'file_path' => $meta['file_path'],
            'thumb_path' => $meta['thumb_path'],
            'mime_type' => $meta['mime_type'],
            'file_kind' => $meta['file_kind'],
            'file_size' => $meta['file_size'],
            'file_hash' => $meta['file_hash'],
            'width' => $meta['width'],
            'height' => $meta['height'],
        ]));
        if (!empty($parents['note_id'])) {
            DB::run('UPDATE notes SET updated_at = NOW() WHERE id = ?', [$parents['note_id']]);
            NotesController::refreshType((int) $parents['note_id'], $u['id']);
        }
        Activity::log('file.upload', 'file', $id, $meta['original_name']);
        Http::ok(self::present(DB::one('SELECT * FROM note_attachments WHERE id = ?', [$id])));
    }

    public static function raw(int $id): void
    {
        $u = Auth::require();
        $r = self::owned($id, $u['id'], true);
        Uploader::serve($r['file_path'], $r['mime_type'], $r['original_name']);
    }

    public static function thumb(int $id): void
    {
        $u = Auth::require();
        $r = self::owned($id, $u['id'], true);
        Uploader::serve($r['thumb_path'] ?: $r['file_path'], $r['mime_type'], 'thumb-' . $r['original_name']);
    }

    public static function download(int $id): void
    {
        $u = Auth::require();
        $r = self::owned($id, $u['id'], true);
        Uploader::serve($r['file_path'], $r['mime_type'], $r['original_name'], false);
    }

    public static function update(int $id): void
    {
        $u = Auth::require();
        $r = self::owned($id, $u['id']);
        $data = self::parents($u['id'], Http::body());
        if (Http::has('name')) {
            $name = Uploader::cleanName((string) V::str(Http::input('name'), 200, true, 'name'));
            $ext = strtolower(pathinfo($r['original_name'], PATHINFO_EXTENSION));
            if ($ext && strtolower(pathinfo($name, PATHINFO_EXTENSION)) !== $ext) {
                $name .= '.' . $ext;
            }
            $data['original_name'] = $name;
        }
        DB::update('note_attachments', $data, 'id = ? AND user_id = ?', [$id, $u['id']]);
        Http::ok(self::present(DB::one('SELECT * FROM note_attachments WHERE id = ?', [$id])));
    }

    public static function rotate(int $id): void
    {
        $u = Auth::require();
        $r = self::owned($id, $u['id']);
        if ($r['file_kind'] !== 'image') {
            throw new HttpException('Only images can be rotated.', 422);
        }
        $deg = (int) Http::input('degrees', 90);
        $deg = (($deg % 360) + 360) % 360;
        if (!in_array($deg, [90, 180, 270], true)) {
            throw new HttpException('Invalid rotation.', 422);
        }
        $ext = strtolower(pathinfo($r['file_path'], PATHINFO_EXTENSION));
        $abs = Uploader::absolute($r['file_path']);
        $res = Uploader::reencode($abs, $abs, $ext, 4096, $deg);
        if (!$res) {
            throw new HttpException('Image rotation is not supported on this server (GD missing).', 500);
        }
        if ($r['thumb_path']) {
            Uploader::reencode($abs, Uploader::absolute($r['thumb_path']), $ext, 480);
        }
        DB::update('note_attachments', ['width' => $res[0], 'height' => $res[1], 'file_size' => filesize($abs), 'updated_at' => now()], 'id = ?', [$id]);
        Http::ok(self::present(DB::one('SELECT * FROM note_attachments WHERE id = ?', [$id])));
    }
}
