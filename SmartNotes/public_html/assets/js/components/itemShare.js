// Share an audio recording, mind map, flowchart, Drive file or folder with specific users.
import { html, icon, h, debounce, timeAgo } from '../core/dom.js';
import { api } from '../core/api.js';
import { modal, toast, toastError, avatarHtml } from '../core/ui.js';

const LABELS = { audio: 'recording', mindmap: 'mind map', flowchart: 'flowchart', file: 'file', folder: 'folder' };
const HELP = {
  audio: 'People you share with can play and download the recording.',
  mindmap: 'Viewers can look and make their own copy. Editors can change the map; if two people save at the same time, the second one is asked to reload.',
  flowchart: 'Viewers can look and make their own copy. Editors can change the chart; if two people save at the same time, the second one is asked to reload.',
  file: 'People you share with can preview and download the file. Only you can rename, move or delete it.',
  folder: 'People you share with can open this folder and everything inside it (including sub-folders and files added later). Only you can change it.',
};

/** @returns {Promise<number|null>} the new number of people it is shared with, or null when nothing changed */
export async function openItemShare({ type, id, title = '' }) {
  let shares = [];
  let perms = ['view'];
  let people = [];
  let changed = false;
  const chosen = new Set();
  try {
    const r = await api.get(`shares/${type}/${id}`);
    shares = r.shares;
    perms = r.perms;
  } catch (e) { toastError(e); return null; }
  const canEdit = perms.includes('edit');
  const body = h(String(html`<div class="col" style="gap:14px">
    ${title ? html`<div class="share-item-title">${icon({ audio: 'mic', mindmap: 'network', flowchart: 'workflow', file: 'file', folder: 'folder' }[type], 'sm')}<b class="truncate">${title}</b></div>` : ''}
    <div><div class="label mb-1">People with access</div><div data-list></div></div>
    <div><div class="label mb-1">Add people</div>
      <div class="input-icon mb-2">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search by name or e-mail" data-q></div>
      <div class="user-pick" data-people><div style="padding:16px;text-align:center"><span class="spinner"></span></div></div>
      <div class="row mt-2">${canEdit ? html`<select class="select sm" style="width:auto" data-perm><option value="view">Can view</option><option value="edit">Can edit</option></select>` : html`<span class="small subtle">${icon('eye', 'sm')} View only</span>`}
        <div class="grow"></div><button class="btn primary sm" data-add disabled>${icon('send', 'sm')} Share</button></div>
      <p class="tiny subtle mt-1">${HELP[type]} Recipients get a notification (and an e-mail when SMTP is set up).</p></div>
  </div>`));
  const listEl = body.querySelector('[data-list]');
  const peopleEl = body.querySelector('[data-people]');
  const addBtn = body.querySelector('[data-add]');
  const paint = () => {
    listEl.innerHTML = shares.length ? shares.map((s) => String(html`<div class="share-row" data-uid="${s.user_id}">
      ${avatarHtml({ name: s.name, avatar_url: s.avatar_url }, 'sm')}
      <div class="grow" style="min-width:0"><div class="truncate" style="font-weight:600">${s.name}</div><div class="tiny subtle truncate">${s.email} · since ${timeAgo(s.created_at)}</div></div>
      ${canEdit ? html`<select class="select sm" style="width:auto" data-change><option value="view" ${s.permission === 'view' ? 'selected' : ''}>Can view</option><option value="edit" ${s.permission === 'edit' ? 'selected' : ''}>Can edit</option></select>` : ''}
      <button class="btn ghost icon sm" data-remove aria-label="Remove">${icon('x', 'sm')}</button></div>`)).join('')
      : `<p class="small subtle">Only you can see this ${LABELS[type]}.</p>`;
    const ids = new Set(shares.map((s) => s.user_id));
    const list = people.filter((p) => !ids.has(p.id));
    peopleEl.innerHTML = list.length ? list.map((p) => String(html`<label><input type="checkbox" value="${p.id}" ${chosen.has(p.id) ? 'checked' : ''}>
      ${avatarHtml(p, 'sm')}<div class="grow" style="min-width:0"><div class="truncate" style="font-weight:560">${p.name}</div><div class="tiny subtle truncate">${p.email}${p.job_title ? ' · ' + p.job_title : ''}</div></div></label>`)).join('')
      : '<p class="small subtle" style="padding:12px">No other users found.</p>';
    addBtn.disabled = !chosen.size;
  };
  const loadPeople = async (q = '') => {
    try { people = await api.get('users/directory', { q }); paint(); } catch (e) { toastError(e); }
  };
  body.querySelector('[data-q]').addEventListener('input', debounce((e) => loadPeople(e.target.value.trim()), 300));
  peopleEl.addEventListener('change', (e) => {
    const uid = +e.target.value;
    if (e.target.checked) chosen.add(uid); else chosen.delete(uid);
    addBtn.disabled = !chosen.size;
  });
  addBtn.addEventListener('click', async () => {
    try {
      const r = await api.post(`shares/${type}/${id}`, { user_ids: [...chosen], permission: body.querySelector('[data-perm]')?.value || 'view' });
      shares = r.shares;
      toast(`Shared with ${chosen.size} ${chosen.size === 1 ? 'person' : 'people'}`, 'success');
      chosen.clear();
      changed = true;
      paint();
    } catch (err) { toastError(err); }
  });
  listEl.addEventListener('change', async (e) => {
    const row = e.target.closest('[data-uid]');
    if (!row || !e.target.matches('[data-change]')) return;
    try { shares = (await api.post(`shares/${type}/${id}`, { user_ids: [+row.dataset.uid], permission: e.target.value })).shares; changed = true; toast('Access updated', 'success', { timeout: 1500 }); } catch (err) { toastError(err); }
  });
  listEl.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-remove]')?.closest('[data-uid]');
    if (!row) return;
    try { shares = (await api.post(`shares/${type}/${id}/${row.dataset.uid}/remove`)).shares; changed = true; paint(); } catch (err) { toastError(err); }
  });
  paint();
  loadPeople();
  await modal({ title: `Share ${LABELS[type]}`, body, size: 'sm', className: 'share-modal', actions: [{ label: 'Done', variant: 'primary' }] }).result;
  return changed ? shares.length : null;
}

/** Remove an item someone shared with me from my lists. */
export async function leaveShared(type, id) {
  await api.post(`shares/${type}/${id}/leave`);
  toast('Removed from your shared items', 'success');
}
