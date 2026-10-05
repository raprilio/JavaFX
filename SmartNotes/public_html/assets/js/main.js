// SmartNotes SPA entry point.
import { api, setCsrf } from './core/api.js';
import { state, applyBootstrap, on } from './core/store.js';
import { applyAll } from './core/theme.js';
import { route, startRouter, navigate, setCurrent, parseHash } from './core/router.js';
import { renderShell, setActive, setContentMode, shell, stopNotifications, renderSidebar } from './core/shell.js';
import { html, icon } from './core/dom.js';
import { toast, setTitle, closePopover } from './core/ui.js';

const root = document.getElementById('app');

// ------------------------------------------------------------------ routes
const PUBLIC = { public: true };
route('/login', () => import('./views/auth.js'), { ...PUBLIC, mode: 'login' });
route('/register', () => import('./views/auth.js'), { ...PUBLIC, mode: 'register' });
route('/forgot-password', () => import('./views/auth.js'), { ...PUBLIC, mode: 'forgot' });
route('/reset-password', () => import('./views/auth.js'), { ...PUBLIC, mode: 'reset' });
route('/', () => import('./views/dashboard.js'));
route('/notes', () => import('./views/notes.js'));
route('/notes/:id', () => import('./views/editor.js'), { flush: true });
route('/tasks', () => import('./views/tasks.js'));
route('/calendar', () => import('./views/calendar.js'));
route('/meetings', () => import('./views/meetings.js'));
route('/meetings/:id', () => import('./views/meetings.js'), { detail: true });
route('/mindmaps', () => import('./views/mindmaps.js'));
route('/mindmaps/:id', () => import('./views/mindmap.js'), { flush: true });
route('/flowcharts', () => import('./views/flowcharts.js'));
route('/flowcharts/:id', () => import('./views/flowchart.js'), { flush: true });
route('/audio', () => import('./views/audio.js'));
route('/files', () => import('./views/files.js'));
route('/search', () => import('./views/search.js'));
route('/trash', () => import('./views/trash.js'));
route('/settings', () => import('./views/settings.js'));
route('/settings/:tab', () => import('./views/settings.js'));
route('/admin', () => import('./views/admin.js'));
route('/admin/:tab', () => import('./views/admin.js'));

let shellMounted = false;
let renderToken = 0;

async function mount(m, { path, query }) {
  closePopover();
  const token = ++renderToken;
  if (!m) {
    if (!state.user) return navigate('/login', { replace: true });
    ensureShell();
    setActive(path);
    setContentMode(false);
    shell.setTitle('Not found');
    shell.content.innerHTML = String(html`<div class="empty"><div class="empty-art">${icon('map-pin-off', 'xl')}</div><h3>Page not found</h3><p>The page you are looking for does not exist.</p><a class="btn primary" href="#/">Back to dashboard</a></div>`);
    return;
  }
  if (m.meta.public) {
    if (state.user && m.meta.mode !== 'reset') return navigate('/', { replace: true });
    shellMounted = false;
    stopNotifications();
    const mod = await m.loader();
    if (token !== renderToken) return;
    const cleanup = await mod.default.render(root, { params: m.params, query, meta: m.meta });
    setCurrent({ cleanup });
    return;
  }
  if (!state.user) {
    sessionStorageSafe('set', 'sn_after_login', location.hash);
    return navigate('/login', { replace: true });
  }
  ensureShell();
  setActive(path);
  const el = setContentMode(!!m.meta.flush);
  shell.saveHandler = null;
  el.innerHTML = '<div style="padding:60px;text-align:center"><span class="spinner"></span></div>';
  let mod;
  try {
    mod = await m.loader();
  } catch (e) {
    console.error(e);
    el.innerHTML = String(html`<div class="empty"><div class="empty-art">${icon('wifi-off', 'xl')}</div><h3>Could not load this page</h3><p>Check your connection and try again.</p><button class="btn primary">Reload</button></div>`);
    el.querySelector('button')?.addEventListener('click', () => location.reload());
    return;
  }
  if (token !== renderToken) return;
  const view = mod.default;
  const ctx = { params: m.params, query, meta: m.meta, path, beforeLeave: null, setTitle: (t) => { shell.setTitle(t); setTitle(t); } };
  ctx.setTitle(view.title || '');
  window.scrollTo(0, 0);
  try {
    const cleanup = await view.render(el, ctx);
    if (token !== renderToken) { cleanup?.(); return; }
    setCurrent({ cleanup, beforeLeave: () => (ctx.beforeLeave ? ctx.beforeLeave() : true) });
  } catch (e) {
    console.error(e);
    el.innerHTML = String(html`<div class="empty"><div class="empty-art">${icon('alert-triangle', 'xl')}</div><h3>Something went wrong</h3><p>${e.message || ''}</p><a class="btn" href="#/">Back to dashboard</a></div>`);
  }
}

function ensureShell() {
  if (shellMounted) return;
  renderShell(root);
  applyAll();
  shellMounted = true;
}

function sessionStorageSafe(op, k, v) {
  try {
    if (op === 'set') sessionStorage.setItem(k, v);
    else if (op === 'get') return sessionStorage.getItem(k);
    else sessionStorage.removeItem(k);
  } catch { /* storage unavailable */ }
  return null;
}

// ------------------------------------------------------------------ session events
on('unauthorized', () => {
  if (!state.user) return;
  state.user = null;
  toast('Your session has ended. Please sign in again.', 'warning');
  shellMounted = false;
  stopNotifications();
  navigate('/login');
});

on('logout', async () => {
  try {
    const r = await api.post('auth/logout');
    setCsrf(r?.csrf);
  } catch { /* ignore */ }
  state.user = null;
  shellMounted = false;
  stopNotifications();
  applyAll();
  navigate('/login');
});

on('login', () => {
  shellMounted = false;
  applyAll();
  const back = sessionStorageSafe('get', 'sn_after_login');
  sessionStorageSafe('del', 'sn_after_login');
  navigate(back && !/login|register|password/.test(back) ? back.replace(/^#/, '') : '/', { replace: true });
});

on('settings:changed', () => applyAll());
on('branding:changed', () => { applyAll(); renderSidebar(); });

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    const d = await api.get('app');
    setCsrf(d.csrf);
    applyBootstrap(d);
  } catch (e) {
    document.getElementById('boot')?.remove();
    root.innerHTML = String(html`<div class="empty" style="min-height:100vh;justify-content:center"><div class="empty-art">${icon('server-crash', 'xl')}</div>
      <h3>Cannot reach the server</h3><p>${e.message}</p><button class="btn primary" data-retry>Try again</button></div>`);
    root.querySelector('[data-retry]').addEventListener('click', () => location.reload());
    return;
  }
  applyAll();
  if (!location.hash) history.replaceState(null, '', '#/');
  const { path } = parseHash();
  if (!state.user && !['/login', '/register', '/forgot-password', '/reset-password'].includes(path)) {
    sessionStorageSafe('set', 'sn_after_login', location.hash);
    history.replaceState(null, '', '#/login');
  }
  await startRouter(mount);
  const b = document.getElementById('boot');
  if (b) { b.classList.add('fade'); setTimeout(() => b.remove(), 350); }
}

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name === 'AbortError') e.preventDefault();
});

boot();
