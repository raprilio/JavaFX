// Dashboard: greeting, quick create, stats, today, recent notes, upcoming, task progress.
// Every section and stat card can be hidden per user (saved in user_settings.dashboard_hidden).
import { html, icon, h, fmtTime, fmtDay, timeAgo, greeting, parseDate, todayStr } from '../core/dom.js';
import { api } from '../core/api.js';
import { state, on } from '../core/store.js';
import { navigate } from '../core/router.js';
import { toast, toastError, empty, modal } from '../core/ui.js';
import { CREATE_ITEMS } from '../core/actions.js';

const TYPE_COLOR = { event: '#8b5cf6', meeting: '#0ea5e9', task: '#10b981' };
const TYPE_ICON = { event: 'calendar-days', meeting: 'users', task: 'square-check-big' };

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
  ['upcoming', 'Upcoming', 'calendar-clock'], ['notes_week', 'Notes this week', 'activity'],
];

const hiddenSet = () => new Set(state.settings?.dashboard_hidden || []);
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
  const first = (state.user.name || '').split(' ')[0];
  const maxSeries = Math.max(1, ...d.notes_series.map((s) => s.count));
  const todayItems = [...d.today];
  const stats = STATS.filter(([k]) => show(k));
  const left = [
    show('today') && html`<div class="card" data-widget="today"><div class="card-head"><h3>${icon('sun', 'sm')} Today</h3><div class="row" style="gap:2px"><a class="btn ghost sm" href="#/calendar?view=day">Open day ${icon('chevron-right', 'sm')}</a>${hideBtn('today')}</div></div>
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
    show('shared_notes') && d.shared_notes.length && html`<div class="card" data-widget="shared_notes"><div class="card-head"><h3>${icon('users', 'sm')} Shared with me</h3><div class="row" style="gap:2px"><a class="btn ghost sm" href="#/notes?filter=shared">View all ${icon('chevron-right', 'sm')}</a>${hideBtn('shared_notes')}</div></div>
      <div class="card-body"><div class="grid grid-3" style="gap:12px">${d.shared_notes.map((n) => noteCard(n, html`<span class="badge info">${icon('user', 'sm')} ${n.owner_name}</span><span>${n.permission === 'edit' ? 'can edit' : 'view'}</span>`))}</div></div></div>`,
    show('recent_notes') && html`<div class="card" data-widget="recent_notes"><div class="card-head"><h3>${icon('history', 'sm')} Recent notes</h3><div class="row" style="gap:2px"><a class="btn ghost sm" href="#/notes">View all ${icon('chevron-right', 'sm')}</a>${hideBtn('recent_notes')}</div></div>
      <div class="card-body">${d.recent_notes.length ? html`<div class="grid grid-3" style="gap:12px">${d.recent_notes.map((n) => noteCard(n, html`${icon('clock', 'sm')} ${timeAgo(n.last_opened_at || n.updated_at)}`))}</div>`
        : empty({ icon: 'notebook-pen', title: 'No notes yet', text: 'Create your first note to see it here.', action: '<button class="btn primary" data-qc="note">New note</button>' })}</div></div>`,
  ].filter(Boolean);
  const right = [
    show('task_progress') && html`<div class="card" data-widget="task_progress"><div class="card-head"><h3>${icon('chart-pie', 'sm')} Task progress</h3><div class="row" style="gap:2px"><a class="btn ghost sm" href="#/tasks?view=board">Board</a>${hideBtn('task_progress')}</div></div>
      <div class="card-body"><div class="row" style="gap:22px">
        <div class="ring" style="--v:${p.percent}"><span>${p.percent}%</span></div>
        <div class="col" style="gap:8px;flex:1">
          <div class="row between small"><span class="muted">Completed</span><b>${p.completed}</b></div>
          <div class="row between small"><span class="muted">In progress</span><b>${p.in_progress}</b></div>
          <div class="row between small"><span class="muted">Total</span><b>${p.total}</b></div>
          ${c.tasks_overdue ? html`<div class="badge danger">${icon('alert-triangle', 'sm')} ${c.tasks_overdue} overdue</div>` : ''}
        </div></div>
        <div class="progress mt-3"><span style="width:${p.percent}%"></span></div></div></div>`,
    show('upcoming') && html`<div class="card" data-widget="upcoming"><div class="card-head"><h3>${icon('calendar-clock', 'sm')} Upcoming</h3><div class="row" style="gap:2px"><a class="btn ghost sm" href="#/calendar">Calendar</a>${hideBtn('upcoming')}</div></div>
      <div class="card-body">${d.upcoming.length ? d.upcoming.map((it) => {
        const dt = parseDate(it.start);
        return html`<a class="row" href="${it.type === 'meeting' ? `#/meetings/${it.id}` : `#/calendar?event=${it.id}&date=${it.start.slice(0, 10)}`}" style="padding:8px 0;color:inherit;text-decoration:none;border-bottom:1px dashed var(--border)">
          <div class="date-block"><span>${dt.toLocaleDateString(undefined, { month: 'short' })}</span><b>${dt.getDate()}</b></div>
          <div class="grow" style="min-width:0"><div class="truncate" style="font-weight:580">${it.title}</div><div class="small subtle">${fmtDay(it.start)} · ${it.all_day ? 'All day' : fmtTime(it.start)} · ${it.type === 'meeting' ? 'Meeting' : it.event_type || 'Event'}${it.shared ? html` · ${icon('users', 'xs')} ${it.owner_name}` : ''}</div></div></a>`;
      }) : html`<p class="small subtle">Nothing scheduled in the next two weeks.</p>`}</div></div>`,
    show('notes_week') && html`<div class="card" data-widget="notes_week"><div class="card-head"><h3>${icon('activity', 'sm')} Notes this week</h3>${hideBtn('notes_week')}</div>
      <div class="card-body"><div class="spark">${d.notes_series.map((s, i) => html`<span class="${i === 6 ? 'today' : ''}" style="height:${Math.max(6, (s.count / maxSeries) * 100)}%" data-tip="${s.count} on ${s.date}"></span>`)}</div>
        <div class="row between tiny subtle mt-1"><span>${fmtDay(d.notes_series[0].date)}</span><span>Today</span></div></div></div>`,
  ].filter(Boolean);
  const nothing = !show('quick_create') && (!show('stats') || !stats.length) && !left.length && !right.length;

  el.innerHTML = String(html`
  <div class="hero"><div><h1>${greeting()}, ${first}</h1><p>${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${todayItems.length ? `${todayItems.length} item${todayItems.length > 1 ? 's' : ''} on your agenda today` : 'Your agenda is clear today'}</p></div>
    <div class="row"><button class="btn ghost" data-act="customize" data-tip="Show or hide dashboard widgets">${icon('settings-2', 'sm')}<span class="hide-sm">Customize</span>${hidden.size ? html`<span class="badge">${hidden.size} hidden</span>` : ''}</button>
      <a class="btn" href="#/calendar">${icon('calendar-days', 'sm')} Calendar</a><button class="btn primary" data-qc="note">${icon('plus', 'sm')} New note</button></div></div>

  ${show('quick_create') ? html`<div class="quick-create dash-section" data-widget="quick_create">${CREATE_ITEMS.map((q) => html`<button class="qc" style="--c:${q.color}" data-qc="${q.key}"><span class="qc-icon">${icon(q.icon)}</span><span>${q.key === 'note' ? 'New Note' : q.label}<small>${q.sub}</small></span></button>`)}${hideBtn('quick_create')}</div>` : ''}

  ${show('stats') && stats.length ? html`<div class="stats-grid" data-widget="stats">${stats.map((s) => statCard(s, c))}</div>` : ''}

  ${nothing ? html`<div class="card card-pad">${empty({ icon: 'eye-off', title: 'Everything is hidden', text: 'You hid every dashboard widget. Bring back the ones you need.', action: '<button class="btn primary" data-act="show-all">Show all widgets</button>' })}</div>` : ''}
  ${left.length || right.length ? html`<div class="dash-grid ${!left.length || !right.length ? 'single' : ''}">
    ${left.length ? html`<div class="col" style="gap:var(--gap)">${left}</div>` : ''}
    ${right.length ? html`<div class="col" style="gap:var(--gap)">${right}</div>` : ''}
  </div>` : ''}`);
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
      if (act === 'customize') return customize(paint);
      if (act === 'show-all') { try { await saveHidden([]); paint(); } catch (err) { toastError(err); } return; }
      const q = e.target.closest('[data-qc]');
      if (q) return CREATE_ITEMS.find((x) => x.key === q.dataset.qc)?.run();
      const done = e.target.closest('[data-done]');
      if (done) {
        done.classList.add('on');
        try { await api.post(`tasks/${done.dataset.done}/status`, { status: 'completed' }); setTimeout(load, 400); } catch (err) { toastError(err); }
      }
    });
    const offs = [on('tasks:changed', load), on('calendar:changed', load), on('audio:changed', load), on('meetings:changed', load), on('notes:changed', load)];
    return () => offs.forEach((f) => f());
  },
};
export { navigate };
