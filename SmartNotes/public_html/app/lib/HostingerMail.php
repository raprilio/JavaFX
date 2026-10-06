<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Minimal client for the Hostinger Mail API (https://api.mail.hostinger.com, OpenAPI v1.1).
 * Auth: order-scoped bearer token created in hPanel → Emails → email provisioning.
 * The token comes from config.php (hostinger_mail.token) or the settings table (encrypted).
 */
final class HostingerMail
{
    public const DEFAULT_BASE = 'https://api.mail.hostinger.com';
    private const MAX_BINARY = 30 * 1024 * 1024;

    public static function baseUrl(): string
    {
        return rtrim((string) Config::get('hostinger_mail.base_url', self::DEFAULT_BASE), '/');
    }

    public static function tokenSource(): string
    {
        return (string) Config::get('hostinger_mail.token', '') !== '' ? 'config' : 'database';
    }

    public static function token(): string
    {
        $cfg = (string) Config::get('hostinger_mail.token', '');
        return $cfg !== '' ? $cfg : (string) Settings::get('hmail_token', '');
    }

    public static function configured(): bool
    {
        return self::token() !== '';
    }

    /** Mailboxes the token may manage: [['resourceId' => 'AC…', 'address' => '…'], …]. Cached in the session for 10 minutes. */
    public static function mailboxes(bool $fresh = false, ?string $token = null): array
    {
        $token ??= self::token();
        $key = substr(hash('sha256', $token), 0, 16);
        $c = $_SESSION['hmail_me'] ?? null;
        if (!$fresh && $token === self::token() && is_array($c) && ($c['k'] ?? '') === $key && ($c['t'] ?? 0) > time() - 600) {
            return $c['list'];
        }
        $r = self::call('GET', '/api/v1/me', [], null, $token);
        $list = [];
        foreach ((array) ($r['data']['mailboxes'] ?? []) as $m) {
            if (is_string($m['resourceId'] ?? null) && preg_match('/^AC[A-Za-z0-9]+$/', $m['resourceId'])) {
                $list[] = ['resourceId' => $m['resourceId'], 'address' => (string) ($m['address'] ?? '')];
            }
        }
        if ($token === self::token()) {
            $_SESSION['hmail_me'] = ['k' => $key, 't' => time(), 'list' => $list];
        }
        return $list;
    }

    /** Path prefix for one mailbox; the id must be one the token can manage. */
    public static function box(string $mailboxId): string
    {
        foreach (self::mailboxes() as $m) {
            if ($m['resourceId'] === $mailboxId) {
                return '/api/v1/mailboxes/' . rawurlencode($mailboxId);
            }
        }
        // The list may be stale (mailbox added in hPanel a minute ago).
        foreach (self::mailboxes(true) as $m) {
            if ($m['resourceId'] === $mailboxId) {
                return '/api/v1/mailboxes/' . rawurlencode($mailboxId);
            }
        }
        throw new HttpException('This mailbox is not available for the configured API token.', 404);
    }

    public static function folderPath(string $mailboxId, string $folder): string
    {
        return self::box($mailboxId) . '/folders/' . rawurlencode($folder);
    }

    /** JSON request. Returns the decoded body (or [] for 204). Throws HttpException with a user-facing message. */
    public static function call(string $method, string $path, array $query = [], ?array $body = null, ?string $token = null): array
    {
        $r = self::send($method, $path, $query, $body, $token, false);
        if ($r['status'] === 204 || $r['body'] === '') {
            return [];
        }
        $j = json_decode($r['body'], true);
        if (!is_array($j)) {
            throw new HttpException('Unexpected response from the Hostinger Mail API.', 502);
        }
        return $j;
    }

    /** Binary download (attachment, raw source). Returns ['body' => bytes, 'type' => content-type]. */
    public static function binary(string $path, ?string $token = null): array
    {
        $r = self::send('GET', $path, [], null, $token, true);
        return ['body' => $r['body'], 'type' => $r['type']];
    }

    private static function send(string $method, string $path, array $query, ?array $body, ?string $token, bool $binary): array
    {
        $token ??= self::token();
        if ($token === '') {
            throw new HttpException('The Hostinger Mail API token is not configured yet.', 422);
        }
        $url = self::baseUrl() . $path . ($query ? '?' . http_build_query($query) : '');
        $headers = [
            'Authorization: Bearer ' . $token,
            'Accept: ' . ($binary ? '*/*' : 'application/json'),
            'User-Agent: SmartNotes/' . SN_VERSION,
        ];
        $payload = null;
        if ($body !== null) {
            $payload = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
            $headers[] = 'Content-Type: application/json';
        }

        $status = 0;
        $type = '';
        $resp = '';
        $error = '';
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            $tooBig = false;
            curl_setopt_array($ch, [
                CURLOPT_CUSTOMREQUEST => $method,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_CONNECTTIMEOUT => 8,
                CURLOPT_TIMEOUT => $binary ? 60 : 25,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP,
                CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$type): int {
                    if (stripos($line, 'content-type:') === 0) {
                        $type = trim(substr($line, 13));
                    }
                    return strlen($line);
                },
                CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (&$resp, &$tooBig): int {
                    if (strlen($resp) + strlen($chunk) > self::MAX_BINARY) {
                        $tooBig = true;
                        return 0;
                    }
                    $resp .= $chunk;
                    return strlen($chunk);
                },
            ]);
            if ($payload !== null) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
            }
            curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            if ($tooBig) {
                throw new HttpException('The file is too large to load through the app (limit 30 MB).', 413);
            }
            if (curl_errno($ch)) {
                $error = curl_error($ch);
            }
            curl_close($ch);
        } else {
            $ctx = stream_context_create(['http' => [
                'method' => $method, 'header' => implode("\r\n", $headers), 'content' => $payload ?? '',
                'timeout' => $binary ? 60 : 25, 'ignore_errors' => true, 'follow_location' => 0,
            ]]);
            $resp = @file_get_contents($url, false, $ctx, 0, self::MAX_BINARY + 1);
            if ($resp === false) {
                $resp = '';
                $error = 'connection failed';
            }
            foreach ($http_response_header ?? [] as $h) {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
                    $status = (int) $m[1];
                } elseif (stripos($h, 'content-type:') === 0) {
                    $type = trim(substr($h, 13));
                }
            }
            if (strlen($resp) > self::MAX_BINARY) {
                throw new HttpException('The file is too large to load through the app (limit 30 MB).', 413);
            }
        }

        if ($status === 0) {
            error_log('[SmartNotes] Hostinger Mail API unreachable: ' . $error);
            throw new HttpException('Could not reach the Hostinger Mail API. Check the server\'s internet access and try again.', 502);
        }
        if ($status >= 400) {
            throw self::failure($status, $resp);
        }
        return ['status' => $status, 'body' => $resp, 'type' => $type];
    }

    /** Map upstream errors to messages for the admin. Never forward 401: the app would treat it as our own session expiring. */
    private static function failure(int $status, string $body): HttpException
    {
        $j = json_decode($body, true);
        $msg = is_array($j) ? (string) ($j['error'] ?? '') : '';
        $code = is_array($j) ? (string) ($j['code'] ?? '') : '';
        return match (true) {
            $status === 401 => new HttpException('Hostinger rejected the API token. Create a new token in hPanel and save it in Mail → Connection.', 422, ['token' => true]),
            $status === 403 => new HttpException('The API token is not allowed to access this mailbox.' . ($msg ? " ($msg)" : ''), 403),
            $status === 404 => new HttpException($msg ?: 'Not found in the mailbox — it may have been moved or deleted.', 404),
            $status === 409 => new HttpException($msg ?: 'A folder with that name already exists.', 409),
            $status === 422 => new HttpException($msg ?: 'Hostinger rejected the request.', 422, $code ? ['code' => $code] : []),
            $status === 429 => new HttpException('Hostinger rate limit reached. Wait a minute and try again.', 429),
            default => new HttpException('The Hostinger Mail API returned an error (' . $status . ')' . ($msg ? ': ' . $msg : '.'), 502),
        };
    }
}
