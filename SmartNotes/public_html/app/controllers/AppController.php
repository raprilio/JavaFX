<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class AppController
{
    /** Everything the SPA needs on start-up. */
    public static function bootstrap(): void
    {
        $user = Auth::user();
        $out = [
            'version' => SN_VERSION,
            'csrf' => Csrf::token(),
            'branding' => Settings::publicBranding(),
            'user' => null,
        ];
        if ($user) {
            $out['user'] = Auth::publicUser($user);
            $out['settings'] = self::userSettings($user['id']);
            $out['categories'] = [
                'note' => CategoriesController::listFor('note', $user['id']),
                'task' => CategoriesController::listFor('task', $user['id']),
            ];
            $out['tags'] = TagsController::listFor($user['id']);
            $out['is_admin_area'] = Auth::hasAnyAdminPermission();
            $out['limits'] = [
                'image_mb' => Settings::int('max_image_mb', 8),
                'audio_mb' => Settings::int('max_audio_mb', 25),
                'file_mb' => Settings::int('max_file_mb', 20),
                'server_upload' => ini_get('upload_max_filesize'),
            ];
            $out['unread_notifications'] = (int) DB::val('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0', [$user['id']]);
            $out['smtp_configured'] = Mailer::isConfigured();
        }
        Http::ok($out);
    }

    public static function userSettings(int $userId): array
    {
        $s = DB::one('SELECT * FROM user_settings WHERE user_id = ?', [$userId]);
        if (!$s) {
            DB::insert('user_settings', ['user_id' => $userId, 'theme' => Settings::get('default_theme', 'system')]);
            $s = DB::one('SELECT * FROM user_settings WHERE user_id = ?', [$userId]);
        }
        return [
            'theme' => $s['theme'],
            'accent_color' => $s['accent_color'],
            'sidebar_style' => $s['sidebar_style'],
            'background_url' => $s['background_image'] ? 'api/index.php?route=profile/background&v=' . substr(md5($s['background_image']), 0, 8) : null,
            'background_opacity' => (int) $s['background_opacity'],
            'compact_mode' => (bool) $s['compact_mode'],
            'notes_view' => $s['notes_view'],
            'notify_task' => (bool) $s['notify_task'],
            'notify_meeting' => (bool) $s['notify_meeting'],
            'notify_schedule' => (bool) $s['notify_schedule'],
            'notify_daily_agenda' => (bool) $s['notify_daily_agenda'],
            'notify_weekly_agenda' => (bool) $s['notify_weekly_agenda'],
            'email_notifications' => (bool) $s['email_notifications'],
            'daily_agenda_time' => substr((string) $s['daily_agenda_time'], 0, 5),
            'default_reminder' => $s['default_reminder'] === null ? null : (int) $s['default_reminder'],
            'dashboard_hidden' => json_decode_array($s['dashboard_hidden'] ?? null),
        ];
    }
}
