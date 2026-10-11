<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Hostinger account API (https://developers.hostinger.com, "Mail" endpoints) — mailbox provisioning.
 *
 * Different from HostingerMail: that one reads/sends mail with an order token from hPanel → Emails;
 * this one uses an account API token from hPanel → Profile → API (https://hpanel.hostinger.com/profile/api)
 * to list e-mail orders and create / delete mailboxes or change their password. Optional: without it
 * administrators can still give users access to mailboxes that already exist.
 */
final class HostingerAccount
{
    public const DEFAULT_BASE = 'https://developers.hostinger.com';
    private const MAX_BODY = 2 * 1024 * 1024;

    public static function baseUrl(): string
    {
        return rtrim((string) Config::get('hostinger_api.base_url', self::DEFAULT_BASE), '/');
    }

    public static function token(): string
    {
        $cfg = (string) Config::get('hostinger_api.token', '');
        return $cfg !== '' ? $cfg : (string) Settings::get('hpanel_token', '');
    }

    public static function configured(): bool
    {
        return self::token() !== '';
    }

    public static function fromConfig(): bool
    {
        return (string) Config::get('hostinger_api.token', '') !== '';
    }

    /** Check the token against Hostinger, then store it (encrypted). Returns the e-mail orders. */
    public static function connect(string $token): array
    {
        if (strlen($token) > 4000 || preg_match('/\s/', $token)) {
            throw new HttpException('That does not look like an API token.', 422, ['token' => true]);
        }
        $orders = self::orders($token);
        Settings::set('hpanel_token', $token);
        return $orders;
    }

    public static function disconnect(): void
    {
        Settings::set('hpanel_token', '');
    }

    /** E-mail orders of the account: [['id' => 'OR…', 'domain' => …, 'status', 'seats', 'plan', 'expires_at'], …]. */
    public static function orders(?string $token = null): array
    {
        $out = [];
        for ($page = 1; $page <= 5; $page++) {
            $r = self::call('GET', '/api/mail/v1/orders', ['page' => $page, 'per_page' => 100], null, $token);
            foreach ((array) ($r['data'] ?? []) as $o) {
                if (!is_string($o['id'] ?? null)) {
                    continue;
                }
                $out[] = [
                    'id' => $o['id'],
                    'domain' => is_array($o['domain'] ?? null) ? (string) ($o['domain']['name'] ?? '') : '',
                    'status' => (string) ($o['status'] ?? ''),
                    'seats' => isset($o['seats']) ? (int) $o['seats'] : null,
                    'plan' => is_array($o['plan'] ?? null) ? (string) ($o['plan']['title'] ?? $o['plan']['name'] ?? '') : '',
                    'expires_at' => $o['expires_at'] ?? null,
                ];
            }
            if (count((array) ($r['data'] ?? [])) < 100) {
                break;
            }
        }
        return $out;
    }

    /** Mailboxes of one order: [['id' => 'AC…', 'address', 'status', 'storage_used', 'storage_quota'], …]. */
    public static function mailboxes(string $orderId): array
    {
        self::assertId($orderId, 'OR');
        $out = [];
        for ($page = 1; $page <= 10; $page++) {
            $r = self::call('GET', '/api/mail/v1/orders/' . rawurlencode($orderId) . '/mailboxes', ['page' => $page, 'per_page' => 100]);
            foreach ((array) ($r['data'] ?? []) as $m) {
                if (is_string($m['id'] ?? null)) {
                    $out[] = self::mailbox($m);
                }
            }
            if (count((array) ($r['data'] ?? [])) < 100) {
                break;
            }
        }
        return $out;
    }

    public static function createMailbox(string $orderId, string $localPart, string $password): array
    {
        self::assertId($orderId, 'OR');
        $r = self::call('POST', '/api/mail/v1/orders/' . rawurlencode($orderId) . '/mailboxes', [], ['local_part' => $localPart, 'password' => $password]);
        if (!is_string($r['id'] ?? null)) {
            throw new HttpException('Unexpected response from Hostinger.', 502);
        }
        return self::mailbox($r);
    }

    public static function deleteMailbox(string $mailboxId): void
    {
        self::assertId($mailboxId, 'AC');
        self::call('DELETE', '/api/mail/v1/mailboxes/' . rawurlencode($mailboxId));
    }

    public static function changePassword(string $mailboxId, string $password): void
    {
        self::assertId($mailboxId, 'AC');
        self::call('PATCH', '/api/mail/v1/mailboxes/' . rawurlencode($mailboxId) . '/password', [], ['password' => $password]);
    }

    /** A Mail API token covering every current and future mailbox of the order (shown once by Hostinger). */
    public static function createMailToken(string $orderId, string $name): string
    {
        self::assertId($orderId, 'OR');
        $r = self::call('POST', '/api/mail/v1/orders/' . rawurlencode($orderId) . '/api-tokens', [], ['name' => $name, 'scope' => ['has_all_mailboxes' => true]]);
        $t = $r['token'] ?? null;
        if (!is_string($t) || $t === '') {
            throw new HttpException('Hostinger did not return a token.', 502);
        }
        return $t;
    }

    /** Hostinger's rule: 8–50 characters with upper and lower case, a digit and a special character. */
    public static function validPassword(string $p): bool
    {
        return strlen($p) >= 8 && strlen($p) <= 50 && preg_match('/[A-Z]/', $p) && preg_match('/[a-z]/', $p) && preg_match('/\d/', $p) && preg_match('/[^A-Za-z0-9]/', $p);
    }

    public static function generatePassword(): string
    {
        $sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*-_+=?'];
        $all = implode('', $sets);
        $chars = [];
        foreach ($sets as $s) {
            $chars[] = $s[random_int(0, strlen($s) - 1)];
        }
        while (count($chars) < 16) {
            $chars[] = $all[random_int(0, strlen($all) - 1)];
        }
        for ($i = count($chars) - 1; $i > 0; $i--) {
            $j = random_int(0, $i);
            [$chars[$i], $chars[$j]] = [$chars[$j], $chars[$i]];
        }
        return implode('', $chars);
    }

    private static function mailbox(array $m): array
    {
        return [
            'id' => (string) $m['id'],
            'address' => (string) ($m['address'] ?? ''),
            'status' => (string) ($m['status'] ?? ''),
            'storage_used' => isset($m['usage']['storage_used']) ? (int) $m['usage']['storage_used'] : null,
            'storage_quota' => isset($m['usage']['storage_quota']) ? (int) $m['usage']['storage_quota'] : null,
        ];
    }

    private static function assertId(string $id, string $prefix): void
    {
        if (!preg_match('/^' . $prefix . '[A-Za-z0-9]{1,60}$/', $id)) {
            throw new HttpException('Invalid Hostinger id.', 422);
        }
    }

    // ------------------------------------------------------------ transport

    private static function call(string $method, string $path, array $query = [], ?array $body = null, ?string $token = null): array
    {
        $token ??= self::token();
        if ($token === '') {
            throw new HttpException('Add the Hostinger API token (hPanel → Profile → API) first.', 422);
        }
        $url = self::baseUrl() . $path . ($query ? '?' . http_build_query($query) : '');
        $headers = ['Authorization: Bearer ' . $token, 'Accept: application/json', 'User-Agent: SmartNotes/' . SN_VERSION];
        $payload = null;
        if ($body !== null) {
            $payload = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $headers[] = 'Content-Type: application/json';
        }
        $status = 0;
        $resp = '';
        $error = '';
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_CUSTOMREQUEST => $method,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_CONNECTTIMEOUT => 8,
                CURLOPT_TIMEOUT => 30,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_MAXFILESIZE => self::MAX_BODY,
            ]);
            if ($payload !== null) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
            }
            $resp = curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            if (curl_errno($ch)) {
                $error = curl_error($ch);
            }
            curl_close($ch);
            $resp = is_string($resp) ? $resp : '';
        } else {
            $ctx = stream_context_create(['http' => [
                'method' => $method, 'header' => implode("\r\n", $headers), 'content' => $payload ?? '',
                'timeout' => 30, 'ignore_errors' => true, 'follow_location' => 0,
            ]]);
            $resp = @file_get_contents($url, false, $ctx, 0, self::MAX_BODY);
            if ($resp === false) {
                $resp = '';
                $error = 'connection failed';
            }
            foreach ($http_response_header ?? [] as $h) {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
                    $status = (int) $m[1];
                }
            }
        }
        if ($status === 0) {
            error_log('[SmartNotes] Hostinger API unreachable: ' . $error);
            throw new HttpException('Could not reach the Hostinger API. Check the server\'s internet access and try again.', 502);
        }
        $j = $resp === '' ? [] : json_decode($resp, true);
        if ($status >= 400) {
            throw self::failure($status, is_array($j) ? $j : []);
        }
        if (!is_array($j)) {
            throw new HttpException('Unexpected response from Hostinger.', 502);
        }
        return $j;
    }

    /** Never forward 401: the app would treat it as our own session expiring. */
    private static function failure(int $status, array $j): HttpException
    {
        $msg = (string) ($j['message'] ?? '');
        $fields = [];
        foreach ((array) ($j['errors'] ?? []) as $f => $list) {
            $fields[(string) $f] = is_array($list) ? implode(' ', array_map('strval', $list)) : (string) $list;
        }
        $detail = $fields ? implode(' ', $fields) : $msg;
        return match (true) {
            $status === 401 => new HttpException('Hostinger rejected the API token. Create a new one in hPanel → Profile → API.', 422, ['token' => true]),
            $status === 403 => new HttpException('The Hostinger API token is not allowed to do this.' . ($msg ? " ($msg)" : ''), 403),
            $status === 404 => new HttpException($msg ?: 'Not found at Hostinger.', 404),
            $status === 409 => new HttpException($msg ?: 'Hostinger could not do this right now (conflict).', 409),
            $status === 422 => new HttpException($detail ?: 'Hostinger rejected the request.', 422, array_map(static fn() => true, $fields)),
            $status === 429 => new HttpException('Hostinger rate limit reached. Wait a minute and try again.', 429),
            default => new HttpException('The Hostinger API returned an error (' . $status . ')' . ($msg ? ': ' . $msg : '.'), 502),
        };
    }
}
