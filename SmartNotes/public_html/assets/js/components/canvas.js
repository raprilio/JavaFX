// Shared SVG stage for the mind-map and flowchart editors:
// pan (drag / wheel), zoom (wheel / buttons / pinch), coordinate conversion, grid, text measuring and export.
import { loadScript, downloadBlob } from '../core/dom.js';

const NS = 'http://www.w3.org/2000/svg';
export const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  return e;
};

export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => cs.getPropertyValue(n).trim() || d;
  return {
    bg: v('--bg', '#f5f6f8'), elev: v('--bg-elev', '#ffffff'), soft: v('--bg-soft', '#f0f1f4'), border: v('--border-strong', '#d5d8e0'),
    text: v('--text', '#161a22'), text2: v('--text-2', '#586071'), accent: v('--accent', '#6366f1'), dark: document.documentElement.dataset.theme === 'dark',
  };
}

const measureCtx = document.createElement('canvas').getContext('2d');
export const FONT_STACK = "InterVariable, Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
/** Wrap text into lines that fit maxWidth; returns {lines, width, lineHeight}. */
export function wrapText(text, { size = 14, weight = 500, maxWidth = 220 } = {}) {
  measureCtx.font = `${weight} ${size}px ${FONT_STACK}`;
  const lines = [];
  const paragraphs = String(text || '').split('\n');
  let width = 0;
  for (const p of paragraphs) {
    const words = p.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (measureCtx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        width = Math.max(width, measureCtx.measureText(line).width);
        line = w;
      } else line = test;
      // hard-break very long words
      while (measureCtx.measureText(line).width > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measureCtx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        width = Math.max(width, measureCtx.measureText(line.slice(0, cut)).width);
        line = line.slice(cut);
      }
    }
    lines.push(line);
    width = Math.max(width, measureCtx.measureText(line).width);
  }
  return { lines: lines.length ? lines : [''], width: Math.max(width, 10), lineHeight: Math.round(size * 1.35) };
}

/** Append centered multi-line text to a group. */
export function textBlock(g, lines, { cx, cy, size, weight, color, lineHeight, anchor = 'middle' }) {
  const t = svgEl('text', { x: cx, 'text-anchor': anchor, fill: color, 'font-size': size, 'font-weight': weight, 'font-family': FONT_STACK });
  const total = lines.length * lineHeight;
  lines.forEach((ln, i) => {
    const ts = svgEl('tspan', { x: cx, y: cy - total / 2 + lineHeight * (i + 0.5), 'dominant-baseline': 'central' });
    ts.textContent = ln || ' ';
    t.appendChild(ts);
  });
  g.appendChild(t);
  return t;
}

export function createStage(container, { grid = false, onChange } = {}) {
  const svg = svgEl('svg', { class: 'stage', tabindex: '0' });
  const defs = svgEl('defs');
  const pattern = svgEl('pattern', { id: 'sn-grid-' + Math.random().toString(36).slice(2), width: 20, height: 20, patternUnits: 'userSpaceOnUse' });
  const dot = svgEl('circle', { cx: 1, cy: 1, r: 1.1 });
  pattern.appendChild(dot);
  defs.appendChild(pattern);
  svg.appendChild(defs);
  const gridRect = svgEl('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: `url(#${pattern.id})`, class: 'ui-only', 'data-bg': '1' });
  svg.appendChild(gridRect);
  const viewport = svgEl('g', { class: 'viewport' });
  svg.appendChild(viewport);
  container.appendChild(svg);

  const vp = { x: 0, y: 0, zoom: 1 };
  let gridOn = grid;

  function apply() {
    viewport.setAttribute('transform', `translate(${vp.x} ${vp.y}) scale(${vp.zoom})`);
    const s = 20 * vp.zoom;
    pattern.setAttribute('width', s);
    pattern.setAttribute('height', s);
    pattern.setAttribute('x', vp.x % s);
    pattern.setAttribute('y', vp.y % s);
    dot.setAttribute('r', Math.max(0.6, 1.1 * Math.min(1.4, vp.zoom)));
    dot.setAttribute('fill', themeColors().dark ? 'rgba(255,255,255,.09)' : 'rgba(15,23,42,.13)');
    gridRect.style.display = gridOn ? '' : 'none';
    onChange?.(vp);
  }
  const toWorld = (cx, cy) => {
    const r = svg.getBoundingClientRect();
    return { x: (cx - r.left - vp.x) / vp.zoom, y: (cy - r.top - vp.y) / vp.zoom };
  };
  const zoomAt = (factor, cx, cy) => {
    const r = svg.getBoundingClientRect();
    if (cx === undefined) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    const nz = Math.max(0.15, Math.min(3.5, vp.zoom * factor));
    const px = cx - r.left, py = cy - r.top;
    vp.x = px - ((px - vp.x) * nz) / vp.zoom;
    vp.y = py - ((py - vp.y) * nz) / vp.zoom;
    vp.zoom = nz;
    apply();
  };
  const fit = (bbox, pad = 60, maxZoom = 1.2) => {
    const r = svg.getBoundingClientRect();
    if (!bbox || !r.width) return;
    const z = Math.min(maxZoom, Math.max(0.15, Math.min((r.width - pad * 2) / Math.max(bbox.w, 1), (r.height - pad * 2) / Math.max(bbox.h, 1))));
    vp.zoom = z;
    vp.x = r.width / 2 - (bbox.x + bbox.w / 2) * z;
    vp.y = r.height / 2 - (bbox.y + bbox.h / 2) * z;
    apply();
  };
  const centerOn = (wx, wy) => {
    const r = svg.getBoundingClientRect();
    vp.x = r.width / 2 - wx * vp.zoom;
    vp.y = r.height / 2 - wy * vp.zoom;
    apply();
  };

  // ---------------------------------------------------------- pan & pinch
  const pointers = new Map();
  let pan = null, pinch = null;
  let panEnabled = () => true;
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, zoom: vp.zoom, x: vp.x, y: vp.y };
      pan = null;
      stage.cancelInteraction?.();
      return;
    }
    const isBg = e.target === svg || e.target === gridRect || e.target.dataset?.bg;
    if ((isBg && panEnabled(e)) || e.button === 1 || stage.spaceDown) {
      pan = { sx: e.clientX, sy: e.clientY, x: vp.x, y: vp.y, moved: false };
      container.classList.add('panning');
      svg.setPointerCapture(e.pointerId);
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const r = svg.getBoundingClientRect();
      const nz = Math.max(0.15, Math.min(3.5, pinch.zoom * (d / (pinch.d || 1))));
      const px = pinch.cx - r.left, py = pinch.cy - r.top;
      vp.zoom = nz;
      vp.x = px - ((px - pinch.x) * nz) / pinch.zoom + (cx - pinch.cx);
      vp.y = py - ((py - pinch.y) * nz) / pinch.zoom + (cy - pinch.cy);
      apply();
      return;
    }
    if (pan) {
      const dx = e.clientX - pan.sx, dy = e.clientY - pan.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
      vp.x = pan.x + dx;
      vp.y = pan.y + dy;
      apply();
    }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pan) {
      const moved = pan.moved;
      pan = null;
      container.classList.remove('panning');
      if (!moved && (e.target === svg || e.target === gridRect)) stage.onBackgroundClick?.(e);
    }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || (e.deltaMode === 1) || (Math.abs(e.deltaY) >= 50 && !e.deltaX && Number.isInteger(e.deltaY))) {
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    } else {
      vp.x -= e.shiftKey ? e.deltaY : e.deltaX;
      vp.y -= e.shiftKey ? 0 : e.deltaY;
      apply();
    }
  }, { passive: false });
  const ro = new ResizeObserver(() => apply());
  ro.observe(container);

  const stage = {
    svg, defs, viewport, vp, toWorld, zoomAt, fit, centerOn, apply,
    spaceDown: false,
    setViewport(v) { if (v) { vp.x = +v.x || 0; vp.y = +v.y || 0; vp.zoom = +v.zoom || 1; } apply(); },
    setGrid(on) { gridOn = on; apply(); },
    setPanFilter(fn) { panEnabled = fn; },
    isPinching: () => !!pinch,
    destroy() { ro.disconnect(); svg.remove(); },
  };
  apply();
  return stage;
}

// ------------------------------------------------------------------ export
function buildExportSvg(stage, bbox, background, pad = 40) {
  const clone = stage.svg.cloneNode(true);
  clone.querySelectorAll('.ui-only, .sel-ring, .fc-port, .fc-handle, .mm-toggle-ui').forEach((n) => n.remove());
  const vpG = clone.querySelector('.viewport');
  vpG.removeAttribute('transform');
  const w = Math.ceil(bbox.w + pad * 2), hgt = Math.ceil(bbox.h + pad * 2);
  clone.setAttribute('xmlns', NS);
  clone.setAttribute('viewBox', `${bbox.x - pad} ${bbox.y - pad} ${w} ${hgt}`);
  clone.setAttribute('width', w);
  clone.setAttribute('height', hgt);
  clone.removeAttribute('class');
  clone.removeAttribute('tabindex');
  const bg = svgEl('rect', { x: bbox.x - pad, y: bbox.y - pad, width: w, height: hgt, fill: background });
  clone.insertBefore(bg, clone.firstChild.nextSibling);
  clone.querySelectorAll('text').forEach((t) => t.setAttribute('font-family', "Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"));
  return { svgText: new XMLSerializer().serializeToString(clone), w, h: hgt };
}

export function exportSvg(stage, bbox, background, name) {
  const { svgText } = buildExportSvg(stage, bbox, background);
  downloadBlob(new Blob([svgText], { type: 'image/svg+xml' }), name + '.svg');
}

export function renderPng(stage, bbox, background, scale = 2) {
  const { svgText, w, h } = buildExportSvg(stage, bbox, background);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const max = 8000;
      const s = Math.min(scale, max / w, max / h);
      const c = document.createElement('canvas');
      c.width = Math.round(w * s);
      c.height = Math.round(h * s);
      const ctx = c.getContext('2d');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ canvas: c, w, h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not render the image.')); };
    img.src = url;
  });
}

export async function exportPng(stage, bbox, background, name) {
  const { canvas } = await renderPng(stage, bbox, background);
  canvas.toBlob((b) => downloadBlob(b, name + '.png'), 'image/png');
}

export async function exportPdf(stage, bbox, background, name) {
  const [{ canvas, w, h }] = await Promise.all([renderPng(stage, bbox, background, 2), loadScript('assets/vendor/jspdf.min.js')]);
  const { jsPDF } = window.jspdf;
  const landscape = w >= h;
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
  const margin = 28;
  const s = Math.min((pw - margin * 2) / w, (ph - margin * 2 - 20) / h);
  pdf.setFontSize(12);
  pdf.text(name, margin, margin);
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pw - w * s) / 2, margin + 14, w * s, h * s);
  pdf.save(name + '.pdf');
}

export const safeName = (s) => (String(s || 'diagram').replace(/[\\/:*?"<>|]+/g, '').trim() || 'diagram').slice(0, 80);
