// Trash / recycle bin: restore or permanently delete any item type.
import { html, icon, timeAgo, fmtDay } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, toastError, confirm, empty, skeletonRows } from '../core/ui.js';

const META = {
  note: ['notebook-pen', 'Note'], task: ['square-check-big', 'Task'], event: ['calendar-days', 'Event'], meeting: ['users', 'Meeting'],
  mindmap: ['network', 'Mind map'], flowchart: ['workflow', 'Flowchart'], audio: ['mic', 'Recording'], file: ['paperclip', 'File'],
};

export default {
  title: 'Trash',
  async render(el) {
    let items = [];
    let filter = '';
    el.innerHTML = String(html`
      <div class="page-head"><div><h1>Trash</h1><p data-sub>Deleted items are kept here until you remove them permanently.</p></div>
        <button class="btn danger" data-act="empty">${icon('trash-2', 'sm')} Empty trash</button></div>
      <div class="toolbar"><div class="chips" data-chips></div></div>
      <div data-list>${skeletonRows(5)}</div>`);
    const list = el.querySelector('[data-list]');

    async function load() {
      try {
        const r = await api.get('trash');
        items = r.items;
        el.querySelector('[data-sub]').textContent = r.auto_delete_days
          ? `Items are permanently deleted automatically after ${r.auto_delete_days} days.`
          : 'Deleted items are kept here until you remove them permanently.';
        paint();
      } catch (e) { toastError(e); }
    }
    function paint() {
      const counts = {};
      items.forEach((i) => (counts[i.type] = (counts[i.type] || 0) + 1));
      el.querySelector('[data-chips]').innerHTML = String(html`<button class="chip ${!filter ? 'active' : ''}" data-f="">All <span class="subtle">${items.length}</span></button>
        ${Object.entries(counts).map(([t, c]) => html`<button class="chip ${filter === t ? 'active' : ''}" data-f="${t}">${icon(META[t][0], 'sm')} ${META[t][1]}s <span class="subtle">${c}</span></button>`)}`);
      el.querySelector('[data-act="empty"]').disabled = !items.length;
      const shown = filter ? items.filter((i) => i.type === filter) : items;
      list.innerHTML = shown.length ? String(html`<div class="card"><div class="card-body list" style="padding:8px">${shown.map((i) => html`
        <div class="list-item" data-type="${i.type}" data-id="${i.id}" style="cursor:default">
          <span class="li-icon">${icon(META[i.type][0], 'sm')}</span>
          <div class="li-main"><div class="li-title">${i.title || '(Untitled)'}</div><div class="li-sub">${META[i.type][1]} · deleted ${timeAgo(i.deleted_at)}${i.purge_at ? ` · auto-deletes ${fmtDay(i.purge_at)}` : ''}</div></div>
          <button class="btn sm" data-a="restore">${icon('rotate-ccw', 'sm')}<span class="hide-sm">Restore</span></button>
          <button class="btn ghost sm danger-text" data-a="destroy" data-tip="Delete forever">${icon('x', 'sm')}</button></div>`)}</div></div>`)
        : String(empty({ icon: 'trash-2', title: 'Trash is empty', text: 'Deleted notes, tasks, events, meetings, mind maps, flowcharts, recordings and files appear here.' }));
    }
    el.addEventListener('click', async (e) => {
      const chip = e.target.closest('[data-f]');
      if (chip) { filter = chip.dataset.f; return paint(); }
      if (e.target.closest('[data-act="empty"]')) {
        if (!(await confirm({ title: 'Empty trash?', message: `All ${items.length} item(s) will be permanently deleted, including their files. This cannot be undone.`, confirmText: 'Delete forever' }))) return;
        try { const r = await api.post('trash/empty'); toast(`${r.count} item(s) permanently deleted`, 'success'); load(); } catch (err) { toastError(err); }
        return;
      }
      const a = e.target.closest('[data-a]')?.dataset.a;
      const row = e.target.closest('[data-id]');
      if (!a || !row) return;
      const { type, id } = row.dataset;
      if (a === 'restore') {
        try { await api.post(`items/${type}/${id}/restore`); toast(`${META[type][1]} restored`, 'success'); load(); } catch (err) { toastError(err); }
      } else if (a === 'destroy') {
        if (!(await confirm({ title: 'Delete forever?', message: 'This item and its stored files will be permanently removed. This cannot be undone.', confirmText: 'Delete forever' }))) return;
        try { await api.post(`items/${type}/${id}/destroy`); toast('Permanently deleted', 'success'); load(); } catch (err) { toastError(err); }
      }
    });
    await load();
  },
};
