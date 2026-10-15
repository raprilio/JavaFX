// Dashboard: greeting, quick create, stats, today, recent notes, upcoming, task progress.
// Every section and stat card can be hidden per user (saved in user_settings.dashboard_hidden).
// v1.21: every user arranges their own dashboard — "Edit layout" lets you drag widgets to move them and drag a
// widget's corner to resize it (width in 12ths of the page, height fixed or fitting its content); saved in
// user_settings.dashboard_layout as [{k, x, w, h}]. Each widget keeps its own column (x) and floats up under the
// widgets above it, like a grid board; on phones they stack in your order.
import { html, icon, h, fmtTime, fmtDay, timeAgo, greeting, parseDate, todayStr } from '../core/dom.js';
import { api } from '../core/api.js';
import { state, on } from '../core/store.js';
import { navigate } from '../core/router.js';
import { toast, toastError, empty, modal, confirm } from '../core/ui.js';
import { CREATE_ITEMS } from '../core/actions.js';

const TYPE_COLOR = { event: '#8b5cf6', meeting: '#0ea5e9', task: '#10b981' };
const TYPE_ICON = { event: 'calendar-days', meeting: 'users', task: 'square-check-big' };
/** Team progress line colours by status (yellow = at risk, red = blocked). */
const TP_COLOR = { on_track: '#22c55e', at_risk: '#eab308', blocked: '#ef4444', done: '#10b981' };
const TP_LABEL = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked', done: 'Published' };

const teamRow = (it) => html`<a class="tp-row" href="#/progress/${it.id}" style="--c:${TP_COLOR[it.status] || TP_COLOR.on_track}" data-tip="${TP_LABEL[it.status] || ''}${it.stage ? ` · ${it.stage}` : ''}">
  <div class="tp-top">${it.pinned ? html`<span class="tp-pin" data-tip="Pinned">${icon('pin', 'xs')}</span>` : ''}<span class="tp-title truncate">${it.title}</span>${it.mine ? html`<span class="tp-you">you</span>` : ''}<span class="tp-stage truncate">${it.status === 'done' ? html`${icon('rocket', 'xs')} Published` : it.stage || ''}</span></div>
  <div class="tp-line"><div class="tp-track" role="progressbar" aria-valuenow="${it.percent}" aria-valuemin="0" aria-valuemax="100"><span style="--w:${it.percent}%"></span></div><b class="tp-pct">${it.percent}%</b></div></a>`;

/** [key, label, value(counts), icon, color, foot(counts), link] */
const STATS = [
  ['stat_notes', 'Total notes', (c) => c.notes, 'notebook-pen', '#6366f1', (c) => (c.notes_today ? `+${c.notes_today} today` : ''), '#/notes'],
  ['stat_notes_today', 'Notes today', (c) => c.notes_today, 'sparkles', '#ec4899', () => '', '#/notes?sort=created'],
  ['stat_tasks_active', 'Active tasks', (c) => c.tasks_active, 'circle-dot', '#f59e0b', (c) => (c.tasks_overdue ? `${c.tasks_overdue} overdue` : ''), '#/tasks'],
  ['stat_tasks_done', 'Completed tasks', (c) => c.tasks_completed, 'circle-check', '#10b981', () => '', '#/tasks?status=completed'],
  ['stat_meetings', 'Upcoming meetings', (c) => c.meetings_upcoming, 'users', '#0ea5e9', () => '', '#/meetings'],
  ['stat_events', 'Upcoming schedule', (c) => c.events_upcoming, 'calendar-clock', '#8b5cf6', () => '30 days', '#/calendar'],
  ['stat_audio', 'Audio notes', (c) => c.audio, 'mic', '#db2777', () => '', '#/audio'],
  ['stat_mindmaps', 'Mind maps', (c) => c.mindmaps, 'network', '#eab308', () => '', '#/mindmaps'],
  ['stat_flowcharts', 'Flowcharts', (c) => c.flowcharts, 'workflow', '#14b8a6', () => '', '#/flowcharts'],
  ['stat_drive', 'Drive files', (c) => c.drive_files, 'hard-drive', '#0891b2', () => '', '#/drive'],
  ['stat_shared', 'Shared with me', (c) => c.shared_with_me, 'users', '#7c3aed', () => '', '#/notes?filter=shared'],
];
const SECTIONS = [
  ['quick_create', 'Quick create', 'plus'], ['stats', 'Statistic cards', 'chart-column'], ['today', 'Today', 'sun'],
  ['shared_notes', 'Shared with me', 'users'], ['recent_notes', 'Recent notes', 'history'], ['task_progress', 'Task progress', 'chart-pie'],
  ['team_progress', 'Team progress', 'chart-no-axes-gantt'],
  ['upcoming', 'Upcoming', 'calendar-clock'], ['notes_week', 'Notes this week', 'activity'],
];

const hiddenSet = () => new Set(state.settings?.dashboard_hidden || []);
/** Default layout: [key, column (0–11), width in 12ths] — the classic wide-left / narrow-right dashboard. */
const DEFAULT_LAYOUT = [['quick_create', 0, 12], ['stats', 0, 12], ['today', 0, 8], ['task_progress', 8, 4], ['shared_notes', 0, 8], ['team_progress', 8, 4], ['recent_notes', 0, 8], ['upcoming', 8, 4], ['notes_week', 8, 4]];
const WIDTHS = [3, 4, 6, 8, 9, 12];
const ROW = 8; // px per grid row: a widget spans as many rows as it is tall
const clampW = (w) => Math.max(3, Math.min(12, Math.round(+w) || 12));
/** The user's layout, completed with widgets it does not mention yet (new ones end up at the bottom). */
function layoutOf() {
  const saved = Array.isArray(state.settings?.dashboard_layout) ? state.settings.dashboard_layout : [];
  const out = saved.filter((x) => x && DEFAULT_LAYOUT.some(([k]) => k === x.k)).map((x) => {
    const w = clampW(x.w);
    return { k: x.k, x: Math.max(0, Math.min(12 - w, Math.round(+x.x) || 0)), w, h: x.h ? +x.h : null };
  });
  DEFAULT_LAYOUT.forEach(([k, x, w]) => { if (!out.some((y) => y.k === k)) out.push({ k, x, w, h: null }); });
  return out;
}
const isPhone = () => matchMedia('(max-width: 767px)').matches;
/**
 * Where every widget goes: in layout order, each takes its column(s) and sits right under whatever is already in
 * those columns (so nothing overlaps and nothing floats away from its column). heights: key → px.
 */
function place(items, heights, gap) {
  const col = Array(12).fill(0);
  const pos = {};
  for (const it of items) {
    if (!heights.has(it.k)) continue;
    const w = isPhone() ? 12 : it.w, x = isPhone() ? 0 : Math.min(it.x, 12 - w);
    let top = 0;
    for (let c = x; c < x + w; c++) top = Math.max(top, col[c]);
    const span = Math.max(1, Math.ceil((heights.get(it.k) + gap) / ROW));
    pos[it.k] = { x, w, top, span };
    for (let c = x; c < x + w; c++) col[c] = top + span;
  }
  return pos;
}
const fraction = (w) => ({ 3: '¼', 4: '⅓', 6: '½', 8: '⅔', 9: '¾', 12: 'Full' }[w] || `${w}/12`);
const hideBtn = (key) => html`<button class="btn ghost icon xs dash-hide" data-hide="${key}" data-tip="Hide from dashboard" aria-label="Hide">${icon('eye-off', 'sm')}</button>`;

function statCard([key, label, val, ic, color, foot, link], c) {
  const f = foot(c);
  return html`<a class="card stat hoverable" style="--c:${color};color:inherit;text-decoration:none" href="${link}" data-widget="${key}">
    <div class="row between"><span class="stat-icon">${icon(ic)}</span>${f ? html`<span class="stat-foot">${f}</span>` : ''}</div>
    <div class="stat-value" data-count="${val(c) || 0}">0</div><div class="stat-label">${label}</div>${hideBtn(key)}</a>`;
}

function agendaRow(it) {
  const d = parseDate(it.start);
  const time = it.all_day ? 'All day' : fmtTime(it.start);
  const link = it.type === 'meeting' ? `#/meetings/${it.id}` : it.type === 'task' ? `#/tasks?open=${it.id}` : `#/calendar?event=${it.id}&date=${it.start.slice(0, 10)}`;
  return html`<a class="agenda-item" href="${link}" style="color:inherit;text-decoration:none">
    <div class="agenda-time">${time}</div><span class="agenda-bar" style="--c:${it.color || TYPE_COLOR[it.type]}"></span>
    <div class="grow" style="min-width:0"><div class="truncate" style="font-weight:580;${it.status === 'completed' ? 'text-decoration:line-through;color:var(--text-3)' : ''}">${it.title}</div>
      <div class="small subtle row" style="gap:6px">${icon(TYPE_ICON[it.type], 'sm')} ${it.type === 'task' ? 'Task' : it.type === 'meeting' ? 'Meeting' : (it.event_type || 'Event')}${it.shared ? html` · by ${it.owner_name}` : ''}${it.location ? html` · ${it.location}` : ''}${d && it.type !== 'task' && !it.all_day ? html` · until ${fmtTime(it.end)}` : ''}</div></div></a>`;
}

const noteCard = (n, meta) => html`<a class="note-card" data-nc="${n.color || ''}" href="#/notes/${n.id}" style="margin:0">
  ${n.is_pinned ? html`<span class="nc-pin">${icon('pin', 'sm')}</span>` : ''}
  <h3>${n.title || 'Untitled'}</h3>${n.is_locked && !n.excerpt ? html`<div class="nc-body nc-locked">${icon('lock', 'sm')} Locked</div>` : html`<div class="nc-body" style="-webkit-line-clamp:3">${n.excerpt || ''}</div>`}
  <div class="nc-meta">${meta}</div></a>`;

function render(el, d) {
  const hidden = hiddenSet();
  const show = (k) => !hidden.has(k);
  const c = d.counts;
  const p = d.progress;
  const tp = d.team_progress || { items: [], active: 0, avg_active: 0 };
  const first = (state.user.name || '').split(' ')[0];
  const maxSeries = Math.max(1, ...d.notes_series.map((s) => s.count));
  const todayItems = [...d.today];
  const stats = STATS.filter(([k]) => show(k));
  const W = {
    today: show('today') && html`<div class="card" data-widget="today"><div class="card-head"><h3>${icon('sun', 'sm')} Today</h3><div class="row" style="gap:2px"><a class="btn ghost sm" href="#/calendar?view=day">Open day ${icon('chevron-right', 'sm')}</a>${hideBtn('today')}</div></div>
      <div class="card-body"><div class="grid grid-2" style="gap:24px">
        <div><div class="label mb-1">Agenda & meetings</div>
          ${todayItems.filter((i) => i.type !== 'task').length ? todayItems.filter((i) => i.type !== 'task').map(agendaRow) : html`<p class="small subtle" style="padding:10px 0">No meetings or events today.</p>`}</div>
        <div><div class="label mb-1">Tasks due</div>
          ${d.today_tasks.length ? d.today_tasks.map((t) => html`<div class="row" style="padding:7px 0;border-bottom:1px dashed var(--border)">
            <button class="t-check prio-${t.priority}" data-done="${t.id}" aria-label="Complete">${icon('check')}</button>
            <a class="grow truncate" href="#/tasks?open=${t.id}" style="color:inherit">${t.title}</a>
            <span class="tiny ${t.due_date < todayStr() ? 'overdue' : 'subtle'}">${t.due_date < todayStr() ? fmtDay(t.due_date) : t.due_time || 'Today'}</span></div>`)
            : html`<p class="small subtle" style="padding:10px 0">Nothing due. Nice work!</p>`}</div>
      </div></div></div>`,
    shared_notes: show('shared_notes') && d.shared_notes.length && html`<div class="card" data-widget="shared_notes"><div class="card-head"><h3>${icon('users', 'sm')} Shared with me</h3><div class="row" style="gap:2px"><a class="btn ghost sm" href="#/notes?filter=shared">View all ${icon('chevron-right', 'sm')}</a>${hideBtn('shared_notes')}</div></div>
      <div class="card-body"><div class="grid grid-3" style="gap:12px">${d.shared_notes.map((n) => noteCard(n, html`<span class="badge info">${icon('user', 'sm')} ${n.owner_name}</span><span>${n.permission === 'edit' ? 'can edit' : 'view'}</span>`))}</div></div></div>`,
    recent_notes: show('recent_notes') && html`<div class="card" data-widget="recent_notes"><div class="card-head"><h3>${icon('history', 'sm')} Recent notes</h3><div class="row" style="gap:2px"><a class="btn ghost sm" href="#/notes">View all ${icon('chevron-right', 'sm')}</a>${hideBtn('recent_notes')}</div></div>
      <div class="card-body">${d.recent_notes.length ? html`<div class="grid grid-3" style="gap:12px">${d.recent_notes.map((n) => noteCard(n, html`${icon('clock', 'sm')} ${timeAgo(n.last_opened_at || n.updated_at)}`))}</div>`
        : empty({ icon: 'notebook-pen', title: 'No notes yet', text: 'Create your first note to see it here.', action: '<button class="btn primary" data-qc="note">New note</button>' })}</div></div>`,
    task_progress: show('task_progress') && html`<div class="card" data-widget="task_progress"><div class="card-head"><h3>${icon('chart-pie', 'sm')} Task progress</h3><div class="row" style="gap:2px"><a class="btn ghost sm" href="#/tasks?view=board">Board</a>${hideBtn('task_progress')}</div></div>
      <div class="card-body"><div class="row" style="gap:22px">
        <div class="ring" style="--v:${p.percent}"><span>${p.percent}%</span></div>
        <div class="col" style="gap:8px;flex:1">
          <div class="row between small"><span class="muted">Completed</span><b>${p.completed}</b></div>
          <div class="row between small"><span class="muted">In progress</span><b>${p.in_progress}</b></div>
          <div class="row between small"><span class="muted">Total</span><b>${p.total}</b></div>
          ${c.tasks_overdue ? html`<div class="badge danger">${icon('alert-triangle', 'sm')} ${c.tasks_overdue} overdue</div>` : ''}
        </div></div>
        <div class="progress mt-3"><span style="width:${p.percent}%"></span></div></div></div>`,
    team_progress: show('team_progress') && html`<div class="card" data-widget="team_progress"><div class="card-head"><h3>${icon('chart-no-axes-gantt', 'sm')} Team progress</h3><div class="row" style="gap:2px"><a class="btn ghost sm" href="#/progress">View all ${icon('chevron-right', 'sm')}</a>${hideBtn('team_progress')}</div></div>
      <div class="card-body">${tp.items.length ? html`${tp.active ? html`<div class="tp-sum small muted">${tp.active} in progress · average <b>${tp.avg_active}%</b></div>` : ''}<div class="tp-list">${tp.items.map(teamRow)}</div>`
        : html`<p class="small subtle" style="margin:0">No team progress yet. <a href="#/progress">Start tracking</a></p>`}</div></div>`,
    upcoming: show('upcoming') && html`<div class="card" data-widget="upcoming"><div class="card-head"><h3>${icon('calendar-clock', 'sm')} Upcoming</h3><div class="row" style="gap:2px"><a class="btn ghost sm" href="#/calendar">Calendar</a>${hideBtn('upcoming')}</div></div>
      <div class="card-body">${d.upcoming.length ? d.upcoming.map((it) => {
        const dt = parseDate(it.start);
        return html`<a class="row" href="${it.type === 'meeting' ? `#/meetings/${it.id}` : `#/calendar?event=${it.id}&date=${it.start.slice(0, 10)}`}" style="padding:8px 0;color:inherit;text-decoration:none;border-bottom:1px dashed var(--border)">
          <div class="date-block"><span>${dt.toLocaleDateString(undefined, { month: 'short' })}</span><b>${dt.getDate()}</b></div>
          <div class="grow" style="min-width:0"><div class="truncate" style="font-weight:580">${it.title}</div><div class="small subtle">${fmtDay(it.start)} · ${it.all_day ? 'All day' : fmtTime(it.start)} · ${it.type === 'meeting' ? 'Meeting' : it.event_type || 'Event'}${it.shared ? html` · ${icon('users', 'xs')} ${it.owner_name}` : ''}</div></div></a>`;
      }) : html`<p class="small subtle">Nothing scheduled in the next two weeks.</p>`}</div></div>`,
    notes_week: show('notes_week') && html`<div class="card" data-widget="notes_week"><div class="card-head"><h3>${icon('activity', 'sm')} Notes this week</h3>${hideBtn('notes_week')}</div>
      <div class="card-body"><div class="spark">${d.notes_series.map((s, i) => html`<span class="${i === 6 ? 'today' : ''}" style="height:${Math.max(6, (s.count / maxSeries) * 100)}%" data-tip="${s.count} on ${s.date}"></span>`)}</div>
        <div class="row between tiny subtle mt-1"><span>${fmtDay(d.notes_series[0].date)}</span><span>Today</span></div></div></div>`,
    quick_create: show('quick_create') && html`<div class="quick-create dash-section" data-widget="quick_create">${CREATE_ITEMS.map((q) => html`<button class="qc" style="--c:${q.color}" data-qc="${q.key}"><span class="qc-icon">${icon(q.icon)}</span><span>${q.key === 'note' ? 'New Note' : q.label}<small>${q.sub}</small></span></button>`)}${hideBtn('quick_create')}</div>`,
    stats: show('stats') && stats.length && html`<div class="stats-grid" data-widget="stats">${stats.map((s) => statCard(s, c))}</div>`,
  };
  const layout = layoutOf();
  const shown = layout.filter((x) => W[x.k]);
  const nothing = !shown.length;
  const editing = el.classList.contains('dash-editing');
  const widget = (x) => html`<section class="dw" data-dw="${x.k}" style="grid-column:${x.x + 1} / span ${x.w}">
    <div class="dw-in ${x.h ? 'fixed' : ''}" style="${x.h ? `height:${x.h}px` : ''}">${W[x.k]}</div>
    <div class="dw-bar" aria-hidden="${editing ? 'false' : 'true'}"><span class="dw-grip" data-tip="Drag to move">${icon('grip-vertical', 'sm')}</span>
      <button type="button" class="btn ghost icon xs" data-dw-w="-1" data-tip="Narrower" aria-label="Narrower">${icon('chevron-left', 'sm')}</button><b class="dw-size">${fraction(x.w)}</b>
      <button type="button" class="btn ghost icon xs" data-dw-w="1" data-tip="Wider" aria-label="Wider">${icon('chevron-right', 'sm')}</button>
      <button type="button" class="btn ghost icon xs ${x.h ? '' : 'on'}" data-dw-auto data-tip="${x.h ? 'Fit height to the content' : 'Height fits the content — drag the corner to fix it'}" aria-label="Auto height">${icon('fold-vertical', 'sm')}</button>
      <button type="button" class="btn ghost icon xs" data-hide="${x.k}" data-tip="Hide from dashboard" aria-label="Hide">${icon('eye-off', 'sm')}</button></div>
    <span class="dw-rs" data-dw-rs data-no-drag data-tip="Drag to resize · double-click: fit height" aria-hidden="true"></span></section>`;

  el.innerHTML = String(html`
  <div class="hero"><div><h1>${greeting()}, ${first}</h1><p>${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${todayItems.length ? `${todayItems.length} item${todayItems.length > 1 ? 's' : ''} on your agenda today` : 'Your agenda is clear today'}</p></div>
    <div class="row"><button class="btn ${editing ? 'primary' : 'ghost'}" data-act="layout" data-tip="${editing ? 'Finish arranging' : 'Move and resize the widgets'}">${icon(editing ? 'check' : 'layout-dashboard', 'sm')}<span class="hide-sm">${editing ? 'Done' : 'Edit layout'}</span></button>
      <button class="btn ghost" data-act="customize" data-tip="Show or hide dashboard widgets">${icon('settings-2', 'sm')}<span class="hide-sm">Customize</span>${hidden.size ? html`<span class="badge">${hidden.size} hidden</span>` : ''}</button>
      <a class="btn" href="#/calendar">${icon('calendar-days', 'sm')} Calendar</a><button class="btn primary" data-qc="note">${icon('plus', 'sm')} New note</button></div></div>

  ${editing ? html`<div class="dash-edit-hint">${icon('move', 'sm')} <span><b>Arrange your dashboard.</b> ${matchMedia('(pointer: coarse)').matches ? 'Hold a widget, then drag it to a new place.' : 'Drag a widget to move it, drag its bottom-right corner to resize.'} Only you see this layout.</span>
    <button class="btn sm ghost" data-act="layout-reset">${icon('rotate-ccw', 'sm')} Reset layout</button><button class="btn sm primary" data-act="layout">${icon('check', 'sm')} Done</button></div>` : ''}
  ${nothing ? html`<div class="card card-pad">${empty({ icon: 'eye-off', title: 'Everything is hidden', text: 'You hid every dashboard widget. Bring back the ones you need.', action: '<button class="btn primary" data-act="show-all">Show all widgets</button>' })}</div>` : ''}
  <div class="dash-board ${editing ? 'editing' : ''}" data-board>${shown.map(widget)}</div>`);
  const board = el.querySelector('[data-board]');
  board.lay = layout;
  layoutBoard(el);
  // Count-up animation
  el.querySelectorAll('[data-count]').forEach((n) => {
    const target = +n.dataset.count;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 600);
      n.textContent = Math.round(target * (1 - (1 - k) ** 3)).toLocaleString();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** Measure the widgets and put them on the board; done again whenever a widget's content changes size. */
let boardObserver = null;
function layoutBoard(el) {
  const board = el.querySelector('[data-board]');
  boardObserver?.disconnect();
  if (!board) return;
  const relayout = () => {
    const gap = parseFloat(getComputedStyle(board).columnGap) || 16;
    const heights = new Map();
    board.querySelectorAll('.dw').forEach((dw) => heights.set(dw.dataset.dw, dw.querySelector('.dw-in').getBoundingClientRect().height));
    const pos = place(board.lay, heights, gap);
    board.querySelectorAll('.dw').forEach((dw) => {
      const p = pos[dw.dataset.dw];
      if (!p) return;
      dw.style.gridColumn = `${p.x + 1} / span ${p.w}`;
      dw.style.gridRow = `${p.top + 1} / span ${p.span}`;
    });
  };
  board.relayout = relayout;
  relayout();
  let raf = 0;
  boardObserver = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; relayout(); }); });
  board.querySelectorAll('.dw-in').forEach((x) => boardObserver.observe(x));
}
/** Store this user's layout (order, column, width, height). */
async function saveLayout(next) {
  state.settings = { ...state.settings, dashboard_layout: next };
  try {
    const r = await api.post('profile/settings', { dashboard_layout: next });
    state.settings = { ...state.settings, dashboard_layout: r.dashboard_layout };
  } catch (e) { toastError(e); }
}
const patchLayout = (k, patch) => saveLayout(layoutOf().map((x) => (x.k === k ? { ...x, ...patch } : x)));

async function saveHidden(list) {
  const r = await api.post('profile/settings', { dashboard_hidden: [...list] });
  state.settings = { ...state.settings, dashboard_hidden: r.dashboard_hidden };
}

function customize(onSaved) {
  const hidden = hiddenSet();
  const row = ([k, label, ic]) => html`<label class="dash-opt"><input type="checkbox" value="${k}" ${hidden.has(k) ? '' : 'checked'}><span class="dash-opt-ic">${icon(ic, 'sm')}</span><span class="grow">${label}</span></label>`;
  const body = h(String(html`<div class="col" style="gap:14px">
    <p class="small muted" style="margin:0">Tick what you want to see. Hidden widgets are only hidden for you — nothing is deleted.</p>
    <div><div class="label mb-1">Sections</div><div class="dash-opts">${SECTIONS.map(row)}</div></div>
    <div><div class="label mb-1">Statistic cards</div><div class="dash-opts">${STATS.map(([k, label, , ic]) => row([k, label, ic]))}</div></div>
  </div>`));
  modal({
    title: 'Customize dashboard', body, size: 'sm',
    actions: [
      { label: 'Show all', left: true, variant: 'ghost', onClick: () => { body.querySelectorAll('input').forEach((i) => (i.checked = true)); return false; } },
      { label: 'Cancel' },
      { label: 'Save', variant: 'primary', onClick: async () => {
        await saveHidden([...body.querySelectorAll('input:not(:checked)')].map((i) => i.value));
        onSaved();
        toast('Dashboard updated', 'success', { timeout: 1500 });
      } },
    ],
  });
}

export default {
  title: 'Dashboard',
  async render(el) {
    el.innerHTML = String(html`<div class="hero"><div><div class="skeleton" style="width:260px;height:30px"></div><div class="skeleton sk-line" style="width:340px"></div></div></div>
      <div class="quick-create">${Array.from({ length: 6 }, () => html`<div class="skeleton" style="height:96px;border-radius:16px"></div>`)}</div>
      <div class="stats-grid">${Array.from({ length: 6 }, () => html`<div class="skeleton" style="height:118px;border-radius:18px"></div>`)}</div>`);
    let data = null;
    const paint = () => data && render(el, data);
    const load = async () => {
      try { data = await api.get('dashboard'); paint(); } catch (e) { toastError(e); }
    };
    await load();
    el.addEventListener('click', async (e) => {
      const hide = e.target.closest('[data-hide]');
      if (hide) {
        e.preventDefault();
        e.stopPropagation();
        const key = hide.dataset.hide;
        const set = hiddenSet();
        set.add(key);
        try {
          await saveHidden(set);
          paint();
          toast('Widget hidden', 'success', { action: 'Undo', onAction: async () => { set.delete(key); await saveHidden(set).catch(toastError); paint(); } });
        } catch (err) { toastError(err); }
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'layout') { el.classList.toggle('dash-editing'); return paint(); }
      if (act === 'layout-reset') {
        if (!(await confirm({ title: 'Reset the layout?', message: 'Widgets go back to their original place and size. Hidden widgets stay hidden.', confirmText: 'Reset', danger: false, icon: 'rotate-ccw' }))) return;
        state.settings = { ...state.settings, dashboard_layout: [] };
        await api.post('profile/settings', { dashboard_layout: [] }).catch(toastError);
        return paint();
      }
      const dwStep = e.target.closest('[data-dw-w]');
      if (dwStep) {
        const k = dwStep.closest('.dw').dataset.dw;
        const cur = layoutOf().find((x) => x.k === k);
        const near = WIDTHS.reduce((b, w, j) => (Math.abs(w - cur.w) < Math.abs(WIDTHS[b] - cur.w) ? j : b), 0);
        const w = WIDTHS[Math.max(0, Math.min(WIDTHS.length - 1, near + +dwStep.dataset.dwW))];
        await patchLayout(k, { w, x: Math.min(cur.x, 12 - w) }); // a wider widget moves left if it would stick out
        return paint();
      }
      const auto = e.target.closest('[data-dw-auto]');
      if (auto) { await patchLayout(auto.closest('.dw').dataset.dw, { h: null }); return paint(); }
      if (act === 'show-all') { try { await saveHidden([]); paint(); } catch (err) { toastError(err); } return; }
      const q = e.target.closest('[data-qc]');
      if (q) return CREATE_ITEMS.find((x) => x.key === q.dataset.qc)?.run();
      const done = e.target.closest('[data-done]');
      if (done) {
        done.classList.add('on');
        try { await api.post(`tasks/${done.dataset.done}/status`, { status: 'completed' }); setTimeout(load, 400); } catch (err) { toastError(err); }
      }
    });
    // ---- arranging (v1.21): while editing, drag a widget to move it (hold first on a touch screen) and drag its
    // corner to resize it. The other widgets make room live, so you see the result before letting go.
    const editing = () => el.classList.contains('dash-editing');
    const geom = () => {
      const board = el.querySelector('[data-board]');
      const br = board.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(board).columnGap) || 16;
      return { board, br, gap, colW: (br.width + gap) / 12 };
    };
    el.addEventListener('dblclick', async (e) => {
      const rs = e.target.closest('[data-dw-rs]');
      if (rs && editing()) { await patchLayout(rs.closest('.dw').dataset.dw, { h: null }); paint(); }
    });
    el.addEventListener('pointerdown', (e) => {
      if (!editing() || (e.button !== undefined && e.button > 0)) return;
      const rs = e.target.closest('[data-dw-rs]');
      const dw = e.target.closest('.dw');
      if (!dw) return;
      if (rs) return startResize(e, dw, rs);
      if (e.target.closest('button, a, input, select, textarea')) return;
      startMove(e, dw);
    });
    function startResize(e, dw, rs) {
      e.preventDefault();
      const { board, gap, colW } = geom();
      const inner = dw.querySelector('.dw-in');
      const natural = inner.scrollHeight;
      const it = board.lay.find((x) => x.k === dw.dataset.dw);
      let hgt = null;
      dw.classList.add('resizing');
      try { rs.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      const move = (ev) => {
        const r = dw.getBoundingClientRect();
        it.w = Math.max(3, Math.min(12 - it.x, Math.round((ev.clientX - r.left + gap) / colW)));
        dw.querySelector('.dw-size').textContent = fraction(it.w);
        hgt = Math.max(120, Math.round(ev.clientY - r.top));
        inner.style.height = hgt + 'px';
        inner.classList.add('fixed');
        board.relayout();
      };
      const up = async () => {
        rs.removeEventListener('pointermove', move); rs.removeEventListener('pointerup', up); rs.removeEventListener('pointercancel', up);
        dw.classList.remove('resizing');
        it.h = hgt && Math.abs(hgt - natural) > 12 ? hgt : it.h && !hgt ? it.h : null; // close to the content's own height = fit it
        await saveLayout(board.lay.map((x) => ({ ...x })).concat(layoutOf().filter((x) => !board.lay.some((y) => y.k === x.k))));
        paint();
      };
      rs.addEventListener('pointermove', move); rs.addEventListener('pointerup', up); rs.addEventListener('pointercancel', up);
    }
    function startMove(e, dw) {
      const touch = e.pointerType === 'touch';
      const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
      let drag = null, hold = 0;
      const begin = () => {
        const { board } = geom();
        const r = dw.getBoundingClientRect();
        const ghost = dw.cloneNode(true);
        ghost.classList.add('dw-ghost');
        Object.assign(ghost.style, { width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px', gridColumn: '', gridRow: '' });
        document.body.appendChild(ghost);
        dw.classList.add('dw-moving');
        document.body.style.userSelect = 'none';
        navigator.vibrate?.(10);
        drag = { board, ghost, dx: sx - r.left, dy: sy - r.top, it: board.lay.find((x) => x.k === dw.dataset.dw), key: '' };
      };
      const noScroll = (ev) => { if (drag) ev.preventDefault(); };
      const move = (ev) => {
        if (ev.pointerId !== pid) return;
        if (!drag) {
          const d = Math.hypot(ev.clientX - sx, ev.clientY - sy);
          if (touch) { if (d > 8) end(); return; }
          if (d < 6) return;
          begin();
        }
        ev.preventDefault();
        const gl = ev.clientX - drag.dx, gt = ev.clientY - drag.dy;
        drag.ghost.style.left = gl + 'px';
        drag.ghost.style.top = gt + 'px';
        if (ev.clientY < 70) window.scrollBy(0, -14); else if (ev.clientY > innerHeight - 70) window.scrollBy(0, 14);
        const sc = el.closest('.content');
        if (sc && sc.scrollHeight > sc.clientHeight) { if (ev.clientY < 90) sc.scrollTop -= 14; else if (ev.clientY > innerHeight - 90) sc.scrollTop += 14; }
        // target column from the ghost's left edge; target place in the order = the one that puts it nearest the ghost
        const { board, br, gap, colW } = geom();
        const it = drag.it;
        const x = isPhone() ? 0 : Math.max(0, Math.min(12 - it.w, Math.round((gl - br.left) / colW)));
        const others = board.lay.filter((y) => y !== it);
        const heights = new Map();
        board.querySelectorAll('.dw').forEach((d) => heights.set(d.dataset.dw, d.querySelector('.dw-in').getBoundingClientRect().height));
        const wantRow = (gt - br.top) / ROW;
        let best = 0, bestD = Infinity;
        for (let i = 0; i <= others.length; i++) {
          const trial = [...others.slice(0, i), { ...it, x }, ...others.slice(i)];
          const p = place(trial, heights, gap)[it.k];
          const d = p ? Math.abs(p.top - wantRow) : Infinity;
          if (d < bestD - 0.5) { best = i; bestD = d; }
        }
        const key = `${x}:${best}`;
        if (key === drag.key) return;
        drag.key = key;
        it.x = x;
        board.lay = [...others.slice(0, best), it, ...others.slice(best)];
        board.relayout();
      };
      const end = async (ev) => {
        if (ev && ev.pointerId !== pid) return;
        clearTimeout(hold);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        window.removeEventListener('touchmove', noScroll);
        if (!drag) return;
        drag.ghost.remove();
        dw.classList.remove('dw-moving');
        document.body.style.userSelect = '';
        const { board } = drag;
        drag = null;
        const stop = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
        dw.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => dw.removeEventListener('click', stop, { capture: true }), 50);
        await saveLayout(board.lay.map((x) => ({ ...x })).concat(layoutOf().filter((x) => !board.lay.some((y) => y.k === x.k))));
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      window.addEventListener('touchmove', noScroll, { passive: false });
      if (touch) hold = setTimeout(begin, 300);
    }
    const offs = [on('tasks:changed', load), on('calendar:changed', load), on('audio:changed', load), on('meetings:changed', load), on('notes:changed', load)];
    return () => { offs.forEach((f) => f()); boardObserver?.disconnect(); };
  },
};
export { navigate };
