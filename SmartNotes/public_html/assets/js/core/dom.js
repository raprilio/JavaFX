// DOM & formatting helpers
import { ICONS } from './icons.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => (v === null || v === undefined ? '' : String(v).replace(/[&<>"']/g, (c) => ESC[c]));

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s ?? '');

/** Tagged template that escapes interpolations unless wrapped in raw() (arrays are joined). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += fmtVal(vals[i]);
  });
  return raw(out);
}
function fmtVal(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmtVal).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

export function icon(name, cls = '') {
  const body = ICONS[name] || ICONS['circle'] || '';
  return raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function h(htmlStr) {
  const t = document.createElement('template');
  t.innerHTML = String(htmlStr).trim();
  return t.content.firstElementChild;
}

export function setHTML(el, content) {
  el.innerHTML = String(content);
  return el;
}

/** Delegated event listener. Returns an unsubscribe function. */
export function on(root, type, selector, fn, opts) {
  const handler = (e) => {
    const t = e.target.closest ? e.target.closest(selector) : null;
    if (t && root.contains(t)) fn(e, t);
  };
  root.addEventListener(type, handler, opts);
  return () => root.removeEventListener(type, handler, opts);
}

export function debounce(fn, ms = 300) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

export function throttle(fn, ms = 100) {
  let last = 0, t;
  return (...a) => {
    const now = Date.now();
    clearTimeout(t);
    if (now - last >= ms) { last = now; fn(...a); }
    else t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last));
  };
}

export const uid = (p = 'k') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

// ---------------------------------------------------------------- dates

export function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return new Date(s);
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const ymdhms = (d) => `${ymd(d)} ${hm(d)}:${pad(d.getSeconds())}`;
export const todayStr = () => ymd(new Date());

const LOCALE = undefined;
export function fmtDate(s, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const d = parseDate(s);
  return d ? d.toLocaleDateString(LOCALE, opts) : '';
}
export function fmtDateTime(s) {
  const d = parseDate(s);
  return d ? d.toLocaleString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}
export function fmtTime(s) {
  const d = parseDate(s);
  return d ? d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) : '';
}
export function fmtDay(s) {
  const d = parseDate(s);
  if (!d) return '';
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - t) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString(LOCALE, { weekday: 'long' });
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: d.getFullYear() !== t.getFullYear() ? 'numeric' : undefined });
}
export function timeAgo(s) {
  const d = parseDate(s);
  if (!d) return '';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return fmtDate(d);
}
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
export function fmtBytes(b) {
  b = Number(b) || 0;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i && b < 10 ? 1 : 0)} ${u[i]}`;
}
export const greeting = () => {
  const h = new Date().getHours();
  return h < 11 ? 'Good morning' : h < 15 ? 'Good afternoon' : h < 19 ? 'Good evening' : 'Good night';
};
export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || '?';

export function highlight(text, q) {
  const t = esc(text);
  if (!q) return raw(t);
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  return raw(t.replace(re, '<mark class="hl">$1</mark>'));
}

export const FILE_COLORS = { pdf: '#e5484d', doc: '#2b6cdf', docx: '#2b6cdf', xls: '#16a34a', xlsx: '#16a34a', csv: '#16a34a', ppt: '#ea7a1a', pptx: '#ea7a1a', zip: '#7c5cdb', txt: '#64748b', mp3: '#db2777', wav: '#db2777', m4a: '#db2777', webm: '#db2777', ogg: '#db2777' };
export function fileBadge(name) {
  const ext = (name.split('.').pop() || '').toLowerCase().slice(0, 4);
  return raw(`<span class="file-icon" style="--fc:${FILE_COLORS[ext] || '#8b92a1'}">${esc(ext || 'file')}</span>`);
}

/** Inject a classic script once (used for heavy vendor libraries). */
const loaded = {};
export function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { delete loaded[src]; reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

export function download(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';
