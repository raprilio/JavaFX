<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class TrashController
{
    public static function index(): void
    {
        $u = Auth::require();
        $days = Settings::int('trash_auto_delete_days', 0);
        $items = array_map(static function ($r) use ($days) {
            $r['id'] = (int) $r['id'];
            $r['purge_at'] = $days > 0 ? date('Y-m-d H:i:s', strtotime($r['deleted_at']) + $days * 86400) : null;
            return $r;
        }, Trash::items($u['id']));
        Http::ok(['items' => $items, 'auto_delete_days' => $days]);
    }

    public static function trash(string $type, int $id): void
    {
        $u = Auth::require();
        Trash::softDelete($type, $id, $u['id']);
        Activity::log($type . '.trash', $type, $id, 'Moved to trash');
        Http::ok();
    }

    public static function restore(string $type, int $id): void
    {
        $u = Auth::require();
        Trash::restore($type, $id, $u['id']);
        Activity::log($type . '.restore', $type, $id, 'Restored from trash');
        Http::ok();
    }

    public static function destroy(string $type, int $id): void
    {
        $u = Auth::require();
        Trash::destroy($type, $id, $u['id']);
        Activity::log($type . '.destroy', $type, $id, 'Permanently deleted');
        Http::ok();
    }

    public static function emptyAll(): void
    {
        $u = Auth::require();
        $n = 0;
        foreach (Trash::items($u['id']) as $r) {
            try {
                Trash::destroy($r['type'], (int) $r['id'], $u['id']);
                $n++;
            } catch (HttpException) {
            }
        }
        Activity::log('trash.empty', null, null, "Emptied trash ($n items)");
        Http::ok(['count' => $n]);
    }
}
