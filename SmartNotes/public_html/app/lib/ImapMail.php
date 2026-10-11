<?php
declare(strict_types=1);

defined('SN_APP') || exit;

require_once SN_APP_DIR . '/vendor/PHPMailer/Exception.php';
require_once SN_APP_DIR . '/vendor/PHPMailer/PHPMailer.php';
require_once SN_APP_DIR . '/vendor/PHPMailer/SMTP.php';

use PHPMailer\PHPMailer\PHPMailer;

/**
 * Personal mailboxes over IMAP + SMTP (Gmail with an App Password, Yahoo, or any provider), one owner each.
 * Mailbox ids in the UI are "IM<account id>"; Hostinger mailboxes keep their "AC…" ids and stay admin-only.
 * Results use the same shapes as the Hostinger code path so the Mail screen works unchanged.
 */
final class ImapMail
{
    public const PRESETS = [
        'gmail' => ['label' => 'Gmail', 'imap_host' => 'imap.gmail.com', 'imap_port' => 993, 'imap_security' => 'ssl', 'smtp_host' => 'smtp.gmail.com', 'smtp_port' => 465, 'smtp_security' => 'ssl'],
        'yahoo' => ['label' => 'Yahoo Mail', 'imap_host' => 'imap.mail.yahoo.com', 'imap_port' => 993, 'imap_security' => 'ssl', 'smtp_host' => 'smtp.mail.yahoo.com', 'smtp_port' => 465, 'smtp_security' => 'ssl'],
        'icloud' => ['label' => 'iCloud Mail', 'imap_host' => 'imap.mail.me.com', 'imap_port' => 993, 'imap_security' => 'ssl', 'smtp_host' => 'smtp.mail.me.com', 'smtp_port' => 587, 'smtp_security' => 'tls'],
        'custom' => ['label' => 'E-mail'],
    ];
    private const MAX_ACCOUNTS = 10;
    private const MAX_MESSAGE_BYTES = 40 * 1024 * 1024;
    private const LIST_HEADERS = 'BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID CONTENT-TYPE)]';

    // ------------------------------------------------------------ accounts

    public static function isId(?string $mailbox): bool
    {
        return is_string($mailbox) && preg_match('/^IM\d{1,9}$/', $mailbox) === 1;
    }

    /** Accounts of a user, without secrets. */
    public static function accounts(int $userId): array
    {
        return array_map([self::class, 'publicRow'], DB::all('SELECT * FROM mail_accounts WHERE user_id = ? ORDER BY id', [$userId]));
    }

    public static function publicRow(array $a): array
    {
        return [
            'id' => (int) $a['id'],
            'mailbox' => 'IM' . $a['id'],
            'provider' => $a['provider'],
            'label' => $a['label'],
            'email' => $a['email'],
            'display_name' => $a['display_name'],
            'imap_host' => $a['imap_host'], 'imap_port' => (int) $a['imap_port'], 'imap_security' => $a['imap_security'],
            'smtp_host' => $a['smtp_host'], 'smtp_port' => $a['smtp_port'] !== null ? (int) $a['smtp_port'] : null, 'smtp_security' => $a['smtp_security'],
            'username' => $a['username'],
            'last_error' => $a['last_error'],
            'created_at' => $a['created_at'],
        ];
    }

    /** The account behind an "IM<id>" mailbox, only for its owner. */
    public static function account(string $mailbox, int $userId): array
    {
        $id = (int) substr($mailbox, 2);
        $a = DB::one('SELECT * FROM mail_accounts WHERE id = ? AND user_id = ?', [$id, $userId]);
        if (!$a) {
            throw new HttpException('This mailbox is not available.', 404);
        }
        return $a;
    }

    /** Validate input, test the IMAP login (and SMTP when given) and store the account. */
    public static function save(int $userId, array $in, ?array $existing = null): array
    {
        $provider = V::enum($in['provider'] ?? ($existing['provider'] ?? 'custom'), array_keys(self::PRESETS), 'custom');
        $p = self::PRESETS[$provider];
        $email = strtolower(trim((string) ($in['email'] ?? ($existing['email'] ?? ''))));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new HttpException('Enter a valid e-mail address.', 422, ['email' => true]);
        }
        $pick = static fn(string $k, mixed $def = null) => array_key_exists($k, $in) && $in[$k] !== '' && $in[$k] !== null ? $in[$k] : ($existing[$k] ?? $p[$k] ?? $def);
        $row = [
            'provider' => $provider,
            'label' => V::str($in['label'] ?? null, 80) ?: ($existing['label'] ?? (($p['label'] ?? 'E-mail') . ' · ' . $email)),
            'email' => $email,
            'display_name' => array_key_exists('display_name', $in) ? (V::str($in['display_name'], 120) ?: null) : ($existing['display_name'] ?? null),
            'imap_host' => strtolower(trim((string) $pick('imap_host', ''))),
            'imap_port' => V::int($pick('imap_port', 993), 1, 65535) ?? 993,
            'imap_security' => V::enum($pick('imap_security', 'ssl'), ['ssl', 'tls', 'none'], 'ssl'),
            'smtp_host' => strtolower(trim((string) $pick('smtp_host', ''))) ?: null,
            'smtp_port' => V::int($pick('smtp_port'), 1, 65535),
            'smtp_security' => $pick('smtp_security') ? V::enum($pick('smtp_security'), ['ssl', 'tls', 'none'], 'ssl') : null,
            'username' => trim((string) $pick('username', $email)) ?: $email,
        ];
        if ($row['imap_host'] === '') {
            throw new HttpException('Enter the IMAP server (e.g. imap.example.com).', 422, ['imap_host' => true]);
        }
        $password = (string) ($in['password'] ?? '');
        if ($password === '' && !$existing) {
            throw new HttpException('Enter the password (for Gmail: an App Password).', 422, ['password' => true]);
        }
        if ($provider === 'gmail') {
            $password = str_replace(' ', '', $password); // App Passwords are shown as "abcd efgh ijkl mnop"
        }
        $secret = $password !== '' ? $password : Crypto::decrypt((string) $existing['password_enc']) ?? '';
        if (!$existing && (int) DB::val('SELECT COUNT(*) FROM mail_accounts WHERE user_id = ?', [$userId]) >= self::MAX_ACCOUNTS) {
            throw new HttpException('You can connect at most ' . self::MAX_ACCOUNTS . ' mailboxes.', 422);
        }
        if (DB::val('SELECT id FROM mail_accounts WHERE user_id = ? AND email = ? AND id <> ?', [$userId, $email, (int) ($existing['id'] ?? 0)])) {
            throw new HttpException('This e-mail address is already connected.', 422, ['email' => true]);
        }
        // Prove the settings work before saving them.
        $c = new ImapClient($row['imap_host'], $row['imap_port'], $row['imap_security']);
        $c->connect();
        try {
            $c->login($row['username'], $secret);
        } catch (HttpException $e) {
            if ($provider === 'gmail' && !str_contains($e->getMessage(), 'App Password')) {
                throw new HttpException(preg_replace('/\. Check the user name.*$/s', '', $e->getMessage()) . '. For Gmail, turn on 2-Step Verification and use a 16-character App Password (Google Account → Security → App passwords), not your normal password. IMAP must be enabled in Gmail settings.', 422, ['password' => true]);
            }
            throw $e;
        }
        unset($c);
        $row['password_enc'] = Crypto::encrypt($secret);
        $row['last_error'] = null;
        if ($existing) {
            DB::update('mail_accounts', $row, 'id = ? AND user_id = ?', [(int) $existing['id'], $userId]);
            $id = (int) $existing['id'];
        } else {
            $id = DB::insert('mail_accounts', $row + ['user_id' => $userId]);
        }
        return self::publicRow(DB::one('SELECT * FROM mail_accounts WHERE id = ?', [$id]));
    }

    public static function remove(int $id, int $userId): string
    {
        $a = DB::one('SELECT email FROM mail_accounts WHERE id = ? AND user_id = ?', [$id, $userId]);
        if (!$a) {
            throw new HttpException('Mailbox not found.', 404);
        }
        DB::run('DELETE FROM mail_accounts WHERE id = ?', [$id]);
        return (string) $a['email'];
    }

    // ------------------------------------------------------------ IMAP session

    private static function open(array $a): ImapClient
    {
        $c = new ImapClient($a['imap_host'], (int) $a['imap_port'], $a['imap_security']);
        try {
            $c->connect();
            $c->login($a['username'], Crypto::decrypt((string) $a['password_enc']) ?? '');
            if ($a['last_error']) {
                DB::update('mail_accounts', ['last_error' => null], 'id = ?', [$a['id']]);
            }
        } catch (HttpException $e) {
            DB::update('mail_accounts', ['last_error' => mb_substr($e->getMessage(), 0, 255)], 'id = ?', [$a['id']]);
            throw $e;
        }
        return $c;
    }

    private static function special(array $flags, string $name): ?string
    {
        foreach (['\\Sent', '\\Trash', '\\Drafts', '\\Junk', '\\Archive', '\\All', '\\Flagged', '\\Important'] as $s) {
            foreach ($flags as $f) {
                if (strcasecmp($f, $s) === 0) {
                    return $s;
                }
            }
        }
        $n = strtolower(preg_replace('/^.*[\/.]/', '', $name) ?? $name);
        return match (true) {
            in_array($n, ['sent', 'sent items', 'sent mail', 'sent messages', 'terkirim'], true) => '\\Sent',
            in_array($n, ['trash', 'deleted items', 'deleted messages', 'bin', 'sampah'], true) => '\\Trash',
            in_array($n, ['drafts', 'draft', 'draf'], true) => '\\Drafts',
            in_array($n, ['junk', 'spam', 'junk e-mail', 'bulk mail'], true) => '\\Junk',
            in_array($n, ['archive', 'archives', 'arsip'], true) => '\\Archive',
            default => null,
        };
    }

    public static function folders(array $a): array
    {
        $c = self::open($a);
        $items = [];
        foreach (array_slice($c->listFolders(), 0, 80) as $f) {
            $flags = $f['flags'];
            if (array_filter($flags, static fn($x) => in_array(strtolower($x), ['\\noselect', '\\nonexistent'], true))) {
                continue;
            }
            $st = ['messages' => 0, 'unseen' => 0];
            try {
                $st = $c->status($f['name']);
            } catch (HttpException) {
                // A folder that cannot be opened still appears in the list.
            }
            $display = ImapClient::decodeName($f['name']);
            $sep = $f['delimiter'] ?: '/';
            $items[] = [
                'path' => $f['name'],
                'name' => strtoupper($f['name']) === 'INBOX' ? 'INBOX' : (str_contains($display, $sep) ? substr($display, strrpos($display, $sep) + 1) : $display),
                'delimiter' => $sep,
                'special' => strtoupper($f['name']) === 'INBOX' ? null : self::special($flags, $display),
                'total' => $st['messages'],
                'unread' => $st['unseen'],
            ];
        }
        return $items;
    }

    private static function present(array $f, string $folder, ?array $parsed = null): array
    {
        $flags = array_map('strval', (array) ($f['FLAGS'] ?? []));
        $h = $parsed ?? MimeParser::summary(MimeParser::headers((string) ($f['BODY[HEADER]'] ?? '')));
        $date = $h['date'] ?: (isset($f['INTERNALDATE']) && ($t = strtotime((string) $f['INTERNALDATE'])) ? gmdate('Y-m-d\TH:i:s\Z', $t) : '');
        $has = in_array('\\Seen', $flags, true);
        return [
            'uid' => (int) $f['UID'],
            'folder' => $folder,
            'date' => $date,
            'subject' => $h['subject'],
            'from' => $h['from'],
            'to' => $h['to'],
            'cc' => $h['cc'],
            'bcc' => [],
            'size' => (int) ($f['RFC822.SIZE'] ?? 0),
            'unseen' => !$has,
            'flagged' => in_array('\\Flagged', $flags, true),
            'answered' => in_array('\\Answered', $flags, true),
            'message_id' => $h['message_id'],
            'attachments' => [],
            'has_attachments' => (bool) ($h['maybe_attachments'] ?? false),
        ];
    }

    public static function messages(array $a, string $folder, int $page, int $perPage, string $q, bool $flagged): array
    {
        $c = self::open($a);
        $exists = $c->select($folder, true);
        $crit = [];
        $literal = null;
        if ($q !== '') {
            [$key, $val] = preg_match('/^from:(.+)$/i', $q, $m) ? ['FROM', trim($m[1])] : (preg_match('/^subject:(.+)$/i', $q, $m) ? ['SUBJECT', trim($m[1])] : ['TEXT', $q]);
            if (preg_match('/[^\x20-\x7E]/', $val)) {
                $literal = $val; // non-ASCII: sent as a UTF-8 literal
                $crit[] = $key . ' ';
            } else {
                $crit[] = $key . ' ' . ImapClient::astring($val);
            }
        }
        if ($flagged) {
            array_unshift($crit, 'FLAGGED');
        }
        if ($crit) {
            $uids = $c->uidSearch(implode(' ', $crit), $literal);
            rsort($uids);
            $total = count($uids);
            $slice = array_slice($uids, ($page - 1) * $perPage, $perPage);
            $rows = $slice ? $c->fetch(implode(',', $slice), 'UID FLAGS INTERNALDATE RFC822.SIZE ' . self::LIST_HEADERS) : [];
        } else {
            $total = $exists;
            $to = $exists - ($page - 1) * $perPage;
            $from = max(1, $to - $perPage + 1);
            $rows = $to >= 1 ? $c->fetch($from . ':' . $to, 'UID FLAGS INTERNALDATE RFC822.SIZE ' . self::LIST_HEADERS, false) : [];
        }
        krsort($rows);
        // Pages follow arrival order (Gmail has no server-side SORT); within a page, newest date first.
        $items = array_values(array_map(static fn($f) => self::present($f, $folder), $rows));
        usort($items, static fn($x, $y) => strcmp($y['date'], $x['date']) ?: $y['uid'] <=> $x['uid']);
        return [
            'items' => $items,
            'page' => $page,
            'per_page' => $perPage,
            'total' => $total,
            'pages' => max(1, (int) ceil($total / $perPage)),
        ];
    }

    /** Whole message, parsed. Marks it read unless $peek. */
    public static function message(array $a, string $folder, int $uid, bool $peek = true): array
    {
        $c = self::open($a);
        $c->select($folder, $peek);
        $meta = $c->fetch((string) $uid, 'UID RFC822.SIZE');
        if (!$meta) {
            throw new HttpException('Not found in the mailbox — it may have been moved or deleted.', 404);
        }
        if ((int) ($meta[$uid]['RFC822.SIZE'] ?? 0) > self::MAX_MESSAGE_BYTES) {
            throw new HttpException('This message is larger than 40 MB and cannot be opened in the app.', 413);
        }
        $f = $c->fetch((string) $uid, 'UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[]')[$uid] ?? null;
        if (!$f) {
            throw new HttpException('Not found in the mailbox — it may have been moved or deleted.', 404);
        }
        $raw = (string) ($f['BODY[]'] ?? '');
        $p = MimeParser::parse($raw);
        $m = self::present($f, $folder, $p);
        $m['attachments'] = array_map(static fn($x) => ['id' => $x['id'], 'name' => $x['filename'], 'type' => $x['type'], 'size' => $x['size'], 'inline' => $x['inline'], 'cid' => $x['cid']], $p['attachments']);
        $m['has_attachments'] = (bool) array_filter($m['attachments'], static fn($x) => !$x['inline']);
        if (!$peek && $m['unseen']) {
            try {
                $c->uidStore([$uid], '+', ['\\Seen']);
                $m['unseen'] = false;
            } catch (HttpException) {
                // Reading still works if the flag update fails.
            }
        }
        return ['meta' => $m, 'text' => $p['text'], 'html' => $p['html'], 'parts' => $p['attachments'], 'raw' => $raw, 'parsed' => $p];
    }

    public static function setFlags(array $a, string $folder, array $uids, array $add, array $remove): void
    {
        $c = self::open($a);
        $c->select($folder);
        if ($add) {
            $c->uidStore($uids, '+', $add);
        }
        if ($remove) {
            $c->uidStore($uids, '-', $remove);
        }
    }

    public static function move(array $a, string $folder, array $uids, string $target): void
    {
        $c = self::open($a);
        $c->select($folder);
        $c->uidMove($uids, $target);
    }

    public static function delete(array $a, string $folder, array $uids): void
    {
        $c = self::open($a);
        $c->select($folder);
        $c->uidDelete($uids);
    }

    // ------------------------------------------------------------ sending

    /**
     * Send through the account's SMTP server and keep a copy in its Sent folder
     * (Gmail stores sent mail itself, so it is skipped there).
     *
     * @param array $msg to, cc, bcc, subject, text, html, attachments [[filename, content(binary), contentType]], in_reply_to, references
     */
    public static function send(array $a, array $msg): void
    {
        if (!$a['smtp_host'] || !$a['smtp_port']) {
            throw new HttpException('This mailbox has no outgoing (SMTP) server. Add it in Mail settings.', 422, ['smtp' => true]);
        }
        $addr = MailNet::resolve($a['smtp_host']);
        $mail = new PHPMailer(true);
        try {
            $mail->isSMTP();
            $mail->Host = trim($addr, '[]');
            $mail->Port = (int) $a['smtp_port'];
            $mail->SMTPAuth = true;
            $mail->Username = $a['username'];
            $mail->Password = Crypto::decrypt((string) $a['password_enc']) ?? '';
            $mail->SMTPSecure = match ($a['smtp_security']) { 'ssl' => PHPMailer::ENCRYPTION_SMTPS, 'tls' => PHPMailer::ENCRYPTION_STARTTLS, default => '' };
            $mail->SMTPAutoTLS = $a['smtp_security'] !== 'none';
            $verify = (bool) Config::get('imap.verify_peer', true);
            $mail->SMTPOptions = ['ssl' => array_filter(['verify_peer' => $verify, 'verify_peer_name' => $verify, 'peer_name' => $a['smtp_host'], 'cafile' => Config::get('imap.cafile')], static fn($v) => $v !== null)];
            $mail->Timeout = 25;
            $mail->CharSet = PHPMailer::CHARSET_UTF8;
            $mail->setFrom($a['email'], (string) ($a['display_name'] ?: ''));
            foreach ($msg['to'] as $x) {
                $mail->addAddress($x);
            }
            foreach ($msg['cc'] as $x) {
                $mail->addCC($x);
            }
            foreach ($msg['bcc'] as $x) {
                $mail->addBCC($x);
            }
            $mail->Subject = $msg['subject'];
            $mail->isHTML(true);
            $mail->Body = $msg['html'];
            $mail->AltBody = $msg['text'];
            if (!empty($msg['in_reply_to'])) {
                $mail->addCustomHeader('In-Reply-To', $msg['in_reply_to']);
                $mail->addCustomHeader('References', trim(($msg['references'] ?? '') . ' ' . $msg['in_reply_to']));
            }
            foreach ($msg['attachments'] as $att) {
                $mail->addStringAttachment($att['content'], $att['filename'], PHPMailer::ENCODING_BASE64, $att['contentType']);
            }
            $mail->send();
        } catch (\PHPMailer\PHPMailer\Exception $e) {
            $err = $mail->ErrorInfo ?: $e->getMessage();
            throw new HttpException('Sending failed: ' . $err . (stripos($err, 'authenticate') !== false && $a['provider'] === 'gmail' ? ' — use a Gmail App Password.' : ''), 502);
        }
        if ($a['provider'] !== 'gmail') {
            try {
                $c = self::open($a);
                foreach ($c->listFolders() as $f) {
                    if (self::special($f['flags'], ImapClient::decodeName($f['name'])) === '\\Sent') {
                        $c->append($f['name'], $mail->getSentMIMEMessage());
                        break;
                    }
                }
            } catch (HttpException) {
                // The message was sent; only the copy in "Sent" failed.
            }
        }
    }
}
