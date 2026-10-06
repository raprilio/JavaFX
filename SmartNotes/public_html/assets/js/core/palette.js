// Command / search palette (Ctrl+K).
import { html, icon, h, debounce, fmtDay, highlight, modKey } from './dom.js';
import { api } from './api.js';
import { navigate } from './router.js';
import { modal } from './ui.js';
import { state, can } from './store.js';
import { CREATE_ITEMS, newMeeting, newEvent } from './actions.js';
import { applyThemeMode } from './theme.js';

const TYPE_META = {
  note: ['notebook-pen', 'Notes'], task: ['square-check-big', 'Tasks'], meeting: ['users', 'Meetings'], event: ['calendar-days', 'Calendar'],
  mindmap: ['network', 'Mind maps'], flowchart: ['workflow', 'Flowcharts'], audio: ['mic', 'Audio notes'], file: ['hard-drive', 'Drive'],
};

function commands() {
  const nav = [
    ['Dashboard', 'layout-dashboard', '/'], ['Notes', 'notebook-pen', '/notes'], ['Tasks', 'square-check-big', '/tasks'], ['Calendar', 'calendar-days', '/calendar'],
    ['Meetings', 'users', '/meetings'], ['Mind maps', 'network', '/mindmaps'], ['Flowcharts', 'workflow', '/flowcharts'], ['Audio notes', 'mic', '/audio'],
    ['Drive', 'hard-drive', '/drive'], ['Trash', 'trash-2', '/trash'], ['Settings', 'settings', '/settings'], ['Advanced search', 'search', '/search'],
  ].map(([label, ic, path]) => ({ label: `Go to ${label}`, icon: ic, run: () => navigate(path), group: 'Navigate' }));
  const create = CREATE_ITEMS.map((c) => ({ label: c.label === 'Task' ? 'New task' : c.label === 'Schedule' ? 'New schedule' : c.label === 'Audio note' ? 'Record audio note' : c.label.startsWith('New') ? c.label : `New ${c.label.toLowerCase()}`, icon: c.icon, run: c.run, group: 'Create' }));
  create.push({ label: 'New meeting', icon: 'users', run: () => newMeeting(), group: 'Create' });
  create.push({ label: 'New event', icon: 'calendar-plus', run: () => newEvent(), group: 'Create' });
  const misc = [
    { label: 'Switch to light theme', icon: 'sun', run: () => applyThemeMode('light'), group: 'Preferences' },
    { label: 'Switch to dark theme', icon: 'moon', run: () => applyThemeMode('dark'), group: 'Preferences' },
  ];
  if (state.isAdminArea) misc.push({ label: 'Open admin panel', icon: 'shield-check', run: () => navigate('/admin'), group: 'Navigate' });
  return [...create, ...nav, ...misc];
}

let openInstance = null;
export function openPalette(initial = '') {
  if (openInstance) return;
  const body = h(String(html`<div>
    <div class="palette-input">${icon('search')}<input type="text" placeholder="Search notes, tasks, meetings… or type a command" value="${initial}" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
    <div class="palette-results"></div>
    <div class="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> open</span><span class="hide-sm"><kbd>${modKey}</kbd>+<kbd>K</kbd> toggle</span></div>
  </div>`));
  const m = modal({ title: null, body, className: 'palette', size: 'lg' });
  m.body.style.padding = '0';
  openInstance = m;
  m.result.then(() => (openInstance = null));
  const input = body.querySelector('input');
  const results = body.querySelector('.palette-results');
  let items = [];
  let focus = 0;
  let ctrl;

  const render = (groups, q) => {
    items = [];
    let out = '';
    groups.forEach(([title, list]) => {
      if (!list.length) return;
      out += String(html`<div class="palette-group">${title}</div>`);
      list.forEach((it) => {
        const k = items.length;
        items.push(it);
        out += String(html`<div class="palette-item" data-k="${k}"><span class="pi-icon">${icon(it.icon, 'sm')}</span>
          <div class="pi-main"><div class="pi-title">${highlight(it.label, q)}</div>${it.sub ? html`<div class="pi-sub">${it.sub}</div>` : ''}</div>
          ${it.date ? html`<span class="tiny subtle nowrap">${fmtDay(it.date)}</span>` : ''}</div>`);
      });
    });
    results.innerHTML = out || String(html`<div class="empty" style="padding:36px 10px"><div class="empty-art">${icon('search-x', 'xl')}</div><h3>No results</h3><p>Try another keyword or open <a href="#/search?q=${encodeURIComponent(q)}">advanced search</a>.</p></div>`);
    focus = 0;
    paint();
  };
  const paint = () => {
    results.querySelectorAll('.palette-item').forEach((el) => el.classList.toggle('focus', +el.dataset.k === focus));
    results.querySelector('.palette-item.focus')?.scrollIntoView({ block: 'nearest' });
  };
  const runItem = (it) => {
    if (!it) return;
    m.close();
    setTimeout(() => (it.run ? it.run() : navigate(it.link.replace(/^#/, ''))), 10);
  };

  const search = debounce(async (q) => {
    const cmds = commands().filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
    if (q.length < 2) {
      const groups = {};
      (q ? cmds : commands()).forEach((c) => (groups[c.group] ||= []).push(c));
      return render(Object.entries(groups), q);
    }
    ctrl?.abort();
    ctrl = new AbortController();
    try {
      const r = await api.get('search', { q, limit: 6 }, { signal: ctrl.signal });
      const groups = Object.entries(r.groups).map(([type, list]) => [TYPE_META[type]?.[1] || type, list.map((x) => ({
        label: x.title, sub: x.snippet || (x.meta || []).join(' · '), icon: TYPE_META[type]?.[0] || 'file', link: x.link, date: x.date,
      }))]);
      groups.push(['Commands', cmds.slice(0, 5)]);
      groups.push(['More', [{ label: `Search everything for “${q}”`, icon: 'search', run: () => navigate(`/search?q=${encodeURIComponent(q)}`) }]]);
      render(groups, q);
    } catch (e) {
      if (e.name !== 'AbortError') render([['Commands', cmds]], q);
    }
  }, 200);

  input.addEventListener('input', () => search(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); focus = Math.min(items.length - 1, focus + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focus = Math.max(0, focus - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); runItem(items[focus]); }
  });
  results.addEventListener('mousemove', (e) => {
    const it = e.target.closest('.palette-item');
    if (it && +it.dataset.k !== focus) { focus = +it.dataset.k; paint(); }
  });
  results.addEventListener('click', (e) => {
    const it = e.target.closest('.palette-item');
    if (it) runItem(items[+it.dataset.k]);
    if (e.target.closest('a')) m.close();
  });
  search(initial);
  setTimeout(() => input.focus(), 30);
}
export const closePalette = () => openInstance?.close();
export { can };
