<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class Config
{
    private static array $data = [];
    private static bool $loaded = false;

    public static function load(array $data): void
    {
        self::$data = $data;
        self::$loaded = true;
    }

    public static function isInstalled(): bool
    {
        return self::$loaded && !empty(self::$data['db']['name']);
    }

    /** Dot-notation getter: Config::get('db.host'). */
    public static function get(string $key, mixed $default = null): mixed
    {
        $cur = self::$data;
        foreach (explode('.', $key) as $part) {
            if (!is_array($cur) || !array_key_exists($part, $cur)) {
                return $default;
            }
            $cur = $cur[$part];
        }
        return $cur;
    }
}
