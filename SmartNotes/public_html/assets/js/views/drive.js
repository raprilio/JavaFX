// Drive: folders, upload (drag & drop), starred / recent, tags linking files to notes, PDF & image preview.
import { html, icon, fmtBytes, timeAgo, fileBadge, debounce, h } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { setQuery } from '../core/router.js';
import { toast, toastError, menu, confirm, prompt, empty, modal, contextMenu, PALETTE } from '../core/ui.js';
import { uploadFile, pickFiles } from '../components/attachments.js';
import { openFilePreview, openFileDetails } from '../components/filePreview.js';
import { openItemShare, leaveShared } from '../components/itemShare.js';

const VIEWS = [['drive', 'My Drive', 'hard-drive'], ['shared', 'Shared with me', 'users'], ['starred', 'Starred', 'star'], ['recent', 'Recent', 'clock'], ['all', 'All files', 'files']];
const KINDS = [['', 'All types'], ['pdf', 'PDF'], ['image', 'Images'], ['video', 'Videos'], ['document', 'Documents'], ['audio', 'Audio'], ['archive', 'Archives']];

/** Flat folder list -> indented options for selects. */
export function folderOptions(list) {
  const kids = {};
  list.forEach((f) => (kids[f.parent_id || 0] ||= []).push(f));
  const out = [];
  const walk = (pid, depth) => (kids[pid] || []).sort((a, b) => a.name.localeCompare(b.name)).forEach((f) => {
    out.push({ ...f, label: `${'— '.repeat(depth)}${f.name}` });
    if (depth < 20) walk(f.id, depth + 1);
  });
  walk(0, 0);
  return out;
}

export default {
  title: 'Drive',
  async render(el, ctx) {
    const q0 = ctx.query;
    const f = { view: q0.view || 'drive', folder: q0.folder ? +q0.folder : null, q: q0.q || '', kind: q0.kind || '', tag: q0.tag || '', sort: q0.sort || '', layout: 'grid' };
    let data = { items: [], folders: [], folder: null, total: 0, summary: { count: 0, size: 0 } };
    let allFolders = [];
    let page = 1;

    el.innerHTML = String(html`
      <div class="page-head"><div><h1>Drive</h1><p data-sub>Store important documents, link them to notes with tags and preview PDFs & images.</p></div>
        <div class="row"><button class="btn" data-act="folder">${icon('folder-plus', 'sm')}<span class="hide-sm">New folder</span></button>
        <button class="btn primary" data-act="upload">${icon('upload', 'sm')} Upload</button></div></div>
      <div class="toolbar">
        <div class="chips" data-views>${VIEWS.map(([v, l, i]) => html`<button class="chip ${f.view === v ? 'active' : ''}" data-view="${v}">${icon(i, 'sm')} ${l}</button>`)}</div>
        <div class="grow"></div>
        <div class="input-icon" style="width:min(240px,100%)">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search name, description, #tag…" value="${f.q}" data-search></div>
        <select class="select sm" style="width:auto" data-kind>${KINDS.map(([v, l]) => html`<option value="${v}" ${f.kind === v ? 'selected' : ''}>${l}</option>`)}</select>
        <button class="btn sm" data-act="tag">${icon('hash', 'sm')} <span>${f.tag ? '#' + f.tag : 'Tag'}</span></button>
        <div class="btn-group">${[['grid', 'layout-grid'], ['list', 'list']].map(([v, i]) => html`<button class="btn ${f.layout === v ? 'active' : ''}" data-layout="${v}">${icon(i, 'sm')}</button>`)}</div>
      </div>
      <nav class="drive-crumbs" data-crumbs></nav>
      <div class="drive-drop" data-drop>
        <div class="drop-hint">${icon('upload-cloud', 'lg')}&nbsp; Drop files to upload here</div>
        <div data-body><div style="padding:50px;text-align:center"><span class="spinner"></span></div></div>
      </div>
      <div data-progress></div>
      <div class="pager" data-pager></div>`);
    const body = el.querySelector('[data-body]');

    const sync = () => setQuery({ view: f.view !== 'drive' ? f.view : '', folder: f.folder || '', q: f.q, kind: f.kind, tag: f.tag });
    async function loadFolders() { try { allFolders = await api.get('drive/folders'); } catch { allFolders = []; } }
    async function load(reset = true) {
      if (reset) page = 1;
      try {
        const r = await api.get('drive', { view: f.view, folder: f.folder || '', q: f.q, kind: f.kind, tag: f.tag, sort: f.sort, page, per_page: 60 });
        data = reset ? r : { ...r, items: data.items.concat(r.items) };
        sync();
        paint();
      } catch (e) {
        if (e.status === 404 && f.folder) { f.folder = null; return load(); }
        toastError(e);
      }
    }

    function crumbs() {
      const c = el.querySelector('[data-crumbs]');
      const path = data.folder?.path || [];
      if (f.view === 'shared') {
        c.innerHTML = String(html`<a href="#" data-goto="">${icon('users', 'sm')} Shared with me</a>${path.map((p) => html`${icon('chevron-right', 'sm')}<a href="#" data-goto="${p.id}">${p.name}</a>`)}`);
        return;
      }
      if (f.view !== 'drive') { c.innerHTML = ''; return; }
      c.innerHTML = String(html`<a href="#" data-goto="" data-drop-folder="">${icon('hard-drive', 'sm')} My Drive</a>${path.map((p) => html`${icon('chevron-right', 'sm')}<a href="#" data-goto="${p.id}" data-drop-folder="${p.id}">${p.name}</a>`)}`);
    }

    function fileCard(x) {
      return html`<div class="file-card" data-id="${x.id}" draggable="${x.shared ? 'false' : 'true'}" tabindex="0">
        <div class="fc-thumb">${x.kind === 'image' ? html`<img src="${x.thumb_url}" alt="" loading="lazy">` : x.kind === 'video' ? html`<video src="${x.url}#t=0.5" preload="metadata" muted playsinline tabindex="-1"></video><span class="fc-play">${icon('play', 'sm')}</span>` : fileBadge(x.name)}
          ${x.preview === 'pdf' ? html`<span class="badge danger fc-type">PDF</span>` : ''}</div>
        <div class="fc-info"><div class="row" style="gap:6px"><div class="fc-name grow" title="${x.name}">${x.name}</div>${x.is_starred ? html`<span style="color:var(--warning)">${icon('star', 'sm')}</span>` : ''}</div>
          <div class="fc-sub">${fmtBytes(x.size)} · ${timeAgo(x.created_at)}${f.view !== 'drive' && x.folder_name ? html` · ${icon('folder', 'sm')} ${x.folder_name}` : ''}</div>
          ${x.shared ? html`<div class="mt-1"><span class="badge info">${icon('user', 'sm')} ${x.owner_name}</span></div>` : x.share_count ? html`<div class="mt-1"><span class="badge info" data-tip="Shared with ${x.share_count}">${icon('users', 'sm')} ${x.share_count}</span></div>` : ''}
          ${x.tags?.length ? html`<div class="row wrap mt-1" style="gap:4px">${x.tags.slice(0, 3).map((t) => html`<span class="tag">#${t}</span>`)}</div>` : ''}</div>
        <button class="btn icon xs fc-menu" data-more aria-label="More">${icon('more-vertical', 'sm')}</button></div>`;
    }
    function fileRow(x) {
      return html`<tr class="file-card" data-id="${x.id}" draggable="true" style="cursor:pointer">
        <td><div class="row">${x.kind === 'image' ? html`<img src="${x.thumb_url}" alt="" style="width:32px;height:32px;border-radius:8px;object-fit:cover" loading="lazy">` : fileBadge(x.name)}
          <span class="truncate" style="max-width:340px">${x.name}</span>${x.is_starred ? html`<span style="color:var(--warning)">${icon('star', 'sm')}</span>` : ''}</div></td>
        <td class="hide-sm">${x.tags.map((t) => html`<span class="tag" style="margin-right:3px">#${t}</span>`)}</td>
        <td class="nowrap">${fmtBytes(x.size)}</td><td class="hide-sm nowrap">${timeAgo(x.created_at)}</td>
        <td><button class="btn ghost icon sm" data-more>${icon('more-vertical', 'sm')}</button></td></tr>`;
    }

    function paint() {
      crumbs();
      el.querySelector('[data-sub]').textContent = data.summary ? `${data.summary.count} file${data.summary.count === 1 ? '' : 's'} · ${fmtBytes(data.summary.size)} used` : 'Files and folders colleagues shared with you (view & download).';
      const folders = data.folders || [];
      if (!folders.length && !data.items.length) {
        body.innerHTML = String(f.view === 'shared' ? empty({ icon: 'users', title: f.folder ? 'This folder is empty' : 'Nothing shared with you yet', text: 'When a colleague shares a file or folder with you, it appears here.' }) : empty({
          icon: f.view === 'starred' ? 'star' : 'hard-drive',
          title: f.q || f.tag || f.kind ? 'No files found' : f.view === 'starred' ? 'No starred files' : f.folder ? 'This folder is empty' : 'Your Drive is empty',
          text: 'Upload important documents (PDF, images, Office files). Add #tags so they show up in notes with the same tag.',
          action: '<button class="btn primary" data-act="upload">Upload files</button>',
        }));
        el.querySelector('[data-pager]').innerHTML = '';
        return;
      }
      body.innerHTML = String(html`
        ${folders.length ? html`<div class="label mb-1">Folders</div><div class="folder-grid mb-3">${folders.map((d) => html`
          <div class="folder-card" data-folder="${d.id}" data-drop-folder="${d.id}" tabindex="0" style="--fc:${d.color || 'var(--accent)'}">
            <span class="folder-ic">${icon('folder', 'lg')}</span><div class="grow" style="min-width:0"><div class="truncate" style="font-weight:600">${d.name}</div>
            <div class="tiny subtle">${d.file_count} file${d.file_count === 1 ? '' : 's'}${d.folder_count ? ` · ${d.folder_count} folder${d.folder_count > 1 ? 's' : ''}` : ''}${d.shared ? ` · ${d.owner_name}` : ''}</div></div>
            ${d.share_count ? html`<span class="badge info" data-tip="Shared with ${d.share_count}">${icon('users', 'sm')} ${d.share_count}</span>` : ''}
            <button class="btn ghost icon xs" data-folder-more aria-label="More">${icon('more-vertical', 'sm')}</button></div>`)}</div>` : ''}
        ${data.items.length ? html`${folders.length ? html`<div class="label mb-1">Files</div>` : ''}
          ${f.layout === 'grid' ? html`<div class="file-grid">${data.items.map(fileCard)}</div>`
            : html`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th class="hide-sm">Tags</th><th>Size</th><th class="hide-sm">Uploaded</th><th></th></tr></thead><tbody>${data.items.map(fileRow)}</tbody></table></div>`}` : ''}`);
      el.querySelector('[data-pager]').innerHTML = data.items.length < data.total ? String(html`<button class="btn" data-act="more">Load more (${data.total - data.items.length})</button>`) : '';
    }

    async function upload(files) {
      const prog = el.querySelector('[data-progress]');
      for (const file of files) {
        const row = h(String(html`<div class="file-row">${fileBadge(file.name)}<div class="grow"><div class="truncate small">${file.name} · ${fmtBytes(file.size)}</div><div class="upload-progress"><span></span></div></div></div>`));
        prog.appendChild(row);
        try {
          await uploadFile(file, { folder_id: f.view === 'drive' ? f.folder : null, tags: f.tag || '' }, (p) => (row.querySelector('span').style.width = Math.round(p * 100) + '%'));
          toast(`${file.name} uploaded`, 'success', { timeout: 1800 });
        } catch (e) { toastError(new Error(`${file.name}: ${e.message}`)); } finally { row.remove(); }
      }
      if (f.view !== 'drive') { f.view = 'drive'; el.querySelectorAll('[data-view]').forEach((c) => c.classList.toggle('active', c.dataset.view === 'drive')); }
      load();
    }

    async function moveDialog(fileIds, folderIds = []) {
      await loadFolders();
      const blocked = new Set(folderIds);
      const opts = folderOptions(allFolders).filter((x) => !blocked.has(x.id));
      const m = modal({
        title: 'Move to…', size: 'sm',
        body: html`<div class="field" style="margin:0"><label>Destination folder</label><select class="select" data-dest><option value="">My Drive (root)</option>${opts.map((o) => html`<option value="${o.id}">${o.label}</option>`)}</select></div>`,
        actions: [{ label: 'Cancel' }, { label: 'Move', variant: 'primary', onClick: (c) => c.body.querySelector('[data-dest]').value || 'root' }],
      });
      const dest = await m.result;
      if (!dest) return;
      try { await api.post('drive/move', { file_ids: fileIds, folder_ids: folderIds, folder_id: dest === 'root' ? null : +dest }); toast('Moved', 'success'); load(); } catch (e) { toastError(e); }
    }

    async function details(x) {
      await loadFolders();
      const r = await openFileDetails(x, { folders: folderOptions(allFolders), onChange: () => load() });
      void r;
    }

    function fileMenu(anchor, x) {
      if (x.shared) {
        const ro = [
          { label: 'Preview', icon: 'eye', onClick: () => openFilePreview(x, data.items) },
          { label: 'Download', icon: 'download', onClick: () => (window.location.href = x.download_url) },
          ...(f.folder ? [] : [{ divider: true }, { label: 'Remove from my list', icon: 'log-out', danger: true, onClick: async () => { try { await leaveShared('file', x.id); load(); } catch (e) { toastError(e); } } }]),
        ];
        return anchor instanceof Event ? contextMenu(anchor, ro) : menu(anchor, ro, { align: 'end' });
      }
      const items = [
        { label: 'Share…', icon: 'users', onClick: async () => { if ((await openItemShare({ type: 'file', id: x.id, title: x.name })) !== null) load(); } },
        { label: 'Preview', icon: 'eye', onClick: () => openFilePreview(x, data.items) },
        { label: 'Details, tags & links', icon: 'info', onClick: () => details(x) },
        { label: x.is_starred ? 'Remove star' : 'Add star', icon: 'star', onClick: async () => { await api.post(`files/${x.id}`, { is_starred: !x.is_starred }).catch(toastError); load(); } },
        { label: 'Move to…', icon: 'folder-input', onClick: () => moveDialog([x.id]) },
        { label: 'Rename', icon: 'pencil', onClick: async () => { const n = await prompt({ title: 'Rename file', value: x.name }); if (n) { await api.post(`files/${x.id}`, { name: n }).catch(toastError); load(); } } },
        { label: 'Download', icon: 'download', onClick: () => (window.location.href = x.download_url) },
        { divider: true },
        { label: 'Delete', icon: 'trash-2', danger: true, onClick: async () => {
          if (!(await confirm({ title: 'Delete file?', message: `"${x.name}" will be moved to the trash.`, confirmText: 'Delete' }))) return;
          try { await api.post(`items/file/${x.id}/trash`); toast('File moved to trash', 'success', { action: 'Undo', onAction: () => api.post(`items/file/${x.id}/restore`).then(() => load()) }); load(); } catch (e) { toastError(e); }
        } },
      ];
      return anchor instanceof Event ? contextMenu(anchor, items) : menu(anchor, items, { align: 'end' });
    }
    function folderMenu(anchor, d) {
      if (d.shared) {
        const ro = [
          { label: 'Open', icon: 'folder-open', onClick: () => openFolder(d.id) },
          ...(f.folder ? [] : [{ divider: true }, { label: 'Remove from my list', icon: 'log-out', danger: true, onClick: async () => { try { await leaveShared('folder', d.id); load(); } catch (e) { toastError(e); } } }]),
        ];
        return anchor instanceof Event ? contextMenu(anchor, ro) : menu(anchor, ro, { align: 'end' });
      }
      const items = [
        { label: 'Open', icon: 'folder-open', onClick: () => openFolder(d.id) },
        { label: 'Share…', icon: 'users', onClick: async () => { if ((await openItemShare({ type: 'folder', id: d.id, title: d.name })) !== null) load(); } },
        { label: 'Rename', icon: 'pencil', onClick: async () => { const n = await prompt({ title: 'Rename folder', value: d.name }); if (n) { await api.post(`drive/folders/${d.id}`, { name: n }).catch(toastError); load(); } } },
        { label: 'Color', icon: 'palette', onClick: () => {
          const wrap = h(`<div class="swatches">${PALETTE.map((c) => `<button class="swatch" data-c="${c}" style="--sw:${c}"></button>`).join('')}</div>`);
          import('../core/ui.js').then(({ popover }) => {
            const p = popover(anchor instanceof Event ? { x: anchor.clientX, y: anchor.clientY } : anchor, wrap);
            wrap.addEventListener('click', async (e) => { const c = e.target.closest('[data-c]'); if (c) { p.close(); await api.post(`drive/folders/${d.id}`, { color: c.dataset.c }).catch(toastError); load(); } });
          });
        } },
        { label: 'Move to…', icon: 'folder-input', onClick: () => moveDialog([], [d.id]) },
        { divider: true },
        { label: 'Delete folder', icon: 'trash-2', danger: true, onClick: async () => {
          if (!(await confirm({ title: `Delete “${d.name}”?`, message: 'The folder is removed. Its files and sub-folders are kept and moved up one level.', confirmText: 'Delete folder' }))) return;
          try { await api.post(`drive/folders/${d.id}/delete`); toast('Folder deleted', 'success'); load(); } catch (e) { toastError(e); }
        } },
      ];
      return anchor instanceof Event ? contextMenu(anchor, items) : menu(anchor, items, { align: 'end' });
    }
    function openFolder(id) {
      f.folder = id ? +id : null;
      if (f.view !== 'shared') f.view = 'drive';
      el.querySelectorAll('[data-view]').forEach((c) => c.classList.toggle('active', c.dataset.view === f.view));
      load();
    }

    el.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'upload') return upload(await pickFiles());
      if (act === 'more') { page++; return load(false); }
      if (act === 'folder') {
        const name = await prompt({ title: 'New folder', label: 'Folder name', placeholder: 'e.g. Berkas Penting', confirmText: 'Create' });
        if (!name) return;
        try { await api.post('drive/folders', { name, parent_id: f.view === 'drive' ? f.folder : null }); toast('Folder created', 'success'); load(); } catch (err) { toastError(err); }
        return;
      }
      if (act === 'tag') {
        const t = e.target.closest('[data-act]');
        return menu(t, [{ label: 'All tags', icon: 'hash', checked: !f.tag, onClick: () => { f.tag = ''; t.querySelector('span').textContent = 'Tag'; load(); } },
          ...(state.tags.length ? [{ divider: true }] : [{ title: 'No tags yet' }]),
          ...state.tags.map((tg) => ({ label: `#${tg.name}`, checked: f.tag === tg.name, onClick: () => { f.tag = tg.name; t.querySelector('span').textContent = '#' + tg.name; load(); } }))]);
      }
      const goto = e.target.closest('[data-goto]');
      if (goto) { e.preventDefault(); return openFolder(goto.dataset.goto); }
      const v = e.target.closest('[data-view]');
      if (v) { f.view = v.dataset.view; f.folder = null; el.querySelectorAll('[data-view]').forEach((c) => c.classList.toggle('active', c === v)); return load(); }
      const lay = e.target.closest('[data-layout]');
      if (lay) { f.layout = lay.dataset.layout; el.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('active', b === lay)); return paint(); }
      const fm = e.target.closest('[data-folder-more]');
      if (fm) { const d = data.folders.find((x) => x.id === +fm.closest('[data-folder]').dataset.folder); return folderMenu(fm, d); }
      const fc = e.target.closest('[data-folder]');
      if (fc) return openFolder(fc.dataset.folder);
      const card = e.target.closest('.file-card');
      if (!card) return;
      const x = data.items.find((i) => i.id === +card.dataset.id);
      if (e.target.closest('[data-more]')) return fileMenu(e.target.closest('[data-more]'), x);
      openFilePreview(x, data.items);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const fc = e.target.closest('[data-folder]');
      if (fc) return openFolder(fc.dataset.folder);
      const card = e.target.closest('.file-card');
      if (card) openFilePreview(data.items.find((i) => i.id === +card.dataset.id), data.items);
    });
    el.addEventListener('contextmenu', (e) => {
      const fc = e.target.closest('[data-folder]');
      if (fc) return folderMenu(e, data.folders.find((x) => x.id === +fc.dataset.folder));
      const card = e.target.closest('.file-card');
      if (card) fileMenu(e, data.items.find((i) => i.id === +card.dataset.id));
    });

    // Drag a file onto a folder / breadcrumb to move it; drop OS files anywhere to upload.
    let dragId = null;
    el.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.file-card');
      if (!card || f.view === 'shared') return;
      dragId = +card.dataset.id;
      e.dataTransfer.setData('text/x-file', String(dragId));
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => { dragId = null; el.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target')); });
    el.addEventListener('dragover', (e) => {
      const target = e.target.closest('[data-drop-folder]');
      if (dragId && target) { e.preventDefault(); el.querySelectorAll('.drop-target').forEach((x) => x !== target && x.classList.remove('drop-target')); target.classList.add('drop-target'); return; }
      if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); el.querySelector('[data-drop]').classList.add('dragging-file'); }
    });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.querySelector('[data-drop]').classList.remove('dragging-file'); });
    el.addEventListener('drop', async (e) => {
      el.querySelector('[data-drop]').classList.remove('dragging-file');
      const target = e.target.closest('[data-drop-folder]');
      if (dragId && target) {
        e.preventDefault();
        const dest = target.dataset.dropFolder ? +target.dataset.dropFolder : null;
        try { await api.post('drive/move', { file_ids: [dragId], folder_id: dest }); toast('Moved', 'success', { timeout: 1500 }); load(); } catch (err) { toastError(err); }
        return;
      }
      if (e.dataTransfer?.files?.length) { e.preventDefault(); upload(Array.from(e.dataTransfer.files)); }
    });
    const search = debounce(() => load(), 300);
    el.querySelector('[data-search]').addEventListener('input', (e) => { f.q = e.target.value.trim(); search(); });
    el.querySelector('[data-kind]').addEventListener('change', (e) => { f.kind = e.target.value; load(); });

    await load();
    if (q0.open) {
      try { const x = await api.get(`files/${q0.open}`); openFilePreview(x, [x]); } catch (err) { toastError(err); }
    }
  },
};
