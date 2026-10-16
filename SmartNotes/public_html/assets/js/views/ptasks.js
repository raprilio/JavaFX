// Progress tasks (v1.22) — for yourself or for management (e.g. "Event preparation"). A task is split into parts;
// each part has its own bar and one person who fills it, and nobody else can. A part can need a hand-in ("setor"):
// a message, files and notes that the task's owner approves (or sends back). The task is done at 100 %.
// Team progress (programmers, everyone sees it) stays separate; these are private to the people on the task.
import { html, icon, h, debounce, timeAgo, fmtDay, fmtBytes, fileBadge, todayStr } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { navigate, setQuery } from '../core/router.js';
import { toast, toastError, modal, confirm, avatarHtml, empty } from '../core/ui.js';
import { mountItemNotes, pickNote } from '../components/itemNotes.js';
import { uploadFile, pickFiles } from '../components/attachments.js';
import { openFilePreview } from '../components/filePreview.js';

const COLORS = ['', '#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b'];
const PART_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#22c55e', '#a855f7', '#ef4444', '#64748b', '#06b6d4'];
/** Starting points; everything stays editable. [title, needs a hand-in] */
const TEMPLATES = {
  event: { label: 'Event preparation', parts: [['Venue & layout', true], ['Catering', false], ['Invitations & guest list', false], ['Equipment & sound', false], ['Documentation', true], ['Report & budget', true]] },
  launch: { label: 'Project launch', parts: [['Plan & timeline', true], ['Materials ready', false], ['Team briefing', false], ['Go live', false], ['Evaluation', true]] },
  personal: { label: 'Personal goal', parts: [['Step 1', false], ['Step 2', false], ['Step 3', false]] },
  blank: { label: 'Blank', parts: [['', false]] },
};
const SUB = {
  none: null,
  submitted: { label: 'Waiting for approval', icon: 'hourglass', cls: 'warning' },
  approved: { label: 'Approved', icon: 'badge-check', cls: 'success' },
  rejected: { label: 'Sent back', icon: 'undo-2', cls: 'danger' },
};
const pc = (it) => it.color || 'var(--accent)';

/** One bar made of every part: each part's width is its weight, its fill is how far its person got. */
function partsBar(parts, big = false) {
  const total = parts.reduce((a, p) => a + (p.weight || 1), 0) || 1;
  return html`<div class="pt-bar ${big ? 'big' : ''}" role="img" aria-label="Parts">${parts.map((p, i) => html`<span class="pt-seg ${p.effective === 100 ? 'done' : ''}" style="flex:${p.weight || 1} 1 0;--c:${PART_COLORS[i % PART_COLORS.length]}" data-tip="${p.title}${p.assignee ? ' · ' + p.assignee.name : ''} · ${p.effective}%"><i style="width:${p.effective}%"></i>${big ? html`<b>${p.title}</b>` : ''}</span>`)}</div>
    ${big ? '' : html`<span class="sr-only">${Math.round(parts.reduce((a, p) => a + (p.weight || 1) * p.effective, 0) / total)}%</span>`}`;
}

function card(t) {
  const segs = t.my_parts.length ? t.my_parts : [];
  return html`<a class="pt-card ${t.status === 'done' ? 'done' : ''} ${t.deleted_at ? 'deleted' : ''}" href="#/tasks/progress/${t.id}" style="--pc:${pc(t)}">
    <div class="pt-card-top"><b class="pt-title">${t.title}</b><span class="pt-pct">${t.percent}%</span></div>
    <div class="progress pt-line"><span style="width:${t.percent}%"></span></div>
    <div class="pt-meta">${t.status === 'done' ? html`<span class="badge success">${icon('party-popper', 'sm')} Completed</span>` : ''}
      <span>${icon('list-checks', 'sm')} ${t.parts_done}/${t.parts_total} parts</span>
      ${t.due_date ? html`<span class="${t.due_date < todayStr() && t.status !== 'done' ? 'overdue' : ''}">${icon('calendar', 'sm')} ${fmtDay(t.due_date)}</span>` : ''}
      ${t.waiting_review ? html`<span class="badge warning">${icon('hourglass', 'sm')} ${t.waiting_review} to approve</span>` : ''}</div>
    ${segs.length ? html`<div class="pt-mine">${segs.map((p) => html`<div class="pt-mine-row"><span class="truncate">${icon('user', 'xs')} Your part: <b>${p.title}</b></span><span class="pt-mine-pct">${p.effective}%${p.submission !== 'none' && SUB[p.submission] ? html` · <span class="${SUB[p.submission].cls === 'danger' ? 'text-danger' : ''}">${SUB[p.submission].label}</span>` : ''}</span></div>`)}</div>` : ''}
    <div class="pt-foot"><span class="avatar-stack">${t.people.slice(0, 5).map((u) => avatarHtml(u, 'sm'))}</span><span class="tiny subtle">${t.is_owner ? 'You manage this' : `by ${t.owner.name}`}</span></div>
  </a>`;
}

// ------------------------------------------------------------------ create / edit
async function openEditor(t = null) {
  const people = await api.get('users/directory').catch(() => []);
  const me = state.user;
  if (!people.some((u) => u.id === me.id)) people.unshift({ id: me.id, name: me.name });
  let parts = t ? t.parts.map((p) => ({ id: p.id, title: p.title, assignee_id: p.assignee?.id || me.id, weight: p.weight, needs_submission: p.needs_submission })) : [{ title: '', assignee_id: me.id, weight: 1, needs_submission: false }];
  let color = t?.color || '';
  const opts = (sel) => people.map((u) => html`<option value="${u.id}" ${u.id === sel ? 'selected' : ''}>${u.name}${u.id === me.id ? ' (me)' : ''}</option>`);
  const body = h(String(html`<form class="col pt-form" style="gap:12px" novalidate>
    <div class="field" style="margin:0"><label>Title</label><input class="input" name="title" maxlength="255" required value="${t?.title || ''}" placeholder="e.g. Persiapan event HUT · Laporan bulanan · Belajar Laravel"></div>
    <div class="field" style="margin:0"><label>Description</label><textarea class="textarea" name="description" rows="2" placeholder="What is the goal?">${t?.description || ''}</textarea></div>
    ${t ? '' : html`<div class="field" style="margin:0"><label>Template</label><div class="seg">${Object.entries(TEMPLATES).map(([k, v]) => html`<button type="button" class="btn xs" data-tpl="${k}">${v.label}</button>`)}</div></div>`}
    <div class="field" style="margin:0"><label>Parts <span class="subtle">— each person fills only their own bar</span></label><div data-parts></div>
      <button type="button" class="btn xs mt-1" data-add-part>${icon('plus', 'sm')} Add part</button>
      <span class="hint">Just for yourself? Keep one part for you. <b>Hand-in</b> = the person hands in (setor) a message, files or notes and you approve it before the part counts 100%.</span></div>
    <div class="form-grid"><div class="field"><label>Target date</label><input class="input" type="date" name="due_date" value="${t?.due_date || ''}"></div>
      <div class="field"><label>Colour</label><div class="swatches" style="padding:0;grid-template-columns:repeat(6,26px)" data-colors></div></div></div>
  </form>`));
  const paintParts = () => {
    body.querySelector('[data-parts]').innerHTML = parts.map((p, i) => String(html`<div class="pt-part-row" data-i="${i}">
      <input class="input sm" data-p="title" placeholder="Part ${i + 1}, e.g. Venue" maxlength="255" value="${p.title}" aria-label="Part title">
      <select class="select sm" data-p="assignee_id" aria-label="Who fills it">${opts(p.assignee_id)}</select>
      <select class="select sm pt-weight" data-p="weight" aria-label="Weight" data-tip="Weight: how much this part counts">${[1, 2, 3, 4, 5].map((w) => html`<option value="${w}" ${w === p.weight ? 'selected' : ''}>×${w}</option>`)}</select>
      <label class="check small pt-sub"><input type="checkbox" data-p="needs_submission" ${p.needs_submission ? 'checked' : ''}> Hand-in</label>
      <button type="button" class="btn ghost icon sm" data-rm-part="${i}" aria-label="Remove part" ${parts.length < 2 ? 'disabled' : ''}>${icon('x', 'sm')}</button></div>`)).join('');
  };
  const paintColors = () => {
    body.querySelector('[data-colors]').innerHTML = COLORS.map((c) => String(html`<button type="button" class="swatch ${c === color ? 'active' : ''}" data-color="${c}" style="--sw:${c || 'var(--bg-soft)'};width:26px;height:26px">${c ? '' : icon('slash', 'sm')}</button>`)).join('');
  };
  paintParts(); paintColors();
  body.addEventListener('input', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row) return;
    const p = parts[+row.dataset.i], k = e.target.dataset.p;
    p[k] = k === 'needs_submission' ? e.target.checked : k === 'title' ? e.target.value : +e.target.value;
  });
  body.addEventListener('click', (e) => {
    const tpl = e.target.closest('[data-tpl]');
    if (tpl) { parts = TEMPLATES[tpl.dataset.tpl].parts.map(([title, sub]) => ({ title, assignee_id: me.id, weight: 1, needs_submission: sub })); paintParts(); if (!body.querySelector('[name=title]').value && tpl.dataset.tpl !== 'blank') body.querySelector('[name=title]').value = TEMPLATES[tpl.dataset.tpl].label; return; }
    if (e.target.closest('[data-add-part]')) { parts.push({ title: '', assignee_id: me.id, weight: 1, needs_submission: false }); paintParts(); body.querySelector(`[data-i="${parts.length - 1}"] [data-p=title]`).focus(); return; }
    const rm = e.target.closest('[data-rm-part]');
    if (rm) { parts.splice(+rm.dataset.rmPart, 1); paintParts(); return; }
    const c = e.target.closest('[data-color]');
    if (c) { color = c.dataset.color; paintColors(); }
  });
  // the select / checkbox fire "change" only
  body.addEventListener('change', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row) return;
    const p = parts[+row.dataset.i], k = e.target.dataset.p;
    if (k) p[k] = k === 'needs_submission' ? e.target.checked : k === 'title' ? e.target.value : +e.target.value;
  });
  return modal({
    title: t ? 'Edit progress task' : 'New progress task', body, size: 'lg',
    onOpen: () => setTimeout(() => { if (!body.contains(document.activeElement)) body.querySelector('[name=title]').focus(); }, 60),
    actions: [{ label: 'Cancel' }, { label: t ? 'Save' : 'Create', variant: 'primary', onClick: async () => {
      const title = body.querySelector('[name=title]').value.trim();
      if (!title) { body.querySelector('[name=title]').classList.add('invalid'); body.querySelector('[name=title]').focus(); return false; }
      const list = parts.filter((p) => p.title.trim());
      if (!list.length) { toast('Give at least one part a name', 'warning'); return false; }
      const payload = { title, description: body.querySelector('[name=description]').value, due_date: body.querySelector('[name=due_date]').value || null, color, parts: list };
      try { return await api.post(t ? `ptasks/${t.id}` : 'ptasks', payload); } catch (err) { toastError(err); return false; }
    } }],
  }).result;
}

// ------------------------------------------------------------------ hand-in / review
async function handIn(t, part) {
  const files = [];
  const notes = [];
  const body = h(String(html`<div class="col" style="gap:12px">
    <p class="small muted" style="margin:0">Hand in <b>${part.title}</b> to ${t.owner.name}. It counts as 100% once approved.</p>
    <div class="field" style="margin:0"><label>Message</label><textarea class="textarea" rows="3" data-msg placeholder="What are you handing in? e.g. Kontrak gedung + denah sudah final"></textarea></div>
    <div class="field" style="margin:0"><label>Files</label><div data-files class="col" style="gap:6px"></div><button type="button" class="btn sm mt-1" data-add-file>${icon('upload', 'sm')} Add files</button></div>
    <div class="field" style="margin:0"><label>Notes</label><div data-notes class="col" style="gap:6px"></div><button type="button" class="btn sm mt-1" data-add-note>${icon('notebook-pen', 'sm')} Add a note</button></div></div>`));
  const paint = () => {
    body.querySelector('[data-files]').innerHTML = files.map((f, i) => String(html`<div class="file-row">${fileBadge(f.name)}<div class="grow truncate">${f.name}<div class="tiny subtle">${f.size ? fmtBytes(f.size) : ''}</div>${f.progress != null ? html`<div class="upload-progress"><span style="width:${f.progress}%"></span></div>` : ''}</div>${f.id ? html`<button type="button" class="btn ghost icon sm" data-rm-file="${i}" aria-label="Remove">${icon('x', 'sm')}</button>` : ''}</div>`)).join('');
    body.querySelector('[data-notes]').innerHTML = notes.map((n, i) => String(html`<div class="file-row"><span class="in-ic">${icon('notebook-pen', 'sm')}</span><div class="grow truncate">${n.title || 'Untitled'}</div><button type="button" class="btn ghost icon sm" data-rm-note="${i}" aria-label="Remove">${icon('x', 'sm')}</button></div>`)).join('');
  };
  body.addEventListener('click', async (e) => {
    if (e.target.closest('[data-add-file]')) {
      for (const file of await pickFiles()) {
        const row = { name: file.name, size: file.size, progress: 0 };
        files.push(row); paint();
        try { Object.assign(row, await uploadFile(file, { ptask_id: t.id }, (p) => { row.progress = Math.round(p * 100); paint(); }), { progress: null }); } catch (err) { files.splice(files.indexOf(row), 1); toastError(err); }
        paint();
      }
    }
    if (e.target.closest('[data-add-note]')) { const n = await pickNote({ title: 'Hand in a note', exclude: notes.map((x) => x.id) }); if (n) { notes.push(n); paint(); } }
    const rf = e.target.closest('[data-rm-file]'); if (rf) { files.splice(+rf.dataset.rmFile, 1); paint(); }
    const rn = e.target.closest('[data-rm-note]'); if (rn) { notes.splice(+rn.dataset.rmNote, 1); paint(); }
  });
  return modal({
    title: `Hand in · ${part.title}`, body, size: 'md',
    onOpen: () => body.querySelector('[data-msg]').focus(),
    actions: [{ label: 'Cancel' }, { label: 'Hand in', variant: 'primary', onClick: async () => {
      if (files.some((f) => !f.id)) { toast('Wait until the files are uploaded', 'warning'); return false; }
      const message = body.querySelector('[data-msg]').value.trim();
      if (!message && !files.length && !notes.length) { body.querySelector('[data-msg]').classList.add('invalid'); toast('Add a message, a file or a note', 'warning'); return false; }
      try { return await api.post(`ptasks/${t.id}/parts/${part.id}/submit`, { message, files: files.map((f) => f.id), notes: notes.map((n) => n.id) }); } catch (err) { toastError(err); return false; }
    } }],
  }).result;
}

async function review(t, part, approve) {
  const body = h(String(html`<div class="col" style="gap:10px"><p class="small muted" style="margin:0">${approve ? html`Approve <b>${part.title}</b> from ${part.assignee?.name}? It then counts as 100%.` : html`Send <b>${part.title}</b> back to ${part.assignee?.name} — tell them what to change.`}</p>
    <textarea class="textarea" rows="3" data-msg placeholder="${approve ? 'Optional comment' : 'What needs to change?'}"></textarea></div>`));
  return modal({
    title: approve ? 'Approve hand-in' : 'Send back', body, size: 'sm', onOpen: () => body.querySelector('[data-msg]').focus(),
    actions: [{ label: 'Cancel' }, { label: approve ? 'Approve' : 'Send back', variant: approve ? 'primary' : 'danger', onClick: async () => {
      const message = body.querySelector('[data-msg]').value.trim();
      if (!approve && message.length < 3) { body.querySelector('[data-msg]').classList.add('invalid'); return false; }
      try { return await api.post(`ptasks/${t.id}/parts/${part.id}/review`, { decision: approve ? 'approve' : 'reject', message }); } catch (err) { toastError(err); return false; }
    } }],
  }).result;
}

// ------------------------------------------------------------------ detail
async function renderDetail(el, ctx, id) {
  let t;
  try { t = await api.get(`ptasks/${id}`); } catch (e) {
    el.innerHTML = String(empty({ icon: 'list-checks', title: 'Not found', text: e.message, action: '<a class="btn primary" href="#/tasks/progress">Back to progress tasks</a>' }));
    return;
  }
  const KIND = { progress: ['trending-up', 'updated'], submit: ['send', 'handed in'], approve: ['badge-check', 'approved'], reject: ['undo-2', 'sent back'] };
  const paint = () => {
    ctx.setTitle(t.title);
    const done = t.parts.filter((p) => p.effective === 100).length;
    el.innerHTML = String(html`<div class="pt-detail" style="--pc:${pc(t)}">
      <div class="page-head"><div class="row" style="gap:10px;align-items:flex-start"><a class="btn ghost icon sm" href="#/tasks/progress" aria-label="Back">${icon('arrow-left')}</a>
        <div><h1 class="pg-h1">${t.title}</h1><p class="row wrap" style="gap:8px">${t.status === 'done' ? html`<span class="badge success">${icon('party-popper', 'sm')} Completed ${t.completed_at ? fmtDay(t.completed_at.slice(0, 10)) : ''}</span>` : html`<span class="badge info">${icon('loader', 'sm')} In progress</span>`}
          ${t.due_date ? html`<span class="small ${t.due_date < todayStr() && t.status !== 'done' ? 'overdue' : 'subtle'}">${icon('calendar', 'sm')} ${fmtDay(t.due_date)}</span>` : ''}
          <span class="small subtle">managed by ${t.owner.name}</span>${t.deleted_at ? html`<span class="badge danger">Deleted</span>` : ''}</p></div></div>
        <div class="row">${t.can_manage ? html`<button class="btn" data-a="edit">${icon('settings-2', 'sm')}<span class="hide-sm">Edit</span></button><button class="btn ghost icon" data-a="delete" aria-label="Delete" data-tip="Delete">${icon('trash-2', 'sm')}</button>` : ''}
          ${t.deleted_at && t.owner.id === state.user.id ? html`<button class="btn" data-a="restore">${icon('rotate-ccw', 'sm')} Restore</button>` : ''}</div></div>
      <div class="card card-pad pt-hero"><div class="row between wrap" style="gap:10px"><div><div class="pg-big">${t.percent}<small>%</small></div><div class="small muted">${done} of ${t.parts.length} part${t.parts.length === 1 ? '' : 's'} done${t.status === 'done' ? ' — completely finished 🎉' : ''}</div></div>
        <div class="avatar-stack">${[...new Map(t.parts.filter((p) => p.assignee).map((p) => [p.assignee.id, p.assignee])).values()].map((u) => avatarHtml(u, 'sm'))}</div></div>
        ${partsBar(t.parts, true)}</div>
      <div class="pg-cols">
        <div class="pg-main">
          <div class="card card-pad"><h3>${icon('list-checks', 'sm')} Parts <span class="subtle small">each person fills only their own bar</span></h3>
            <div class="pt-parts">${t.parts.map((p, i) => html`<div class="pt-part ${p.mine ? 'mine' : ''} ${p.effective === 100 ? 'done' : ''}" style="--c:${PART_COLORS[i % PART_COLORS.length]}" data-part="${p.id}">
              <div class="row between wrap" style="gap:8px"><div class="row" style="gap:8px;min-width:0">${p.assignee ? avatarHtml(p.assignee, 'sm') : ''}<div style="min-width:0"><b class="truncate block">${p.title}</b><span class="tiny subtle">${p.assignee ? p.assignee.name + (p.mine ? ' (you)' : '') : 'nobody'}${p.weight > 1 ? ` · counts ×${p.weight}` : ''}</span></div></div>
                <div class="row" style="gap:6px">${p.needs_submission ? (SUB[p.submission] ? html`<span class="badge ${SUB[p.submission].cls}">${icon(SUB[p.submission].icon, 'sm')} ${SUB[p.submission].label}</span>` : html`<span class="badge">${icon('send', 'sm')} Hand-in</span>`) : ''}<b class="pt-part-pct">${p.effective}%</b></div></div>
              <div class="pt-part-bar"><i style="width:${p.effective}%"></i></div>
              ${p.can_update ? html`<form class="pt-update" data-update="${p.id}" novalidate><input type="range" min="0" max="100" value="${p.percent}" data-range aria-label="Percent"><span class="input-suffix"><input class="input sm" type="number" min="0" max="100" value="${p.percent}" data-num aria-label="Percent"><span>%</span></span>
                <input class="input sm grow" data-note placeholder="Note (optional) — what did you do?" maxlength="2000"><button class="btn sm primary" type="submit">${icon('check', 'sm')} Save</button></form>` : ''}
              ${p.can_submit || p.can_review ? html`<div class="row wrap mt-2" style="gap:6px">${p.can_submit ? html`<button class="btn sm ${p.percent === 100 ? 'primary' : ''}" data-handin="${p.id}">${icon('send', 'sm')} Hand in (setor)</button>${p.submission === 'rejected' ? html`<span class="tiny text-danger">Sent back — see the history for what to change</span>` : ''}` : ''}
                ${p.can_review ? html`<button class="btn sm primary" data-review="${p.id}" data-ok="1">${icon('badge-check', 'sm')} Approve</button><button class="btn sm" data-review="${p.id}" data-ok="0">${icon('undo-2', 'sm')} Send back</button>` : ''}</div>` : ''}
            </div>`)}</div></div>
          <div class="card card-pad"><h3>${icon('history', 'sm')} History</h3>
            ${t.updates.length ? html`<ol class="pg-timeline">${t.updates.map((u) => html`<li class="pt-ev-${u.kind}"><span class="pg-tl-dot"></span><div class="grow" style="min-width:0">
              <div class="row wrap" style="gap:6px"><b>${u.user?.name || 'Someone'}</b><span class="small">${icon(KIND[u.kind][0], 'xs')} ${KIND[u.kind][1]}</span><span class="badge">${u.part_title || 'a part'}</span>
                ${u.kind === 'progress' ? html`<span class="pg-delta ${u.percent < u.percent_from ? 'down' : ''}">${u.percent_from}% → ${u.percent}%</span>` : ''}<span class="tiny subtle" title="${u.created_at}">${timeAgo(u.created_at)}</span></div>
              ${u.message ? html`<p class="pg-reason">${u.message}</p>` : ''}
              ${u.files.length || u.notes.length ? html`<div class="pt-handin">${u.files.map((f) => html`<button type="button" class="pt-chip" data-file="${f.id}">${fileBadge(f.name)}<span class="truncate">${f.name}</span></button>`)}${u.notes.map((n) => html`<a class="pt-chip" href="#/notes/${n.id}"><span class="in-ic">${icon('notebook-pen', 'xs')}</span><span class="truncate">${n.title}</span></a>`)}</div>` : ''}
            </div></li>`)}</ol>` : html`<p class="small subtle">Nothing yet — each person updates their own part.</p>`}</div>
        </div>
        <aside class="pg-side">
          ${t.description ? html`<div class="card card-pad"><h3>About</h3><p class="small" style="white-space:pre-wrap;margin:0">${t.description}</p></div>` : ''}
          ${t.deleted_at ? '' : html`<div class="card card-pad" data-pt-notes></div>`}
          ${t.files.length ? html`<div class="card card-pad"><h3>${icon('paperclip', 'sm')} Handed-in files <span class="subtle small">${t.files.length}</span></h3><div class="col" style="gap:6px">${t.files.map((f) => html`<button type="button" class="file-row pt-file" data-file="${f.id}">${fileBadge(f.name)}<div class="grow" style="min-width:0;text-align:left"><div class="truncate">${f.name}</div><div class="tiny subtle">${f.uploader?.name || ''} · ${timeAgo(f.created_at)}</div></div></button>`)}</div></div>` : ''}
        </aside></div></div>`);
    const notesEl = el.querySelector('[data-pt-notes]');
    if (notesEl) mountItemNotes(notesEl, { type: 'ptask', id, items: t.notes, canAdd: true, title: 'Notes', hint: 'Notes everyone on this task can open — plans, checklists, contacts.', onChange: (l) => (t.notes = l) });
  };
  paint();
  const reload = (next, msg) => { t = next; paint(); if (msg) toast(msg, 'success', { timeout: 1800 }); };
  el.addEventListener('input', (e) => {
    const f = e.target.closest('[data-update]');
    if (!f) return;
    if (e.target.matches('[data-range]')) f.querySelector('[data-num]').value = e.target.value;
    if (e.target.matches('[data-num]')) f.querySelector('[data-range]').value = Math.max(0, Math.min(100, +e.target.value || 0));
  });
  el.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-update]');
    if (!f) return;
    e.preventDefault();
    const n = f.querySelector('[data-num]');
    const v = n.value.trim();
    if (!/^\d+$/.test(v) || +v > 100) { n.classList.add('invalid'); return; }
    try { reload(await api.post(`ptasks/${id}/parts/${f.dataset.update}/progress`, { percent: +v, message: f.querySelector('[data-note]').value.trim() }), 'Saved'); } catch (err) { toastError(err); }
  });
  el.addEventListener('click', async (e) => {
    const hi = e.target.closest('[data-handin]');
    if (hi) { const r = await handIn(t, t.parts.find((p) => p.id === +hi.dataset.handin)); if (r) reload(r, 'Handed in — waiting for approval'); return; }
    const rv = e.target.closest('[data-review]');
    if (rv) { const ok = rv.dataset.ok === '1'; const r = await review(t, t.parts.find((p) => p.id === +rv.dataset.review), ok); if (r) reload(r, ok ? 'Approved' : 'Sent back'); return; }
    const fb = e.target.closest('[data-file]');
    if (fb) { const f = t.files.find((x) => x.id === +fb.dataset.file); if (f) openFilePreview(f, t.files); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'edit') { const r = await openEditor(t); if (r) reload(r, 'Saved'); }
    if (a === 'delete') {
      if (!(await confirm({ title: 'Delete this task?', message: 'Everyone on it loses access. You can restore it from Deleted.', confirmText: 'Delete' }))) return;
      try { await api.post(`ptasks/${id}/delete`); navigate('/tasks/progress'); toast('Deleted', 'success', { action: 'Undo', onAction: () => api.post(`ptasks/${id}/restore`).then(() => navigate(`/tasks/progress/${id}`)) }); } catch (err) { toastError(err); }
    }
    if (a === 'restore') { try { reload(await api.post(`ptasks/${id}/restore`), 'Restored'); } catch (err) { toastError(err); } }
  });
}

// ------------------------------------------------------------------ list
export default {
  title: 'Progress tasks',
  async render(el, ctx) {
    if (ctx.params.id) return renderDetail(el, ctx, +ctx.params.id);
    const f = { scope: ctx.query.scope || 'all', q: ctx.query.q || '' };
    el.innerHTML = String(html`
      <div class="page-head"><div><h1>Progress tasks</h1><p>For yourself or your team — everyone fills only their own bar, hand-ins are approved, until 100%.</p></div>
        <div class="row"><a class="btn" href="#/tasks">${icon('square-check-big', 'sm')}<span class="hide-sm">Tasks</span></a><a class="btn" href="#/progress" data-tip="Team progress for programmers">${icon('chart-no-axes-gantt', 'sm')}<span class="hide-sm">Team progress</span></a>
          <button class="btn primary" data-a="new">${icon('plus', 'sm')} New progress task</button></div></div>
      <div class="pt-summary" data-summary></div>
      <div class="toolbar"><div class="chips">${[['all', 'All', 'layers'], ['todo', 'My parts to do', 'user'], ['created', 'I manage', 'briefcase'], ['done', 'Completed', 'party-popper'], ['deleted', 'Deleted', 'trash-2']].map(([v, l, i]) => html`<button class="chip ${f.scope === v ? 'active' : ''}" data-scope="${v}">${icon(i, 'sm')} ${l}</button>`)}</div>
        <div class="grow"></div><div class="input-icon" style="width:min(240px,100%)">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search…" value="${f.q}" data-search></div></div>
      <div class="pt-grid" data-grid></div>`);
    const grid = el.querySelector('[data-grid]');
    async function load() {
      setQuery({ scope: f.scope !== 'all' ? f.scope : '', q: f.q });
      let r;
      try { r = await api.get('ptasks', f); } catch (e) { return toastError(e); }
      const s = r.summary;
      el.querySelector('[data-summary]').innerHTML = String(html`${s.my_open_parts ? html`<button class="pt-stat" data-scope="todo">${icon('user', 'sm')}<b>${s.my_open_parts}</b><span>part${s.my_open_parts === 1 ? '' : 's'} for you to fill</span></button>` : ''}
        ${s.waiting_review ? html`<button class="pt-stat warn" data-scope="created">${icon('hourglass', 'sm')}<b>${s.waiting_review}</b><span>hand-in${s.waiting_review === 1 ? '' : 's'} to approve</span></button>` : ''}`);
      grid.innerHTML = r.items.length ? r.items.map((t) => String(card(t))).join('')
        : String(empty({ icon: 'list-checks', title: f.scope === 'todo' ? 'Nothing for you to fill' : 'No progress tasks yet', text: 'Split a task into parts — for yourself or for your team — and follow each bar to 100%.', action: '<button class="btn primary" data-a="new">New progress task</button>' }));
    }
    el.addEventListener('click', async (e) => {
      const sc = e.target.closest('[data-scope]');
      if (sc) { f.scope = sc.dataset.scope; el.querySelectorAll('.chips [data-scope]').forEach((b) => b.classList.toggle('active', b.dataset.scope === f.scope)); return load(); }
      if (e.target.closest('[data-a="new"]')) { const r = await openEditor(); if (r) navigate(`/tasks/progress/${r.id}`); }
    });
    el.querySelector('[data-search]').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); load(); }, 300));
    await load();
  },
};
