// Calendar: month / week / day / agenda with drag, resize and click-to-create.
import { html, icon, loadScript, ymd, hm, fmtTime, fmtDateTime, parseDate, esc } from '../core/dom.js';
import { api } from '../core/api.js';
import { on } from '../core/store.js';
import { navigate, setQuery } from '../core/router.js';
import { toast, toastError, menu, modal } from '../core/ui.js';
import { openEventForm, openMeetingForm, openTaskForm } from '../components/forms.js';

const COLORS = { event: '#8b5cf6', schedule: '#6366f1', reminder: '#f59e0b', meeting: '#0ea5e9', task: '#10b981' };
const VIEWS = [['dayGridMonth', 'Month'], ['timeGridWeek', 'Week'], ['timeGridDay', 'Day'], ['listMonth', 'Agenda']];
const VIEW_ALIAS = { month: 'dayGridMonth', week: 'timeGridWeek', day: 'timeGridDay', agenda: 'listMonth' };
const fmtSql = (d) => `${ymd(d)} ${hm(d)}:00`;

export default {
  title: 'Calendar',
  async render(el, ctx) {
    const q0 = ctx.query;
    const shown = { event: true, meeting: true, task: true };
    const initialView = VIEW_ALIAS[q0.view] || q0.view || (matchMedia('(max-width: 767px)').matches ? 'listMonth' : 'dayGridMonth');
    el.innerHTML = String(html`
      <div class="page-head"><div><h1 data-title>Calendar</h1><p>Events, schedules, meetings and task due dates in one place.</p></div>
        <div class="row"><button class="btn" data-act="meeting">${icon('users', 'sm')} Meeting</button><button class="btn primary" data-act="new">${icon('plus', 'sm')} New event</button></div></div>
      <div class="toolbar">
        <div class="row" style="gap:4px"><button class="btn icon sm" data-nav="prev" aria-label="Previous">${icon('chevron-left', 'sm')}</button><button class="btn sm" data-nav="today">Today</button><button class="btn icon sm" data-nav="next" aria-label="Next">${icon('chevron-right', 'sm')}</button></div>
        <b data-range style="font-size:16px;margin-left:6px"></b>
        <div class="grow"></div>
        <div class="cal-legend">${[['event', 'Events'], ['meeting', 'Meetings'], ['task', 'Tasks']].map(([k, l]) => html`<button class="chip active" data-type="${k}" style="--c:${COLORS[k]}"><span class="dot"></span>${l}</button>`)}</div>
        <div class="btn-group" data-views>${VIEWS.map(([v, l]) => html`<button class="btn ${v === initialView ? 'active' : ''}" data-view="${v}">${l}</button>`)}</div>
      </div>
      <div class="cal-wrap"><div data-cal><div style="padding:80px;text-align:center"><span class="spinner"></span></div></div></div>`);

    await loadScript('assets/vendor/fullcalendar.min.js');
    const FC = window.FullCalendar;
    const calEl = el.querySelector('[data-cal]');
    calEl.innerHTML = '';

    const cal = new FC.Calendar(calEl, {
      initialView,
      initialDate: q0.date || undefined,
      headerToolbar: false,
      height: 'auto',
      contentHeight: 'auto',
      expandRows: true,
      firstDay: 1,
      nowIndicator: true,
      navLinks: true,
      selectable: true,
      selectMirror: true,
      editable: true,
      eventResizableFromStart: true,
      dayMaxEvents: 4,
      slotMinTime: '06:00:00',
      slotMaxTime: '23:00:00',
      scrollTime: '08:00:00',
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      events: async (info, success, failure) => {
        try {
          const types = Object.keys(shown).filter((k) => shown[k]).join(',');
          if (!types) return success([]);
          const list = await api.get('calendar', { start: fmtSql(info.start), end: fmtSql(info.end), types });
          success(list.map((it) => {
            const color = it.color || (it.type === 'event' ? COLORS[it.event_type] || COLORS.event : COLORS[it.type]);
            const done = it.status === 'completed';
            return {
              id: it.uid,
              title: (it.type === 'task' ? '☐ ' : '') + it.title,
              start: it.start.replace(' ', 'T'),
              end: it.type === 'task' ? undefined : it.end.replace(' ', 'T'),
              allDay: it.all_day,
              backgroundColor: color,
              borderColor: color,
              textColor: '#fff',
              classNames: [`ev-${it.type}`, done ? 'done' : '', it.status === 'cancelled' ? 'done' : ''],
              durationEditable: it.type !== 'task',
              extendedProps: it,
            };
          }));
        } catch (e) { failure(e); toastError(e); }
      },
      datesSet: (info) => {
        el.querySelector('[data-range]').textContent = info.view.title;
        el.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === info.view.type));
        setQuery({ view: info.view.type, date: ymd(cal ? cal.getDate() : info.start) });
      },
      dateClick: (info) => {
        if (info.view.type === 'dayGridMonth') {
          const start = new Date(info.date);
          start.setHours(9, 0, 0, 0);
          createMenu(info.jsEvent, start, new Date(start.getTime() + 3600000), false);
        }
      },
      select: (info) => {
        if (info.view.type === 'dayGridMonth' && (info.end - info.start) <= 86400000) return; // handled by dateClick
        createMenu(info.jsEvent, info.start, info.end, info.allDay);
        cal.unselect();
      },
      eventClick: (info) => {
        info.jsEvent.preventDefault();
        showDetails(info.event.extendedProps, info.el);
      },
      eventDrop: (info) => move(info),
      eventResize: (info) => move(info),
    });
    cal.render();

    function createMenu(jsEvent, start, end, allDay) {
      const point = jsEvent ? { x: jsEvent.clientX, y: jsEvent.clientY } : el.querySelector('[data-act="new"]');
      const startStr = fmtSql(start);
      const endStr = fmtSql(allDay ? new Date(end.getTime() - 60000) : end);
      menu(point, [
        { title: `${start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}${allDay ? '' : ' · ' + hm(start)}` },
        { label: 'New event', icon: 'calendar-plus', onClick: () => openEventForm(null, { start: startStr, end: endStr, all_day: allDay }) },
        { label: 'New schedule', icon: 'calendar-clock', onClick: () => openEventForm(null, { start: startStr, end: endStr, all_day: allDay, event_type: 'schedule' }) },
        { label: 'New reminder', icon: 'alarm-clock', onClick: () => openEventForm(null, { start: startStr, end: startStr, event_type: 'reminder', reminder_minutes: 0 }) },
        { label: 'New meeting', icon: 'users', onClick: async () => { const m = await openMeetingForm(null, { meeting_date: ymd(start), start_time: allDay ? '09:00' : hm(start), end_time: allDay ? '10:00' : hm(end) }); if (m?.id) cal.refetchEvents(); } },
        { label: 'New task due', icon: 'square-check-big', onClick: () => openTaskForm(null, { due_date: ymd(start), due_time: allDay ? null : hm(start) }) },
      ]);
    }

    async function move(info) {
      const it = info.event.extendedProps;
      const s = info.event.start;
      const e = info.event.end || new Date(s.getTime() + (it.type === 'task' ? 0 : 3600000));
      try {
        if (it.type === 'event') {
          await api.post(`events/${it.id}/move`, { original_start: it.start, start: fmtSql(s), end: fmtSql(info.event.allDay ? new Date(e.getTime() - 60000) : e), all_day: info.event.allDay });
          if (it.repeat_rule && it.repeat_rule !== 'none') toast('All occurrences of the series were moved', 'info');
        } else if (it.type === 'meeting') {
          if (info.event.allDay) throw new Error('Meetings need a start and end time.');
          await api.post(`meetings/${it.id}/move`, { start: fmtSql(s), end: fmtSql(e) });
        } else {
          await api.post(`tasks/${it.id}/move`, { start: fmtSql(s), all_day: info.event.allDay });
        }
        toast('Rescheduled', 'success', { timeout: 1500 });
        cal.refetchEvents();
      } catch (err) {
        toastError(err);
        info.revert();
      }
    }

    function showDetails(it, anchorEl) {
      const typeLabel = it.type === 'event' ? (it.event_type || 'event') : it.type;
      const when = it.all_day ? `${parseDate(it.start).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · All day`
        : it.type === 'task' ? `Due ${fmtDateTime(it.start)}` : `${fmtDateTime(it.start)} – ${fmtTime(it.end)}`;
      const m = modal({
        title: it.title,
        size: 'sm',
        headExtra: html`<span class="badge" style="background:${COLORS[it.type === 'event' ? it.event_type : it.type]}22;color:${COLORS[it.type === 'event' ? it.event_type : it.type]};text-transform:capitalize">${typeLabel}</span>`,
        body: html`<div class="col" style="gap:10px">
          <div class="row small">${icon('clock', 'sm')} ${when}</div>
          ${it.repeat_rule && it.repeat_rule !== 'none' ? html`<div class="row small">${icon('repeat', 'sm')} Repeats ${it.repeat_rule}</div>` : ''}
          ${it.location ? html`<div class="row small">${icon('map-pin', 'sm')} ${it.location}</div>` : ''}
          ${it.meeting_url ? html`<div class="row small">${icon('video', 'sm')} <a href="${it.meeting_url}" target="_blank" rel="noopener" class="truncate">${it.meeting_url}</a></div>` : ''}
          ${it.priority ? html`<div class="row small">${icon('flag', 'sm')} Priority: <span class="badge prio prio-${it.priority}">${it.priority}</span> · ${String(it.status).replace('_', ' ')}</div>` : ''}
          ${it.description ? html`<p class="small muted" style="white-space:pre-line;margin:0">${it.description}</p>` : ''}
        </div>`,
        actions: [
          ...(it.meeting_url ? [{ label: 'Join', icon: 'video', onClick: () => { window.open(it.meeting_url, '_blank', 'noopener'); return false; } }] : []),
          { label: 'Open', variant: 'primary', icon: 'square-pen', value: 'open' },
        ],
      });
      m.result.then(async (v) => {
        if (v !== 'open') return;
        if (it.type === 'meeting') navigate(`/meetings/${it.id}`);
        else if (it.type === 'task') openTaskForm({ id: it.id });
        else openEventForm({ id: it.id });
      });
      void anchorEl;
    }

    el.addEventListener('click', async (e) => {
      const nav = e.target.closest('[data-nav]');
      if (nav) return cal[nav.dataset.nav]();
      const v = e.target.closest('[data-view]');
      if (v) return cal.changeView(v.dataset.view);
      const t = e.target.closest('[data-type]');
      if (t) {
        shown[t.dataset.type] = !shown[t.dataset.type];
        t.classList.toggle('active', shown[t.dataset.type]);
        return cal.refetchEvents();
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'new') openEventForm(null, {});
      if (act === 'meeting') { const m = await openMeetingForm(null, {}); if (m?.id) cal.refetchEvents(); }
    });

    if (q0.event) {
      try {
        const ev = await api.get(`events/${q0.event}`);
        showDetails({ ...ev, type: 'event', start: ev.start_at, end: ev.end_at }, null);
      } catch { /* ignore */ }
    }
    const offs = [on('calendar:changed', () => cal.refetchEvents()), on('tasks:changed', () => cal.refetchEvents())];
    return () => { offs.forEach((f) => f()); cal.destroy(); };
  },
};
export { esc };
