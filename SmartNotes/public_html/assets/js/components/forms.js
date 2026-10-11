// Create / edit forms for tasks, calendar events and meetings (modal based).
import { html, icon, raw, h, todayStr, ymd, hm, parseDate, $ } from '../core/dom.js';
import { api } from '../core/api.js';
import { state, emit } from '../core/store.js';
import { modal, toast, toastError, formData, showFieldErrors, PALETTE, confirm } from '../core/ui.js';
import { tagInput, normalizeTag, parseParticipant, formatParticipant } from './tagInput.js';
import { mountAttachments } from './attachments.js';
import { userPicker } from './userPicker.js';

export const REMINDERS = [
  ['', 'No reminder'], ['0', 'At time of event'], ['5', '5 minutes before'], ['10', '10 minutes before'], ['15', '15 minutes before'],
  ['30', '30 minutes before'], ['60', '1 hour before'], ['120', '2 hours before'], ['1440', '1 day before'], ['2880', '2 days before'],
];
export const PRIORITIES = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']];
export const STATUSES = [['todo', 'To do'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];

const opt = (list, cur) => list.map(([v, l]) => html`<option value="${v}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${l}</option>`);
const reminderOptions = (cur) => {
  const list = [...REMINDERS];
  if (cur !== null && cur !== undefined && cur !== '' && !list.some(([v]) => v === String(cur))) list.push([String(cur), `${cur} minutes before`]);
  return opt(list, cur ?? '');
};

let notesCache = null;
export async function noteOptions(selected) {
  if (!notesCache) {
    try {
      const r = await api.get('notes', { per_page: 100, sort: 'updated' });
      notesCache = r.items;
      setTimeout(() => (notesCache = null), 60000);
    } catch { notesCache = []; }
  }
  return html`<option value="">— None —</option>${notesCache.map((n) => html`<option value="${n.id}" ${+selected === n.id ? 'selected' : ''}>${n.title || '(Untitled note)'}</option>`)}`;
}

function colorRow(name, cur) {
  return html`<div class="accent-row">${PALETTE.map((c) => html`<label style="cursor:pointer"><input type="radio" name="${name}" value="${c}" ${cur === c ? 'checked' : ''} class="sr-only"><span class="accent-dot" style="--sw:${c};width:26px;height:26px"></span></label>`)}
    <label style="cursor:pointer" data-tip="Default"><input type="radio" name="${name}" value="" ${!cur ? 'checked' : ''} class="sr-only"><span class="accent-dot" style="--sw:var(--bg-soft);width:26px;height:26px"></span></label></div>`;
}
function bindColorRow(root, name) {
  const sync = () => root.querySelectorAll(`input[name="${name}"]`).forEach((r) => r.nextElementSibling.classList.toggle('active', r.checked));
  root.addEventListener('change', (e) => { if (e.target.name === name) sync(); });
  sync();
}

// ===================================================================== TASK
export async function openTaskForm(task = null, defaults = {}) {
  const editing = !!task?.id;
  if (editing && !task.attachments) {
    try { task = await api.get(`tasks/${task.id}`); } catch (e) { toastError(e); return null; }
  }
  const t = { priority: 'medium', status: 'todo', reminder_minutes: state.settings?.default_reminder ?? null, tags: [], ...defaults, ...(task || {}) };
  if (!editing && !t.due_date) t.reminder_minutes = null;
  // Assignment (v1.8): admins can give a task to another user. The assignee cannot change what was asked
  // (locked_fields); the admin who assigned it sees it under "Assigned by me" and can reassign or delete it.
  const me = state.user.id;
  const isAdmin = state.user.role === 'admin';
  const asAssigner = editing && t.access === 'assigner';
  const locked = new Set(t.locked_fields || []);
  const canAssign = isAdmin && (!editing || asAssigner || (t.assigned_by ?? me) === me);
  const lock = (f) => (locked.has(f) ? 'disabled' : '');
  let people = [];
  if (canAssign) { try { people = await api.get('users/directory'); } catch { people = []; } }
  const assignedTo = editing ? t.assignee_id ?? me : +(defaults.assign_to || me);
  const tags = tagInput({ value: t.tags || [], suggestions: state.tags.map((x) => x.name), placeholder: 'Add tags…', normalize: normalizeTag, prefix: '#' });
  const form = h(String(html`<form class="task-form" autocomplete="off">
    ${locked.size ? html`<div class="share-banner" style="margin:0 0 12px">${icon('user-check', 'sm')}<span>Assigned to you by <b>${t.assigned_by_name || 'an administrator'}</b>. You can update the status, category, tags, related note and reminder.</span></div>` : ''}
    ${canAssign ? html`<div class="field assign-field"><label>${icon('user-plus', 'sm')} Assign to</label><select class="select" name="assign_to">
      <option value="${me}" ${assignedTo === me ? 'selected' : ''}>Me (${state.user.name})</option>
      ${people.map((p) => html`<option value="${p.id}" ${assignedTo === p.id ? 'selected' : ''}>${p.name} — ${p.email}</option>`)}</select>
      <span class="hint">The user gets a notification and e-mail, and sees it in their Tasks. You follow it under <b>Assigned by me</b>.</span></div>` : ''}
    <div class="field"><input class="input" name="title" value="${t.title || ''}" placeholder="What needs to be done?" style="font-size:16px;font-weight:600;height:46px" autofocus ${lock('title')}></div>
    <div class="field"><textarea class="textarea" name="description" placeholder="Add a description…" rows="3" ${lock('description')}>${t.description || ''}</textarea></div>
    <div class="form-grid">
      <div class="field"><label>Due date</label><input class="input" type="date" name="due_date" value="${t.due_date || ''}" ${lock('due_date')}></div>
      <div class="field"><label>Due time</label><input class="input" type="time" name="due_time" value="${t.due_time || ''}" ${lock('due_time')}></div>
      <div class="field"><label>Priority</label><select class="select" name="priority" ${lock('priority')}>${opt(PRIORITIES, t.priority)}</select></div>
      <div class="field"><label>Status</label><select class="select" name="status">${opt(STATUSES, t.status)}</select></div>
      <div class="field" data-own><label>Category</label><select class="select" name="category_id"><option value="">— None —</option>${state.categories.task.map((c) => html`<option value="${c.id}" ${+t.category_id === c.id ? 'selected' : ''}>${c.name}</option>`)}</select></div>
      <div class="field"><label>Reminder</label><select class="select" name="reminder_minutes">${reminderOptions(t.reminder_minutes)}</select><span class="hint">Needs a due date. Sent by e-mail & in-app.</span></div>
      <div class="field span-2" data-own><label>Tags</label><div data-slot="tags"></div></div>
      <div class="field span-2" data-own><label>Related note</label><select class="select" name="note_id"><option>Loading…</option></select></div>
    </div>
    ${t.meeting_id ? html`<input type="hidden" name="meeting_id" value="${t.meeting_id}"><p class="small muted">${icon('users', 'sm')} Linked to meeting${t.meeting_title ? html`: <b>${t.meeting_title}</b>` : ''}</p>` : ''}
    ${editing ? html`<div data-slot="attachments" class="mt-2"></div>` : html`<p class="hint small subtle">${icon('paperclip', 'sm')} You can attach files after creating the task.</p>`}
  </form>`));
  form.querySelector('[data-slot="tags"]').appendChild(tags.el);
  noteOptions(t.note_id).then((o) => (form.querySelector('[name="note_id"]').innerHTML = String(o)));
  // Category, tags and the related note are the assignee's own: hidden while the task is for someone else.
  const syncOwn = () => {
    const other = asAssigner || (canAssign && +form.querySelector('[name="assign_to"]').value !== me);
    form.querySelectorAll('[data-own]').forEach((x) => x.classList.toggle('hidden', other));
  };
  form.querySelector('[name="assign_to"]')?.addEventListener('change', syncOwn);
  syncOwn();
  if (editing) mountAttachments(form.querySelector('[data-slot="attachments"]'), { parent: 'task', parentId: t.id, items: t.attachments || [] });

  const m = modal({
    title: editing ? 'Edit task' : 'New task',
    size: 'lg',
    body: form,
    actions: [
      ...(editing && !locked.size ? [{
        label: 'Delete', icon: 'trash-2', variant: 'ghost danger-text', left: true, onClick: async () => {
          const msg = asAssigner ? `The task is removed for ${t.assignee_name || 'the assignee'} as well. This cannot be undone.` : 'The task will be moved to the trash.';
          if (!(await confirm({ title: 'Delete task?', message: msg, confirmText: 'Delete' }))) return false;
          await api.post(`items/task/${t.id}/trash`);
          toast(asAssigner ? 'Task deleted' : 'Task moved to trash', 'success');
          emit('tasks:changed');
          return { deleted: true };
        },
      }] : []),
      { label: 'Cancel', value: null },
      {
        label: editing ? 'Save changes' : 'Create task', variant: 'primary', onClick: async () => {
          const d = formData(form);
          if (!locked.has('title') && !d.title.trim()) { showFieldErrors(form, { title: 1 }); return false; }
          if (!form.querySelector('[data-own]').classList.contains('hidden')) d.tags = tags.get();
          else { delete d.category_id; delete d.note_id; }
          d.reminder_minutes = d.reminder_minutes === '' ? null : +d.reminder_minutes;
          try {
            const saved = editing ? await api.post(`tasks/${t.id}`, d) : await api.post('tasks', d);
            const to = canAssign ? people.find((p) => p.id === +d.assign_to) : null;
            toast(to && (!editing || to.id !== assignedTo) ? `Task assigned to ${to.name}` : editing ? 'Task updated' : 'Task created', 'success');
            emit('tasks:changed', saved);
            refreshTags();
            return saved;
          } catch (e) { showFieldErrors(form, e.errors); throw e; }
        },
      },
    ],
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); m.el.querySelector('.btn.primary').click(); });
  return m.result;
}

export async function refreshTags() {
  try { state.tags = await api.get('tags'); emit('tags:changed'); } catch { /* ignore */ }
}

// ===================================================================== EVENT
export async function openEventForm(ev = null, defaults = {}) {
  const editing = !!ev?.id;
  if (editing && !ev.participants) {
    try { ev = await api.get(`events/${ev.id}`); } catch (e) { toastError(e); return null; }
  }
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  const start = parseDate(ev?.start_at || defaults.start) || now;
  const end = parseDate(ev?.end_at || defaults.end) || new Date(start.getTime() + 3600000);
  const e0 = { event_type: 'event', repeat_rule: 'none', all_day: false, reminder_minutes: state.settings?.default_reminder ?? 30, ...defaults, ...(ev || {}) };
  const people = tagInput({ value: (e0.participants || []).map(formatParticipant), placeholder: 'Name or email, press Enter', normalize: (v) => v.trim() });
  const tagged = userPicker({ value: e0.tagged || [], placeholder: 'Tag colleagues — it appears in their calendar too' });
  const form = h(String(html`<form autocomplete="off">
    <div class="field"><input class="input" name="title" value="${e0.title || ''}" placeholder="Event title" style="font-size:16px;font-weight:600;height:46px" autofocus></div>
    <div class="row wrap mb-2">
      <div class="btn-group" data-type>${[['event', 'Event'], ['schedule', 'Schedule'], ['reminder', 'Reminder']].map(([v, l]) => html`<button type="button" class="btn ${e0.event_type === v ? 'active' : ''}" data-v="${v}">${l}</button>`)}</div>
      <label class="check small" style="margin-left:auto"><input type="checkbox" name="all_day" ${e0.all_day ? 'checked' : ''}> All day</label>
    </div>
    <input type="hidden" name="event_type" value="${e0.event_type}">
    <div class="form-grid">
      <div class="field"><label>Start date</label><input class="input" type="date" name="start_date" value="${ymd(start)}"></div>
      <div class="field" data-time><label>Start time</label><input class="input" type="time" name="start_time" value="${hm(start)}"></div>
      <div class="field"><label>End date</label><input class="input" type="date" name="end_date" value="${ymd(end)}"></div>
      <div class="field" data-time><label>End time</label><input class="input" type="time" name="end_time" value="${hm(end)}"></div>
      <div class="field"><label>Location</label><input class="input" name="location" value="${e0.location || ''}" placeholder="Meeting Room A"></div>
      <div class="field"><label>Meeting link</label><input class="input" name="meeting_url" value="${e0.meeting_url || ''}" placeholder="https://meet…"></div>
      <div class="field"><label>Repeat</label><select class="select" name="repeat_rule">${opt([['none', 'Does not repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']], e0.repeat_rule)}</select></div>
      <div class="field" data-until><label>Repeat until</label><input class="input" type="date" name="repeat_until" value="${e0.repeat_until || ''}"></div>
      <div class="field"><label>Reminder</label><select class="select" name="reminder_minutes">${reminderOptions(e0.reminder_minutes)}</select></div>
      <div class="field"><label>Status</label><select class="select" name="status">${opt([['scheduled', 'Scheduled'], ['completed', 'Completed'], ['cancelled', 'Cancelled']], e0.status || 'scheduled')}</select></div>
      <div class="field span-2"><label>${icon('at-sign', 'sm')} Tag users <span class="subtle small">— they see it in their calendar and get the reminder</span></label><div data-slot="tagged"></div></div>
      <div class="field span-2"><label>Other participants <span class="subtle small">(people without an account)</span></label><div data-slot="people"></div></div>
      <div class="field span-2"><label>Color</label>${colorRow('color', e0.color)}</div>
      <div class="field span-2"><label>Description</label><textarea class="textarea" name="description" rows="3">${e0.description || ''}</textarea></div>
      <div class="field span-2"><label>Related note</label><select class="select" name="note_id"><option>Loading…</option></select></div>
    </div></form>`));
  form.querySelector('[data-slot="people"]').appendChild(people.el);
  form.querySelector('[data-slot="tagged"]').appendChild(tagged.el);
  bindColorRow(form, 'color');
  noteOptions(e0.note_id).then((o) => (form.querySelector('[name="note_id"]').innerHTML = String(o)));
  const syncUi = () => {
    const allDay = form.all_day.checked;
    form.querySelectorAll('[data-time]').forEach((x) => (x.style.display = allDay ? 'none' : ''));
    form.querySelector('[data-until]').style.display = form.repeat_rule.value === 'none' ? 'none' : '';
  };
  form.addEventListener('change', syncUi);
  form.querySelector('[data-type]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    form.event_type.value = b.dataset.v;
    form.querySelectorAll('[data-type] .btn').forEach((x) => x.classList.toggle('active', x === b));
  });
  syncUi();

  const m = modal({
    title: editing ? 'Edit event' : 'New event',
    size: 'lg',
    body: form,
    actions: [
      ...(editing ? [{
        label: 'Delete', icon: 'trash-2', variant: 'ghost danger-text', left: true, onClick: async () => {
          if (!(await confirm({ title: 'Delete event?', message: e0.repeat_rule !== 'none' ? 'All occurrences of this repeating event will be moved to the trash.' : 'The event will be moved to the trash.', confirmText: 'Delete' }))) return false;
          await api.post(`items/event/${e0.id}/trash`);
          toast('Event moved to trash', 'success');
          emit('calendar:changed');
          return { deleted: true };
        },
      }] : []),
      { label: 'Cancel', value: null },
      {
        label: editing ? 'Save changes' : 'Create event', variant: 'primary', onClick: async () => {
          const d = formData(form);
          if (!d.title.trim()) { showFieldErrors(form, { title: 1 }); return false; }
          const allDay = !!d.all_day;
          const payload = {
            title: d.title, description: d.description, event_type: d.event_type, all_day: allDay,
            start_at: `${d.start_date} ${allDay ? '00:00' : d.start_time || '00:00'}:00`,
            end_at: `${d.end_date || d.start_date} ${allDay ? '23:59' : d.end_time || d.start_time || '00:00'}:00`,
            location: d.location, meeting_url: d.meeting_url, repeat_rule: d.repeat_rule, repeat_until: d.repeat_rule === 'none' ? null : d.repeat_until || null,
            reminder_minutes: d.reminder_minutes === '' ? null : +d.reminder_minutes, status: d.status, color: d.color || null,
            note_id: d.note_id || null, participants: people.get().map(parseParticipant), tag_user_ids: tagged.get(),
          };
          try {
            const saved = editing ? await api.post(`events/${e0.id}`, payload) : await api.post('events', payload);
            toast(editing ? 'Event updated' : 'Event created', 'success');
            emit('calendar:changed');
            return saved;
          } catch (e) { showFieldErrors(form, e.errors); throw e; }
        },
      },
    ],
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); m.el.querySelector('.btn.primary').click(); });
  return m.result;
}

// ===================================================================== MEETING
export async function openMeetingForm(mt = null, defaults = {}) {
  const editing = !!mt?.id;
  if (editing && !mt.participants) {
    try { mt = await api.get(`meetings/${mt.id}`); } catch (e) { toastError(e); return null; }
  }
  const base = new Date();
  base.setMinutes(0, 0, 0);
  base.setHours(base.getHours() + 1);
  const d0 = {
    meeting_date: ymd(base), start_time: hm(base), end_time: hm(new Date(base.getTime() + 3600000)),
    reminder_minutes: state.settings?.default_reminder ?? 30, status: 'scheduled', ...defaults, ...(mt || {}),
  };
  const people = tagInput({ value: (d0.participants || []).map(formatParticipant), placeholder: 'Name <email>, press Enter', normalize: (v) => v.trim() });
  const tagged = userPicker({ value: d0.tagged || [], placeholder: 'Tag colleagues — it appears in their meetings & calendar' });
  const form = h(String(html`<form autocomplete="off">
    <div class="field"><input class="input" name="title" value="${d0.title || ''}" placeholder="Meeting title, e.g. Meeting Project Dukcapil" style="font-size:16px;font-weight:600;height:46px" autofocus></div>
    <div class="form-grid">
      <div class="field"><label>Date</label><input class="input" type="date" name="meeting_date" value="${d0.meeting_date}"></div>
      <div class="field"><label>Status</label><select class="select" name="status">${opt([['scheduled', 'Scheduled'], ['completed', 'Completed'], ['cancelled', 'Cancelled']], d0.status)}</select></div>
      <div class="field"><label>Start time</label><input class="input" type="time" name="start_time" value="${(d0.start_time || '').slice(0, 5)}"></div>
      <div class="field"><label>End time</label><input class="input" type="time" name="end_time" value="${(d0.end_time || '').slice(0, 5)}"></div>
      <div class="field"><label>Location</label><input class="input" name="location" value="${d0.location || ''}" placeholder="Meeting Room A"></div>
      <div class="field"><label>Meeting URL</label><input class="input" name="meeting_url" value="${d0.meeting_url || ''}" placeholder="https://zoom.us/j/…"></div>
      <div class="field span-2"><label>${icon('at-sign', 'sm')} Tag users <span class="subtle small">— they see it in Meetings & Calendar and get the reminder</span></label><div data-slot="tagged"></div></div>
      <div class="field span-2"><label>Other participants <span class="subtle small">(people without an account)</span></label><div data-slot="people"></div></div>
      <div class="field"><label>Reminder</label><select class="select" name="reminder_minutes">${reminderOptions(d0.reminder_minutes)}</select></div>
      <div class="field"><label>Related note</label><select class="select" name="note_id"><option>Loading…</option></select></div>
      <div class="field span-2"><label>Color</label>${colorRow('color', d0.color)}</div>
      <div class="field span-2"><label>Agenda / description</label><textarea class="textarea" name="description" rows="3">${d0.description || ''}</textarea></div>
    </div></form>`));
  form.querySelector('[data-slot="people"]').appendChild(people.el);
  form.querySelector('[data-slot="tagged"]').appendChild(tagged.el);
  bindColorRow(form, 'color');
  noteOptions(d0.note_id).then((o) => (form.querySelector('[name="note_id"]').innerHTML = String(o)));

  const m = modal({
    title: editing ? 'Edit meeting' : 'New meeting',
    size: 'lg',
    body: form,
    actions: [
      { label: 'Cancel', value: null },
      {
        label: editing ? 'Save changes' : 'Schedule meeting', variant: 'primary', onClick: async () => {
          const d = formData(form);
          if (!d.title.trim()) { showFieldErrors(form, { title: 1 }); return false; }
          const payload = { ...d, reminder_minutes: d.reminder_minutes === '' ? null : +d.reminder_minutes, color: d.color || null, note_id: d.note_id || null, participants: people.get().map(parseParticipant), tag_user_ids: tagged.get() };
          try {
            const saved = editing ? await api.post(`meetings/${d0.id}`, payload) : await api.post('meetings', payload);
            toast(editing ? 'Meeting updated' : 'Meeting scheduled', 'success');
            emit('calendar:changed');
            emit('meetings:changed', saved);
            return saved;
          } catch (e) { showFieldErrors(form, e.errors); throw e; }
        },
      },
    ],
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); m.el.querySelector('.btn.primary').click(); });
  return m.result;
}

export { todayStr, raw, $ };
