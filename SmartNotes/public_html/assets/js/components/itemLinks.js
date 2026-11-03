// "Linked from Drive & progress" on a meeting or a calendar event (v1.31): pick files that are already in Drive (no
// new upload), Product progress items and Team progress tasks, so the documents and the work discussed sit together.
// Everyone who can see the meeting / event adds links and opens them; a Team progress task only opens for its people.
import { html, icon, h, timeAgo, debounce, fileBadge } from '../core/dom.js';
import { api } from '../core/api.js';
import { navigate } from '../core/router.js';
import { toast, toastError, modal, menu, empty } from '../core/ui.js';
import { openFilePreview } from './filePreview.js';

const KINDS = {
  file: { label: 'File from Drive', icon: 'hard-drive', search: 'Search your Drive files…', empty: 'No files in your Drive yet — upload them in Drive first.' },
  progress: { label: 'Product progress', icon: 'chart-no-axes-gantt', search: 'Search Product progress…', empty: 'No Product progress items yet.' },
  ptask: { label: 'Team progress', icon: 'users-round', search: 'Search your Team progress tasks…', empty: 'You are not on any Team progress task yet.' },
};

/** Choose a file / progress item / team task to link. Resolves with the picked id or null. */
function pick(type, id, kind) {
  const k = KINDS[kind];
  const body = h(String(html`<div class="col" style="gap:10px">
    <div class="input-icon">${icon('search', 'sm')}<input class="input" type="search" placeholder="${k.search}" data-q></div>
    <div class="np-list" data-list><div class="skeleton" style="height:56px;border-radius:12px"></div></div></div>`));
  const m = modal({ title: `Link ${k.label.toLowerCase()}`, body, size: 'sm', actions: [{ label: 'Cancel' }], onOpen: () => body.querySelector('[data-q]').focus() });
  const load = async (q = '') => {
    try {
      const list = await api.get(`item-links/${type}/${id}/candidates`, { kind, q });
      body.querySelector('[data-list]').innerHTML = list.length ? list.map((x) => String(html`<button type="button" class="np-item" data-id="${x.id}" ${x.linked ? 'disabled' : ''}>
        ${kind === 'file' ? (x.file.kind === 'image' && x.file.thumb_url ? html`<img class="il-thumb" src="${x.file.thumb_url}" alt="" loading="lazy">` : fileBadge(x.title)) : html`<span class="np-ic">${icon(k.icon, 'sm')}</span>`}
        <span class="grow" style="min-width:0"><b class="truncate block">${x.title}</b><span class="tiny subtle truncate block">${x.linked ? 'Already linked' : kind === 'file' ? `${x.mine ? 'My Drive' : 'Shared with me'} · ${timeAgo(x.file.created_at)}` : `${x.percent}%`}</span></span></button>`)).join('')
        : String(empty({ icon: 'search-x', title: q ? 'Nothing found' : k.empty, text: q ? 'Try another word.' : '' }));
    } catch (e) { toastError(e); }
  };
  body.querySelector('[data-q]').addEventListener('input', debounce((e) => load(e.target.value.trim()), 250));
  body.addEventListener('click', (e) => { const b = e.target.closest('.np-item:not([disabled])'); if (b) m.close(+b.dataset.id); });
  load();
  return m.result.then((v) => (typeof v === 'number' ? v : null));
}

/**
 * @param {HTMLElement} el
 * @param {{type:'meeting'|'event', id:number, items:Array, canAdd?:boolean, onChange?:(list:Array)=>void}} o
 */
export function mountItemLinks(el, o) {
  let items = [...(o.items || [])];
  const row = (x) => {
    const pct = x.type !== 'file' ? html`<span class="il-pct" style="--c:${x.color || 'var(--accent)'}"><i style="width:${x.percent}%"></i></span><b class="tiny">${x.percent}%</b>` : '';
    return html`<div class="in-row il-row ${x.type !== 'file' && !x.can_open ? 'locked' : ''}" data-il="${x.type}:${x.id}" role="link" tabindex="0">
      ${x.type === 'file' ? (x.file.kind === 'image' && x.file.thumb_url ? html`<img class="il-thumb" src="${x.file.thumb_url}" alt="" loading="lazy">` : fileBadge(x.title)) : html`<span class="in-ic">${icon(KINDS[x.type].icon, 'sm')}</span>`}
      <span class="grow" style="min-width:0"><b class="truncate block">${x.title}</b>
        <span class="tiny subtle truncate block">${KINDS[x.type].label}${x.type === 'file' && x.file.uploader?.name ? ` · ${x.file.uploader.name}` : ''}${x.added_by ? ` · linked by ${x.added_by.name}` : ''} · ${timeAgo(x.added_at)}${x.type === 'ptask' && !x.can_open ? ' · only its team can open it' : ''}</span></span>
      ${pct}
      ${x.can_remove ? html`<button type="button" class="btn ghost icon xs" data-il-remove="${x.type}:${x.id}" data-tip="Remove the link (the item itself stays)" aria-label="Remove link">${icon('x', 'sm')}</button>` : ''}</div>`;
  };
  const paint = () => {
    el.innerHTML = String(html`<div class="row between mb-2"><div class="section-title" style="margin:0">${icon('link-2', 'sm')} Linked from Drive & progress <span class="subtle small">${items.length || ''}</span></div>
        ${o.canAdd !== false ? html`<button type="button" class="btn sm" data-il-add>${icon('plus', 'sm')} Link</button>` : ''}</div>
      ${items.length ? html`<div class="in-list">${items.map(row)}</div>`
        : html`<p class="small subtle" style="margin:0">Link files that are already in Drive, Product progress items or Team progress tasks — no need to upload again.</p>`}`);
  };
  const set = (list) => { items = list; o.onChange?.(items); paint(); };
  el.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-il-add]');
    if (add) {
      return menu(add, Object.entries(KINDS).map(([k, v]) => ({ label: v.label, icon: v.icon, onClick: async () => {
        const tid = await pick(o.type, o.id, k);
        if (!tid) return;
        try { set(await api.post(`item-links/${o.type}/${o.id}`, { target_type: k, target_id: tid })); toast('Linked', 'success', { timeout: 1400 }); } catch (err) { toastError(err); }
      } })), { align: 'end' });
    }
    const rm = e.target.closest('[data-il-remove]');
    if (rm) {
      e.stopPropagation();
      const [k, tid] = rm.dataset.ilRemove.split(':');
      try { set(await api.post(`item-links/${o.type}/${o.id}/${k}/${tid}/remove`)); toast('Link removed', 'success', { timeout: 1400 }); } catch (err) { toastError(err); }
      return;
    }
    const r = e.target.closest('[data-il]');
    if (!r) return;
    const [k, tid] = r.dataset.il.split(':');
    const x = items.find((y) => y.type === k && y.id === +tid);
    if (!x) return;
    if (k === 'file') return openFilePreview(x.file, items.filter((y) => y.type === 'file').map((y) => y.file));
    if (!x.can_open) return toast('Only the people on this Team progress task can open it', 'info', { timeout: 2200 });
    navigate(x.link.replace(/^#/, ''));
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-il]')) e.target.click(); });
  paint();
}
