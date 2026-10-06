// Share a note with specific users (view / edit).
import { html, icon, h, debounce, timeAgo } from '../core/dom.js';
import { api } from '../core/api.js';
import { modal, toast, toastError, avatarHtml } from '../core/ui.js';

export async function openShareDialog(note) {
  let shares = note.shares || [];
  let people = [];
  const chosen = new Set();
  const body = h(String(html`<div class="col" style="gap:14px">
    <div><div class="label mb-1">People with access</div><div data-list></div></div>
    <div><div class="label mb-1">Add people</div>
      <div class="input-icon mb-2">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search by name or e-mail" data-q></div>
      <div class="user-pick" data-people><div style="padding:16px;text-align:center"><span class="spinner"></span></div></div>
      <div class="row mt-2"><label class="small">Permission</label><select class="select sm" style="width:auto" data-perm><option value="view">Can view</option><option value="edit">Can edit text</option></select>
        <div class="grow"></div><button class="btn primary sm" data-add disabled>${icon('send', 'sm')} Share</button></div>
      <p class="tiny subtle mt-1">Recipients get an in-app notification (and an e-mail when SMTP is configured). They can pin the note for themselves. Editors can change the title & text only; category, tags, colour and deletion stay with you.</p></div>
  </div>`));
  const listEl = body.querySelector('[data-list]');
  const peopleEl = body.querySelector('[data-people]');
  const addBtn = body.querySelector('[data-add]');

  const paintShares = () => {
    listEl.innerHTML = shares.length ? shares.map((s) => String(html`<div class="share-row" data-uid="${s.user_id}">
      ${avatarHtml({ name: s.name, avatar_url: s.avatar_url }, 'sm')}
      <div class="grow" style="min-width:0"><div class="truncate" style="font-weight:600">${s.name}</div><div class="tiny subtle truncate">${s.email}${s.last_opened_at ? ` · opened ${timeAgo(s.last_opened_at)}` : ' · not opened yet'}</div></div>
      <select class="select sm" style="width:auto" data-change><option value="view" ${s.permission === 'view' ? 'selected' : ''}>Can view</option><option value="edit" ${s.permission === 'edit' ? 'selected' : ''}>Can edit</option></select>
      <button class="btn ghost icon sm" data-remove aria-label="Remove">${icon('x', 'sm')}</button></div>`)).join('')
      : '<p class="small subtle">Only you can see this note.</p>';
  };
  const paintPeople = () => {
    const ids = new Set(shares.map((s) => s.user_id));
    const list = people.filter((p) => !ids.has(p.id));
    peopleEl.innerHTML = list.length ? list.map((p) => String(html`<label><input type="checkbox" value="${p.id}" ${chosen.has(p.id) ? 'checked' : ''}>
      ${avatarHtml(p, 'sm')}<div class="grow" style="min-width:0"><div class="truncate" style="font-weight:560">${p.name}</div><div class="tiny subtle truncate">${p.email}${p.job_title ? ' · ' + p.job_title : ''}</div></div></label>`)).join('')
      : '<p class="small subtle" style="padding:12px">No other users found.</p>';
    addBtn.disabled = !chosen.size;
  };
  const loadPeople = async (q = '') => {
    try { people = await api.get('users/directory', { q }); paintPeople(); }
    catch (e) { peopleEl.innerHTML = `<p class="small" style="padding:12px;color:var(--danger)">${e.message}</p>`; }
  };

  const m = modal({ title: 'Share note', body, size: 'lg', actions: [{ label: 'Done', variant: 'primary', value: true }] });
  paintShares();
  loadPeople();
  body.querySelector('[data-q]').addEventListener('input', debounce((e) => loadPeople(e.target.value.trim()), 250));
  peopleEl.addEventListener('change', (e) => {
    const id = +e.target.value;
    e.target.checked ? chosen.add(id) : chosen.delete(id);
    addBtn.disabled = !chosen.size;
  });
  addBtn.addEventListener('click', async () => {
    addBtn.classList.add('loading');
    try {
      const r = await api.post(`notes/${note.id}/shares`, { user_ids: [...chosen], permission: body.querySelector('[data-perm]').value });
      shares = r.shares;
      chosen.clear();
      paintShares();
      paintPeople();
      toast(`Shared with ${r.added} ${r.added === 1 ? 'person' : 'people'}`, 'success');
    } catch (e) { toastError(e); } finally { addBtn.classList.remove('loading'); }
  });
  listEl.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-change]')) return;
    const uid = +e.target.closest('[data-uid]').dataset.uid;
    try { shares = (await api.post(`notes/${note.id}/shares`, { user_ids: [uid], permission: e.target.value })).shares; toast('Permission updated', 'success', { timeout: 1500 }); } catch (err) { toastError(err); }
  });
  listEl.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-remove]')) return;
    const uid = +e.target.closest('[data-uid]').dataset.uid;
    try { shares = (await api.post(`notes/${note.id}/shares/${uid}/remove`)).shares; paintShares(); paintPeople(); toast('Access removed', 'success', { timeout: 1500 }); } catch (err) { toastError(err); }
  });
  await m.result;
  return shares;
}
