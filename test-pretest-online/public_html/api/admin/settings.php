<?php
/**
 * POST action=save           — simpan pengaturan umum (+ upload logo)
 * POST action=toggle_module  {type: pretest|test, enabled: 0|1}
 * POST action=remove_logo | remove_wallpaper
 */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

require_method('POST');
verify_csrf();

function delete_branding_file(string $key, string $prefix): void
{
    $old = setting($key);
    if ($old !== '' && preg_match('/^' . $prefix . '-[a-f0-9]{16}\.(png|jpg|webp)$/', $old)) {
        @unlink(APP_ROOT . '/uploads/branding/' . $old);
    }
}

/**
 * Upload gambar branding (PNG / JPG / WEBP — SVG ditolak karena dapat berisi script).
 * @return string|null nama file baru, null jika tidak ada file
 */
function upload_branding_image(string $field, string $prefix, int $maxBytes, int $minW, int $minH, string $label): ?string
{
    if (empty($_FILES[$field]['tmp_name']) || ($_FILES[$field]['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return null;
    }
    $f = $_FILES[$field];
    if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE) {
        json_error("Ukuran $label melebihi batas upload server.", 422);
    }
    if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) {
        json_error("Upload $label gagal.", 422);
    }
    if ($f['size'] > $maxBytes) {
        json_error("Ukuran $label maksimal " . round($maxBytes / 1048576, 1) . ' MB.', 422);
    }
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
    $ext = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'][$mime] ?? null;
    $dim = @getimagesize($f['tmp_name']);
    if (!$ext || $dim === false) {
        json_error("Format $label harus PNG, JPG, atau WEBP.", 422);
    }
    if ($dim[0] < $minW || $dim[1] < $minH) {
        json_error("Resolusi $label minimal {$minW}×{$minH} piksel.", 422);
    }
    $dir = APP_ROOT . '/uploads/branding';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $name = $prefix . '-' . bin2hex(random_bytes(8)) . '.' . $ext;
    if (!move_uploaded_file($f['tmp_name'], "$dir/$name")) {
        json_error("Gagal menyimpan $label.", 500);
    }
    return $name;
}

switch (admin_action()) {
    case 'toggle_module':
        $type = in_str('type') === 'test' ? 'test' : 'pretest';
        $on = in_int('enabled') ? '1' : '0';
        save_settings([$type . '_enabled' => $on]);
        $label = $type === 'test' ? 'Test' : 'Pre-Test';
        log_activity('module_toggle', $label . ($on === '1' ? ' diaktifkan' : ' dinonaktifkan'));
        json_out(['ok' => true, 'enabled' => $on === '1', 'message' => $label . ($on === '1' ? ' diaktifkan untuk peserta.' : ' dinonaktifkan — peserta tidak dapat melihat atau memulai ' . $label . '.')]);

    case 'remove_logo':
        delete_branding_file('logo', 'logo');
        save_settings(['logo' => '']);
        log_activity('settings', 'Menghapus logo aplikasi');
        json_out(['ok' => true, 'message' => 'Logo dihapus, kembali ke logo default.', 'logo_url' => app_logo_url()]);

    case 'remove_wallpaper':
        delete_branding_file('login_wallpaper', 'wall');
        save_settings(['login_wallpaper' => '']);
        log_activity('settings', 'Menghapus wallpaper login');
        json_out(['ok' => true, 'message' => 'Wallpaper dihapus, kembali ke latar bawaan.']);

    case 'save':
        $text = [
            'app_name'                 => [3, 60],
            'app_tagline'              => [0, 120],
            'institution_name'         => [3, 150],
            'institution_region'       => [0, 120],
            'login_message'            => [0, 300],
            'announcement'             => [0, 1000],
            'footer_text'              => [0, 200],
            'certificate_signer_name'  => [0, 120],
            'certificate_signer_title' => [0, 120],
        ];
        $values = [];
        foreach ($text as $key => [$min, $max]) {
            $v = trim(preg_replace('/[\x00-\x09\x0B-\x1F\x7F]/u', '', in_str($key)) ?? '');
            if (mb_strlen($v) < $min) {
                json_error('Kolom "' . str_replace('_', ' ', $key) . '" minimal ' . $min . ' karakter.', 422);
            }
            $values[$key] = mb_substr($v, 0, $max);
        }
        $values['primary_color'] = valid_hex_color(in_str('primary_color'), SETTING_DEFAULTS['primary_color']);
        $values['accent_color'] = valid_hex_color(in_str('accent_color'), SETTING_DEFAULTS['accent_color']);
        foreach (['pretest_enabled', 'test_enabled', 'anti_cheat', 'certificate_enabled'] as $k) {
            $values[$k] = in_int($k) ? '1' : '0';
        }

        $values['logo_plate'] = in_int('logo_plate') ? '1' : '0';
        $values['wallpaper_sidebar'] = in_int('wallpaper_sidebar') ? '1' : '0';
        $values['wallpaper_overlay'] = (string) max(0, min(90, in_int('wallpaper_overlay', 55)));

        if (($logo = upload_branding_image('logo', 'logo', 2 * 1024 * 1024, 64, 64, 'logo')) !== null) {
            delete_branding_file('logo', 'logo');
            $values['logo'] = $logo;
        }
        if (($wall = upload_branding_image('wallpaper', 'wall', 4 * 1024 * 1024, 800, 500, 'wallpaper')) !== null) {
            delete_branding_file('login_wallpaper', 'wall');
            $values['login_wallpaper'] = $wall;
        }

        save_settings($values);
        settings_all(true);
        log_activity('settings', 'Memperbarui pengaturan aplikasi' . (isset($values['logo']) ? ' (logo baru)' : '') . (isset($values['login_wallpaper']) ? ' (wallpaper baru)' : ''));
        json_out(['ok' => true, 'message' => 'Pengaturan disimpan.', 'logo_url' => app_logo_url()]);

    default:
        json_error('Aksi tidak dikenal.');
}
