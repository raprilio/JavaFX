<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class NotificationsController
{
    public static function index(): void
    {
        $u = Auth::require();
        // Piggy-back the (throttled) scheduler on this light poll — no daemon needed.
        Scheduler::maybeRunFromWeb();
        $items = DB::all('SELECT id, type, title, message, link, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 40', [$u['id']]);
        foreach ($items as &$i) {
            $i['id'] = (int) $i['id'];
            $i['is_read'] = (bool) $i['is_read'];
        }
        $unread = (int) DB::val('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0', [$u['id']]);
        Http::ok(['items' => $items, 'unread' => $unread]);
    }

    public static function read(): void
    {
        $u = Auth::require();
        $ids = V::ids(Http::input('ids'));
        if ($ids) {
            DB::run('UPDATE notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND id IN (' . DB::in($ids) . ')', array_merge([$u['id']], $ids));
        } else {
            DB::run('UPDATE notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0', [$u['id']]);
        }
        Http::ok();
    }

    public static function clear(): void
    {
        $u = Auth::require();
        DB::run('DELETE FROM notifications WHERE user_id = ?', [$u['id']]);
        Http::ok();
    }
}
