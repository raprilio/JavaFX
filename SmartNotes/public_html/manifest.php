<?php
/**
 * Web app manifest (v1.15): "Add to Home screen" on Android opens SmartNotes full screen, like an installed app.
 * Served by PHP so the name and colours follow Admin → Branding (.json files are blocked by .htaccess).
 */
declare(strict_types=1);

require __DIR__ . '/app/bootstrap.php';

$b = ['app_name' => 'SmartNotes', 'default_accent' => '#6366f1', 'favicon_url' => null];
if (Config::isInstalled()) {
    try {
        $b = Settings::publicBranding();
    } catch (Throwable $e) {
        error_log('[SmartNotes] manifest: ' . $e->getMessage());
    }
}
$name = (string) ($b['app_name'] ?: 'SmartNotes');
$accent = V::color($b['default_accent'] ?? '') ?? '#6366f1';
$v = substr(md5($name . $accent . ($b['favicon_url'] ?? '')), 0, 8);
$icons = [];
foreach ([192, 512] as $s) {
    $icons[] = ['src' => "icon.php?s=$s&v=$v", 'sizes' => "{$s}x{$s}", 'type' => 'image/png', 'purpose' => 'any'];
    $icons[] = ['src' => "icon.php?s=$s&m=1&v=$v", 'sizes' => "{$s}x{$s}", 'type' => 'image/png', 'purpose' => 'maskable'];
}

header('Content-Type: application/manifest+json; charset=utf-8');
header('Cache-Control: public, max-age=3600');
echo json_encode([
    'id' => './',
    'name' => $name,
    'short_name' => mb_strlen($name) > 12 ? mb_substr($name, 0, 12) : $name,
    'description' => 'Notes, tasks, calendar, files and mail',
    'start_url' => './#/',
    'scope' => './',
    // Full screen first (no status bar), standalone where full screen is not supported.
    'display' => 'fullscreen',
    'display_override' => ['fullscreen', 'standalone'],
    'orientation' => 'any',
    'background_color' => '#f5f6f8',
    'theme_color' => $accent,
    'icons' => $icons,
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
