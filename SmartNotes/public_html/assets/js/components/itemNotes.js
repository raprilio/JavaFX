// Notes listed on an item (v1.22): reference notes of a Team progress item, discussion notes of a meeting and the
// notes of a progress task. Clicking one opens it (read-only for everyone but its owner). The picker searches the
// notes I can read: my own and the ones shared with me.
import { html, icon, h, timeAgo, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { navigate } from '../core/router.js';
import { toast, toastError, modal, confirm, empty } from '../core/ui.js';

/** Choose one of my notes (or one shared with me). Resolves with the note or null. */
export function pickNote({ title = 'Choose a note', exclude = [] } = {}) {
  const skip = new Set(exclude);
  const body = h(String(html`<div class="col" style="gap:10px">
    <div class="input-icon">${icon('search', 'sm')}<input class="input" type="search" placeholder="Search your notes…" data-q></div>
    <div class="np-list" data-list><div class="skeleton" style="height:56px;border-radius:12px"></div></div>
    <p class="tiny subtle" style="margin:0">Others can open the note read-only from here. Locked notes cannot be listed.</p></div>`));
  const m = modal({ title, body, size: 'sm', actions: [{ label: 'Cancel' }], onOpen: () => body.querySelector('[data-q]').focus() });
  let items = [];
  const load = async (q = '') => {
    try {
      const r = await api.get('notes', { filter: 'all', q, per_page: 40, sort: 'updated' });
      items = r.items.filter((n) => !skip.has(n.id));
      body.querySelector('[data-list]').innerHTML = items.length ? items.map((n) => String(html`<button type="button" class="np-item" data-id="${n.id}" ${n.is_locked ? 'disabled' : ''}>
        <span class="np-ic">${icon(n.is_locked ? 'lock' : 'notebook-pen', 'sm')}</span>
        <span class="grow" style="min-width:0"><b class="truncate block">${n.title || 'Untitled'}</b><span class="tiny subtle truncate block">${n.is_locked ? 'Locked — remove the lock to list it' : (n.excerpt || '').slice(0, 90) || '—'}</span></span>
        ${n.owner_id && n.owner_id !== undefined && n.shared ? html`<span class="badge info">${n.owner_name}</span>` : ''}</button>`)).join('')
        : String(empty({ icon: 'search-x', title: q ? 'No matching notes' : 'No notes yet', text: q ? 'Try another word.' : 'Create a note first, then list it here.' }));
    } catch (e) { toastError(e); }
  };
  body.querySelector('[data-q]').addEventListener('input', debounce((e) => load(e.target.value.trim()), 250));
  body.addEventListener('click', (e) => {
    const b = e.target.closest('.np-item:not([disabled])');
    if (b) m.close(items.find((n) => n.id === +b.dataset.id));
  });
  load();
  return m.result.then((v) => (v && typeof v === 'object' && v.id ? v : null));
}

/**
 * Mount the notes list of an item.
 * @param {HTMLElement} el
 * @param {{type: 'progress'|'meeting'|'ptask', id: number, items: Array, canAdd: boolean, title?: string, hint?: string, onChange?: Function}} o
 */
export function mountItemNotes(el, o) {
  let items = [...(o.items || [])];
  const paint = () => {
    el.innerHTML = String(html`<div class="row between mb-2"><div class="section-title" style="margin:0">${icon('notebook-text', 'sm')} ${o.title || 'Notes'} <span class="subtle small">${items.length || ''}</span></div>
        ${o.canAdd ? html`<button type="button" class="btn sm" data-in-add data-tip="Add a note">${icon('plus', 'sm')} Add</button>` : ''}</div>
      ${items.length ? html`<div class="in-list">${items.map((n) => html`<div class="in-row" data-note="${n.id}" role="link" tabindex="0" data-nc="${n.color || ''}">
          <span class="in-ic">${icon(n.locked ? 'lock' : 'notebook-pen', 'sm')}</span>
          <span class="grow" style="min-width:0"><b class="truncate block">${n.title}</b><span class="tiny subtle truncate block">${n.excerpt || ''}</span>
            <span class="tiny subtle block">${n.owner.name}${n.added_by && n.added_by.id !== n.owner.id ? ` · added by ${n.added_by.name}` : ''} · ${timeAgo(n.updated_at)}</span></span>
          ${n.can_remove ? html`<button type="button" class="btn ghost icon xs" data-in-remove="${n.id}" data-tip="Remove from the list" aria-label="Remove">${icon('x', 'sm')}</button>` : ''}
          <span class="in-open">${icon('chevron-right', 'sm')}</span></div>`)}</div>`
        : html`<p class="small subtle" style="margin:0">${o.hint || 'No notes yet.'}</p>`}`);
  };
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-in-add]')) {
      const n = await pickNote({ title: `Add a note — ${o.title || 'Notes'}`, exclude: items.map((x) => x.id) });
      if (!n) return;
      try {
        items = await api.post(`links/${o.type}/${o.id}/notes`, { note_id: n.id });
        paint();
        o.onChange?.(items);
        toast(`"${n.title || 'Untitled'}" added`, 'success', { timeout: 1600 });
      } catch (err) { toastError(err); }
      return;
    }
    const rm = e.target.closest('[data-in-remove]');
    if (rm) {
      const n = items.find((x) => x.id === +rm.dataset.inRemove);
      if (!(await confirm({ title: 'Remove this note from the list?', message: `"${n.title}" itself is not deleted.`, confirmText: 'Remove' }))) return;
      try { items = await api.post(`links/${o.type}/${o.id}/notes/${n.id}/remove`); paint(); o.onChange?.(items); } catch (err) { toastError(err); }
      return;
    }
    const row = e.target.closest('[data-note]');
    if (row) navigate(`/notes/${row.dataset.note}`);
  });
  el.addEventListener('keydown', (e) => { const row = e.target.closest('[data-note]'); if (row && e.key === 'Enter') navigate(`/notes/${row.dataset.note}`); });
  paint();
  return { get: () => items };
}
