// UI kit: toast, modal, confirm, prompt, drawer, menus/popovers, empty states, skeletons.
import { html, raw, icon, esc, h, $, $$ } from './dom.js';

// ---------------------------------------------------------------- toast
let toastRoot;
export function toast(message, type = 'info', { action, onAction, timeout = 3800 } = {}) {
  if (!toastRoot) {
    toastRoot = h('<div class="toasts" role="status" aria-live="polite"></div>');
    document.body.appendChild(toastRoot);
  }
  const ic = { success: 'check', error: 'alert-circle', warning: 'alert-triangle', info: 'info' }[type] || 'info';
  const el = h(String(html`<div class="toast ${type}"><span class="t-icon">${icon(ic, 'sm')}</span><span class="grow">${message}</span>${action ? html`<button class="t-action">${action}</button>` : ''}</div>`));
  toastRoot.appendChild(el);
  const close = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  };
  if (action) el.querySelector('.t-action').onclick = () => { onAction?.(); close(); };
  el.addEventListener('click', (e) => { if (!e.target.closest('.t-action')) close(); });
  setTimeout(close, action ? Math.max(timeout, 6000) : timeout);
  return close;
}
export const toastError = (e) => toast(e?.message || String(e), 'error');

// ---------------------------------------------------------------- modal
const stack = [];
function trapFocus(container, e) {
  const f = $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]', container)
    .filter((x) => x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
  else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
}

export function modal({ title = '', body = '', size = '', actions = [], onOpen, dismissible = true, className = '', headExtra = '' } = {}) {
  const prevFocus = document.activeElement;
  const root = h(String(html`
    <div class="modal-root" role="dialog" aria-modal="true">
      <div class="modal-backdrop"></div>
      <div class="modal ${size} ${className}">
        ${title !== null ? html`<div class="modal-head"><h2>${title}</h2>${raw(String(headExtra))}${dismissible ? html`<button class="btn ghost icon sm" data-close aria-label="Close">${icon('x')}</button>` : ''}</div>` : ''}
        <div class="modal-body"></div>
        ${actions.length ? html`<div class="modal-foot"></div>` : ''}
      </div>
    </div>`));
  const bodyEl = root.querySelector('.modal-body');
  if (body instanceof Node) bodyEl.appendChild(body);
  else bodyEl.innerHTML = String(body);

  let resolveFn;
  const result = new Promise((r) => (resolveFn = r));
  let closed = false;
  const close = (value) => {
    if (closed) return;
    closed = true;
    root.classList.add('closing');
    document.removeEventListener('keydown', onKey, true);
    stack.splice(stack.indexOf(api), 1);
    setTimeout(() => { root.remove(); if (!stack.length) document.body.style.overflow = ''; }, 170);
    prevFocus?.focus?.({ preventScroll: true });
    resolveFn(value);
  };
  const api = { root, el: root.querySelector('.modal'), body: bodyEl, close, result };

  const foot = root.querySelector('.modal-foot');
  actions.forEach((a) => {
    const b = h(String(html`<button class="btn ${a.variant || ''} ${a.left ? 'left' : ''}" type="${a.submit ? 'submit' : 'button'}">${a.icon ? icon(a.icon) : ''}${a.label}</button>`));
    b.onclick = async () => {
      if (!a.onClick) return close(a.value);
      try {
        b.classList.add('loading');
        const r = await a.onClick(api, b);
        if (r !== false) close(r === undefined ? a.value : r);
      } catch (e) {
        toastError(e);
      } finally {
        b.classList.remove('loading');
      }
    };
    foot.appendChild(b);
  });

  const onKey = (e) => {
    if (stack[stack.length - 1] !== api) return;
    if (e.key === 'Escape' && dismissible) { e.stopPropagation(); close(null); }
    if (e.key === 'Tab') trapFocus(api.el, e);
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      const primary = foot?.querySelector('.btn.primary, .btn.danger');
      if (primary) { e.preventDefault(); primary.click(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  if (dismissible) {
    root.querySelector('.modal-backdrop').onclick = () => close(null);
    root.querySelector('[data-close]')?.addEventListener('click', () => close(null));
  }
  document.body.appendChild(root);
  document.body.style.overflow = 'hidden';
  stack.push(api);
  requestAnimationFrame(() => {
    const f = bodyEl.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]):not([type=file]), textarea, select');
    (f || api.el.querySelector('.btn.primary') || api.el).focus?.({ preventScroll: true });
    onOpen?.(api);
  });
  return api;
}

export function confirm({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = true, icon: ic } = {}) {
  const m = modal({
    title: null,
    size: 'sm',
    body: html`<div class="confirm-icon ${danger ? '' : 'accent'}">${icon(ic || (danger ? 'alert-triangle' : 'help-circle'), 'lg')}</div>
      <h2 style="font-size:18px;margin-bottom:6px">${title}</h2><p class="muted" style="margin:0">${message}</p>`,
    actions: [
      { label: cancelText, value: false },
      { label: confirmText, value: true, variant: danger ? 'danger' : 'primary' },
    ],
  });
  return m.result.then((v) => !!v);
}

export function prompt({ title = '', label = '', value = '', placeholder = '', confirmText = 'Save', type = 'text', multiline = false, required = true } = {}) {
  const id = 'p' + Math.random().toString(36).slice(2);
  const m = modal({
    title,
    size: 'sm',
    body: html`<form class="field" style="margin:0">
      ${label ? html`<label for="${id}">${label}</label>` : ''}
      ${multiline ? html`<textarea id="${id}" class="textarea" placeholder="${placeholder}">${value}</textarea>` : html`<input id="${id}" class="input" type="${type}" value="${value}" placeholder="${placeholder}" autocomplete="off">`}
    </form>`,
    actions: [
      { label: 'Cancel', value: null },
      {
        label: confirmText, variant: 'primary', onClick: (ctx) => {
          const v = ctx.body.querySelector('#' + id).value.trim();
          if (required && !v) { ctx.body.querySelector('#' + id).classList.add('invalid'); return false; }
          return v;
        },
      },
    ],
    onOpen: (ctx) => {
      const inp = ctx.body.querySelector('#' + id);
      ctx.body.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
      inp.select?.();
      if (!multiline) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ctx.el.querySelector('.btn.primary').click(); } });
    },
  });
  return m.result;
}

// ---------------------------------------------------------------- drawer
export function drawer({ title = '', body = '', onOpen, footer = '' } = {}) {
  const root = h(String(html`<div class="drawer-root"><div class="modal-backdrop"></div><aside class="drawer" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${title}</h2><button class="btn ghost icon sm" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body" style="flex:1"></div>${footer ? html`<div class="modal-foot">${raw(String(footer))}</div>` : ''}</aside></div>`));
  const bodyEl = root.querySelector('.modal-body');
  if (body instanceof Node) bodyEl.appendChild(body); else bodyEl.innerHTML = String(body);
  let resolveFn;
  const result = new Promise((r) => (resolveFn = r));
  let closed = false;
  const close = (v) => {
    if (closed) return;
    closed = true;
    root.classList.add('closing');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => { root.remove(); document.body.style.overflow = ''; }, 190);
    resolveFn(v);
  };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-root')) close(null); };
  document.addEventListener('keydown', onKey, true);
  root.querySelector('.modal-backdrop').onclick = () => close(null);
  root.querySelector('[data-close]').onclick = () => close(null);
  document.body.appendChild(root);
  document.body.style.overflow = 'hidden';
  const api = { root, el: root.querySelector('.drawer'), body: bodyEl, foot: root.querySelector('.modal-foot'), close, result };
  requestAnimationFrame(() => onOpen?.(api));
  return api;
}

// ---------------------------------------------------------------- popover & menu
let openPop = null;
export function closePopover() {
  if (openPop) { openPop.close(); openPop = null; }
}

/** Position a floating element next to an anchor element or {x,y} point. */
function place(el, anchor, align = 'start') {
  const vw = window.innerWidth, vh = window.innerHeight;
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
  const w = el.offsetWidth, hgt = el.offsetHeight;
  let left = align === 'end' ? r.right - w : r.left;
  let top = r.bottom + 6;
  if (left + w > vw - 8) left = vw - w - 8;
  if (left < 8) left = 8;
  if (top + hgt > vh - 8) top = Math.max(8, r.top - hgt - 6);
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

export function popover(anchor, content, { align = 'start', className = '', onClose } = {}) {
  closePopover();
  const el = h(`<div class="popover ${className}" role="menu"></div>`);
  if (content instanceof Node) el.appendChild(content); else el.innerHTML = String(content);
  document.body.appendChild(el);
  place(el, anchor, align);
  const onDoc = (e) => { if (!el.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) close(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = $$('.menu-item', el);
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[n].focus();
    }
  };
  const onScroll = (e) => { if (!el.contains(e.target)) close(); };
  setTimeout(() => {
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
  });
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', close);
    el.remove();
    if (openPop?.el === el) openPop = null;
    onClose?.();
  }
  openPop = { el, close };
  return openPop;
}

/**
 * Dropdown / context menu.
 * items: [{ label, icon, onClick, danger, kbd, checked, disabled } | { divider: true } | { title }]
 */
export function menu(anchor, items, opts = {}) {
  const wrap = document.createElement('div');
  items.filter(Boolean).forEach((it) => {
    if (it.divider) return wrap.appendChild(h('<div class="menu-sep"></div>'));
    if (it.title) return wrap.appendChild(h(String(html`<div class="menu-title">${it.title}</div>`)));
    if (it.node) return wrap.appendChild(it.node);
    const b = h(String(html`<button class="menu-item ${it.danger ? 'danger' : ''} ${it.checked ? 'checked' : ''}" ${it.disabled ? 'disabled' : ''} type="button">
      ${it.icon ? icon(it.icon, 'sm') : ''}<span class="grow">${it.label}</span>${it.kbd ? html`<span class="kbd">${it.kbd}</span>` : ''}</button>`));
    b.onclick = (e) => { e.stopPropagation(); p.close(); it.onClick?.(e); };
    wrap.appendChild(b);
  });
  const p = popover(anchor, wrap, opts);
  requestAnimationFrame(() => wrap.querySelector('.menu-item')?.focus({ preventScroll: true }));
  return p;
}

export function contextMenu(e, items) {
  e.preventDefault();
  return menu({ x: e.clientX, y: e.clientY }, items);
}

// ---------------------------------------------------------------- misc components
export function empty({ icon: ic = 'inbox', title = 'Nothing here yet', text = '', action = '' } = {}) {
  return html`<div class="empty"><div class="empty-art">${icon(ic, 'xl')}</div><h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${raw(String(action || ''))}</div>`;
}

export function skeletonCards(n = 8) {
  const heights = [140, 190, 120, 170, 210, 150, 130, 180];
  return raw(Array.from({ length: n }, (_, i) => `<div class="skeleton sk-card" style="height:${heights[i % heights.length]}px;margin-bottom:16px;break-inside:avoid"></div>`).join(''));
}

export function skeletonRows(n = 5) {
  return raw(Array.from({ length: n }, () => `<div class="row" style="padding:10px 4px"><div class="skeleton" style="width:36px;height:36px;border-radius:10px"></div><div class="grow"><div class="skeleton sk-line" style="width:60%"></div><div class="skeleton sk-line" style="width:35%;height:10px"></div></div></div>`).join(''));
}

/** Run an async function while showing a loading state on a button. */
export async function withLoading(btn, fn) {
  if (!btn) return fn();
  btn.classList.add('loading');
  btn.disabled = true;
  try { return await fn(); } finally { btn.classList.remove('loading'); btn.disabled = false; }
}

export function avatarHtml(user, cls = '') {
  if (!user) return '';
  if (user.avatar_url) return html`<img class="avatar ${cls}" src="${user.avatar_url}" alt="">`;
  const n = (user.name || user.email || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return html`<span class="avatar ${cls}">${n}</span>`;
}

export function switchHtml(name, checked, label = '') {
  return html`<label class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span class="track"></span>${label ? html`<span>${label}</span>` : ''}</label>`;
}

export function formData(form) {
  const out = {};
  new FormData(form).forEach((v, k) => {
    if (k.endsWith('[]')) (out[k.slice(0, -2)] ||= []).push(v);
    else out[k] = v;
  });
  $$('input[type=checkbox][name]', form).forEach((c) => { if (!c.name.endsWith('[]')) out[c.name] = c.checked; });
  return out;
}

export function showFieldErrors(form, errors = {}) {
  $$('.input.invalid', form).forEach((i) => i.classList.remove('invalid'));
  Object.keys(errors).forEach((k) => form.querySelector(`[name="${CSS.escape(k)}"]`)?.classList.add('invalid'));
}

export const NOTE_COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'brown', 'gray'];
export const NOTE_BGS = ['none', 'dots', 'grid', 'lines', 'waves', 'paper'];

export function colorPicker(anchor, current, onPick, { backgrounds = false, currentBg = 'none', onBg } = {}) {
  const wrap = h('<div style="padding:4px"></div>');
  wrap.innerHTML = String(html`<div class="menu-title">Color</div><div class="swatches">${NOTE_COLORS.map((c) => html`
    <button class="swatch ${(current || 'default') === c ? 'active' : ''}" data-c="${c}" data-tip="${c}" style="--sw:${c === 'default' ? 'var(--bg-elev)' : `var(--note-${c})`}">${c === 'default' ? icon('slash', 'sm') : ''}</button>`)}</div>
    ${backgrounds ? html`<div class="menu-title">Background</div><div class="swatches">${NOTE_BGS.map((b) => html`
      <button class="swatch ${(currentBg || 'none') === b ? 'active' : ''}" data-b="${b}" data-tip="${b}" data-nbg="${b}" style="--sw:var(--bg-soft)">${b === 'none' ? icon('slash', 'sm') : ''}</button>`)}</div>` : ''}`);
  const p = popover(anchor, wrap);
  wrap.addEventListener('click', (e) => {
    const s = e.target.closest('[data-c]');
    const b = e.target.closest('[data-b]');
    if (s) { onPick(s.dataset.c); p.close(); }
    if (b) { onBg?.(b.dataset.b); p.close(); }
  });
  return p;
}

export const ACCENTS = ['#6366f1', '#0ea5e9', '#14b8a6', '#10b981', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];
export const PALETTE = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b'];

export function setTitle(t) {
  const app = (window.__SN_BRANDING__?.app_name) || 'SmartNotes';
  document.title = t ? `${t} · ${app}` : app;
}

export { esc };
