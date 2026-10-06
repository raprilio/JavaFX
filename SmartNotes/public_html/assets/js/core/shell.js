// Application shell: sidebar, topbar, bottom navigation, notifications, keyboard shortcuts.
import { html, icon, h, $, $$, esc, timeAgo, isMobile, modKey } from './dom.js';
import { state, on, emit, can } from './store.js';
import { api } from './api.js';
import { navigate } from './router.js';
import { menu, popover, toast, avatarHtml, toastError } from './ui.js';
import { CREATE_ITEMS, newNote, newTask, newMeeting, newEvent } from './actions.js';
import { openPalette } from './palette.js';
import { applyThemeMode, effectiveTheme } from './theme.js';

const NAV = [
  { path: '/', label: 'Dashboard', icon: 'layout-dashboard' },
  { path: '/notes', label: 'Notes', icon: 'notebook-pen' },
  { path: '/tasks', label: 'Tasks', icon: 'square-check-big' },
  { path: '/calendar', label: 'Calendar', icon: 'calendar-days' },
  { path: '/meetings', label: 'Meetings', icon: 'users' },
  { path: '/mindmaps', label: 'Mind Maps', icon: 'network' },
  { path: '/flowcharts', label: 'Flowcharts', icon: 'workflow' },
  { path: '/audio', label: 'Audio Notes', icon: 'mic' },
  { path: '/drive', label: 'Drive', icon: 'hard-drive' },
  { path: '/trash', label: 'Trash', icon: 'trash-2' },
];

let shellEl = null;
export const shell = {
  saveHandler: null,
  get content() { return $('#view', shellEl); },
  setTitle(t) { const el = $('.topbar-title', shellEl); if (el) el.textContent = t || ''; },
};

export function brandHtml(b = state.branding || {}) {
  const name = b.app_name || 'SmartNotes';
  const mode = b.logo_url ? b.logo_display || 'logo' : 'name';
  if (mode === 'logo') return html`<a class="brand" href="#/" aria-label="${name}"><img class="brand-logo" src="${b.logo_url}" alt="${name}"></a>`;
  if (mode === 'logo_name') return html`<a class="brand" href="#/"><img class="brand-logo" src="${b.logo_url}" alt=""><span class="brand-name truncate">${name}</span></a>`;
  return html`<a class="brand" href="#/"><span class="brand-mark">${icon('notebook-pen')}</span><span class="brand-name truncate">${name}</span></a>`;
}

function sidebarHtml() {
  const cats = state.categories.note || [];
  return html`
    <div class="sidebar-head">${brandHtml()}
      <button class="btn ghost icon sm sidebar-toggle" data-act="collapse" data-tip="Collapse sidebar" data-tip-pos="right" aria-label="Toggle sidebar">${icon('panel-left-close')}</button></div>
    <div class="sidebar-new"><button class="btn primary" data-act="create">${icon('plus')}<span class="btn-label">Create new</span></button></div>
    <nav class="sidebar-scroll" aria-label="Main">
      ${NAV.map((n) => html`<a class="nav-item" href="#${n.path}" data-path="${n.path}" data-tip="${n.label}" data-tip-pos="right">${icon(n.icon)}<span class="nav-label">${n.label}</span></a>`)}
      <div class="nav-cats">
        <div class="nav-section"><span>Categories</span><a class="btn ghost icon xs" href="#/settings/categories" data-tip="Manage">${icon('settings-2', 'sm')}</a></div>
        ${cats.slice(0, 12).map((c) => html`<a class="nav-item" href="#/notes?category=${c.id}" data-cat="${c.id}"><span class="dot" style="background:${c.color}"></span><span class="nav-label">${c.name}</span><span class="count">${c.count || ''}</span></a>`)}
      </div>
      <div class="nav-section"><span>System</span></div>
      <a class="nav-item" href="#/settings" data-path="/settings" data-tip="Settings" data-tip-pos="right">${icon('settings')}<span class="nav-label">Settings</span></a>
      ${state.isAdminArea ? html`<a class="nav-item" href="#/admin" data-path="/admin" data-tip="Admin" data-tip-pos="right">${icon('shield-check')}<span class="nav-label">Admin panel</span></a>` : ''}
    </nav>
    <div class="sidebar-foot"><button class="user-chip" data-act="user">${avatarHtml(state.user)}<span class="meta"><b class="truncate">${state.user.name}</b><span class="truncate">${state.user.email}</span></span></button></div>`;
}

export function renderShell(root) {
  root.innerHTML = String(html`<div class="app ${state.settings?.sidebar_style === 'collapsed' && !isMobile() ? 'sidebar-collapsed' : ''}">
    <div class="app-bg"></div>
    <aside class="sidebar"></aside>
    <div class="scrim" data-act="close-drawer"></div>
    <div class="main">
      <header class="topbar">
        <button class="btn ghost icon menu-btn" data-act="drawer" aria-label="Open menu">${icon('menu')}</button>
        <div class="topbar-title truncate"></div>
        <button class="search-trigger" data-act="search" aria-label="Search">${icon('search', 'sm')}<span>Search everything…</span><kbd>${modKey} K</kbd></button>
        <div class="topbar-actions">
          <button class="btn ghost icon hide-mobile" data-act="theme" data-tip="Toggle theme">${icon('moon')}</button>
          <button class="btn ghost icon" data-act="notifications" data-tip="Notifications" aria-label="Notifications">${icon('bell')}<span class="badge-dot hidden" data-unread></span></button>
          <button class="btn ghost icon hide-mobile" data-act="new-note" data-tip="New note (${modKey}+Alt+N)">${icon('square-pen')}</button>
        </div>
      </header>
      <main id="view" class="content" tabindex="-1"></main>
    </div>
    <nav class="bottom-nav" aria-label="Mobile">
      <a href="#/" data-path="/">${icon('house')}<span>Home</span></a>
      <a href="#/notes" data-path="/notes">${icon('notebook-pen')}<span>Notes</span></a>
      <a href="#/tasks" data-path="/tasks">${icon('square-check-big')}<span>Tasks</span></a>
      <a href="#/calendar" data-path="/calendar">${icon('calendar-days')}<span>Calendar</span></a>
      <button data-act="drawer">${icon('layout-grid')}<span>More</span></button>
    </nav>
  </div>`);
  shellEl = root.firstElementChild;
  renderSidebar();
  updateThemeIcon();
  setUnread(state.unread);
  bindShell();
  startNotifications();
  bindShortcuts();
  return shell;
}

export function renderSidebar() {
  if (!shellEl) return;
  $('.sidebar', shellEl).innerHTML = String(sidebarHtml());
  setActive(location.hash.replace(/^#/, '').split('?')[0] || '/');
}

export function setActive(path) {
  if (!shellEl) return;
  const cat = new URLSearchParams(location.hash.split('?')[1] || '').get('category');
  const top = '/' + (path.split('/')[1] || '');
  $$('[data-path]', shellEl).forEach((a) => a.classList.toggle('active', a.dataset.path === top && !(cat && top === '/notes' && a.classList.contains('nav-item'))));
  $$('[data-cat]', shellEl).forEach((a) => a.classList.toggle('active', top === '/notes' && a.dataset.cat === cat));
  shellEl.classList.remove('drawer-open');
}

/** Replace the view container with a fresh element so listeners from the previous view never leak. */
export function setContentMode(flush) {
  const old = shell.content;
  const c = old.cloneNode(false);
  c.className = 'content' + (flush ? ' flush' : '');
  old.replaceWith(c);
  return c;
}

function updateThemeIcon() {
  const b = $('[data-act="theme"]', shellEl);
  if (b) b.innerHTML = String(icon(effectiveTheme() === 'dark' ? 'sun' : 'moon'));
}

export function setUnread(n) {
  state.unread = n;
  const d = shellEl && $('[data-unread]', shellEl);
  if (!d) return;
  d.textContent = n > 9 ? '9+' : String(n);
  d.classList.toggle('hidden', !n);
}

function bindShell() {
  shellEl.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) {
      if (e.target.closest('.sidebar a') && isMobile()) shellEl.classList.remove('drawer-open');
      return;
    }
    const act = t.dataset.act;
    if (act === 'collapse') {
      const collapsed = !shellEl.classList.contains('sidebar-collapsed');
      shellEl.classList.toggle('sidebar-collapsed', collapsed);
      state.settings.sidebar_style = collapsed ? 'collapsed' : 'expanded';
      api.post('profile/settings', { sidebar_style: state.settings.sidebar_style }).catch(() => {});
    } else if (act === 'drawer') shellEl.classList.add('drawer-open');
    else if (act === 'close-drawer') shellEl.classList.remove('drawer-open');
    else if (act === 'search') openPalette();
    else if (act === 'new-note') newNote();
    else if (act === 'theme') {
      const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      applyThemeMode(next);
      state.settings.theme = next;
      updateThemeIcon();
      api.post('profile/settings', { theme: next }).catch(() => {});
    } else if (act === 'create') {
      menu(t, [
        ...CREATE_ITEMS.map((c) => ({ label: c.label === 'Task' ? 'New task' : c.label === 'Schedule' ? 'Schedule / event' : c.label, icon: c.icon, onClick: c.run })),
        { label: 'Meeting', icon: 'users', onClick: () => newMeeting() },
      ]);
    } else if (act === 'user') {
      menu(t, [
        { title: state.user.email },
        { label: 'Profile', icon: 'user', onClick: () => navigate('/settings/profile') },
        { label: 'Appearance', icon: 'palette', onClick: () => navigate('/settings/appearance') },
        { label: 'Keyboard shortcuts', icon: 'keyboard', onClick: showShortcuts },
        ...(state.isAdminArea ? [{ label: 'Admin panel', icon: 'shield-check', onClick: () => navigate('/admin') }] : []),
        { divider: true },
        { label: 'Sign out', icon: 'log-out', danger: true, onClick: () => emit('logout') },
      ]);
    } else if (act === 'notifications') openNotifications(t);
  });
  const view = shell.content;
  const topbar = $('.topbar', shellEl);
  window.addEventListener('scroll', () => topbar.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  on('theme:changed', updateThemeIcon);
  on('categories:changed', renderSidebar);
  void view;
}

// ---------------------------------------------------------------- notifications
let lastSeenId = 0;
let pollTimer = null;
async function poll(first = false) {
  if (document.hidden && !first) return;
  try {
    const r = await api.get('notifications');
    setUnread(r.unread);
    const newest = r.items[0]?.id || 0;
    if (!first && newest > lastSeenId) {
      r.items.filter((n) => n.id > lastSeenId && !n.is_read).slice(0, 3).forEach((n) => {
        toast(n.title, 'info', { action: n.link ? 'Open' : '', onAction: () => n.link && navigate(n.link.replace(/^#/, '')) , timeout: 8000 });
        if (window.Notification?.permission === 'granted' && document.hidden !== false) {
          try { new Notification(n.title, { body: n.message || '', tag: 'sn-' + n.id }); } catch { /* ignore */ }
        }
      });
    }
    lastSeenId = Math.max(lastSeenId, newest);
    return r;
  } catch { return null; }
}
function startNotifications() {
  poll(true);
  clearInterval(pollTimer);
  pollTimer = setInterval(() => poll(), 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}
export const stopNotifications = () => clearInterval(pollTimer);

async function openNotifications(anchor) {
  const wrap = h(String(html`<div><div class="notif-head"><b>Notifications</b><div class="row" style="gap:4px">
    <button class="btn ghost sm" data-n="read">Mark all read</button><button class="btn ghost icon sm" data-n="clear" data-tip="Clear all">${icon('trash-2', 'sm')}</button></div></div>
    <div class="notif-list"><div style="padding:30px;text-align:center"><span class="spinner"></span></div></div></div>`));
  const p = popover(anchor, wrap, { align: 'end', className: 'notif-panel' });
  const r = await poll(true);
  const list = $('.notif-list', wrap);
  const items = r?.items || [];
  list.innerHTML = items.length ? items.map((n) => String(html`<div class="notif ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${n.link || ''}">
      <span class="n-icon">${icon(n.type === 'reminder' ? 'alarm-clock' : 'bell', 'sm')}</span>
      <div class="grow" style="min-width:0"><b>${n.title}</b>${n.message ? html`<div class="small muted" style="margin:2px 0">${n.message}</div>` : ''}<span>${timeAgo(n.created_at)}</span></div></div>`)).join('')
    : String(html`<div class="empty" style="padding:34px 16px"><div class="empty-art">${icon('bell-off', 'xl')}</div><h3>All caught up</h3><p>Reminders for tasks, meetings and schedules appear here.</p></div>`);
  wrap.addEventListener('click', async (e) => {
    const n = e.target.closest('[data-n]')?.dataset.n;
    if (n === 'read') { await api.post('notifications/read').catch(toastError); setUnread(0); list.querySelectorAll('.unread').forEach((x) => x.classList.remove('unread')); }
    if (n === 'clear') { await api.post('notifications/clear').catch(toastError); setUnread(0); p.close(); }
    const item = e.target.closest('.notif');
    if (item) {
      api.post('notifications/read', { ids: [+item.dataset.id] }).then(() => poll(true)).catch(() => {});
      p.close();
      if (item.dataset.link) navigate(item.dataset.link.replace(/^#/, ''));
    }
  });
}

// ---------------------------------------------------------------- shortcuts
export function showShortcuts() {
  import('./ui.js').then(({ modal }) => modal({
    title: 'Keyboard shortcuts',
    body: html`<div class="kv" style="grid-template-columns:1fr auto;gap:10px 24px">
      ${[['New note', `${modKey}+N  ·  Alt+N`], ['Search / command palette', `${modKey}+K`], ['Save', `${modKey}+S`], ['New task', `${modKey}+Shift+T  ·  Alt+T`], ['New meeting', 'Alt+M'], ['New event', 'Alt+E'], ['Show shortcuts', '?']]
        .map(([a, k]) => html`<dt style="color:var(--text)">${a}</dt><dd><span class="kbd">${k}</span></dd>`)}
    </div><p class="small subtle mt-3">Some browsers reserve ${modKey}+N and ${modKey}+Shift+T for their own windows/tabs. The Alt alternatives always work.</p>`,
  }));
}

function bindShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!state.user) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const typing = e.target.closest?.('input, textarea, [contenteditable="true"], select');
    if (mod && k === 'k') { e.preventDefault(); openPalette(); return; }
    if (mod && k === 's') {
      e.preventDefault();
      if (shell.saveHandler) shell.saveHandler();
      else toast('Everything is saved automatically', 'success', { timeout: 1600 });
      return;
    }
    if ((mod && !e.shiftKey && k === 'n') || (e.altKey && k === 'n')) { e.preventDefault(); newNote(); return; }
    if ((mod && e.shiftKey && k === 't') || (e.altKey && k === 't')) { e.preventDefault(); newTask(); return; }
    if (e.altKey && k === 'm') { e.preventDefault(); newMeeting(); return; }
    if (e.altKey && k === 'e') { e.preventDefault(); newEvent(); return; }
    if (!typing && !mod && e.key === '?') { e.preventDefault(); showShortcuts(); }
  });
}
export { esc, can };
