<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Admin mailbox: read and answer the company mailbox through the Hostinger Mail API.
 * Restricted to the full "admin" role — delegated admin permissions do not grant mailbox access.
 */
final class MailController
{
    private const PER_PAGE = 30;
    private const FLAGS = ['\\Seen', '\\Flagged'];
    private const MAX_SEND_BYTES = 20 * 1024 * 1024;

    private static function guard(): array
    {
        $u = Auth::require();
        if (!Auth::isAdmin()) {
            throw new HttpException('Only administrators can open the mailbox.', 403);
        }
        return $u;
    }

    private static function mailbox(mixed $v): string
    {
        $id = is_string($v) ? trim($v) : '';
        if ($id === '') {
            $id = (string) Settings::get('hmail_default_mailbox', '');
            if ($id === '') {
                $id = HostingerMail::mailboxes()[0]['resourceId'] ?? '';
            }
        }
        if (!preg_match('/^AC[A-Za-z0-9]{1,60}$/', $id)) {
            throw new HttpException('Choose a mailbox first.', 422);
        }
        return $id;
    }

    private static function folder(mixed $v): string
    {
        $f = is_string($v) ? trim($v) : '';
        if ($f === '' || strlen($f) > 200 || preg_match('/[\x00-\x1F]/', $f)) {
            throw new HttpException('Invalid folder.', 422);
        }
        return $f;
    }

    private static function uids(mixed $v): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', is_array($v) ? $v : [$v]), static fn($x) => $x > 0)));
        if (!$ids || count($ids) > 100) {
            throw new HttpException('Select between 1 and 100 messages.', 422);
        }
        return $ids;
    }

    private static function addrs(mixed $v): array
    {
        // Separators: comma, semicolon or newline (spaces belong to display names like "Budi <b@x.id>").
        $parts = is_array($v) ? $v : preg_split('/[,;\r\n]+/', (string) $v);
        $out = [];
        foreach ($parts as $p) {
            $p = trim((string) $p);
            if ($p === '') {
                continue;
            }
            // Accept "Name <addr@x>" as typed in the compose form.
            if (preg_match('/<([^>]+)>/', $p, $m)) {
                $p = trim($m[1]);
            }
            if (!filter_var($p, FILTER_VALIDATE_EMAIL)) {
                throw new HttpException('Invalid e-mail address: ' . $p, 422, ['address' => $p]);
            }
            $out[strtolower($p)] = $p;
        }
        if (count($out) > 50) {
            throw new HttpException('Too many recipients (max 50).', 422);
        }
        return array_values($out);
    }

    private static function present(array $m): array
    {
        $atts = [];
        foreach ((array) ($m['attachments'] ?? []) as $a) {
            $atts[] = [
                'id' => (string) ($a['id'] ?? ''),
                'name' => (string) (($a['filename'] ?? '') ?: 'attachment'),
                'type' => (string) ($a['contentType'] ?? 'application/octet-stream'),
                'size' => (int) ($a['sizeBytes'] ?? 0),
                'inline' => (bool) ($a['inline'] ?? false),
                'cid' => isset($a['contentId']) ? trim((string) $a['contentId'], '<> ') : null,
            ];
        }
        $flags = array_values(array_filter((array) ($m['flags'] ?? []), 'is_string'));
        return [
            'uid' => (int) ($m['uid'] ?? 0),
            'folder' => (string) ($m['path'] ?? ''),
            'date' => (string) ($m['date'] ?? ''),
            'subject' => (string) ($m['subject'] ?? ''),
            'from' => $m['from'] ?? null,
            'to' => (array) ($m['to'] ?? []),
            'cc' => (array) ($m['cc'] ?? []),
            'bcc' => (array) ($m['bcc'] ?? []),
            'size' => (int) ($m['size'] ?? 0),
            'unseen' => (bool) ($m['unseen'] ?? !in_array('\\Seen', $flags, true)),
            'flagged' => in_array('\\Flagged', $flags, true),
            'answered' => in_array('\\Answered', $flags, true),
            'message_id' => $m['messageId'] ?? null,
            'attachments' => $atts,
            'has_attachments' => (bool) array_filter($atts, static fn($a) => !$a['inline']),
        ];
    }

    // ------------------------------------------------------------ connection

    public static function status(): void
    {
        self::guard();
        $out = [
            'configured' => HostingerMail::configured(),
            'source' => HostingerMail::tokenSource(),
            'token_hint' => HostingerMail::configured() ? '••••' . substr(HostingerMail::token(), -4) : null,
            'default_mailbox' => (string) Settings::get('hmail_default_mailbox', ''),
            'display_name' => (string) Settings::get('hmail_display_name', Settings::get('app_name', 'SmartNotes')),
            'mailboxes' => [],
            'error' => null,
        ];
        if ($out['configured']) {
            try {
                $out['mailboxes'] = HostingerMail::mailboxes(Http::query('refresh') === '1');
            } catch (HttpException $e) {
                $out['error'] = $e->getMessage();
            }
        }
        Http::ok($out);
    }

    public static function saveSettings(): void
    {
        self::guard();
        $token = Http::input('token');
        if (is_string($token) && trim($token) !== '') {
            if (HostingerMail::tokenSource() === 'config') {
                throw new HttpException('The token is defined in app/config.php. Edit that file to change it.', 422);
            }
            $token = trim($token);
            if (strlen($token) > 2000 || preg_match('/\s/', $token)) {
                throw new HttpException('That does not look like an API token.', 422, ['token' => true]);
            }
            // Only store a token Hostinger actually accepts.
            $boxes = HostingerMail::mailboxes(true, $token);
            Settings::set('hmail_token', $token);
            unset($_SESSION['hmail_me']);
            Activity::log('admin.mail_token', null, null, 'Connected Hostinger Mail API (' . count($boxes) . ' mailbox(es))');
        } elseif (V::bool(Http::input('disconnect'))) {
            Settings::set('hmail_token', '');
            Settings::set('hmail_default_mailbox', '');
            unset($_SESSION['hmail_me']);
            Activity::log('admin.mail_token', null, null, 'Disconnected Hostinger Mail API');
        }
        if (Http::has('default_mailbox')) {
            $mb = (string) Http::input('default_mailbox');
            if ($mb !== '' && !preg_match('/^AC[A-Za-z0-9]{1,60}$/', $mb)) {
                throw new HttpException('Invalid mailbox.', 422);
            }
            Settings::set('hmail_default_mailbox', $mb);
        }
        if (Http::has('display_name')) {
            Settings::set('hmail_display_name', V::str(Http::input('display_name'), 120) ?? '');
        }
        self::status();
    }

    // ------------------------------------------------------------ reading

    public static function folders(): void
    {
        self::guard();
        $box = HostingerMail::box(self::mailbox(Http::query('mailbox')));
        $items = [];
        for ($page = 1; $page <= 5; $page++) {
            $r = HostingerMail::call('GET', $box . '/folders', ['page' => $page, 'perPage' => 100]);
            foreach ((array) ($r['data'] ?? []) as $f) {
                $items[] = [
                    'path' => (string) ($f['path'] ?? ''),
                    'name' => (string) ($f['name'] ?? $f['path'] ?? ''),
                    'delimiter' => (string) ($f['delimiter'] ?? '.'),
                    'special' => $f['specialUse'] ?? null,
                    'total' => (int) ($f['messageCount'] ?? 0),
                    'unread' => (int) ($f['unreadCount'] ?? 0),
                ];
            }
            if ($page >= (int) ($r['pagination']['totalPages'] ?? 1)) {
                break;
            }
        }
        $order = ['INBOX' => 0, '\\Drafts' => 2, '\\Sent' => 3, '\\Archive' => 4, '\\Junk' => 5, '\\Trash' => 6];
        usort($items, static function ($a, $b) use ($order) {
            $ra = strtoupper($a['path']) === 'INBOX' ? 0 : ($order[$a['special'] ?? ''] ?? 10);
            $rb = strtoupper($b['path']) === 'INBOX' ? 0 : ($order[$b['special'] ?? ''] ?? 10);
            return $ra <=> $rb ?: strcasecmp($a['path'], $b['path']);
        });
        $quota = null;
        try {
            $q = HostingerMail::call('GET', $box . '/quota')['data'] ?? null;
            if (is_array($q) && !empty($q['supported'])) {
                $quota = ['used' => (int) $q['totalUsage'], 'limit' => (int) $q['totalLimit'], 'percent' => (int) $q['totalPercentage']];
            }
        } catch (HttpException) {
            // Quota is informational only.
        }
        Http::ok(['items' => $items, 'quota' => $quota]);
    }

    public static function messages(): void
    {
        self::guard();
        $path = HostingerMail::folderPath(self::mailbox(Http::query('mailbox')), self::folder(Http::query('folder', 'INBOX')));
        $page = max(1, min(10000, (int) Http::query('page', 1)));
        $query = ['page' => $page, 'perPage' => self::PER_PAGE, 'sort' => '-date'];
        $q = trim((string) Http::query('q', ''));
        if ($q !== '' || Http::query('flagged') === '1') {
            $crit = [];
            if ($q !== '') {
                $q = mb_substr($q, 0, 200);
                if (preg_match('/^from:(.+)$/i', $q, $m)) {
                    $crit['from'] = trim($m[1]);
                } elseif (preg_match('/^subject:(.+)$/i', $q, $m)) {
                    $crit['subject'] = trim($m[1]);
                } else {
                    $crit['text'] = $q;
                }
            }
            if (Http::query('flagged') === '1') {
                $crit['flags'] = ['\\Flagged'];
            }
            $r = HostingerMail::call('POST', $path . '/messages/search', $query, $crit);
        } else {
            $r = HostingerMail::call('GET', $path . '/messages', $query);
        }
        $items = array_map([self::class, 'present'], (array) ($r['data'] ?? []));
        $p = (array) ($r['pagination'] ?? []);
        Http::ok([
            'items' => $items,
            'page' => (int) ($p['page'] ?? $page),
            'per_page' => (int) ($p['perPage'] ?? self::PER_PAGE),
            'total' => (int) ($p['total'] ?? count($items)),
            'pages' => (int) ($p['totalPages'] ?? 1),
        ]);
    }

    public static function message(): void
    {
        self::guard();
        $mb = self::mailbox(Http::query('mailbox'));
        $folder = self::folder(Http::query('folder'));
        $uid = V::int(Http::query('uid'), 1) ?? throw new HttpException('Invalid message.', 422);
        $base = HostingerMail::folderPath($mb, $folder) . '/messages/' . $uid;
        $m = self::present((array) (HostingerMail::call('GET', $base)['data'] ?? []));
        $t = (array) (HostingerMail::call('GET', $base . '/text')['data'] ?? []);
        $doc = MailHtml::document($t['html'] ?? '', (string) ($t['text'] ?? ''), false, self::inlineImages($base, $m['attachments'], (string) ($t['html'] ?? '')));
        if ($m['unseen'] && Http::query('peek') !== '1') {
            try {
                HostingerMail::call('PATCH', $base, [], ['addFlags' => ['\\Seen']]);
                $m['unseen'] = false;
            } catch (HttpException) {
                // Reading still works if the flag update fails.
            }
        }
        $m['text'] = (string) ($t['text'] ?? '');
        $m['html_doc'] = $doc['html'];
        $m['remote_images'] = $doc['remote'];
        Http::ok($m);
    }

    /** Stand-alone HTML document with remote images allowed ("Show images"). Loaded into a sandboxed iframe. */
    public static function html(): void
    {
        self::guard();
        $mb = self::mailbox(Http::query('mailbox'));
        $folder = self::folder(Http::query('folder'));
        $uid = V::int(Http::query('uid'), 1) ?? throw new HttpException('Invalid message.', 422);
        $base = HostingerMail::folderPath($mb, $folder) . '/messages/' . $uid;
        $m = self::present((array) (HostingerMail::call('GET', $base)['data'] ?? []));
        $t = (array) (HostingerMail::call('GET', $base . '/text')['data'] ?? []);
        $doc = MailHtml::document($t['html'] ?? '', (string) ($t['text'] ?? ''), true, self::inlineImages($base, $m['attachments'], (string) ($t['html'] ?? '')));
        while (ob_get_level()) {
            ob_end_clean();
        }
        header('Content-Type: text/html; charset=utf-8');
        header('Content-Security-Policy: ' . MailHtml::csp(true));
        header('Referrer-Policy: no-referrer');
        header('Cache-Control: private, no-store');
        echo $doc['html'];
        exit;
    }

    /** Inline (cid:) images become data: URIs so the document needs no further requests. */
    private static function inlineImages(string $base, array $atts, string $html): array
    {
        if (stripos($html, 'cid:') === false) {
            return [];
        }
        $out = [];
        $n = 0;
        foreach ($atts as $a) {
            if (!$a['cid'] || !preg_match('#^image/(png|jpe?g|gif|webp)$#i', $a['type']) || $a['size'] > 1_500_000 || ++$n > 8) {
                continue;
            }
            try {
                $bin = HostingerMail::binary($base . '/attachments/' . rawurlencode($a['id']));
                $out[$a['cid']] = 'data:' . strtolower($a['type']) . ';base64,' . base64_encode($bin['body']);
            } catch (HttpException) {
                continue;
            }
        }
        return $out;
    }

    public static function attachment(): void
    {
        self::guard();
        [$base, $a, $bin] = self::fetchAttachment();
        while (ob_get_level()) {
            ob_end_clean();
        }
        $type = strtolower($a['type']);
        $inlineOk = Http::query('dl') !== '1' && (preg_match('#^image/(png|jpe?g|gif|webp)$#', $type) || $type === 'application/pdf');
        // Never let an attachment run as a page of our origin (HTML, SVG …): download only, sandboxed.
        header('X-Content-Type-Options: nosniff');
        header($type === 'application/pdf' && $inlineOk ? "Content-Security-Policy: frame-ancestors 'self'" : "Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
        header('Content-Type: ' . ($inlineOk ? $type : 'application/octet-stream'));
        header('Content-Disposition: ' . ($inlineOk ? 'inline' : 'attachment') . '; filename="' . addcslashes(preg_replace('/[^\x20-\x7E]/', '_', $a['name']) ?? 'file', '"\\') . "\"; filename*=UTF-8''" . rawurlencode($a['name']));
        header('Content-Length: ' . strlen($bin));
        header('Cache-Control: private, max-age=600');
        echo $bin;
        exit;
    }

    /** @return array{0:string,1:array,2:string} */
    private static function fetchAttachment(): array
    {
        $in = static fn(string $k) => Http::method() === 'POST' ? Http::input($k) : Http::query($k);
        $mb = self::mailbox($in('mailbox'));
        $folder = self::folder($in('folder'));
        $uid = V::int($in('uid'), 1) ?? throw new HttpException('Invalid message.', 422);
        $id = (string) $in('id');
        if ($id === '' || strlen($id) > 500) {
            throw new HttpException('Invalid attachment.', 422);
        }
        $base = HostingerMail::folderPath($mb, $folder) . '/messages/' . $uid;
        $m = self::present((array) (HostingerMail::call('GET', $base)['data'] ?? []));
        foreach ($m['attachments'] as $a) {
            if ($a['id'] === $id) {
                $a['subject'] = $m['subject'];
                $a['from'] = $m['from']['address'] ?? '';
                return [$base, $a, HostingerMail::binary($base . '/attachments/' . rawurlencode($id))['body']];
            }
        }
        throw new HttpException('Attachment not found.', 404);
    }

    public static function source(): void
    {
        self::guard();
        $mb = self::mailbox(Http::query('mailbox'));
        $folder = self::folder(Http::query('folder'));
        $uid = V::int(Http::query('uid'), 1) ?? throw new HttpException('Invalid message.', 422);
        $bin = HostingerMail::binary(HostingerMail::folderPath($mb, $folder) . '/messages/' . $uid . '/source')['body'];
        while (ob_get_level()) {
            ob_end_clean();
        }
        header('X-Content-Type-Options: nosniff');
        header("Content-Security-Policy: default-src 'none'; sandbox");
        header('Content-Type: message/rfc822');
        header('Content-Disposition: attachment; filename="message-' . $uid . '.eml"');
        header('Content-Length: ' . strlen($bin));
        echo $bin;
        exit;
    }

    // ------------------------------------------------------------ changes

    public static function flags(): void
    {
        self::guard();
        $path = HostingerMail::folderPath(self::mailbox(Http::input('mailbox')), self::folder(Http::input('folder')));
        $add = array_values(array_intersect((array) Http::input('add', []), self::FLAGS));
        $remove = array_values(array_intersect((array) Http::input('remove', []), self::FLAGS));
        if (!$add && !$remove) {
            throw new HttpException('Nothing to change.', 422);
        }
        $body = ['uids' => self::uids(Http::input('uids'))];
        if ($add) {
            $body['addFlags'] = $add;
        }
        if ($remove) {
            $body['removeFlags'] = $remove;
        }
        $r = HostingerMail::call('POST', $path . '/messages/flags', [], $body);
        Http::ok(['successful' => $r['data']['successful'] ?? $body['uids'], 'failed' => $r['data']['failed'] ?? []]);
    }

    public static function move(): void
    {
        self::guard();
        $folder = self::folder(Http::input('folder'));
        $target = self::folder(Http::input('target'));
        if ($target === $folder) {
            throw new HttpException('The message is already in that folder.', 422);
        }
        if (mb_strlen($target) > 100) {
            throw new HttpException('Folder name is too long.', 422);
        }
        $uids = self::uids(Http::input('uids'));
        $path = HostingerMail::folderPath(self::mailbox(Http::input('mailbox')), $folder);
        HostingerMail::call('POST', $path . '/messages/move', [], ['uids' => $uids, 'targetFolder' => $target]);
        Activity::log('mail.move', null, null, count($uids) . " message(s) from $folder to $target");
        Http::ok(['moved' => count($uids)]);
    }

    /** Permanent delete. The UI moves to Trash first and only offers this inside Trash/Junk. */
    public static function delete(): void
    {
        self::guard();
        $folder = self::folder(Http::input('folder'));
        $uids = self::uids(Http::input('uids'));
        $path = HostingerMail::folderPath(self::mailbox(Http::input('mailbox')), $folder);
        HostingerMail::call('POST', $path . '/messages/delete', [], ['uids' => $uids]);
        Activity::log('mail.delete', null, null, count($uids) . " message(s) permanently deleted from $folder");
        Http::ok(['deleted' => count($uids)]);
    }

    public static function send(): void
    {
        $u = self::guard();
        $mb = self::mailbox(Http::input('mailbox'));
        $box = HostingerMail::box($mb);
        $to = self::addrs(Http::input('to', ''));
        $cc = self::addrs(Http::input('cc', ''));
        $bcc = self::addrs(Http::input('bcc', ''));
        if (!$to && !$cc && !$bcc) {
            throw new HttpException('Add at least one recipient.', 422, ['to' => true]);
        }
        $subject = V::str(Http::input('subject'), 900) ?? '';
        $text = (string) Http::input('body', '');
        if (strlen($text) > 1_000_000) {
            throw new HttpException('The message is too long.', 422);
        }
        $html = '<div style="font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;white-space:pre-wrap">' . e($text) . '</div>';
        $mode = V::enum(Http::input('mode'), ['new', 'reply', 'forward'], 'new');

        $req = array_filter(['to' => $to, 'cc' => $cc, 'bcc' => $bcc]);
        $req['subject'] = $subject;
        $req['text'] = $text;
        $req['displayName'] = V::str(Http::input('display_name'), 120) ?: (string) Settings::get('hmail_display_name', Settings::get('app_name', 'SmartNotes'));
        $attachments = [];
        $total = 0;

        if ($mode !== 'new') {
            $refFolder = self::folder(Http::input('ref_folder'));
            $refUid = V::int(Http::input('ref_uid'), 1) ?? throw new HttpException('Invalid original message.', 422);
            $req[$mode === 'reply' ? 'inReplyTo' : 'forwardOf'] = ['uid' => $refUid, 'folder' => $refFolder];
            $base = $box . '/folders/' . rawurlencode($refFolder) . '/messages/' . $refUid;
            // The original text is quoted below the new message (fetched server-side, so it cannot be spoofed by the browser).
            $orig = self::present((array) (HostingerMail::call('GET', $base)['data'] ?? []));
            $ot = (array) (HostingerMail::call('GET', $base . '/text')['data'] ?? []);
            $from = $orig['from'] ? trim(($orig['from']['name'] ?? '') . ' <' . ($orig['from']['address'] ?? '') . '>') : '';
            $when = $orig['date'] ? date('D, j M Y H:i', strtotime($orig['date']) ?: time()) : '';
            if (V::bool(Http::input('include_original', 1))) {
                $head = $mode === 'reply' ? "On $when, $from wrote:" : "---------- Forwarded message ----------\nFrom: $from\nDate: $when\nSubject: {$orig['subject']}";
                $origText = (string) ($ot['text'] ?? '');
                $req['text'] .= "\n\n" . $head . "\n" . ($mode === 'reply' ? preg_replace('/^/m', '> ', $origText) : $origText);
                $origDoc = trim((string) ($ot['html'] ?? '')) !== ''
                    ? MailHtml::document($ot['html'], '', false)['html']
                    : null;
                $inner = $origDoc ? self::bodyOf($origDoc) : '<div style="white-space:pre-wrap">' . e($origText) . '</div>';
                $html .= '<br><div style="color:#57606a;font:13px Arial,sans-serif;white-space:pre-wrap">' . e($head) . '</div>'
                    . '<blockquote style="margin:6px 0 0 .6em;padding-left:.8em;border-left:3px solid #d0d7de">' . $inner . '</blockquote>';
            }
            if ($mode === 'forward' && V::bool(Http::input('forward_attachments', 1))) {
                foreach ($orig['attachments'] as $a) {
                    if ($a['inline']) {
                        continue;
                    }
                    $total += $a['size'];
                    if ($total > self::MAX_SEND_BYTES) {
                        throw new HttpException('The original attachments are larger than 20 MB — forward without attachments.', 422);
                    }
                    $bin = HostingerMail::binary($base . '/attachments/' . rawurlencode($a['id']))['body'];
                    $attachments[] = ['filename' => $a['name'], 'content' => base64_encode($bin), 'contentType' => $a['type']];
                }
            }
        }

        foreach (self::uploadedFiles() as $f) {
            $total += $f['size'];
            if ($total > self::MAX_SEND_BYTES) {
                throw new HttpException('Attachments are larger than 20 MB in total.', 422);
            }
            $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']) ?: 'application/octet-stream';
            $attachments[] = ['filename' => Uploader::cleanName($f['name']), 'content' => base64_encode((string) file_get_contents($f['tmp_name'])), 'contentType' => $mime];
        }
        foreach (V::ids(Http::input('drive_ids', [])) as $fid) {
            $r = DB::one('SELECT * FROM note_attachments WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [$fid, $u['id']]);
            if (!$r) {
                throw new HttpException('A Drive file could not be found.', 404);
            }
            $total += (int) $r['file_size'];
            if ($total > self::MAX_SEND_BYTES) {
                throw new HttpException('Attachments are larger than 20 MB in total.', 422);
            }
            $attachments[] = ['filename' => $r['original_name'], 'content' => base64_encode((string) file_get_contents(Uploader::absolute($r['file_path']))), 'contentType' => $r['mime_type']];
        }
        if ($attachments) {
            $req['attachments'] = $attachments;
        }
        $req['html'] = $html;

        HostingerMail::call('POST', $box . '/send', [], $req);
        Activity::log('mail.send', null, null, 'Sent "' . mb_substr($subject, 0, 120) . '" to ' . implode(', ', array_slice(array_merge($to, $cc, $bcc), 0, 5)));
        Http::ok(null, 'Message sent.');
    }

    private static function bodyOf(string $doc): string
    {
        $s = stripos($doc, '<body>');
        $e = strripos($doc, '</body>');
        return $s !== false && $e !== false ? substr($doc, $s + 6, $e - $s - 6) : '';
    }

    /** files[] from the multipart compose form. */
    private static function uploadedFiles(): array
    {
        $f = $_FILES['files'] ?? null;
        if (!$f || !is_array($f['name'] ?? null)) {
            return [];
        }
        $out = [];
        foreach ($f['name'] as $i => $name) {
            if (($f['error'][$i] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
                continue;
            }
            if ($f['error'][$i] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'][$i])) {
                throw new HttpException('An attachment could not be uploaded (' . ini_get('upload_max_filesize') . ' limit).', 422);
            }
            $out[] = ['name' => (string) $name, 'tmp_name' => $f['tmp_name'][$i], 'size' => (int) $f['size'][$i]];
        }
        if (count($out) > 10) {
            throw new HttpException('Attach at most 10 files.', 422);
        }
        return $out;
    }

    /** Copy an attachment into the admin's Drive (keeps important documents next to notes, findable by tag). */
    public static function saveToDrive(): void
    {
        $u = self::guard();
        [, $a, $bin] = self::fetchAttachment();
        $folderId = DriveController::ownedFolder(V::id(Http::input('folder_id')), $u['id']);
        ensure_dir(SN_STORAGE . '/tmp');
        $tmp = tempnam(SN_STORAGE . '/tmp', 'mail');
        if ($tmp === false || file_put_contents($tmp, $bin) === false) {
            throw new HttpException('Could not save the file.', 500);
        }
        try {
            $meta = Uploader::store(['name' => $a['name'], 'tmp_name' => $tmp, 'error' => UPLOAD_ERR_OK, 'size' => strlen($bin)], ['image', 'audio', 'document', 'archive'], 'u' . $u['id'], true, true);
        } finally {
            @unlink($tmp);
        }
        $from = $a['from'] ? ' — ' . $a['from'] : '';
        $id = DB::insert('note_attachments', [
            'user_id' => $u['id'],
            'file_name' => $meta['file_name'],
            'original_name' => $meta['original_name'],
            'file_path' => $meta['file_path'],
            'thumb_path' => $meta['thumb_path'],
            'mime_type' => $meta['mime_type'],
            'file_kind' => $meta['file_kind'],
            'file_size' => $meta['file_size'],
            'file_hash' => $meta['file_hash'],
            'width' => $meta['width'],
            'height' => $meta['height'],
            'folder_id' => $folderId,
            'description' => mb_substr('From e-mail: ' . ($a['subject'] ?: '(no subject)') . $from, 0, 2000),
        ]);
        $tags = Http::input('tags');
        if ($tags) {
            TagsController::sync('file', $id, $u['id'], is_array($tags) ? $tags : explode(',', (string) $tags));
        }
        Activity::log('mail.save_to_drive', 'file', $id, $meta['original_name']);
        Http::ok(FilesController::presentOne($id), 'Saved to Drive.');
    }
}
