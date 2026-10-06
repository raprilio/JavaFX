<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Turns an incoming e-mail's HTML into a safe standalone document for a sandboxed iframe.
 * E-mail layouts need tables, inline styles and <style> blocks, so this is a denylist pass;
 * the real containment is the iframe sandbox (no scripts, no forms) plus a strict CSP.
 * Remote images/CSS are removed unless the admin chose "Show images" (tracking pixels).
 */
final class MailHtml
{
    private const DROP = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'input', 'button', 'textarea', 'select',
        'meta', 'link', 'base', 'noscript', 'template', 'svg', 'math', 'audio', 'video', 'source', 'track', 'portal', 'title', 'head'];
    private const URL_ATTRS = ['href', 'src', 'background', 'poster', 'lowsrc', 'dynsrc', 'srcset', 'longdesc', 'action', 'formaction', 'xlink:href', 'cite', 'ping'];
    private const BASE_CSS = 'html{background:#fff}body{margin:0;padding:18px 20px;font:14px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1f2328;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}blockquote{margin:0 0 0 .6em;padding-left:.8em;border-left:3px solid #d0d7de;color:#57606a}a{color:#2563eb}.sn-plain{white-space:pre-wrap}';

    /**
     * @param array<string,string> $cid  content-id (without <>) => data: URI for inline images
     * @return array{html:string, remote:int}
     */
    public static function document(?string $html, string $text, bool $allowRemote, array $cid = []): array
    {
        $html = (string) $html;
        if (trim($html) === '') {
            $body = '<div class="sn-plain">' . self::linkify(e($text)) . '</div>';
            return ['html' => self::wrap('', $body), 'remote' => 0];
        }
        if (strlen($html) > 6 * 1024 * 1024) {
            $html = substr($html, 0, 6 * 1024 * 1024);
        }
        $doc = new DOMDocument('1.0', 'UTF-8');
        $prev = libxml_use_internal_errors(true);
        $doc->loadHTML('<?xml encoding="UTF-8"?>' . $html, LIBXML_NONET | LIBXML_COMPACT | LIBXML_HTML_NODEFDTD);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);

        $remote = 0;
        $styles = '';
        // <style> blocks may live in <head>; keep them (cleaned) before the head is dropped.
        foreach (iterator_to_array($doc->getElementsByTagName('style')) as $st) {
            $styles .= self::css($st->textContent, $allowRemote, $remote) . "\n";
            $st->parentNode?->removeChild($st);
        }
        foreach (self::DROP as $tag) {
            foreach (iterator_to_array($doc->getElementsByTagName($tag)) as $n) {
                $n->parentNode?->removeChild($n);
            }
        }
        // Forms: keep the visible content, drop the element (no submissions from e-mail).
        foreach (iterator_to_array($doc->getElementsByTagName('form')) as $f) {
            while ($f->firstChild) {
                $f->parentNode?->insertBefore($f->firstChild, $f);
            }
            $f->parentNode?->removeChild($f);
        }
        $xp = new DOMXPath($doc);
        foreach ($xp->query('//*') ?: [] as $el) {
            /** @var DOMElement $el */
            foreach (iterator_to_array($el->attributes) as $attr) {
                $name = strtolower($attr->nodeName);
                $val = trim($attr->nodeValue ?? '');
                if (str_starts_with($name, 'on') || in_array($name, ['srcdoc', 'http-equiv', 'formaction', 'action', 'ping', 'srcset'], true) || str_starts_with($name, 'xmlns')) {
                    $el->removeAttribute($attr->nodeName);
                    continue;
                }
                if ($name === 'style') {
                    $el->setAttribute('style', self::css($val, $allowRemote, $remote));
                    continue;
                }
                if (!in_array($name, self::URL_ATTRS, true)) {
                    continue;
                }
                $scheme = strtolower((string) parse_url(preg_replace('/[\x00-\x20]+/', '', $val) ?? '', PHP_URL_SCHEME));
                if ($name === 'href') {
                    if ($scheme === '' && str_starts_with($val, '#') || in_array($scheme, ['http', 'https', 'mailto', 'tel'], true)) {
                        continue;
                    }
                    $el->removeAttribute($attr->nodeName);
                    continue;
                }
                if ($name === 'src' && $scheme === 'cid') {
                    $key = trim(substr($val, 4), '<> ');
                    if (isset($cid[$key])) {
                        $el->setAttribute('src', $cid[$key]);
                    } else {
                        $el->removeAttribute('src');
                    }
                    continue;
                }
                if (in_array($name, ['src', 'background'], true) && $scheme === 'data' && preg_match('#^data:image/(png|jpe?g|gif|webp);base64,#i', $val)) {
                    continue;
                }
                if (in_array($name, ['src', 'background'], true) && in_array($scheme, ['http', 'https'], true)) {
                    $remote++;
                    if ($allowRemote) {
                        continue;
                    }
                    if ($name === 'src') {
                        $el->setAttribute('data-blocked', '1');
                    }
                }
                $el->removeAttribute($attr->nodeName);
            }
            if ($el->nodeName === 'a' && $el->hasAttribute('href') && !str_starts_with($el->getAttribute('href'), '#')) {
                $el->setAttribute('target', '_blank');
                $el->setAttribute('rel', 'noopener noreferrer');
            }
        }
        $bodyEl = $doc->getElementsByTagName('body')->item(0);
        $body = '';
        if ($bodyEl) {
            foreach ($bodyEl->childNodes as $c) {
                $body .= $doc->saveHTML($c);
            }
        } else {
            $body = (string) $doc->saveHTML($doc->documentElement);
        }
        $extra = $allowRemote ? '' : 'img[data-blocked]{display:inline-block;min-width:24px;min-height:16px;background:#f1f3f5;outline:1px dashed #ced4da}';
        return ['html' => self::wrap($styles . $extra, $body), 'remote' => $remote];
    }

    /** Content-Security-Policy for the stand-alone (images allowed) document. */
    public static function csp(bool $allowRemote): string
    {
        $img = $allowRemote ? 'data: https: http:' : 'data:';
        return "default-src 'none'; img-src $img; style-src 'unsafe-inline'; font-src data:" . ($allowRemote ? ' https:' : '')
            . "; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-same-origin allow-popups allow-popups-to-escape-sandbox";
    }

    private static function wrap(string $css, string $body): string
    {
        return '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">'
            . '<meta name="viewport" content="width=device-width,initial-scale=1"><style>' . self::BASE_CSS . '</style>'
            . ($css !== '' ? '<style>' . str_ireplace('</style', '<\/style', $css) . '</style>' : '')
            . '</head><body>' . $body . '</body></html>';
    }

    private static function css(string $css, bool $allowRemote, int &$remote): string
    {
        $css = preg_replace('/@import[^;]*;?/i', '', $css) ?? '';
        $css = preg_replace('/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding/i', '', $css) ?? '';
        return preg_replace_callback('/url\(\s*([\'"]?)(.*?)\1\s*\)/i', static function ($m) use ($allowRemote, &$remote) {
            $u = trim($m[2]);
            if (preg_match('#^data:image/(png|jpe?g|gif|webp);base64,#i', $u)) {
                return $m[0];
            }
            if (preg_match('#^(https?:)?//#i', $u)) {
                $remote++;
                return $allowRemote ? $m[0] : 'none';
            }
            return 'none';
        }, $css) ?? '';
    }

    private static function linkify(string $escaped): string
    {
        return preg_replace('#\bhttps?://[^\s<>"\']+#i', '<a href="$0" target="_blank" rel="noopener noreferrer">$0</a>', $escaped) ?? $escaped;
    }
}
