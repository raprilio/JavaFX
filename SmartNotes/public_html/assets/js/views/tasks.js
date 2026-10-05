// Tasks: quick add, list (grouped), board (drag & drop between statuses) and calendar view.
import { html, icon, fmtDay, todayStr, debounce, parseDate, loadScript, ymd } from '../core/dom.js';
import { api } from '../core/api.js';
import { state, on } from '../core/store.js';
import { setQuery } from '../core/router.js';
import { toast, toastError, menu, empty, skeletonRows, contextMenu, confirm } from '../core/ui.js';
import { openTaskForm, STATUSES, PRIORITIES } from '../components/forms.js';
import { sortable } from '../components/sortable.js';
import { effectiveTheme } from '../core/theme.js';

const STATUS_COLOR = { todo: '#8b92a1', in_progress: '#0ea5e9', completed: '#10b981', cancelled: '#e5484d' };
const PRIO_ICON = { low: 'flag', medium: 'flag', high: 'flag', urgent: 'flame' };

function dueLabel(t) {
  if (!t.due_date) return '';
  const overdue = t.due_date < todayStr() && !['completed', 'cancelled'].includes(t.status);
  return html`<span class="${overdue ? 'overdue' : ''}">${icon('calendar', 'sm')} ${fmtDay(t.due_date)}${t.due_time ? ' ' + t.due_time : ''}</span>`;
}

function metaHtml(t) {
  return html`${dueLabel(t)}
    <span class="badge prio prio-${t.priority}">${icon(PRIO_ICON[t.priority], 'sm')} ${t.priority}</span>
    ${t.category_name ? html`<span class="badge"><span style="width:7px;height:7px;border-radius:50%;background:${t.category_color}"></span>${t.category_name}</span>` : ''}
    ${t.tags.slice(0, 3).map((g) => html`<span class="tag">#${g}</span>`)}
    ${t.reminder_minutes !== null && t.due_date ? html`<span data-tip="Reminder">${icon('bell', 'sm')}</span>` : ''}
    ${t.note_id ? html`<a href="#/notes/${t.note_id}" class="small" data-no-drag>${icon('notebook-pen', 'sm')} ${t.note_title || 'Note'}</a>` : ''}
    ${t.meeting_id ? html`<a href="#/meetings/${t.meeting_id}" class="small" data-no-drag>${icon('users', 'sm')} ${t.meeting_title || 'Meeting'}</a>` : ''}
    ${t.attachment_count ? html`<span>${icon('paperclip', 'sm')}${t.attachment_count}</span>` : ''}`;
}

function rowHtml(t) {
  const done = t.status === 'completed';
  return html`<div class="task-row ${done ? 'done' : ''}" data-id="${t.id}">
    <button class="t-check prio-${t.priority} ${done ? 'on' : ''}" data-toggle aria-label="Toggle complete">${icon('check')}</button>
    <div class="t-main"><div class="t-title">${t.title}</div><div class="t-meta">${metaHtml(t)}</div></div>
    ${t.status === 'in_progress' ? html`<span class="badge info hide-sm">In progress</span>` : ''}
    <button class="btn ghost icon sm" data-more aria-label="More">${icon('more-vertical', 'sm')}</button></div>`;
}

function cardHtml(t) {
  return html`<div class="board-card ${t.status === 'completed' ? 'done' : ''}" data-id="${t.id}">
    <div class="bc-title">${t.title}</div><div class="t-meta" style="display:flex;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--text-3)">${metaHtml(t)}</div></div>`;
}

export default {
  title: 'Tasks',
  async render(el, ctx) {
    const q0 = ctx.query;
    const f = { view: q0.view || 'list', status: q0.status || '', priority: q0.priority || '', category: q0.category || '', due: q0.due || '', q: q0.q || '' };
    let items = [], stats = {};
    let cal = null;
    let offSort = null;

    el.innerHTML = String(html`
      <div class="page-head"><div><h1>Tasks</h1><p data-sub>&nbsp;</p></div>
        <div class="row"><div class="btn-group" data-views>
          ${[['list', 'list', 'List'], ['board', 'columns-3', 'Board'], ['calendar', 'calendar-days', 'Calendar']].map(([v, i, l]) => html`<button class="btn ${f.view === v ? 'active' : ''}" data-view="${v}">${icon(i, 'sm')}<span class="hide-sm">${l}</span></button>`)}
        </div><button class="btn primary" data-act="new">${icon('plus', 'sm')} New task</button></div></div>
      <div class="card card-pad mb-3" style="padding:14px 18px"><div class="row between small"><span class="muted">Progress</span><b data-pct>0%</b></div><div class="progress mt-1"><span data-bar style="width:0"></span></div>
        <div class="row wrap mt-2 small muted" data-stats></div></div>
      <form class="task-quick" data-quick>${icon('plus', 'sm')}<input placeholder="Add a task… e.g. “Prepare report”  (press Enter)" data-quick-input aria-label="Quick add task">
        <input type="date" class="input sm" style="width:150px" data-quick-date aria-label="Due date"><button class="btn sm primary" type="submit">Add</button></form>
      <div class="toolbar">
        <div class="input-icon" style="width:min(240px,100%)">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search tasks…" value="${f.q}" data-search></div>
        <button class="btn sm" data-filter="status">${icon('circle-dot', 'sm')} <span>Status</span></button>
        <button class="btn sm" data-filter="priority">${icon('flag', 'sm')} <span>Priority</span></button>
        <button class="btn sm" data-filter="category">${icon('folder', 'sm')} <span>Category</span></button>
        <button class="btn sm" data-filter="due">${icon('calendar', 'sm')} <span>Due</span></button>
        <button class="btn ghost sm hidden" data-act="clear">${icon('x', 'sm')} Clear</button>
      </div>
      <div data-body>${skeletonRows(6)}</div>`);
    const body = el.querySelector('[data-body]');

    const labels = {
      status: (v) => STATUSES.find(([k]) => k === v)?.[1] || (v === 'open' ? 'Open' : 'Status'),
      priority: (v) => PRIORITIES.find(([k]) => k === v)?.[1] || 'Priority',
      category: (v) => state.categories.task.find((c) => String(c.id) === String(v))?.name || 'Category',
      due: (v) => ({ today: 'Due today', overdue: 'Overdue', week: 'Next 7 days', none: 'No date' })[v] || 'Due',
    };
    function syncFilters() {
      ['status', 'priority', 'category', 'due'].forEach((k) => {
        const b = el.querySelector(`[data-filter="${k}"]`);
        b.querySelector('span').textContent = labels[k](f[k]);
        b.classList.toggle('active', !!f[k]);
      });
      el.querySelector('[data-act="clear"]').classList.toggle('hidden', !(f.status || f.priority || f.category || f.due || f.q));
      setQuery({ view: f.view !== 'list' ? f.view : '', status: f.status, priority: f.priority, category: f.category, due: f.due, q: f.q });
    }

    async function load() {
      try {
        const r = await api.get('tasks', { status: f.view === 'board' ? '' : f.status, priority: f.priority, category: f.category, due: f.due, q: f.q, sort: f.view === 'board' ? '' : 'due' });
        items = r.items;
        stats = r.stats;
        paintStats();
        paint();
      } catch (e) { toastError(e); }
    }
    function paintStats() {
      const active = stats.total - stats.cancelled;
      const pct = active ? Math.round((stats.completed / active) * 100) : 0;
      el.querySelector('[data-pct]').textContent = pct + '%';
      el.querySelector('[data-bar]').style.width = pct + '%';
      el.querySelector('[data-sub]').textContent = `${stats.todo + stats.in_progress} open · ${stats.completed} completed${stats.overdue ? ` · ${stats.overdue} overdue` : ''}`;
      el.querySelector('[data-stats]').innerHTML = String(html`${STATUSES.map(([k, l]) => html`<span class="row" style="gap:6px;margin-right:14px"><span style="width:8px;height:8px;border-radius:50%;background:${STATUS_COLOR[k]}"></span>${l} <b style="color:var(--text)">${stats[k] || 0}</b></span>`)}`);
    }

    function paint() {
      offSort?.();
      offSort = null;
      if (cal) { cal.destroy(); cal = null; }
      if (f.view === 'board') return paintBoard();
      if (f.view === 'calendar') return paintCalendar();
      if (!items.length) {
        body.innerHTML = String(empty({ icon: 'square-check-big', title: f.q || f.status || f.priority || f.category || f.due ? 'No tasks match your filters' : 'No tasks yet', text: 'Add a task above or create one with details like due date, priority and reminder.', action: '<button class="btn primary" data-act="new">New task</button>' }));
        return;
      }
      const today = todayStr();
      const open = items.filter((t) => !['completed', 'cancelled'].includes(t.status));
      const groups = [
        ['overdue', 'Overdue', 'alert-triangle', open.filter((t) => t.due_date && t.due_date < today)],
        ['today', 'Today', 'sun', open.filter((t) => t.due_date === today)],
        ['upcoming', 'Upcoming', 'calendar-clock', open.filter((t) => t.due_date && t.due_date > today)],
        ['nodate', 'No due date', 'inbox', open.filter((t) => !t.due_date)],
        ['completed', 'Completed', 'circle-check', items.filter((t) => t.status === 'completed')],
        ['cancelled', 'Cancelled', 'circle-x', items.filter((t) => t.status === 'cancelled')],
      ].filter((g) => g[3].length);
      body.innerHTML = groups.map(([k, l, i, list]) => String(html`<section class="task-group" data-group="${k}">
        <div class="task-group-head" data-collapse>${icon(i, 'sm')} ${l} <span class="count">${list.length}</span></div>
        <div class="task-list" ${k === 'completed' && list.length > 8 ? 'data-collapsed' : ''}>${(k === 'completed' && list.length > 8 ? list.slice(0, 8) : list).map(rowHtml)}
        ${k === 'completed' && list.length > 8 ? html`<button class="btn ghost sm" data-showall>Show all ${list.length}</button>` : ''}</div></section>`)).join('');
    }

    function paintBoard() {
      const cols = STATUSES.map(([k, l]) => [k, l, items.filter((t) => t.status === k)]);
      body.innerHTML = String(html`<div class="board" data-scroll>${cols.map(([k, l, list]) => html`<div class="board-col" style="--c:${STATUS_COLOR[k]}">
        <div class="board-col-head"><span class="dot"></span>${l}<span class="subtle" style="font-weight:500">${list.length}</span>
          <button class="btn ghost icon xs" style="margin-left:auto" data-add-status="${k}" data-tip="Add">${icon('plus', 'sm')}</button></div>
        <div class="board-list" data-status="${k}">${list.map(cardHtml)}</div></div>`)}</div>`);
      offSort = sortable(body, {
        item: '.board-card', list: '.board-list',
        onDrop: async (card, toList) => {
          const status = toList.dataset.status;
          const ids = Array.from(toList.querySelectorAll('.board-card')).map((c) => +c.dataset.id);
          const t = items.find((x) => x.id === +card.dataset.id);
          const changed = t.status !== status;
          t.status = status;
          card.classList.toggle('done', status === 'completed');
          try {
            await api.post('tasks/reorder', { status, ids });
            ids.forEach((id, i) => { const it = items.find((x) => x.id === id); if (it) it.sort_order = i; });
            if (changed) {
              toast(`Moved to ${STATUSES.find(([k]) => k === status)[1]}`, 'success', { timeout: 1500 });
              const r = await api.get('tasks', { status: 'none-for-stats' }).catch(() => null);
              if (r) { stats = r.stats; paintStats(); }
              body.querySelectorAll('.board-col').forEach((col) => (col.querySelector('.board-col-head .subtle').textContent = col.querySelectorAll('.board-card').length));
            }
          } catch (e) { toastError(e); load(); }
        },
      });
    }

    async function paintCalendar() {
      body.innerHTML = '<div class="cal-wrap"><div class="row between mb-2"><b data-cal-title></b><div class="row" style="gap:4px"><button class="btn sm icon" data-cal="prev">' + icon('chevron-left', 'sm') + '</button><button class="btn sm" data-cal="today">Today</button><button class="btn sm icon" data-cal="next">' + icon('chevron-right', 'sm') + '</button></div></div><div data-cal-el></div></div>';
      await loadScript('assets/vendor/fullcalendar.min.js');
      const FC = window.FullCalendar;
      cal = new FC.Calendar(body.querySelector('[data-cal-el]'), {
        initialView: 'dayGridMonth', height: 'auto', firstDay: 1, editable: true, dayMaxEvents: 4, headerToolbar: false,
        events: items.filter((t) => t.due_date).map((t) => ({
          id: String(t.id), title: t.title, start: t.due_time ? `${t.due_date}T${t.due_time}` : t.due_date, allDay: !t.due_time,
          backgroundColor: STATUS_COLOR[t.status], textColor: '#fff', classNames: ['ev-task', t.status === 'completed' ? 'done' : ''],
        })),
        eventClick: (info) => { const t = items.find((x) => x.id === +info.event.id); openTaskForm(t); },
        eventDrop: async (info) => {
          const d = info.event.start;
          try { await api.post(`tasks/${info.event.id}/move`, { start: `${ymd(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`, all_day: info.event.allDay }); toast('Due date updated', 'success', { timeout: 1500 }); }
          catch (e) { toastError(e); info.revert(); }
        },
        dateClick: (info) => openTaskForm(null, { due_date: info.dateStr }),
        datesSet: (info) => (body.querySelector('[data-cal-title]').textContent = info.view.title),
      });
      cal.render();
      body.querySelector('.cal-wrap').addEventListener('click', (e) => {
        const b = e.target.closest('[data-cal]');
        if (b) cal[b.dataset.cal]();
      });
      void effectiveTheme;
    }

    async function setStatus(t, status) {
      try {
        const r = await api.post(`tasks/${t.id}/status`, { status });
        Object.assign(t, r);
        if (status === 'completed') toast('Task completed', 'success', { action: 'Undo', onAction: () => setStatus(t, 'todo') });
        load();
      } catch (e) { toastError(e); }
    }
    function moreMenu(anchor, t) {
      const items2 = [
        { label: 'Edit', icon: 'pencil', onClick: () => openTaskForm(t) },
        { title: 'Status' },
        ...STATUSES.map(([k, l]) => ({ label: l, checked: t.status === k, onClick: () => setStatus(t, k) })),
        { divider: true },
        { label: 'Delete', icon: 'trash-2', danger: true, onClick: async () => {
          if (!(await confirm({ title: 'Delete task?', message: `"${t.title}" will be moved to the trash.`, confirmText: 'Delete' }))) return;
          await api.post(`items/task/${t.id}/trash`).catch(toastError);
          toast('Task moved to trash', 'success', { action: 'Undo', onAction: () => api.post(`items/task/${t.id}/restore`).then(load) });
          load();
        } },
      ];
      return anchor instanceof Event ? contextMenu(anchor, items2) : menu(anchor, items2, { align: 'end' });
    }

    el.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'new') return openTaskForm(null, f.category ? { category_id: +f.category } : {});
      if (act === 'clear') { Object.assign(f, { status: '', priority: '', category: '', due: '', q: '' }); el.querySelector('[data-search]').value = ''; syncFilters(); return load(); }
      const v = e.target.closest('[data-view]');
      if (v) { f.view = v.dataset.view; el.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === v)); syncFilters(); return load(); }
      const flt = e.target.closest('[data-filter]');
      if (flt) {
        const k = flt.dataset.filter;
        const opts = {
          status: [['', 'All statuses'], ['open', 'Open (to do + in progress)'], ...STATUSES],
          priority: [['', 'All priorities'], ...PRIORITIES],
          category: [['', 'All categories'], ...state.categories.task.map((c) => [String(c.id), c.name])],
          due: [['', 'Any time'], ['today', 'Due today'], ['overdue', 'Overdue'], ['week', 'Next 7 days'], ['none', 'No due date']],
        }[k];
        return menu(flt, opts.map(([val, l]) => ({ label: l, checked: String(f[k]) === val, onClick: () => { f[k] = val; syncFilters(); load(); } })));
      }
      const add = e.target.closest('[data-add-status]');
      if (add) return openTaskForm(null, { status: add.dataset.addStatus });
      if (e.target.closest('[data-collapse]')) { e.target.closest('.task-group').querySelector('.task-list').classList.toggle('hidden'); return; }
      if (e.target.closest('[data-showall]')) {
        const list = items.filter((t) => t.status === 'completed');
        e.target.closest('.task-list').innerHTML = list.map((t) => String(rowHtml(t))).join('');
        return;
      }
      const row = e.target.closest('.task-row, .board-card');
      if (!row || e.target.closest('a')) return;
      const t = items.find((x) => x.id === +row.dataset.id);
      if (!t) return;
      const tog = e.target.closest('[data-toggle]');
      if (tog) { tog.classList.toggle('on'); return setStatus(t, t.status === 'completed' ? 'todo' : 'completed'); }
      if (e.target.closest('[data-more]')) return moreMenu(e.target.closest('[data-more]'), t);
      openTaskForm(t);
    });
    el.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.task-row, .board-card');
      if (!row) return;
      const t = items.find((x) => x.id === +row.dataset.id);
      if (t) moreMenu(e, t);
    });
    el.querySelector('[data-quick]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const inp = el.querySelector('[data-quick-input]');
      const title = inp.value.trim();
      if (!title) return inp.focus();
      const due = el.querySelector('[data-quick-date]').value;
      try {
        await api.post('tasks', { title, due_date: due || null, category_id: f.category || null, reminder_minutes: due ? state.settings?.default_reminder ?? null : null });
        inp.value = '';
        toast('Task added', 'success', { timeout: 1500 });
        load();
      } catch (err) { toastError(err); }
    });
    const search = debounce(() => { syncFilters(); load(); }, 300);
    el.querySelector('[data-search]').addEventListener('input', (e) => { f.q = e.target.value.trim(); search(); });

    syncFilters();
    await load();
    if (q0.open) {
      const t = items.find((x) => x.id === +q0.open) || { id: +q0.open };
      openTaskForm(t);
    }
    const off = on('tasks:changed', load);
    return () => { off(); offSort?.(); cal?.destroy(); };
  },
};
export { parseDate };
