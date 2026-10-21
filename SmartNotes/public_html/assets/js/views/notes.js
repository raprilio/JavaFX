// Notes list: filters, search, sort, grid/list, infinite scroll, quick actions, bulk actions, drag & drop images.
import { html, icon, timeAgo, debounce, esc, h, raw } from '../core/dom.js';
import { api } from '../core/api.js';
import { state, emit, can } from '../core/store.js';
import { navigate, setQuery } from '../core/router.js';
import { toast, toastError, menu, contextMenu, colorPicker, confirm, empty, skeletonCards } from '../core/ui.js';
import { newNote } from '../core/actions.js';
import { uploadFile } from '../components/attachments.js';
import { toggleNoteLock, lockNow } from '../components/notePin.js';
import { sortable } from '../components/sortable.js';
import { openPinPeople } from '../components/notePinPeople.js';

const FILTERS = [['all', 'All notes', 'notebook'], ['pinned', 'Pinned', 'pin'], ['favorite', 'Favorites', 'star'], ['shared', 'Shared with me', 'users'], ['shared_by_me', 'Shared by me', 'share-2'], ['recent', 'Recent', 'history'], ['archived', 'Archived', 'archive']];
const TYPE_ICON = { checklist: 'list-checks', image: 'image', audio: 'mic', mixed: 'layers', rich: 'type', text: 'file-text' };

// Someone else's note in my list: shared with me, or pinned by an admin for everyone (read-only).
const othersNote = (n) => !!n.owner_id && n.owner_id !== state.user.id;

function card(n, selecting, selected) {
  const cat = state.categories.note.find((c) => c.id === n.category_id);
  const others = othersNote(n);
  return html`<article class="note-card ${selected ? 'selected' : ''}" data-id="${n.id}" data-nc="${n.color || ''}" tabindex="0">
    <label class="nc-select" ${selecting ? '' : raw('hidden')}><input type="checkbox" ${selected ? 'checked' : ''} data-select></label>
    ${n.cover_id ? html`<div class="nc-cover" style="background-image:url('api/index.php?route=files/${n.cover_id}/thumb')"></div>` : n.drawing_id ? html`<div class="nc-cover nc-ink" style="background-image:url('api/index.php?route=drawings/${n.drawing_id}/png&v=${n.drawing_v}')"></div>` : ''}
    <div class="nc-main">
      ${n.pinned_global ? html`<span class="nc-pin global" data-tip="Pinned by admin for everyone">${icon('megaphone', 'sm')}</span>` : n.pinned_for_me ? html`<span class="nc-pin people" data-tip="Pinned for you by ${n.pinned_by_name || 'an administrator'}">${icon('pin', 'sm')}</span>` : n.is_pinned ? html`<span class="nc-pin" data-tip="Pinned by you">${icon('pin', 'sm')}</span>` : ''}
      ${n.title ? html`<h3>${n.title}</h3>` : ''}
      ${n.locked ? html`<div class="nc-body nc-locked">${icon('lock', 'sm')} Locked — PIN required</div>` : html`<div class="nc-body">${n.excerpt || (n.title ? '' : 'Empty note')}</div>`}
      <div class="nc-meta">
        ${n.checklist_total ? html`<span class="badge ${n.checklist_done === n.checklist_total ? 'success' : ''}">${icon('list-checks', 'sm')} ${n.checklist_done}/${n.checklist_total}</span>` : ''}
        ${cat ? html`<span class="badge"><span class="dot" style="width:7px;height:7px;border-radius:50%;background:${cat.color}"></span>${cat.name}</span>` : ''}
        ${n.tags.slice(0, 3).map((t) => html`<span class="tag">#${t}</span>`)}
        ${(n.mentions || []).length ? html`<span class="nc-people" title="${n.mentions.map((p) => '@' + p.name).join(', ')}">${icon('at-sign', 'sm')}${n.mentions.slice(0, 2).map((p) => (p.id === state.user.id ? 'Me' : p.name.split(' ')[0])).join(', ')}${n.mentions.length > 2 ? ' +' + (n.mentions.length - 2) : ''}</span>` : ''}
        ${n.attachment_count ? html`<span>${icon('paperclip', 'sm')}${n.attachment_count}</span>` : ''}
        ${n.audio_count ? html`<span>${icon('mic', 'sm')}${n.audio_count}</span>` : ''}
        ${n.is_favorite ? html`<span style="color:var(--warning)">${icon('star', 'sm')}</span>` : ''}
        ${n.is_locked && !n.locked ? html`<span class="nc-lock" data-tip="Locked note (unlocked now)">${icon('lock-open', 'sm')}</span>` : ''}
        ${n.pinned_global ? html`<span class="badge warning nc-global">${icon('megaphone', 'sm')} ${others ? n.owner_name : 'You'} · for everyone</span>` : ''}
        ${!n.pinned_global && n.pinned_for_me ? html`<span class="badge accent nc-forme">${icon('user-check', 'sm')} ${n.pinned_by_name || 'Admin'} · for you</span>` : ''}
        ${!others && n.pin_target_count ? html`<span class="badge accent nc-pinned-people" data-tip="Pinned for ${n.pin_target_count} tagged ${n.pin_target_count === 1 ? 'person' : 'people'}">${icon('user-check', 'sm')} ${n.pin_target_count}</span>` : ''}
        ${n.shared ? html`<span class="badge info nc-owner" data-tip="Shared with you by ${n.owner_name}">${icon('share-2', 'sm')} Shared by ${n.owner_name}${n.permission === 'edit' ? ' · edit' : ''}</span>` : !others && n.share_count ? html`<span class="badge info" data-tip="Shared with ${n.share_count}">${icon('users', 'sm')} ${n.share_count}</span>` : ''}
        <span style="margin-left:auto" title="${n.updated_at}">${icon(TYPE_ICON[n.note_type] || 'file-text', 'sm')} ${timeAgo(n.updated_at)}</span>
      </div>
    </div>
    ${others && !n.shared ? '' : n.shared ? html`<div class="nc-actions">
      <button class="btn ghost icon xs" data-a="spin" data-tip="${n.is_pinned ? 'Unpin' : 'Pin'}">${icon(n.is_pinned ? 'pin-off' : 'pin', 'sm')}</button>
      <button class="btn ghost icon xs" data-a="leave" data-tip="Remove from my list">${icon('log-out', 'sm')}</button></div>` : html`<div class="nc-actions">
      <button class="btn ghost icon xs" data-a="pin" data-tip="${n.is_pinned ? 'Unpin' : 'Pin'}">${icon(n.is_pinned ? 'pin-off' : 'pin', 'sm')}</button>
      <button class="btn ghost icon xs" data-a="favorite" data-tip="${n.is_favorite ? 'Unfavorite' : 'Favorite'}">${icon('star', 'sm')}</button>
      <button class="btn ghost icon xs" data-a="color" data-tip="Color">${icon('palette', 'sm')}</button>
      <button class="btn ghost icon xs" data-a="archive" data-tip="${n.is_archived ? 'Unarchive' : 'Archive'}">${icon(n.is_archived ? 'archive-restore' : 'archive', 'sm')}</button>
      <button class="btn ghost icon xs" data-a="more" data-tip="More">${icon('more-horizontal', 'sm')}</button>
    </div>`}
  </article>`;
}

export default {
  title: 'Notes',
  async render(el, ctx) {
    const q0 = ctx.query;
    const f = {
      filter: q0.filter || 'all', category: q0.category || '', tag: q0.tag || '', q: q0.q || '', sort: q0.sort || 'updated', mention: q0.mention || '',
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
          <button class="btn hidden" data-act="lock-now" data-tip="Lock your locked notes again">${icon('lock', 'sm')}<span class="hide-sm">Lock now</span></button>
          <button class="btn" data-act="select">${icon('square-check', 'sm')}<span class="hide-sm">Select</span></button>
          <button class="btn primary" data-act="new">${icon('plus', 'sm')} New note</button></div></div>
      <div class="toolbar">
        <div class="chips" data-filters>${FILTERS.map(([v, l, i]) => html`<button class="chip ${f.filter === v ? 'active' : ''}" data-f="${v}">${icon(i, 'sm')} ${l}</button>`)}</div>
        <div class="grow"></div>
        <div class="input-icon" style="width:min(260px,100%)">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search notes…" value="${f.q}" data-search></div>
        <button class="btn sm" data-act="category">${icon('folder', 'sm')} <span data-cat-label>${cat ? cat.name : 'Category'}</span></button>
        <button class="btn sm" data-act="tag">${icon('hash', 'sm')} <span>${f.tag ? '#' + f.tag : 'Tag'}</span></button>
        <button class="btn sm ${f.mention ? 'active' : ''}" data-act="people" data-tip="Notes that @mention a person">${icon('at-sign', 'sm')} <span data-people-label>${f.mention === 'me' ? 'Mentions me' : f.mention ? 'Person' : 'People'}</span></button>
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
    const sync = () => setQuery({ filter: f.filter !== 'all' ? f.filter : '', category: f.category, tag: f.tag, q: f.q, sort: f.sort !== 'updated' ? f.sort : '', mention: f.mention });
    // People filter (v1.16): notes that @mention me or someone else.
    let peopleList = null;
    async function loadPeople() { if (!peopleList) peopleList = await api.get('notes/people').catch(() => []); return peopleList; }
    const peopleLabel = () => {
      const b = el.querySelector('[data-act="people"]');
      const p = peopleList?.find((x) => String(x.id) === String(f.mention));
      b.classList.toggle('active', !!f.mention);
      b.querySelector('[data-people-label]').textContent = f.mention === 'me' ? 'Mentions me' : p ? '@' + p.name : f.mention ? 'Person' : 'People';
    };
    if (f.mention && f.mention !== 'me') loadPeople().then(peopleLabel);

    async function load(reset = false) {
      if (loading || (done && !reset)) return;
      loading = true;
      if (reset) { page = 1; done = false; items = []; }
      try {
        const r = await api.get('notes', { filter: f.filter, category: f.category, tag: f.tag, q: f.q, mention: f.mention, sort: f.sort, dir: f.sort === 'title' ? 'asc' : 'desc', page, per_page: 40 });
        total = r.total;
        items = reset ? r.items : items.concat(r.items);
        el.querySelector('[data-act="lock-now"]')?.classList.toggle('hidden', !(r.unlocked && items.some((x) => x.is_locked)));
        done = items.length >= total || !r.items.length;
        page++;
        paint();
      } catch (e) { toastError(e); } finally { loading = false; }
    }

    function paint() {
      const who = f.mention === 'me' ? 'you' : peopleList?.find((x) => String(x.id) === String(f.mention))?.name;
      el.querySelector('[data-count]').textContent = `${total} note${total === 1 ? '' : 's'}${f.q ? ` matching “${f.q}”` : ''}${f.mention ? ` mentioning ${who || 'this person'}` : ''}`;
      grid.classList.toggle('selecting', selecting);
      if (!items.length) {
        const msg = f.mention ? ['at-sign', 'No notes mention them yet', 'Type "@" and a name inside a note to mention someone.']
          : f.q ? ['search-x', 'No matching notes', 'Try a different keyword or clear the filters.']
          : f.filter === 'archived' ? ['archive', 'No archived notes', 'Archived notes are kept out of your main list.']
          : f.filter === 'shared' ? ['users', 'Nothing shared with you yet', 'When a colleague shares a note with you it appears here. Pin the ones you need often.']
          : f.filter === 'shared_by_me' ? ['share-2', 'You have not shared any notes', 'Open a note and press Share to give specific users view or edit access.']
            : f.filter === 'pinned' ? ['pin', 'No pinned notes', 'Pin important notes to keep them on top.']
              : f.filter === 'favorite' ? ['star', 'No favorites yet', 'Star the notes you use most.']
                : ['notebook-pen', 'Capture your first idea', 'Notes support rich text, checklists, images, audio and attachments.'];
        grid.innerHTML = String(empty({ icon: msg[0], title: msg[1], text: msg[2], action: '<button class="btn primary" data-act="new">New note</button>' }));
        grid.style.columns = '1';
        return;
      }
      grid.style.columns = '';
      // All / Pinned: admin pins for everyone, then my own pins, then the rest — each with a heading.
      const sections = ['all', 'pinned'].includes(f.filter) ? [
        ['global', 'megaphone', 'Pinned for everyone', items.filter((n) => n.pinned_global)],
        ['people', 'user-check', 'Pinned for you', items.filter((n) => !n.pinned_global && n.pinned_for_me)],
        ['mine', 'pin', 'Pinned by me', items.filter((n) => !n.pinned_global && !n.pinned_for_me && n.is_pinned)],
        ['rest', 'notebook', 'Other notes', items.filter((n) => !n.pinned_global && !n.pinned_for_me && !n.is_pinned)],
      ].filter((x) => x[3].length) : [];
      const cards = (list) => list.map((n) => String(card(n, selecting, selected.has(n.id)))).join('');
      // v1.20: each pinned group is its own box, so its notes can be dragged into a new order.
      const hint = matchMedia('(pointer: coarse)').matches ? 'hold & drag to move' : 'drag to move';
      const canArrange = (k) => !selecting && (k === 'mine' || k === 'people' || (k === 'global' && can('pin_everyone')));
      const sectioned = sections.some(([k]) => k !== 'rest');
      grid.classList.toggle('sectioned', sectioned);
      grid.innerHTML = sectioned
        ? sections.map(([k, ic, label, list]) => `<div class="note-section-head ${k}">${icon(ic, 'sm')} ${label} <span class="subtle">${list.length}</span>${canArrange(k) && list.length > 1 ? `<span class="note-sec-hint">· ${hint}</span>` : ''}</div>`
          + `<div class="note-sec ${canArrange(k) ? 'can-drag' : ''}" data-sec="${k}">${cards(list)}</div>`).join('')
        : cards(items);
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

    async function pinGlobal(n) {
      const on = !n.pinned_global;
      if (on && !(await confirm({ title: 'Pin for everyone?', message: `"${n.title || 'Untitled'}" will appear pinned at the top of every user's notes (read-only for them) and they get a notification.`, confirmText: 'Pin for everyone', danger: false, icon: 'megaphone' }))) return;
      try { await api.post(`notes/${n.id}/pin-global`, { pinned: on }); toast(on ? 'Pinned for everyone' : 'Unpinned for everyone', 'success'); load(true); } catch (e) { toastError(e); }
    }

    function moreMenu(anchor, n) {
      const items2 = [
        { label: 'Open', icon: 'square-arrow-out-up-right', onClick: () => navigate(`/notes/${n.id}`) },
        { label: n.is_pinned ? 'Unpin (only me)' : 'Pin to top (only me)', icon: 'pin', onClick: () => update(n, { is_pinned: !n.is_pinned }) },
        ...(can('pin_everyone') ? [{ label: n.pinned_global ? 'Unpin for everyone' : 'Pin for everyone', icon: 'megaphone', disabled: n.is_locked, onClick: () => pinGlobal(n) },
          { label: n.pin_target_count ? `Pinned for tagged people (${n.pin_target_count})…` : 'Pin for tagged people…', icon: 'user-check', disabled: n.is_locked, onClick: async () => { if (await openPinPeople(n)) load(true); } }] : []),
        { label: n.is_favorite ? 'Remove from favorites' : 'Add to favorites', icon: 'star', onClick: () => update(n, { is_favorite: !n.is_favorite }) },
        { label: n.is_archived ? 'Unarchive' : 'Archive', icon: 'archive', onClick: () => update(n, { is_archived: !n.is_archived }, n.is_archived ? 'Note restored from archive' : 'Note archived') },
        { label: 'Duplicate', icon: 'copy', disabled: n.locked, onClick: async () => { try { await api.post(`notes/${n.id}/duplicate`); toast('Note duplicated', 'success'); load(true); } catch (e) { toastError(e); } } },
        { label: n.is_locked ? 'Remove lock' : 'Lock with PIN', icon: n.is_locked ? 'lock-open' : 'lock', onClick: async () => { if (await toggleNoteLock(n)) load(true); } },
        { label: 'Move to category', icon: 'folder', onClick: () => menu(anchor, [{ label: 'No category', icon: 'folder-x', onClick: () => update(n, { category_id: null }, 'Category removed') }, ...state.categories.note.map((c) => ({ label: c.name, icon: 'folder', checked: c.id === n.category_id, onClick: () => update(n, { category_id: c.id }, `Moved to ${c.name}`) }))]) },
        { divider: true },
        { label: 'Move to trash', icon: 'trash-2', danger: true, onClick: () => trash(n) },
      ];
      return anchor instanceof Event ? contextMenu(anchor, items2) : menu(anchor, items2, { align: 'end' });
    }

    el.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'lock-now') { try { await lockNow(); load(true); } catch (err) { toastError(err); } return; }
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
      if (act === 'people') {
        const t = e.target.closest('[data-act]');
        const list = await loadPeople();
        const pick = (v) => { f.mention = v; peopleLabel(); sync(); load(true); };
        return menu(t, [
          { label: 'Everyone', icon: 'users', checked: !f.mention, onClick: () => pick('') },
          { label: 'Mentions me', icon: 'at-sign', checked: f.mention === 'me', onClick: () => pick('me') },
          ...(list.filter((p) => p.id !== state.user.id).length ? [{ divider: true }, { title: 'Mentioned in notes' }] : [{ title: 'Nobody is @mentioned yet' }]),
          ...list.filter((p) => p.id !== state.user.id).map((p) => ({ label: `@${p.name}`, kbd: String(p.count), checked: String(p.id) === String(f.mention), onClick: () => pick(String(p.id)) })),
        ]);
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
      if (othersNote(n) && !a) return navigate(`/notes/${n.id}`);
      if (!othersNote(n) && (selecting || e.target.closest('[data-select]') || e.ctrlKey || e.metaKey)) {
        if (!selecting) { selecting = true; }
        selected.has(n.id) ? selected.delete(n.id) : selected.add(n.id);
        if (e.target.matches('[data-select]')) e.preventDefault();
        return paint();
      }
      if (a === 'spin') {
        try { const r = await api.post(`notes/${n.id}/share-pin`, { pinned: !n.is_pinned }); toast(r.pinned ? 'Pinned' : 'Unpinned', 'success', { timeout: 1200 }); return load(true); } catch (err) { return toastError(err); }
      }
      if (a === 'leave') {
        if (!(await confirm({ title: 'Remove shared note?', message: `"${n.title || 'Untitled'}" will disappear from your list. ${n.owner_name} keeps the note.`, confirmText: 'Remove' }))) return;
        try { await api.post(`notes/${n.id}/leave`); toast('Removed from your shared notes', 'success'); return load(true); } catch (err) { return toastError(err); }
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
    // Drag pinned notes into the order you want (my pins; the pins for everyone for administrators).
    sortable(grid, {
      item: '.note-card', list: '.note-sec', layout: 'grid', delay: 320,
      canDrag: (c) => !selecting && !!c.closest('.note-sec.can-drag'),
      onDrop: async (c, toList, index, fromList) => {
        if (toList !== fromList) { toast('Notes move inside their own pinned group', 'info', { timeout: 2000 }); return paint(); }
        const ids = Array.from(toList.querySelectorAll('.note-card')).map((x) => +x.dataset.id);
        const set = new Set(ids);
        const sorted = ids.map((id) => items.find((x) => x.id === id));
        let k = 0;
        items = items.map((x) => (set.has(x.id) ? sorted[k++] : x));
        try { await api.post('notes/pin-order', { section: toList.dataset.sec, ids }); } catch (err) { toastError(err); load(true); }
      },
    });
    el.addEventListener('contextmenu', (e) => {
      const c = e.target.closest('.note-card');
      if (!c || document.querySelector('.drag-ghost')) { if (c) e.preventDefault(); return; }
      const n = items.find((x) => x.id === +c.dataset.id);
      if (n && !othersNote(n)) moreMenu(e, n);
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
