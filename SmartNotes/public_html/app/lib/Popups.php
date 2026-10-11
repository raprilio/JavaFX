<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * In-app pop-ups (v1.9): admin announcements until the user confirms them, and reminders when they fire.
 * Delivered with the regular notification poll (every minute while the app is open).
 */
final class Popups
{
    private const REMINDER_WINDOW_HOURS = 12;

    public static function forUser(int $userId): array
    {
        $out = [];
        foreach (DB::all(
            "SELECT a.id, a.title, a.body, a.level, a.created_at, u.name AS author
             FROM announcements a LEFT JOIN users u ON u.id = a.created_by
             WHERE a.deleted_at IS NULL AND a.starts_at <= NOW() AND (a.ends_at IS NULL OR a.ends_at > NOW())
               AND (a.audience = 'all' OR EXISTS (SELECT 1 FROM announcement_targets t WHERE t.announcement_id = a.id AND t.user_id = ?))
               AND NOT EXISTS (SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.user_id = ?)
               AND (a.created_by IS NULL OR a.created_by <> ?)
             ORDER BY a.created_at LIMIT 5",
            [$userId, $userId, $userId]
        ) as $a) {
            $out[] = ['kind' => 'announcement', 'id' => (int) $a['id'], 'title' => $a['title'], 'body' => $a['body'], 'level' => $a['level'], 'author' => $a['author'], 'created_at' => $a['created_at']];
        }
        $wantsReminders = (int) (DB::val('SELECT popup_reminders FROM user_settings WHERE user_id = ?', [$userId]) ?? 1) === 1;
        if ($wantsReminders) {
            foreach (DB::all(
                "SELECT id, title, message, link, created_at FROM notifications
                 WHERE user_id = ? AND type = 'reminder' AND popped_at IS NULL AND created_at > ?
                 ORDER BY id LIMIT 5",
                [$userId, date('Y-m-d H:i:s', time() - self::REMINDER_WINDOW_HOURS * 3600)]
            ) as $n) {
                $out[] = ['kind' => 'reminder', 'id' => (int) $n['id'], 'title' => $n['title'], 'body' => $n['message'], 'link' => $n['link'], 'created_at' => $n['created_at']];
            }
        }
        return $out;
    }

    /** The user closed a pop-up ("Got it" / "Open" / "Dismiss"). */
    public static function ack(int $userId, string $kind, int $id): void
    {
        if ($kind === 'announcement') {
            DB::run('INSERT IGNORE INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)', [$id, $userId]);
            return;
        }
        if ($kind === 'reminder') {
            DB::run('UPDATE notifications SET popped_at = NOW(), is_read = 1 WHERE id = ? AND user_id = ?', [$id, $userId]);
            return;
        }
        throw new HttpException('Unknown pop-up.', 422);
    }
}
