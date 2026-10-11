<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * RFC 5322 / MIME message parser for the IMAP mailbox: headers (RFC 2047 encoded words), addresses,
 * multipart trees, transfer encodings, charsets and attachment names (RFC 2231).
 */
final class MimeParser
{
    private const MAX_DEPTH = 12;

    /** @return array<string, string[]> lower-case header name => values (unfolded, still encoded) */
    public static function headers(string $block): array
    {
        $block = preg_replace("/\r\n[ \t]+|\n[ \t]+/", ' ', str_replace("\r\n", "\n", $block)) ?? $block;
        $out = [];
        foreach (explode("\n", $block) as $line) {
            $p = strpos($line, ':');
            if ($p === false || $p === 0) {
                continue;
            }
            $out[strtolower(trim(substr($line, 0, $p)))][] = trim(substr($line, $p + 1));
        }
        return $out;
    }

    public static function decodeHeader(?string $v): string
    {
        if ($v === null || $v === '') {
            return '';
        }
        if (!str_contains($v, '=?')) {
            return self::toUtf8($v, 'UTF-8');
        }
        // Adjacent encoded words are joined without the whitespace between them (RFC 2047 §6.2).
        $v = preg_replace('/(=\?[^?]+\?[bqBQ]\?[^?]*\?=)\s+(?==\?)/', '$1', $v) ?? $v;
        $out = preg_replace_callback('/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/', static function ($m) {
            $charset = preg_replace('/\*.*$/', '', $m[1]) ?? 'UTF-8';
            $data = strtoupper($m[2]) === 'B' ? (string) base64_decode($m[3]) : quoted_printable_decode(str_replace('_', ' ', $m[3]));
            return self::toUtf8($data, $charset);
        }, $v);
        return $out ?? $v;
    }

    public static function toUtf8(string $s, ?string $charset): string
    {
        $cs = strtoupper(trim((string) $charset, " \"'"));
        if ($cs === '' || $cs === 'US-ASCII' || $cs === 'ASCII') {
            $cs = 'UTF-8';
        }
        if ($cs === 'UTF-8' || $cs === 'UTF8') {
            return mb_check_encoding($s, 'UTF-8') ? $s : (mb_convert_encoding($s, 'UTF-8', 'Windows-1252') ?: '');
        }
        $aliases = ['LATIN1' => 'ISO-8859-1', 'CP1252' => 'Windows-1252', 'WIN-1252' => 'Windows-1252', 'GB2312' => 'GB18030', 'GBK' => 'GB18030', 'KS_C_5601-1987' => 'CP949'];
        $cs = $aliases[$cs] ?? $cs;
        $r = @mb_convert_encoding($s, 'UTF-8', $cs);
        if ($r === false || $r === '' && $s !== '') {
            $r = @iconv($cs, 'UTF-8//IGNORE', $s);
        }
        return is_string($r) && $r !== '' ? $r : (mb_convert_encoding($s, 'UTF-8', 'Windows-1252') ?: '');
    }

    /** "Name <a@b>, "Last, First" <c@d>, e@f" → [['name' => .., 'address' => ..], ...] */
    public static function addresses(?string $v): array
    {
        $v = self::decodeHeader($v);
        if (trim($v) === '') {
            return [];
        }
        $parts = [];
        $buf = '';
        $q = false;
        $angle = 0;
        for ($i = 0, $n = strlen($v); $i < $n; $i++) {
            $c = $v[$i];
            if ($c === '"' && ($i === 0 || $v[$i - 1] !== '\\')) {
                $q = !$q;
            } elseif (!$q && $c === '<') {
                $angle++;
            } elseif (!$q && $c === '>') {
                $angle--;
            }
            if (!$q && $angle <= 0 && ($c === ',' || $c === ';')) {
                $parts[] = $buf;
                $buf = '';
                continue;
            }
            $buf .= $c;
        }
        $parts[] = $buf;
        $out = [];
        foreach ($parts as $p) {
            $p = trim($p);
            if ($p === '') {
                continue;
            }
            if (preg_match('/^(.*)<([^>]+)>\s*$/s', $p, $m)) {
                $name = trim(trim($m[1]), '"');
                $addr = trim($m[2]);
            } else {
                $name = '';
                $addr = trim($p, '<> ');
            }
            $name = str_replace('\\"', '"', $name);
            if ($addr !== '') {
                $out[] = ['name' => $name !== '' && $name !== $addr ? $name : null, 'address' => $addr];
            }
        }
        return $out;
    }

    /** Content-Type / Content-Disposition value → [value, params] (RFC 2231 continuations & charsets). */
    public static function params(?string $v): array
    {
        $v = (string) $v;
        $semi = strpos($v, ';');
        $main = strtolower(trim($semi === false ? $v : substr($v, 0, $semi)));
        $params = [];
        $ext = [];
        if ($semi !== false && preg_match_all('/;\s*([^=\s;]+)\s*=\s*("((?:[^"\\\\]|\\\\.)*)"|[^;]*)/s', $v, $mm, PREG_SET_ORDER)) {
            foreach ($mm as $m) {
                $name = strtolower($m[1]);
                $val = isset($m[3]) && $m[2] !== '' && $m[2][0] === '"' ? stripcslashes($m[3]) : trim($m[2]);
                if (preg_match('/^([^*]+)\*(\d+)?(\*)?$/', $name, $pm)) {
                    $ext[$pm[1]][(int) ($pm[2] ?? 0)] = [$val, isset($pm[3]) || ($pm[2] ?? '') === ''];
                } else {
                    $params[$name] = self::decodeHeader($val);
                }
            }
        }
        foreach ($ext as $name => $pieces) {
            ksort($pieces);
            $charset = 'UTF-8';
            $joined = '';
            foreach ($pieces as $idx => [$val, $encoded]) {
                if ($encoded) {
                    if ($idx === 0 && preg_match("/^([^']*)'[^']*'(.*)$/s", $val, $cm)) {
                        $charset = $cm[1] ?: 'UTF-8';
                        $val = $cm[2];
                    }
                    $val = rawurldecode($val);
                }
                $joined .= $val;
            }
            $params[$name] = self::toUtf8($joined, $charset);
        }
        return [$main, $params];
    }

    /**
     * Full message → ['subject', 'from', 'to', 'cc', 'date', 'message_id', 'in_reply_to', 'references',
     *                  'text', 'html', 'attachments' => [['id', 'filename', 'type', 'size', 'inline', 'cid', 'data']]]
     */
    public static function parse(string $raw): array
    {
        [$head, $body] = self::split($raw);
        $h = self::headers($head);
        $msg = self::summary($h);
        $msg += ['text' => null, 'html' => null, 'attachments' => []];
        self::walk($h, $body, '1', $msg, 0);
        return $msg;
    }

    /** Envelope fields from parsed headers (used for message lists, where only headers are fetched). */
    public static function summary(array $h): array
    {
        $date = $h['date'][0] ?? '';
        $ts = $date !== '' ? strtotime(preg_replace('/\s*\([^)]*\)\s*$/', '', $date) ?? $date) : false;
        $from = self::addresses($h['from'][0] ?? null);
        [$ct] = self::params($h['content-type'][0] ?? 'text/plain');
        return [
            'subject' => self::decodeHeader($h['subject'][0] ?? ''),
            'from' => $from[0] ?? null,
            'to' => self::addresses(implode(', ', $h['to'] ?? [])),
            'cc' => self::addresses(implode(', ', $h['cc'] ?? [])),
            'date' => $ts ? gmdate('Y-m-d\TH:i:s\Z', $ts) : '',
            'message_id' => trim($h['message-id'][0] ?? '') ?: null,
            'in_reply_to' => trim($h['in-reply-to'][0] ?? '') ?: null,
            'references' => trim($h['references'][0] ?? '') ?: null,
            'maybe_attachments' => $ct === 'multipart/mixed',
        ];
    }

    private static function split(string $raw): array
    {
        $p = strpos($raw, "\r\n\r\n");
        $q = strpos($raw, "\n\n");
        if ($p !== false && ($q === false || $p <= $q)) {
            return [substr($raw, 0, $p), substr($raw, $p + 4)];
        }
        if ($q !== false) {
            return [substr($raw, 0, $q), substr($raw, $q + 2)];
        }
        return [$raw, ''];
    }

    private static function walk(array $h, string $body, string $path, array &$msg, int $depth): void
    {
        [$type, $ct] = self::params($h['content-type'][0] ?? 'text/plain; charset=us-ascii');
        [$disp, $dp] = self::params($h['content-disposition'][0] ?? '');
        if ($depth > self::MAX_DEPTH) {
            return;
        }
        if (str_starts_with($type, 'multipart/') && !empty($ct['boundary'])) {
            $i = 0;
            foreach (self::parts($body, $ct['boundary']) as $part) {
                [$ph, $pb] = self::split($part);
                self::walk(self::headers($ph), $pb, $path . '.' . ++$i, $msg, $depth + 1);
            }
            return;
        }
        $data = self::decodeBody($body, strtolower(trim($h['content-transfer-encoding'][0] ?? '7bit')));
        $name = $dp['filename'] ?? $ct['name'] ?? null;
        $cid = isset($h['content-id'][0]) ? trim($h['content-id'][0], '<> ') : null;
        $isText = ($type === 'text/plain' || $type === 'text/html') && $disp !== 'attachment' && $name === null;
        if ($isText && $type === 'text/plain' && $msg['text'] === null) {
            $msg['text'] = self::toUtf8($data, $ct['charset'] ?? 'UTF-8');
            return;
        }
        if ($isText && $type === 'text/html' && $msg['html'] === null) {
            $msg['html'] = self::toUtf8($data, $ct['charset'] ?? 'UTF-8');
            return;
        }
        if ($type === 'message/rfc822' && !$name) {
            $inner = self::headers(self::split($data)[0]);
            $name = (self::decodeHeader($inner['subject'][0] ?? '') ?: 'message') . '.eml';
        }
        $msg['attachments'][] = [
            'id' => $path,
            'filename' => Uploader::cleanName($name ?: ($cid ? 'image-' . $path : 'attachment-' . $path) . self::extFor($type, $name)),
            'type' => $type ?: 'application/octet-stream',
            'size' => strlen($data),
            'inline' => $disp === 'inline' || ($disp === '' && $cid !== null),
            'cid' => $cid,
            'data' => $data,
        ];
    }

    private static function extFor(string $type, ?string $name): string
    {
        if ($name) {
            return '';
        }
        return ['image/png' => '.png', 'image/jpeg' => '.jpg', 'image/gif' => '.gif', 'image/webp' => '.webp', 'application/pdf' => '.pdf', 'text/plain' => '.txt', 'text/html' => '.html', 'text/calendar' => '.ics'][$type] ?? '';
    }

    /** Split a multipart body on its boundary lines (preamble and epilogue are dropped). */
    private static function parts(string $body, string $boundary): array
    {
        $d = '--' . $boundary;
        $out = [];
        $cur = null;
        foreach (preg_split("/\r?\n/", $body) ?: [] as $line) {
            $t = rtrim($line, " \t");
            if ($t === $d || $t === $d . '--') {
                if ($cur !== null) {
                    $out[] = implode("\r\n", $cur);
                }
                if ($t !== $d) {
                    return $out; // closing delimiter
                }
                $cur = [];
                continue;
            }
            if ($cur !== null) {
                $cur[] = $line;
            }
        }
        if ($cur) {
            $out[] = implode("\r\n", $cur); // no closing delimiter (truncated message)
        }
        return $out;
    }

    private static function decodeBody(string $body, string $enc): string
    {
        return match ($enc) {
            'base64' => (string) base64_decode(preg_replace('/[^A-Za-z0-9+\/=]/', '', $body) ?? ''),
            'quoted-printable' => quoted_printable_decode(preg_replace("/=\r?\n/", '', $body) ?? $body),
            default => $body,
        };
    }
}
