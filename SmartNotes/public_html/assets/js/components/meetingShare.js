// Share a meeting with specific users, or with every user (administrators only). Recipients get read-only access.
import { html, icon, h, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { modal, toast, toastError, avatarHtml } from '../core/ui.js';

export async function openMeetingShare(meeting) {
  let shares = meeting.shares || { all: false, users: [] };
  let people = [];
  const chosen = new Set();
  const isAdmin = state.user.role === 'admin';
  const body = h(String(html`<div class="col" style="gap:14px">
    <label class="share-all ${isAdmin ? '' : 'disabled'}">
      <span class="share-all-ic">${icon('globe', 'sm')}</span>
      <span class="grow"><b>All users</b><span class="tiny subtle" style="display:block">${isAdmin ? 'Everyone with an account sees this meeting in their calendar and gets its reminder — including users added later.' : 'Only administrators can share a meeting with every user.'}</span></span>
      <input type="checkbox" class="switch-input" data-all ${shares.all ? 'checked' : ''} ${isAdmin ? '' : 'disabled'}>
    </label>
    <div data-specific>
      <div class="label mb-1">People with access</div><div data-list></div>
      <div class="label mb-1 mt-2">Add people</div>
      <div class="input-icon mb-2">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search by name or e-mail" data-q></div>
      <div class="user-pick" data-people><div style="padding:16px;text-align:center"><span class="spinner"></span></div></div>
      <div class="row mt-2"><div class="grow"></div><button class="btn primary sm" data-add disabled>${icon('send', 'sm')} Share</button></div>
    </div>
    <p class="tiny subtle">People you share with can see the meeting, agenda, participants, meeting notes and attachments, and get the reminder. Only you can edit it.</p>
  </div>`));
  const listEl = body.querySelector('[data-list]');
  const peopleEl = body.querySelector('[data-people]');
  const addBtn = body.querySelector('[data-add]');
  let changed = false;

  const paint = () => {
    body.querySelector('[data-specific]').classList.toggle('dim', shares.all);
    listEl.innerHTML = shares.users.length ? shares.users.map((u) => String(html`<div class="share-row" data-uid="${u.id}">
      ${avatarHtml({ name: u.name }, 'sm')}<div class="grow" style="min-width:0"><div class="truncate" style="font-weight:600">${u.name}</div><div class="tiny subtle truncate">${u.email}</div></div>
      <button class="btn ghost icon sm" data-remove aria-label="Remove">${icon('x', 'sm')}</button></div>`)).join('')
      : `<p class="small subtle">${shares.all ? 'Shared with everyone.' : 'Only you can see this meeting.'}</p>`;
    const ids = new Set(shares.users.map((u) => u.id));
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
    const id = +e.target.value;
    if (e.target.checked) chosen.add(id); else chosen.delete(id);
    addBtn.disabled = !chosen.size;
  });
  body.querySelector('[data-all]').addEventListener('change', async (e) => {
    try {
      shares = await api.post(`meetings/${meeting.id}/shares`, { all: e.target.checked });
      changed = true;
      toast(e.target.checked ? 'Shared with all users' : 'No longer shared with everyone', 'success');
      paint();
    } catch (err) { e.target.checked = !e.target.checked; toastError(err); }
  });
  addBtn.addEventListener('click', async () => {
    try {
      shares = await api.post(`meetings/${meeting.id}/shares`, { user_ids: [...chosen] });
      toast(`Shared with ${chosen.size} ${chosen.size === 1 ? 'person' : 'people'}`, 'success');
      chosen.clear();
      changed = true;
      paint();
    } catch (err) { toastError(err); }
  });
  listEl.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-remove]')?.closest('[data-uid]');
    if (!row) return;
    try {
      shares = await api.post(`meetings/${meeting.id}/shares/${row.dataset.uid}/remove`);
      changed = true;
      paint();
    } catch (err) { toastError(err); }
  });
  paint();
  loadPeople();
  await modal({ title: 'Share meeting', body, size: 'sm', className: 'share-modal', actions: [{ label: 'Done', variant: 'primary' }] }).result;
  return changed ? shares : null;
}
