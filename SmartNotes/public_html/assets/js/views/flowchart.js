// Flowchart builder (SVG): shapes, connectors, resize, grid & snap, undo/redo, export.
import { html, icon, uid, debounce, h } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { api } from '../core/api.js';
import { navigate } from '../core/router.js';
import { shell } from '../core/shell.js';
import { toast, toastError, menu, confirm, prompt } from '../core/ui.js';
import { openItemShare } from '../components/itemShare.js';
import { createStage, svgEl, wrapText, textBlock, themeColors, exportPng, exportSvg, exportPdf, safeName } from '../components/canvas.js';

const SHAPES = {
  start: { label: 'Start', w: 140, h: 56, fill: '#22c55e' },
  end: { label: 'End', w: 140, h: 56, fill: '#ef4444' },
  process: { label: 'Process', w: 160, h: 64, fill: '#6366f1' },
  decision: { label: 'Decision?', w: 160, h: 96, fill: '#f59e0b' },
  input: { label: 'Input', w: 170, h: 64, fill: '#14b8a6' },
  output: { label: 'Output', w: 170, h: 64, fill: '#a855f7' },
  database: { label: 'Database', w: 130, h: 84, fill: '#64748b' },
  document: { label: 'Document', w: 160, h: 78, fill: '#0ea5e9' },
  connector: { label: '', w: 44, h: 44, fill: '#8b92a1' },
  // Network / infrastructure devices (v1.8): drawn as an icon with the name underneath.
  server: { label: 'Server', w: 110, h: 100, fill: '#6366f1', device: 'server', group: 'network' },
  router: { label: 'Router', w: 110, h: 100, fill: '#0ea5e9', device: 'router', group: 'network' },
  switch: { label: 'Switch', w: 110, h: 100, fill: '#14b8a6', device: 'switch', group: 'network' },
  firewall: { label: 'Firewall', w: 110, h: 100, fill: '#ef4444', device: 'brick-wall-fire', group: 'network' },
  pc: { label: 'PC', w: 110, h: 100, fill: '#475569', device: 'monitor', group: 'network' },
  laptop: { label: 'Laptop', w: 110, h: 100, fill: '#64748b', device: 'laptop', group: 'network' },
  cloud: { label: 'Cloud', w: 120, h: 100, fill: '#38bdf8', device: 'cloud', group: 'network' },
  internet: { label: 'Internet', w: 110, h: 100, fill: '#2563eb', device: 'globe', group: 'network' },
  wifi: { label: 'Access point', w: 110, h: 100, fill: '#8b5cf6', device: 'wifi', group: 'network' },
  telephone: { label: 'IP Phone', w: 110, h: 100, fill: '#7c3aed', device: 'phone', group: 'network' },
  printer: { label: 'Printer', w: 110, h: 100, fill: '#78716c', device: 'printer', group: 'network' },
  storage: { label: 'NAS / Storage', w: 110, h: 100, fill: '#f59e0b', device: 'hard-drive', group: 'network' },
  cctv: { label: 'CCTV', w: 110, h: 100, fill: '#334155', device: 'cctv', group: 'network' },
  user: { label: 'User', w: 110, h: 100, fill: '#22c55e', device: 'user', group: 'network' },
  // Basic shapes (v1.11): fill or no fill, any size; "Area" groups other shapes (dashed, behind them).
  rect: { label: 'Rectangle', w: 150, h: 90, fill: '#6366f1', group: 'shape' },
  rounded: { label: 'Rounded', w: 150, h: 90, fill: '#0ea5e9', group: 'shape' },
  ellipse: { label: 'Circle', w: 110, h: 110, fill: '#22c55e', group: 'shape' },
  triangle: { label: 'Triangle', w: 120, h: 104, fill: '#f59e0b', group: 'shape' },
  hexagon: { label: 'Hexagon', w: 130, h: 104, fill: '#14b8a6', group: 'shape' },
  star: { label: 'Star', w: 120, h: 115, fill: '#eab308', group: 'shape' },
  arrow: { label: 'Arrow', w: 150, h: 80, fill: '#ec4899', group: 'shape' },
  callout: { label: 'Callout', w: 160, h: 96, fill: '#a855f7', group: 'shape' },
  zone: { label: 'Area', w: 320, h: 220, fill: '#64748b', group: 'shape', noFill: true, dashed: true, back: true },
  text: { label: 'Text', w: 140, h: 44, fill: '#64748b', group: 'shape', noFill: true, noStroke: true },
  // Electronics (v1.11)
  phone: { label: 'Handphone', w: 110, h: 100, fill: '#a855f7', device: 'smartphone', group: 'device' },
  tablet: { label: 'Tablet', w: 110, h: 100, fill: '#8b5cf6', device: 'tablet', group: 'device' },
  kiosk: { label: 'Kiosk', w: 110, h: 110, fill: '#0ea5e9', device: 'kiosk', group: 'device' },
  pos: { label: 'POS / Cashier', w: 110, h: 100, fill: '#16a34a', device: 'pos', group: 'device' },
  edc: { label: 'EDC', w: 110, h: 100, fill: '#0d9488', device: 'edc', group: 'device' },
  atm: { label: 'ATM', w: 110, h: 110, fill: '#1d4ed8', device: 'atm', group: 'device' },
  barcode: { label: 'Barcode scanner', w: 120, h: 100, fill: '#475569', device: 'scan-barcode', group: 'device' },
  fingerprint: { label: 'Fingerprint', w: 110, h: 100, fill: '#be185d', device: 'fingerprint-pattern', group: 'device' },
  queue: { label: 'Queue machine', w: 120, h: 100, fill: '#ea580c', device: 'ticket', group: 'device' },
  tv: { label: 'Smart TV', w: 110, h: 100, fill: '#334155', device: 'tv', group: 'device' },
  signage: { label: 'Digital signage', w: 120, h: 100, fill: '#7c3aed', device: 'monitor-play', group: 'device' },
  projector: { label: 'Projector', w: 110, h: 100, fill: '#64748b', device: 'projector', group: 'device' },
  camera: { label: 'Camera', w: 110, h: 100, fill: '#0f172a', device: 'camera', group: 'device' },
  speaker: { label: 'Speaker', w: 110, h: 100, fill: '#78716c', device: 'speaker', group: 'device' },
  headset: { label: 'Headset', w: 110, h: 100, fill: '#db2777', device: 'headphones', group: 'device' },
  smartwatch: { label: 'Smartwatch', w: 110, h: 100, fill: '#0891b2', device: 'watch', group: 'device' },
  iot: { label: 'IoT / Sensor', w: 110, h: 100, fill: '#059669', device: 'microchip', group: 'device' },
  tower: { label: 'Tower / BTS', w: 110, h: 100, fill: '#dc2626', device: 'radio-tower', group: 'device' },
  satellite: { label: 'Satellite dish', w: 120, h: 100, fill: '#2563eb', device: 'satellite-dish', group: 'device' },
  ups: { label: 'UPS', w: 110, h: 100, fill: '#ca8a04', device: 'battery-charging', group: 'device' },
  ac: { label: 'AC', w: 110, h: 100, fill: '#0284c7', device: 'air-vent', group: 'device' },
  lamp: { label: 'Smart lamp', w: 110, h: 100, fill: '#f59e0b', device: 'lightbulb', group: 'device' },
};
const GROUPS = [['flow', 'Flow'], ['shape', 'Shapes'], ['network', 'Network'], ['device', 'Electronics']];
const PALETTE_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f59e0b', '#ef4444', '#ec4899', '#a855f7', '#64748b', '#111827', '#ffffff'];
const PORTS = ['top', 'right', 'bottom', 'left'];
const DIR = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

/** Device icons (Lucide paths, plus a drawn network switch). */
const DEVICE_ICONS = {
  switch: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/>',
  kiosk: '<rect x="6" y="2" width="12" height="17" rx="2"/><rect x="8" y="4.5" width="8" height="7" rx="1"/><path d="M10 14.5h4M12 19v3M8 22h8"/>',
  pos: '<rect x="3" y="12" width="18" height="9" rx="1.5"/><path d="M6 12V8h12v4"/><rect x="8.5" y="3" width="7" height="5" rx="1"/><path d="M7 15.5h.01M10 15.5h.01M13 15.5h.01M7 18h10"/>',
  edc: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><rect x="8.5" y="4.5" width="7" height="5" rx="1"/><path d="M9.5 13h.01M12 13h.01M14.5 13h.01M9.5 16h.01M12 16h.01M14.5 16h.01M10 19h4"/>',
  atm: '<rect x="3" y="2" width="18" height="20" rx="2"/><rect x="6" y="5" width="12" height="7" rx="1"/><path d="M7 15.5h10M9 18.5h6"/>',
};
function deviceIcon(name, x, y, size, color) {
  const svg = svgEl('svg', { x, y, width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'fc-device-ic' });
  svg.innerHTML = DEVICE_ICONS[name] || ICONS[name] || ICONS.circle;
  return svg;
}
const isDevice = (type) => !!SHAPES[type]?.device;

function starPoints(w, hgt) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.4 : 1;
    pts.push(`${w / 2 + Math.cos(a) * (w / 2) * r},${hgt * 0.54 + Math.sin(a) * (hgt * 0.54) * r}`);
  }
  return pts.join(' ');
}
function shapeEl(type, w, hgt, attrs) {
  if (isDevice(type)) return svgEl('rect', { width: w, height: hgt, rx: 14, ...attrs });
  switch (type) {
    case 'rect': case 'text': return svgEl('rect', { width: w, height: hgt, rx: 3, ...attrs });
    case 'rounded': return svgEl('rect', { width: w, height: hgt, rx: Math.min(22, hgt / 3, w / 3), ...attrs });
    case 'zone': return svgEl('rect', { width: w, height: hgt, rx: 14, ...attrs });
    case 'ellipse': return svgEl('ellipse', { cx: w / 2, cy: hgt / 2, rx: w / 2, ry: hgt / 2, ...attrs });
    case 'triangle': return svgEl('polygon', { points: `${w / 2},0 ${w},${hgt} 0,${hgt}`, ...attrs });
    case 'hexagon': return svgEl('polygon', { points: `${w * 0.25},0 ${w * 0.75},0 ${w},${hgt / 2} ${w * 0.75},${hgt} ${w * 0.25},${hgt} 0,${hgt / 2}`, ...attrs });
    case 'star': return svgEl('polygon', { points: starPoints(w, hgt), ...attrs });
    case 'arrow': { const hx = Math.max(w - hgt * 0.75, w * 0.45); return svgEl('polygon', { points: `0,${hgt * 0.28} ${hx},${hgt * 0.28} ${hx},0 ${w},${hgt / 2} ${hx},${hgt} ${hx},${hgt * 0.72} 0,${hgt * 0.72}`, ...attrs }); }
    case 'callout': { const b = hgt * 0.78, r = Math.min(14, b / 3); return svgEl('path', { d: `M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${b - r} Q${w} ${b} ${w - r} ${b} H${w * 0.42} L${w * 0.24} ${hgt} L${w * 0.27} ${b} H${r} Q0 ${b} 0 ${b - r} V${r} Q0 0 ${r} 0 Z`, ...attrs }); }
    case 'start': case 'end': return svgEl('rect', { width: w, height: hgt, rx: hgt / 2, ...attrs });
    case 'decision': return svgEl('polygon', { points: `${w / 2},0 ${w},${hgt / 2} ${w / 2},${hgt} 0,${hgt / 2}`, ...attrs });
    case 'input': case 'output': { const s = Math.min(22, w / 5); return svgEl('polygon', { points: `${s},0 ${w},0 ${w - s},${hgt} 0,${hgt}`, ...attrs }); }
    case 'database': { const e = Math.min(12, hgt / 5); return svgEl('path', { d: `M0 ${e} A${w / 2} ${e} 0 0 1 ${w} ${e} V${hgt - e} A${w / 2} ${e} 0 0 1 0 ${hgt - e} Z M0 ${e} A${w / 2} ${e} 0 0 0 ${w} ${e}`, ...attrs }); }
    case 'document': return svgEl('path', { d: `M0 0 H${w} V${hgt - 12} Q${w * 0.75} ${hgt - 26} ${w / 2} ${hgt - 12} T0 ${hgt - 12} Z`, ...attrs });
    case 'connector': return svgEl('ellipse', { cx: w / 2, cy: hgt / 2, rx: w / 2, ry: hgt / 2, ...attrs });
    default: return svgEl('rect', { width: w, height: hgt, rx: 9, ...attrs });
  }
}
const portPos = (n, p) => ({ top: [n.x + n.w / 2, n.y], right: [n.x + n.w, n.y + n.h / 2], bottom: [n.x + n.w / 2, n.y + n.h], left: [n.x, n.y + n.h / 2] }[p]);
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export default {
  title: 'Flowchart',
  async render(el, ctx) {
    const id = +ctx.params.id;
    let data;
    try { data = await api.get(`flowcharts/${id}`); } catch (e) {
      el.innerHTML = String(html`<div class="content"><div class="empty"><div class="empty-art">${icon('workflow', 'xl')}</div><h3>Flowchart not found</h3><p>${e.message}</p><a class="btn primary" href="#/flowcharts">Back</a></div></div>`);
      return;
    }
    ctx.setTitle(data.title);
    // Sharing: 'owner' | 'edit' | 'view'. Viewers can look, export and make a copy; nothing they do is saved.
    const access = data.access || 'owner';
    const canEdit = access !== 'view';
    const isOwner = access === 'owner';
    let revision = data.revision ?? 0;
    let conflict = false;
    let shareCount = (data.shares || []).length;
    let nodes = data.nodes.map((n) => ({ ...n, style: n.style || {} }));
    let edges = data.edges.map((e) => ({ ...e, style: e.style || {} }));
    const settings = { grid: true, snap: true, ...(data.settings || {}) };
    let selected = new Set();
    let selEdge = null;
    let dirty = false, saving = false;
    let vpDirty = false;
    const undoStack = [], redoStack = [];
    let clipboard = null;
    const mobile = matchMedia('(max-width: 767px)').matches;

    el.innerHTML = String(html`<div class="canvas-page ${canEdit ? '' : 'readonly'}">
      <div class="canvas-bar">
        <a class="btn ghost icon sm" href="#/flowcharts" data-tip="Back">${icon('arrow-left')}</a>
        <input class="title-input" value="${data.title}" data-title maxlength="255" aria-label="Title" ${canEdit ? '' : 'readonly'}>
        <span class="save-state" data-save><span class="d"></span><span data-save-text>${canEdit ? 'Saved' : 'View only'}</span></span>
        ${isOwner ? html`<button class="btn ghost sm ${shareCount ? 'active' : ''}" data-a="share" data-tip="Share with users">${icon('users', 'sm')}<span class="hide-sm">Share</span><span data-share-count>${shareCount || ''}</span></button>`
          : html`<span class="badge info shared-by">${icon('user', 'sm')} ${data.owner?.name} · ${canEdit ? 'can edit' : 'view only'}</span>${canEdit ? '' : html`<button class="btn sm" data-a="copy">${icon('copy', 'sm')}<span class="hide-sm">Make a copy</span></button>`}`}
        <div class="grow"></div>
        <button class="btn ghost icon sm" data-a="undo" data-edit data-tip="Undo (Ctrl+Z)">${icon('undo-2', 'sm')}</button>
        <button class="btn ghost icon sm" data-a="redo" data-edit data-tip="Redo (Ctrl+Y)">${icon('redo-2', 'sm')}</button>
        <span class="divider-v"></span>
        <button class="btn ghost icon sm ${settings.grid ? 'active' : ''}" data-a="grid" data-edit data-tip="Grid">${icon('grid-3x3', 'sm')}</button>
        <button class="btn ghost icon sm ${settings.snap ? 'active' : ''}" data-a="snap" data-edit data-tip="Snap to grid">${icon('magnet', 'sm')}</button>
        <button class="btn ghost icon sm" data-a="duplicate" data-edit data-tip="Duplicate (Ctrl+D)">${icon('copy', 'sm')}</button>
        <button class="btn ghost icon sm" data-a="delete" data-edit data-tip="Delete (Del)">${icon('trash-2', 'sm')}</button>
        <button class="btn ghost icon sm" data-a="export" data-tip="Export">${icon('download', 'sm')}</button>
        <button class="btn ghost icon sm" data-a="panel" data-tip="Inspector">${icon('panel-right', 'sm')}</button>
      </div>
      <div class="canvas-body">
        <div class="canvas-palette" data-palette>${GROUPS.map(([g, gl]) => html`<div class="palette-group">${gl}</div>
          ${Object.entries(SHAPES).filter(([, s]) => (s.group || 'flow') === g).map(([t, s]) => html`<button class="shape-btn" draggable="true" data-shape="${t}" data-tip="${t === 'connector' ? 'Connector' : s.label.replace('?', '')}" data-tip-pos="right">
          <svg viewBox="-2 -2 ${s.w + 4} ${s.h + 4}" preserveAspectRatio="xMidYMid meet" data-preview="${t}"></svg><span>${t === 'connector' ? 'Connector' : s.label.replace('?', '')}</span></button>`)}`)}
          <div class="palette-tip">Double-click a line to name it</div></div>
        <div class="canvas-stage" data-stage>
          <div class="canvas-zoom"><button class="btn ghost icon xs" data-a="zoom-out" aria-label="Zoom out">${icon('minus', 'sm')}</button><span data-zoom>100%</span>
            <button class="btn ghost icon xs" data-a="zoom-in" aria-label="Zoom in">${icon('plus', 'sm')}</button><button class="btn ghost icon xs" data-a="fit" data-tip="Fit">${icon('maximize', 'sm')}</button></div>
          <div class="canvas-hint">Drag shapes from the left · Drag from a blue port to connect · Double-click to edit text · Shift-click to multi-select · Handles resize (Shift = keep proportions) · Alt = move freely</div>
        </div>
        <aside class="canvas-panel ${mobile ? 'hidden' : ''}" data-panel></aside>
      </div></div>`);
    const $ = (s) => el.querySelector(s);
    const stageEl = $('[data-stage]');
    const stage = createStage(stageEl, { grid: settings.grid, onChange: (vp) => { $('[data-zoom]').textContent = Math.round(vp.zoom * 100) + '%'; if (isOwner) vpDirty = true; } });
    const gEdges = svgEl('g'), gNodes = svgEl('g'), gTemp = svgEl('g', { class: 'ui-only' });
    stage.viewport.append(gEdges, gNodes, gTemp);
    const marker = svgEl('marker', { id: 'fc-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' });
    const markerPath = svgEl('path', { d: 'M0 0 L10 5 L0 10 z' });
    marker.appendChild(markerPath);
    const markerSel = svgEl('marker', { id: 'fc-arrow-sel', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' });
    const markerSelPath = svgEl('path', { d: 'M0 0 L10 5 L0 10 z' });
    markerSel.appendChild(markerSelPath);
    stage.defs.append(marker, markerSel);

    // palette previews
    el.querySelectorAll('[data-preview]').forEach((svg) => {
      const t = svg.dataset.preview;
      const s = SHAPES[t];
      if (s.device) {
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.appendChild(deviceIcon(s.device, 1, 1, 22, s.fill));
        return;
      }
      svg.appendChild(shapeEl(t, s.w, s.h, { fill: s.noFill ? 'none' : s.fill + '33', stroke: s.fill, 'stroke-width': 4, 'stroke-dasharray': s.dashed ? '14 10' : null }));
      if (t === 'text') { const tx = svgEl('text', { x: s.w / 2, y: s.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 30, 'font-weight': 700, fill: s.fill }); tx.textContent = 'Aa'; svg.appendChild(tx); }
    });

    const byKey = (k) => nodes.find((n) => n.key === k);
    const snap = (v, free = false) => (settings.snap && !free ? Math.round(v / 10) * 10 : Math.round(v * 10) / 10);
    const snapshot = () => JSON.stringify({ nodes, edges });
    const pushHistory = () => { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; };
    const restoreSnap = (s) => { const d = JSON.parse(s); nodes = d.nodes; edges = d.edges; };
    function change(fn, { panel = true } = {}) { if (!canEdit) return; pushHistory(); fn(); render({ panel }); markDirty(); }

    // ------------------------------------------------------------ render
    function edgeGeom(e) {
      const a = byKey(e.source), b = byKey(e.target);
      if (!a || !b) return null;
      const [x1, y1] = portPos(a, e.sourcePort), [x2, y2] = portPos(b, e.targetPort);
      const [dx1, dy1] = DIR[e.sourcePort], [dx2, dy2] = DIR[e.targetPort];
      const c = Math.max(36, Math.hypot(x2 - x1, y2 - y1) / 2.6);
      const c1 = [x1 + dx1 * c, y1 + dy1 * c], c2 = [x2 + dx2 * c, y2 + dy2 * c];
      const t = 0.5, mt = 1 - t;
      const mx = mt ** 3 * x1 + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * x2;
      const my = mt ** 3 * y1 + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * y2;
      return { d: `M${x1} ${y1} C${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${x2} ${y2}`, mx, my };
    }
    /** Redraw the canvas; the inspector is rebuilt too unless the user is typing in it (it would lose focus). */
    function render({ panel = true } = {}) {
      const th = themeColors();
      markerPath.setAttribute('fill', th.text2);
      markerSelPath.setAttribute('fill', th.accent);
      gEdges.innerHTML = '';
      gNodes.innerHTML = '';
      edges.forEach((e) => {
        const geo = edgeGeom(e);
        if (!geo) return;
        const isSel = selEdge === e.key;
        const g = svgEl('g', { 'data-edge': e.key });
        const arrow = e.style.arrow || 'end';
        const mk = `url(#${isSel ? 'fc-arrow-sel' : 'fc-arrow'})`;
        g.appendChild(svgEl('path', { d: geo.d, class: 'edge-path' + (isSel ? ' selected' : ''), fill: 'none', stroke: e.style.stroke || th.text2, 'stroke-width': isSel ? 2.6 : 2, 'stroke-dasharray': e.style.dashed ? '7 5' : null, 'marker-end': arrow === 'none' ? null : mk, 'marker-start': arrow === 'both' ? mk : null }));
        g.appendChild(svgEl('path', { d: geo.d, class: 'edge-hit' }));
        if (e.label) {
          const t = wrapText(e.label, { size: 12, weight: 560, maxWidth: 150 });
          g.appendChild(svgEl('rect', { x: geo.mx - t.width / 2 - 7, y: geo.my - (t.lines.length * t.lineHeight) / 2 - 3, width: t.width + 14, height: t.lines.length * t.lineHeight + 6, rx: 7, fill: th.elev, stroke: th.border }));
          textBlock(g, t.lines, { cx: geo.mx, cy: geo.my, size: 12, weight: 560, color: th.text, lineHeight: t.lineHeight });
        }
        gEdges.appendChild(g);
      });
      nodes.forEach((n) => {
        const base = SHAPES[n.type] || SHAPES.process;
        const isSel = selected.has(n.key);
        const g = svgEl('g', { class: 'fc-node' + (isSel ? ' selected' : ''), 'data-key': n.key, transform: `translate(${n.x} ${n.y})`, style: 'cursor:move' });
        if (base.device) {
          // Device: card with the device icon on top and its name underneath (topology-diagram style).
          const filled = !!n.style.fill && n.style.fill !== 'none';
          const fill = n.style.fill === 'none' ? 'transparent' : n.style.fill || th.elev;
          const accent = n.style.stroke || base.fill;
          const fg = filled ? (luminance(fill) > 0.6 ? '#111827' : '#ffffff') : accent;
          g.appendChild(shapeEl(n.type, n.w, n.h, { fill, stroke: accent, 'stroke-width': filled ? 2 : 1.6, class: 'body' }));
          const label = n.label ? wrapText(n.label, { size: 12.5, weight: 600, maxWidth: Math.max(30, n.w - 14) }) : null;
          const textH = label ? Math.min(label.lines.length, 3) * label.lineHeight : 0;
          const size = Math.max(16, Math.min(n.w - 20, n.h - textH - 18, 64));
          g.appendChild(deviceIcon(base.device, (n.w - size) / 2, Math.max(6, (n.h - textH - size) / 2 - (label ? 2 : 0)), size, fg));
          if (label) textBlock(g, label.lines.slice(0, 3), { cx: n.w / 2, cy: n.h - textH / 2 - 8, size: 12.5, weight: 600, color: n.style.text || (filled ? fg : th.text), lineHeight: label.lineHeight });
        } else {
        // "No fill": fill === 'none', or the shape's default (Area, Text) when no colour was chosen.
        const noFill = n.style.fill === 'none' || (!n.style.fill && base.noFill);
        const fill = noFill ? null : n.style.fill || base.fill;
        const stroke = n.style.stroke || (base.noStroke && !n.style.stroke ? 'transparent' : noFill ? base.fill : luminance(fill) > 0.85 ? th.border : fill);
        const textColor = n.style.text || (noFill ? th.text : luminance(fill) > 0.6 ? '#111827' : '#ffffff');
        const dashed = n.style.dashed ?? base.dashed;
        // An Area is grabbed by its border and title, so the shapes inside it stay clickable.
        g.appendChild(shapeEl(n.type, n.w, n.h, { fill: noFill ? (n.type === 'zone' ? 'none' : 'transparent') : fill, stroke, 'stroke-width': 2, 'stroke-dasharray': dashed ? '8 6' : null, class: 'body' }));
        if (n.type === 'zone') g.appendChild(shapeEl(n.type, n.w, n.h, { fill: 'none', stroke: 'transparent', 'stroke-width': 14, class: 'hit' }));
        if (n.label) {
          const t = wrapText(n.label, { size: 13.5, weight: 600, maxWidth: Math.max(30, n.w - ({ decision: n.w * 0.4, triangle: n.w * 0.45, star: n.w * 0.5, hexagon: n.w * 0.3 }[n.type] ?? 24)) });
          const cy = { document: n.h / 2 - 5, triangle: n.h * 0.66, star: n.h * 0.56, callout: n.h * 0.39, zone: Math.min(n.h / 2, 12 + (t.lines.length * t.lineHeight) / 2) }[n.type] ?? n.h / 2;
          textBlock(g, t.lines, { cx: n.w / 2, cy, size: 13.5, weight: 600, color: textColor, lineHeight: t.lineHeight });
        }
        }
        if (isSel) {
          g.appendChild(svgEl('rect', { class: 'sel-ring', x: -6, y: -6, width: n.w + 12, height: n.h + 12, rx: 10 }));
          // 8 handles: corners and edge middles. Shift keeps the proportions, Alt ignores the grid.
          const hs = mobile ? 14 : 10;
          const cursor = { nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' };
          // Side handles sit just outside the edge: the edge middles are the connection ports.
          const out = (mobile ? 8 : 6) + 6;
          if (selected.size === 1 && canEdit) Object.keys(cursor).forEach((c) => {
            const side = c.length === 1;
            const hx = c.includes('e') ? n.w + (side ? out : 0) : c.includes('w') ? -(side ? out : 0) : n.w / 2;
            const hy = c.includes('s') ? n.h + (side ? out : 0) : c.includes('n') ? -(side ? out : 0) : n.h / 2;
            const bw = side && 'ew'.includes(c) ? hs * 0.6 : side ? hs * 1.8 : hs;
            const bh = side && 'ns'.includes(c) ? hs * 0.6 : side ? hs * 1.8 : hs;
            g.appendChild(svgEl('rect', { class: 'fc-handle' + (side ? ' side' : ''), 'data-handle': c, x: hx - bw / 2, y: hy - bh / 2, width: bw, height: bh, rx: 3, style: `cursor:${cursor[c]}-resize` }));
          });
        }
        PORTS.forEach((p) => {
          const [px, py] = portPos({ x: 0, y: 0, w: n.w, h: n.h }, p);
          g.appendChild(svgEl('circle', { class: 'fc-port', 'data-port': p, cx: px, cy: py, r: mobile ? 8 : 6 }));
        });
        gNodes.appendChild(g);
      });
      if (panel) renderPanel();
      $('[data-a="undo"]').disabled = !undoStack.length;
      $('[data-a="redo"]').disabled = !redoStack.length;
    }
    function bbox() {
      if (!nodes.length) return { x: -100, y: -60, w: 200, h: 120 };
      const x1 = Math.min(...nodes.map((n) => n.x)), y1 = Math.min(...nodes.map((n) => n.y));
      const x2 = Math.max(...nodes.map((n) => n.x + n.w)), y2 = Math.max(...nodes.map((n) => n.y + n.h));
      return { x: x1 - 10, y: y1 - 10, w: x2 - x1 + 20, h: y2 - y1 + 20 };
    }

    // ------------------------------------------------------------ panel
    function swatchRow(attr, cur, allowNone = true, noFill = false) {
      return html`<div class="swatches" style="padding:0;grid-template-columns:repeat(7,26px)">${allowNone ? html`<button class="swatch ${!cur ? 'active' : ''}" data-${attr}="" data-tip="Default" style="--sw:var(--bg-soft);width:26px;height:26px">${icon('slash', 'sm')}</button>` : ''}
        ${noFill ? html`<button class="swatch ${cur === 'none' ? 'active' : ''}" data-${attr}="none" data-tip="No fill (transparent)" aria-label="No fill" style="--sw:transparent;width:26px;height:26px;border:1.5px dashed var(--border-strong, var(--text-3))">${icon('square-dashed', 'sm')}</button>` : ''}
        ${PALETTE_COLORS.map((c) => html`<button class="swatch ${cur === c ? 'active' : ''}" data-${attr}="${c}" style="--sw:${c};width:26px;height:26px"></button>`)}</div>`;
    }
    function renderPanel() {
      const panel = $('[data-panel]');
      if (panel.classList.contains('hidden')) return;
      const head = (t) => html`<div class="row between mb-2"><b>${t}</b><button class="btn ghost icon xs" data-a="panel">${icon('x', 'sm')}</button></div>`;
      const edge = selEdge && edges.find((e) => e.key === selEdge);
      if (edge) {
        panel.innerHTML = String(html`${head('Line')}
          <div class="field"><label>Name</label><input class="input sm" data-edge-label value="${edge.label || ''}" placeholder="e.g. Yes · 1 Gbps · VLAN 10 · fiber"><span class="hint">Shown on the line. Tip: double-click a line to name it.</span></div>
          <div class="field"><label>Arrow</label><div class="seg" data-edge-arrow>${[['end', 'arrow-right', 'One end'], ['both', 'arrow-left-right', 'Both'], ['none', 'minus', 'None']].map(([v, i, l]) => html`<button type="button" class="btn sm ${(edge.style.arrow || 'end') === v ? 'active' : ''}" data-arrow="${v}" data-tip="${l}">${icon(i, 'sm')} ${l}</button>`)}</div></div>
          <label class="check small mb-2"><input type="checkbox" data-edge-dashed ${edge.style.dashed ? 'checked' : ''}> Dashed line</label>
          <div class="field"><label>Color</label>${swatchRow('edge-color', edge.style.stroke)}</div>
          <div class="grid grid-2" style="gap:6px"><button class="btn sm" data-a="reverse">${icon('arrow-left-right', 'sm')} Reverse</button><button class="btn sm danger" data-a="delete">${icon('trash-2', 'sm')} Delete</button></div>`);
        return;
      }
      if (selected.size === 1) {
        const n = byKey([...selected][0]);
        panel.innerHTML = String(html`${head('Shape')}
          <div class="field"><label>Text</label><textarea class="textarea" rows="2" data-node-label>${n.label}</textarea></div>
          <div class="field"><label>Type</label><select class="select sm" data-node-type>${GROUPS.map(([g, gl]) => html`<optgroup label="${gl}">${Object.entries(SHAPES).filter(([, x]) => (x.group || 'flow') === g).map(([t, x]) => html`<option value="${t}" ${n.type === t ? 'selected' : ''}>${t === 'connector' ? 'Connector' : x.label.replace('?', '')}</option>`)}</optgroup>`)}</select></div>
          <div class="field"><label>Fill</label>${swatchRow('fill', n.style.fill || (SHAPES[n.type]?.noFill ? 'none' : ''), true, true)}</div>
          <div class="field"><label>Border</label>${swatchRow('stroke', n.style.stroke)}</div>
          ${SHAPES[n.type]?.device ? '' : html`<label class="check small mb-2"><input type="checkbox" data-node-dashed ${(n.style.dashed ?? SHAPES[n.type]?.dashed) ? 'checked' : ''}> Dashed border</label>`}
          <div class="field"><label>Text color</label>${swatchRow('text', n.style.text)}</div>
          <div class="form-grid"><div class="field"><label>Width</label><input class="input sm" type="number" min="20" max="2000" data-size="w" value="${Math.round(n.w)}"></div>
            <div class="field"><label>Height</label><input class="input sm" type="number" min="20" max="2000" data-size="h" value="${Math.round(n.h)}"></div></div>
          <div class="grid grid-2 mb-2" style="gap:6px"><button class="btn sm" data-a="front">${icon('bring-to-front', 'sm')} To front</button><button class="btn sm" data-a="back">${icon('send-to-back', 'sm')} To back</button></div>
          <div class="grid grid-2" style="gap:6px"><button class="btn sm" data-a="duplicate">${icon('copy', 'sm')} Duplicate</button><button class="btn sm danger" data-a="delete">${icon('trash-2', 'sm')} Delete</button></div>
          <p class="tiny subtle mt-2">Drag the handles to resize — <b>Shift</b> keeps the proportions. Hold <b>Alt</b> while dragging to move or resize freely (off the grid); arrow keys nudge.</p>`);
        return;
      }
      if (selected.size > 1) {
        panel.innerHTML = String(html`${head(`${selected.size} shapes`)}
          <div class="field"><label>Fill</label>${swatchRow('fill', null, true, true)}</div>
          <div class="grid grid-2 mb-2" style="gap:6px"><button class="btn sm" data-a="front">${icon('bring-to-front', 'sm')} To front</button><button class="btn sm" data-a="back">${icon('send-to-back', 'sm')} To back</button></div>
          <div class="grid grid-2" style="gap:6px"><button class="btn sm" data-a="duplicate">${icon('copy', 'sm')} Duplicate</button><button class="btn sm danger" data-a="delete">${icon('trash-2', 'sm')} Delete</button></div>`);
        return;
      }
      panel.innerHTML = String(html`${head('Flowchart')}
        <div class="field"><label>Description</label><textarea class="textarea" rows="4" data-desc placeholder="Describe this process…">${data.description || ''}</textarea></div>
        <label class="check small mb-1"><input type="checkbox" data-setting="grid" ${settings.grid ? 'checked' : ''}> Show grid</label>
        <label class="check small mb-2"><input type="checkbox" data-setting="snap" ${settings.snap ? 'checked' : ''}> Snap to grid</label>
        <dl class="kv small"><dt>Shapes</dt><dd>${nodes.length}</dd><dt>Connectors</dt><dd>${edges.length}</dd></dl>
        <p class="small subtle mt-3">Tip: drag from a port (the dots on a shape's edge) to another shape to connect them. Press Delete to remove the selection.</p>`);
    }

    // ------------------------------------------------------------ actions
    function addNode(type, wx, wy) {
      const s = SHAPES[type];
      const key = uid('n');
      const node = { key, type, label: s.label, x: snap(wx - s.w / 2), y: snap(wy - s.h / 2), w: s.w, h: s.h, style: {} };
      change(() => (s.back ? nodes.unshift(node) : nodes.push(node)));
      selected = new Set([key]);
      selEdge = null;
      render();
    }
    function deleteSelection() {
      if (selEdge) { const k = selEdge; selEdge = null; return change(() => (edges = edges.filter((e) => e.key !== k))); }
      if (!selected.size) return;
      const keys = new Set(selected);
      selected.clear();
      change(() => {
        nodes = nodes.filter((n) => !keys.has(n.key));
        edges = edges.filter((e) => !keys.has(e.source) && !keys.has(e.target));
      });
    }
    function duplicateSelection(offset = 30, from = null) {
      const src = from || nodes.filter((n) => selected.has(n.key));
      if (!src.length) return;
      const map = new Map();
      const srcEdges = from ? clipboard.edges : edges.filter((e) => selected.has(e.source) && selected.has(e.target));
      change(() => {
        src.forEach((n) => { const k = uid('n'); map.set(n.key, k); nodes.push({ ...JSON.parse(JSON.stringify(n)), key: k, x: n.x + offset, y: n.y + offset }); });
        srcEdges.forEach((e) => { if (map.has(e.source) && map.has(e.target)) edges.push({ ...JSON.parse(JSON.stringify(e)), key: uid('e'), source: map.get(e.source), target: map.get(e.target) }); });
      });
      selected = new Set(map.values());
      render();
    }
    function editLabel(k) {
      if (!canEdit) return;
      const n = byKey(k);
      const g = gNodes.querySelector(`[data-key="${CSS.escape(k)}"] .body`);
      if (!n || !g) return;
      // Phones: bring the shape into the upper part of the screen first, so the keyboard does not cover the text box.
      if (matchMedia('(pointer: coarse)').matches) {
        const rr = g.getBoundingClientRect();
        if (rr.bottom > window.innerHeight * 0.42) { stage.vp.y -= rr.top - window.innerHeight * 0.2; stage.apply(); }
      }
      const r = g.getBoundingClientRect(), sr = stageEl.getBoundingClientRect();
      const ta = h('<textarea class="node-editor"></textarea>');
      ta.value = n.label;
      Object.assign(ta.style, { left: r.left - sr.left + 'px', top: r.top - sr.top + 'px', width: Math.max(120, r.width) + 'px', height: Math.max(40, r.height) + 'px', fontSize: 13.5 * stage.vp.zoom + 'px' });
      stageEl.appendChild(ta);
      ta.focus();
      ta.select();
      let done = false;
      // Clicking a field in the inspector must not rebuild it (the clicked field would vanish) nor refocus the canvas.
      const commit = (save, to = null) => {
        if (done) return;
        done = true;
        const v = ta.value.trim().slice(0, 500);
        const intoPanel = !!to?.closest?.('[data-panel]');
        ta.remove();
        if (save && v !== n.label) change(() => (n.label = v), { panel: !intoPanel });
        if (intoPanel) { const f = $('[data-panel] [data-node-label]'); if (f && f.value !== n.label) f.value = n.label; }
        else stage.svg.focus({ preventScroll: true });
      };
      ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(true); } if (e.key === 'Escape') commit(false); });
      ta.addEventListener('blur', (e) => commit(true, e.relatedTarget));
    }

    // ------------------------------------------------------------ pointer interaction
    let op = null; // {kind:'move'|'resize'|'connect', ...}
    let lastDown = null; // double-click / double-tap: detected here, because the first click redraws the shape
    stage.cancelInteraction = () => { op = null; gTemp.innerHTML = ''; };
    stage.onBackgroundClick = () => { selected.clear(); selEdge = null; render(); };
    gNodes.addEventListener('pointerdown', (e) => {
      if (stage.isPinching()) return;
      const g = e.target.closest('.fc-node');
      if (!g) return;
      e.stopPropagation();
      const k = g.dataset.key;
      const n = byKey(k);
      const w = stage.toWorld(e.clientX, e.clientY);
      stage.svg.setPointerCapture(e.pointerId);
      const port = e.target.closest('[data-port]');
      const handle = e.target.closest('[data-handle]');
      if (port) {
        op = { kind: 'connect', from: k, port: port.dataset.port, pointerId: e.pointerId };
        stage.svg.classList.add('connecting');
        return;
      }
      if (handle) {
        op = { kind: 'resize', k, c: handle.dataset.handle, sx: w.x, sy: w.y, orig: { ...n }, moved: false, pointerId: e.pointerId };
        return;
      }
      if (lastDown && lastDown.k === k && e.timeStamp - lastDown.t < 400 && !e.shiftKey) {
        lastDown = null;
        e.preventDefault(); // no mousedown default action: it would move focus to the canvas and close the text box
        try { stage.svg.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
        selected = new Set([k]);
        selEdge = null;
        render();
        return setTimeout(() => editLabel(k), 0);
      }
      lastDown = { k, t: e.timeStamp };
      selEdge = null;
      if (e.shiftKey) { selected.has(k) ? selected.delete(k) : selected.add(k); }
      else if (!selected.has(k)) selected = new Set([k]);
      const orig = new Map(nodes.filter((x) => selected.has(x.key)).map((x) => [x.key, { x: x.x, y: x.y }]));
      op = { kind: 'move', k, sx: w.x, sy: w.y, orig, moved: false, pointerId: e.pointerId, clickSel: selected.size === 1 };
      render();
    });
    stage.svg.addEventListener('pointermove', (e) => {
      if (!op || e.pointerId !== op.pointerId) return;
      const w = stage.toWorld(e.clientX, e.clientY);
      if (op.kind === 'move') {
        const dx = w.x - op.sx, dy = w.y - op.sy;
        if (!op.moved && Math.hypot(dx, dy) * stage.vp.zoom < 3) return;
        if (!op.moved) { pushHistory(); op.moved = true; }
        op.orig.forEach((p, k) => { const n = byKey(k); n.x = snap(p.x + dx, e.altKey); n.y = snap(p.y + dy, e.altKey); });
        render();
      } else if (op.kind === 'resize') {
        if (!op.moved) { pushHistory(); op.moved = true; }
        const n = byKey(op.k);
        const o = op.orig;
        const dx = w.x - op.sx, dy = w.y - op.sy;
        const f = e.altKey, MIN = 20;
        let nw = o.w, nh = o.h;
        if (op.c.includes('e')) nw = o.w + dx;
        if (op.c.includes('w')) nw = o.w - dx;
        if (op.c.includes('s')) nh = o.h + dy;
        if (op.c.includes('n')) nh = o.h - dy;
        nw = Math.min(2000, Math.max(MIN, snap(nw, f)));
        nh = Math.min(2000, Math.max(MIN, snap(nh, f)));
        if (e.shiftKey) {
          // Keep proportions (a circle stays a circle).
          const r = o.w / o.h;
          if (op.c.length === 1 ? 'ew'.includes(op.c) : nw / o.w >= nh / o.h) nh = Math.max(MIN, Math.round(nw / r)); else nw = Math.max(MIN, Math.round(nh * r));
        }
        n.w = nw; n.h = nh;
        n.x = op.c.includes('w') ? o.x + (o.w - nw) : op.c.length === 1 && 'ns'.includes(op.c) && e.shiftKey ? o.x + (o.w - nw) / 2 : o.x;
        n.y = op.c.includes('n') ? o.y + (o.h - nh) : op.c.length === 1 && 'ew'.includes(op.c) && e.shiftKey ? o.y + (o.h - nh) / 2 : o.y;
        render();
      } else if (op.kind === 'connect') {
        const a = byKey(op.from);
        const [x1, y1] = portPos(a, op.port);
        gTemp.innerHTML = '';
        gTemp.appendChild(svgEl('path', { d: `M${x1} ${y1} L${w.x} ${w.y}`, stroke: themeColors().accent, 'stroke-width': 2, 'stroke-dasharray': '5 4', fill: 'none' }));
        const target = nodes.find((n) => n.key !== op.from && w.x >= n.x - 10 && w.x <= n.x + n.w + 10 && w.y >= n.y - 10 && w.y <= n.y + n.h + 10);
        gNodes.querySelectorAll('.fc-node .body').forEach((b) => b.removeAttribute('stroke-dasharray'));
        if (target) gNodes.querySelector(`[data-key="${CSS.escape(target.key)}"] .body`)?.setAttribute('stroke-dasharray', '4 3');
      }
    });
    stage.svg.addEventListener('pointerup', (e) => {
      if (!op || e.pointerId !== op.pointerId) return;
      const o = op;
      op = null;
      stage.svg.classList.remove('connecting');
      if (o.kind === 'connect') {
        gTemp.innerHTML = '';
        const w = stage.toWorld(e.clientX, e.clientY);
        const target = nodes.find((n) => n.key !== o.from && w.x >= n.x - 10 && w.x <= n.x + n.w + 10 && w.y >= n.y - 10 && w.y <= n.y + n.h + 10);
        if (target) {
          let best = 'top', bd = Infinity;
          PORTS.forEach((p) => { const [px, py] = portPos(target, p); const d = Math.hypot(px - w.x, py - w.y); if (d < bd) { bd = d; best = p; } });
          const key = uid('e');
          // Links between two network devices are drawn without an arrow by default.
          const style = isDevice(byKey(o.from)?.type) && isDevice(target.type) ? { arrow: 'none' } : {};
          change(() => edges.push({ key, source: o.from, target: target.key, sourcePort: o.port, targetPort: best, label: '', style }));
          selEdge = key;
          selected.clear();
          render();
        } else render();
        return;
      }
      if (o.moved) { render(); markDirty(); return; }
      if (o.kind === 'move' && !e.shiftKey && selected.size > 1) { selected = new Set([o.k]); render(); }
    });
    gNodes.addEventListener('dblclick', (e) => { const g = e.target.closest('.fc-node'); if (g) editLabel(g.dataset.key); });
    gEdges.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('[data-edge]');
      if (!g) return;
      e.stopPropagation();
      selEdge = g.dataset.edge;
      selected.clear();
      render();
    });
    gEdges.addEventListener('dblclick', async (e) => {
      if (!canEdit) return;
      const g = e.target.closest('[data-edge]');
      if (!g) return;
      const ed = edges.find((x) => x.key === g.dataset.edge);
      const v = await prompt({ title: 'Name this line', value: ed.label || '', required: false, placeholder: 'e.g. Yes · 1 Gbps · VLAN 10' });
      if (v !== null) change(() => (ed.label = v.slice(0, 255)));
    });

    // Palette: drag & drop (desktop) or tap (touch) to add
    $('[data-palette]').addEventListener('dragstart', (e) => {
      const b = e.target.closest('[data-shape]');
      if (b) { e.dataTransfer.setData('text/x-shape', b.dataset.shape); e.dataTransfer.effectAllowed = 'copy'; }
    });
    stageEl.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-shape')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    stageEl.addEventListener('drop', (e) => {
      if (!canEdit) return;
      const t = e.dataTransfer.getData('text/x-shape');
      if (!t) return;
      e.preventDefault();
      const w = stage.toWorld(e.clientX, e.clientY);
      addNode(t, w.x, w.y);
    });
    let addOffset = 0;
    $('[data-palette]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-shape]');
      if (!b) return;
      const r = stage.svg.getBoundingClientRect();
      const c = stage.toWorld(r.left + r.width / 2, r.top + r.height / 2);
      addOffset = (addOffset + 30) % 150;
      addNode(b.dataset.shape, c.x + addOffset - 60, c.y + addOffset - 60);
    });

    // ------------------------------------------------------------ keyboard
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.modal-root')) return;
      if (!canEdit && e.key !== ' ' && e.key !== 'Escape') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
      if (mod && k === 'y') { e.preventDefault(); return redo(); }
      if (mod && k === 'd') { e.preventDefault(); return duplicateSelection(); }
      if (mod && k === 'a') { e.preventDefault(); selected = new Set(nodes.map((n) => n.key)); return render(); }
      if (mod && k === 'c' && selected.size) { clipboard = { nodes: JSON.parse(JSON.stringify(nodes.filter((n) => selected.has(n.key)))), edges: JSON.parse(JSON.stringify(edges.filter((x) => selected.has(x.source) && selected.has(x.target)))) }; toast('Copied', 'success', { timeout: 1000 }); return; }
      if (mod && k === 'v' && clipboard) { e.preventDefault(); return duplicateSelection(40, clipboard.nodes); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return deleteSelection(); }
      if (e.key === 'Escape') { selected.clear(); selEdge = null; return render(); }
      if (e.key === 'F2' && selected.size === 1) { e.preventDefault(); return editLabel([...selected][0]); }
      if (e.key === ' ') { stage.spaceDown = true; return; }
      const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      if (arrows[e.key] && selected.size) {
        e.preventDefault();
        const step = e.shiftKey ? 20 : settings.snap && !e.altKey ? 10 : 1;
        change(() => nodes.forEach((n) => { if (selected.has(n.key)) { n.x += arrows[e.key][0] * step; n.y += arrows[e.key][1] * step; } }));
      }
    };
    const onKeyUp = (e) => { if (e.key === ' ') stage.spaceDown = false; };
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKeyUp);
    function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restoreSnap(undoStack.pop()); selected.clear(); selEdge = null; render(); markDirty(); }
    function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restoreSnap(redoStack.pop()); render(); markDirty(); }

    // ------------------------------------------------------------ toolbar & panel
    el.addEventListener('click', async (e) => {
      for (const [attr, prop] of [['fill', 'fill'], ['stroke', 'stroke'], ['text', 'text']]) {
        const b = e.target.closest(`[data-${attr}]`);
        if (b && selected.size) return change(() => nodes.forEach((n) => { if (selected.has(n.key)) n.style = { ...n.style, [prop]: b.dataset[attr] || undefined }; }));
      }
      const ar = e.target.closest('[data-arrow]');
      if (ar && selEdge) return change(() => { const ed = edges.find((x) => x.key === selEdge); ed.style = { ...ed.style, arrow: ar.dataset.arrow === 'end' ? undefined : ar.dataset.arrow }; });
      const ec = e.target.closest('[data-edge-color]');
      if (ec && selEdge) return change(() => { const ed = edges.find((x) => x.key === selEdge); ed.style = { ...ed.style, stroke: ec.dataset.edgeColor || undefined }; });
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      switch (a) {
        case 'share': {
          const n = await openItemShare({ type: 'flowchart', id, title: $('[data-title]').value });
          if (n !== null) { shareCount = n; const b = e.target.closest('[data-a]'); b.classList.toggle('active', n > 0); b.querySelector('[data-share-count]').textContent = n || ''; }
          break;
        }
        case 'copy': { const r = await api.post(`flowcharts/${id}/duplicate`).catch(toastError); if (r) { toast('Copied to your account — you can edit the copy', 'success'); navigate(`/flowcharts/${r.id}`); } break; }
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'grid': settings.grid = !settings.grid; stage.setGrid(settings.grid); e.target.closest('[data-a]').classList.toggle('active', settings.grid); markDirty(); renderPanel(); break;
        case 'snap': settings.snap = !settings.snap; e.target.closest('[data-a]').classList.toggle('active', settings.snap); markDirty(); renderPanel(); break;
        case 'duplicate': duplicateSelection(); break;
        case 'front': case 'back': if (selected.size) change(() => { const sel = nodes.filter((n) => selected.has(n.key)); const rest = nodes.filter((n) => !selected.has(n.key)); nodes = a === 'front' ? [...rest, ...sel] : [...sel, ...rest]; }); break;
        case 'delete': deleteSelection(); break;
        case 'reverse': if (selEdge) change(() => { const ed = edges.find((x) => x.key === selEdge); [ed.source, ed.target, ed.sourcePort, ed.targetPort] = [ed.target, ed.source, ed.targetPort, ed.sourcePort]; }); break;
        case 'zoom-in': stage.zoomAt(1.2); break;
        case 'zoom-out': stage.zoomAt(1 / 1.2); break;
        case 'fit': stage.fit(bbox()); break;
        case 'panel': $('[data-panel]').classList.toggle('hidden'); renderPanel(); break;
        case 'export': {
          const name = safeName($('[data-title]').value);
          const bg = themeColors().bg;
          const keep = new Set(selected); const keepE = selEdge;
          const clean = (fn) => async () => { selected.clear(); selEdge = null; render(); try { await fn(); } catch (err) { toastError(err); } selected = keep; selEdge = keepE; render(); };
          menu(e.target.closest('[data-a]'), [
            { label: 'Export as PNG', icon: 'image', onClick: clean(() => exportPng(stage, bbox(), bg, name)) },
            { label: 'Export as SVG', icon: 'file-code', onClick: clean(() => exportSvg(stage, bbox(), bg, name)) },
            { label: 'Export as PDF', icon: 'file-text', onClick: clean(() => exportPdf(stage, bbox(), bg, name)) },
            { divider: true },
            { label: isOwner ? 'Duplicate flowchart' : 'Make a copy', icon: 'copy', onClick: async () => { await save(); const r = await api.post(`flowcharts/${id}/duplicate`).catch(toastError); if (r) navigate(`/flowcharts/${r.id}`); } },
            isOwner && { label: 'Move to trash', icon: 'trash-2', danger: true, onClick: async () => { if (await confirm({ title: 'Delete flowchart?', message: 'It will be moved to the trash.', confirmText: 'Delete' })) { await api.post(`items/flowchart/${id}/trash`).catch(toastError); ctx.beforeLeave = null; navigate('/flowcharts'); } } },
          ], { align: 'end' });
          break;
        }
      }
    });
    el.addEventListener('focusin', (e) => { if (e.target.matches('[data-node-label],[data-edge-label],[data-size]')) pushHistory(); });
    el.addEventListener('input', (e) => {
      const t = e.target;
      const n = selected.size === 1 ? byKey([...selected][0]) : null;
      // Typing in the inspector updates the canvas only — the field keeps focus, caret and IME composition.
      if (t.matches('[data-node-label]') && n) { n.label = t.value.slice(0, 500); render({ panel: false }); markDirty(); }
      if (t.matches('[data-edge-label]') && selEdge) { edges.find((x) => x.key === selEdge).label = t.value.slice(0, 255); render({ panel: false }); markDirty(); }
      if (t.matches('[data-size]') && n && +t.value >= 20) { n[t.dataset.size] = Math.min(2000, +t.value); render({ panel: false }); markDirty(); }
      if (t.matches('[data-desc]')) { data.description = t.value; markDirty(); }
      if (t.matches('[data-title]')) { ctx.setTitle(t.value); markDirty(); }
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      const n = selected.size === 1 ? byKey([...selected][0]) : null;
      if (t.matches('[data-node-type]') && n) change(() => (n.type = t.value));
      if (t.matches('[data-node-dashed]') && n) change(() => (n.style = { ...n.style, dashed: t.checked }));
      if (t.matches('[data-edge-dashed]') && selEdge) change(() => { const ed = edges.find((x) => x.key === selEdge); ed.style = { ...ed.style, dashed: t.checked }; });
      if (t.matches('[data-setting]')) {
        settings[t.dataset.setting] = t.checked;
        if (t.dataset.setting === 'grid') stage.setGrid(t.checked);
        el.querySelector(`[data-a="${t.dataset.setting}"]`)?.classList.toggle('active', t.checked);
        markDirty();
      }
    });

    // ------------------------------------------------------------ persistence
    const saveEl = $('[data-save]');
    const setSave = (cls, t) => { saveEl.className = 'save-state ' + cls; $('[data-save-text]').textContent = t; };
    function markDirty() { if (!canEdit || conflict) return; dirty = true; setSave('dirty', 'Unsaved'); autosave(); }
    const autosave = debounce(() => save(), 1500);
    async function save() {
      autosave.cancel();
      if (saving) return autosave();
      if (!canEdit || conflict) return;
      if (!dirty && !vpDirty) return;
      saving = true;
      setSave('saving', 'Saving…');
      try {
        const r = await api.post(`flowcharts/${id}`, {
          base_revision: revision,
          title: $('[data-title]').value.trim() || 'Untitled flowchart',
          description: data.description || '',
          viewport: { ...stage.vp },
          settings,
          nodes: nodes.map((n) => ({ key: n.key, type: n.type, label: n.label, x: n.x, y: n.y, w: n.w, h: n.h, style: n.style })),
          edges: edges.map((x) => ({ key: x.key, source: x.source, target: x.target, sourcePort: x.sourcePort, targetPort: x.targetPort, label: x.label, style: x.style })),
        });
        revision = r.revision ?? revision;
        dirty = false;
        vpDirty = false;
        setSave('', 'Saved');
      } catch (err) {
        if (err.status === 409) {
          // A collaborator saved first: never overwrite their work.
          conflict = true;
          setSave('error', 'Conflict — not saved');
          toast(err.message, 'warning', { action: 'Reload', onAction: () => { dirty = false; vpDirty = false; location.reload(); }, timeout: 15000 });
        } else { setSave('error', 'Not saved'); toastError(err); }
      } finally { saving = false; }
    }
    shell.saveHandler = async () => { dirty = true; await save(); toast('Flowchart saved', 'success', { timeout: 1500 }); };
    ctx.beforeLeave = async () => { if (dirty || vpDirty) await save(); return true; };

    render();
    requestAnimationFrame(() => {
      if (data.viewport && data.viewport.zoom) stage.setViewport(data.viewport);
      else stage.fit(bbox(), 80, 1);
      vpDirty = false;
    });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKeyUp);
      autosave.cancel();
      stage.destroy();
      shell.saveHandler = null;
    };
  },
};
