// Meetings list and meeting detail (participants, agenda, meeting notes, related tasks & note, attachments).
import { html, icon, parseDate, fmtDay, debounce, timeAgo, initials, raw, esc } from '../core/dom.js';
import { api } from '../core/api.js';
import { on, emit } from '../core/store.js';
import { navigate, setQuery } from '../core/router.js';
import { shell } from '../core/shell.js';
import { toast, toastError, menu, confirm, empty, skeletonRows } from '../core/ui.js';
import { openMeetingForm, openTaskForm } from '../components/forms.js';
import { createRTE } from '../components/rte.js';
import { mountAttachments } from '../components/attachments.js';
import { openMeetingShare } from '../components/meetingShare.js';

const STATUS_BADGE = { scheduled: 'accent', completed: 'success', cancelled: 'danger' };
const t5 = (t) => (t || '').slice(0, 5);

function meetingCard(m) {
  const d = parseDate(m.meeting_date);
  const isToday = m.meeting_date === new Date().toISOString().slice(0, 10);
  return html`<a class="card hoverable meeting-card" href="#/meetings/${m.id}" style="color:inherit;text-decoration:none;${m.color ? `border-left:4px solid ${m.color}` : ''}">
    <div class="date-block"><span>${d.toLocaleDateString(undefined, { month: 'short' })}</span><b>${d.getDate()}</b></div>
    <div class="mc-main"><div class="row between"><h3 class="truncate">${m.title}</h3><span class="badge ${STATUS_BADGE[m.status]}" style="text-transform:capitalize">${isToday && m.status === 'scheduled' ? 'Today' : m.status}</span></div>
      <div class="meta-line"><span>${icon('clock', 'sm')} ${fmtDay(m.meeting_date)} · ${t5(m.start_time)} – ${t5(m.end_time)}</span>
        ${m.location ? html`<span>${icon('map-pin', 'sm')} ${m.location}</span>` : ''}
        ${m.meeting_url ? html`<span>${icon('video', 'sm')} Online</span>` : ''}
        ${m.task_count ? html`<span>${icon('square-check-big', 'sm')} ${m.task_count}</span>` : ''}
        ${m.has_minutes ? html`<span>${icon('notebook-pen', 'sm')} Notes</span>` : ''}
        ${m.shared ? html`<span class="badge info">${icon('user', 'sm')} ${m.owner_name}</span>` : m.share_all ? html`<span class="badge info" data-tip="Shared with all users">${icon('globe', 'sm')} Everyone</span>` : m.share_count ? html`<span class="badge info" data-tip="Shared with ${m.share_count}">${icon('users', 'sm')} ${m.share_count}</span>` : ''}</div>
      ${m.participant_count ? html`<div class="row mt-1" style="gap:8px"><div class="avatar-stack">${m.participant_names.map((n) => html`<span class="avatar sm">${initials(n)}</span>`)}</div><span class="small subtle">${m.participant_count} participant${m.participant_count > 1 ? 's' : ''}</span></div>` : ''}
    </div></a>`;
}

async function renderList(el, ctx) {
  const f = { scope: ctx.query.scope || 'upcoming', q: ctx.query.q || '', owner: ctx.query.owner || '' };
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Meetings</h1><p>Plan meetings, capture minutes and track follow-up tasks.</p></div>
      <button class="btn primary" data-act="new">${icon('plus', 'sm')} New meeting</button></div>
    <div class="toolbar"><div class="chips">${[['upcoming', 'Upcoming'], ['today', 'Today'], ['past', 'Past'], ['all', 'All']].map(([v, l]) => html`<button class="chip ${f.scope === v ? 'active' : ''}" data-scope="${v}">${l}</button>`)}</div>
      <select class="select sm" style="width:auto" data-owner aria-label="Owner">${[['', 'Everyone\'s'], ['me', 'Mine'], ['others', 'Shared with me']].map(([v, l]) => html`<option value="${v}" ${f.owner === v ? 'selected' : ''}>${l}</option>`)}</select>
      <div class="grow"></div><div class="input-icon" style="width:min(260px,100%)">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search meetings…" value="${f.q}" data-search></div></div>
    <div data-list class="grid grid-2">${skeletonRows(4)}</div>`);
  const list = el.querySelector('[data-list]');
  async function load() {
    try {
      const rows = await api.get('meetings', { scope: f.scope, q: f.q, owner: f.owner });
      setQuery({ scope: f.scope !== 'upcoming' ? f.scope : '', q: f.q, owner: f.owner });
      list.innerHTML = rows.length ? rows.map((m) => String(meetingCard(m))).join('')
        : String(html`<div style="grid-column:1/-1">${empty({ icon: 'users', title: f.q ? 'No meetings found' : f.scope === 'upcoming' ? 'No upcoming meetings' : 'No meetings', text: 'Schedule a meeting with participants, location and an automatic e-mail reminder.', action: '<button class="btn primary" data-act="new">Schedule a meeting</button>' })}</div>`);
    } catch (e) { toastError(e); }
  }
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-act="new"]')) { const m = await openMeetingForm(); if (m?.id) navigate(`/meetings/${m.id}`); }
    const s = e.target.closest('[data-scope]');
    if (s) { f.scope = s.dataset.scope; el.querySelectorAll('[data-scope]').forEach((c) => c.classList.toggle('active', c === s)); load(); }
  });
  const search = debounce(load, 300);
  el.querySelector('[data-search]').addEventListener('input', (e) => { f.q = e.target.value.trim(); search(); });
  el.querySelector('[data-owner]').addEventListener('change', (e) => { f.owner = e.target.value; load(); });
  await load();
  return on('meetings:changed', load);
}

async function renderDetail(el, ctx) {
  const id = +ctx.params.id;
  let m;
  try { m = await api.get(`meetings/${id}`); } catch (e) {
    el.innerHTML = String(empty({ icon: 'calendar-x', title: 'Meeting not found', text: e.message, action: '<a class="btn primary" href="#/meetings">Back to meetings</a>' }));
    return;
  }
  ctx.setTitle(m.title);
  const isOwner = m.access !== 'viewer';
  let minutesDirty = false;
  let rte;

  const paint = () => {
    const d = parseDate(m.meeting_date);
    const past = new Date(`${m.meeting_date}T${m.end_time}`) < new Date();
    el.innerHTML = String(html`
      <div class="row mb-2"><a class="btn ghost sm" href="#/meetings">${icon('arrow-left', 'sm')} Meetings</a></div>
      <div class="detail-head">
        <div class="date-block"><span>${d.toLocaleDateString(undefined, { month: 'short' })}</span><b>${d.getDate()}</b></div>
        <div class="grow" style="min-width:240px"><div class="row wrap" style="gap:8px"><h1 style="font-size:24px">${m.title}</h1><span class="badge ${STATUS_BADGE[m.status]}" style="text-transform:capitalize">${m.status}</span></div>
          <div class="meta-line mt-1"><span>${icon('calendar', 'sm')} ${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
            <span>${icon('clock', 'sm')} ${t5(m.start_time)} – ${t5(m.end_time)}</span>${m.location ? html`<span>${icon('map-pin', 'sm')} ${m.location}</span>` : ''}
            ${m.reminder_minutes !== null ? html`<span>${icon('bell', 'sm')} ${m.reminder_minutes ? `${m.reminder_minutes} min before` : 'At start'}</span>` : ''}</div></div>
        <div class="row wrap">
          ${m.meeting_url ? html`<a class="btn primary" href="${m.meeting_url}" target="_blank" rel="noopener">${icon('video', 'sm')} Join meeting</a>` : ''}
          ${isOwner ? html`<button class="btn ${m.shares?.all || m.shares?.users.length ? 'active' : ''}" data-a="share">${icon(m.shares?.all ? 'globe' : 'users', 'sm')} Share${m.shares?.all ? ' · Everyone' : m.shares?.users.length ? ` · ${m.shares.users.length}` : ''}</button>
          <button class="btn" data-a="edit">${icon('pencil', 'sm')} Edit</button>
          <button class="btn icon" data-a="more" aria-label="More">${icon('more-horizontal', 'sm')}</button>` : ''}</div>
      </div>
      ${isOwner ? '' : html`<div class="share-banner mb-2">${icon('users', 'sm')}<span>Shared by <b>${m.owner?.name || 'another user'}</b> · view only — you'll get the reminder for this meeting.</span></div>`}
      <div class="dash-grid">
        <div class="col" style="gap:var(--gap)">
          ${m.description ? html`<div class="card card-pad"><div class="section-title">${icon('list', 'sm')} Agenda</div><p style="white-space:pre-line;margin:0">${m.description}</p></div>` : ''}
          <div class="card" style="overflow:hidden"><div class="card-head" style="padding-bottom:12px"><h3>${icon('notebook-pen', 'sm')} Meeting notes</h3>
            <div class="row"><span class="save-state small" data-min-state></span>
            ${isOwner && past && m.status === 'scheduled' ? html`<button class="btn sm soft" data-a="complete">${icon('check', 'sm')} Save & mark completed</button>` : ''}
            ${isOwner ? html`<button class="btn sm primary" data-a="save-min">${icon('save', 'sm')} Save</button>` : ''}</div></div>
            <div data-min-toolbar></div><div style="padding:16px 20px 22px" data-min-editor></div></div>
          <div class="card card-pad" data-attachments></div>
        </div>
        <div class="col" style="gap:var(--gap)">
          ${m.tagged?.length ? html`<div class="card card-pad"><div class="section-title">${icon('at-sign', 'sm')} Tagged users <span class="subtle small">${m.tagged.length}</span></div>
            <div class="tagged-list">${m.tagged.map((t) => html`<span class="participant"><span class="avatar sm">${initials(t.name)}</span>${t.name}<span class="subtle tiny">${t.email}</span></span>`)}</div></div>` : ''}
          <div class="card card-pad"><div class="section-title">${icon('users', 'sm')} Participants <span class="subtle small">${m.participants.length}</span></div>
            ${m.participants.length ? m.participants.map((p) => html`<span class="participant"><span class="avatar sm">${initials(p.name)}</span>${p.name}${p.email && p.email !== p.name ? html`<span class="subtle tiny">${p.email}</span>` : ''}</span>`) : html`<p class="small subtle">No participants added.</p>`}</div>
          <div class="card card-pad"><div class="row between mb-2"><div class="section-title" style="margin:0">${icon('square-check-big', 'sm')} Action items</div>${isOwner ? html`<button class="btn sm" data-a="task">${icon('plus', 'sm')} Task</button>` : ''}</div>
            ${m.tasks.length ? m.tasks.map((t) => html`<div class="row" style="padding:7px 0;border-bottom:1px dashed var(--border)">
              ${isOwner ? html`<button class="t-check prio-${t.priority} ${t.status === 'completed' ? 'on' : ''}" data-done="${t.id}" data-status="${t.status}">${icon('check')}</button>` : html`<span class="t-check prio-${t.priority} ${t.status === 'completed' ? 'on' : ''}" style="pointer-events:none">${icon('check')}</span>`}
              ${isOwner ? html`<a href="#/tasks?open=${t.id}" class="grow truncate" style="color:inherit;${t.status === 'completed' ? 'text-decoration:line-through;opacity:.6' : ''}">${t.title}</a>` : html`<span class="grow truncate" style="${t.status === 'completed' ? 'text-decoration:line-through;opacity:.6' : ''}">${t.title}</span>`}
              ${t.due_date ? html`<span class="tiny subtle">${fmtDay(t.due_date)}</span>` : ''}</div>`) : html`<p class="small subtle">${isOwner ? 'Capture follow-ups as tasks so nothing gets lost.' : 'No action items.'}</p>`}</div>
          ${isOwner ? html`<div class="card card-pad"><div class="section-title">${icon('link', 'sm')} Related note</div>
            ${m.note ? html`<a class="list-item" href="#/notes/${m.note.id}" style="padding:8px"><span class="li-icon">${icon(m.note.is_locked ? 'lock' : 'notebook-pen', 'sm')}</span><div class="li-main"><div class="li-title">${m.note.title || 'Untitled note'}</div><div class="li-sub">${m.note.excerpt || ''}</div></div></a>`
              : html`<p class="small subtle mb-2">No note linked.</p><button class="btn sm" data-a="create-note">${icon('plus', 'sm')} Create linked note</button>`}</div>` : ''}
          <p class="tiny subtle">Created ${timeAgo(m.created_at)} · Updated ${timeAgo(m.updated_at)}</p>
        </div>
      </div>`);
    rte?.destroy();
    rte = createRTE({ content: m.minutes || '', placeholder: !isOwner ? 'No meeting notes yet.' : past ? 'What was discussed? Decisions, notes and next steps…' : 'Prepare notes for this meeting…', media: false, onChange: () => { if (!isOwner) return; minutesDirty = true; setMinState('dirty', 'Unsaved'); autosave(); } });
    rte.editor.style.minHeight = isOwner ? '220px' : '80px';
    rte.toolbar.style.position = 'static';
    if (!isOwner) { rte.editor.contentEditable = 'false'; rte.toolbar.style.display = 'none'; }
    el.querySelector('[data-min-toolbar]').appendChild(rte.toolbar);
    el.querySelector('[data-min-editor]').appendChild(rte.editor);
    mountAttachments(el.querySelector('[data-attachments]'), { parent: 'meeting', parentId: id, items: m.attachments, readOnly: !isOwner });
  };
  const setMinState = (cls, text) => { const s = el.querySelector('[data-min-state]'); if (s) { s.className = 'save-state small ' + cls; s.innerHTML = String(html`<span class="d"></span>${text}`); } };
  async function saveMinutes(markCompleted = false) {
    autosave.cancel();
    if (!minutesDirty && !markCompleted) return;
    setMinState('saving', 'Saving…');
    try {
      const r = await api.post(`meetings/${id}/minutes`, { minutes: rte.getHTML(), mark_completed: markCompleted });
      minutesDirty = false;
      setMinState('', 'Saved');
      if (markCompleted) { m = r; paint(); toast('Meeting marked as completed', 'success'); emit('calendar:changed'); }
    } catch (e) { setMinState('error', 'Not saved'); toastError(e); }
  }
  const autosave = debounce(() => saveMinutes(), 1500);
  shell.saveHandler = isOwner ? async () => { minutesDirty = true; await saveMinutes(); toast('Meeting notes saved', 'success', { timeout: 1500 }); } : null;
  ctx.beforeLeave = async () => { if (minutesDirty) await saveMinutes(); return true; };
  paint();

  async function reload() { m = await api.get(`meetings/${id}`); paint(); }
  el.addEventListener('click', async (e) => {
    const done = e.target.closest('[data-done]');
    if (done) {
      const st = done.dataset.status === 'completed' ? 'todo' : 'completed';
      await api.post(`tasks/${done.dataset.done}/status`, { status: st }).catch(toastError);
      return reload();
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'share') { const sh = await openMeetingShare(m); if (sh) { m.shares = sh; paint(); emit('meetings:changed'); } return; }
    if (a === 'save-min') { minutesDirty = true; return saveMinutes(); }
    if (a === 'complete') return saveMinutes(true);
    if (a === 'edit') { const r = await openMeetingForm(m); if (r?.id) { await saveMinutes(); m = r; paint(); } }
    if (a === 'task') { const t = await openTaskForm(null, { meeting_id: id, meeting_title: m.title, due_date: m.meeting_date }); if (t?.id) reload(); }
    if (a === 'create-note') {
      try {
        const n = await api.post('notes', { title: `Meeting: ${m.title}`, content: `<h2>${esc(m.title)}</h2><p>${parseDate(m.meeting_date).toLocaleDateString()} · ${t5(m.start_time)} – ${t5(m.end_time)}${m.location ? ' · ' + esc(m.location) : ''}</p><h3>Agenda</h3><p>${esc(m.description || '').replace(/\n/g, '<br>')}</p><h3>Action items</h3><ul class="checklist"><li data-checked="false"><br></li></ul>` });
        await api.post(`meetings/${id}`, { note_id: n.id });
        navigate(`/notes/${n.id}`);
      } catch (err) { toastError(err); }
    }
    if (a === 'more') {
      menu(e.target.closest('[data-a]'), [
        ...['scheduled', 'completed', 'cancelled'].map((s) => ({ label: `Mark as ${s}`, icon: s === 'completed' ? 'check' : s === 'cancelled' ? 'x' : 'calendar', checked: m.status === s, onClick: async () => { await saveMinutes(); m = await api.post(`meetings/${id}`, { status: s }); paint(); emit('calendar:changed'); } })),
        { label: 'Open in calendar', icon: 'calendar-days', onClick: () => navigate(`/calendar?view=timeGridDay&date=${m.meeting_date}`) },
        { divider: true },
        { label: 'Delete meeting', icon: 'trash-2', danger: true, onClick: async () => {
          if (!(await confirm({ title: 'Delete meeting?', message: 'The meeting will be moved to the trash.', confirmText: 'Delete' }))) return;
          await api.post(`items/meeting/${id}/trash`).catch(toastError);
          ctx.beforeLeave = null;
          toast('Meeting moved to trash', 'success');
          navigate('/meetings');
        } },
      ], { align: 'end' });
    }
  });
  return () => { rte?.destroy(); shell.saveHandler = null; };
}

export default {
  title: 'Meetings',
  render(el, ctx) {
    return ctx.meta.detail ? renderDetail(el, ctx) : renderList(el, ctx);
  },
};
export { raw };
