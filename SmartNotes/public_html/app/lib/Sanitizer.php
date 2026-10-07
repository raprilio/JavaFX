<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Whitelist-based HTML sanitizer for rich-text note content (XSS protection).
 * Anything not explicitly allowed is removed; text content is preserved.
 */
final class Sanitizer
{
    private const TAGS = [
        'p' => ['style', 'class'], 'div' => ['style', 'class', 'data-checked'], 'br' => [], 'hr' => ['class'],
        'span' => ['style', 'class'], 'b' => [], 'strong' => [], 'i' => [], 'em' => [], 'u' => [],
        's' => [], 'strike' => [], 'del' => [], 'mark' => ['style', 'class'], 'sub' => [], 'sup' => [],
        'h1' => ['style'], 'h2' => ['style'], 'h3' => ['style'], 'h4' => ['style'],
        'ul' => ['class', 'style'], 'ol' => ['class', 'style', 'start'], 'li' => ['class', 'style', 'data-checked'],
        'blockquote' => ['style'], 'pre' => ['class', 'spellcheck'], 'code' => ['class'],
        'a' => ['href', 'title', 'target', 'rel'],
        'table' => ['class', 'style'], 'thead' => [], 'tbody' => [], 'tr' => [], 'th' => ['style', 'colspan', 'rowspan'], 'td' => ['style', 'colspan', 'rowspan'],
        'img' => ['src', 'alt', 'class', 'data-file-id', 'data-drawing-id', 'width', 'style'],
        'figure' => ['class', 'data-file-id', 'data-audio-id', 'data-drawing-id', 'contenteditable'], 'figcaption' => [],
        'font' => ['color', 'size'],
    ];
    private const DROP_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'head', 'title', 'audio', 'video', 'source'];
    private const STYLE_PROPS = ['color', 'background-color', 'text-align', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'width', 'max-width', 'transform'];
    private const CLASS_WHITELIST = '/^(sn-[a-z0-9\-]+|checklist|checked|hl-[a-z]+|align-[a-z]+)$/';

    public static function html(?string $html): string
    {
        $html = (string) $html;
        if (trim($html) === '') {
            return '';
        }
        if (strlen($html) > 4 * 1024 * 1024) {
            throw new HttpException('Note content is too large.', 413);
        }
        $doc = new DOMDocument('1.0', 'UTF-8');
        $prev = libxml_use_internal_errors(true);
        $doc->loadHTML('<?xml encoding="UTF-8"?><!DOCTYPE html><html><body><div id="__root">' . $html . '</div></body></html>', LIBXML_NONET | LIBXML_COMPACT);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);

        $root = $doc->getElementById('__root');
        if (!$root) {
            return '';
        }
        self::clean($root);
        $out = '';
        foreach (iterator_to_array($root->childNodes) as $child) {
            $out .= $doc->saveHTML($child);
        }
        return trim($out);
    }

    private static function clean(DOMNode $node): void
    {
        foreach (iterator_to_array($node->childNodes) as $child) {
            if ($child instanceof DOMComment || $child instanceof DOMProcessingInstruction || $child instanceof DOMCdataSection) {
                $node->removeChild($child);
                continue;
            }
            if (!$child instanceof DOMElement) {
                continue;
            }
            $tag = strtolower($child->tagName);
            if (in_array($tag, self::DROP_WITH_CONTENT, true)) {
                $node->removeChild($child);
                continue;
            }
            if (!array_key_exists($tag, self::TAGS)) {
                // Unwrap unknown element but keep its children.
                self::clean($child);
                while ($child->firstChild) {
                    $node->insertBefore($child->firstChild, $child);
                }
                $node->removeChild($child);
                continue;
            }
            self::cleanAttributes($child, self::TAGS[$tag]);
            if ($tag === 'img' && !$child->hasAttribute('src')) {
                $node->removeChild($child);
                continue;
            }
            self::clean($child);
        }
    }

    private static function cleanAttributes(DOMElement $el, array $allowed): void
    {
        foreach (iterator_to_array($el->attributes) as $attr) {
            $name = strtolower($attr->name);
            $value = (string) $attr->value;
            if (!in_array($name, $allowed, true)) {
                $el->removeAttribute($attr->name);
                continue;
            }
            switch ($name) {
                case 'href':
                    if (!preg_match('#^(https?://|mailto:|tel:|\#)#i', trim($value))) {
                        $el->removeAttribute('href');
                    } else {
                        $el->setAttribute('rel', 'noopener noreferrer nofollow');
                        $el->setAttribute('target', '_blank');
                    }
                    break;
                case 'src':
                    // Only images served by our own API are allowed.
                    if (!preg_match('#^api/index\.php\?route=(files/\d+/(raw|thumb)(&v=[a-f0-9]{1,12})?|drawings/\d+/png(&v=\d{1,9})?)$#', $value)) {
                        $el->removeAttribute('src');
                    }
                    break;
                case 'style':
                    $clean = self::style($value);
                    $clean === '' ? $el->removeAttribute('style') : $el->setAttribute('style', $clean);
                    break;
                case 'class':
                    $classes = array_filter(preg_split('/\s+/', $value) ?: [], static fn($c) => preg_match(self::CLASS_WHITELIST, $c));
                    $classes ? $el->setAttribute('class', implode(' ', $classes)) : $el->removeAttribute('class');
                    break;
                case 'target':
                    $el->setAttribute('target', '_blank');
                    break;
                case 'rel':
                    $el->setAttribute('rel', 'noopener noreferrer nofollow');
                    break;
                case 'data-checked':
                    $el->setAttribute('data-checked', $value === 'true' ? 'true' : 'false');
                    break;
                case 'data-file-id':
                case 'data-audio-id':
                case 'colspan':
                case 'rowspan':
                case 'start':
                case 'width':
                case 'size':
                    if (!ctype_digit($value)) {
                        $el->removeAttribute($attr->name);
                    }
                    break;
                case 'contenteditable':
                    $el->setAttribute('contenteditable', 'false');
                    break;
                case 'spellcheck':
                    $el->setAttribute('spellcheck', 'false');
                    break;
                case 'color':
                    if (!preg_match('/^#?[0-9a-fA-F]{3,8}$|^[a-z]+$/', $value)) {
                        $el->removeAttribute('color');
                    }
                    break;
                default:
                    $el->setAttribute($attr->name, mb_substr(strip_tags($value), 0, 300));
            }
        }
    }

    private static function style(string $css): string
    {
        $out = [];
        foreach (explode(';', $css) as $decl) {
            if (!str_contains($decl, ':')) {
                continue;
            }
            [$prop, $val] = array_map('trim', explode(':', $decl, 2));
            $prop = strtolower($prop);
            if (!in_array($prop, self::STYLE_PROPS, true)) {
                continue;
            }
            if (preg_match('/(url|expression|javascript|import|@|\\\\|<|>)/i', $val)) {
                continue;
            }
            if (!preg_match('/^[#a-zA-Z0-9\s.,%()\-]+$/', $val) || strlen($val) > 60) {
                continue;
            }
            $out[] = $prop . ': ' . $val;
        }
        return implode('; ', $out);
    }

    /** Plain text representation used for search & previews. */
    public static function text(string $html): string
    {
        $html = preg_replace('#<(br|/p|/div|/li|/h[1-6]|/tr|/blockquote|/pre)[^>]*>#i', "$0\n", $html) ?? $html;
        $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace("/[ \t\x{00A0}]+/u", ' ', $text) ?? $text;
        $text = preg_replace("/\n\s*\n+/", "\n", $text) ?? $text;
        return trim($text);
    }

    /** Count checklist items [total, done]. */
    public static function checklistStats(string $html): array
    {
        $total = preg_match_all('/<li[^>]*data-checked="(true|false)"/i', $html, $m);
        $done = $total ? count(array_filter($m[1], static fn($v) => strtolower($v) === 'true')) : 0;
        return [(int) $total, $done];
    }
}
