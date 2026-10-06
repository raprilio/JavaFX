// File preview (image / PDF via pdf.js / audio / text) and the Drive file details drawer.
import { html, icon, h, fmtBytes, fmtDateTime, timeAgo, fileBadge, esc } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { modal, drawer, toast, toastError, confirm } from '../core/ui.js';
import { openImageViewer } from './imageViewer.js';
import { tagInput, normalizeTag } from './tagInput.js';
import { refreshTags } from './forms.js';

const base = () => new URL('.', document.baseURI).href;
let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    const src = base() + 'assets/vendor/pdfjs/pdf.min.mjs';
    pdfjsPromise = import(/* @vite-ignore */ src).then((m) => {
      m.GlobalWorkerOptions.workerSrc = base() + 'assets/vendor/pdfjs/pdf.worker.min.mjs';
      return m;
    }).catch((e) => { pdfjsPromise = null; throw e; });
  }
  return pdfjsPromise;
}

/** In-app PDF viewer (works on mobile, where browsers cannot show PDFs inside a page). */
export async function openPdfViewer(file) {
  const body = h(String(html`<div class="pdf-viewer">
    <div class="pdf-bar">
      <button class="btn ghost icon sm" data-p="prev" aria-label="Previous page">${icon('chevron-up', 'sm')}</button>
      <span class="small"><input class="input sm pdf-page" type="number" min="1" value="1" data-page> / <span data-pages>…</span></span>
      <button class="btn ghost icon sm" data-p="next" aria-label="Next page">${icon('chevron-down', 'sm')}</button>
      <span class="divider-v"></span>
      <button class="btn ghost icon sm" data-p="out" aria-label="Zoom out">${icon('zoom-out', 'sm')}</button>
      <span class="small subtle" data-zoom>100%</span>
      <button class="btn ghost icon sm" data-p="in" aria-label="Zoom in">${icon('zoom-in', 'sm')}</button>
      <button class="btn ghost icon sm" data-p="fit" data-tip="Fit width">${icon('maximize', 'sm')}</button>
      <div class="grow"></div>
      <a class="btn ghost icon sm" href="${file.url}" target="_blank" rel="noopener" data-tip="Open in new tab">${icon('external-link', 'sm')}</a>
      <a class="btn ghost icon sm" href="${file.download_url}" data-tip="Download">${icon('download', 'sm')}</a>
    </div>
    <div class="pdf-pages" data-scroll><div style="padding:60px;text-align:center"><span class="spinner"></span></div></div>
  </div>`));
  const m = modal({ title: file.name, body, size: 'xl', className: 'pdf-modal' });
  m.body.style.padding = '0';
  const scroller = body.querySelector('[data-scroll]');
  let doc, zoom = 1, fitScale = 1, observer;
  try {
    const pdfjs = await loadPdfJs();
    doc = await pdfjs.getDocument({
      url: new URL(file.url, document.baseURI).href,
      isEvalSupported: false,
      standardFontDataUrl: base() + 'assets/vendor/pdfjs/standard_fonts/',
      withCredentials: true,
    }).promise;
  } catch (e) {
    scroller.innerHTML = String(html`<div class="empty"><div class="empty-art">${icon('file-warning', 'xl')}</div><h3>Cannot display this PDF</h3><p>${e.message || ''}</p><a class="btn primary" href="${file.download_url}">Download instead</a></div>`);
    return;
  }
  body.querySelector('[data-pages]').textContent = doc.numPages;
  body.querySelector('[data-page]').max = doc.numPages;
  const first = await doc.getPage(1);
  const vp1 = first.getViewport({ scale: 1 });
  const computeFit = () => { fitScale = Math.max(0.3, (scroller.clientWidth - 32) / vp1.width); };
  computeFit();

  const rendered = new Map();
  async function renderPage(n, holder) {
    const scale = fitScale * zoom;
    if (rendered.get(n) === scale) return;
    rendered.set(n, scale);
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = Math.floor(vp.width) + 'px';
    canvas.style.height = Math.floor(vp.height) + 'px';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
    holder.replaceChildren(canvas);
  }
  function layout() {
    observer?.disconnect();
    rendered.clear();
    const scale = fitScale * zoom;
    body.querySelector('[data-zoom]').textContent = Math.round(zoom * 100) + '%';
    scroller.innerHTML = '';
    for (let n = 1; n <= doc.numPages; n++) {
      const holder = document.createElement('div');
      holder.className = 'pdf-page-holder';
      holder.dataset.n = n;
      holder.style.width = Math.floor(vp1.width * scale) + 'px';
      holder.style.height = Math.floor(vp1.height * scale) + 'px';
      scroller.appendChild(holder);
    }
    observer = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) renderPage(+en.target.dataset.n, en.target).catch(() => {});
      if (en.isIntersecting && en.intersectionRatio > 0.4) body.querySelector('[data-page]').value = en.target.dataset.n;
    }), { root: scroller, rootMargin: '300px 0px', threshold: [0, 0.4] });
    scroller.querySelectorAll('.pdf-page-holder').forEach((x) => observer.observe(x));
  }
  layout();
  const go = (n) => scroller.querySelector(`[data-n="${Math.max(1, Math.min(doc.numPages, n))}"]`)?.scrollIntoView({ block: 'start' });
  body.addEventListener('click', (e) => {
    const p = e.target.closest('[data-p]')?.dataset.p;
    const cur = +body.querySelector('[data-page]').value || 1;
    if (p === 'prev') go(cur - 1);
    if (p === 'next') go(cur + 1);
    if (p === 'in') { zoom = Math.min(4, zoom * 1.25); layout(); }
    if (p === 'out') { zoom = Math.max(0.4, zoom / 1.25); layout(); }
    if (p === 'fit') { zoom = 1; computeFit(); layout(); }
  });
  body.querySelector('[data-page]').addEventListener('change', (e) => go(+e.target.value));
  m.result.then(() => { observer?.disconnect(); doc?.destroy(); });
}

async function openText(file) {
  const m = modal({ title: file.name, size: 'lg', body: '<div style="padding:30px;text-align:center"><span class="spinner"></span></div>', actions: [{ label: 'Download', icon: 'download', onClick: () => { window.location.href = file.download_url; return false; } }, { label: 'Close' }] });
  try {
    const r = await fetch(file.url, { credentials: 'same-origin' });
    const t = await r.text();
    m.body.innerHTML = String(html`<pre class="code-box" style="max-height:65vh;overflow:auto;white-space:pre-wrap">${t.slice(0, 200000)}</pre>`);
  } catch (e) { m.body.textContent = e.message; }
}

/** Open the right previewer for any file. `list` enables gallery navigation for images. */
export function openFilePreview(file, list = [file]) {
  switch (file.preview || (file.kind === 'image' ? 'image' : file.mime_type === 'application/pdf' ? 'pdf' : 'none')) {
    case 'image': {
      const imgs = list.filter((x) => x.kind === 'image');
      return openImageViewer(imgs, Math.max(0, imgs.findIndex((x) => x.id === file.id)));
    }
    case 'pdf': return openPdfViewer(file);
    case 'audio':
      return modal({ title: file.name, size: 'sm', body: html`<audio controls autoplay src="${file.url}" style="width:100%"></audio>`, actions: [{ label: 'Close' }] });
    case 'video':
      return modal({
        title: file.name, size: 'xl', className: 'video-modal',
        body: html`<video class="video-player" controls autoplay playsinline preload="metadata" src="${file.url}"></video>`,
        actions: [{ label: 'Download', icon: 'download', left: true, onClick: () => { window.location.href = file.download_url; } }, { label: 'Close' }],
      });
    case 'text': return openText(file);
    default:
      return modal({
        title: file.name, size: 'sm',
        body: html`<div class="empty" style="padding:20px 0">${fileBadge(file.name)}<h3 class="mt-2">No preview available</h3><p>Office documents and archives can't be rendered privately in the browser. Download the file to open it.</p></div>`,
        actions: [{ label: 'Close' }, { label: 'Download', variant: 'primary', icon: 'download', onClick: () => { window.location.href = file.download_url; } }],
      });
  }
}

/** Details drawer for a Drive file: rename, description, tags, folder, star, related notes. */
export function openFileDetails(file, { folders = [], onChange } = {}) {
  let f = { ...file };
  const tags = tagInput({ value: f.tags || [], suggestions: state.tags.map((t) => t.name), placeholder: 'Add tag, e.g. ktp', normalize: normalizeTag, prefix: '#' });
  const body = h(String(html`<div class="col" style="gap:14px">
    <div class="file-hero" data-preview>${f.kind === 'image' ? html`<img src="${f.thumb_url}" alt="">` : fileBadge(f.name)}
      <button class="btn sm" data-a="preview">${icon('eye', 'sm')} Preview</button></div>
    <div class="field" style="margin:0"><label>Name</label><input class="input" data-name value="${f.name}"></div>
    <div class="field" style="margin:0"><label>Description</label><textarea class="textarea" rows="3" data-desc placeholder="What is this file? e.g. Scan KTP keluarga 2026">${f.description || ''}</textarea></div>
    <div class="field" style="margin:0"><label>Tags <span class="subtle small">— notes with the same tag link to this file</span></label><div data-tags></div></div>
    <div class="field" style="margin:0"><label>Folder</label><select class="select" data-folder><option value="">My Drive (root)</option>${folders.map((x) => html`<option value="${x.id}" ${x.id === f.folder_id ? 'selected' : ''}>${x.label || x.name}</option>`)}</select></div>
    <label class="check"><input type="checkbox" data-star ${f.is_starred ? 'checked' : ''}> ${icon('star', 'sm')} Starred</label>
    <dl class="kv small"><dt>Type</dt><dd>${f.mime_type}</dd><dt>Size</dt><dd>${fmtBytes(f.size)}</dd><dt>Uploaded</dt><dd>${fmtDateTime(f.created_at)}</dd>
      ${f.last_opened_at ? html`<dt>Last opened</dt><dd>${timeAgo(f.last_opened_at)}</dd>` : ''}${f.note_id ? html`<dt>Attached to</dt><dd><a href="#/notes/${f.note_id}">${f.note_title || 'Note'}</a></dd>` : ''}</dl>
    <div><div class="label mb-1">Related notes</div><div data-related><span class="spinner"></span></div></div>
  </div>`));
  body.querySelector('[data-tags]').appendChild(tags.el);
  const d = drawer({
    title: 'File details',
    body,
    footer: `<button class="btn ghost danger-text left" data-a="delete">${icon('trash-2', 'sm')} Delete</button><a class="btn" href="${esc(f.download_url)}">${icon('download', 'sm')} Download</a><button class="btn primary" data-a="save">Save</button>`,
  });
  api.get(`files/${f.id}/related`).then((rows) => {
    body.querySelector('[data-related]').innerHTML = rows.length ? rows.map((n) => String(html`<a class="list-item" href="#/notes/${n.id}" style="padding:7px 6px"><span class="li-icon">${icon('notebook-pen', 'sm')}</span><div class="li-main"><div class="li-title">${n.title || 'Untitled note'}</div><div class="li-sub">${n.excerpt || ''}</div></div></a>`)).join('')
      : '<p class="small subtle">No notes share a tag with this file yet. Add the same #tag to a note to link them.</p>';
  }).catch(() => (body.querySelector('[data-related]').textContent = ''));
  d.root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'preview') openFilePreview(f);
    if (a === 'save') {
      try {
        f = await api.post(`files/${f.id}`, {
          name: body.querySelector('[data-name]').value.trim() || f.name,
          description: body.querySelector('[data-desc]').value,
          tags: tags.get(),
          folder_id: body.querySelector('[data-folder]').value || null,
          is_starred: body.querySelector('[data-star]').checked,
        });
        toast('File saved', 'success');
        refreshTags();
        onChange?.(f);
        d.close(f);
      } catch (err) { toastError(err); }
    }
    if (a === 'delete') {
      if (!(await confirm({ title: 'Delete file?', message: `"${f.name}" will be moved to the trash.`, confirmText: 'Delete' }))) return;
      try { await api.post(`items/file/${f.id}/trash`); toast('File moved to trash', 'success'); onChange?.(null); d.close(null); } catch (err) { toastError(err); }
    }
  });
  return d.result;
}
