<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Small IMAP4rev1 client on plain sockets (no php-imap extension needed — it is gone from PHP 8.4 and missing
 * on many hosts). Covers what the mailbox UI needs: login (SSL / STARTTLS / plain), LIST with special-use flags,
 * STATUS, SELECT/EXAMINE, UID SEARCH, UID FETCH, UID STORE, UID MOVE (or COPY + expunge) and APPEND.
 *
 * Responses are read whole (literals included) and parsed with a tolerant tokenizer.
 */
final class ImapClient
{
    /** @var resource|null */
    private $fp = null;
    private int $tag = 0;
    public array $caps = [];
    private ?string $selected = null;

    public function __construct(
        private string $host,
        private int $port,
        private string $security = 'ssl',
        private int $timeout = 20,
    ) {
    }

    public function __destruct()
    {
        if ($this->fp) {
            @fwrite($this->fp, 'Z' . ++$this->tag . " LOGOUT\r\n");
            @fclose($this->fp);
        }
    }

    // ------------------------------------------------------------ connection

    public function connect(): void
    {
        $addr = MailNet::resolve($this->host);
        $ssl = [
            'verify_peer' => (bool) Config::get('imap.verify_peer', true),
            'verify_peer_name' => (bool) Config::get('imap.verify_peer', true),
            'peer_name' => $this->host,
            'SNI_enabled' => true,
        ];
        if ($ca = Config::get('imap.cafile')) {
            $ssl['cafile'] = $ca;
        }
        $ctx = stream_context_create(['ssl' => $ssl]);
        $remote = ($this->security === 'ssl' ? 'ssl://' : 'tcp://') . $addr . ':' . $this->port;
        $errno = 0;
        $err = '';
        $fp = @stream_socket_client($remote, $errno, $err, $this->timeout, STREAM_CLIENT_CONNECT, $ctx);
        if (!$fp) {
            throw new HttpException('Could not connect to ' . $this->host . ':' . $this->port . ($err ? " ($err)" : '') . '. Check the server name, port and security setting.', 422, ['imap' => true]);
        }
        stream_set_timeout($fp, $this->timeout);
        $this->fp = $fp;
        // Any extra informational "* OK" lines after the greeting are collected as untagged data by the next command.
        $greeting = $this->line();
        if (!str_starts_with($greeting, '* OK') && !str_starts_with($greeting, '* PREAUTH')) {
            throw new HttpException('The server did not answer like an IMAP server.', 422, ['imap' => true]);
        }
        if ($this->security === 'tls') {
            $this->command('STARTTLS');
            if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new HttpException('STARTTLS failed — try the SSL setting (port 993).', 422, ['imap' => true]);
            }
        }
        $this->capability();
    }

    public function login(string $user, string $pass): void
    {
        try {
            if (in_array('AUTH=PLAIN', $this->caps, true)) {
                $ir = base64_encode("\0" . $user . "\0" . $pass);
                if (in_array('SASL-IR', $this->caps, true)) {
                    $this->command('AUTHENTICATE PLAIN ' . $ir);
                } else {
                    $this->command('AUTHENTICATE PLAIN', [$ir]);
                }
            } else {
                $this->command('LOGIN ' . self::astring($user) . ' ' . self::astring($pass));
            }
        } catch (HttpException $e) {
            $msg = $e->getMessage();
            $gmail = str_contains(strtolower($this->host), 'gmail');
            throw new HttpException(
                'Sign-in failed' . ($msg ? " ($msg)" : '') . '. ' . ($gmail
                    ? 'For Gmail, turn on 2-Step Verification and use a 16-character App Password (Google Account → Security → App passwords), not your normal password.'
                    : 'Check the user name and password (some providers need an app password).'),
                422,
                ['password' => true]
            );
        }
        $this->capability();
    }

    private function capability(): void
    {
        foreach ($this->command('CAPABILITY')['untagged'] as $u) {
            if (str_starts_with(strtoupper($u), '* CAPABILITY ')) {
                $this->caps = array_map('strtoupper', explode(' ', trim(substr($u, 13))));
            }
        }
    }

    public function has(string $cap): bool
    {
        return in_array(strtoupper($cap), $this->caps, true);
    }

    // ------------------------------------------------------------ protocol

    /**
     * Send a command. $continuations are sent one per "+" continuation request (SASL, literals).
     * @return array{untagged: string[], text: string}
     */
    public function command(string $cmd, array $continuations = []): array
    {
        if (!$this->fp) {
            throw new HttpException('Not connected to the mail server.', 500);
        }
        $tag = 'A' . ++$this->tag;
        $this->write($tag . ' ' . $cmd . "\r\n");
        $untagged = [];
        while (true) {
            $resp = $this->response();
            if (str_starts_with($resp, '+')) {
                if (!$continuations) {
                    $this->write("*\r\n"); // cancel an unexpected continuation
                    continue;
                }
                $this->write(array_shift($continuations) . "\r\n");
                continue;
            }
            if (str_starts_with($resp, $tag . ' ')) {
                $rest = substr($resp, strlen($tag) + 1);
                $status = strtoupper(strtok($rest, ' ') ?: '');
                $text = trim(substr($rest, strlen($status)));
                if ($status !== 'OK') {
                    throw new HttpException(self::cleanText($text) ?: 'The mail server refused the request.', 422, ['imap' => true]);
                }
                return ['untagged' => $untagged, 'text' => $text];
            }
            $untagged[] = $resp;
        }
    }

    /** APPEND / commands with one literal argument: "{n}" is sent first, the data after the "+" continuation. */
    public function commandLiteral(string $before, string $literal, string $after = ''): array
    {
        $plus = $this->has('LITERAL+');
        $head = $before . '{' . strlen($literal) . ($plus ? '+' : '') . '}';
        if ($plus) {
            return $this->command($head . "\r\n" . $literal . $after);
        }
        return $this->command($head, [$literal . $after]);
    }

    private function write(string $s): void
    {
        for ($off = 0, $len = strlen($s); $off < $len;) {
            $n = @fwrite($this->fp, substr($s, $off, 65536));
            if ($n === false || $n === 0) {
                throw new HttpException('The connection to the mail server was lost.', 502);
            }
            $off += $n;
        }
    }

    private function line(): string
    {
        $l = fgets($this->fp);
        if ($l === false) {
            $meta = stream_get_meta_data($this->fp);
            throw new HttpException($meta['timed_out'] ? 'The mail server did not respond in time.' : 'The connection to the mail server was closed.', 502);
        }
        return rtrim($l, "\r\n");
    }

    /** One complete response, literals inlined as "{n}\r\n<bytes>". */
    private function response(): string
    {
        $out = '';
        while (true) {
            $l = $this->line();
            $out .= $l;
            if (!preg_match('/\{(\d+)\+?\}$/', $l, $m)) {
                return $out;
            }
            $n = (int) $m[1];
            $data = '';
            while (strlen($data) < $n) {
                $chunk = fread($this->fp, min(65536, $n - strlen($data)));
                if ($chunk === false || $chunk === '') {
                    throw new HttpException('The connection to the mail server was closed.', 502);
                }
                $data .= $chunk;
            }
            $out .= "\r\n" . $data;
        }
    }

    // ------------------------------------------------------------ mailboxes

    /** @return array<int, array{name: string, delimiter: string, flags: string[]}> */
    public function listFolders(): array
    {
        $out = [];
        foreach ($this->command('LIST "" "*"')['untagged'] as $u) {
            if (!preg_match('/^\* LIST /i', $u)) {
                continue;
            }
            $i = 7;
            $t = self::parse($u, $i);
            if (count($t) < 3) {
                continue;
            }
            $out[] = ['flags' => array_map('strval', (array) $t[0]), 'delimiter' => (string) ($t[1] ?? '/'), 'name' => (string) $t[2]];
        }
        return $out;
    }

    /** @return array{messages: int, unseen: int} */
    public function status(string $mailbox): array
    {
        $r = $this->command('STATUS ' . self::astring($mailbox) . ' (MESSAGES UNSEEN)');
        foreach ($r['untagged'] as $u) {
            if (preg_match('/^\* STATUS .*\((.*)\)\s*$/is', $u, $m)) {
                preg_match('/MESSAGES (\d+)/i', $m[1], $a);
                preg_match('/UNSEEN (\d+)/i', $m[1], $b);
                return ['messages' => (int) ($a[1] ?? 0), 'unseen' => (int) ($b[1] ?? 0)];
            }
        }
        return ['messages' => 0, 'unseen' => 0];
    }

    /** SELECT (read-write) or EXAMINE. Returns the EXISTS count. */
    public function select(string $mailbox, bool $readOnly = false): int
    {
        $r = $this->command(($readOnly ? 'EXAMINE ' : 'SELECT ') . self::astring($mailbox));
        $this->selected = $mailbox;
        foreach ($r['untagged'] as $u) {
            if (preg_match('/^\* (\d+) EXISTS/i', $u, $m)) {
                return (int) $m[1];
            }
        }
        return 0;
    }

    /** UID SEARCH; $criteria is already in IMAP syntax (strings quoted with self::astring / literal). */
    public function uidSearch(string $criteria, ?string $literal = null): array
    {
        $r = $literal === null
            ? $this->command('UID SEARCH ' . $criteria)
            : $this->commandLiteral('UID SEARCH CHARSET UTF-8 ' . $criteria, $literal);
        $ids = [];
        foreach ($r['untagged'] as $u) {
            if (preg_match('/^\* SEARCH\s*(.*)$/i', $u, $m)) {
                foreach (preg_split('/\s+/', trim($m[1])) ?: [] as $x) {
                    if (ctype_digit($x)) {
                        $ids[] = (int) $x;
                    }
                }
            }
        }
        return $ids;
    }

    /**
     * FETCH by sequence set ("1:30") or with UID FETCH ("12,15"). Returns item maps keyed by upper-case names,
     * e.g. ['UID' => '12', 'FLAGS' => [...], 'BODY[]' => '...'].
     */
    public function fetch(string $set, string $items, bool $byUid = true): array
    {
        $r = $this->command(($byUid ? 'UID FETCH ' : 'FETCH ') . $set . ' (' . $items . ')');
        $out = [];
        foreach ($r['untagged'] as $u) {
            if (!preg_match('/^\* \d+ FETCH /i', $u, $m)) {
                continue;
            }
            $i = strlen($m[0]);
            $t = self::parse($u, $i);
            $list = $t[0] ?? [];
            $map = [];
            for ($k = 0; $k + 1 < count($list); $k += 2) {
                $key = strtoupper((string) $list[$k]);
                // BODY[HEADER.FIELDS (...)] / BODY.PEEK[...] come back as BODY[...]; keep the section name only.
                if (preg_match('/^BODY(?:\.PEEK)?\[([^\]]*)\]/', $key, $bm)) {
                    $key = 'BODY[' . (str_starts_with($bm[1], 'HEADER') ? 'HEADER' : $bm[1]) . ']';
                }
                $map[$key] = $list[$k + 1];
            }
            if (isset($map['UID'])) {
                $out[(int) $map['UID']] = $map;
            }
        }
        return $out;
    }

    public function uidStore(array $uids, string $op, array $flags): void
    {
        $this->command('UID STORE ' . implode(',', $uids) . ' ' . $op . 'FLAGS.SILENT (' . implode(' ', $flags) . ')');
    }

    public function uidMove(array $uids, string $target): void
    {
        $set = implode(',', $uids);
        if ($this->has('MOVE')) {
            $this->command('UID MOVE ' . $set . ' ' . self::astring($target));
            return;
        }
        $this->command('UID COPY ' . $set . ' ' . self::astring($target));
        $this->uidDelete($uids);
    }

    public function uidDelete(array $uids): void
    {
        $set = implode(',', $uids);
        $this->command('UID STORE ' . $set . ' +FLAGS.SILENT (\\Deleted)');
        $this->command($this->has('UIDPLUS') ? 'UID EXPUNGE ' . $set : 'EXPUNGE');
    }

    public function append(string $mailbox, string $message, array $flags = ['\\Seen']): void
    {
        $this->commandLiteral('APPEND ' . self::astring($mailbox) . ' (' . implode(' ', $flags) . ') ', $message);
    }

    // ------------------------------------------------------------ helpers

    /** Quoted string (or literal-free fallback) for an IMAP astring argument. */
    public static function astring(string $s): string
    {
        if (preg_match('/[\r\n\x00]/', $s)) {
            throw new HttpException('Invalid characters.', 422);
        }
        return '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $s) . '"';
    }

    /** Folder names on the wire are "modified UTF-7" (RFC 3501). */
    public static function decodeName(string $s): string
    {
        return str_contains($s, '&') ? (mb_convert_encoding($s, 'UTF-8', 'UTF7-IMAP') ?: $s) : $s;
    }

    public static function encodeName(string $s): string
    {
        return preg_match('/[^\x20-\x7E]|&/', $s) ? (mb_convert_encoding($s, 'UTF7-IMAP', 'UTF-8') ?: $s) : $s;
    }

    private static function cleanText(string $t): string
    {
        return trim(preg_replace('/^\[[^\]]*\]\s*/', '', $t) ?? $t);
    }

    /** Parse IMAP data (lists, quoted strings, literals, atoms, NIL) starting at $i until ")" or the end. */
    public static function parse(string $s, int &$i): array
    {
        $out = [];
        $len = strlen($s);
        while ($i < $len) {
            $c = $s[$i];
            if ($c === ' ' || $c === "\r" || $c === "\n") {
                $i++;
                continue;
            }
            if ($c === '(') {
                $i++;
                $out[] = self::parse($s, $i);
                continue;
            }
            if ($c === ')') {
                $i++;
                return $out;
            }
            if ($c === '"') {
                $i++;
                $buf = '';
                while ($i < $len && $s[$i] !== '"') {
                    if ($s[$i] === '\\' && $i + 1 < $len) {
                        $i++;
                    }
                    $buf .= $s[$i++];
                }
                $i++;
                $out[] = $buf;
                continue;
            }
            if ($c === '{' && preg_match('/\G\{(\d+)\+?\}\r\n/', $s, $m, 0, $i)) {
                $n = (int) $m[1];
                $i += strlen($m[0]);
                $out[] = substr($s, $i, $n);
                $i += $n;
                continue;
            }
            // Atom; brackets may contain spaces and parentheses (BODY[HEADER.FIELDS (FROM TO)]).
            $start = $i;
            $depth = 0;
            while ($i < $len) {
                $ch = $s[$i];
                if ($ch === '[') {
                    $depth++;
                } elseif ($ch === ']') {
                    $depth--;
                } elseif ($depth <= 0 && ($ch === ' ' || $ch === '(' || $ch === ')' || $ch === "\r" || $ch === "\n")) {
                    break;
                }
                $i++;
            }
            $atom = substr($s, $start, $i - $start);
            $out[] = strtoupper($atom) === 'NIL' ? null : $atom;
            if ($i === $start) {
                $i++; // never loop forever on unexpected input
            }
        }
        return $out;
    }
}
