<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Admin trash (v1.9): notes users deleted forever are kept here until an administrator restores them
 * to their owner or deletes them for good. Full Admin role only (it shows users' note contents).
 */
final class AdminTrashController
{
    private static function admin(): array
    {
        $u = Auth::require();
        if (!Auth::isAdmin()) {
            throw new HttpException('Only administrators can open the admin trash.', 403);
        }
        return $u;
    }

    public static function index(): void
    {
        self::admin();
        $where = ['n.purged_at IS NOT NULL'];
        $params = [];
        if ($q = V::str(Http::query('q'), 100)) {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $where[] = '(n.title LIKE ? OR n.content_text LIKE ? OR u.name LIKE ? OR u.email LIKE ?)';
            array_push($params, $like, $like, $like, $like);
        }
        if ($uid = V::id(Http::query('user'))) {
            $where[] = 'n.user_id = ?';
            $params[] = $uid;
        }
        $rows = DB::all(
            'SELECT n.id, n.title, LEFT(n.content_text, 220) AS excerpt, n.is_locked, n.deleted_at, n.purged_at, n.updated_at,
                    u.id AS owner_id, u.name AS owner_name, u.email AS owner_email,
                    (SELECT COUNT(*) FROM note_attachments a WHERE a.note_id = n.id) AS attachment_count
             FROM notes n JOIN users u ON u.id = n.user_id
             WHERE ' . implode(' AND ', $where) . ' ORDER BY n.purged_at DESC LIMIT 500',
            $params
        );
        Http::ok([
            'items' => array_map(static fn($r) => [
                'id' => (int) $r['id'], 'title' => $r['title'], 'excerpt' => $r['excerpt'], 'is_locked' => (bool) $r['is_locked'],
                'deleted_at' => $r['deleted_at'], 'purged_at' => $r['purged_at'], 'updated_at' => $r['updated_at'],
                'owner' => ['id' => (int) $r['owner_id'], 'name' => $r['owner_name'], 'email' => $r['owner_email']],
                'attachment_count' => (int) $r['attachment_count'],
            ], $rows),
            'retention_days' => Settings::int('admin_trash_days', 0),
        ]);
    }

    private static function find(int $id): array
    {
        return DB::one('SELECT * FROM notes WHERE id = ? AND purged_at IS NOT NULL', [$id]) ?? throw new HttpException('Note not found in the admin trash.', 404);
    }

    public static function show(int $id): void
    {
        self::admin();
        $n = self::find($id);
        Activity::log('admin.trash_view', 'note', $id, 'Viewed a deleted note of user #' . $n['user_id']);
        Http::ok([
            'id' => (int) $n['id'], 'title' => $n['title'], 'content' => $n['content'], 'is_locked' => (bool) $n['is_locked'],
            'deleted_at' => $n['deleted_at'], 'purged_at' => $n['purged_at'], 'created_at' => $n['created_at'], 'updated_at' => $n['updated_at'],
            'owner' => DB::one('SELECT id, name, email FROM users WHERE id = ?', [$n['user_id']]),
            'attachments' => FilesController::forParent('note', $id, (int) $n['user_id']),
        ]);
    }

    /** Give the note back to its owner (it reappears in their notes, not in their trash). */
    public static function restore(int $id): void
    {
        $u = self::admin();
        $n = self::find($id);
        DB::run('UPDATE notes SET purged_at = NULL, purged_by = NULL, deleted_at = NULL, updated_at = updated_at WHERE id = ?', [$id]);
        if ((int) $n['user_id'] !== (int) $u['id']) {
            Notify::create((int) $n['user_id'], 'note', 'Administrator memulihkan catatan Anda: "' . ($n['title'] !== '' ? $n['title'] : 'Tanpa judul') . '"', null, '#/notes/' . $id);
        }
        Activity::log('admin.trash_restore', 'note', $id, 'Restored a deleted note to user #' . $n['user_id']);
        Http::ok(null, 'Note restored to its owner.');
    }

    public static function destroy(int $id): void
    {
        self::admin();
        $n = self::find($id);
        Trash::destroy('note', $id, (int) $n['user_id']);
        Activity::log('admin.trash_delete', 'note', $id, 'Deleted forever a note of user #' . $n['user_id']);
        Http::ok(null, 'Deleted forever.');
    }

    public static function emptyAll(): void
    {
        self::admin();
        $count = 0;
        foreach (DB::all('SELECT id, user_id FROM notes WHERE purged_at IS NOT NULL LIMIT 2000') as $r) {
            try {
                Trash::destroy('note', (int) $r['id'], (int) $r['user_id']);
                $count++;
            } catch (HttpException) {
            }
        }
        Activity::log('admin.trash_empty', null, null, "Emptied the admin trash ($count notes)");
        Http::ok(['count' => $count]);
    }
}
