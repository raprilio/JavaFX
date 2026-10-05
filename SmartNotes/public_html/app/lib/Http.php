<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Request / response helpers for the JSON API.
 */
final class Http
{
    private static ?array $body = null;

    public static function method(): string
    {
        return strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    }

    /** Merged JSON body + form POST. */
    public static function body(): array
    {
        if (self::$body === null) {
            $data = [];
            $type = (string) ($_SERVER['CONTENT_TYPE'] ?? '');
            if (stripos($type, 'application/json') !== false) {
                $raw = file_get_contents('php://input') ?: '';
                if (strlen($raw) > 0) {
                    $data = json_decode($raw, true);
                    if (!is_array($data)) {
                        throw new HttpException('Invalid JSON body', 400);
                    }
                }
            } else {
                $data = $_POST;
            }
            self::$body = $data;
        }
        return self::$body;
    }

    public static function input(string $key, mixed $default = null): mixed
    {
        $b = self::body();
        return array_key_exists($key, $b) ? $b[$key] : $default;
    }

    public static function has(string $key): bool
    {
        return array_key_exists($key, self::body());
    }

    public static function query(string $key, mixed $default = null): mixed
    {
        return $_GET[$key] ?? $default;
    }

    public static function securityHeaders(bool $json = true): void
    {
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: SAMEORIGIN');
        header('Referrer-Policy: strict-origin-when-cross-origin');
        header('Permissions-Policy: camera=(), geolocation=(), microphone=(self)');
        if (is_https()) {
            header('Strict-Transport-Security: max-age=31536000');
        }
        if ($json) {
            header("Content-Security-Policy: default-src 'none'; frame-ancestors 'self'");
        }
    }

    public static function json(mixed $data, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, max-age=0');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    public static function ok(mixed $data = null, string $message = ''): never
    {
        $out = ['ok' => true];
        if ($message !== '') {
            $out['message'] = $message;
        }
        if ($data !== null) {
            $out['data'] = $data;
        }
        self::json($out);
    }

    public static function error(string $message, int $status = 400, array $errors = []): never
    {
        $out = ['ok' => false, 'message' => $message];
        if ($errors) {
            $out['errors'] = $errors;
        }
        self::json($out, $status);
    }
}
