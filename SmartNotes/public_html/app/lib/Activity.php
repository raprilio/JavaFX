<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class Activity
{
    public static function log(string $action, ?string $entityType = null, ?int $entityId = null, ?string $description = null, ?int $userId = null): void
    {
        try {
            DB::insert('activity_logs', [
                'user_id' => $userId ?? Auth::id(),
                'action' => mb_substr($action, 0, 60),
                'entity_type' => $entityType,
                'entity_id' => $entityId,
                'description' => $description !== null ? mb_substr($description, 0, 500) : null,
                'ip_address' => PHP_SAPI === 'cli' ? 'cli' : client_ip(),
                'user_agent' => PHP_SAPI === 'cli' ? 'cron' : user_agent(),
            ]);
        } catch (Throwable $e) {
            error_log('Activity log failed: ' . $e->getMessage());
        }
    }
}
