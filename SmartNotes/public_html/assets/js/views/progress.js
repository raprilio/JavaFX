// Product progress (v1.19, renamed in v1.23 — was "Team progress"): work items followed from the first step to "published". Everyone sees every item;
// only the people chosen for an item post updates (percentage, stage, status and a reason). The creator or an
// administrator customises the item: stages, custom fields, who may update, priority, colour and dates.
import { html, icon, h, esc, debounce, timeAgo, fmtDay, fmtDateTime, todayStr } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { navigate, setQuery } from '../core/router.js';
import { toast, toastError, modal, confirm, avatarHtml, empty, menu } from '../core/ui.js';
import { userPicker } from '../components/userPicker.js';
import { sortable } from '../components/sortable.js';
import { mountItemNotes } from '../components/itemNotes.js';

const STATUS = {
  on_track: { label: 'On track', icon: 'circle-check', cls: 'success' },
  at_risk: { label: 'At risk', icon: 'triangle-alert', cls: 'warning' },
  blocked: { label: 'Blocked', icon: 'octagon-x', cls: 'danger' },
  done: { label: 'Published', icon: 'rocket', cls: 'info' },
};
const PRIORITY = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
const COLORS = ['', '#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b'];
/** Starting points for the stages and custom fields; everything stays editable. */
const TEMPLATES = {
  software: { label: 'Software feature', stages: [['Planning', 10], ['Design', 25], ['Development', 60], ['Testing', 80], ['Review', 90], ['Published', 100]], fields: ['Repository', 'Branch', 'Version', 'Environment'] },
  website: { label: 'Website', stages: [['Requirements', 10], ['UI design', 30], ['Front-end', 55], ['Back-end', 75], ['QA', 90], ['Live', 100]], fields: ['URL', 'Hosting', 'Staging URL'] },
  mobile: { label: 'Mobile app', stages: [['Planning', 10], ['UI / UX', 25], ['Development', 60], ['Testing', 80], ['Store review', 90], ['Published on store', 100]], fields: ['Platform', 'Version', 'Store link'] },
  bug: { label: 'Bug fix', stages: [['Reported', 10], ['Investigating', 30], ['Fixing', 60], ['Testing', 85], ['Released', 100]], fields: ['Ticket', 'Severity', 'Version'] },
  general: { label: 'General', stages: [['Started', 10], ['In progress', 50], ['Review', 80], ['Done', 100]], fields: [] },
};
const isUrl = (v) => /^https?:\/\/\S+$/i.test(v || '');
/** List order (v1.20); "custom" = my own order, arranged by dragging. */
const SORTS = [['smart', 'Smart (needs attention first)', 'sparkles'], ['updated', 'Recently updated', 'clock'], ['progress_desc', 'Progress: high → low', 'arrow-down-wide-narrow'],
  ['progress_asc', 'Progress: low → high', 'arrow-up-narrow-wide'], ['due', 'Target date', 'calendar'], ['priority', 'Priority', 'flag'], ['title', 'Title (A–Z)', 'arrow-down-a-z'],
  ['created', 'Newest first', 'calendar-plus'], ['custom', 'My order (drag to arrange)', 'grip-vertical']];
const PRIO_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
const isAdmin = () => state.user?.role === 'admin';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

function statusBadge(s) {
  const x = STATUS[s] || STATUS.on_track;
  return html`<span class="badge ${x.cls} pg-status">${icon(x.icon, 'sm')} ${x.label}</span>`;
}
/** Bar split into the item's stages; the filled part is the current percentage. */
function stageBar(it, big = false) {
  let prev = 0;
  return html`<div class="pg-bar ${big ? 'big' : ''}" style="--pc:${it.color || 'var(--accent)'}" role="progressbar" aria-valuenow="${it.percent}" aria-valuemin="0" aria-valuemax="100">
    <span class="pg-fill pg-${it.status}" style="width:${it.percent}%"></span>
    ${it.stages.slice(0, -1).map((s) => html`<i class="pg-tick" style="left:${s.percent}%"></i>`)}
    ${big ? it.stages.map((s) => { const from = prev; prev = s.percent; return html`<span class="pg-seg ${it.percent >= s.percent ? 'done' : it.percent > from ? 'now' : ''}" style="left:${from}%;width:${s.percent - from}%"><b>${s.name}</b><em>${s.percent}%</em></span>`; }) : ''}
  </div>`;
}
const people = (list, max = 4) => html`<span class="avatar-stack">${list.slice(0, max).map((u) => avatarHtml(u, 'sm'))}${list.length > max ? html`<span class="avatar sm more">+${list.length - max}</span>` : ''}</span>`;
function dueHtml(it) {
  if (!it.due_date) return '';
  const late = it.due_date < todayStr() && it.percent < 100;
  return html`<span class="${late ? 'overdue' : ''}">${icon('calendar', 'sm')} ${fmtDay(it.due_date)}${late ? ' · late' : ''}</span>`;
}

function card(it) {
  return html`<a class="pg-card ${it.deleted_at ? 'deleted' : ''} ${it.pinned || it.pinned_global ? 'pinned' : ''}" href="#/progress/${it.id}" style="--pc:${it.color || 'var(--accent)'}" data-id="${it.id}" draggable="false">
    ${it.pinned_global ? html`<span class="pg-pinned-by">${icon('megaphone', 'xs')} Pinned by ${it.pinned_by?.name || 'admin'} · for everyone</span>` : ''}
    <div class="pg-card-top"><b class="pg-title">${it.title}</b>
      ${it.deleted_at ? '' : html`<button type="button" class="btn ghost icon xs pg-pin ${it.pinned ? 'on' : ''}" data-pin="${it.id}" data-tip="${it.pinned ? 'Unpin' : 'Pin to top (only me)'}" aria-label="${it.pinned ? 'Unpin' : 'Pin'}">${icon(it.pinned ? 'pin-off' : 'pin', 'sm')}</button>`}
      <span class="pg-pct">${it.percent}%</span></div>
    ${stageBar(it)}
    <div class="pg-card-meta"><span class="pg-stage">${icon('milestone', 'sm')} ${it.stage || '—'}</span>${statusBadge(it.status)}
      ${it.priority === 'high' || it.priority === 'urgent' ? html`<span class="badge prio prio-${it.priority}">${icon('flag', 'sm')} ${PRIORITY[it.priority]}</span>` : ''}${dueHtml(it)}</div>
    ${it.last ? html`<p class="pg-last small"><b>${it.last.by || 'Someone'}</b> ${it.last.percent_from}% → ${it.last.percent}% · ${timeAgo(it.last.at)}<span class="truncate block subtle">${it.last.reason}</span></p>` : html`<p class="pg-last small subtle">No updates yet</p>`}
    <div class="pg-card-foot">${people(it.updaters)}<span class="tiny subtle">${it.can_update ? html`<span class="badge success">${icon('pencil', 'xs')} You update this</span>` : `by ${it.creator.name || '—'}`}</span></div>
  </a>`;
}

// ------------------------------------------------------------------ create / customise
async function openEditor(it = null) {
  const t0 = TEMPLATES.software;
  let stages = it ? it.stages.map((s) => ({ ...s })) : t0.stages.map(([name, percent]) => ({ name, percent }));
  let fields = it ? it.fields.map((f) => ({ ...f })) : t0.fields.map((label) => ({ label, value: '' }));
  let color = it?.color || '';
  const meIn = it ? it.updaters.some((u) => u.id === state.user.id) : true;
  const body = h(String(html`<form class="col pg-form" style="gap:12px" novalidate>
    <div class="field" style="margin:0"><label>Title</label><input class="input" name="title" maxlength="255" required value="${it?.title || ''}" placeholder="e.g. Login with Google · Checkout page · Fix #231"></div>
    <div class="field" style="margin:0"><label>Description</label><textarea class="textarea" name="description" rows="2" placeholder="What is being built and why">${it?.description || ''}</textarea></div>
    <div class="field" style="margin:0"><label>Template</label><div class="seg pg-tpls">${Object.entries(TEMPLATES).map(([k, v]) => html`<button type="button" class="btn xs" data-tpl="${k}">${v.label}</button>`)}</div><span class="hint">Fills in the stages and fields below — you can change them freely.</span></div>
    <div class="field" style="margin:0"><label>Stages from start to publish <span class="subtle">(% reached when the stage is finished)</span></label><div data-stages></div>
      <button type="button" class="btn xs mt-1" data-add-stage>${icon('plus', 'sm')} Add stage</button></div>
    <div class="field" style="margin:0"><label>Custom fields</label><div data-fields></div>
      <button type="button" class="btn xs mt-1" data-add-field>${icon('plus', 'sm')} Add field</button></div>
    <div class="field" style="margin:0"><label>Who can update the progress</label><div data-picker></div>
      <label class="check small mt-1"><input type="checkbox" name="me" ${meIn ? 'checked' : ''}> Me too</label>
      <span class="hint">Everyone can see the item; only these people can post progress.</span></div>
    <div class="form-grid"><div class="field" style="margin:0"><label>Priority</label><select class="select" name="priority">${Object.entries(PRIORITY).map(([k, l]) => html`<option value="${k}" ${(it?.priority || 'medium') === k ? 'selected' : ''}>${l}</option>`)}</select></div>
      <div class="field" style="margin:0"><label>Target date</label><input class="input" type="date" name="due_date" value="${it?.due_date || ''}"></div></div>
    <div class="field" style="margin:0"><label>Colour</label><div class="swatches" style="padding:0;grid-template-columns:repeat(11,26px)">${COLORS.map((c) => html`<button type="button" class="swatch ${color === c ? 'active' : ''}" data-color="${c}" style="--sw:${c || 'var(--bg-soft)'};width:26px;height:26px">${c ? '' : icon('slash', 'sm')}</button>`)}</div></div>
  </form>`));
  const picker = userPicker({ value: (it?.updaters || []).filter((u) => u.id !== state.user.id), placeholder: 'Type a name… (programmers, designers)' });
  body.querySelector('[data-picker]').appendChild(picker.el);
  const paintStages = () => {
    body.querySelector('[data-stages]').innerHTML = String(html`${stages.map((s, i) => html`<div class="pg-row" data-i="${i}">
      <span class="pg-num">${i + 1}</span><input class="input sm" data-sname value="${s.name}" placeholder="Stage name" maxlength="60">
      <span class="input-suffix"><input class="input sm" type="number" min="0" max="100" data-spct value="${s.percent}" ${i === stages.length - 1 ? 'readonly title="The last stage is always 100%"' : ''}><span>%</span></span>
      <button type="button" class="btn ghost icon xs" data-del-stage="${i}" aria-label="Remove stage" ${stages.length < 2 ? 'disabled' : ''}>${icon('x', 'sm')}</button></div>`)}`);
  };
  const paintFields = () => {
    body.querySelector('[data-fields]').innerHTML = fields.length ? String(html`${fields.map((f, i) => html`<div class="pg-row" data-i="${i}">
      <input class="input sm" data-flabel value="${f.label}" placeholder="Label (e.g. Repository)" maxlength="60" style="max-width:160px"><input class="input sm" data-fvalue value="${f.value}" placeholder="Value or link" maxlength="500">
      <button type="button" class="btn ghost icon xs" data-del-field="${i}" aria-label="Remove field">${icon('x', 'sm')}</button></div>`)}`) : '<p class="small subtle" style="margin:0">No custom fields.</p>';
  };
  paintStages(); paintFields();
  body.addEventListener('input', (e) => {
    const row = e.target.closest('.pg-row');
    if (!row) return;
    const i = +row.dataset.i;
    if (e.target.matches('[data-sname]')) stages[i].name = e.target.value;
    if (e.target.matches('[data-spct]')) stages[i].percent = Math.max(0, Math.min(100, +e.target.value || 0));
    if (e.target.matches('[data-flabel]')) fields[i].label = e.target.value;
    if (e.target.matches('[data-fvalue]')) fields[i].value = e.target.value;
  });
  body.addEventListener('click', (e) => {
    const tpl = e.target.closest('[data-tpl]');
    if (tpl) {
      const t = TEMPLATES[tpl.dataset.tpl];
      stages = t.stages.map(([name, percent]) => ({ name, percent }));
      const keep = new Map(fields.map((f) => [f.label, f.value]));
      fields = t.fields.map((label) => ({ label, value: keep.get(label) || '' }));
      paintStages(); paintFields();
      body.querySelectorAll('[data-tpl]').forEach((b) => b.classList.toggle('active', b === tpl));
    }
    if (e.target.closest('[data-add-stage]')) {
      const last = stages[stages.length - 1];
      const before = stages[stages.length - 2]?.percent ?? 0;
      stages.splice(stages.length - 1, 0, { name: '', percent: Math.round((before + last.percent) / 2) });
      paintStages();
      body.querySelectorAll('[data-sname]')[stages.length - 2]?.focus();
    }
    const ds = e.target.closest('[data-del-stage]');
    if (ds) { stages.splice(+ds.dataset.delStage, 1); paintStages(); }
    if (e.target.closest('[data-add-field]')) { fields.push({ label: '', value: '' }); paintFields(); body.querySelectorAll('[data-flabel]')[fields.length - 1]?.focus(); }
    const df = e.target.closest('[data-del-field]');
    if (df) { fields.splice(+df.dataset.delField, 1); paintFields(); }
    const sw = e.target.closest('[data-color]');
    if (sw) { color = sw.dataset.color; body.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('active', b === sw)); }
  });
  const m = modal({
    title: it ? 'Customise progress item' : 'New progress item', size: 'lg', body,
    actions: [{ label: 'Cancel', value: null }, {
      label: it ? 'Save' : 'Create', variant: 'primary', onClick: async (ctx) => {
        const f = new FormData(body);
        const title = String(f.get('title') || '').trim();
        if (!title) { body.querySelector('[name=title]').classList.add('invalid'); return false; }
        const ids = picker.get();
        if (f.get('me')) ids.unshift(state.user.id);
        if (!ids.length) { toast('Choose at least one person who can update the progress', 'warning'); return false; }
        const payload = {
          title, description: String(f.get('description') || ''), priority: f.get('priority'), due_date: f.get('due_date') || null, color: color || null,
          stages: stages.filter((s) => s.name.trim()), fields: fields.filter((x) => x.label.trim()), updater_ids: ids,
        };
        try {
          ctx.el.querySelector('.btn.primary').disabled = true;
          return await api.post(it ? `progress/${it.id}` : 'progress', payload);
        } catch (err) { toastError(err); ctx.el.querySelector('.btn.primary').disabled = false; return false; }
      },
    }],
    onOpen: () => setTimeout(() => { if (!body.contains(document.activeElement)) body.querySelector('[name=title]').focus(); }, 40), // never steal the focus from a field already in use
  });
  return m.result;
}

// ------------------------------------------------------------------ detail
function chartSvg(it) {
  // Percentage after every update, oldest first, evenly spaced (updates often come in bursts on one day).
  const ups = [...it.updates].reverse();
  if (!ups.length) return '';
  const pts = [{ p: ups[0].percent_from, s: 'start', at: it.start_date || it.created_at }, ...ups.map((u) => ({ p: u.percent, s: u.status, at: u.created_at }))];
  const W = 640, H = 160, L = 34, R = 10, T = 10, B = 22;
  const X = (i) => L + (i / pts.length) * (W - L - R), Y = (p) => T + (1 - p / 100) * (H - T - B);
  let d = `M${X(0)} ${Y(pts[0].p)}`;
  pts.slice(1).forEach((q, i) => { d += ` H${X(i + 1)} V${Y(q.p)}`; });
  d += ` H${X(pts.length)}`; // the current level runs on to today
  const area = `${d} V${Y(0)} H${X(0)} Z`;
  // Stage names on the left axis, skipping any that would overlap the one above.
  let lastY = -99;
  const marks = [...it.stages].reverse().filter((st) => { const y = Y(st.percent); if (y - lastY < 12) return false; lastY = y; return true; });
  const day = (v) => fmtDay(String(v).slice(0, 10));
  return html`<svg class="pg-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress over time">
    ${marks.map((st) => html`<line x1="${L}" x2="${W - R}" y1="${Y(st.percent)}" y2="${Y(st.percent)}" class="pg-grid"/><text x="${L - 6}" y="${Y(st.percent) + 3}" class="pg-gl pg-axis" text-anchor="end">${st.percent}%</text>`)}
    <path d="${area}" class="pg-area"/><path d="${d}" class="pg-line"/>
    ${pts.slice(1).map((q, i) => html`<circle cx="${X(i + 1)}" cy="${Y(q.p)}" r="4" class="pg-dot pg-${q.s}"><title>${q.p}% · ${day(q.at)}</title></circle>`)}
    <text x="${L}" y="${H - 6}" class="pg-gl">${day(pts[0].at)}</text><text x="${W - R}" y="${H - 6}" class="pg-gl" text-anchor="end">${day(pts[pts.length - 1].at)}</text></svg>`;
}

async function renderDetail(el, ctx, id) {
  let it;
  try { it = await api.get(`progress/${id}`); } catch (e) {
    el.innerHTML = String(html`<div class="content">${empty({ icon: 'chart-no-axes-gantt', title: 'Not found', text: e.message, action: '<a class="btn primary" href="#/progress">Back to Product progress</a>' })}</div>`);
    return;
  }
  const paint = () => {
    ctx.setTitle(it.title);
    const others = it.updaters.map((u) => u.name).join(', ');
    el.innerHTML = String(html`<div class="pg-detail" style="--pc:${it.color || 'var(--accent)'}">
      <div class="page-head"><div class="row" style="gap:10px;align-items:flex-start"><a class="btn ghost icon sm" href="#/progress" aria-label="Back">${icon('arrow-left')}</a>
        <div><h1 class="pg-h1">${it.title}</h1><p class="row wrap" style="gap:8px">${statusBadge(it.status)}<span class="badge prio prio-${it.priority}">${icon('flag', 'sm')} ${PRIORITY[it.priority]}</span>${dueHtml(it)}<span class="small subtle">by ${it.creator.name || '—'} · ${timeAgo(it.created_at)}</span>${it.pinned_global ? html`<span class="badge warning">${icon('megaphone', 'sm')} Pinned by ${it.pinned_by?.name || 'admin'} · for everyone</span>` : ''}${it.deleted_at ? html`<span class="badge danger">Deleted</span>` : ''}</p></div></div>
        <div class="row">${it.deleted_at ? '' : html`<button class="btn ${it.pinned ? 'active' : ''}" data-a="pin" data-tip="${it.pinned ? 'Unpin' : 'Pin to the top of my list'}">${icon(it.pinned ? 'pin-off' : 'pin', 'sm')}<span class="hide-sm">${it.pinned ? 'Pinned' : 'Pin'}</span></button>
          ${isAdmin() ? html`<button class="btn ${it.pinned_global ? 'active' : ''}" data-a="pin-global" data-tip="${it.pinned_global ? 'Unpin for everyone' : 'Pin on top for every user'}">${icon('megaphone', 'sm')}<span class="hide-sm">${it.pinned_global ? 'Pinned for all' : 'Pin for everyone'}</span></button>` : ''}`}
          ${it.can_manage ? (it.deleted_at ? html`<button class="btn" data-a="restore">${icon('rotate-ccw', 'sm')} Restore</button>`
          : html`<button class="btn" data-a="edit">${icon('settings-2', 'sm')}<span class="hide-sm">Customise</span></button><button class="btn ghost icon" data-a="delete" data-tip="Delete" aria-label="Delete">${icon('trash-2', 'sm')}</button>`) : ''}</div></div>
      <div class="card card-pad pg-hero"><div class="row between"><div><div class="pg-big">${it.percent}<small>%</small></div><div class="small muted">${it.percent === 100 ? html`Published ${it.published_at ? fmtDateTime(it.published_at) : ''}` : html`Stage: <b>${it.stage || '—'}</b>`}</div></div>
        <div class="right small muted">${people(it.updaters, 6)}<div class="mt-1">${it.last_update_at ? `Last update ${timeAgo(it.last_update_at)}` : 'No updates yet'}</div></div></div>
        ${stageBar(it, true)}</div>
      <div class="pg-cols">
        <div class="pg-main">
          ${it.can_update ? html`<form class="card card-pad pg-update" data-update novalidate><h3>${icon('trending-up', 'sm')} Update progress</h3>
            <div class="pg-range"><input type="range" min="0" max="100" step="1" value="${it.percent}" data-range aria-label="Percent"><span class="input-suffix"><input class="input sm" type="number" min="0" max="100" value="${it.percent}" data-num aria-label="Percent"><span>%</span></span></div>
            <div class="seg pg-stagepick">${it.stages.map((s) => html`<button type="button" class="btn xs ${s.name === it.stage ? 'active' : ''}" data-stage="${s.name}" data-pct="${s.percent}">${s.name} <span class="subtle">${s.percent}%</span></button>`)}</div>
            <div class="seg">${['on_track', 'at_risk', 'blocked'].map((k) => html`<button type="button" class="btn xs ${it.status === k || (it.status === 'done' && k === 'on_track') ? 'active' : ''}" data-status="${k}">${icon(STATUS[k].icon, 'sm')} ${STATUS[k].label}</button>`)}</div>
            <textarea class="textarea" rows="3" data-reason maxlength="2000" placeholder="Reason — what was done, or why the progress changed (required)"></textarea>
            <div class="row between"><span class="tiny subtle" data-hint></span><button class="btn primary" type="submit">${icon('send', 'sm')} Post update</button></div></form>`
            : it.deleted_at ? '' : html`<div class="card card-pad small muted pg-ro">${icon('lock', 'sm')} Only ${others || 'the chosen people'} can update this progress. Everyone can follow it here.</div>`}
          ${it.updates.length ? html`<div class="card card-pad"><h3>${icon('chart-line', 'sm')} Progress over time</h3>${chartSvg(it)}</div>` : ''}
          <div class="card card-pad"><h3>${icon('history', 'sm')} History <span class="subtle">${it.updates.length}</span></h3>
            ${it.updates.length ? html`<ol class="pg-timeline">${it.updates.map((u) => html`<li class="pg-${u.status}">
              <span class="pg-tl-dot"></span><div class="pg-tl-body"><div class="row wrap" style="gap:6px"><b>${u.user?.name || 'Former user'}</b>
                <span class="pg-delta ${u.percent < u.percent_from ? 'down' : ''}">${u.percent_from}% → ${u.percent}%</span><span class="badge">${u.stage || ''}</span>${statusBadge(u.status)}
                <span class="tiny subtle" title="${u.created_at}">${timeAgo(u.created_at)}</span></div>
                <p class="pg-reason">${u.reason}</p></div></li>`)}</ol>` : html`<p class="small subtle">No updates yet.</p>`}</div>
        </div>
        <aside class="pg-side">
          ${it.deleted_at ? '' : html`<div class="card card-pad pg-notes" data-pg-notes></div>`}
          ${it.description ? html`<div class="card card-pad"><h3>About</h3><p class="small" style="white-space:pre-wrap;margin:0">${it.description}</p></div>` : ''}
          ${it.fields.length ? html`<div class="card card-pad"><h3>Details</h3><dl class="kv small pg-kv">${it.fields.map((f) => html`<dt>${f.label}</dt><dd>${isUrl(f.value) ? html`<a href="${f.value}" target="_blank" rel="noopener noreferrer">${f.value.replace(/^https?:\/\//, '')}</a>` : f.value || '—'}</dd>`)}</dl></div>` : ''}
          <div class="card card-pad"><h3>Can update</h3>${it.updaters.map((u) => html`<div class="row pg-person">${avatarHtml(u, 'sm')}<span>${u.name}${u.id === state.user.id ? html` <span class="subtle">(you)</span>` : ''}</span></div>`)}</div>
          <div class="card card-pad small"><dl class="kv"><dt>Started</dt><dd>${it.start_date ? fmtDay(it.start_date) : '—'}</dd><dt>Target</dt><dd>${it.due_date ? fmtDay(it.due_date) : '—'}</dd><dt>Published</dt><dd>${it.published_at ? fmtDay(it.published_at.slice(0, 10)) : '—'}</dd></dl></div>
        </aside>
      </div></div>`);
    // v1.22: reference notes of the project — everyone opens them; creator / admin / updaters add them
    const notesEl = el.querySelector('[data-pg-notes]');
    if (notesEl) mountItemNotes(notesEl, { type: 'progress', id, items: it.notes || [], canAdd: !!it.can_add_notes, title: 'Reference notes', hint: it.can_add_notes ? 'List the notes this project follows — specs, designs, decisions. Everyone can open them.' : 'No reference notes yet.', onChange: (list) => (it.notes = list) });
  };
  paint();
  let pick = { stage: null, status: it.status === 'done' ? 'on_track' : it.status };
  el.addEventListener('input', (e) => {
    const f = el.querySelector('[data-update]');
    if (!f) return;
    if (e.target.matches('[data-range]')) f.querySelector('[data-num]').value = e.target.value;
    if (e.target.matches('[data-num]')) f.querySelector('[data-range]').value = e.target.value;
    if (e.target.matches('[data-range],[data-num]')) {
      pick.stage = null;
      const p = +e.target.value;
      const st = it.stages.find((s) => p <= s.percent) || it.stages[it.stages.length - 1];
      f.querySelectorAll('[data-stage]').forEach((b) => b.classList.toggle('active', b.dataset.stage === st.name));
      f.querySelector('[data-hint]').textContent = p === 100 ? '100% marks it as published 🚀' : `${it.percent}% → ${p}%`;
    }
  });
  el.addEventListener('click', async (e) => {
    const f = el.querySelector('[data-update]');
    const st = e.target.closest('[data-stage]');
    if (st && f) {
      pick.stage = st.dataset.stage;
      f.querySelector('[data-range]').value = f.querySelector('[data-num]').value = st.dataset.pct;
      f.querySelectorAll('[data-stage]').forEach((b) => b.classList.toggle('active', b === st));
      f.querySelector('[data-hint]').textContent = `${it.percent}% → ${st.dataset.pct}%`;
      return;
    }
    const ss = e.target.closest('[data-status]');
    if (ss && f) { pick.status = ss.dataset.status; f.querySelectorAll('[data-status]').forEach((b) => b.classList.toggle('active', b === ss)); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'edit') { const r = await openEditor(it); if (r) { it = r; paint(); toast('Saved', 'success', { timeout: 1200 }); } }
    if (a === 'delete') {
      if (!(await confirm({ title: `Delete "${it.title}"?`, message: 'It disappears for everyone. You (or an administrator) can restore it from Product progress → Deleted.', confirmText: 'Delete' }))) return;
      try { await api.post(`progress/${id}/delete`); toast('Deleted', 'success', { action: 'Undo', onAction: () => api.post(`progress/${id}/restore`).then(() => navigate(`/progress/${id}`)) }); navigate('/progress'); } catch (err) { toastError(err); }
    }
    if (a === 'pin' || a === 'pin-global') {
      const on = a === 'pin' ? !it.pinned : !it.pinned_global;
      try {
        it = await api.post(`progress/${id}/${a}`, { pinned: on });
        paint();
        toast(on ? (a === 'pin' ? 'Pinned to the top of your list' : 'Pinned for everyone') : 'Unpinned', 'success', { timeout: 1800 });
      } catch (err) { toastError(err); }
    }
    if (a === 'restore') { try { it = await api.post(`progress/${id}/restore`); paint(); toast('Restored', 'success'); } catch (err) { toastError(err); } }
  });
  el.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-update]');
    if (!f) return;
    e.preventDefault();
    const reason = f.querySelector('[data-reason]').value.trim();
    if (reason.length < 3) { f.querySelector('[data-reason]').classList.add('invalid'); f.querySelector('[data-reason]').focus(); return toast('Write the reason for this update', 'warning'); }
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      it = await api.post(`progress/${id}/updates`, { percent: +f.querySelector('[data-num]').value, stage: pick.stage, status: pick.status, reason });
      pick = { stage: null, status: it.status === 'done' ? 'on_track' : it.status };
      paint();
      toast(it.percent === 100 ? 'Published — 100% 🚀' : 'Progress updated', 'success', { timeout: 1600 });
    } catch (err) { toastError(err); btn.disabled = false; }
  });
}

// ------------------------------------------------------------------ list
function sortItems(list, sort, smartIdx) {
  const by = {
    smart: (a, b) => smartIdx.get(a.id) - smartIdx.get(b.id),
    updated: (a, b) => (b.last_update_at || b.created_at).localeCompare(a.last_update_at || a.created_at),
    progress_desc: (a, b) => b.percent - a.percent,
    progress_asc: (a, b) => a.percent - b.percent,
    due: (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'),
    priority: (a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority],
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    created: (a, b) => b.created_at.localeCompare(a.created_at),
    custom: (a, b) => (a.order_pos ?? 1e9) - (b.order_pos ?? 1e9),
  }[sort] || (() => 0);
  return [...list].sort((a, b) => by(a, b) || smartIdx.get(a.id) - smartIdx.get(b.id));
}

export default {
  title: 'Product progress',
  async render(el, ctx) {
    if (ctx.params.id) return renderDetail(el, ctx, +ctx.params.id);
    const f = { scope: ctx.query.scope || 'all', status: ctx.query.status || '', q: ctx.query.q || '', sort: ctx.query.sort || store.get('sn-pg-sort') || 'smart' };
    if (!SORTS.some(([k]) => k === f.sort)) f.sort = 'smart';
    el.innerHTML = String(html`
      <div class="page-head"><div><h1>Product progress</h1><p data-sub>Everyone can follow the work · only the chosen people post updates</p></div>
        <div class="row"><a class="btn" href="#/tasks">${icon('users-round', 'sm')}<span class="hide-sm">Team progress</span></a><a class="btn" href="#/tasks/mine">${icon('square-check-big', 'sm')}<span class="hide-sm">My tasks</span></a><button class="btn primary" data-a="new">${icon('plus', 'sm')} New item</button></div></div>
      <div class="pg-summary" data-summary></div>
      <div class="toolbar">
        <div class="chips" data-scopes>${[['all', 'All', 'layers'], ['pinned', 'Pinned', 'pin'], ['mine', 'I update', 'pencil'], ['created', 'Created by me', 'user'], ['published', 'Published', 'rocket'], ['deleted', 'Deleted', 'trash-2']].map(([v, l, i]) => html`<button class="chip ${f.scope === v ? 'active' : ''}" data-scope="${v}">${icon(i, 'sm')} ${l}</button>`)}</div>
        <div class="grow"></div>
        <div class="input-icon" style="width:min(240px,100%)">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search…" value="${f.q}" data-search></div>
        <button class="btn sm" data-a="sort">${icon('arrow-up-down', 'sm')} <span data-sort-label></span></button>
      </div>
      <div class="pg-list" data-list></div>`);
    const list = el.querySelector('[data-list]');
    let items = [];
    let smartIdx = new Map();
    const sortLabel = () => { el.querySelector('[data-sort-label]').textContent = SORTS.find(([k]) => k === f.sort)[1].replace(/ \(.*\)$/, ''); };
    sortLabel();

    function paint() {
      const touch = matchMedia('(pointer: coarse)').matches;
      const hint = touch ? 'hold & drag to move' : 'drag to move';
      const deleted = f.scope === 'deleted';
      const global = deleted ? [] : items.filter((it) => it.pinned_global).sort((a, b) => (a.pinned_global_pos ?? -1) - (b.pinned_global_pos ?? -1));
      const mine = deleted ? [] : items.filter((it) => !it.pinned_global && it.pinned).sort((a, b) => (a.pin_pos ?? -1) - (b.pin_pos ?? -1));
      const rest = sortItems(items.filter((it) => deleted || (!it.pinned_global && !it.pinned)), f.sort, smartIdx);
      if (!items.length) {
        list.innerHTML = String(empty({ icon: f.scope === 'pinned' ? 'pin' : 'chart-no-axes-gantt', title: f.scope === 'pinned' ? 'Nothing pinned yet' : f.scope === 'mine' ? 'Nothing assigned to you' : 'No progress items yet',
          text: f.scope === 'pinned' ? 'Use the pin on a card to keep it on top of your list.' : 'Create an item, choose who updates it, and follow it from planning to published.', action: '<button class="btn primary" data-a="new">New item</button>' }));
        return;
      }
      const head = (k, ic, label, n, can) => html`<div class="pg-sec-head ${k}">${icon(ic, 'sm')} ${label} <span class="subtle">${n}</span>${can ? html`<span class="pg-sec-hint">· ${hint}</span>` : ''}</div>`;
      const sections = [
        global.length && ['global', 'megaphone', 'Pinned for everyone', global, isAdmin()],
        mine.length && ['mine', 'pin', 'Pinned by me', mine, true],
        rest.length && ['rest', 'layers', global.length || mine.length ? 'Other items' : '', rest, f.sort === 'custom' && !deleted],
      ].filter(Boolean);
      list.innerHTML = sections.map(([k, ic, label, arr, can]) => (label ? String(head(k, ic, label, arr.length, can)) : '')
        + `<div class="pg-grid ${can ? 'can-drag' : ''}" data-sec="${k}">${arr.map((it) => String(card(it))).join('')}</div>`).join('');
    }

    async function load() {
      setQuery({ scope: f.scope !== 'all' ? f.scope : '', status: f.status, q: f.q, sort: f.sort !== 'smart' ? f.sort : '' });
      let r;
      try { r = await api.get('progress', { scope: f.scope, status: f.status, q: f.q }); } catch (e) { return toastError(e); }
      const s = r.summary || {};
      el.querySelector('[data-summary]').innerHTML = String(html`
        ${[['', 'In progress', s.total - s.published, 'layers'], ['on_track', 'On track', s.on_track, 'circle-check'], ['at_risk', 'At risk', s.at_risk, 'triangle-alert'], ['blocked', 'Blocked', s.blocked, 'octagon-x'], ['done', 'Published', s.published, 'rocket']]
          .map(([k, l, n, i]) => html`<button class="pg-stat ${k ? 'pg-' + k : ''} ${f.status === k && k ? 'active' : ''}" data-status-filter="${k}">${icon(i, 'sm')}<b>${n || 0}</b><span>${l}</span></button>`)}
        <div class="pg-stat avg"><b>${s.avg_percent || 0}%</b><span>Average</span></div>`);
      items = r.items;
      smartIdx = new Map(items.map((it, i) => [it.id, i]));
      paint();
    }

    async function togglePin(id) {
      const it = items.find((x) => x.id === id);
      if (!it) return;
      try {
        const r = await api.post(`progress/${id}/pin`, { pinned: !it.pinned });
        Object.assign(it, { pinned: r.pinned, pin_pos: r.pin_pos });
        if (f.scope === 'pinned' && !r.pinned && !r.pinned_global) items = items.filter((x) => x.id !== id);
        paint();
        toast(r.pinned ? 'Pinned to the top of your list' : 'Unpinned', 'success', { timeout: 1600 });
      } catch (e) { toastError(e); }
    }

    // Drag to arrange: my pins (anyone), the pins for everyone (administrators), the rest with Sort → My order.
    // Dropping a card into "Pinned by me" pins it; dragging one out of it unpins it.
    sortable(list, {
      item: '.pg-card', list: '.pg-grid', layout: 'grid', delay: 320,
      canDrag: (card) => card.closest('.pg-grid')?.classList.contains('can-drag') || (card.closest('[data-sec="rest"]') && !!list.querySelector('[data-sec="mine"]')),
      onDrop: async (card, toList, index, fromList) => {
        const id = +card.dataset.id;
        const from = fromList.dataset.sec, to = toList.dataset.sec;
        const ids = (sec) => Array.from(list.querySelectorAll(`[data-sec="${sec}"] .pg-card`)).map((c) => +c.dataset.id);
        try {
          if (from === to) {
            if (!toList.classList.contains('can-drag')) return paint();
            const order = ids(to);
            await api.post('progress/order', { section: to === 'rest' ? 'all' : to, ids: order });
            const key = to === 'global' ? 'pinned_global_pos' : to === 'mine' ? 'pin_pos' : 'order_pos';
            order.forEach((x, i) => { const it = items.find((y) => y.id === x); if (it) it[key] = i; });
            return paint();
          }
          if (to === 'mine' && from === 'rest') {
            const it = items.find((x) => x.id === id);
            await api.post(`progress/${id}/pin`, { pinned: true });
            it.pinned = true;
            const order = ids('mine');
            await api.post('progress/order', { section: 'mine', ids: order });
            order.forEach((x, i) => { const y = items.find((z) => z.id === x); if (y) y.pin_pos = i; });
            toast('Pinned to the top of your list', 'success', { timeout: 1600 });
            return paint();
          }
          if (from === 'mine' && to === 'rest') return togglePin(id);
          paint();
        } catch (e) { toastError(e); load(); }
      },
    });

    el.addEventListener('click', async (e) => {
      const pin = e.target.closest('[data-pin]');
      if (pin) { e.preventDefault(); e.stopPropagation(); return togglePin(+pin.dataset.pin); }
      const sc = e.target.closest('[data-scope]');
      if (sc) { f.scope = sc.dataset.scope; el.querySelectorAll('[data-scope]').forEach((b) => b.classList.toggle('active', b === sc)); return load(); }
      const sf = e.target.closest('[data-status-filter]');
      if (sf) { f.status = f.status === sf.dataset.statusFilter ? '' : sf.dataset.statusFilter; if (f.status === 'done') { f.status = ''; f.scope = 'published'; } return load(); }
      if (e.target.closest('[data-a="sort"]')) {
        return menu(e.target.closest('[data-a="sort"]'), SORTS.map(([k, l, i]) => ({ label: l, icon: i, checked: f.sort === k, onClick: () => {
          f.sort = k; store.set('sn-pg-sort', k); sortLabel();
          setQuery({ scope: f.scope !== 'all' ? f.scope : '', status: f.status, q: f.q, sort: k !== 'smart' ? k : '' });
          paint();
          if (k === 'custom') toast(matchMedia('(pointer: coarse)').matches ? 'Hold a card, then drag it to its place' : 'Drag the cards into the order you like', 'info', { timeout: 2600 });
        } })), { align: 'end' });
      }
      if (e.target.closest('[data-a="new"]')) { const r = await openEditor(); if (r) navigate(`/progress/${r.id}`); }
    });
    el.querySelector('[data-search]').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); load(); }, 300));
    await load();
    void esc;
  },
};
