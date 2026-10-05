<?php
/**
 * Bootstrap aplikasi + helper umum.
 * Setiap halaman/endpoint cukup me-require file ini (langsung atau via auth.php).
 */
declare(strict_types=1);

if (!defined('APP_ROOT')) {
    define('APP_ROOT', dirname(__DIR__));
}

require_once APP_ROOT . '/config/database.php';

date_default_timezone_set(APP_TIMEZONE);
error_reporting(E_ALL);
ini_set('display_errors', APP_DEBUG ? '1' : '0');
ini_set('log_errors', '1');

if (!headers_sent()) {
    header('X-Frame-Options: SAMEORIGIN');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
}

/* ------------------------------------------------------------------ */
/*  Error handling                                                     */
/* ------------------------------------------------------------------ */

function is_api_request(): bool
{
    return defined('API_REQUEST') && API_REQUEST === true;
}

set_exception_handler(function (Throwable $e): void {
    error_log('[ExamPro] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
    }
    $msg = APP_DEBUG ? $e->getMessage() : 'Terjadi kesalahan pada server. Silakan coba lagi.';
    if (is_api_request()) {
        if (!headers_sent()) {
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode(['ok' => false, 'message' => $msg]);
    } else {
        echo '<!doctype html><meta charset="utf-8"><title>Error</title>'
            . '<div style="font-family:system-ui;max-width:560px;margin:80px auto;padding:24px;border-radius:12px;background:#fff1f1;color:#7a1c1c">'
            . '<h3 style="margin-top:0">Oops!</h3><p>' . htmlspecialchars($msg) . '</p></div>';
    }
    exit;
});

/* ------------------------------------------------------------------ */
/*  Database                                                           */
/* ------------------------------------------------------------------ */

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', DB_HOST, DB_PORT, DB_NAME);
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        // Samakan zona waktu MySQL dengan PHP agar CURRENT_TIMESTAMP konsisten
        $pdo->exec("SET time_zone = '" . date('P') . "'");
    }
    return $pdo;
}

function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

function q_row(string $sql, array $params = []): ?array
{
    $row = q($sql, $params)->fetch();
    return $row === false ? null : $row;
}

function q_all(string $sql, array $params = []): array
{
    return q($sql, $params)->fetchAll();
}

function q_val(string $sql, array $params = [])
{
    $v = q($sql, $params)->fetchColumn();
    return $v === false ? null : $v;
}

/** Placeholder "?, ?, ?" untuk klausa IN */
function in_placeholders(array $items): string
{
    return implode(',', array_fill(0, max(1, count($items)), '?'));
}

/* ------------------------------------------------------------------ */
/*  Session                                                            */
/* ------------------------------------------------------------------ */

function app_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? '') === '443')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_name(SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => base_path() === '' ? '/' : base_path() . '/',
        'secure'   => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();

    // Idle timeout
    $now = time();
    if (isset($_SESSION['last_activity']) && ($now - (int) $_SESSION['last_activity']) > SESSION_IDLE_TIMEOUT) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
    $_SESSION['last_activity'] = $now;
}

/* ------------------------------------------------------------------ */
/*  URL helpers                                                        */
/* ------------------------------------------------------------------ */

function base_path(): string
{
    static $base = null;
    if ($base !== null) {
        return $base;
    }
    if (BASE_URL !== '') {
        return $base = rtrim(BASE_URL, '/');
    }
    $root   = str_replace('\\', '/', (string) realpath(APP_ROOT));
    $script = str_replace('\\', '/', (string) realpath($_SERVER['SCRIPT_FILENAME'] ?? ''));
    $rel    = trim(substr(dirname($script), strlen($root)), '/');
    $depth  = $rel === '' ? 0 : substr_count($rel, '/') + 1;

    $dir = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/'));
    for ($i = 0; $i < $depth; $i++) {
        $dir = str_replace('\\', '/', dirname($dir));
    }
    return $base = rtrim($dir, '/');
}

function url(string $path = ''): string
{
    return base_path() . '/' . ltrim($path, '/');
}

function asset(string $path): string
{
    $file = APP_ROOT . '/assets/' . ltrim($path, '/');
    $v = is_file($file) ? (string) filemtime($file) : '1';
    return url('assets/' . ltrim($path, '/')) . '?v=' . $v;
}

function redirect(string $path): void
{
    $target = preg_match('#^https?://#', $path) ? $path : url($path);
    header('Location: ' . $target);
    exit;
}

/* ------------------------------------------------------------------ */
/*  Output helpers                                                     */
/* ------------------------------------------------------------------ */

function e($value): string
{
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function nl2br_e($value): string
{
    return nl2br(e($value));
}

function json_out(array $data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error(string $message, int $code = 400, array $extra = []): void
{
    json_out(array_merge(['ok' => false, 'message' => $message], $extra), $code);
}

/** JSON aman untuk disisipkan ke dalam <script> */
function js_json($data): string
{
    return json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE);
}

/** Gabungan $_POST + body JSON */
function input(): array
{
    static $data = null;
    if ($data !== null) {
        return $data;
    }
    $data = $_POST;
    $ctype = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ctype, 'application/json') !== false) {
        $json = json_decode((string) file_get_contents('php://input'), true);
        if (is_array($json)) {
            $data = array_merge($data, $json);
        }
    }
    return $data;
}

function in_str(string $key, string $default = ''): string
{
    $v = input()[$key] ?? $default;
    return is_scalar($v) ? trim((string) $v) : $default;
}

function in_int(string $key, int $default = 0): int
{
    $v = input()[$key] ?? $default;
    return is_numeric($v) ? (int) $v : $default;
}

function get_str(string $key, string $default = ''): string
{
    $v = $_GET[$key] ?? $default;
    return is_scalar($v) ? trim((string) $v) : $default;
}

function get_int(string $key, int $default = 0): int
{
    $v = $_GET[$key] ?? $default;
    return is_numeric($v) ? (int) $v : $default;
}

function require_method(string $method): void
{
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== strtoupper($method)) {
        if (is_api_request()) {
            json_error('Method not allowed', 405);
        }
        http_response_code(405);
        exit('Method not allowed');
    }
}

/* ------------------------------------------------------------------ */
/*  CSRF                                                               */
/* ------------------------------------------------------------------ */

function csrf_token(): string
{
    app_session_start();
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf_token" value="' . e(csrf_token()) . '">';
}

function verify_csrf(): void
{
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? (input()['csrf_token'] ?? '');
    if (!is_string($sent) || !hash_equals(csrf_token(), $sent)) {
        if (is_api_request()) {
            json_error('Sesi tidak valid (CSRF). Muat ulang halaman.', 419);
        }
        http_response_code(419);
        exit('Sesi tidak valid. Silakan muat ulang halaman.');
    }
}

/* ------------------------------------------------------------------ */
/*  Flash message                                                      */
/* ------------------------------------------------------------------ */

function flash(string $type, string $message): void
{
    app_session_start();
    $_SESSION['flash'][] = ['type' => $type, 'message' => $message];
}

function take_flash(): array
{
    app_session_start();
    $f = $_SESSION['flash'] ?? [];
    unset($_SESSION['flash']);
    return $f;
}

/* ------------------------------------------------------------------ */
/*  Auth core                                                          */
/* ------------------------------------------------------------------ */

function current_user(): ?array
{
    static $user = false;
    if ($user !== false) {
        return $user;
    }
    app_session_start();
    $uid = (int) ($_SESSION['uid'] ?? 0);
    if ($uid <= 0) {
        return $user = null;
    }
    $row = q_row('SELECT id, name, username, email, role, department, position, status FROM users WHERE id = ?', [$uid]);
    if (!$row || $row['status'] !== 'active') {
        logout_user();
        return $user = null;
    }
    return $user = $row;
}

function is_admin(): bool
{
    $u = current_user();
    return $u !== null && $u['role'] === 'admin';
}

function login_user(array $user): void
{
    app_session_start();
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $user['id'];
    $_SESSION['role'] = $user['role'];
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    q('UPDATE users SET last_login_at = ? WHERE id = ?', [now(), $user['id']]);
}

function logout_user(): void
{
    app_session_start();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}

function client_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'), 0, 45);
}

/* ------------------------------------------------------------------ */
/*  Date & format                                                      */
/* ------------------------------------------------------------------ */

function now(): string
{
    return date('Y-m-d H:i:s');
}

function fmt_date(?string $dt, string $format = 'd/m/Y H:i'): string
{
    if (!$dt) {
        return '—';
    }
    $ts = strtotime($dt);
    return $ts ? date($format, $ts) : '—';
}

/** Tanggal berbahasa Indonesia, contoh: Senin, 05 Oktober 2026 */
function tanggal_id(?int $ts = null, bool $withDay = true): string
{
    $ts = $ts ?? time();
    $days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    $months = [1 => 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    $s = date('d', $ts) . ' ' . $months[(int) date('n', $ts)] . ' ' . date('Y', $ts);
    return $withDay ? $days[(int) date('w', $ts)] . ', ' . $s : $s;
}

function fmt_duration(?int $seconds): string
{
    if ($seconds === null) {
        return '—';
    }
    $m = intdiv($seconds, 60);
    $s = $seconds % 60;
    if ($m >= 60) {
        return sprintf('%dj %02dm', intdiv($m, 60), $m % 60);
    }
    return $s > 0 ? sprintf('%dm %02ds', $m, $s) : $m . 'm';
}

function fmt_num($n, int $dec = 0): string
{
    if ($n === null || $n === '') {
        return '—';
    }
    $f = (float) $n;
    if ($dec > 0 && floor($f) == $f) {
        $dec = 0;
    }
    return number_format($f, $dec, ',', '.');
}

/** Input datetime-local (Y-m-dTH:i) -> DATETIME / null */
function parse_datetime_local(string $value): ?string
{
    $value = trim($value);
    if ($value === '') {
        return null;
    }
    $ts = strtotime(str_replace('T', ' ', $value));
    return $ts ? date('Y-m-d H:i:s', $ts) : null;
}

function to_datetime_local(?string $dt): string
{
    return $dt ? date('Y-m-d\TH:i', strtotime($dt)) : '';
}

function type_label(string $type): string
{
    return $type === 'test' ? 'TEST' : 'PRE-TEST';
}

function question_type_label(string $type): string
{
    return [
        'multiple_choice' => 'Multiple Choice',
        'multiple_answer' => 'Multiple Answer',
        'true_false'      => 'True / False',
        'short_answer'    => 'Short Answer',
        'essay'           => 'Essay',
    ][$type] ?? $type;
}

function difficulty_label(string $d): string
{
    return ['easy' => 'Mudah', 'medium' => 'Sedang', 'hard' => 'Sulit'][$d] ?? $d;
}

function initials(string $name): string
{
    $parts = preg_split('/\s+/', trim($name)) ?: [];
    $ini = '';
    foreach (array_slice($parts, 0, 2) as $p) {
        $ini .= mb_strtoupper(mb_substr($p, 0, 1));
    }
    return $ini ?: '?';
}

function departments(): array
{
    return array_column(
        q_all("SELECT DISTINCT department FROM users WHERE department IS NOT NULL AND department <> '' ORDER BY department"),
        'department'
    );
}

require_once __DIR__ . '/exam_engine.php';
