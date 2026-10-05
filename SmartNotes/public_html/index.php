<?php
/**
 * SmartNotes — single page application shell.
 */
declare(strict_types=1);

require __DIR__ . '/app/bootstrap.php';

if (!Config::isInstalled()) {
    header('Location: install/');
    exit;
}

$branding = ['app_name' => 'SmartNotes', 'favicon_url' => null, 'default_theme' => 'system'];
try {
    $branding = Settings::publicBranding();
} catch (Throwable $e) {
    error_log('[SmartNotes] ' . $e->getMessage());
}

$debug = (bool) Config::get('app.debug', false);
$dist = SN_ROOT . '/assets/dist/main.js';
$useDist = !$debug && is_file($dist);
$ver = SN_VERSION . '-' . substr(md5((string) @filemtime($useDist ? $dist : SN_ROOT . '/assets/js/main.js')), 0, 8);
$css = $useDist && is_file(SN_ROOT . '/assets/dist/app.css') ? 'assets/dist/app.css' : 'assets/css/app.css';
$js = $useDist ? 'assets/dist/main.js' : 'assets/js/main.js';

header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: camera=(), geolocation=(), microphone=(self)');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
header('Cache-Control: no-cache');
if (is_https()) {
    header('Strict-Transport-Security: max-age=31536000');
}
$theme = in_array($branding['default_theme'] ?? '', ['light', 'dark'], true) ? $branding['default_theme'] : '';
?><!doctype html>
<html lang="en"<?= $theme ? ' data-theme="' . e($theme) . '"' : '' ?>>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f5f6f8">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title><?= e((string) $branding['app_name']) ?></title>
<link rel="icon" href="<?= !empty($branding['favicon_url']) ? e((string) $branding['favicon_url']) : 'data:image/svg+xml,' . rawurlencode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="' . (V::color($branding['default_accent'] ?? '') ?? '#6366f1') . '"/></svg>') ?>">
<link rel="preload" href="assets/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="<?= e($css) ?>?v=<?= e($ver) ?>">
<script type="module" src="<?= e($js) ?>?v=<?= e($ver) ?>"></script>
</head>
<body>
<div id="boot" class="boot" aria-hidden="true"><div class="boot-mark"></div></div>
<div id="app"></div>
<noscript><p style="padding:40px;font-family:sans-serif">SmartNotes requires JavaScript. Please enable it in your browser.</p></noscript>
</body>
</html>
