// Fullscreen image viewer: zoom (wheel / pinch / buttons), pan, rotate, gallery navigation, delete.
import { html, icon, h } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, toastError, confirm } from '../core/ui.js';

export function openImageViewer(images, index = 0, { onDelete, onRotate } = {}) {
  if (!images.length) return;
  let i = Math.max(0, Math.min(index, images.length - 1));
  let scale = 1, tx = 0, ty = 0, rot = 0;
  const el = h(String(html`<div class="viewer" role="dialog" aria-modal="true">
    <div class="viewer-bar">
      <div class="grow truncate" data-name style="font-weight:600"></div>
      <span class="small" data-count style="opacity:.7;margin-right:8px"></span>
      <button class="btn ghost icon" data-a="zoom-out" data-tip="Zoom out">${icon('zoom-out')}</button>
      <button class="btn ghost icon" data-a="zoom-in" data-tip="Zoom in">${icon('zoom-in')}</button>
      <button class="btn ghost icon" data-a="rotate" data-tip="Rotate">${icon('rotate-cw')}</button>
      <a class="btn ghost icon" data-a="download" data-tip="Download" download>${icon('download')}</a>
      ${onDelete !== false ? html`<button class="btn ghost icon" data-a="delete" data-tip="Delete">${icon('trash-2')}</button>` : ''}
      <button class="btn ghost icon" data-a="close" data-tip="Close (Esc)">${icon('x')}</button>
    </div>
    <div class="viewer-stage"><img alt="" draggable="false"></div>
    ${images.length > 1 ? html`<button class="viewer-nav prev" data-a="prev" aria-label="Previous">${icon('chevron-left')}</button><button class="viewer-nav next" data-a="next" aria-label="Next">${icon('chevron-right')}</button>` : ''}
    ${images.length > 1 ? html`<div class="viewer-strip">${images.map((im, k) => html`<img src="${im.thumb_url || im.url}" data-k="${k}" alt="">`)}</div>` : ''}
  </div>`));
  const img = el.querySelector('.viewer-stage img');
  const stage = el.querySelector('.viewer-stage');

  const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale}) rotate(${rot}deg)`; };
  const show = () => {
    const im = images[i];
    scale = 1; tx = 0; ty = 0; rot = 0;
    img.src = im.url + (im.v ? `&v=${im.v}` : '');
    el.querySelector('[data-name]').textContent = im.name || '';
    el.querySelector('[data-count]').textContent = images.length > 1 ? `${i + 1} / ${images.length}` : '';
    el.querySelector('[data-a="download"]').href = im.download_url || im.url;
    el.querySelectorAll('.viewer-strip img').forEach((t) => t.classList.toggle('on', +t.dataset.k === i));
    apply();
  };
  const zoom = (f, cx, cy) => {
    const ns = Math.max(0.3, Math.min(8, scale * f));
    if (cx !== undefined) {
      const r = stage.getBoundingClientRect();
      const ox = cx - r.left - r.width / 2, oy = cy - r.top - r.height / 2;
      tx = ox - (ox - tx) * (ns / scale);
      ty = oy - (oy - ty) * (ns / scale);
    }
    scale = ns;
    if (scale <= 1.001) { tx = 0; ty = 0; }
    apply();
  };
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); document.body.style.overflow = ''; };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'ArrowRight' && images.length > 1) { i = (i + 1) % images.length; show(); }
    else if (e.key === 'ArrowLeft' && images.length > 1) { i = (i - 1 + images.length) % images.length; show(); }
    else if (e.key === '+' || e.key === '=') zoom(1.25);
    else if (e.key === '-') zoom(0.8);
  };
  el.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-k]');
    if (k) { i = +k.dataset.k; show(); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) { if (e.target === stage) close(); return; }
    if (a === 'close') close();
    if (a === 'next') { i = (i + 1) % images.length; show(); }
    if (a === 'prev') { i = (i - 1 + images.length) % images.length; show(); }
    if (a === 'zoom-in') zoom(1.3);
    if (a === 'zoom-out') zoom(1 / 1.3);
    if (a === 'rotate') {
      rot = (rot + 90) % 360;
      apply();
      const im = images[i];
      if (im.id && onRotate !== false) {
        try {
          const upd = await api.post(`files/${im.id}/rotate`, { degrees: 90 });
          Object.assign(im, upd);
          onRotate?.(upd);
          rot = 0;
          img.src = upd.url + '&v=' + upd.v;
          apply();
          toast('Image rotated & saved', 'success');
        } catch (err) { toastError(err); }
      }
    }
    if (a === 'delete') {
      const im = images[i];
      if (!(await confirm({ title: 'Delete image?', message: 'The image will be moved to the trash.', confirmText: 'Delete' }))) return;
      try {
        await api.post(`items/file/${im.id}/trash`);
        onDelete?.(im);
        images.splice(i, 1);
        toast('Image moved to trash', 'success');
        if (!images.length) return close();
        i = Math.min(i, images.length - 1);
        show();
      } catch (err) { toastError(err); }
    }
  });
  // Wheel zoom, drag pan, pinch zoom
  stage.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY); }, { passive: false });
  const pts = new Map();
  let start = null;
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start = { tx, ty, scale, pts: new Map(pts) };
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      const p0 = start.pts.get(e.pointerId);
      if (!p0) return;
      tx = start.tx + (e.clientX - p0.x);
      ty = start.ty + (e.clientY - p0.y);
      apply();
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const [a0, b0] = [...start.pts.values()];
      if (!a0 || !b0) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y), d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y) || 1;
      scale = Math.max(0.3, Math.min(8, start.scale * (d / d0)));
      apply();
    }
  });
  const end = (e) => { pts.delete(e.pointerId); start = { tx, ty, scale, pts: new Map(pts) }; if (!pts.size) stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('dblclick', (e) => zoom(scale > 1.5 ? 1 / scale : 2.2, e.clientX, e.clientY));

  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  show();
}
