// Dashboard: greeting, quick create, stats, today, recent notes, upcoming, task progress.
import { html, icon, fmtTime, fmtDay, timeAgo, greeting, parseDate, todayStr } from '../core/dom.js';
import { api } from '../core/api.js';
import { state, on } from '../core/store.js';
import { navigate } from '../core/router.js';
import { toastError, empty } from '../core/ui.js';
import { CREATE_ITEMS } from '../core/actions.js';

const TYPE_COLOR = { event: '#8b5cf6', meeting: '#0ea5e9', task: '#10b981' };
const TYPE_ICON = { event: 'calendar-days', meeting: 'users', task: 'square-check-big' };

function statCard(label, value, ic, color, foot = '', link = '') {
  return html`<a class="card stat hoverable" style="--c:${color};color:inherit;text-decoration:none" href="${link || '#/'}">
    <div class="row between"><span class="stat-icon">${icon(ic)}</span>${foot ? html`<span class="stat-foot">${foot}</span>` : ''}</div>
    <div class="stat-value" data-count="${value}">0</div><div class="stat-label">${label}</div></a>`;
}

function agendaRow(it) {
  const d = parseDate(it.start);
  const time = it.all_day ? 'All day' : fmtTime(it.start);
  const link = it.type === 'meeting' ? `#/meetings/${it.id}` : it.type === 'task' ? `#/tasks?open=${it.id}` : `#/calendar?event=${it.id}&date=${it.start.slice(0, 10)}`;
  return html`<a class="agenda-item" href="${link}" style="color:inherit;text-decoration:none">
    <div class="agenda-time">${time}</div><span class="agenda-bar" style="--c:${it.color || TYPE_COLOR[it.type]}"></span>
    <div class="grow" style="min-width:0"><div class="truncate" style="font-weight:580;${it.status === 'completed' ? 'text-decoration:line-through;color:var(--text-3)' : ''}">${it.title}</div>
      <div class="small subtle row" style="gap:6px">${icon(TYPE_ICON[it.type], 'sm')} ${it.type === 'task' ? 'Task' : it.type === 'meeting' ? 'Meeting' : (it.event_type || 'Event')}${it.location ? html` · ${it.location}` : ''}${d && it.type !== 'task' && !it.all_day ? html` · until ${fmtTime(it.end)}` : ''}</div></div></a>`;
}

function render(el, d) {
  const c = d.counts;
  const p = d.progress;
  const first = (state.user.name || '').split(' ')[0];
  const maxSeries = Math.max(1, ...d.notes_series.map((s) => s.count));
  const todayItems = [...d.today];
  el.innerHTML = String(html`
  <div class="hero"><div><h1>${greeting()}, ${first}</h1><p>${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${todayItems.length ? `${todayItems.length} item${todayItems.length > 1 ? 's' : ''} on your agenda today` : 'Your agenda is clear today'}</p></div>
    <div class="row"><a class="btn" href="#/calendar">${icon('calendar-days', 'sm')} Calendar</a><button class="btn primary" data-qc="note">${icon('plus', 'sm')} New note</button></div></div>

  <div class="quick-create">${CREATE_ITEMS.map((q) => html`<button class="qc" style="--c:${q.color}" data-qc="${q.key}"><span class="qc-icon">${icon(q.icon)}</span><span>${q.key === 'note' ? 'New Note' : q.label}<small>${q.sub}</small></span></button>`)}</div>

  <div class="stats-grid">
    ${statCard('Total notes', c.notes, 'notebook-pen', '#6366f1', c.notes_today ? `+${c.notes_today} today` : '', '#/notes')}
    ${statCard('Notes today', c.notes_today, 'sparkles', '#ec4899', '', '#/notes?sort=created')}
    ${statCard('Active tasks', c.tasks_active, 'circle-dot', '#f59e0b', c.tasks_overdue ? `${c.tasks_overdue} overdue` : '', '#/tasks')}
    ${statCard('Completed tasks', c.tasks_completed, 'circle-check', '#10b981', '', '#/tasks?status=completed')}
    ${statCard('Upcoming meetings', c.meetings_upcoming, 'users', '#0ea5e9', '', '#/meetings')}
    ${statCard('Upcoming schedule', c.events_upcoming, 'calendar-clock', '#8b5cf6', '30 days', '#/calendar')}
    ${statCard('Audio notes', c.audio, 'mic', '#db2777', '', '#/audio')}
    ${statCard('Mind maps', c.mindmaps, 'network', '#eab308', '', '#/mindmaps')}
    ${statCard('Flowcharts', c.flowcharts, 'workflow', '#14b8a6', '', '#/flowcharts')}
    ${statCard('Drive files', c.drive_files, 'hard-drive', '#0891b2', '', '#/drive')}
    ${statCard('Shared with me', c.shared_with_me, 'users', '#7c3aed', '', '#/notes?filter=shared')}
  </div>

  <div class="dash-grid">
    <div class="col" style="gap:var(--gap)">
      <div class="card"><div class="card-head"><h3>${icon('sun', 'sm')} Today</h3><a class="btn ghost sm" href="#/calendar?view=day">Open day ${icon('chevron-right', 'sm')}</a></div>
        <div class="card-body">
          <div class="grid grid-2" style="gap:24px">
            <div><div class="label mb-1">Agenda & meetings</div>
              ${todayItems.filter((i) => i.type !== 'task').length ? todayItems.filter((i) => i.type !== 'task').map(agendaRow) : html`<p class="small subtle" style="padding:10px 0">No meetings or events today.</p>`}</div>
            <div><div class="label mb-1">Tasks due</div>
              ${d.today_tasks.length ? d.today_tasks.map((t) => html`<div class="row" style="padding:7px 0;border-bottom:1px dashed var(--border)">
                <button class="t-check prio-${t.priority}" data-done="${t.id}" aria-label="Complete">${icon('check')}</button>
                <a class="grow truncate" href="#/tasks?open=${t.id}" style="color:inherit">${t.title}</a>
                <span class="tiny ${t.due_date < todayStr() ? 'overdue' : 'subtle'}">${t.due_date < todayStr() ? fmtDay(t.due_date) : t.due_time || 'Today'}</span></div>`)
                : html`<p class="small subtle" style="padding:10px 0">Nothing due. Nice work!</p>`}</div>
          </div>
        </div></div>
      ${d.shared_notes.length ? html`<div class="card"><div class="card-head"><h3>${icon('users', 'sm')} Shared with me</h3><a class="btn ghost sm" href="#/notes?filter=shared">View all ${icon('chevron-right', 'sm')}</a></div>
        <div class="card-body"><div class="grid grid-3" style="gap:12px">${d.shared_notes.map((n) => html`
          <a class="note-card" data-nc="${n.color || ''}" href="#/notes/${n.id}" style="margin:0">
            ${n.is_pinned ? html`<span class="nc-pin">${icon('pin', 'sm')}</span>` : ''}
            <h3>${n.title || 'Untitled'}</h3><div class="nc-body" style="-webkit-line-clamp:3">${n.excerpt || ''}</div>
            <div class="nc-meta"><span class="badge info">${icon('user', 'sm')} ${n.owner_name}</span><span>${n.permission === 'edit' ? 'can edit' : 'view'}</span></div></a>`)}</div></div></div>` : ''}
      <div class="card"><div class="card-head"><h3>${icon('history', 'sm')} Recent notes</h3><a class="btn ghost sm" href="#/notes">View all ${icon('chevron-right', 'sm')}</a></div>
        <div class="card-body">${d.recent_notes.length ? html`<div class="grid grid-3" style="gap:12px">${d.recent_notes.map((n) => html`
          <a class="note-card" data-nc="${n.color || ''}" href="#/notes/${n.id}" style="margin:0">
            ${n.is_pinned ? html`<span class="nc-pin">${icon('pin', 'sm')}</span>` : ''}
            <h3>${n.title || 'Untitled'}</h3><div class="nc-body" style="-webkit-line-clamp:3">${n.excerpt || ''}</div>
            <div class="nc-meta">${icon('clock', 'sm')} ${timeAgo(n.last_opened_at || n.updated_at)}</div></a>`)}</div>`
          : empty({ icon: 'notebook-pen', title: 'No notes yet', text: 'Create your first note to see it here.', action: '<button class="btn primary" data-qc="note">New note</button>' })}</div></div>
    </div>
    <div class="col" style="gap:var(--gap)">
      <div class="card"><div class="card-head"><h3>${icon('chart-pie', 'sm')} Task progress</h3><a class="btn ghost sm" href="#/tasks?view=board">Board</a></div>
        <div class="card-body"><div class="row" style="gap:22px">
          <div class="ring" style="--v:${p.percent}"><span>${p.percent}%</span></div>
          <div class="col" style="gap:8px;flex:1">
            <div class="row between small"><span class="muted">Completed</span><b>${p.completed}</b></div>
            <div class="row between small"><span class="muted">In progress</span><b>${p.in_progress}</b></div>
            <div class="row between small"><span class="muted">Total</span><b>${p.total}</b></div>
            ${c.tasks_overdue ? html`<div class="badge danger">${icon('alert-triangle', 'sm')} ${c.tasks_overdue} overdue</div>` : ''}
          </div></div>
          <div class="progress mt-3"><span style="width:${p.percent}%"></span></div></div></div>
      <div class="card"><div class="card-head"><h3>${icon('calendar-clock', 'sm')} Upcoming</h3><a class="btn ghost sm" href="#/calendar">Calendar</a></div>
        <div class="card-body">${d.upcoming.length ? d.upcoming.map((it) => {
          const dt = parseDate(it.start);
          return html`<a class="row" href="${it.type === 'meeting' ? `#/meetings/${it.id}` : `#/calendar?event=${it.id}&date=${it.start.slice(0, 10)}`}" style="padding:8px 0;color:inherit;text-decoration:none;border-bottom:1px dashed var(--border)">
            <div class="date-block"><span>${dt.toLocaleDateString(undefined, { month: 'short' })}</span><b>${dt.getDate()}</b></div>
            <div class="grow" style="min-width:0"><div class="truncate" style="font-weight:580">${it.title}</div><div class="small subtle">${fmtDay(it.start)} · ${it.all_day ? 'All day' : fmtTime(it.start)} · ${it.type === 'meeting' ? 'Meeting' : it.event_type || 'Event'}</div></div></a>`;
        }) : html`<p class="small subtle">Nothing scheduled in the next two weeks.</p>`}</div></div>
      <div class="card"><div class="card-head"><h3>${icon('activity', 'sm')} Notes this week</h3></div>
        <div class="card-body"><div class="spark">${d.notes_series.map((s, i) => html`<span class="${i === 6 ? 'today' : ''}" style="height:${Math.max(6, (s.count / maxSeries) * 100)}%" data-tip="${s.count} on ${s.date}"></span>`)}</div>
          <div class="row between tiny subtle mt-1"><span>${fmtDay(d.notes_series[0].date)}</span><span>Today</span></div></div></div>
    </div>
  </div>`);
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

export default {
  title: 'Dashboard',
  async render(el) {
    el.innerHTML = String(html`<div class="hero"><div><div class="skeleton" style="width:260px;height:30px"></div><div class="skeleton sk-line" style="width:340px"></div></div></div>
      <div class="quick-create">${Array.from({ length: 6 }, () => html`<div class="skeleton" style="height:96px;border-radius:16px"></div>`)}</div>
      <div class="stats-grid">${Array.from({ length: 6 }, () => html`<div class="skeleton" style="height:118px;border-radius:18px"></div>`)}</div>`);
    const load = async () => {
      try { render(el, await api.get('dashboard')); } catch (e) { toastError(e); }
    };
    await load();
    el.addEventListener('click', async (e) => {
      const q = e.target.closest('[data-qc]');
      if (q) return CREATE_ITEMS.find((x) => x.key === q.dataset.qc)?.run();
      const done = e.target.closest('[data-done]');
      if (done) {
        done.classList.add('on');
        try { await api.post(`tasks/${done.dataset.done}/status`, { status: 'completed' }); setTimeout(load, 400); } catch (err) { toastError(err); }
      }
    });
    const offs = [on('tasks:changed', load), on('calendar:changed', load), on('audio:changed', load), on('meetings:changed', load)];
    return () => offs.forEach((f) => f());
  },
};
export { navigate };
