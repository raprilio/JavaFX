// Notification cards in the top-right corner (v1.30), on phones and desktops alike: something shared with me,
// reminders and new notifications slide in there instead of a pop-up in the middle of the screen. They never block
// the page, close by themselves after a while (not while hovered or touched), at most three show at once and the
// rest wait behind a "+N more · Dismiss all" bar. Everything stays in the bell.
import { html, icon, h, timeAgo } from './dom.js';

const MAX = 3;
const LIFE = 12000;
const KIND = {
  share: { icon: 'share-2', label: 'Shared with you' },
  reminder: { icon: 'bell-ring', label: 'Reminder' },
  note: { icon: 'bell', label: 'Notification' },
};
let root = null;
const shown = [];
const waiting = [];

function host() {
  if (root?.isConnected) return root;
  root = h('<div class="nstack" role="region" aria-label="Notifications" aria-live="polite"></div>');
  document.body.appendChild(root);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-ns-all]')) return dismissAll();
    const card = e.target.closest('.ns-card');
    if (!card) return;
    const item = shown.find((x) => x.el === card);
    if (!item) return;
    if (e.target.closest('[data-ns-close]')) return close(item, 'close');
    close(item, item.link ? 'open' : 'close');
  });
  return root;
}

function paintMore() {
  const r = host();
  r.querySelector('.ns-more')?.remove();
  if (waiting.length) r.appendChild(h(String(html`<div class="ns-more"><span>+${waiting.length} more</span><button type="button" data-ns-all>Dismiss all</button></div>`)));
}

function close(item, how) {
  const i = shown.indexOf(item);
  if (i < 0) return;
  shown.splice(i, 1);
  clearTimeout(item.timer);
  item.el.classList.add('out');
  setTimeout(() => item.el.remove(), 220);
  item.onClose?.(how);
  if (waiting.length) show(waiting.shift());
  paintMore();
}

function dismissAll() {
  waiting.splice(0).forEach((n) => n.onClose?.('close'));
  [...shown].forEach((x) => close(x, 'close'));
  paintMore();
}

function show(n) {
  const k = KIND[n.kind] || KIND.note;
  const el = h(String(html`<div class="ns-card ns-${n.kind || 'note'} ${n.link ? 'has-link' : ''}" role="status">
    <span class="ns-ic">${icon(k.icon, 'sm')}</span>
    <div class="ns-body"><div class="ns-kind">${k.label}${n.created_at ? html` · ${timeAgo(n.created_at)}` : ''}</div>
      <div class="ns-title">${String(n.title || '').replace(/^⏰\s*/, '')}</div>${n.body ? html`<div class="ns-text">${n.body}</div>` : ''}
      ${n.link ? html`<span class="ns-open">${icon('arrow-right', 'xs')} Open</span>` : ''}</div>
    <button type="button" class="ns-x" data-ns-close aria-label="Close">${icon('x', 'sm')}</button></div>`));
  const item = { ...n, el };
  const arm = () => { clearTimeout(item.timer); item.timer = setTimeout(() => close(item, 'timeout'), LIFE); };
  el.addEventListener('mouseenter', () => clearTimeout(item.timer));
  el.addEventListener('mouseleave', arm);
  el.addEventListener('touchstart', () => clearTimeout(item.timer), { passive: true });
  el.addEventListener('touchend', arm, { passive: true });
  const r = host();
  r.insertBefore(el, r.querySelector('.ns-more'));
  shown.push(item);
  arm();
  n.onShow?.();
}

/**
 * @param {{kind?:'share'|'reminder'|'note', title:string, body?:string, link?:string, created_at?:string,
 *          onShow?:()=>void, onClose?:(how:'open'|'close'|'timeout')=>void}} n
 */
export function pushNotif(n) {
  if (shown.length < MAX) show(n);
  else waiting.push(n);
  paintMore();
}
