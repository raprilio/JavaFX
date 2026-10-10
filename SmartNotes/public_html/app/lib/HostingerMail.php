<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Minimal client for the Hostinger Mail API (https://api.mail.hostinger.com, OpenAPI v1.1).
 * Auth: order-scoped bearer token created in hPanel → Emails → email provisioning.
 * Tokens come from config.php (hostinger_mail.token) and/or the settings table (hmail_connections, encrypted):
 * one token per Hostinger e-mail order, so several domains can be connected side by side.
 */
final class HostingerMail
{
    public const DEFAULT_BASE = 'https://api.mail.hostinger.com';
    private const MAX_BINARY = 30 * 1024 * 1024;

    public static function baseUrl(): string
    {
        return rtrim((string) Config::get('hostinger_mail.base_url', self::DEFAULT_BASE), '/');
    }

    /** Token used by call()/binary() when none is passed: set by box() to the mailbox's own connection. */
    private static ?string $current = null;
    /** connection id => error message from the last mailbox lookup */
    private static array $errors = [];

    /**
     * All API connections: [['id', 'label', 'token', 'order', 'source' => 'config'|'database', 'added_at']].
     * Several are allowed because a Hostinger token only covers one e-mail order (one domain).
     */
    public static function connections(): array
    {
        $out = [];
        $cfg = (string) Config::get('hostinger_mail.token', '');
        if ($cfg !== '') {
            $out[] = ['id' => 'config', 'label' => 'app/config.php', 'token' => $cfg, 'order' => null, 'source' => 'config', 'added_at' => null];
        }
        foreach (self::stored() as $c) {
            $out[] = $c + ['source' => 'database'];
        }
        return $out;
    }

    /** Connections saved from the UI (encrypted in settings). Migrates the single v1.2 token. */
    private static function stored(): array
    {
        $raw = Settings::get('hmail_connections');
        if ($raw === null) {
            $legacy = (string) Settings::get('hmail_token', '');
            $list = $legacy !== '' ? [['id' => self::newId(), 'label' => 'Hostinger Mail', 'token' => $legacy, 'order' => null, 'added_at' => date('Y-m-d H:i:s')]] : [];
            self::save($list);
            Settings::set('hmail_token', '');
            return $list;
        }
        $list = json_decode((string) $raw, true);
        return is_array($list) ? array_values(array_filter($list, static fn($c) => is_array($c) && !empty($c['token']) && !empty($c['id']))) : [];
    }

    private static function save(array $list): void
    {
        Settings::set('hmail_connections', $list ? json_encode(array_values($list), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : '[]');
        unset($_SESSION['hmail_me']);
    }

    private static function newId(): string
    {
        return 'c' . bin2hex(random_bytes(5));
    }

    /** Add a token (checked against Hostinger first). Returns the new connection with its mailboxes. */
    public static function addConnection(string $token, string $label = ''): array
    {
        $me = self::me($token);
        $list = self::stored();
        foreach (self::connections() as $c) {
            if ($c['token'] === $token || ($me['order'] && ($c['order'] ?? null) === $me['order'])) {
                throw new HttpException('This e-mail order is already connected as "' . $c['label'] . '".', 422, ['token' => true]);
            }
        }
        $first = $me['mailboxes'][0]['address'] ?? '';
        $conn = [
            'id' => self::newId(),
            'label' => $label !== '' ? $label : ($first !== '' ? substr((string) strrchr($first, '@'), 1) : 'Hostinger Mail'),
            'token' => $token,
            'order' => $me['order'],
            'added_at' => date('Y-m-d H:i:s'),
        ];
        $list[] = $conn;
        self::save($list);
        return $conn + ['mailboxes' => $me['mailboxes']];
    }

    /** Remove a saved connection. Returns its label. */
    public static function removeConnection(string $id): string
    {
        if ($id === 'config') {
            throw new HttpException('This token is defined in app/config.php. Remove it from that file.', 422);
        }
        $list = self::stored();
        foreach ($list as $i => $c) {
            if ($c['id'] === $id) {
                array_splice($list, $i, 1);
                self::save($list);
                return (string) $c['label'];
            }
        }
        throw new HttpException('Connection not found.', 404);
    }

    public static function renameConnection(string $id, string $label): void
    {
        $list = self::stored();
        foreach ($list as &$c) {
            if ($c['id'] === $id) {
                $c['label'] = $label;
                self::save($list);
                return;
            }
        }
        throw new HttpException('Connection not found.', 404);
    }

    public static function removeAll(): void
    {
        self::save([]);
    }

    public static function configured(): bool
    {
        return self::connections() !== [];
    }

    public static function errors(): array
    {
        return self::$errors;
    }

    /** Order id + mailboxes for one token (GET /api/v1/me). */
    private static function me(string $token): array
    {
        $r = self::call('GET', '/api/v1/me', [], null, $token);
        $list = [];
        foreach ((array) ($r['data']['mailboxes'] ?? []) as $m) {
            if (is_string($m['resourceId'] ?? null) && preg_match('/^AC[A-Za-z0-9]+$/', $m['resourceId'])) {
                $list[] = ['resourceId' => $m['resourceId'], 'address' => (string) ($m['address'] ?? '')];
            }
        }
        $order = $r['data']['orderResourceId'] ?? null;
        return ['order' => is_string($order) ? $order : null, 'mailboxes' => $list];
    }

    /**
     * Mailboxes of every connection: [['resourceId' => 'AC…', 'address' => '…', 'connection' => id, 'connection_label' => …], …].
     * Cached per connection in the session for 10 minutes. A failing connection is skipped (see errors());
     * when every connection fails the first error is thrown.
     */
    public static function mailboxes(bool $fresh = false): array
    {
        $all = [];
        $seen = [];
        $first = null;
        self::$errors = [];
        $conns = self::connections();
        foreach ($conns as $c) {
            $key = substr(hash('sha256', $c['token']), 0, 16);
            $cache = $_SESSION['hmail_me'][$c['id']] ?? null;
            try {
                if (!$fresh && is_array($cache) && ($cache['k'] ?? '') === $key && ($cache['t'] ?? 0) > time() - 600) {
                    $list = $cache['list'];
                } else {
                    $me = self::me($c['token']);
                    $list = $me['mailboxes'];
                    $_SESSION['hmail_me'][$c['id']] = ['k' => $key, 't' => time(), 'list' => $list];
                }
            } catch (HttpException $e) {
                self::$errors[$c['id']] = $e->getMessage();
                $first ??= $e;
                continue;
            }
            foreach ($list as $m) {
                if (!isset($seen[$m['resourceId']])) {
                    $seen[$m['resourceId']] = true;
                    $all[] = $m + ['connection' => $c['id'], 'connection_label' => $c['label']];
                }
            }
        }
        if ($first && count(self::$errors) === count($conns)) {
            throw $first;
        }
        return $all;
    }

    /** Path prefix for one mailbox; also selects the token of the connection that owns it. */
    public static function box(string $mailboxId): string
    {
        foreach ([false, true] as $fresh) { // the list may be stale (mailbox added in hPanel a minute ago)
            foreach (self::mailboxes($fresh) as $m) {
                if ($m['resourceId'] === $mailboxId) {
                    foreach (self::connections() as $c) {
                        if ($c['id'] === $m['connection']) {
                            self::$current = $c['token'];
                        }
                    }
                    return '/api/v1/mailboxes/' . rawurlencode($mailboxId);
                }
            }
        }
        throw new HttpException('This mailbox is not available for the connected API tokens.', 404);
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
        $token ??= self::$current ?? (self::connections()[0]['token'] ?? '');
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
            $status === 401 => new HttpException('Hostinger rejected the API token. Create a new token in hPanel and add it in Mail → Settings → API connections.', 422, ['token' => true]),
            $status === 403 => new HttpException('The API token is not allowed to access this mailbox.' . ($msg ? " ($msg)" : ''), 403),
            $status === 404 => new HttpException($msg ?: 'Not found in the mailbox — it may have been moved or deleted.', 404),
            $status === 409 => new HttpException($msg ?: 'A folder with that name already exists.', 409),
            $status === 422 => new HttpException($msg ?: 'Hostinger rejected the request.', 422, $code ? ['code' => $code] : []),
            $status === 429 => new HttpException('Hostinger rate limit reached. Wait a minute and try again.', 429),
            default => new HttpException('The Hostinger Mail API returned an error (' . $status . ')' . ($msg ? ': ' . $msg : '.'), 502),
        };
    }
}
