<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/** In-app notifications. */
final class Notify
{
    public static function create(int $userId, string $type, string $title, ?string $message = null, ?string $link = null): int
    {
        return DB::insert('notifications', [
            'user_id' => $userId,
            'type' => $type,
            'title' => mb_substr($title, 0, 255),
            'message' => $message,
            'link' => $link,
        ]);
    }
}
