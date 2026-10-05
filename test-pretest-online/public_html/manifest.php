<?php
/** Web App Manifest dinamis (nama & logo mengikuti Pengaturan). */
declare(strict_types=1);
require_once __DIR__ . '/includes/functions.php';

header('Content-Type: application/manifest+json; charset=utf-8');
header('Cache-Control: public, max-age=3600');
$logo = app_logo_url();
$ext = strtolower(pathinfo(parse_url($logo, PHP_URL_PATH) ?: '', PATHINFO_EXTENSION));
$mime = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'webp' => 'image/webp', 'svg' => 'image/svg+xml'][$ext] ?? 'image/png';
echo json_encode([
    'name'             => app_name() . ' — ' . setting('institution_name'),
    'short_name'       => mb_substr(app_name(), 0, 12),
    'description'      => app_tagline(),
    'start_url'        => url('index.php'),
    'scope'            => base_path() . '/',
    'display'          => 'standalone',
    'background_color' => '#0b1b3f',
    'theme_color'      => '#0b1b3f',
    'icons'            => [
        ['src' => $logo, 'sizes' => 'any', 'type' => $mime, 'purpose' => 'any'],
    ],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
