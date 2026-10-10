<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Application-wide settings stored in the `settings` table.
 * Secrets (SMTP password) are encrypted with the APP key from config.php.
 */
final class Settings
{
    private const SECRET_KEYS = ['smtp_password', 'hmail_token', 'hmail_connections'];
    private const PUBLIC_KEYS = [
        'app_name', 'app_tagline', 'logo_path', 'favicon_path', 'background_path',
        'default_theme', 'default_accent', 'allow_registration', 'allow_note_sharing',
        'logo_display', 'logo_height', 'logo_max_width', 'login_logo_height',
    ];

    private static ?array $cache = null;

    public static function all(): array
    {
        if (self::$cache === null) {
            self::$cache = [];
            try {
                foreach (DB::all('SELECT setting_key, setting_value FROM settings') as $r) {
                    self::$cache[$r['setting_key']] = $r['setting_value'];
                }
            } catch (Throwable) {
                self::$cache = [];
            }
        }
        return self::$cache;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        $all = self::all();
        if (!array_key_exists($key, $all) || $all[$key] === null) {
            return $default;
        }
        $v = $all[$key];
        if (in_array($key, self::SECRET_KEYS, true) && $v !== '') {
            return Crypto::decrypt($v) ?? '';
        }
        return $v;
    }

    public static function int(string $key, int $default = 0): int
    {
        $v = self::get($key);
        return is_numeric($v) ? (int) $v : $default;
    }

    public static function set(string $key, mixed $value): void
    {
        if ($value !== null && in_array($key, self::SECRET_KEYS, true) && $value !== '') {
            $value = Crypto::encrypt((string) $value);
        }
        $value = $value === null ? null : (string) $value;
        DB::run(
            'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
            [$key, $value]
        );
        self::$cache = null;
    }

    public static function setMany(array $values): void
    {
        foreach ($values as $k => $v) {
            self::set((string) $k, $v);
        }
    }

    /** Branding & defaults safe to expose to anonymous visitors. */
    public static function publicBranding(): array
    {
        $out = [];
        foreach (self::PUBLIC_KEYS as $k) {
            $out[$k] = self::get($k);
        }
        $ver = substr(md5((string) ($out['logo_path'] . $out['favicon_path'] . $out['background_path'])), 0, 8);
        foreach (['logo_path' => 'logo_url', 'favicon_path' => 'favicon_url', 'background_path' => 'background_url'] as $k => $u) {
            $out[$u] = $out[$k] ? 'uploads/' . $out[$k] . '?v=' . $ver : null;
            unset($out[$k]);
        }
        $out['app_name'] = $out['app_name'] ?: 'SmartNotes';
        $out['default_theme'] = $out['default_theme'] ?: 'system';
        $out['default_accent'] = $out['default_accent'] ?: '#6366f1';
        $out['allow_registration'] = (bool) (int) ($out['allow_registration'] ?? 0);
        $out['allow_note_sharing'] = (bool) (int) ($out['allow_note_sharing'] ?? 1);
        $out['logo_display'] = in_array($out['logo_display'], ['logo', 'logo_name', 'name'], true) ? $out['logo_display'] : 'logo';
        $out['logo_height'] = max(16, min(120, (int) ($out['logo_height'] ?: 34)));
        $out['logo_max_width'] = max(40, min(240, (int) ($out['logo_max_width'] ?: 180)));
        $out['login_logo_height'] = max(20, min(160, (int) ($out['login_logo_height'] ?: 48)));
        return $out;
    }

    /** SMTP configuration: config.php overrides database values when smtp.host is set there. */
    public static function smtp(): array
    {
        $cfg = (array) Config::get('smtp', []);
        if (!empty($cfg['host'])) {
            return [
                'host' => (string) $cfg['host'],
                'port' => (int) ($cfg['port'] ?? 587),
                'username' => (string) ($cfg['username'] ?? ''),
                'password' => (string) ($cfg['password'] ?? ''),
                'encryption' => (string) ($cfg['encryption'] ?? 'tls'),
                'from_name' => (string) ($cfg['from_name'] ?? self::get('app_name', 'SmartNotes')),
                'from_email' => (string) ($cfg['from_email'] ?? ($cfg['username'] ?? '')),
                'source' => 'config',
            ];
        }
        return [
            'host' => (string) self::get('smtp_host', ''),
            'port' => self::int('smtp_port', 587),
            'username' => (string) self::get('smtp_username', ''),
            'password' => (string) self::get('smtp_password', ''),
            'encryption' => (string) self::get('smtp_encryption', 'tls'),
            'from_name' => (string) self::get('smtp_from_name', self::get('app_name', 'SmartNotes')),
            'from_email' => (string) self::get('smtp_from_email', ''),
            'source' => 'database',
        ];
    }
}
