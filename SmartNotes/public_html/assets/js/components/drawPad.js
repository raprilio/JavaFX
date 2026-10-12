// Handwriting canvas for notes (S Pen, Apple Pencil, any stylus, mouse or finger).
// - Pointer Events with pressure and coalesced events for smooth, low-latency ink.
// - Pen-only mode (palm rejection): when a pen is detected, fingers scroll instead of drawing.
// - Stylus eraser end, or the S Pen side button held down, erases.
// - Strokes are stored as vectors in a 1000-unit wide coordinate space, so they look the same on every screen.
// - v1.10: real pages (A4 ratio, like Samsung Notes). Scrolling past the last written page adds a new one.
//   Strokes keep one continuous y axis (page n spans n*PAGE_H … (n+1)*PAGE_H); only pages near the
//   viewport get canvases, so long notebooks stay light on tablets.
import { html, icon, h } from '../core/dom.js';
import { toast, confirm } from '../core/ui.js';

export const W = 1000;
export const PAGE_H = 1414; // A4: 1000 × 1414
export const MAX_PAGES = 50;
const PEN_COLORS = ['#111827', '#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#64748b'];
const HL_COLORS = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74'];
const SIZES = { pen: [1.5, 3, 5, 9], hl: [14, 22, 32], eraser: [10, 22, 44] };
const PREF_KEY = 'sn.drawpad';

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

/** Draw one stroke onto a 2D context scaled by k (canvas px per logical unit). */
export function drawStroke(ctx, s, k) {
  const p = s.p;
  const n = p.length / 3;
  if (!n) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.c;
  ctx.fillStyle = s.c;
  if (s.t === 'hl') {
    // Highlighter: one path, constant width, translucent — overlapping segments never darken.
    ctx.globalAlpha = 0.38;
    ctx.lineWidth = s.s * k;
    ctx.beginPath();
    ctx.moveTo(p[0] * k, p[1] * k);
    if (n === 1) ctx.lineTo(p[0] * k + 0.1, p[1] * k);
    for (let i = 1; i < n; i++) ctx.lineTo(p[i * 3] * k, p[i * 3 + 1] * k);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const width = (pr) => Math.max(0.6, s.s * k * (0.35 + 0.9 * pr));
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(p[0] * k, p[1] * k, width(p[2]) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  // Pen: quadratic curves through segment midpoints, width follows pressure.
  let mx = p[0], my = p[1];
  for (let i = 1; i < n; i++) {
    const x = p[i * 3], y = p[i * 3 + 1];
    const nx = i < n - 1 ? (x + p[(i + 1) * 3]) / 2 : x;
    const ny = i < n - 1 ? (y + p[(i + 1) * 3 + 1]) / 2 : y;
    ctx.lineWidth = width((p[(i - 1) * 3 + 2] + p[i * 3 + 2]) / 2);
    ctx.beginPath();
    ctx.moveTo(mx * k, my * k);
    ctx.quadraticCurveTo(x * k, y * k, nx * k, ny * k);
    ctx.stroke();
    mx = nx; my = ny;
  }
  ctx.restore();
}

export function bounds(s) {
  if (!s.b) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < s.p.length; i += 3) {
      x0 = Math.min(x0, s.p[i]); x1 = Math.max(x1, s.p[i]);
      y0 = Math.min(y0, s.p[i + 1]); y1 = Math.max(y1, s.p[i + 1]);
    }
    const pad = s.s;
    s.b = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
  return s.b;
}

/** Saved data (v1 single sheet or v2 pages) → { pages, bg, strokes }. */
export function normalizeDrawing(data) {
  const strokes = (data?.strokes || []).map((s) => ({ t: s.t, c: s.c, s: s.s, p: s.p.slice() }));
  let maxY = 0;
  strokes.forEach((s) => { maxY = Math.max(maxY, bounds(s)[3]); });
  const declared = data?.v === 2 ? +data.pages || 1 : Math.ceil((+data?.h || PAGE_H) / PAGE_H);
  const pages = Math.max(1, Math.min(MAX_PAGES, Math.max(declared, Math.ceil((maxY - 10) / PAGE_H))));
  return { pages, bg: data?.bg || 'none', strokes };
}

/** Paint page `pg` of `strokes` onto ctx (canvas px per unit = k). */
export function renderPage(ctx, strokes, pg, k) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const top = pg * PAGE_H, bottom = top + PAGE_H;
  ctx.setTransform(1, 0, 0, 1, 0, -top * k);
  for (const s of strokes) {
    const b = bounds(s);
    if (b[3] >= top && b[1] <= bottom) drawStroke(ctx, s, k);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Strokes that start on page pg (used by "clear page" and "delete page"). */
const onPage = (s, pg) => Math.floor(s.p[1] / PAGE_H) === pg;

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}

function hits(s, x, y, r) {
  const [x0, y0, x1, y1] = bounds(s);
  if (x < x0 - r || x > x1 + r || y < y0 - r || y > y1 + r) return false;
  const p = s.p;
  const rr = r + s.s / 2;
  if (p.length === 3) return Math.hypot(p[0] - x, p[1] - y) <= rr;
  for (let i = 3; i < p.length; i += 3) {
    if (distToSeg(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) <= rr) return true;
  }
  return false;
}

/** Render strokes to a transparent PNG: the pages one below the other, cropped to the used height. */
export async function exportPng(strokes, pages) {
  let maxY = 0;
  strokes.forEach((s) => { maxY = Math.max(maxY, bounds(s)[3]); });
  const hLog = Math.max(120, Math.min(pages * PAGE_H, Math.ceil(maxY + 24)));
  const sc = Math.min(2, Math.sqrt(16e6 / (W * hLog)), 16000 / hLog);
  const c = document.createElement('canvas');
  c.width = Math.round(W * sc);
  c.height = Math.round(hLog * sc);
  const ctx = c.getContext('2d');
  // Page breaks as a light dashed line so a multi-page drawing still reads as pages.
  ctx.save();
  ctx.strokeStyle = 'rgba(148,163,184,.7)';
  ctx.lineWidth = Math.max(1, 2 * sc);
  ctx.setLineDash([12 * sc, 10 * sc]);
  for (let y = PAGE_H; y < hLog; y += PAGE_H) {
    ctx.beginPath(); ctx.moveTo(0, y * sc); ctx.lineTo(c.width, y * sc); ctx.stroke();
  }
  ctx.restore();
  strokes.forEach((s) => drawStroke(ctx, s, sc));
  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
}

/**
 * Open the full-screen handwriting editor.
 * @returns {Promise<null | {remove: true} | {data: object, blob: Blob}>}
 */
export function openDrawingEditor({ data = null, title = 'Handwriting' } = {}) {
  const prefs = loadPrefs();
  const start = normalizeDrawing(data);
  let strokes = start.strokes;
  let pages = start.pages;
  let bg = data ? start.bg : prefs.bg || 'lines';
  let tool = 'pen';
  const color = { pen: prefs.penColor || PEN_COLORS[0], hl: prefs.hlColor || HL_COLORS[0] };
  const size = { pen: prefs.penSize ?? 1, hl: prefs.hlSize ?? 1, eraser: prefs.eraserSize ?? 1 };
  let penOnly = !!prefs.penOnly;
  let penSeen = false;
  const undoStack = [];
  const redoStack = [];
  let dirty = false;

  return new Promise((resolve) => {
    const root = h(String(html`<div class="draw-root" role="dialog" aria-modal="true" aria-label="${title}">
      <header class="draw-bar">
        <button class="btn ghost sm" data-d="cancel">${icon('x', 'sm')}<span class="hide-sm">Cancel</span></button>
        <div class="draw-tools">
          <div class="btn-group">
            <button class="btn sm" data-tool="pen" data-tip="Pen (P)" aria-label="Pen">${icon('pen-line', 'sm')}</button>
            <button class="btn sm" data-tool="hl" data-tip="Highlighter (H)" aria-label="Highlighter">${icon('highlighter', 'sm')}</button>
            <button class="btn sm" data-tool="eraser" data-tip="Eraser (E) — or the pen's eraser end / S Pen button" aria-label="Eraser">${icon('eraser', 'sm')}</button>
          </div>
          <div class="draw-colors" data-colors></div>
          <div class="draw-sizes" data-sizes></div>
          <span class="draw-sep"></span>
          <button class="btn ghost icon sm" data-d="undo" data-tip="Undo (Ctrl+Z)" aria-label="Undo">${icon('undo-2', 'sm')}</button>
          <button class="btn ghost icon sm" data-d="redo" data-tip="Redo (Ctrl+Y)" aria-label="Redo">${icon('redo-2', 'sm')}</button>
          <button class="btn ghost icon sm" data-d="bg" data-tip="Paper" aria-label="Paper">${icon('notebook', 'sm')}</button>
          <button class="btn ghost icon sm" data-d="penonly" data-tip="Pen only: fingers scroll, palm is ignored" aria-label="Pen only">${icon('hand', 'sm')}</button>
          <button class="btn ghost icon sm" data-d="addpage" data-tip="Add a page" aria-label="Add page">${icon('file-plus', 'sm')}</button>
          <span class="draw-pageinfo" data-pageinfo aria-live="polite"></span>
          <button class="btn ghost sm draw-zoom" data-d="zoom" data-tip="Zoom — pinch with two fingers or Ctrl + wheel. Click to fit the width" aria-label="Reset zoom"><span data-zoomval>100%</span></button>
        </div>
        <button class="btn primary sm" data-d="save">${icon('check', 'sm')} Done</button>
      </header>
      <div class="draw-scroll" data-scroll>
        <div class="draw-pages" data-pages></div>
        <button type="button" class="draw-newpage" data-d="addpage" data-sentinel>${icon('file-plus', 'sm')} <span>New page</span></button>
      </div>
      <div class="draw-hint" data-hint></div>
    </div>`));
    const scroller = root.querySelector('[data-scroll]');
    const wrap = root.querySelector('[data-pages]');
    let k = 1; // css px per logical unit
    let cssW = 0;
    let zoom = 1; // v1.12: pinch / Ctrl+wheel zoom on top of "page fits the width"
    const ZMIN = 0.5, ZMAX = 4;
    let quietUntil = 0; // no automatic new page right after pages were removed (the shrink scrolls by itself)
    const els = []; // per page: { el, ink, live, ictx, lctx, dpr, on }

    // ------------------------------------------------------------ pages
    function pageEl(i) {
      const el = h(`<section class="draw-paper draw-page" data-pg="${i}" data-bg="${bg}"><canvas data-ink></canvas><canvas data-live></canvas>
        <footer class="draw-page-foot"><span data-num></span><button type="button" class="btn ghost icon xs" data-delpage aria-label="Delete page" data-tip="Delete page">${icon('trash-2', 'sm')}</button></footer></section>`);
      const ink = el.querySelector('[data-ink]');
      const live = el.querySelector('[data-live]');
      return { el, ink, live, ictx: ink.getContext('2d'), lctx: live.getContext('2d'), dpr: 1, on: false };
    }
    function syncPages() {
      while (els.length < pages) {
        const p = pageEl(els.length);
        els.push(p);
        wrap.appendChild(p.el);
        io.observe(p.el);
      }
      while (els.length > pages) {
        const p = els.pop();
        io.unobserve(p.el);
        free(p);
        p.el.remove();
      }
      els.forEach((p, i) => {
        p.el.dataset.pg = i;
        p.el.querySelector('[data-num]').textContent = `${i + 1} / ${pages}`;
        sizePage(p);
      });
      pageInfo();
    }
    function sizePage(p, live = false) {
      const cssH = PAGE_H * k;
      p.el.style.width = cssW + 'px';
      p.el.style.height = cssH + 'px';
      p.el.style.setProperty('--line', 40 * k + 'px');
      p.el.dataset.bg = bg;
      if (!p.on) return;
      // While pinching only the CSS size changes (the bitmap stretches); it is redrawn sharp when the fingers lift.
      if (live) [p.ink, p.live].forEach((c) => { c.style.width = cssW + 'px'; c.style.height = cssH + 'px'; });
      else alloc(p);
    }
    function alloc(p) {
      const cssH = PAGE_H * k;
      // Keep each canvas at or below ~8 MP: only pages near the viewport have canvases.
      p.dpr = Math.min(window.devicePixelRatio || 1, 2.5, Math.sqrt(8e6 / (cssW * cssH)));
      [p.ink, p.live].forEach((c) => {
        c.width = Math.round(cssW * p.dpr);
        c.height = Math.round(cssH * p.dpr);
        c.style.width = cssW + 'px';
        c.style.height = cssH + 'px';
      });
      p.on = true;
      paintPage(els.indexOf(p));
    }
    function free(p) {
      if (!p.on) return;
      p.on = false;
      [p.ink, p.live].forEach((c) => { c.width = 0; c.height = 0; });
    }
    function paintPage(i) {
      const p = els[i];
      if (p?.on) renderPage(p.ictx, strokes, i, k * p.dpr);
    }
    const paintAll = () => els.forEach((p, i) => p.on && paintPage(i));
    /** Repaint the pages a list of strokes touches. */
    function paintFor(list) {
      const set = new Set();
      list.forEach((s) => { const b = bounds(s); for (let i = Math.max(0, Math.floor(b[1] / PAGE_H)); i <= Math.min(pages - 1, Math.floor(b[3] / PAGE_H)); i++) set.add(i); });
      set.forEach(paintPage);
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const p = els.find((x) => x.el === en.target);
        if (!p) return;
        if (en.isIntersecting) { if (!p.on) alloc(p); } else free(p);
      });
    }, { root: scroller, rootMargin: '120% 0px' });

    function layout(live = false) {
      cssW = Math.min(scroller.clientWidth - 24, 1150) * zoom;
      k = cssW / W;
      els.forEach((p) => sizePage(p, live));
      const zv = root.querySelector('[data-zoomval]');
      if (zv) zv.textContent = Math.round(zoom * 100) + '%';
    }
    /** Zoom to z keeping the content point under (cx, cy) (client px) in place. */
    function zoomAt(z, cx, cy, live = false, from = null) {
      z = Math.min(ZMAX, Math.max(ZMIN, z));
      const r = scroller.getBoundingClientRect();
      const f = from || { x: scroller.scrollLeft + cx - r.left, y: scroller.scrollTop + cy - r.top, z: zoom };
      zoom = z;
      layout(live);
      scroller.scrollLeft = f.x * (z / f.z) - (cx - r.left);
      scroller.scrollTop = f.y * (z / f.z) - (cy - r.top);
      pageInfo();
    }
    const pageHasInk = (i) => strokes.some((s) => onPage(s, i));
    function currentPage() {
      const mid = scroller.scrollTop + scroller.clientHeight / 2;
      let best = 0;
      els.forEach((p, i) => { if (p.el.offsetTop <= mid) best = i; });
      return best;
    }
    function pageInfo() {
      root.querySelector('[data-pageinfo]').textContent = `${currentPage() + 1} / ${pages}`;
    }
    function addPage({ scroll = false, record = true } = {}) {
      if (pages >= MAX_PAGES) { hint(`A drawing can have up to ${MAX_PAGES} pages.`); return false; }
      const before = { strokes: strokes.slice(), pages };
      pages++;
      syncPages();
      if (record) commit({ op: 'snap', before, after: { strokes: strokes.slice(), pages } });
      if (scroll) els[pages - 1].el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    }
    async function deletePage(i) {
      const has = pageHasInk(i);
      if (has && !(await confirm({ title: `Delete page ${i + 1}?`, message: 'The page and its handwriting are removed; the pages below move up. You can undo this.', confirmText: 'Delete page' }))) return;
      const before = { strokes: strokes.slice(), pages };
      if (pages === 1) {
        strokes = [];
      } else {
        strokes = strokes.filter((s) => !onPage(s, i)).map((s) => (Math.floor(s.p[1] / PAGE_H) > i ? shifted(s, -PAGE_H) : s));
        pages--;
      }
      quietUntil = Date.now() + 1200;
      commit({ op: 'snap', before, after: { strokes: strokes.slice(), pages } });
      syncPages();
      paintAll();
    }
    function shifted(s, dy) {
      const p = s.p.slice();
      for (let j = 1; j < p.length; j += 3) p[j] = Math.round((p[j] + dy) * 10) / 10;
      return { t: s.t, c: s.c, s: s.s, p };
    }

    // ------------------------------------------------------------ toolbar
    function paintTools() {
      root.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
      const cols = tool === 'hl' ? HL_COLORS : PEN_COLORS;
      root.querySelector('[data-colors]').innerHTML = tool === 'eraser' ? '' : cols.map((c) => `<button class="draw-color ${color[tool] === c ? 'on' : ''}" data-color="${c}" style="--c:${c}" aria-label="Color ${c}"></button>`).join('');
      root.querySelector('[data-sizes]').innerHTML = SIZES[tool].map((s, i) => `<button class="draw-size ${size[tool] === i ? 'on' : ''}" data-size="${i}" aria-label="Size ${i + 1}"><span style="width:${Math.min(22, 4 + i * 6)}px;height:${Math.min(22, 4 + i * 6)}px"></span></button>`).join('');
      root.querySelector('[data-d="penonly"]').classList.toggle('active', penOnly);
      root.querySelector('[data-d="undo"]').disabled = !undoStack.length;
      root.querySelector('[data-d="redo"]').disabled = !redoStack.length;
      els.forEach((p) => { p.el.dataset.bg = bg; p.el.classList.toggle('erasing', tool === 'eraser'); });
    }
    const persist = () => savePrefs({ penColor: color.pen, hlColor: color.hl, penSize: size.pen, hlSize: size.hl, eraserSize: size.eraser, penOnly, bg });
    function hint(text) {
      const el = root.querySelector('[data-hint]');
      el.textContent = text;
      el.classList.add('show');
      clearTimeout(hint.t);
      hint.t = setTimeout(() => el.classList.remove('show'), 2600);
    }

    // ------------------------------------------------------------ history
    function commit(entry) {
      undoStack.push(entry);
      if (undoStack.length > 300) undoStack.shift();
      redoStack.length = 0;
      dirty = true;
      paintTools();
    }
    function apply(e, forward) {
      if (e.op === 'add') {
        if (forward) strokes.push(e.stroke); else strokes.splice(strokes.lastIndexOf(e.stroke), 1);
        paintFor([e.stroke]);
      } else if (e.op === 'erase') {
        if (forward) e.removed.forEach(([, s]) => { const i = strokes.indexOf(s); if (i >= 0) strokes.splice(i, 1); });
        else e.removed.slice().sort((a, b) => a[0] - b[0]).forEach(([i, s]) => strokes.splice(i, 0, s));
        paintFor(e.removed.map(([, s]) => s));
      } else if (e.op === 'snap') {
        const st = forward ? e.after : e.before;
        strokes = st.strokes.slice();
        pages = st.pages;
        quietUntil = Date.now() + 1200;
        syncPages();
        paintAll();
      }
      dirty = true;
      paintTools();
    }
    function undo() { const e = undoStack.pop(); if (!e) return; apply(e, false); redoStack.push(e); paintTools(); }
    function redo() { const e = redoStack.pop(); if (!e) return; apply(e, true); undoStack.push(e); paintTools(); }

    // ------------------------------------------------------------ input
    let cur = null;      // stroke being drawn
    let curPage = null;  // page element the stroke started on
    let erasing = null;  // { removed: [] }
    let fingerScroll = null;
    let activeId = null;

    const pageOf = (target) => els.find((p) => p.live === target);
    const toLogical = (e, p) => {
      const r = p.live.getBoundingClientRect();
      return [(e.clientX - r.left) / k, els.indexOf(p) * PAGE_H + (e.clientY - r.top) / k];
    };
    const pressure = (e) => (e.pointerType === 'mouse' || !e.pressure ? 0.5 : Math.min(1, Math.max(0.05, e.pressure)));
    // Stylus eraser end (button 5 / buttons 32) or S Pen side button (barrel = buttons 2) erase.
    const wantsEraser = (e) => tool === 'eraser' || e.button === 5 || (e.buttons & 32) === 32 || (e.pointerType === 'pen' && (e.buttons & 2) === 2);

    function eraseAt(x, y) {
      const r = SIZES.eraser[size.eraser] / 2;
      for (let i = strokes.length - 1; i >= 0; i--) {
        if (hits(strokes[i], x, y, r)) {
          erasing.removed.push([i, strokes[i]]);
          erasing.dirty.push(strokes[i]);
          strokes.splice(i, 1);
        }
      }
    }
    function clearLive(p) { p.lctx.setTransform(1, 0, 0, 1, 0, 0); p.lctx.clearRect(0, 0, p.live.width, p.live.height); }
    function drawEraserCursor(p, x, y) {
      if (!p.on) return;
      clearLive(p);
      const i = els.indexOf(p);
      p.lctx.beginPath();
      p.lctx.arc(x * k * p.dpr, (y - i * PAGE_H) * k * p.dpr, (SIZES.eraser[size.eraser] / 2) * k * p.dpr, 0, Math.PI * 2);
      p.lctx.strokeStyle = 'rgba(100,116,139,.9)';
      p.lctx.lineWidth = 1.5 * p.dpr;
      p.lctx.stroke();
    }
    function liveSegment() {
      const p = cur.p;
      const n = p.length / 3;
      const y = p[p.length - 2];
      // The newest piece goes on the page(s) under it, so ink can run across a page break.
      const pgs = new Set([els.indexOf(curPage), Math.floor(y / PAGE_H)]);
      pgs.forEach((i) => {
        const pe = els[i];
        if (!pe?.on) return;
        pe.lctx.setTransform(1, 0, 0, 1, 0, -i * PAGE_H * k * pe.dpr);
        if (cur.t === 'hl') {
          pe.lctx.save(); pe.lctx.setTransform(1, 0, 0, 1, 0, 0); pe.lctx.clearRect(0, 0, pe.live.width, pe.live.height); pe.lctx.restore();
          drawStroke(pe.lctx, cur, k * pe.dpr);
        } else {
          // Pen: draw only the newest piece for minimal latency.
          drawStroke(pe.lctx, { ...cur, p: p.slice(Math.max(0, (n - 3) * 3)) }, k * pe.dpr);
        }
      });
    }

    function down(e) {
      const p = pageOf(e.target);
      if (!p || activeId !== null) return;
      if (e.pointerType === 'pen' && !penSeen) {
        penSeen = true;
        if (!penOnly && prefs.penOnly === undefined) {
          penOnly = true;
          persist();
          paintTools();
          hint('Pen detected — pen-only mode is on: fingers scroll, your palm is ignored.');
        }
      }
      if (penOnly && e.pointerType === 'touch') {
        fingerScroll = { id: e.pointerId, y: e.clientY, top: scroller.scrollTop };
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 5) return;
      e.preventDefault();
      activeId = e.pointerId;
      curPage = p;
      try { p.live.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
      const [x, y] = toLogical(e, p);
      if (wantsEraser(e)) {
        erasing = { removed: [], dirty: [] };
        eraseAt(x, y);
        if (erasing.dirty.length) { paintFor(erasing.dirty); erasing.dirty = []; }
        drawEraserCursor(p, x, y);
        return;
      }
      const t = tool === 'eraser' ? 'pen' : tool;
      cur = { t, c: color[t], s: SIZES[t][size[t]], p: [Math.round(x * 10) / 10, Math.round(y * 10) / 10, pressure(e)] };
      liveSegment();
    }
    function move(e) {
      if (fingerScroll && e.pointerId === fingerScroll.id) {
        scroller.scrollTop = fingerScroll.top - (e.clientY - fingerScroll.y);
        return;
      }
      if (e.pointerId !== activeId) {
        const p = pageOf(e.target);
        if (p && tool === 'eraser' && e.pointerType !== 'touch') { const [x, y] = toLogical(e, p); drawEraserCursor(p, x, y); }
        return;
      }
      e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const [x, y] = toLogical(ev, curPage);
        if (erasing) { eraseAt(x, y); continue; }
        const p = cur.p;
        const lx = p[p.length - 3], ly = p[p.length - 2];
        if (Math.abs(x - lx) + Math.abs(y - ly) < 0.6) continue;
        p.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(pressure(ev) * 100) / 100);
      }
      if (erasing) {
        if (erasing.dirty.length) { paintFor(erasing.dirty); erasing.dirty = []; }
        const [x, y] = toLogical(e, curPage);
        drawEraserCursor(curPage, x, y);
      } else liveSegment();
    }
    function up(e) {
      if (fingerScroll && e.pointerId === fingerScroll.id) { fingerScroll = null; return; }
      if (e.pointerId !== activeId) return;
      activeId = null;
      els.forEach((p) => p.on && clearLive(p));
      if (erasing) {
        if (erasing.removed.length) commit({ op: 'erase', removed: erasing.removed });
        erasing = null;
        return;
      }
      if (cur) {
        const s = cur;
        cur = null;
        strokes.push(s);
        paintFor([s]);
        commit({ op: 'add', stroke: s });
        // Writing at the bottom of the last page opens the next one, like a notebook.
        if (bounds(s)[3] > pages * PAGE_H - 160 && pages < MAX_PAGES) addPage({ record: false });
      }
    }
    wrap.addEventListener('pointerdown', down);
    wrap.addEventListener('pointermove', move);
    wrap.addEventListener('pointerup', up);
    wrap.addEventListener('pointercancel', up);
    wrap.addEventListener('pointerleave', () => { if (tool === 'eraser' && activeId === null) els.forEach((p) => p.on && clearLive(p)); });
    wrap.addEventListener('contextmenu', (e) => e.preventDefault());
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-delpage]'); if (b) deletePage(+b.closest('[data-pg]').dataset.pg); });

    // Scrolling past the last page that has ink adds a fresh page (Samsung Notes style).
    const sentinel = root.querySelector('[data-sentinel]');
    const grow = new IntersectionObserver((entries) => {
      if (!entries.some((en) => en.isIntersecting) || Date.now() < quietUntil) return;
      if (pageHasInk(pages - 1) && pages < MAX_PAGES) { addPage({ record: false }); hint(`Page ${pages} added`); }
    }, { root: scroller, threshold: 0.6 });
    scroller.addEventListener('scroll', () => pageInfo(), { passive: true });

    // ------------------------------------------------------------ touch: two fingers zoom & scroll (v1.12)
    // One finger writes on the paper (or scrolls in pen-only mode / outside the paper); two fingers pinch to
    // zoom and drag to scroll up, down and sideways. A stroke the first finger had just started is dropped.
    const touches = new Map();
    let gesture = null; // { kind: 'pinch', d0, z0, from } | { kind: 'pan', id, x, y, sl, st, moved, v, t } | { kind: 'hold' }
    let fling = 0;
    const dist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    const mid = () => { const [a, b] = [...touches.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    function abortStroke() {
      if (activeId === null) return;
      if (erasing) {
        erasing.removed.slice().sort((a, b) => a[0] - b[0]).forEach(([i, st]) => strokes.splice(i, 0, st));
        paintFor(erasing.removed.map(([, st]) => st));
      }
      cur = null;
      erasing = null;
      activeId = null;
      els.forEach((p) => p.on && clearLive(p));
    }
    scroller.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      cancelAnimationFrame(fling);
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        if (activeId !== null && touches.has(activeId)) abortStroke();
        fingerScroll = null;
        const m = mid();
        const r = scroller.getBoundingClientRect();
        gesture = { kind: 'pinch', d0: dist(), from: { x: scroller.scrollLeft + m.x - r.left, y: scroller.scrollTop + m.y - r.top, z: zoom } };
        e.stopPropagation();
        e.preventDefault();
      } else if (touches.size === 1 && (penOnly || !pageOf(e.target))) {
        gesture = { kind: 'pan', id: e.pointerId, x: e.clientX, y: e.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop, moved: false, v: { x: 0, y: 0 }, t: e.timeStamp };
        if (pageOf(e.target)) e.stopPropagation(); // pen-only: a finger never draws
      } else if (touches.size > 2) e.stopPropagation();
    }, true);
    scroller.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture?.kind === 'pinch' && touches.size >= 2) {
        const m = mid();
        zoomAt(gesture.from.z * (dist() / gesture.d0), m.x, m.y, true, gesture.from);
        e.stopPropagation();
        e.preventDefault();
      } else if (gesture?.kind === 'pan' && e.pointerId === gesture.id) {
        const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
        if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
        gesture.moved = true;
        const dt = Math.max(1, e.timeStamp - gesture.t);
        gesture.v = { x: (gesture.sl - dx - scroller.scrollLeft) / dt, y: (gesture.st - dy - scroller.scrollTop) / dt }; // px/ms in the scroll direction
        gesture.t = e.timeStamp;
        scroller.scrollLeft = gesture.sl - dx;
        scroller.scrollTop = gesture.st - dy;
        e.stopPropagation();
      } else if (gesture?.kind === 'hold') e.stopPropagation();
    }, true);
    const touchEnd = (e) => {
      if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
      touches.delete(e.pointerId);
      if (gesture?.kind === 'pinch') {
        e.stopPropagation();
        if (touches.size < 2) {
          zoomAt(zoom, ...(() => { const r = scroller.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()); // sharp redraw
          gesture = touches.size ? { kind: 'hold' } : null; // the finger left on the glass must not start writing
        }
      } else if (gesture?.kind === 'pan' && e.pointerId === gesture.id) {
        const { v, moved } = gesture;
        gesture = null;
        if (moved) {
          e.stopPropagation();
          let vx = v.x, vy = v.y, last = performance.now();
          const step = (now) => {
            const dt = now - last; last = now;
            scroller.scrollLeft += vx * dt; scroller.scrollTop += vy * dt;
            vx *= 0.94; vy *= 0.94;
            if (Math.hypot(vx, vy) > 0.02) fling = requestAnimationFrame(step);
          };
          if (Math.hypot(vx, vy) > 0.3) fling = requestAnimationFrame(step);
        }
      } else if (gesture?.kind === 'hold') {
        e.stopPropagation();
        if (!touches.size) gesture = null;
      }
    };
    scroller.addEventListener('pointerup', touchEnd, true);
    scroller.addEventListener('pointercancel', touchEnd, true);
    // Desktop: Ctrl + wheel (and trackpad pinch) zooms around the cursor.
    let wheelCommit = 0;
    scroller.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(zoom * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY, true);
      clearTimeout(wheelCommit);
      wheelCommit = setTimeout(() => layout(), 180);
    }, { passive: false });

    // ------------------------------------------------------------ actions
    async function close(result) {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey, true);
      io.disconnect();
      grow.disconnect();
      root.classList.add('closing');
      setTimeout(() => { els.forEach(free); root.remove(); document.body.style.overflow = ''; }, 160);
      resolve(result);
    }
    async function cancel() {
      if (dirty && !(await confirm({ title: 'Discard your handwriting?', message: 'Changes on these pages will be lost.', confirmText: 'Discard' }))) return;
      close(null);
    }
    async function save() {
      if (!dirty) return close(null);
      if (!strokes.length) {
        if (data && await confirm({ title: 'Remove this drawing?', message: 'The pages are empty. Remove the handwriting from the note?', confirmText: 'Remove' })) return close({ remove: true });
        if (!data) return close(null);
        return;
      }
      // Empty pages at the end are not kept.
      let last = 0;
      strokes.forEach((s) => { last = Math.max(last, Math.floor(s.p[1] / PAGE_H), Math.floor((bounds(s)[3] - 10) / PAGE_H)); });
      const keep = Math.max(1, Math.min(pages, last + 1));
      const btn = root.querySelector('[data-d="save"]');
      btn.classList.add('loading');
      try {
        const blob = await exportPng(strokes, keep);
        const clean = strokes.map(({ t, c, s, p }) => ({ t, c, s, p }));
        close({ data: { v: 2, w: W, ph: PAGE_H, pages: keep, bg, strokes: clean }, blob });
      } catch (err) {
        btn.classList.remove('loading');
        toast(err.message || 'Could not export the drawing', 'error');
      }
    }
    root.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-tool]');
      if (t) { tool = t.dataset.tool; paintTools(); return; }
      const c = e.target.closest('[data-color]');
      if (c) { color[tool] = c.dataset.color; persist(); paintTools(); return; }
      const z = e.target.closest('[data-size]');
      if (z) { size[tool] = +z.dataset.size; persist(); paintTools(); return; }
      const d = e.target.closest('[data-d]')?.dataset.d;
      if (d === 'cancel') return cancel();
      if (d === 'save') return save();
      if (d === 'undo') return undo();
      if (d === 'redo') return redo();
      if (d === 'addpage') return addPage({ scroll: true });
      if (d === 'zoom') { const r = scroller.getBoundingClientRect(); return zoomAt(1, r.left + r.width / 2, r.top); }
      if (d === 'penonly') { penOnly = !penOnly; persist(); paintTools(); hint(penOnly ? 'Pen only: fingers scroll the page, palm touches are ignored.' : 'Fingers can draw again.'); return; }
      if (d === 'bg') { const order = ['lines', 'grid', 'dots', 'none']; bg = order[(order.indexOf(bg) + 1) % order.length]; persist(); paintTools(); hint(`Paper: ${bg === 'none' ? 'blank' : bg}`); }
    });
    function onKey(e) {
      if (document.querySelector('.modal-root')) return; // a confirm dialog is open
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (mod && e.key === 'Enter') { e.preventDefault(); save(); }
      else if (mod && ['=', '+', '-', '0'].includes(e.key)) { e.preventDefault(); const r = scroller.getBoundingClientRect(); zoomAt(e.key === '0' ? 1 : zoom * (e.key === '-' ? 1 / 1.25 : 1.25), r.left + r.width / 2, r.top + r.height / 2); }
      else if (!mod && ['p', 'h', 'e'].includes(e.key.toLowerCase())) { tool = { p: 'pen', h: 'hl', e: 'eraser' }[e.key.toLowerCase()]; paintTools(); }
      else return;
      e.stopPropagation();
    }
    const onResize = () => layout();

    document.body.appendChild(root);
    document.body.style.overflow = 'hidden';
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => {
      layout();
      syncPages();
      paintTools();
      grow.observe(sentinel);
      if (!strokes.length) hint(matchMedia('(pointer: coarse)').matches ? 'Write with your pen or finger. Two fingers: pinch to zoom, drag to scroll.' : 'Write with a pen, touch or mouse. Ctrl + wheel zooms. E = eraser, H = highlighter.');
    });
  });
}

// ===================================================================== viewer
/**
 * Read-only preview of a drawing, page by page (vector, sharp at any size).
 * @param {{data: object, title?: string, actions?: Array<{key:string,label:string,icon:string,danger?:boolean,primary?:boolean}>, pngUrl?: string}} opts
 * @returns {Promise<string|null>} the key of the action pressed
 */
export function openDrawingViewer({ data, title = 'Handwriting', actions = [], pngUrl = '' }) {
  const d = normalizeDrawing(data);
  return new Promise((resolve) => {
    const root = h(String(html`<div class="draw-root draw-viewer" role="dialog" aria-modal="true" aria-label="${title}">
      <header class="draw-bar">
        <button class="btn ghost sm" data-v="close">${icon('x', 'sm')}<span class="hide-sm">Close</span></button>
        <div class="grow dv-title"><b>${title}</b> <span class="subtle small" data-pageinfo></span></div>
        ${pngUrl ? html`<a class="btn ghost icon sm" href="${pngUrl}" download="handwriting.png" data-tip="Download PNG" aria-label="Download">${icon('download', 'sm')}</a>` : ''}
        ${actions.map((a) => html`<button class="btn sm ${a.primary ? 'primary' : 'ghost'} ${a.danger ? 'danger-text' : ''}" data-v="${a.key}">${icon(a.icon, 'sm')}<span class="${a.primary ? '' : 'hide-sm'}">${a.label}</span></button>`)}
      </header>
      <div class="draw-scroll" data-scroll><div class="draw-pages" data-pages></div></div>
    </div>`));
    const scroller = root.querySelector('[data-scroll]');
    const wrap = root.querySelector('[data-pages]');
    let k = 1, cssW = 0;
    const els = [];
    for (let i = 0; i < d.pages; i++) {
      const el = h(`<section class="draw-paper draw-page" data-pg="${i}" data-bg="${d.bg}"><canvas></canvas><footer class="draw-page-foot"><span>${i + 1} / ${d.pages}</span></footer></section>`);
      els.push({ el, c: el.querySelector('canvas'), on: false });
      wrap.appendChild(el);
    }
    const alloc = (p, i) => {
      const cssH = PAGE_H * k;
      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6e6 / (cssW * cssH)));
      p.c.width = Math.round(cssW * dpr); p.c.height = Math.round(cssH * dpr);
      p.c.style.width = cssW + 'px'; p.c.style.height = cssH + 'px';
      renderPage(p.c.getContext('2d'), d.strokes, i, k * dpr);
      p.on = true;
    };
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      const i = els.findIndex((x) => x.el === en.target);
      const p = els[i];
      if (en.isIntersecting) { if (!p.on) alloc(p, i); } else if (p.on) { p.on = false; p.c.width = 0; p.c.height = 0; }
    }), { root: scroller, rootMargin: '100% 0px' });
    function layout() {
      cssW = Math.min(scroller.clientWidth - 24, 1000);
      k = cssW / W;
      els.forEach((p, i) => {
        p.el.style.width = cssW + 'px'; p.el.style.height = PAGE_H * k + 'px'; p.el.style.setProperty('--line', 40 * k + 'px');
        if (p.on) alloc(p, i);
      });
    }
    const info = () => {
      const mid = scroller.scrollTop + scroller.clientHeight / 2;
      let cur = 0;
      els.forEach((p, i) => { if (p.el.offsetTop <= mid) cur = i; });
      root.querySelector('[data-pageinfo]').textContent = d.pages > 1 ? `· page ${cur + 1} of ${d.pages}` : '';
    };
    const close = (v) => {
      io.disconnect();
      window.removeEventListener('resize', layout);
      document.removeEventListener('keydown', onKey, true);
      root.classList.add('closing');
      setTimeout(() => { root.remove(); document.body.style.overflow = ''; }, 160);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-root')) { e.preventDefault(); e.stopPropagation(); close(null); } };
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) close(b.dataset.v === 'close' ? null : b.dataset.v); });
    scroller.addEventListener('scroll', info, { passive: true });
    document.body.appendChild(root);
    document.body.style.overflow = 'hidden';
    window.addEventListener('resize', layout);
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => { layout(); els.forEach((p) => io.observe(p.el)); info(); });
  });
}
