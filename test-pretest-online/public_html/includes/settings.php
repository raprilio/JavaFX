<?php
/**
 * Pengaturan aplikasi (tabel `settings`), migrasi skema otomatis,
 * branding (nama, logo, warna), saklar modul, dan log aktivitas.
 */
declare(strict_types=1);

const SCHEMA_VERSION = 2;

const SETTING_DEFAULTS = [
    'app_name'                 => 'SiTes Dukcapil',
    'app_tagline'              => 'Sistem Test & Pre-Test Online',
    'institution_name'         => 'Dinas Kependudukan dan Pencatatan Sipil',
    'institution_region'       => 'Kabupaten / Kota',
    'logo'                     => '',
    'logo_plate'               => '0',
    'login_wallpaper'          => '',
    'wallpaper_overlay'        => '55',
    'wallpaper_sidebar'        => '0',
    'primary_color'            => '#2f6bff',
    'accent_color'             => '#d4a72c',
    'pretest_enabled'          => '1',
    'test_enabled'             => '1',
    'anti_cheat'               => '1',
    'announcement'             => '',
    'login_message'            => 'Platform uji pengetahuan Administrasi Kependudukan dan Pencatatan Sipil bagi aparatur Dukcapil.',
    'certificate_enabled'      => '1',
    'certificate_signer_name'  => '',
    'certificate_signer_title' => 'Kepala Dinas',
    'footer_text'              => '',
    'app_secret'               => '',
    'schema_version'           => '0',
];

/** Semua pengaturan (dengan default). $reset = true memuat ulang dari DB. */
function settings_all(bool $reset = false): array
{
    static $cache = null;
    if ($cache !== null && !$reset) {
        return $cache;
    }
    try {
        $rows = q_all('SELECT setting_key, setting_value FROM settings');
    } catch (PDOException $e) {
        if ($e->getCode() !== '42S02') { // 42S02 = tabel belum ada
            throw $e;
        }
        run_migrations();
        $rows = q_all('SELECT setting_key, setting_value FROM settings');
    }
    $s = SETTING_DEFAULTS;
    foreach ($rows as $r) {
        $s[$r['setting_key']] = (string) $r['setting_value'];
    }
    if ((int) $s['schema_version'] < SCHEMA_VERSION) {
        run_migrations();
        return settings_all(true);
    }
    if ($s['app_secret'] === '') {
        $s['app_secret'] = bin2hex(random_bytes(32));
        save_settings(['app_secret' => $s['app_secret']]);
    }
    return $cache = $s;
}

function setting(string $key): string
{
    return settings_all()[$key] ?? (SETTING_DEFAULTS[$key] ?? '');
}

function setting_on(string $key): bool
{
    return setting($key) === '1';
}

function save_settings(array $values): void
{
    $st = db()->prepare(
        'INSERT INTO settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = VALUES(updated_at)'
    );
    foreach ($values as $k => $v) {
        $st->execute([$k, (string) $v, now()]);
    }
}

function column_exists(string $table, string $column): bool
{
    return (int) q_val(
        'SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [$table, $column]
    ) > 0;
}

/**
 * Migrasi idempoten. Instalasi lama (schema v1) otomatis di-upgrade saat
 * halaman pertama kali dibuka — tidak perlu import SQL ulang.
 */
function run_migrations(): void
{
    $pdo = db();
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS settings (
            setting_key   VARCHAR(64) NOT NULL,
            setting_value TEXT NULL,
            updated_at    DATETIME NULL,
            PRIMARY KEY (setting_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS activity_logs (
            id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id     INT UNSIGNED NULL,
            action      VARCHAR(50) NOT NULL,
            description VARCHAR(500) NULL,
            ip_address  VARCHAR(45) NULL,
            created_at  DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY idx_log_created (created_at),
            KEY idx_log_user (user_id),
            KEY idx_log_action (action)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    if (!column_exists('exam_attempts', 'tab_switches')) {
        $pdo->exec('ALTER TABLE exam_attempts ADD COLUMN tab_switches INT UNSIGNED NOT NULL DEFAULT 0 AFTER status');
    }
    save_settings(['schema_version' => SCHEMA_VERSION]);
}

/* ------------------------------------------------------------------ */
/*  Branding                                                           */
/* ------------------------------------------------------------------ */

function app_name(): string
{
    return setting('app_name') ?: APP_NAME;
}

function app_tagline(): string
{
    return setting('app_tagline');
}

function institution_full(): string
{
    return trim(setting('institution_name') . ' ' . setting('institution_region'));
}

function app_logo_url(): string
{
    $logo = setting('logo');
    if ($logo !== '' && preg_match('/^logo-[a-f0-9]{16}\.(png|jpg|webp)$/', $logo) && is_file(APP_ROOT . '/uploads/branding/' . $logo)) {
        return url('uploads/branding/' . $logo);
    }
    return url('assets/images/logo.svg');
}

/** Kelas CSS logo: tanpa latar (PNG transparan tampil apa adanya) atau dengan plat putih. */
function logo_class(string $base = 'brand-logo'): string
{
    return $base . (setting_on('logo_plate') ? ' logo-plate' : '');
}

/** Logo lebar (wordmark, rasio >= 1.8:1) disusun di atas nama aplikasi pada sidebar. */
function logo_is_wide(): bool
{
    static $wide = null;
    if ($wide === null) {
        $p = app_logo_path();
        $d = $p ? @getimagesize($p) : false;
        $wide = $d !== false && $d[1] > 0 && $d[0] / $d[1] >= 1.8;
    }
    return $wide;
}

function app_wallpaper_url(): ?string
{
    $w = setting('login_wallpaper');
    if ($w !== '' && preg_match('/^wall-[a-f0-9]{16}\.(png|jpg|webp)$/', $w) && is_file(APP_ROOT . '/uploads/branding/' . $w)) {
        return url('uploads/branding/' . $w);
    }
    return null;
}

/** Kelas <body> untuk fitur branding (wallpaper login / sidebar). */
function branding_body_classes(): string
{
    $c = [];
    if (app_wallpaper_url()) {
        $c[] = 'has-wallpaper';
        if (setting_on('wallpaper_sidebar')) {
            $c[] = 'sidebar-wallpaper';
        }
    }
    return implode(' ', $c);
}

function app_logo_path(): ?string
{
    $logo = setting('logo');
    $p = APP_ROOT . '/uploads/branding/' . $logo;
    return ($logo !== '' && is_file($p)) ? $p : null;
}

function valid_hex_color(string $c, string $fallback): string
{
    return preg_match('/^#[0-9a-fA-F]{6}$/', $c) ? strtolower($c) : $fallback;
}

function hex_to_rgb(string $hex): string
{
    $hex = ltrim($hex, '#');
    return implode(', ', array_map('hexdec', str_split($hex, 2)));
}

/** CSS variabel tema dari pengaturan admin. */
function theme_css(): string
{
    $p = valid_hex_color(setting('primary_color'), '#2f6bff');
    $a = valid_hex_color(setting('accent_color'), '#d4a72c');
    return ':root{--blue:' . $p . ';--bs-primary:' . $p . ';--bs-primary-rgb:' . hex_to_rgb($p)
        . ';--bs-link-color:' . $p . ';--bs-link-color-rgb:' . hex_to_rgb($p)
        . ';--primary-rgb:' . hex_to_rgb($p) . ';--gold:' . $a . ';--accent-rgb:' . hex_to_rgb($a)
        . (($w = app_wallpaper_url()) !== null
            ? ";--wallpaper:url('" . str_replace(["'", '\\', '(', ')'], '', $w) . "');--wall-ov:" . (max(0, min(90, (int) setting('wallpaper_overlay'))) / 100)
            : '')
        . '}';
}

/* ------------------------------------------------------------------ */
/*  Saklar modul (hanya admin yang dapat mengubah)                     */
/* ------------------------------------------------------------------ */

function exam_type_enabled(string $type): bool
{
    return setting_on($type === 'test' ? 'test_enabled' : 'pretest_enabled');
}

/** Daftar jenis ujian yang sedang diaktifkan admin. */
function enabled_exam_types(): array
{
    return array_values(array_filter(['pretest', 'test'], 'exam_type_enabled'));
}

/* ------------------------------------------------------------------ */
/*  Log aktivitas                                                      */
/* ------------------------------------------------------------------ */

function log_activity(string $action, string $description = '', ?int $userId = null): void
{
    try {
        if ($userId === null) {
            $u = current_user();
            $userId = $u ? (int) $u['id'] : null;
        }
        q(
            'INSERT INTO activity_logs (user_id, action, description, ip_address, created_at) VALUES (?, ?, ?, ?, ?)',
            [$userId, mb_substr($action, 0, 50), mb_substr($description, 0, 500), client_ip(), now()]
        );
        if (random_int(1, 200) === 1) {
            q('DELETE FROM activity_logs WHERE created_at < ?', [date('Y-m-d H:i:s', strtotime('-180 days'))]);
        }
    } catch (Throwable $e) {
        error_log('[ExamPro] log_activity: ' . $e->getMessage()); // log tidak boleh menggagalkan proses utama
    }
}

/* ------------------------------------------------------------------ */
/*  Sertifikat Pre-Test                                                */
/* ------------------------------------------------------------------ */

function certificate_code(int $attemptId): string
{
    $sig = strtoupper(substr(hash_hmac('sha256', 'cert:' . $attemptId, setting('app_secret')), 0, 10));
    return 'CERT-' . $attemptId . '-' . $sig;
}

function certificate_verify(string $code): ?int
{
    if (!preg_match('/^CERT-(\d+)-([A-F0-9]{10})$/', strtoupper(trim($code)), $m)) {
        return null;
    }
    return hash_equals(certificate_code((int) $m[1]), strtoupper(trim($code))) ? (int) $m[1] : null;
}
