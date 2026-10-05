// Notes list: filters, search, sort, grid/list, infinite scroll, quick actions, bulk actions, drag & drop images.
import { html, icon, timeAgo, debounce, esc, h, raw } from '../core/dom.js';
import { api } from '../core/api.js';
import { state, emit } from '../core/store.js';
import { navigate, setQuery } from '../core/router.js';
import { toast, toastError, menu, contextMenu, colorPicker, confirm, empty, skeletonCards } from '../core/ui.js';
import { newNote } from '../core/actions.js';
import { uploadFile } from '../components/attachments.js';

const FILTERS = [['all', 'All notes', 'notebook'], ['pinned', 'Pinned', 'pin'], ['favorite', 'Favorites', 'star'], ['recent', 'Recent', 'history'], ['archived', 'Archived', 'archive']];
const TYPE_ICON = { checklist: 'list-checks', image: 'image', audio: 'mic', mixed: 'layers', rich: 'type', text: 'file-text' };

function card(n, selecting, selected) {
  const cat = state.categories.note.find((c) => c.id === n.category_id);
  return html`<article class="note-card ${selected ? 'selected' : ''}" data-id="${n.id}" data-nc="${n.color || ''}" tabindex="0">
    <label class="nc-select" ${selecting ? '' : raw('hidden')}><input type="checkbox" ${selected ? 'checked' : ''} data-select></label>
    ${n.cover_id ? html`<div class="nc-cover" style="background-image:url('api/index.php?route=files/${n.cover_id}/thumb')"></div>` : ''}
    <div class="nc-main">
      ${n.is_pinned ? html`<span class="nc-pin">${icon('pin', 'sm')}</span>` : ''}
      ${n.title ? html`<h3>${n.title}</h3>` : ''}
      <div class="nc-body">${n.excerpt || (n.title ? '' : 'Empty note')}</div>
      <div class="nc-meta">
        ${n.checklist_total ? html`<span class="badge ${n.checklist_done === n.checklist_total ? 'success' : ''}">${icon('list-checks', 'sm')} ${n.checklist_done}/${n.checklist_total}</span>` : ''}
        ${cat ? html`<span class="badge"><span class="dot" style="width:7px;height:7px;border-radius:50%;background:${cat.color}"></span>${cat.name}</span>` : ''}
        ${n.tags.slice(0, 3).map((t) => html`<span class="tag">#${t}</span>`)}
        ${n.attachment_count ? html`<span>${icon('paperclip', 'sm')}${n.attachment_count}</span>` : ''}
        ${n.audio_count ? html`<span>${icon('mic', 'sm')}${n.audio_count}</span>` : ''}
        ${n.is_favorite ? html`<span style="color:var(--warning)">${icon('star', 'sm')}</span>` : ''}
        <span style="margin-left:auto" title="${n.updated_at}">${icon(TYPE_ICON[n.note_type] || 'file-text', 'sm')} ${timeAgo(n.updated_at)}</span>
      </div>
    </div>
    <div class="nc-actions">
      <button class="btn ghost icon xs" data-a="pin" data-tip="${n.is_pinned ? 'Unpin' : 'Pin'}">${icon(n.is_pinned ? 'pin-off' : 'pin', 'sm')}</button>
      <button class="btn ghost icon xs" data-a="favorite" data-tip="${n.is_favorite ? 'Unfavorite' : 'Favorite'}">${icon('star', 'sm')}</button>
      <button class="btn ghost icon xs" data-a="color" data-tip="Color">${icon('palette', 'sm')}</button>
      <button class="btn ghost icon xs" data-a="archive" data-tip="${n.is_archived ? 'Unarchive' : 'Archive'}">${icon(n.is_archived ? 'archive-restore' : 'archive', 'sm')}</button>
      <button class="btn ghost icon xs" data-a="more" data-tip="More">${icon('more-horizontal', 'sm')}</button>
    </div>
  </article>`;
}

export default {
  title: 'Notes',
  async render(el, ctx) {
    const q0 = ctx.query;
    const f = {
      filter: q0.filter || 'all', category: q0.category || '', tag: q0.tag || '', q: q0.q || '', sort: q0.sort || 'updated',
      view: state.settings?.notes_view || 'grid',
    };
    let items = [], page = 1, total = 0, loading = false, done = false;
    let selecting = false;
    const selected = new Set();
    const cat = state.categories.note.find((c) => String(c.id) === String(f.category));
    ctx.setTitle(cat ? cat.name : 'Notes');

    el.innerHTML = String(html`
      <div class="page-head"><div><h1>${cat ? html`<span class="dot" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${cat.color};margin-right:6px"></span>${cat.name}` : 'Notes'}</h1><p data-count>&nbsp;</p></div>
        <div class="row"><div class="btn-group" data-view>
          <button class="btn ${f.view === 'grid' ? 'active' : ''}" data-v="grid" data-tip="Grid">${icon('layout-grid', 'sm')}</button>
          <button class="btn ${f.view === 'list' ? 'active' : ''}" data-v="list" data-tip="List">${icon('list', 'sm')}</button></div>
          <button class="btn" data-act="select">${icon('square-check', 'sm')}<span class="hide-sm">Select</span></button>
          <button class="btn primary" data-act="new">${icon('plus', 'sm')} New note</button></div></div>
      <div class="toolbar">
        <div class="chips" data-filters>${FILTERS.map(([v, l, i]) => html`<button class="chip ${f.filter === v ? 'active' : ''}" data-f="${v}">${icon(i, 'sm')} ${l}</button>`)}</div>
        <div class="grow"></div>
        <div class="input-icon" style="width:min(260px,100%)">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search notes…" value="${f.q}" data-search></div>
        <button class="btn sm" data-act="category">${icon('folder', 'sm')} <span data-cat-label>${cat ? cat.name : 'Category'}</span></button>
        <button class="btn sm" data-act="tag">${icon('hash', 'sm')} <span>${f.tag ? '#' + f.tag : 'Tag'}</span></button>
        <button class="btn sm" data-act="sort">${icon('arrow-up-down', 'sm')} <span class="hide-sm">Sort</span></button>
      </div>
      <div class="drop-wrap" style="position:relative">
        <div class="drop-hint">${icon('image-plus', 'lg')}&nbsp; Drop images to create an image note</div>
        <div class="notes-grid ${f.view === 'list' ? 'list-mode' : ''}" data-grid>${skeletonCards(8)}</div>
        <div data-sentinel style="height:40px"></div>
      </div>
      <button class="fab" data-act="new" aria-label="New note">${icon('plus', 'lg')}</button>`);

    const grid = el.querySelector('[data-grid]');
    const sentinel = el.querySelector('[data-sentinel]');
    const sync = () => setQuery({ filter: f.filter !== 'all' ? f.filter : '', category: f.category, tag: f.tag, q: f.q, sort: f.sort !== 'updated' ? f.sort : '' });

    async function load(reset = false) {
      if (loading || (done && !reset)) return;
      loading = true;
      if (reset) { page = 1; done = false; items = []; }
      try {
        const r = await api.get('notes', { filter: f.filter, category: f.category, tag: f.tag, q: f.q, sort: f.sort, dir: f.sort === 'title' ? 'asc' : 'desc', page, per_page: 40 });
        total = r.total;
        items = reset ? r.items : items.concat(r.items);
        done = items.length >= total || !r.items.length;
        page++;
        paint();
      } catch (e) { toastError(e); } finally { loading = false; }
    }

    function paint() {
      el.querySelector('[data-count]').textContent = `${total} note${total === 1 ? '' : 's'}${f.q ? ` matching “${f.q}”` : ''}`;
      grid.classList.toggle('selecting', selecting);
      if (!items.length) {
        const msg = f.q ? ['search-x', 'No matching notes', 'Try a different keyword or clear the filters.']
          : f.filter === 'archived' ? ['archive', 'No archived notes', 'Archived notes are kept out of your main list.']
            : f.filter === 'pinned' ? ['pin', 'No pinned notes', 'Pin important notes to keep them on top.']
              : f.filter === 'favorite' ? ['star', 'No favorites yet', 'Star the notes you use most.']
                : ['notebook-pen', 'Capture your first idea', 'Notes support rich text, checklists, images, audio and attachments.'];
        grid.innerHTML = String(empty({ icon: msg[0], title: msg[1], text: msg[2], action: '<button class="btn primary" data-act="new">New note</button>' }));
        grid.style.columns = '1';
        return;
      }
      grid.style.columns = '';
      grid.innerHTML = items.map((n) => String(card(n, selecting, selected.has(n.id)))).join('');
      renderBulk();
    }

    function renderBulk() {
      el.querySelector('.bulk-bar')?.remove();
      if (!selecting || !selected.size) return;
      const bar = h(String(html`<div class="bulk-bar"><b style="margin-right:8px">${selected.size} selected</b>
        <button class="btn ghost sm" data-b="pin">${icon('pin', 'sm')} Pin</button>
        <button class="btn ghost sm" data-b="${f.filter === 'archived' ? 'unarchive' : 'archive'}">${icon('archive', 'sm')} ${f.filter === 'archived' ? 'Unarchive' : 'Archive'}</button>
        <button class="btn ghost sm" data-b="category">${icon('folder', 'sm')} Move</button>
        <button class="btn ghost sm" data-b="color">${icon('palette', 'sm')}</button>
        <button class="btn ghost sm" data-b="trash">${icon('trash-2', 'sm')} Delete</button>
        <button class="btn ghost icon sm" data-b="close">${icon('x', 'sm')}</button></div>`));
      el.appendChild(bar);
      bar.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-b]')?.dataset.b;
        if (!b) return;
        if (b === 'close') { selecting = false; selected.clear(); return paint(); }
        const ids = [...selected];
        const run = async (action, extra = {}) => {
          try {
            await api.post('notes/bulk', { ids, action, ...extra });
            toast(`${ids.length} note(s) updated`, 'success');
            selected.clear(); selecting = false;
            load(true);
          } catch (err) { toastError(err); }
        };
        if (b === 'category') {
          return menu(e.target.closest('[data-b]'), [{ label: 'No category', icon: 'folder-x', onClick: () => run('category', { category_id: null }) },
            ...state.categories.note.map((c) => ({ label: c.name, icon: 'folder', onClick: () => run('category', { category_id: c.id }) }))]);
        }
        if (b === 'color') return colorPicker(e.target.closest('[data-b]'), null, (color) => run('color', { color }));
        if (b === 'trash' && !(await confirm({ title: `Delete ${ids.length} note(s)?`, message: 'They will be moved to the trash.', confirmText: 'Delete' }))) return;
        run(b);
      });
    }

    async function update(n, data, msg) {
      try {
        const r = await api.post(`notes/${n.id}`, data);
        Object.assign(n, { is_pinned: r.is_pinned, is_favorite: r.is_favorite, is_archived: r.is_archived, color: r.color, category_id: r.category_id });
        if ('is_archived' in data && (f.filter === 'archived') !== !!data.is_archived) items = items.filter((x) => x.id !== n.id);
        if ('is_pinned' in data && f.filter === 'pinned' && !data.is_pinned) items = items.filter((x) => x.id !== n.id);
        if ('is_favorite' in data && f.filter === 'favorite' && !data.is_favorite) items = items.filter((x) => x.id !== n.id);
        if ('is_pinned' in data && f.filter === 'all') items.sort((a, b) => (b.is_pinned - a.is_pinned) || (b.updated_at > a.updated_at ? 1 : -1));
        paint();
        if (msg) toast(msg, 'success', data.is_archived ? { action: 'Undo', onAction: () => update(n, { is_archived: false }) } : {});
      } catch (e) { toastError(e); }
    }

    async function trash(n) {
      try {
        await api.post(`items/note/${n.id}/trash`);
        items = items.filter((x) => x.id !== n.id);
        total--;
        paint();
        emit('notes:changed');
        toast('Note moved to trash', 'success', {
          action: 'Undo',
          onAction: async () => { await api.post(`items/note/${n.id}/restore`); load(true); },
        });
      } catch (e) { toastError(e); }
    }

    function moreMenu(anchor, n) {
      const items2 = [
        { label: 'Open', icon: 'square-arrow-out-up-right', onClick: () => navigate(`/notes/${n.id}`) },
        { label: n.is_pinned ? 'Unpin' : 'Pin to top', icon: 'pin', onClick: () => update(n, { is_pinned: !n.is_pinned }) },
        { label: n.is_favorite ? 'Remove from favorites' : 'Add to favorites', icon: 'star', onClick: () => update(n, { is_favorite: !n.is_favorite }) },
        { label: n.is_archived ? 'Unarchive' : 'Archive', icon: 'archive', onClick: () => update(n, { is_archived: !n.is_archived }, n.is_archived ? 'Note restored from archive' : 'Note archived') },
        { label: 'Duplicate', icon: 'copy', onClick: async () => { try { await api.post(`notes/${n.id}/duplicate`); toast('Note duplicated', 'success'); load(true); } catch (e) { toastError(e); } } },
        { label: 'Move to category', icon: 'folder', onClick: () => menu(anchor, [{ label: 'No category', icon: 'folder-x', onClick: () => update(n, { category_id: null }, 'Category removed') }, ...state.categories.note.map((c) => ({ label: c.name, icon: 'folder', checked: c.id === n.category_id, onClick: () => update(n, { category_id: c.id }, `Moved to ${c.name}`) }))]) },
        { divider: true },
        { label: 'Move to trash', icon: 'trash-2', danger: true, onClick: () => trash(n) },
      ];
      return anchor instanceof Event ? contextMenu(anchor, items2) : menu(anchor, items2, { align: 'end' });
    }

    el.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'new') return newNote(f.category ? { category_id: +f.category } : {});
      if (act === 'select') { selecting = !selecting; selected.clear(); return paint(); }
      if (act === 'category') {
        return menu(e.target.closest('[data-act]'), [
          { label: 'All categories', icon: 'layers', checked: !f.category, onClick: () => { navigate('/notes' + (f.filter !== 'all' ? `?filter=${f.filter}` : '')); } },
          { label: 'Uncategorized', icon: 'folder-x', checked: f.category === 'none', onClick: () => { f.category = 'none'; sync(); load(true); } },
          { divider: true },
          ...state.categories.note.map((c) => ({ label: `${c.name} (${c.count})`, icon: 'folder', checked: String(c.id) === String(f.category), onClick: () => navigate(`/notes?category=${c.id}`) })),
          { divider: true }, { label: 'Manage categories', icon: 'settings-2', onClick: () => navigate('/settings/categories') },
        ]);
      }
      if (act === 'tag') {
        const t = e.target.closest('[data-act]');
        return menu(t, [{ label: 'All tags', icon: 'hash', checked: !f.tag, onClick: () => { f.tag = ''; t.querySelector('span').textContent = 'Tag'; sync(); load(true); } },
          ...(state.tags.length ? [{ divider: true }] : [{ title: 'No tags yet — add tags inside a note' }]),
          ...state.tags.map((tg) => ({ label: `#${tg.name}`, checked: f.tag === tg.name, onClick: () => { f.tag = tg.name; t.querySelector('span').textContent = '#' + tg.name; sync(); load(true); } }))]);
      }
      if (act === 'sort') {
        return menu(e.target.closest('[data-act]'), [['updated', 'Last modified', 'clock'], ['created', 'Date created', 'calendar-plus'], ['opened', 'Last opened', 'eye'], ['title', 'Title (A–Z)', 'arrow-down-a-z']]
          .map(([v, l, i]) => ({ label: l, icon: i, checked: f.sort === v, onClick: () => { f.sort = v; sync(); load(true); } })));
      }
      const chip = e.target.closest('[data-f]');
      if (chip) {
        f.filter = chip.dataset.f;
        el.querySelectorAll('[data-f]').forEach((c) => c.classList.toggle('active', c === chip));
        sync();
        return load(true);
      }
      const v = e.target.closest('[data-v]');
      if (v) {
        f.view = v.dataset.v;
        el.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('active', b === v));
        grid.classList.toggle('list-mode', f.view === 'list');
        state.settings.notes_view = f.view;
        api.post('profile/settings', { notes_view: f.view }).catch(() => {});
        return;
      }
      const cardEl = e.target.closest('.note-card');
      if (!cardEl) return;
      const n = items.find((x) => x.id === +cardEl.dataset.id);
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (selecting || e.target.closest('[data-select]') || e.ctrlKey || e.metaKey) {
        if (!selecting) { selecting = true; }
        selected.has(n.id) ? selected.delete(n.id) : selected.add(n.id);
        if (e.target.matches('[data-select]')) e.preventDefault();
        return paint();
      }
      if (a === 'pin') return update(n, { is_pinned: !n.is_pinned }, n.is_pinned ? 'Unpinned' : 'Pinned to top');
      if (a === 'favorite') return update(n, { is_favorite: !n.is_favorite }, n.is_favorite ? 'Removed from favorites' : 'Added to favorites');
      if (a === 'archive') return update(n, { is_archived: !n.is_archived }, n.is_archived ? 'Note unarchived' : 'Note archived');
      if (a === 'color') return colorPicker(e.target.closest('[data-a]'), n.color, (c) => update(n, { color: c }));
      if (a === 'more') return moreMenu(e.target.closest('[data-a]'), n);
      if (f.filter === 'trash') return;
      navigate(`/notes/${n.id}`);
    });
    el.addEventListener('keydown', (e) => {
      const c = e.target.closest('.note-card');
      if (c && e.key === 'Enter') navigate(`/notes/${c.dataset.id}`);
    });
    el.addEventListener('contextmenu', (e) => {
      const c = e.target.closest('.note-card');
      if (!c) return;
      const n = items.find((x) => x.id === +c.dataset.id);
      if (n) moreMenu(e, n);
    });
    const search = debounce(() => { sync(); load(true); }, 300);
    el.querySelector('[data-search]').addEventListener('input', (e) => { f.q = e.target.value.trim(); search(); });

    // Drag & drop images => new image note
    const wrap = el.querySelector('.drop-wrap');
    let dragDepth = 0;
    wrap.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; wrap.classList.add('dragging-file'); } });
    wrap.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; wrap.classList.remove('dragging-file'); } });
    wrap.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    wrap.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragDepth = 0;
      wrap.classList.remove('dragging-file');
      const files = Array.from(e.dataTransfer?.files || []).filter((x) => /^image\/(jpeg|png|webp)$/.test(x.type));
      if (!files.length) return toast('Only JPG, PNG or WEBP images can be dropped here.', 'warning');
      try {
        const n = await api.post('notes', { title: files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : 'Image note' });
        const t = toast(`Uploading ${files.length} image(s)…`, 'info', { timeout: 60000 });
        const imgs = [];
        for (const file of files) {
          const up = await uploadFile(file, { note_id: n.id, accept: 'image' });
          imgs.push(`<img src="api/index.php?route=files/${up.id}/raw" data-file-id="${up.id}" alt="${esc(up.name)}">`);
        }
        await api.post(`notes/${n.id}`, { content: imgs.join('') + '<p><br></p>' });
        t();
        navigate(`/notes/${n.id}`);
      } catch (err) { toastError(err); }
    });

    const io = new IntersectionObserver((ents) => { if (ents[0].isIntersecting && items.length) load(); }, { rootMargin: '400px' });
    io.observe(sentinel);
    await load(true);
    return () => { io.disconnect(); el.querySelector('.bulk-bar')?.remove(); };
  },
};
