// Theme: light / dark / system, accent colour, compact mode, background image, favicon.
import { state } from './store.js';

const mql = window.matchMedia('(prefers-color-scheme: dark)');
let currentPref = 'system';

function resolve(pref) {
  return pref === 'system' ? (mql.matches ? 'dark' : 'light') : pref;
}

export function applyThemeMode(pref) {
  currentPref = pref || 'system';
  const mode = resolve(currentPref);
  document.documentElement.dataset.theme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#0e1014' : '#f5f6f8');
}
mql.addEventListener?.('change', () => { if (currentPref === 'system') applyThemeMode('system'); });

export const effectiveTheme = () => document.documentElement.dataset.theme || 'light';

function contrastOf(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.45 ? '#111318' : '#ffffff';
}

export function applyAccent(color) {
  const c = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#6366f1';
  const root = document.documentElement.style;
  root.setProperty('--accent', c);
  root.setProperty('--accent-contrast', contrastOf(c));
}

export function applyFavicon(url, accent) {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (url) {
    link.href = url;
    return;
  }
  const c = accent || '#6366f1';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${c}"/><path d="M20 18h17l7 7v21a3 3 0 0 1-3 3H20a3 3 0 0 1-3-3V21a3 3 0 0 1 3-3z" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="M24 33h16M24 41h10" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>`;
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/** Apply everything derived from user settings + admin branding. */
export function applyAll() {
  const s = state.settings || {};
  const b = state.branding || {};
  applyThemeMode(state.user ? s.theme : (b.default_theme || 'system'));
  const accent = (state.user && s.accent_color) || b.default_accent;
  applyAccent(accent);
  document.documentElement.classList.toggle('compact', !!s.compact_mode);
  applyFavicon(b.favicon_url, accent);
  window.__SN_BRANDING__ = b;

  const bg = document.querySelector('.app-bg');
  if (bg) {
    const url = s.background_url || b.background_url;
    bg.style.backgroundImage = url ? `url("${url}")` : '';
    bg.style.setProperty('--bg-image-opacity', url ? String((s.background_opacity ?? 15) / 100) : '0');
  }
}
