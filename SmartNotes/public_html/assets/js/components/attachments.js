// Reusable attachment list with upload (drag & drop / picker), preview, download and delete.
import { html, icon, fileBadge, fmtBytes, timeAgo, h, raw } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, toastError, confirm, menu } from '../core/ui.js';
import { openFilePreview } from './filePreview.js';

export function uploadFile(file, fields = {}, onProgress) {
  const fd = new FormData();
  fd.append('file', file);
  Object.entries(fields).forEach(([k, v]) => v !== undefined && v !== null && fd.append(k, v));
  return api.upload('files/upload', fd, onProgress);
}

export function pickFiles({ accept = '', multiple = true } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.style.display = 'none';
    inp.onchange = () => { resolve(Array.from(inp.files || [])); inp.remove(); };
    document.body.appendChild(inp);
    inp.click();
  });
}

export function fileRow(f, { removable = true } = {}) {
  return html`<div class="file-row" data-id="${f.id}">
    ${f.kind === 'image' && f.thumb_url ? html`<img src="${f.thumb_url}" alt="" style="width:38px;height:38px;border-radius:10px;object-fit:cover" loading="lazy">` : fileBadge(f.name)}
    <div class="grow" style="min-width:0"><div class="truncate" style="font-weight:560">${f.name}</div><div class="tiny subtle">${fmtBytes(f.size)} · ${timeAgo(f.created_at)}</div></div>
    <a class="btn ghost icon sm" href="${f.download_url}" data-tip="Download" download>${icon('download', 'sm')}</a>
    ${removable ? html`<button class="btn ghost icon sm" data-act="remove" data-tip="Remove">${icon('trash-2', 'sm')}</button>` : ''}
  </div>`;
}

/**
 * Mount an attachment manager.
 * parent: 'note' | 'task' | 'meeting', parentId: number
 */
export function mountAttachments(container, { parent, parentId, items = [], title = 'Attachments', onChange, readOnly = false } = {}) {
  let files = [...items];
  const field = parent + '_id';

  function render() {
    container.innerHTML = String(html`
      <div class="row between mb-2"><div class="section-title" style="margin:0">${icon('paperclip', 'sm')} ${title} <span class="subtle small">${files.length || ''}</span></div>
      ${readOnly ? '' : html`<button class="btn sm" data-act="add">${icon('upload', 'sm')} Upload</button>`}</div>
      <div class="att-list">${files.length ? files.map((f) => fileRow(f, { removable: !readOnly })) : readOnly ? html`<p class="small subtle">No attachments.</p>` : html`<div class="dropzone small" data-act="add">${icon('upload-cloud')} <div class="mt-1">Drop files here or click to upload</div></div>`}</div>
      <div class="att-progress"></div>`);
  }

  async function upload(list) {
    for (const file of list) {
      const row = h(String(html`<div class="file-row">${fileBadge(file.name)}<div class="grow"><div class="truncate">${file.name}</div><div class="upload-progress"><span></span></div></div></div>`));
      container.querySelector('.att-progress').appendChild(row);
      try {
        const f = await uploadFile(file, { [field]: parentId }, (p) => (row.querySelector('.upload-progress span').style.width = Math.round(p * 100) + '%'));
        files.push(f);
        toast(`${file.name} uploaded`, 'success');
      } catch (e) {
        toastError(e);
      } finally {
        row.remove();
      }
    }
    render();
    onChange?.(files);
  }

  container.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const row = e.target.closest('.file-row[data-id]');
    if (act === 'add') {
      upload(await pickFiles());
    } else if (act === 'remove' && row) {
      const f = files.find((x) => x.id === +row.dataset.id);
      if (!(await confirm({ title: 'Remove attachment?', message: `"${f.name}" will be moved to the trash.`, confirmText: 'Remove' }))) return;
      try {
        await api.post(`items/file/${f.id}/trash`);
        files = files.filter((x) => x.id !== f.id);
        render();
        onChange?.(files);
        toast('Attachment moved to trash', 'success');
      } catch (err) { toastError(err); }
    } else if (row && !e.target.closest('a,button')) {
      const f = files.find((x) => x.id === +row.dataset.id);
      if (f) openFilePreview(f, files);
    }
  });
  container.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); container.querySelector('.dropzone')?.classList.add('over'); } });
  container.addEventListener('dragleave', () => container.querySelector('.dropzone')?.classList.remove('over'));
  container.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length || readOnly) return;
    e.preventDefault();
    upload(Array.from(e.dataTransfer.files));
  });
  render();
  return { get: () => files, upload };
}
export { raw };
