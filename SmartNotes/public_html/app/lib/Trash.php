<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Soft delete / restore / permanent delete for every trashable entity.
 */
final class Trash
{
    public const TABLES = [
        'note' => 'notes',
        'task' => 'tasks',
        'event' => 'calendar_events',
        'meeting' => 'meetings',
        'mindmap' => 'mindmaps',
        'flowchart' => 'flowcharts',
        'audio' => 'audio_notes',
        'file' => 'note_attachments',
    ];

    private const REMINDABLE = ['task' => 'task', 'event' => 'event', 'meeting' => 'meeting'];

    public static function table(string $type): string
    {
        if (!isset(self::TABLES[$type])) {
            throw new HttpException('Unknown item type.', 422);
        }
        return self::TABLES[$type];
    }

    public static function softDelete(string $type, int $id, int $userId): void
    {
        $t = self::table($type);
        $n = DB::update($t, ['deleted_at' => now()], 'id = ? AND user_id = ? AND deleted_at IS NULL', [$id, $userId]);
        if (!$n) {
            throw new HttpException('Item not found.', 404);
        }
        if (isset(self::REMINDABLE[$type])) {
            Scheduler::sync(self::REMINDABLE[$type], $id);
        }
    }

    public static function restore(string $type, int $id, int $userId): void
    {
        $t = self::table($type);
        // A note the user deleted forever sits in the admin trash: only an administrator can bring it back.
        $n = DB::update($t, ['deleted_at' => null], 'id = ? AND user_id = ? AND deleted_at IS NOT NULL' . ($type === 'note' ? ' AND purged_at IS NULL' : ''), [$id, $userId]);
        if (!$n) {
            throw new HttpException('Item not found in trash.', 404);
        }
        if (isset(self::REMINDABLE[$type])) {
            Scheduler::sync(self::REMINDABLE[$type], $id);
        }
    }

    /**
     * "Delete forever" by a user (or the trash auto-delete). Notes go to the admin trash first (v1.9):
     * they vanish for the user but an administrator can still read, restore or really delete them.
     */
    public static function remove(string $type, int $id, int $userId): void
    {
        if ($type !== 'note') {
            self::destroy($type, $id, $userId);
            return;
        }
        $n = DB::run(
            'UPDATE notes SET purged_at = NOW(), purged_by = ?, pinned_global = 0, deleted_at = COALESCE(deleted_at, NOW()) WHERE id = ? AND user_id = ? AND purged_at IS NULL',
            [$userId, $id, $userId]
        )->rowCount();
        if (!$n) {
            throw new HttpException('Item not found.', 404);
        }
        DB::run('DELETE FROM note_pin_targets WHERE note_id = ?', [$id]);
    }

    /** Admin trash: delete for good the notes that users deleted more than $days ago (0 = keep until an admin deletes them). */
    public static function purgeAdminTrash(int $days): int
    {
        if ($days <= 0) {
            return 0;
        }
        $count = 0;
        foreach (DB::all('SELECT id, user_id FROM notes WHERE purged_at IS NOT NULL AND purged_at < ? LIMIT 500', [date('Y-m-d H:i:s', time() - $days * 86400)]) as $r) {
            try {
                self::destroy('note', (int) $r['id'], (int) $r['user_id']);
                $count++;
            } catch (Throwable $e) {
                error_log('Admin trash purge failed: ' . $e->getMessage());
            }
        }
        return $count;
    }

    /** Permanently delete a record and its stored files. */
    public static function destroy(string $type, int $id, int $userId): void
    {
        $t = self::table($type);
        $row = DB::one("SELECT id FROM `$t` WHERE id = ? AND user_id = ?", [$id, $userId]);
        if (!$row) {
            throw new HttpException('Item not found.', 404);
        }
        $files = [];
        if (in_array($type, ['note', 'task', 'meeting'], true)) {
            foreach (DB::all("SELECT file_path, thumb_path FROM note_attachments WHERE {$type}_id = ? AND user_id = ?", [$id, $userId]) as $f) {
                $files[] = $f['file_path'];
                $files[] = $f['thumb_path'];
            }
            DB::run("DELETE FROM note_attachments WHERE {$type}_id = ? AND user_id = ?", [$id, $userId]);
        }
        if ($type === 'note') {
            array_push($files, ...DrawingsController::filesOfNote($id));
            foreach (DB::all('SELECT file_path FROM audio_notes WHERE note_id = ? AND user_id = ?', [$id, $userId]) as $f) {
                $files[] = $f['file_path'];
            }
            DB::run('DELETE FROM audio_notes WHERE note_id = ? AND user_id = ?', [$id, $userId]);
        }
        if ($type === 'audio') {
            $files[] = DB::val('SELECT file_path FROM audio_notes WHERE id = ?', [$id]);
        }
        if ($type === 'file') {
            $f = DB::one('SELECT file_path, thumb_path FROM note_attachments WHERE id = ?', [$id]);
            $files[] = $f['file_path'] ?? null;
            $files[] = $f['thumb_path'] ?? null;
        }
        if ($type === 'mindmap') {
            // Break self references first so cascades never exceed InnoDB's depth limit.
            DB::run('UPDATE mindmap_nodes SET parent_id = NULL WHERE mindmap_id = ?', [$id]);
        }
        if (isset(self::REMINDABLE[$type])) {
            DB::run('DELETE FROM reminders WHERE remindable_type = ? AND remindable_id = ?', [self::REMINDABLE[$type], $id]);
        }
        if (isset(Shares::TYPES[$type])) {
            Shares::purge($type, $id);
        }
        DB::run("DELETE FROM `$t` WHERE id = ? AND user_id = ?", [$id, $userId]);
        Uploader::delete(...$files);
    }

    /** List trashed items for a user (all types). */
    public static function items(int $userId): array
    {
        $q = [
            "SELECT 'note' AS type, id, IF(title = '', '(Untitled note)', title) AS title, deleted_at FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL",
            "SELECT 'task', id, title, deleted_at FROM tasks WHERE user_id = ? AND deleted_at IS NOT NULL",
            "SELECT 'event', id, title, deleted_at FROM calendar_events WHERE user_id = ? AND deleted_at IS NOT NULL",
            "SELECT 'meeting', id, title, deleted_at FROM meetings WHERE user_id = ? AND deleted_at IS NOT NULL",
            "SELECT 'mindmap', id, title, deleted_at FROM mindmaps WHERE user_id = ? AND deleted_at IS NOT NULL",
            "SELECT 'flowchart', id, title, deleted_at FROM flowcharts WHERE user_id = ? AND deleted_at IS NOT NULL",
            "SELECT 'audio', id, title, deleted_at FROM audio_notes WHERE user_id = ? AND deleted_at IS NOT NULL",
            "SELECT 'file', id, original_name, deleted_at FROM note_attachments WHERE user_id = ? AND deleted_at IS NOT NULL",
        ];
        $sql = implode(' UNION ALL ', $q) . ' ORDER BY deleted_at DESC LIMIT 1000';
        return DB::all($sql, array_fill(0, count($q), $userId));
    }

    /** Auto-delete items that have been in the trash longer than $days. */
    public static function purgeOlderThan(int $days): int
    {
        if ($days <= 0) {
            return 0;
        }
        $cutoff = date('Y-m-d H:i:s', time() - $days * 86400);
        $count = 0;
        foreach (self::TABLES as $type => $t) {
            foreach (DB::all("SELECT id, user_id FROM `$t` WHERE deleted_at IS NOT NULL AND deleted_at < ?" . ($type === 'note' ? ' AND purged_at IS NULL' : '') . ' LIMIT 500', [$cutoff]) as $r) {
                try {
                    self::remove($type, (int) $r['id'], (int) $r['user_id']);
                    $count++;
                } catch (Throwable $e) {
                    error_log('Trash purge failed: ' . $e->getMessage());
                }
            }
        }
        return $count;
    }
}
