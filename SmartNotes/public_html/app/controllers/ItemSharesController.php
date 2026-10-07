<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/** Share audio, mind maps, flowcharts, Drive files & folders and calendar events with other users. */
final class ItemSharesController
{
    private static function enabled(string $type): void
    {
        if ($type !== 'event' && !(int) Settings::get('allow_note_sharing', '1')) {
            throw new HttpException('Sharing has been disabled by the administrator.', 403);
        }
    }

    public static function index(string $type, int $id): void
    {
        $u = Auth::require();
        Shares::require($type, $id, $u['id'], 'owner');
        Http::ok(['shares' => Shares::list($type, $id), 'perms' => Shares::cfg($type)['perms']]);
    }

    public static function store(string $type, int $id): void
    {
        $u = Auth::require();
        self::enabled($type);
        Shares::require($type, $id, $u['id'], 'owner');
        $ids = V::ids(Http::input('user_ids', []));
        if (!$ids) {
            throw new HttpException('Choose at least one person.', 422);
        }
        $added = Shares::add($type, $id, $u, $ids, (string) Http::input('permission', 'view'));
        Activity::log("$type.share", $type === 'file' ? 'file' : $type, $id, 'Shared with ' . count($ids) . ' user(s)');
        Http::ok(['shares' => Shares::list($type, $id), 'added' => count($added)]);
    }

    public static function remove(string $type, int $id, int $userId): void
    {
        $u = Auth::require();
        Shares::require($type, $id, $u['id'], 'owner');
        Shares::remove($type, $id, $userId);
        Http::ok(['shares' => Shares::list($type, $id)]);
    }

    /** A recipient removes an item from their own "Shared with me" list. */
    public static function leave(string $type, int $id): void
    {
        $u = Auth::require();
        Shares::cfg($type);
        Shares::remove($type, $id, $u['id']);
        Http::ok(null, 'Removed from your shared items.');
    }
}
