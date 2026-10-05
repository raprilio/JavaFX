<?php
/**
 * POST action=save           — simpan pengaturan umum (+ upload logo)
 * POST action=toggle_module  {type: pretest|test, enabled: 0|1}
 * POST action=remove_logo
 */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

require_method('POST');
verify_csrf();

function delete_logo_file(): void
{
    $old = setting('logo');
    if ($old !== '' && preg_match('/^logo-[a-f0-9]{16}\.(png|jpg|webp)$/', $old)) {
        @unlink(APP_ROOT . '/uploads/branding/' . $old);
    }
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
        delete_logo_file();
        save_settings(['logo' => '']);
        log_activity('settings', 'Menghapus logo aplikasi');
        json_out(['ok' => true, 'message' => 'Logo dihapus, kembali ke logo default.', 'logo_url' => app_logo_url()]);

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

        // Upload logo (PNG / JPG / WEBP — SVG ditolak karena dapat berisi script)
        if (!empty($_FILES['logo']['tmp_name']) && ($_FILES['logo']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
            $f = $_FILES['logo'];
            if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) {
                json_error('Upload logo gagal.', 422);
            }
            if ($f['size'] > 1024 * 1024) {
                json_error('Ukuran logo maksimal 1 MB.', 422);
            }
            $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
            $ext = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'][$mime] ?? null;
            $dim = @getimagesize($f['tmp_name']);
            if (!$ext || $dim === false) {
                json_error('Format logo harus PNG, JPG, atau WEBP.', 422);
            }
            if ($dim[0] < 64 || $dim[1] < 64) {
                json_error('Resolusi logo minimal 64×64 piksel (disarankan 512×512, latar transparan).', 422);
            }
            $dir = APP_ROOT . '/uploads/branding';
            if (!is_dir($dir)) {
                mkdir($dir, 0755, true);
            }
            $name = 'logo-' . bin2hex(random_bytes(8)) . '.' . $ext;
            if (!move_uploaded_file($f['tmp_name'], "$dir/$name")) {
                json_error('Gagal menyimpan logo.', 500);
            }
            delete_logo_file();
            $values['logo'] = $name;
        }

        save_settings($values);
        settings_all(true);
        log_activity('settings', 'Memperbarui pengaturan aplikasi' . (isset($values['logo']) ? ' (logo baru)' : ''));
        json_out(['ok' => true, 'message' => 'Pengaturan disimpan.', 'logo_url' => app_logo_url()]);

    default:
        json_error('Aksi tidak dikenal.');
}
