<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class ProfileController
{
    public static function update(): void
    {
        $u = Auth::require();
        $name = V::str(Http::input('name'), 120, true, 'name');
        $email = V::email(Http::input('email'));
        if ($email !== $u['email'] && DB::val('SELECT id FROM users WHERE email = ? AND id <> ?', [$email, $u['id']])) {
            throw new HttpException('This e-mail address is already in use.', 422, ['email' => 'taken']);
        }
        DB::update('users', ['name' => $name, 'email' => $email], 'id = ?', [$u['id']]);
        DB::run(
            'INSERT INTO user_profiles (user_id, job_title, phone, bio) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE job_title = VALUES(job_title), phone = VALUES(phone), bio = VALUES(bio)',
            [$u['id'], V::str(Http::input('job_title'), 120), V::str(Http::input('phone'), 40), V::str(Http::input('bio'), 2000)]
        );
        Activity::log('profile.update', 'user', $u['id'], 'Updated profile');
        Auth::refresh();
        AppController::bootstrap();
    }

    public static function uploadAvatar(): void
    {
        $u = Auth::require();
        if (empty($_FILES['file'])) {
            throw new HttpException('No file uploaded.', 422);
        }
        $meta = Uploader::store($_FILES['file'], ['image'], 'u' . $u['id'] . '/avatar', false, policy: false);
        // Square-ish small avatar: re-encode down to 512px.
        Uploader::reencode(Uploader::absolute($meta['file_path']), Uploader::absolute($meta['file_path']), $meta['ext'], 512);
        Uploader::delete($u['avatar_path']);
        DB::run(
            'INSERT INTO user_profiles (user_id, avatar_path) VALUES (?, ?) ON DUPLICATE KEY UPDATE avatar_path = VALUES(avatar_path)',
            [$u['id'], $meta['file_path']]
        );
        Auth::refresh();
        AppController::bootstrap();
    }

    public static function removeAvatar(): void
    {
        $u = Auth::require();
        Uploader::delete($u['avatar_path']);
        DB::update('user_profiles', ['avatar_path' => null], 'user_id = ?', [$u['id']]);
        Auth::refresh();
        AppController::bootstrap();
    }

    public static function avatar(int $id): void
    {
        Auth::require();
        $p = DB::val('SELECT avatar_path FROM user_profiles WHERE user_id = ?', [$id]);
        if (!$p) {
            throw new HttpException('Not found.', 404);
        }
        $ext = strtolower(pathinfo((string) $p, PATHINFO_EXTENSION));
        Uploader::serve((string) $p, Uploader::SERVE_MIME[$ext] ?? 'image/jpeg', 'avatar.' . $ext);
    }

    public static function password(): void
    {
        $u = Auth::require();
        $hash = (string) DB::val('SELECT password_hash FROM users WHERE id = ?', [$u['id']]);
        if (!password_verify((string) Http::input('current_password', ''), $hash)) {
            throw new HttpException('Your current password is incorrect.', 422, ['current_password' => 'invalid']);
        }
        $new = V::password(Http::input('password'));
        if (password_verify($new, $hash)) {
            throw new HttpException('The new password must be different from the current one.', 422, ['password' => 'same']);
        }
        DB::update('users', ['password_hash' => password_hash($new, PASSWORD_DEFAULT), 'must_change_password' => 0], 'id = ?', [$u['id']]);
        DB::run('UPDATE users SET session_version = session_version + 1 WHERE id = ?', [$u['id']]);
        // Sign out every other session and remembered device; keep this one.
        $keep = Auth::currentRememberSelector();
        DB::run('DELETE FROM remember_tokens WHERE user_id = ? AND selector <> ?', [$u['id'], (string) $keep]);
        session_regenerate_id(true);
        Auth::syncSessionVersion($u['id']);
        Activity::log('profile.password', 'user', $u['id'], 'Changed password');
        Http::ok(null, 'Password changed.');
    }

    public static function saveSettings(): void
    {
        $u = Auth::require();
        $map = [
            'theme' => static fn($v) => V::enum($v, ['light', 'dark', 'system'], 'system'),
            'accent_color' => static fn($v) => V::color($v),
            'sidebar_style' => static fn($v) => V::enum($v, ['expanded', 'collapsed'], 'expanded'),
            'background_opacity' => static fn($v) => V::int($v, 0, 100) ?? 15,
            'compact_mode' => static fn($v) => V::bool($v),
            'notes_view' => static fn($v) => V::enum($v, ['grid', 'list'], 'grid'),
            'notify_task' => static fn($v) => V::bool($v),
            'notify_meeting' => static fn($v) => V::bool($v),
            'notify_schedule' => static fn($v) => V::bool($v),
            'notify_daily_agenda' => static fn($v) => V::bool($v),
            'notify_weekly_agenda' => static fn($v) => V::bool($v),
            'email_notifications' => static fn($v) => V::bool($v),
            'daily_agenda_time' => static fn($v) => V::time($v) ?? '07:00:00',
            'default_reminder' => static fn($v) => V::int($v, 0, 10080),
            // Dashboard widgets the user chose to hide (keys like "recent_notes", "stat_audio").
            'dashboard_hidden' => static fn($v) => json_encode(array_values(array_unique(array_filter(
                array_slice(is_array($v) ? $v : [], 0, 60),
                static fn($k) => is_string($k) && preg_match('/^[a-z][a-z_]{1,39}$/', $k)
            )))),
        ];
        $data = [];
        foreach ($map as $k => $fn) {
            if (Http::has($k)) {
                $data[$k] = $fn(Http::input($k));
            }
        }
        if ($data) {
            AppController::userSettings($u['id']); // make sure the row exists
            DB::update('user_settings', $data, 'user_id = ?', [$u['id']]);
        }
        Http::ok(AppController::userSettings($u['id']));
    }

    public static function uploadBackground(): void
    {
        $u = Auth::require();
        if (empty($_FILES['file'])) {
            throw new HttpException('No file uploaded.', 422);
        }
        $meta = Uploader::store($_FILES['file'], ['image'], 'u' . $u['id'] . '/background', false, policy: false);
        $old = DB::val('SELECT background_image FROM user_settings WHERE user_id = ?', [$u['id']]);
        Uploader::delete($old ? (string) $old : null);
        AppController::userSettings($u['id']);
        DB::update('user_settings', ['background_image' => $meta['file_path']], 'user_id = ?', [$u['id']]);
        Http::ok(AppController::userSettings($u['id']));
    }

    public static function removeBackground(): void
    {
        $u = Auth::require();
        $old = DB::val('SELECT background_image FROM user_settings WHERE user_id = ?', [$u['id']]);
        Uploader::delete($old ? (string) $old : null);
        DB::update('user_settings', ['background_image' => null], 'user_id = ?', [$u['id']]);
        Http::ok(AppController::userSettings($u['id']));
    }

    public static function background(): void
    {
        $u = Auth::require();
        $p = DB::val('SELECT background_image FROM user_settings WHERE user_id = ?', [$u['id']]);
        if (!$p) {
            throw new HttpException('Not found.', 404);
        }
        $ext = strtolower(pathinfo((string) $p, PATHINFO_EXTENSION));
        Uploader::serve((string) $p, Uploader::SERVE_MIME[$ext] ?? 'image/jpeg', 'background.' . $ext);
    }

    public static function sessions(): void
    {
        $u = Auth::require();
        $current = Auth::currentRememberSelector();
        $rows = DB::all('SELECT id, selector, user_agent, ip_address, created_at, last_used_at, expires_at FROM remember_tokens WHERE user_id = ? AND expires_at > NOW() ORDER BY COALESCE(last_used_at, created_at) DESC', [$u['id']]);
        foreach ($rows as &$r) {
            $r['current'] = $r['selector'] === $current;
            unset($r['selector']);
        }
        Http::ok(['devices' => $rows, 'last_login_at' => $u['last_login_at']]);
    }

    public static function revokeSession(int $id): void
    {
        $u = Auth::require();
        DB::run('DELETE FROM remember_tokens WHERE id = ? AND user_id = ?', [$id, $u['id']]);
        Http::ok();
    }

    public static function revokeAllSessions(): void
    {
        $u = Auth::require();
        $keep = Auth::currentRememberSelector();
        DB::run('DELETE FROM remember_tokens WHERE user_id = ? AND selector <> ?', [$u['id'], (string) $keep]);
        Activity::log('profile.sessions', 'user', $u['id'], 'Signed out other devices');
        Http::ok();
    }

    public static function storage(): void
    {
        $u = Auth::require();
        $rows = DB::all("SELECT file_kind, COUNT(*) c, COALESCE(SUM(file_size),0) s FROM note_attachments WHERE user_id = ? GROUP BY file_kind", [$u['id']]);
        $audio = DB::one('SELECT COUNT(*) c, COALESCE(SUM(file_size),0) s FROM audio_notes WHERE user_id = ?', [$u['id']]);
        $by = [];
        $total = 0;
        foreach ($rows as $r) {
            $by[$r['file_kind']] = ['count' => (int) $r['c'], 'size' => (int) $r['s']];
            $total += (int) $r['s'];
        }
        $by['recordings'] = ['count' => (int) $audio['c'], 'size' => (int) $audio['s']];
        $total += (int) $audio['s'];
        Http::ok(['total' => $total, 'by_kind' => $by]);
    }

    public static function export(): void
    {
        $u = Auth::require();
        $data = DataPort::export($u['id']);
        Activity::log('profile.export', 'user', $u['id'], 'Exported personal data');
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="smartnotes-export-' . date('Ymd-His') . '.json"');
        echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function import(): void
    {
        $u = Auth::require();
        if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            throw new HttpException('Please choose a SmartNotes export (.json) file.', 422);
        }
        if ($_FILES['file']['size'] > 50 * 1024 * 1024) {
            throw new HttpException('The import file is too large (max 50 MB).', 422);
        }
        $data = json_decode((string) file_get_contents($_FILES['file']['tmp_name']), true);
        if (!is_array($data) || ($data['format'] ?? '') !== 'smartnotes-export') {
            throw new HttpException('This is not a valid SmartNotes export file.', 422);
        }
        $counts = DataPort::import($u['id'], $data);
        Activity::log('profile.import', 'user', $u['id'], 'Imported data: ' . json_encode($counts));
        Http::ok($counts, 'Import completed.');
    }
}
