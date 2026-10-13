// Inline helpers for the note editor (v1.16):
//  • "@" suggests people → <span class="sn-mention" data-user-id>@Name</span>
//  • "#" suggests a link: type or paste a URL (#https://…) or pick another note as a reference
//  • links are clickable: a small card with Open / Edit / Copy / Remove (read-only notes open them directly)
//  • a mention can be clicked to focus the note on that person
import { html, icon, h, esc } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { navigate } from '../core/router.js';
import { modal, avatarHtml, toast } from '../core/ui.js';

let people = null;
/** Everyone who can be mentioned (active users) — me first. */
export async function mentionable() {
  if (!people) {
    const list = await api.get('users/directory').catch(() => []);
    const me = state.user ? [{ id: state.user.id, name: state.user.name, email: state.user.email, job_title: null, avatar_url: state.user.avatar_url, me: true }] : [];
    people = me.concat(list);
  }
  return people;
}

const URLISH = /^(https?:\/\/|www\.)\S+$|^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;
export const looksLikeUrl = (q) => URLISH.test(q.trim());
export const normalizeUrl = (u) => (/^(https?:|mailto:|tel:)/i.test(u) ? u : 'https://' + u.replace(/^\/+/, ''));
const shortUrl = (u) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
const isInternal = (href) => /^#\//.test(href || '');

/** Open a link from a note: other notes inside the app, everything else in a new tab. */
export function openHref(href) {
  if (!href) return;
  if (isInternal(href)) return navigate(href.slice(1));
  window.open(href, '_blank', 'noopener,noreferrer');
}

/** Dialog with URL + text (insert or edit a link). */
export function linkDialog({ url = '', text = '', title = 'Insert link' } = {}) {
  const m = modal({
    title, size: 'sm',
    body: html`<form class="col" style="gap:10px">
      <div class="field" style="margin:0"><label>Link (URL)</label><input class="input" name="url" type="text" inputmode="url" value="${url}" placeholder="https://example.com" autocomplete="off"></div>
      <div class="field" style="margin:0"><label>Text to show <span class="subtle">(optional)</span></label><input class="input" name="text" value="${text}" placeholder="Same as the link" autocomplete="off"></div></form>`,
    actions: [{ label: 'Cancel', value: null }, {
      label: 'Save link', variant: 'primary', onClick: (ctx) => {
        const u = ctx.body.querySelector('[name=url]').value.trim();
        if (!u) { ctx.body.querySelector('[name=url]').classList.add('invalid'); return false; }
        return { url: normalizeUrl(u), text: ctx.body.querySelector('[name=text]').value.trim() || u };
      },
    }],
    onOpen: (ctx) => {
      const f = ctx.body.querySelector('form');
      f.addEventListener('submit', (e) => { e.preventDefault(); ctx.el.querySelector('.btn.primary').click(); });
      f.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ctx.el.querySelector('.btn.primary').click(); } });
      setTimeout(() => ctx.body.querySelector(url ? '[name=text]' : '[name=url]').focus(), 30);
    },
  });
  return m.result;
}

export function mentionHtml(u) {
  return `<span class="sn-mention" data-user-id="${+u.id}" contenteditable="false">@${esc(u.name)}</span>`;
}
export function linkHtml(href, text, ref = false) {
  return `<a href="${esc(href)}"${ref ? ' class="sn-ref"' : ''} target="_blank" rel="noopener noreferrer nofollow">${esc(text)}</a>`;
}

/**
 * @param {{editor: HTMLElement, mutate: Function, placeCaret: Function, noteId?: number,
 *          onMention?: (u) => void, onFocusPerson?: (id:number) => void, editable: () => boolean}} o
 */
export function attachInline(o) {
  const { editor, mutate, editable } = o;
  const pop = h('<div class="sg-pop" role="listbox" hidden></div>');
  const card = h('<div class="lk-pop" hidden></div>');
  document.body.append(pop, card);

  // ================================================================== @ / # suggestions
  let act = null; // { ch, node, start }
  let items = [], active = -1, seq = 0;

  const caret = () => {
    const s = window.getSelection();
    return s.rangeCount && s.isCollapsed && editor.contains(s.anchorNode) ? { node: s.anchorNode, off: s.anchorOffset } : null;
  };
  const query = () => {
    const c = caret();
    if (!act || !c || c.node !== act.node || c.off <= act.start || act.node.data[act.start] !== act.ch) return null;
    return act.node.data.slice(act.start + 1, c.off);
  };
  function close() { act = null; items = []; active = -1; pop.hidden = true; }
  function rangeOf() {
    const c = caret();
    const r = document.createRange();
    r.setStart(act.node, act.start);
    r.setEnd(act.node, c ? c.off : act.node.length);
    return r;
  }
  /** Replace "@query" / "#query" with the chosen HTML (one undo step). */
  function replace(htmlStr, after = '\u00a0', range = null) {
    if (!act && !range) return;
    const r = range || rangeOf();
    close();
    mutate(() => {
      r.deleteContents();
      const frag = r.createContextualFragment(htmlStr);
      const last = frag.lastChild;
      r.insertNode(frag);
      const tail = document.createTextNode(after);
      last.after(tail);
      const s = window.getSelection();
      const cr = document.createRange();
      cr.setStart(tail, tail.length);
      cr.collapse(true);
      s.removeAllRanges();
      s.addRange(cr);
    });
  }

  async function source(ch, q) {
    if (ch === '@') {
      const list = await mentionable();
      const k = q.trim().toLowerCase();
      const names = new Map();
      list.forEach((u) => names.set(u.name.toLowerCase(), (names.get(u.name.toLowerCase()) || 0) + 1));
      return list.filter((u) => !k || u.name.toLowerCase().split(/\s+/).some((p) => p.startsWith(k)) || u.name.toLowerCase().startsWith(k) || (k.length > 2 && u.name.toLowerCase().includes(k)))
        .slice(0, 8).map((u) => ({
          key: 'u' + u.id,
          html: html`${avatarHtml(u, 'sm')}<span class="grow truncate"><b>${u.name}</b>${u.me ? html` <span class="subtle">(you)</span>` : ''}${names.get(u.name.toLowerCase()) > 1 ? html` <span class="subtle">· ${(u.email || '').split('@')[0]}</span>` : ''}${u.job_title ? html`<span class="tiny subtle block">${u.job_title}</span>` : ''}</span>`,
          pick: () => { replace(mentionHtml(u)); o.onMention?.(u); },
        }));
    }
    // "#": a URL becomes a link; otherwise other notes to reference; and a dialog for anything else.
    const out = [];
    const t = q.trim();
    if (t && looksLikeUrl(t)) out.push({ key: 'url', html: html`<span class="sg-ic">${icon('link', 'sm')}</span><span class="grow truncate">Link <b>${shortUrl(t)}</b></span><span class="kbd">Enter</span>`, pick: () => replace(linkHtml(normalizeUrl(t), t)) });
    else {
      const r = await api.get('notes', t ? { q: t, per_page: 7 } : { filter: 'recent', per_page: 6 }).catch(() => ({ items: [] }));
      r.items.filter((n) => n.id !== o.noteId && !n.locked).slice(0, 6).forEach((n) => out.push({
        key: 'n' + n.id,
        html: html`<span class="sg-ic">${icon('file-text', 'sm')}</span><span class="grow truncate"><b>${n.title || 'Untitled note'}</b><span class="tiny subtle block truncate">Reference note${n.owner_name ? ' · ' + n.owner_name : ''}</span></span>`,
        pick: () => replace(linkHtml('#/notes/' + n.id, n.title || 'Untitled note', true)),
      }));
    }
    out.push({ key: 'dlg', html: html`<span class="sg-ic">${icon('link-2', 'sm')}</span><span class="grow">Add a link…</span>`, pick: async () => {
      const r = rangeOf();
      close();
      const v = await linkDialog({ url: looksLikeUrl(t) ? t : '', text: looksLikeUrl(t) ? '' : t });
      editor.focus({ preventScroll: true });
      if (!v) return;
      replace(linkHtml(v.url, v.text), '\u00a0', r);
    } });
    return out;
  }

  async function refresh() {
    const q = query();
    if (q === null) return close();
    const ch = act.ch;
    // "# " / "## " at the start of a line stay heading shortcuts; a space after a non-name / non-URL ends the popup.
    if (ch === '#' && /^#+$/.test(q)) return close();
    if (/\n/.test(q) || q.length > 60 || (ch === '@' && (q.split(' ').length > 3 || / {2}$/.test(q)))) return close();
    if (ch === '#' && / /.test(q) && !looksLikeUrl(q)) return close();
    const my = ++seq;
    const list = await source(ch, q);
    if (my !== seq || !act) return;
    if (ch === '@' && !list.length && / $/.test(q)) return close();
    items = list;
    active = ch === '@' ? 0 : list[0]?.key === 'url' ? 0 : -1;
    paint();
  }
  function paint() {
    if (!act || !items.length) { pop.hidden = true; return; }
    pop.innerHTML = String(html`<div class="sg-head">${act.ch === '@' ? 'Mention someone' : 'Link or reference a note'}</div>${items.map((it, i) => html`<button type="button" class="sg-item ${i === active ? 'active' : ''}" data-i="${i}" role="option">${it.html}</button>`)}`);
    pop.hidden = false;
    // under the caret; above it when the keyboard / screen bottom is too close
    const r = rangeOf().getBoundingClientRect();
    const vv = window.visualViewport;
    const vb = vv ? vv.offsetTop + vv.height : innerHeight;
    const ph = pop.offsetHeight, pw = pop.offsetWidth;
    const left = Math.max(8, Math.min(innerWidth - pw - 8, r.left));
    const top = r.bottom + 6 + ph > vb - 4 ? Math.max(8, r.top - ph - 6) : r.bottom + 6;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  pop.addEventListener('pointerdown', (e) => e.preventDefault());
  pop.addEventListener('mousedown', (e) => e.preventDefault());
  pop.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) items[+b.dataset.i]?.pick(); });

  editor.addEventListener('input', (e) => {
    if (!editable()) return;
    if (act) { refresh(); return; }
    if (!/^insert(Text|CompositionText|ReplacementText)$/.test(e.inputType || 'insertText')) return;
    const c = caret();
    if (!c || c.node.nodeType !== 3 || !c.off) return;
    const ch = c.node.data[c.off - 1];
    if (ch !== '@' && ch !== '#') return;
    const before = c.node.data[c.off - 2];
    if (before !== undefined && !/[\s (\[]/.test(before)) return; // e-mail addresses, "C#" … stay text
    if (c.node.parentElement?.closest('a, pre, code, .sn-mention')) return;
    act = { ch, node: c.node, start: c.off - 1 };
    refresh();
  });
  // Keys while the list is open (capture: before the editor's own Enter / Tab handling).
  editor.addEventListener('keydown', (e) => {
    if (!act || pop.hidden) {
      if (act && e.key === 'Escape') close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
      paint();
    } else if ((e.key === 'Enter' || e.key === 'Tab') && active >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      items[active].pick();
    } else if (e.key === ' ' && act.ch === '#' && looksLikeUrl(query() || '') && items[0]?.key === 'url') {
      e.preventDefault();
      items[0].pick();
    } else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }, true);
  editor.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== editor) close(); }, 120));
  const onSel = () => { if (act && query() === null) close(); };
  document.addEventListener('selectionchange', onSel);

  // ================================================================== link / mention cards
  let cardFor = null;
  function hideCard() { card.hidden = true; cardFor = null; }
  function showCardAt(el, inner) {
    card.innerHTML = String(inner);
    card.hidden = false;
    const r = el.getBoundingClientRect();
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const vv = window.visualViewport;
    const vb = vv ? vv.offsetTop + vv.height : innerHeight;
    card.style.left = Math.max(8, Math.min(innerWidth - cw - 8, r.left)) + 'px';
    card.style.top = (r.bottom + 6 + ch > vb - 4 ? Math.max(8, r.top - ch - 6) : r.bottom + 6) + 'px';
    cardFor = el;
  }
  function linkCard(a) {
    const href = a.getAttribute('href') || '';
    const inner = isInternal(href);
    const canEdit = editable();
    showCardAt(a, html`<span class="lk-ic">${icon(inner ? 'file-text' : 'globe', 'sm')}</span>
      <a class="lk-url truncate" href="${href}" data-lk="open" title="${href}">${inner ? 'Note: ' + (a.textContent || '') : shortUrl(href)}</a>
      <button type="button" class="btn ghost icon xs" data-lk="open" data-tip="Open" aria-label="Open link">${icon('external-link', 'sm')}</button>
      ${inner ? '' : html`<button type="button" class="btn ghost icon xs" data-lk="copy" data-tip="Copy link" aria-label="Copy link">${icon('copy', 'sm')}</button>`}
      ${canEdit ? html`<button type="button" class="btn ghost icon xs" data-lk="edit" data-tip="Edit link" aria-label="Edit link">${icon('pencil', 'sm')}</button>
      <button type="button" class="btn ghost icon xs" data-lk="unlink" data-tip="Remove link" aria-label="Remove link">${icon('unlink', 'sm')}</button>` : ''}`);
  }
  async function mentionCard(m) {
    const id = +m.dataset.userId;
    const u = (await mentionable()).find((x) => x.id === id) || { id, name: m.textContent.replace(/^@/, '') };
    showCardAt(m, html`${avatarHtml(u, 'sm')}<span class="grow truncate" style="min-width:0"><b>${u.name}</b>${u.me ? html` <span class="subtle">(you)</span>` : ''}${u.job_title ? html`<span class="tiny subtle block truncate">${u.job_title}</span>` : ''}</span>
      <button type="button" class="btn xs" data-lk="focus" data-uid="${id}">${icon('focus', 'sm')} Focus</button>
      <a class="btn ghost icon xs" href="#/notes?mention=${u.me ? 'me' : id}" data-tip="All notes mentioning ${u.name}" aria-label="All notes mentioning ${u.name}">${icon('notebook', 'sm')}</a>`);
  }
  card.addEventListener('mousedown', (e) => { if (!e.target.closest('a[href^="#/notes?"]')) e.preventDefault(); });
  card.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-lk]');
    if (!b) { if (e.target.closest('a')) hideCard(); return; }
    e.preventDefault();
    const a = cardFor;
    const what = b.dataset.lk;
    hideCard();
    if (what === 'focus') return o.onFocusPerson?.(+b.dataset.uid);
    if (!a || !editor.contains(a)) return;
    const href = a.getAttribute('href');
    if (what === 'open') return openHref(href);
    if (what === 'copy') { try { await navigator.clipboard.writeText(href); toast('Link copied', 'success', { timeout: 1200 }); } catch { /* ignore */ } return; }
    if (what === 'unlink') return mutate(() => { a.replaceWith(...a.childNodes); });
    if (what === 'edit') {
      const v = await linkDialog({ url: href, text: a.textContent, title: 'Edit link' });
      if (v) mutate(() => { a.setAttribute('href', v.url); a.classList.remove('sn-ref'); if (!a.getAttribute('class')) a.removeAttribute('class'); a.textContent = v.text; });
    }
  });
  editor.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    const m = e.target.closest('.sn-mention');
    if (a && editor.contains(a)) {
      // Read-only notes, or Ctrl / ⌘ + click: follow the link right away. Editing: show the link card.
      e.preventDefault();
      if (!editable() || e.ctrlKey || e.metaKey) { hideCard(); return openHref(a.getAttribute('href')); }
      return linkCard(a);
    }
    if (m && editor.contains(m)) { e.preventDefault(); return mentionCard(m); }
    hideCard();
  });
  const onDoc = (e) => { if (!card.hidden && !card.contains(e.target) && !(cardFor && cardFor.contains(e.target))) hideCard(); };
  const onKey = (e) => { if (e.key === 'Escape') hideCard(); };
  const onScroll = () => { if (!card.hidden) hideCard(); if (act && !pop.hidden) paint(); };
  document.addEventListener('pointerdown', onDoc, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', onScroll, true);

  return {
    close,
    destroy() {
      document.removeEventListener('selectionchange', onSel);
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      pop.remove();
      card.remove();
    },
  };
}

// ==================================================================== focus on a person
/** Blocks of the note that mention a user get highlighted, the rest is dimmed. Returns the hits. */
export function focusPerson(editor, uid) {
  editor.querySelectorAll('.mf-hit, .mf-me').forEach((x) => x.classList.remove('mf-hit', 'mf-me'));
  editor.classList.toggle('mf-on', !!uid);
  if (!uid) return [];
  const hits = [];
  editor.querySelectorAll(`.sn-mention[data-user-id="${+uid}"]`).forEach((m) => {
    m.classList.add('mf-me');
    const b = m.closest('li, td, th, p, h1, h2, h3, h4, blockquote, pre') || m.closest('div:not(.rte)') || m;
    if (editor.contains(b) && !hits.includes(b)) { b.classList.add('mf-hit'); hits.push(b); }
  });
  return hits;
}

/** People mentioned in the editor, with how often. */
export function mentionsIn(editor) {
  const m = new Map();
  editor.querySelectorAll('.sn-mention[data-user-id]').forEach((s) => {
    const id = +s.dataset.userId;
    const cur = m.get(id) || { id, name: s.textContent.replace(/^@/, ''), count: 0 };
    cur.count++;
    m.set(id, cur);
  });
  return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Links in the editor (for the References list). */
export function linksIn(editor) {
  const seen = new Set();
  return [...editor.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim(), internal: isInternal(a.getAttribute('href')), el: a }))
    .filter((l) => l.href && !seen.has(l.href) && seen.add(l.href));
}
