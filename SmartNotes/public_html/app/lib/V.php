<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Input validation / normalisation helpers. Each method returns a clean value or throws 422.
 */
final class V
{
    public static function str(mixed $v, int $max = 255, bool $required = false, string $field = 'value'): ?string
    {
        if ($v === null || (is_string($v) && trim($v) === '')) {
            if ($required) {
                throw new HttpException(ucfirst($field) . ' is required', 422, [$field => 'required']);
            }
            return null;
        }
        if (!is_scalar($v)) {
            throw new HttpException("Invalid $field", 422, [$field => 'invalid']);
        }
        $s = trim((string) $v);
        // Strip control chars except tab/newline.
        $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $s) ?? '';
        if (mb_strlen($s) > $max) {
            $s = mb_substr($s, 0, $max);
        }
        return $s;
    }

    public static function int(mixed $v, ?int $min = null, ?int $max = null): ?int
    {
        if ($v === null || $v === '' || $v === false) {
            return null;
        }
        if (!is_numeric($v)) {
            throw new HttpException('Invalid number', 422);
        }
        $i = (int) $v;
        if ($min !== null && $i < $min) {
            $i = $min;
        }
        if ($max !== null && $i > $max) {
            $i = $max;
        }
        return $i;
    }

    public static function id(mixed $v): ?int
    {
        $i = self::int($v);
        return $i && $i > 0 ? $i : null;
    }

    public static function bool(mixed $v): int
    {
        return filter_var($v, FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
    }

    public static function float(mixed $v, float $default = 0.0): float
    {
        return is_numeric($v) ? (float) $v : $default;
    }

    public static function enum(mixed $v, array $allowed, string $default): string
    {
        return in_array($v, $allowed, true) ? (string) $v : $default;
    }

    public static function email(mixed $v, bool $required = true): ?string
    {
        $s = self::str($v, 190, $required, 'email');
        if ($s === null) {
            return null;
        }
        $s = mb_strtolower($s);
        if (!filter_var($s, FILTER_VALIDATE_EMAIL)) {
            throw new HttpException('Invalid e-mail address', 422, ['email' => 'invalid']);
        }
        return $s;
    }

    public static function date(mixed $v, bool $required = false, string $field = 'date'): ?string
    {
        if ($v === null || $v === '') {
            if ($required) {
                throw new HttpException(ucfirst($field) . ' is required', 422, [$field => 'required']);
            }
            return null;
        }
        $d = DateTime::createFromFormat('!Y-m-d', substr((string) $v, 0, 10));
        if (!$d) {
            throw new HttpException("Invalid $field", 422, [$field => 'invalid']);
        }
        return $d->format('Y-m-d');
    }

    public static function time(mixed $v, bool $required = false, string $field = 'time'): ?string
    {
        if ($v === null || $v === '') {
            if ($required) {
                throw new HttpException(ucfirst($field) . ' is required', 422, [$field => 'required']);
            }
            return null;
        }
        if (!preg_match('/^([01]?\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/', (string) $v, $m)) {
            throw new HttpException("Invalid $field", 422, [$field => 'invalid']);
        }
        return sprintf('%02d:%02d:00', $m[1], $m[2]);
    }

    public static function datetime(mixed $v, bool $required = false, string $field = 'datetime'): ?string
    {
        if ($v === null || $v === '') {
            if ($required) {
                throw new HttpException(ucfirst($field) . ' is required', 422, [$field => 'required']);
            }
            return null;
        }
        $ts = strtotime(str_replace('T', ' ', (string) $v));
        if ($ts === false) {
            throw new HttpException("Invalid $field", 422, [$field => 'invalid']);
        }
        return date('Y-m-d H:i:s', $ts);
    }

    public static function color(mixed $v): ?string
    {
        if (!is_string($v) || $v === '') {
            return null;
        }
        return preg_match('/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/', $v) ? strtolower($v) : null;
    }

    public static function url(mixed $v): ?string
    {
        $s = self::str($v, 500);
        if ($s === null) {
            return null;
        }
        if (!preg_match('#^https?://#i', $s)) {
            $s = 'https://' . $s;
        }
        if (!filter_var($s, FILTER_VALIDATE_URL)) {
            throw new HttpException('Invalid URL', 422, ['url' => 'invalid']);
        }
        return $s;
    }

    public static function token(mixed $v, int $max = 40): ?string
    {
        if (!is_string($v) || $v === '') {
            return null;
        }
        return preg_match('/^[A-Za-z0-9_\-]{1,' . $max . '}$/', $v) ? $v : null;
    }

    public static function password(mixed $v): string
    {
        $s = is_string($v) ? $v : '';
        if (mb_strlen($s) < 8) {
            throw new HttpException('Password must be at least 8 characters', 422, ['password' => 'min:8']);
        }
        if (strlen($s) > 200) {
            throw new HttpException('Password is too long', 422, ['password' => 'max']);
        }
        if (!preg_match('/[A-Za-z]/', $s) || !preg_match('/\d/', $s)) {
            throw new HttpException('Password must contain letters and numbers', 422, ['password' => 'weak']);
        }
        return $s;
    }

    public static function ids(mixed $v): array
    {
        if (!is_array($v)) {
            return [];
        }
        $out = [];
        foreach ($v as $x) {
            $i = self::id($x);
            if ($i) {
                $out[$i] = $i;
            }
        }
        return array_values($out);
    }
}
