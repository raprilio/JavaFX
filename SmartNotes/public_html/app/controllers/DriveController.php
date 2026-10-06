<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Drive: folders, starred & recent files, tag links between files and notes.
 * Files live in `note_attachments`; Drive files are those not attached to a note/task/meeting.
 */
final class DriveController
{
    public static function ownedFolder(?int $id, int $userId): ?int
    {
        if (!$id) {
            return null;
        }
        if (!DB::val('SELECT id FROM drive_folders WHERE id = ? AND user_id = ?', [$id, $userId])) {
            throw new HttpException('Folder not found.', 404);
        }
        return $id;
    }

    private static function path(?int $folderId, int $userId): array
    {
        $path = [];
        $guard = 0;
        while ($folderId && $guard++ < 50) {
            $f = DB::one('SELECT id, name, parent_id, color FROM drive_folders WHERE id = ? AND user_id = ?', [$folderId, $userId]);
            if (!$f) {
                break;
            }
            array_unshift($path, ['id' => (int) $f['id'], 'name' => $f['name'], 'color' => $f['color']]);
            $folderId = $f['parent_id'] ? (int) $f['parent_id'] : null;
        }
        return $path;
    }

    /** Ids of a folder and all of its descendants. */
    private static function subtree(int $folderId, int $userId): array
    {
        $all = DB::all('SELECT id, parent_id FROM drive_folders WHERE user_id = ?', [$userId]);
        $kids = [];
        foreach ($all as $f) {
            $kids[(int) $f['parent_id']][] = (int) $f['id'];
        }
        $out = [$folderId];
        for ($i = 0; $i < count($out) && $i < 5000; $i++) {
            foreach ($kids[$out[$i]] ?? [] as $k) {
                $out[] = $k;
            }
        }
        return $out;
    }

    public static function index(): void
    {
        $u = Auth::require();
        $uid = $u['id'];
        $view = V::enum(Http::query('view'), ['drive', 'starred', 'recent', 'all'], 'drive');
        $folderId = $view === 'drive' ? self::ownedFolder(V::id(Http::query('folder')), $uid) : null;
        $q = V::str(Http::query('q'), 100);
        $tag = TagsController::normalize(Http::query('tag'));
        $kind = in_array(Http::query('kind'), ['image', 'audio', 'document', 'archive', 'other', 'pdf'], true) ? Http::query('kind') : null;
        $filtering = $q !== null || $tag || $kind;

        $where = ['a.user_id = ?', 'a.deleted_at IS NULL'];
        $params = [$uid];
        if ($view === 'drive') {
            $where[] = 'a.note_id IS NULL AND a.task_id IS NULL AND a.meeting_id IS NULL';
            if (!$filtering) {
                $where[] = $folderId ? 'a.folder_id = ?' : 'a.folder_id IS NULL';
                if ($folderId) {
                    $params[] = $folderId;
                }
            } elseif ($folderId) {
                $sub = self::subtree($folderId, $uid);
                $where[] = 'a.folder_id IN (' . DB::in($sub) . ')';
                array_push($params, ...$sub);
            }
        } elseif ($view === 'starred') {
            $where[] = 'a.is_starred = 1';
        } elseif ($view === 'recent') {
            $where[] = '(a.last_opened_at IS NOT NULL OR a.created_at >= ?)';
            $params[] = date('Y-m-d H:i:s', strtotime('-30 days'));
        }
        if ($q !== null) {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $where[] = '(a.original_name LIKE ? OR a.description LIKE ? OR EXISTS (SELECT 1 FROM file_tag_relations r JOIN note_tags t ON t.id = r.tag_id WHERE r.file_id = a.id AND t.name LIKE ?))';
            array_push($params, $like, $like, $like);
        }
        if ($tag) {
            $where[] = 'EXISTS (SELECT 1 FROM file_tag_relations r JOIN note_tags t ON t.id = r.tag_id WHERE r.file_id = a.id AND t.name = ?)';
            $params[] = $tag;
        }
        if ($kind === 'pdf') {
            $where[] = "a.mime_type = 'application/pdf'";
        } elseif ($kind) {
            $where[] = 'a.file_kind = ?';
            $params[] = $kind;
        }
        $sort = match (Http::query('sort')) {
            'name' => 'a.original_name ASC',
            'size' => 'a.file_size DESC',
            'opened' => 'COALESCE(a.last_opened_at, a.created_at) DESC',
            default => $view === 'recent' ? 'COALESCE(a.last_opened_at, a.created_at) DESC' : 'a.created_at DESC',
        };
        $perPage = V::int(Http::query('per_page'), 1, 200) ?? 60;
        $page = V::int(Http::query('page'), 1) ?? 1;
        $w = implode(' AND ', $where);
        $total = (int) DB::val("SELECT COUNT(*) FROM note_attachments a WHERE $w", $params);
        $rows = DB::all(
            "SELECT a.*, n.title AS note_title, f.name AS folder_name FROM note_attachments a
             LEFT JOIN notes n ON n.id = a.note_id LEFT JOIN drive_folders f ON f.id = a.folder_id
             WHERE $w ORDER BY a.is_starred DESC, $sort, a.id DESC LIMIT $perPage OFFSET " . (($page - 1) * $perPage),
            $params
        );
        $items = FilesController::presentMany($rows);
        foreach ($items as $i => &$it) {
            $it['folder_name'] = $rows[$i]['folder_name'];
        }
        unset($it);

        $folders = [];
        if ($view === 'drive' && !$filtering) {
            $folders = DB::all(
                'SELECT f.id, f.name, f.color, f.updated_at,
                        (SELECT COUNT(*) FROM note_attachments a WHERE a.folder_id = f.id AND a.deleted_at IS NULL) AS file_count,
                        (SELECT COUNT(*) FROM drive_folders c WHERE c.parent_id = f.id) AS folder_count
                 FROM drive_folders f WHERE f.user_id = ? AND ' . ($folderId ? 'f.parent_id = ?' : 'f.parent_id IS NULL') . ' ORDER BY f.name',
                $folderId ? [$uid, $folderId] : [$uid]
            );
            foreach ($folders as &$f) {
                $f['id'] = (int) $f['id'];
                $f['file_count'] = (int) $f['file_count'];
                $f['folder_count'] = (int) $f['folder_count'];
            }
            unset($f);
        }
        $sum = DB::one('SELECT COUNT(*) c, COALESCE(SUM(file_size), 0) s FROM note_attachments WHERE user_id = ? AND deleted_at IS NULL', [$uid]);
        Http::ok([
            'view' => $view,
            'folder' => $folderId ? ['id' => $folderId, 'path' => self::path($folderId, $uid)] : null,
            'folders' => $folders,
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'summary' => ['count' => (int) $sum['c'], 'size' => (int) $sum['s']],
        ]);
    }

    public static function folders(): void
    {
        $u = Auth::require();
        Http::ok(array_map(static fn($f) => [
            'id' => (int) $f['id'], 'name' => $f['name'], 'color' => $f['color'], 'parent_id' => $f['parent_id'] ? (int) $f['parent_id'] : null,
        ], DB::all('SELECT id, name, color, parent_id FROM drive_folders WHERE user_id = ? ORDER BY name', [$u['id']])));
    }

    public static function createFolder(): void
    {
        $u = Auth::require();
        $name = V::str(Http::input('name'), 120, true, 'name');
        $parent = self::ownedFolder(V::id(Http::input('parent_id')), $u['id']);
        if (DB::val('SELECT id FROM drive_folders WHERE user_id = ? AND name = ? AND ' . ($parent ? 'parent_id = ?' : 'parent_id IS NULL'), $parent ? [$u['id'], $name, $parent] : [$u['id'], $name])) {
            throw new HttpException('A folder with this name already exists here.', 422, ['name' => 'taken']);
        }
        $id = DB::insert('drive_folders', ['user_id' => $u['id'], 'parent_id' => $parent, 'name' => $name, 'color' => V::color(Http::input('color'))]);
        Activity::log('drive.folder_create', 'folder', $id, $name);
        Http::ok(['id' => $id]);
    }

    public static function updateFolder(int $id): void
    {
        $u = Auth::require();
        self::ownedFolder($id, $u['id']);
        $data = [];
        if (Http::has('name')) {
            $data['name'] = V::str(Http::input('name'), 120, true, 'name');
        }
        if (Http::has('color')) {
            $data['color'] = V::color(Http::input('color'));
        }
        if (Http::has('parent_id')) {
            $parent = self::ownedFolder(V::id(Http::input('parent_id')), $u['id']);
            if ($parent && in_array($parent, self::subtree($id, $u['id']), true)) {
                throw new HttpException('A folder cannot be moved into itself.', 422);
            }
            $data['parent_id'] = $parent;
        }
        DB::update('drive_folders', $data, 'id = ? AND user_id = ?', [$id, $u['id']]);
        Http::ok();
    }

    /** Delete a folder; its files and sub-folders move up to the parent folder (nothing is lost). */
    public static function deleteFolder(int $id): void
    {
        $u = Auth::require();
        self::ownedFolder($id, $u['id']);
        $parent = DB::val('SELECT parent_id FROM drive_folders WHERE id = ?', [$id]);
        DB::tx(static function () use ($id, $parent, $u) {
            DB::run('UPDATE note_attachments SET folder_id = ? WHERE folder_id = ? AND user_id = ?', [$parent, $id, $u['id']]);
            DB::run('UPDATE drive_folders SET parent_id = ? WHERE parent_id = ? AND user_id = ?', [$parent, $id, $u['id']]);
            DB::run('DELETE FROM drive_folders WHERE id = ? AND user_id = ?', [$id, $u['id']]);
        });
        Activity::log('drive.folder_delete', 'folder', $id, 'Deleted folder');
        Http::ok();
    }

    public static function move(): void
    {
        $u = Auth::require();
        $target = self::ownedFolder(V::id(Http::input('folder_id')), $u['id']);
        $files = V::ids(Http::input('file_ids'));
        $folders = V::ids(Http::input('folder_ids'));
        if ($files) {
            DB::run('UPDATE note_attachments SET folder_id = ? WHERE user_id = ? AND id IN (' . DB::in($files) . ')', array_merge([$target, $u['id']], $files));
        }
        foreach ($folders as $fid) {
            self::ownedFolder($fid, $u['id']);
            if ($target && in_array($target, self::subtree($fid, $u['id']), true)) {
                throw new HttpException('A folder cannot be moved into itself.', 422);
            }
            DB::update('drive_folders', ['parent_id' => $target], 'id = ? AND user_id = ?', [$fid, $u['id']]);
        }
        Http::ok(['moved' => count($files) + count($folders)]);
    }

    /** Drive files that share at least one tag with a note (owner only). */
    public static function relatedFiles(int $noteId): void
    {
        $u = Auth::require();
        [, $role] = NotesController::access($noteId, $u['id']);
        if ($role !== 'owner') {
            Http::ok([]);
        }
        $rows = DB::all(
            'SELECT DISTINCT a.* FROM note_attachments a
             JOIN file_tag_relations fr ON fr.file_id = a.id
             JOIN note_tag_relations nr ON nr.tag_id = fr.tag_id AND nr.note_id = ?
             WHERE a.user_id = ? AND a.deleted_at IS NULL AND (a.note_id IS NULL OR a.note_id <> ?)
             ORDER BY a.created_at DESC LIMIT 100',
            [$noteId, $u['id'], $noteId]
        );
        Http::ok(FilesController::presentMany($rows));
    }

    /** Notes linked to a file: the note it is attached to + notes sharing a tag. */
    public static function relatedNotes(int $fileId): void
    {
        $u = Auth::require();
        $f = DB::one('SELECT id, note_id FROM note_attachments WHERE id = ? AND user_id = ?', [$fileId, $u['id']]);
        if (!$f) {
            throw new HttpException('File not found.', 404);
        }
        $rows = DB::all(
            "SELECT DISTINCT n.id, n.title, LEFT(n.content_text, 140) AS excerpt, n.updated_at, n.color
             FROM notes n
             WHERE n.user_id = ? AND n.deleted_at IS NULL AND (n.id = ? OR EXISTS (
               SELECT 1 FROM note_tag_relations nr JOIN file_tag_relations fr ON fr.tag_id = nr.tag_id AND fr.file_id = ? WHERE nr.note_id = n.id))
             ORDER BY n.updated_at DESC LIMIT 100",
            [$u['id'], (int) $f['note_id'], $fileId]
        );
        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
        }
        Http::ok($rows);
    }
}
