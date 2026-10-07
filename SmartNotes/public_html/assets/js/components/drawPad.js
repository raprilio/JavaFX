// Handwriting canvas for notes (S Pen, Apple Pencil, any stylus, mouse or finger).
// - Pointer Events with pressure and coalesced events for smooth, low-latency ink.
// - Pen-only mode (palm rejection): when a pen is detected, fingers scroll instead of drawing.
// - Stylus eraser end, or the S Pen side button held down, erases.
// - Strokes are stored as vectors in a 1000-unit wide coordinate space, so they look the same on every screen.
import { html, icon, h } from '../core/dom.js';
import { toast, confirm } from '../core/ui.js';

const W = 1000;
const MAX_H = 6000;
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

function bounds(s) {
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

/** Render strokes to a transparent PNG cropped to the used height. */
async function exportPng(strokes) {
  let maxY = 0;
  strokes.forEach((s) => { maxY = Math.max(maxY, bounds(s)[3]); });
  const hLog = Math.max(120, Math.min(MAX_H, Math.ceil(maxY + 24)));
  const sc = Math.min(2, Math.sqrt(16e6 / (W * hLog)), 16000 / hLog);
  const c = document.createElement('canvas');
  c.width = Math.round(W * sc);
  c.height = Math.round(hLog * sc);
  const ctx = c.getContext('2d');
  strokes.forEach((s) => drawStroke(ctx, s, sc));
  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
}

/**
 * Open the full-screen handwriting editor.
 * @returns {Promise<null | {remove: true} | {data: object, blob: Blob}>}
 */
export function openDrawingEditor({ data = null, title = 'Handwriting' } = {}) {
  const prefs = loadPrefs();
  let strokes = (data?.strokes || []).map((s) => ({ t: s.t, c: s.c, s: s.s, p: s.p.slice() }));
  let paperH = Math.max(1400, Math.min(MAX_H, data?.h || 1400));
  let bg = data?.bg || prefs.bg || 'lines';
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
          <button class="btn ghost icon sm" data-d="clear" data-tip="Clear page" aria-label="Clear">${icon('trash-2', 'sm')}</button>
        </div>
        <button class="btn primary sm" data-d="save">${icon('check', 'sm')} Done</button>
      </header>
      <div class="draw-scroll" data-scroll>
        <div class="draw-paper" data-paper data-bg="${bg}"><canvas data-ink></canvas><canvas data-live></canvas></div>
      </div>
      <div class="draw-hint" data-hint></div>
    </div>`));
    const scroller = root.querySelector('[data-scroll]');
    const paper = root.querySelector('[data-paper]');
    const ink = root.querySelector('[data-ink]');
    const live = root.querySelector('[data-live]');
    const ictx = ink.getContext('2d');
    const lctx = live.getContext('2d');
    let k = 1; // css px per logical unit
    let dpr = 1;

    // ------------------------------------------------------------ layout
    function layout() {
      const cssW = Math.min(scroller.clientWidth - 24, 1150);
      k = cssW / W;
      const cssH = paperH * k;
      // Keep each canvas at or below ~14 MP so big pages stay smooth on tablets.
      dpr = Math.min(window.devicePixelRatio || 1, 2.5, Math.sqrt(14e6 / (cssW * cssH)));
      paper.style.width = cssW + 'px';
      paper.style.height = cssH + 'px';
      paper.style.setProperty('--line', 40 * k + 'px');
      [ink, live].forEach((c) => {
        c.width = Math.round(cssW * dpr);
        c.height = Math.round(cssH * dpr);
        c.style.width = cssW + 'px';
        c.style.height = cssH + 'px';
      });
      redraw();
    }
    function redraw() {
      ictx.setTransform(1, 0, 0, 1, 0, 0);
      ictx.clearRect(0, 0, ink.width, ink.height);
      strokes.forEach((s) => drawStroke(ictx, s, k * dpr));
    }
    function grow(y) {
      if (y > paperH - 250 && paperH < MAX_H) {
        paperH = Math.min(MAX_H, paperH + 800);
        layout();
      }
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
      paper.dataset.bg = bg;
      paper.classList.toggle('erasing', tool === 'eraser');
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
    function undo() {
      const e = undoStack.pop();
      if (!e) return;
      if (e.op === 'add') strokes.splice(strokes.lastIndexOf(e.stroke), 1);
      if (e.op === 'erase') e.removed.slice().sort((a, b) => a[0] - b[0]).forEach(([i, s]) => strokes.splice(i, 0, s));
      if (e.op === 'clear') strokes = e.strokes.slice();
      redoStack.push(e);
      dirty = true;
      redraw(); paintTools();
    }
    function redo() {
      const e = redoStack.pop();
      if (!e) return;
      if (e.op === 'add') strokes.push(e.stroke);
      if (e.op === 'erase') e.removed.forEach(([, s]) => { const i = strokes.indexOf(s); if (i >= 0) strokes.splice(i, 1); });
      if (e.op === 'clear') strokes = [];
      undoStack.push(e);
      dirty = true;
      redraw(); paintTools();
    }

    // ------------------------------------------------------------ input
    let cur = null;      // stroke being drawn
    let erasing = null;  // { removed: [] }
    let fingerScroll = null;
    let activeId = null;

    const toLogical = (e) => {
      const r = live.getBoundingClientRect();
      return [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
    };
    const pressure = (e) => (e.pointerType === 'mouse' || !e.pressure ? 0.5 : Math.min(1, Math.max(0.05, e.pressure)));
    // Stylus eraser end (button 5 / buttons 32) or S Pen side button (barrel = buttons 2) erase.
    const wantsEraser = (e) => tool === 'eraser' || e.button === 5 || (e.buttons & 32) === 32 || (e.pointerType === 'pen' && (e.buttons & 2) === 2);

    function eraseAt(x, y) {
      const r = SIZES.eraser[size.eraser] / 2;
      for (let i = strokes.length - 1; i >= 0; i--) {
        if (hits(strokes[i], x, y, r)) {
          erasing.removed.push([i, strokes[i]]);
          strokes.splice(i, 1);
          erasing.changed = true;
        }
      }
    }
    function drawEraserCursor(x, y) {
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, live.width, live.height);
      lctx.beginPath();
      lctx.arc(x * k * dpr, y * k * dpr, (SIZES.eraser[size.eraser] / 2) * k * dpr, 0, Math.PI * 2);
      lctx.strokeStyle = 'rgba(100,116,139,.9)';
      lctx.lineWidth = 1.5 * dpr;
      lctx.stroke();
    }
    function liveSegment() {
      const p = cur.p;
      const n = p.length / 3;
      if (cur.t === 'hl') {
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.clearRect(0, 0, live.width, live.height);
        drawStroke(lctx, cur, k * dpr);
        return;
      }
      // Pen: draw only the newest piece for minimal latency.
      const tail = { ...cur, p: p.slice(Math.max(0, (n - 3) * 3)) };
      drawStroke(lctx, tail, k * dpr);
    }

    function down(e) {
      if (activeId !== null) return;
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
      try { live.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
      const [x, y] = toLogical(e);
      if (wantsEraser(e)) {
        erasing = { removed: [], changed: false };
        eraseAt(x, y);
        if (erasing.changed) redraw();
        drawEraserCursor(x, y);
        return;
      }
      const t = tool === 'eraser' ? 'pen' : tool;
      cur = { t, c: color[t], s: SIZES[t][size[t]], p: [x, y, pressure(e)] };
      liveSegment();
    }
    function move(e) {
      if (fingerScroll && e.pointerId === fingerScroll.id) {
        scroller.scrollTop = fingerScroll.top - (e.clientY - fingerScroll.y);
        return;
      }
      if (e.pointerId !== activeId) {
        if (tool === 'eraser' && e.pointerType !== 'touch') { const [x, y] = toLogical(e); drawEraserCursor(x, y); }
        return;
      }
      e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const [x, y] = toLogical(ev);
        if (erasing) {
          eraseAt(x, y);
          continue;
        }
        const p = cur.p;
        const lx = p[p.length - 3], ly = p[p.length - 2];
        if (Math.abs(x - lx) + Math.abs(y - ly) < 0.6) continue;
        p.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(pressure(ev) * 100) / 100);
      }
      if (erasing) {
        if (erasing.changed) { redraw(); erasing.changed = false; }
        const [x, y] = toLogical(e);
        drawEraserCursor(x, y);
      } else liveSegment();
    }
    function up(e) {
      if (fingerScroll && e.pointerId === fingerScroll.id) { fingerScroll = null; return; }
      if (e.pointerId !== activeId) return;
      activeId = null;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, live.width, live.height);
      if (erasing) {
        if (erasing.removed.length) commit({ op: 'erase', removed: erasing.removed });
        erasing = null;
        return;
      }
      if (cur) {
        strokes.push(cur);
        drawStroke(ictx, cur, k * dpr);
        commit({ op: 'add', stroke: cur });
        grow(bounds(cur)[3]);
        cur = null;
      }
    }
    live.addEventListener('pointerdown', down);
    live.addEventListener('pointermove', move);
    live.addEventListener('pointerup', up);
    live.addEventListener('pointercancel', up);
    live.addEventListener('pointerleave', () => { if (tool === 'eraser' && activeId === null) { lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, live.width, live.height); } });
    live.addEventListener('contextmenu', (e) => e.preventDefault());

    // ------------------------------------------------------------ actions
    async function close(result) {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey, true);
      root.classList.add('closing');
      setTimeout(() => { root.remove(); document.body.style.overflow = ''; }, 160);
      resolve(result);
    }
    async function cancel() {
      if (dirty && !(await confirm({ title: 'Discard your handwriting?', message: 'Changes on this page will be lost.', confirmText: 'Discard' }))) return;
      close(null);
    }
    async function save() {
      if (!dirty) return close(null);
      if (!strokes.length) {
        if (data && await confirm({ title: 'Remove this drawing?', message: 'The page is empty. Remove the handwriting from the note?', confirmText: 'Remove' })) return close({ remove: true });
        if (!data) return close(null);
        return;
      }
      const btn = root.querySelector('[data-d="save"]');
      btn.classList.add('loading');
      try {
        const blob = await exportPng(strokes);
        const clean = strokes.map(({ t, c, s, p }) => ({ t, c, s, p }));
        close({ data: { v: 1, w: W, h: Math.round(paperH), bg, strokes: clean }, blob });
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
      if (d === 'penonly') { penOnly = !penOnly; persist(); paintTools(); hint(penOnly ? 'Pen only: fingers scroll the page, palm touches are ignored.' : 'Fingers can draw again.'); return; }
      if (d === 'bg') { const order = ['lines', 'grid', 'dots', 'none']; bg = order[(order.indexOf(bg) + 1) % order.length]; persist(); paintTools(); hint(`Paper: ${bg === 'none' ? 'blank' : bg}`); return; }
      if (d === 'clear' && strokes.length && await confirm({ title: 'Clear the page?', message: 'You can undo this.', confirmText: 'Clear' })) {
        commit({ op: 'clear', strokes: strokes.slice() });
        strokes = [];
        redraw();
      }
    });
    function onKey(e) {
      if (document.querySelector('.modal-root')) return; // a confirm dialog is open
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (mod && e.key === 'Enter') { e.preventDefault(); save(); }
      else if (!mod && ['p', 'h', 'e'].includes(e.key.toLowerCase())) { tool = { p: 'pen', h: 'hl', e: 'eraser' }[e.key.toLowerCase()]; paintTools(); }
      else return;
      e.stopPropagation();
    }
    const onResize = () => layout();

    document.body.appendChild(root);
    document.body.style.overflow = 'hidden';
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey, true);
    paintTools();
    requestAnimationFrame(() => {
      layout();
      if (!strokes.length) hint(matchMedia('(pointer: coarse)').matches ? 'Write with your pen or finger. Hold the S Pen button (or flip the pen) to erase.' : 'Write with a pen, touch or mouse. E = eraser, H = highlighter.');
    });
  });
}
