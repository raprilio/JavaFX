// File manager: upload (drag & drop, multiple), filter by type, preview, rename, download, delete.
import { html, icon, fmtBytes, timeAgo, fileBadge, debounce, h } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { setQuery, navigate } from '../core/router.js';
import { toast, toastError, menu, confirm, prompt, empty, modal } from '../core/ui.js';
import { uploadFile, pickFiles } from '../components/attachments.js';
import { openImageViewer } from '../components/imageViewer.js';

const KINDS = [['', 'All files', 'files'], ['image', 'Images', 'image'], ['document', 'Documents', 'file-text'], ['audio', 'Audio', 'music'], ['archive', 'Archives', 'file-archive']];

export default {
  title: 'Files',
  async render(el, ctx) {
    const f = { kind: ctx.query.kind || '', q: ctx.query.q || '', sort: 'date', view: 'grid' };
    let items = [], page = 1, total = 0, summary = { count: 0, size: 0 };
    el.innerHTML = String(html`
      <div class="page-head"><div><h1>Files</h1><p data-sub>&nbsp;</p></div>
        <div class="row"><div class="btn-group">${[['grid', 'layout-grid'], ['list', 'list']].map(([v, i]) => html`<button class="btn ${f.view === v ? 'active' : ''}" data-view="${v}">${icon(i, 'sm')}</button>`)}</div>
        <button class="btn primary" data-act="upload">${icon('upload', 'sm')} Upload</button></div></div>
      <div class="dropzone mb-3" data-drop>${icon('upload-cloud', 'lg')}<div class="mt-1"><b>Drop files here</b> or click to browse</div>
        <div class="small subtle mt-1">Images (JPG, PNG, WEBP) up to ${state.limits.image_mb || 8} MB · Documents (PDF, DOC/X, XLS/X, PPT/X, TXT, CSV) & ZIP up to ${state.limits.file_mb || 20} MB · Audio up to ${state.limits.audio_mb || 25} MB</div></div>
      <div data-progress></div>
      <div class="toolbar"><div class="chips">${KINDS.map(([v, l, i]) => html`<button class="chip ${f.kind === v ? 'active' : ''}" data-kind="${v}">${icon(i, 'sm')} ${l}</button>`)}</div>
        <div class="grow"></div><div class="input-icon" style="width:min(240px,100%)">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search files…" value="${f.q}" data-search></div>
        <button class="btn sm" data-act="sort">${icon('arrow-up-down', 'sm')} Sort</button></div>
      <div data-list></div>
      <div class="pager" data-pager></div>`);
    const list = el.querySelector('[data-list]');

    async function load(reset = true) {
      if (reset) page = 1;
      try {
        const r = await api.get('files', { kind: f.kind, q: f.q, sort: f.sort, page, per_page: 48 });
        items = reset ? r.items : items.concat(r.items);
        total = r.total;
        summary = r.summary;
        setQuery({ kind: f.kind, q: f.q });
        paint();
      } catch (e) { toastError(e); }
    }
    function paint() {
      el.querySelector('[data-sub]').textContent = `${summary.count} file${summary.count === 1 ? '' : 's'} · ${fmtBytes(summary.size)} used`;
      if (!items.length) {
        list.innerHTML = String(empty({ icon: 'folder-open', title: f.q || f.kind ? 'No files found' : 'No files yet', text: 'Upload documents, images and archives — they are stored securely and only visible to you.' }));
        el.querySelector('[data-pager]').innerHTML = '';
        return;
      }
      if (f.view === 'grid') {
        list.innerHTML = String(html`<div class="file-grid">${items.map((x) => html`<div class="file-card" data-id="${x.id}">
          <div class="fc-thumb">${x.kind === 'image' ? html`<img src="${x.thumb_url}" alt="" loading="lazy">` : fileBadge(x.name)}</div>
          <div class="fc-info"><div class="fc-name" title="${x.name}">${x.name}</div><div class="fc-sub">${fmtBytes(x.size)} · ${timeAgo(x.created_at)}</div>
            ${x.note_title ? html`<div class="fc-sub truncate">${icon('notebook-pen', 'sm')} ${x.note_title}</div>` : ''}</div>
          <button class="btn icon xs fc-menu" data-more aria-label="More">${icon('more-vertical', 'sm')}</button></div>`)}</div>`);
      } else {
        list.innerHTML = String(html`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th class="hide-sm">Type</th><th>Size</th><th class="hide-sm">Uploaded</th><th class="hide-sm">Linked to</th><th></th></tr></thead><tbody>
          ${items.map((x) => html`<tr class="file-card" data-id="${x.id}" style="cursor:pointer"><td><div class="row">${x.kind === 'image' ? html`<img src="${x.thumb_url}" alt="" style="width:32px;height:32px;border-radius:8px;object-fit:cover" loading="lazy">` : fileBadge(x.name)}<span class="truncate" style="max-width:320px">${x.name}</span></div></td>
            <td class="hide-sm" style="text-transform:capitalize">${x.kind}</td><td class="nowrap">${fmtBytes(x.size)}</td><td class="hide-sm nowrap">${timeAgo(x.created_at)}</td>
            <td class="hide-sm">${x.note_id ? html`<a href="#/notes/${x.note_id}">${x.note_title || 'Note'}</a>` : x.task_id ? 'Task' : x.meeting_id ? html`<a href="#/meetings/${x.meeting_id}">Meeting</a>` : '—'}</td>
            <td><button class="btn ghost icon sm" data-more>${icon('more-vertical', 'sm')}</button></td></tr>`)}</tbody></table></div>`);
      }
      el.querySelector('[data-pager]').innerHTML = items.length < total ? String(html`<button class="btn" data-act="more">Load more (${total - items.length} remaining)</button>`) : '';
    }

    async function upload(files) {
      const prog = el.querySelector('[data-progress]');
      for (const file of files) {
        const row = h(String(html`<div class="file-row">${fileBadge(file.name)}<div class="grow"><div class="truncate small">${file.name} · ${fmtBytes(file.size)}</div><div class="upload-progress"><span></span></div></div></div>`));
        prog.appendChild(row);
        try {
          await uploadFile(file, {}, (p) => (row.querySelector('span').style.width = Math.round(p * 100) + '%'));
          toast(`${file.name} uploaded`, 'success', { timeout: 2000 });
        } catch (e) { toastError(new Error(`${file.name}: ${e.message}`)); } finally { row.remove(); }
      }
      load();
    }

    function preview(x) {
      if (x.kind === 'image') {
        const imgs = items.filter((i) => i.kind === 'image');
        return openImageViewer(imgs, imgs.indexOf(x), { onDelete: () => load() });
      }
      if (x.kind === 'audio') {
        return modal({ title: x.name, size: 'sm', body: html`<audio controls autoplay src="${x.url}" style="width:100%"></audio>`, actions: [{ label: 'Close' }] });
      }
      if (x.mime_type === 'application/pdf') return window.open(x.url, '_blank', 'noopener');
      window.location.href = x.download_url;
    }

    el.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'upload' || e.target.closest('[data-drop]')) return upload(await pickFiles());
      if (act === 'more') { page++; return load(false); }
      if (act === 'sort') return menu(e.target.closest('[data-act]'), [['date', 'Newest first'], ['name', 'Name'], ['size', 'Largest first']].map(([v, l]) => ({ label: l, checked: f.sort === v, onClick: () => { f.sort = v; load(); } })));
      const k = e.target.closest('[data-kind]');
      if (k) { f.kind = k.dataset.kind; el.querySelectorAll('[data-kind]').forEach((c) => c.classList.toggle('active', c === k)); return load(); }
      const v = e.target.closest('[data-view]');
      if (v) { f.view = v.dataset.view; el.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === v)); return paint(); }
      const card = e.target.closest('.file-card');
      if (!card || e.target.closest('a')) return;
      const x = items.find((i) => i.id === +card.dataset.id);
      const more = e.target.closest('[data-more]');
      if (!more) return preview(x);
      menu(more, [
        { label: 'Preview', icon: 'eye', onClick: () => preview(x) },
        { label: 'Download', icon: 'download', onClick: () => (window.location.href = x.download_url) },
        { label: 'Rename', icon: 'pencil', onClick: async () => {
          const n = await prompt({ title: 'Rename file', label: 'File name', value: x.name });
          if (!n) return;
          try { await api.post(`files/${x.id}`, { name: n }); toast('File renamed', 'success'); load(); } catch (err) { toastError(err); }
        } },
        ...(x.note_id ? [{ label: 'Open note', icon: 'notebook-pen', onClick: () => navigate(`/notes/${x.note_id}`) }] : []),
        { divider: true },
        { label: 'Delete', icon: 'trash-2', danger: true, onClick: async () => {
          if (!(await confirm({ title: 'Delete file?', message: `"${x.name}" will be moved to the trash.`, confirmText: 'Delete' }))) return;
          try { await api.post(`items/file/${x.id}/trash`); toast('File moved to trash', 'success', { action: 'Undo', onAction: () => api.post(`items/file/${x.id}/restore`).then(() => load()) }); load(); } catch (err) { toastError(err); }
        } },
      ], { align: 'end' });
    });
    const drop = el.querySelector('[data-drop]');
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) upload(Array.from(e.dataTransfer.files)); });
    const search = debounce(() => load(), 300);
    el.querySelector('[data-search]').addEventListener('input', (e) => { f.q = e.target.value.trim(); search(); });
    await load();
    if (ctx.query.open) { const x = items.find((i) => i.id === +ctx.query.open); if (x) preview(x); }
  },
};
