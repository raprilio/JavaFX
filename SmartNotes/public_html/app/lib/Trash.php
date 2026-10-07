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
        $n = DB::update($t, ['deleted_at' => null], 'id = ? AND user_id = ? AND deleted_at IS NOT NULL', [$id, $userId]);
        if (!$n) {
            throw new HttpException('Item not found in trash.', 404);
        }
        if (isset(self::REMINDABLE[$type])) {
            Scheduler::sync(self::REMINDABLE[$type], $id);
        }
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
        DB::run("DELETE FROM `$t` WHERE id = ? AND user_id = ?", [$id, $userId]);
        Uploader::delete(...$files);
    }

    /** List trashed items for a user (all types). */
    public static function items(int $userId): array
    {
        $q = [
            "SELECT 'note' AS type, id, IF(title = '', '(Untitled note)', title) AS title, deleted_at FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL",
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
            foreach (DB::all("SELECT id, user_id FROM `$t` WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT 500", [$cutoff]) as $r) {
                try {
                    self::destroy($type, (int) $r['id'], (int) $r['user_id']);
                    $count++;
                } catch (Throwable $e) {
                    error_log('Trash purge failed: ' . $e->getMessage());
                }
            }
        }
        return $count;
    }
}
