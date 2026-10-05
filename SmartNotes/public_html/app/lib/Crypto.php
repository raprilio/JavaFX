<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Symmetric encryption for secrets at rest (e.g. SMTP password),
 * keyed by app.key from config.php. Uses libsodium when available, OpenSSL otherwise.
 */
final class Crypto
{
    private static function key(): string
    {
        $k = (string) Config::get('app.key', '');
        if ($k === '') {
            throw new RuntimeException('app.key is not configured');
        }
        return hash('sha256', $k, true);
    }

    public static function encrypt(string $plain): string
    {
        $key = self::key();
        if (function_exists('sodium_crypto_secretbox')) {
            $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            return 's1:' . base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, $key));
        }
        $iv = random_bytes(12);
        $tag = '';
        $ct = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        return 'o1:' . base64_encode($iv . $tag . $ct);
    }

    public static function decrypt(string $payload): ?string
    {
        try {
            $key = self::key();
            if (str_starts_with($payload, 's1:') && function_exists('sodium_crypto_secretbox_open')) {
                $raw = base64_decode(substr($payload, 3), true);
                if ($raw === false || strlen($raw) < SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) {
                    return null;
                }
                $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
                $r = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $nonce, $key);
                return $r === false ? null : $r;
            }
            if (str_starts_with($payload, 'o1:')) {
                $raw = base64_decode(substr($payload, 3), true);
                if ($raw === false || strlen($raw) < 28) {
                    return null;
                }
                $r = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
                return $r === false ? null : $r;
            }
        } catch (Throwable) {
            return null;
        }
        return null;
    }
}
