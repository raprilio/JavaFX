<?php
declare(strict_types=1);

defined('SN_APP') || exit;

function now(): string
{
    return date('Y-m-d H:i:s');
}

function today(): string
{
    return date('Y-m-d');
}

function client_ip(): string
{
    // Only trust REMOTE_ADDR by default; proxies can be enabled in config.
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    if (Config::get('app.trust_proxy', false)) {
        foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP'] as $h) {
            if (!empty($_SERVER[$h])) {
                $cand = trim(explode(',', (string) $_SERVER[$h])[0]);
                if (filter_var($cand, FILTER_VALIDATE_IP)) {
                    return $cand;
                }
            }
        }
    }
    return substr((string) $ip, 0, 45);
}

function user_agent(): string
{
    return mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);
}

function is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    if ((int) ($_SERVER['SERVER_PORT'] ?? 0) === 443) {
        return true;
    }
    return Config::get('app.trust_proxy', false)
        && strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

/** Web base path of the app, e.g. "/" or "/smartnotes/". */
function base_path(): string
{
    $script = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php'));
    $dir = dirname($script);
    // Entry points live in /, /api, /install
    if (preg_match('#/(api|install)$#', $dir)) {
        $dir = dirname($dir);
    }
    $dir = rtrim($dir, '/');
    return $dir . '/';
}

/** Absolute app URL used in e-mails (configurable for CLI cron). */
function app_url(): string
{
    $url = (string) Config::get('app.url', '');
    if ($url === '') {
        $url = (string) Settings::get('app_url', '');
    }
    if ($url === '' && PHP_SAPI !== 'cli' && !empty($_SERVER['HTTP_HOST'])) {
        $url = (is_https() ? 'https://' : 'http://') . $_SERVER['HTTP_HOST'] . base_path();
    }
    return rtrim($url, '/') . '/';
}

function e(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function random_key(int $bytes = 32): string
{
    return bin2hex(random_bytes($bytes));
}

function json_decode_array(?string $json): array
{
    if ($json === null || $json === '') {
        return [];
    }
    $d = json_decode($json, true);
    return is_array($d) ? $d : [];
}

function format_bytes(int|float $bytes): string
{
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $i = 0;
    while ($bytes >= 1024 && $i < count($units) - 1) {
        $bytes /= 1024;
        $i++;
    }
    return round($bytes, $i ? 1 : 0) . ' ' . $units[$i];
}

function dir_size(string $dir): int
{
    if (!is_dir($dir)) {
        return 0;
    }
    $size = 0;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if ($f->isFile()) {
            $size += $f->getSize();
        }
    }
    return $size;
}

/** Ensure a directory exists and contains an index guard. */
function ensure_dir(string $dir): void
{
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
}
