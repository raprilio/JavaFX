<?php
/**
 * App icon for the home screen (v1.15): PNG at 180 / 192 / 512 px. Uses the favicon from Admin → Branding when
 * there is one, otherwise a note glyph on the accent colour. ?m=1 = maskable (full bleed, glyph in the safe zone).
 */
declare(strict_types=1);

require __DIR__ . '/app/bootstrap.php';

$size = in_array((int) ($_GET['s'] ?? 192), [180, 192, 512], true) ? (int) $_GET['s'] : 192;
$maskable = ($_GET['m'] ?? '') === '1';
$b = ['default_accent' => '#6366f1', 'favicon_url' => null];
$fav = null;
if (Config::isInstalled()) {
    try {
        $b = Settings::publicBranding();
        $fav = Settings::get('favicon_path');
    } catch (Throwable $e) {
        error_log('[SmartNotes] icon: ' . $e->getMessage());
    }
}
$hex = ltrim(V::color($b['default_accent'] ?? '') ?? '#6366f1', '#');
[$r, $g, $bl] = [hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2))];

if (!function_exists('imagecreatetruecolor')) {
    header('Content-Type: image/svg+xml');
    echo '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#' . $hex . '"/></svg>';
    exit;
}

// Draw at 4× and scale down: GD has no anti-aliasing for filled shapes.
$S = $size * 4;
$im = imagecreatetruecolor($S, $S);
imagesavealpha($im, true);
imagealphablending($im, true);
imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));
$bg = imagecolorallocate($im, $r, $g, $bl);
$roundRect = static function ($im, int $x1, int $y1, int $x2, int $y2, int $rad, int $col): void {
    imagefilledrectangle($im, $x1 + $rad, $y1, $x2 - $rad, $y2, $col);
    imagefilledrectangle($im, $x1, $y1 + $rad, $x2, $y2 - $rad, $col);
    foreach ([[$x1 + $rad, $y1 + $rad], [$x2 - $rad, $y1 + $rad], [$x1 + $rad, $y2 - $rad], [$x2 - $rad, $y2 - $rad]] as [$cx, $cy]) {
        imagefilledellipse($im, $cx, $cy, $rad * 2, $rad * 2, $col);
    }
};
if ($maskable) {
    imagefilledrectangle($im, 0, 0, $S, $S, $bg);
} else {
    $roundRect($im, 0, 0, $S - 1, $S - 1, (int) ($S * 0.22), $bg);
}
// Content area: the maskable safe zone is the centre 80 % circle.
$box = (int) ($S * ($maskable ? 0.5 : 0.6));
$x0 = (int) (($S - $box) / 2);
$y0 = $x0;
$logo = null;
if ($fav && is_file($p = Uploader::absolute($fav))) {
    $data = @file_get_contents($p);
    $logo = $data !== false ? @imagecreatefromstring($data) : null;
}
if ($logo) {
    $lw = imagesx($logo);
    $lh = imagesy($logo);
    $k = min($box / $lw, $box / $lh);
    imagecopyresampled($im, $logo, (int) (($S - $lw * $k) / 2), (int) (($S - $lh * $k) / 2), 0, 0, (int) ($lw * $k), (int) ($lh * $k), $lw, $lh);
    imagedestroy($logo);
} else {
    // A page with a folded corner and three lines.
    $white = imagecolorallocate($im, 255, 255, 255);
    $w = (int) ($box * 0.78);
    $px = (int) (($S - $w) / 2);
    $roundRect($im, $px, $y0, $px + $w, $y0 + $box, (int) ($box * 0.1), $white);
    $line = imagecolorallocate($im, $r, $g, $bl);
    $t = max(4, (int) ($box * 0.07));
    foreach ([0.36, 0.53, 0.70] as $i => $f) {
        $ly = $y0 + (int) ($box * $f);
        $roundRect($im, $px + (int) ($w * 0.17), $ly, $px + (int) ($w * ($i === 2 ? 0.6 : 0.83)), $ly + $t, (int) ($t / 2), $line);
    }
}
$out = imagecreatetruecolor($size, $size);
imagesavealpha($out, true);
imagealphablending($out, false);
imagefill($out, 0, 0, imagecolorallocatealpha($out, 0, 0, 0, 127));
imagealphablending($out, true);
imagecopyresampled($out, $im, 0, 0, 0, 0, $size, $size, $S, $S);
header('Content-Type: image/png');
header('Cache-Control: public, max-age=86400');
imagepng($out, null, 6);
