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
            'folder_id' => isset($r['folder_id']) ? (int) $r['folder_id'] ?: null : null,
            'description' => $r['description'] ?? null,
            'is_starred' => (bool) ($r['is_starred'] ?? false),
            'last_opened_at' => $r['last_opened_at'] ?? null,
            'updated_at' => $r['updated_at'],
            'tags' => $r['tags'] ?? [],
            'preview' => self::previewType($r['mime_type'], $r['file_kind']),
            'v' => $v,
        ];
    }

    /** How the browser can preview this file: image | pdf | audio | text | none. */
    public static function previewType(string $mime, string $kind): string
    {
        return match (true) {
            $kind === 'image' => 'image',
            $mime === 'application/pdf' => 'pdf',
            $kind === 'audio' => 'audio',
            $kind === 'video' => 'video',
            in_array($mime, ['text/plain', 'text/csv'], true) => 'text',
            default => 'none',
        };
    }

    /** Present a list of rows including their tags. */
    public static function presentMany(array $rows): array
    {
        $tags = TagsController::forItems('file', array_map('intval', array_column($rows, 'id')));
        return array_map(static function ($r) use ($tags) {
            $r['tags'] = $tags[(int) $r['id']] ?? [];
            return self::present($r);
        }, $rows);
    }

    public static function presentOne(int $id): array
    {
        return self::presentMany([DB::one('SELECT * FROM note_attachments WHERE id = ?', [$id])])[0];
    }

    /**
     * A file is readable by its owner, and by users a note containing it is shared with.
     */
    private static function readable(int $id, int $userId): array
    {
        $r = DB::one('SELECT * FROM note_attachments WHERE id = ?', [$id]);
        if ($r && (int) $r['user_id'] === $userId) {
            if ($r['note_id'] && !NoteLock::unlocked($userId) && DB::val('SELECT is_locked FROM notes WHERE id = ?', [$r['note_id']])) {
                throw new HttpException('This file belongs to a locked note. Enter your notes PIN first.', 423, ['locked' => true]);
            }
            return $r;
        }
        if ($r && !$r['deleted_at'] && $r['note_id']
            && DB::val('SELECT s.id FROM note_shares s JOIN notes n ON n.id = s.note_id AND n.deleted_at IS NULL WHERE s.note_id = ? AND s.user_id = ?', [$r['note_id'], $userId])) {
            return $r;
        }
        // Drive files shared directly or through a shared folder.
        if ($r && !$r['deleted_at'] && Shares::role('file', $id, $userId)) {
            return $r;
        }
        // Attachments of a meeting shared with this user.
        if ($r && !$r['deleted_at'] && $r['meeting_id']
            && DB::val('SELECT m.id FROM meetings m WHERE m.id = ? AND m.deleted_at IS NULL AND ' . MeetingsController::visibleSql('m'), [$r['meeting_id'], $userId, $userId])) {
            return $r;
        }
        throw new HttpException('File not found.', 404);
    }

    public static function forParent(string $parent, int $parentId, int $userId): array
    {
        $col = ['note' => 'note_id', 'task' => 'task_id', 'meeting' => 'meeting_id'][$parent];
        return self::presentMany(DB::all(
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
        if (in_array(Http::query('kind'), ['image', 'audio', 'video', 'document', 'archive', 'other'], true)) {
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
            'items' => self::presentMany($rows),
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
        $folderId = DriveController::ownedFolder(V::id($_POST['folder_id'] ?? null), $u['id']);
        $kinds = match ($_POST['accept'] ?? '') {
            'image' => ['image'],
            default => ['image', 'audio', 'video', 'document', 'archive'],
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
            'folder_id' => $folderId,
            'description' => V::str($_POST['description'] ?? null, 2000),
        ]));
        if (!empty($_POST['tags'])) {
            TagsController::sync('file', $id, $u['id'], explode(',', (string) $_POST['tags']));
        }
        if (!empty($parents['note_id'])) {
            DB::run('UPDATE notes SET updated_at = NOW() WHERE id = ?', [$parents['note_id']]);
            NotesController::refreshType((int) $parents['note_id'], $u['id']);
        }
        Activity::log('file.upload', 'file', $id, $meta['original_name']);
        Http::ok(self::presentOne($id));
    }

    public static function show(int $id): void
    {
        $u = Auth::require();
        $r = self::readable($id, $u['id']);
        $out = self::presentOne((int) $r['id']);
        $out['access'] = (int) $r['user_id'] === $u['id'] ? 'owner' : 'view';
        if ($out['access'] !== 'owner') {
            $out['owner_name'] = DB::val('SELECT name FROM users WHERE id = ?', [$r['user_id']]);
        }
        Http::ok($out);
    }

    public static function raw(int $id): void
    {
        $u = Auth::require();
        $r = self::readable($id, $u['id']);
        if ((int) $r['user_id'] === $u['id'] && !isset($_SERVER['HTTP_RANGE'])) {
            DB::run('UPDATE note_attachments SET last_opened_at = NOW(), updated_at = updated_at WHERE id = ?', [$id]);
        }
        Uploader::serve($r['file_path'], $r['mime_type'], $r['original_name']);
    }

    public static function thumb(int $id): void
    {
        $u = Auth::require();
        $r = self::readable($id, $u['id']);
        Uploader::serve($r['thumb_path'] ?: $r['file_path'], $r['mime_type'], 'thumb-' . $r['original_name']);
    }

    public static function download(int $id): void
    {
        $u = Auth::require();
        $r = self::readable($id, $u['id']);
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
        if (Http::has('folder_id')) {
            $data['folder_id'] = DriveController::ownedFolder(V::id(Http::input('folder_id')), $u['id']);
        }
        if (Http::has('description')) {
            $data['description'] = V::str(Http::input('description'), 2000);
        }
        if (Http::has('is_starred')) {
            $data['is_starred'] = V::bool(Http::input('is_starred'));
        }
        DB::update('note_attachments', $data, 'id = ? AND user_id = ?', [$id, $u['id']]);
        if (Http::has('tags')) {
            TagsController::sync('file', $id, $u['id'], Http::input('tags'));
            DB::run('UPDATE note_attachments SET updated_at = NOW() WHERE id = ?', [$id]);
        }
        Http::ok(self::presentOne($id));
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
        Http::ok(self::presentOne($id));
    }
}
