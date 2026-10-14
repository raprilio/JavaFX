// Flowchart builder (SVG): shapes, connectors, resize, grid & snap, undo/redo, export.
import { html, icon, uid, debounce, h } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { api } from '../core/api.js';
import { navigate } from '../core/router.js';
import { shell } from '../core/shell.js';
import { toast, toastError, menu, confirm, prompt } from '../core/ui.js';
import { openItemShare } from '../components/itemShare.js';
import { createStage, svgEl, wrapText, textBlock, themeColors, exportPng, exportSvg, exportPdf, safeName } from '../components/canvas.js';
import { createFlowPlayer, exportFlowVideo, schedule } from '../components/flowPlayer.js';

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
  // Swimlanes and cards (v1.17): lanes sit behind the other shapes and are grabbed by their header.
  card: { label: 'Card title', w: 210, h: 96, fill: '#6366f1', group: 'layout', sub: 'Short description' },
  lane: { label: 'Swimlane', w: 280, h: 560, fill: '#64748b', group: 'layout', back: true },
  laneh: { label: 'Swimlane', w: 760, h: 180, fill: '#f59e0b', group: 'layout', back: true },
};
const GROUPS = [['flow', 'Flow'], ['layout', 'Lanes & cards'], ['shape', 'Shapes'], ['network', 'Network'], ['device', 'Electronics']];
const LANES = new Set(['lane', 'laneh']);
// Chart looks (v1.17). colors: default fill per shape type in that look (a colour picked by the user always wins).
const THEMES = {
  classic: { label: 'Classic', line: 'curve', end: 'arrow', bg: 'plain', labels: 'box', node: 'flat', shadow: false },
  gradient: { label: 'Gradient', line: 'ribbon', end: 'none', bg: 'gradient', labels: 'pill', node: 'gradient', shadow: true, round: 14, light: true,
    colors: { start: '#3b82f6', end: '#f43f5e', process: '#ec4899', decision: '#8b5cf6', input: '#06b6d4', output: '#8b5cf6', document: '#06b6d4', database: '#6366f1', card: '#ec4899', connector: '#8b5cf6' },
    bgCss: 'linear-gradient(160deg, #f5f3ff 0%, #fdf2f8 50%, #eff6ff 100%)', bgSolid: '#f8f5ff', preview: ['#ec4899', '#8b5cf6', '#3b82f6'] },
  infographic: { label: 'Infographic', line: 'elbow', end: 'none', bg: 'plain', labels: 'pill', node: 'framed', shadow: true, round: 16, light: true, lineColor: '#ffffff', lineW: 9,
    colors: { start: '#5b5f73', end: '#f6b23e', process: '#f97352', decision: '#e5586a', input: '#3cc7cf', output: '#f6b23e', document: '#3cc7cf', database: '#5b5f73', card: '#f97352', connector: '#5b5f73' },
    bgSolid: '#e5e9ee', bgCss: 'linear-gradient(180deg, #edf0f4, #dfe4ea)', preview: ['#f6b23e', '#f97352', '#3cc7cf'] },
  corporate: { label: 'Swimlane', line: 'elbow', end: 'arrow', bg: 'plain', labels: 'plain', node: 'flat', shadow: false, round: 2, light: true, lineColor: '#7ea6e0', lineW: 1.6,
    colors: { start: '#0d5fb3', end: '#0d5fb3', process: '#0d5fb3', decision: '#f86a12', input: '#26c2f5', output: '#26c2f5', document: '#26c2f5', database: '#0d5fb3', card: '#0d5fb3', connector: '#0d5fb3' },
    bgSolid: '#ffffff', bgCss: 'linear-gradient(180deg, #ffffff, #f4f8fd)', preview: ['#0d5fb3', '#f86a12', '#26c2f5'] },
  midnight: { label: 'Midnight', line: 'elbow', end: 'chevron', bg: 'dark', labels: 'pill', node: 'glass', shadow: false, round: 10, ports: true, lineColor: '#e2e8f0', lineW: 1.6,
    colors: { start: '#2dd4bf', end: '#f472b6', process: '#a78bfa', decision: '#60a5fa', input: '#2dd4bf', output: '#60a5fa', document: '#2dd4bf', database: '#a78bfa', card: '#a78bfa', zone: '#22d3ee', connector: '#a78bfa' },
    preview: ['#2dd4bf', '#a78bfa', '#60a5fa'] },
  airy: { label: 'Airy', line: 'elbow', end: 'arrow', bg: 'gradient', labels: 'box', node: 'flat', shadow: true, deep: true, round: 8, light: true, lineColor: '#334155', lineW: 1.4,
    colors: { start: '#2f8f9d', end: '#7c3aed', process: '#1e3a5f', decision: '#f08080', input: '#2f8f9d', output: '#1e3a5f', document: '#2f8f9d', database: '#1e3a5f', card: '#1e3a5f', connector: '#1e3a5f' },
    bgCss: 'linear-gradient(135deg, #ffffff 0%, #f1f5f9 55%, #e2e8f0 100%)', bgSolid: '#f8fafc', preview: ['#1e3a5f', '#2f8f9d', '#f08080'] },
};
const DARK_BG = { css: 'radial-gradient(ellipse at 50% 30%, #3a4060, #262a3d 78%)', solid: '#2b3045' };
const NODE_ICONS = ['lightbulb', 'flag', 'target', 'rocket', 'users', 'user', 'briefcase', 'shopping-cart', 'credit-card', 'file-text', 'mail', 'phone',
  'calendar', 'clock', 'check', 'x', 'circle-alert', 'settings', 'database', 'cloud', 'truck', 'package', 'chart-line', 'keyboard', 'book-open', 'shield-check', 'dollar-sign', 'star'];
function mix(hex, base, amt) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(hex || '') || !/^#[0-9a-f]{6}$/i.test(base || '')) return hex || base;
  const a = p(hex), b = p(base);
  return '#' + a.map((v, i) => Math.round(v * amt + b[i] * (1 - amt)).toString(16).padStart(2, '0')).join('');
}
function roundPoly(pts, r) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 0.5) { d += ` L${bx} ${by}`; continue; }
    d += ` L${bx + ((ax - bx) * rr) / l1} ${by + ((ay - by) * rr) / l1} Q${bx} ${by} ${bx + ((cx - bx) * rr) / l2} ${by + ((cy - by) * rr) / l2}`;
  }
  const z = pts[pts.length - 1];
  return d + ` L${z[0]} ${z[1]}`;
}
/** Right-angled route between two ports (leaves and enters each shape straight). */
function orthoPts(p1, d1, p2, d2) {
  const G = 22;
  const s = [p1[0] + d1[0] * G, p1[1] + d1[1] * G], t = [p2[0] + d2[0] * G, p2[1] + d2[1] * G];
  const pts = [p1, s];
  const h1 = d1[0] !== 0, h2 = d2[0] !== 0;
  if (h1 && h2) { const mx = (s[0] + t[0]) / 2; pts.push([mx, s[1]], [mx, t[1]]); }
  else if (!h1 && !h2) { const my = (s[1] + t[1]) / 2; pts.push([s[0], my], [t[0], my]); }
  else if (h1) pts.push([t[0], s[1]]);
  else pts.push([s[0], t[1]]);
  pts.push(t, p2);
  // drop repeated points and points in the middle of a straight run
  const out = [];
  pts.forEach((q) => { const l = out[out.length - 1]; if (!l || Math.abs(l[0] - q[0]) > 0.1 || Math.abs(l[1] - q[1]) > 0.1) out.push(q); });
  return out.filter((q, i) => { if (i === 0 || i === out.length - 1) return true; const a = out[i - 1], b = out[i + 1]; return !((Math.abs(a[0] - q[0]) < 0.1 && Math.abs(b[0] - q[0]) < 0.1) || (Math.abs(a[1] - q[1]) < 0.1 && Math.abs(b[1] - q[1]) < 0.1)); });
}
/** Point and direction at a distance along a polyline (negative = from the end). */
function alongPoly(pts, dist) {
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l; }
  let d = dist < 0 ? Math.max(0, total + dist) : Math.min(total, dist);
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const k = segs[i] ? Math.min(1, d / segs[i]) : 0;
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, ang: Math.atan2(by - ay, bx - ax), total };
    }
    d -= segs[i];
  }
  return { x: pts[0][0], y: pts[0][1], ang: 0, total };
}
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
function shapeEl(type, w, hgt, attrs, round = null) {
  if (isDevice(type)) return svgEl('rect', { width: w, height: hgt, rx: 14, ...attrs });
  switch (type) {
    case 'card': return svgEl('rect', { width: w, height: hgt, rx: Math.min(round ?? 14, hgt / 2), ...attrs });
    case 'lane': case 'laneh': return svgEl('rect', { width: w, height: hgt, rx: 6, ...attrs });
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
    default: return svgEl('rect', { width: w, height: hgt, rx: Math.min(round ?? 9, hgt / 2), ...attrs });
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
        <button class="btn ghost sm" data-a="style" data-edit data-tip="Look: theme, lines, background">${icon('palette', 'sm')}<span class="hide-sm">Style</span></button>
        <button class="btn ghost icon sm" data-a="duplicate" data-edit data-tip="Duplicate (Ctrl+D)">${icon('copy', 'sm')}</button>
        <button class="btn ghost icon sm" data-a="delete" data-edit data-tip="Delete (Del)">${icon('trash-2', 'sm')}</button>
        <button class="btn ghost sm flow-play" data-a="play" data-tip="Play: data flows through the chart">${icon('play', 'sm')}<span class="hide-sm" data-play-label>Play</span></button>
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
    // Swimlanes live in their own layer under the lines (their tint would hide them otherwise).
    const gDeco = svgEl('g', { class: 'fc-deco' }), gLanes = svgEl('g'), gEdges = svgEl('g'), gNodes = svgEl('g'), gTemp = svgEl('g', { class: 'ui-only' });
    stage.viewport.append(gDeco, gLanes, gEdges, gNodes, gTemp);

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
    // ------------------------------------------------------------ look (v1.17)
    let theme = { ...(settings.theme || {}) };
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    /** Effective look: the preset with the chart's own choices on top. */
    const T = () => {
      const t = { ...(THEMES[theme.preset] || THEMES.classic) };
      ['line', 'end', 'bg', 'labels'].forEach((k) => { if (theme[k]) t[k] = theme[k]; });
      if (typeof theme.shadow === 'boolean') t.shadow = theme.shadow;
      t.flow = !!theme.flow && !reduceMotion;
      t.title = !!theme.title;
      t.colors = t.colors || {};
      return t;
    };
    /** Colours of the canvas for this look (light presets stay light even in the app's dark mode). */
    function look() {
      const th = themeColors(), t = T();
      if (t.bg === 'dark') return { ...th, bg: DARK_BG.solid, elev: '#363c55', soft: '#40476a', border: '#4b5274', text: '#eef1ff', text2: '#aab3d6', dark: true };
      if (t.light) return { ...th, bg: t.bgSolid || '#ffffff', elev: '#ffffff', soft: '#f1f5f9', border: '#cbd5e1', text: '#1e293b', text2: '#5b6476', dark: false };
      return th;
    }
    function applyBackdrop() {
      const t = T(), lk = look();
      stageEl.classList.toggle('fc-dark', !!lk.dark);
      stageEl.dataset.fcTheme = theme.preset || 'classic';
      stageEl.style.background = t.bg === 'dark' ? DARK_BG.css
        : t.bg === 'gradient' ? (t.bgCss || `linear-gradient(160deg, ${mix(lk.accent, lk.bg, 0.1)} 0%, ${lk.bg} 60%)`)
        : lk.bg;
    }
    // Definitions that depend on colours (gradients, coloured shadows, arrow heads) are made once and reused.
    const dyn = svgEl('g');
    const ribbons = svgEl('g');
    stage.defs.append(dyn, ribbons);
    const made = new Set();
    function def(id, build) { if (!made.has(id)) { made.add(id); dyn.appendChild(build()); } return `url(#${id})`; }
    const hexId = (c) => String(c).replace(/[^0-9a-z]/gi, '');
    const gradFill = (c) => def('fcg-' + hexId(c), () => { const g = svgEl('linearGradient', { id: 'fcg-' + hexId(c), x1: 0, y1: 0, x2: 0.35, y2: 1 }); g.append(svgEl('stop', { offset: '0%', 'stop-color': mix('#ffffff', c, 0.3) }), svgEl('stop', { offset: '100%', 'stop-color': mix('#000000', c, 0.1) })); return g; });
    const shadow = (kind, c = '#0f172a') => def(`fcs-${kind}-${hexId(c)}`, () => {
      const f = svgEl('filter', { id: `fcs-${kind}-${hexId(c)}`, x: '-30%', y: '-30%', width: '160%', height: '170%' });
      const [dy, sd, op] = kind === 'deep' ? [14, 12, 0.2] : kind === 'color' ? [9, 9, 0.38] : [4, 5, 0.16];
      f.appendChild(svgEl('feDropShadow', { dx: 0, dy, stdDeviation: sd, 'flood-color': c, 'flood-opacity': op }));
      return f;
    });
    const arrowHead = (c) => def('fca-' + hexId(c), () => {
      const m = svgEl('marker', { id: 'fca-' + hexId(c), viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 11, markerHeight: 11, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' });
      m.appendChild(svgEl('path', { d: 'M0 0 L10 5 L0 10 z', fill: c }));
      return m;
    });

    let player = null; // flowing data (v1.18), created below
    const snapshot = () => JSON.stringify({ nodes, edges, theme });
    const pushHistory = () => { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; };
    const restoreSnap = (s) => { const d = JSON.parse(s); nodes = d.nodes; edges = d.edges; if (d.theme) theme = d.theme; };
    function change(fn, { panel = true } = {}) { if (!canEdit) return; pushHistory(); fn(); render({ panel }); markDirty(); }
    function setTheme(patch) {
      change(() => {
        theme = patch.preset ? { preset: patch.preset, flow: theme.flow, title: theme.title } : { ...theme, ...patch };
        Object.keys(theme).forEach((k) => theme[k] === undefined && delete theme[k]);
      });
    }

    // ------------------------------------------------------------ render
    const colorOf = (n, t) => (n.style.fill && n.style.fill !== 'none' ? n.style.fill : t.colors[n.type] || (SHAPES[n.type] || SHAPES.process).fill);
    function edgeGeom(e, t = T()) {
      const a = byKey(e.source), b = byKey(e.target);
      if (!a || !b) return null;
      const p1 = portPos(a, e.sourcePort), p2 = portPos(b, e.targetPort);
      const [dx1, dy1] = DIR[e.sourcePort], [dx2, dy2] = DIR[e.targetPort];
      const route = e.style.route || (t.line === 'ribbon' ? 'curve' : t.line);
      if (route === 'elbow' || route === 'straight') {
        const pts = route === 'elbow' ? orthoPts(p1, [dx1, dy1], p2, [dx2, dy2]) : [p1, p2];
        const mid = alongPoly(pts, alongPoly(pts, 0).total / 2), near = alongPoly(pts, -26);
        return { d: route === 'elbow' ? roundPoly(pts, 12) : `M${p1[0]} ${p1[1]} L${p2[0]} ${p2[1]}`, mx: mid.x, my: mid.y, near, p1, p2 };
      }
      const c = Math.max(36, Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2.6);
      const c1 = [p1[0] + dx1 * c, p1[1] + dy1 * c], c2 = [p2[0] + dx2 * c, p2[1] + dy2 * c];
      const at = (t2) => { const m = 1 - t2; return [m ** 3 * p1[0] + 3 * m * m * t2 * c1[0] + 3 * m * t2 * t2 * c2[0] + t2 ** 3 * p2[0], m ** 3 * p1[1] + 3 * m * m * t2 * c1[1] + 3 * m * t2 * t2 * c2[1] + t2 ** 3 * p2[1]]; };
      const [mx, my] = at(0.5), q = at(0.84), q2 = at(0.86);
      return { d: `M${p1[0]} ${p1[1]} C${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`, mx, my, near: { x: q[0], y: q[1], ang: Math.atan2(q2[1] - q[1], q2[0] - q[0]) }, p1, p2 };
    }
    function drawEdge(e, t, lk) {
      const geo = edgeGeom(e, t);
      if (!geo) return;
      const isSel = selEdge === e.key;
      const g = svgEl('g', { 'data-edge': e.key });
      const ribbon = t.line === 'ribbon' && !e.style.route;
      const baseW = ribbon ? 14 : t.lineW || 2;
      const w = e.style.width === 's' ? Math.max(1, baseW * 0.55) : e.style.width === 'l' ? Math.max(4, baseW * 1.9) : baseW;
      const col = isSel ? lk.accent : e.style.stroke || t.lineColor || lk.text2;
      const arrow = e.style.arrow || 'end';
      let stroke = col;
      if (ribbon && !isSel && !e.style.stroke) {
        // Ribbon: a wide translucent band blending the colours of the two shapes.
        const a = byKey(e.source), b = byKey(e.target);
        const gid = 'fcr-' + e.key.replace(/[^\w-]/g, '');
        const lg = svgEl('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: geo.p1[0], y1: geo.p1[1], x2: geo.p2[0], y2: geo.p2[1] });
        lg.append(svgEl('stop', { offset: '0%', 'stop-color': colorOf(a, t), 'stop-opacity': 0.5 }), svgEl('stop', { offset: '100%', 'stop-color': colorOf(b, t), 'stop-opacity': 0.5 }));
        ribbons.appendChild(lg);
        stroke = `url(#${gid})`;
      }
      const head = t.end === 'arrow' && arrow !== 'none' ? arrowHead(col) : null;
      g.appendChild(svgEl('path', {
        d: geo.d, class: 'edge-path' + (isSel ? ' selected' : ''), fill: 'none', stroke, 'stroke-width': isSel ? w + 0.8 : w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'stroke-dasharray': e.style.dashed ? `${Math.max(7, w * 2)} ${Math.max(5, w * 1.6)}` : null, 'marker-end': head, 'marker-start': head && arrow === 'both' ? head : null,
        filter: t.lineColor === '#ffffff' && t.shadow ? shadow('soft') : null,
      }));
      if (t.flow) g.appendChild(svgEl('path', { d: geo.d, class: 'fc-flow ui-only', fill: 'none', stroke: ribbon || t.lineColor === '#ffffff' ? '#ffffff' : col, 'stroke-width': Math.max(1.6, w * (ribbon ? 0.22 : 0.5)), 'stroke-linecap': 'round', opacity: ribbon ? 0.9 : 0.85 }));
      g.appendChild(svgEl('path', { d: geo.d, class: 'edge-hit' }));
      if (t.ports || t.end === 'dot') [geo.p1, geo.p2].forEach(([x, y], i) => { if (i === 0 || t.end === 'dot') g.appendChild(svgEl('circle', { cx: x, cy: y, r: 5, fill: lk.elev, stroke: col, 'stroke-width': 2 })); });
      if (t.end === 'chevron' && arrow !== 'none') {
        // A round badge with a chevron pointing along the line, just before the target.
        const { x, y, ang } = geo.near;
        const cg = svgEl('g', { transform: `translate(${x} ${y}) rotate(${(ang * 180) / Math.PI})` });
        cg.append(svgEl('circle', { r: 9, fill: '#ffffff', stroke: col, 'stroke-width': 1.2 }), svgEl('path', { d: 'M-2.5 -4 L2 0 L-2.5 4', fill: 'none', stroke: '#1e293b', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        g.appendChild(cg);
      }
      if (e.label) {
        const tw = wrapText(e.label, { size: 12, weight: 560, maxWidth: 150 });
        const hh = tw.lines.length * tw.lineHeight + 6;
        if (t.labels === 'plain') {
          const tx = textBlock(g, tw.lines, { cx: geo.mx, cy: geo.my, size: 12.5, weight: 600, color: e.style.stroke || (lk.dark ? lk.text : mix(col, '#0f172a', 0.55)), lineHeight: tw.lineHeight });
          tx.setAttribute('stroke', lk.bg); tx.setAttribute('stroke-width', 4); tx.setAttribute('paint-order', 'stroke'); tx.setAttribute('stroke-linejoin', 'round');
        } else {
          const pill = t.labels === 'pill';
          g.appendChild(svgEl('rect', { x: geo.mx - tw.width / 2 - (pill ? 11 : 7), y: geo.my - hh / 2, width: tw.width + (pill ? 22 : 14), height: hh, rx: pill ? hh / 2 : 7, fill: pill ? '#ffffff' : lk.elev, stroke: pill ? 'none' : lk.border, filter: pill ? shadow('soft') : null }));
          textBlock(g, tw.lines, { cx: geo.mx, cy: geo.my, size: 12, weight: 560, color: pill ? '#1e293b' : lk.text, lineHeight: tw.lineHeight });
        }
      }
      gEdges.appendChild(g);
    }
    /** Title, second line and icon of a shape. */
    function nodeText(g, n, color, subColor, t) {
      const card = n.type === 'card';
      const icName = n.style.icon && ICONS[n.style.icon] ? n.style.icon : null;
      if (card) {
        const ic = icName ? 26 : 0;
        const L = n.label ? wrapText(n.label, { size: 15, weight: 700, maxWidth: Math.max(30, n.w - 32 - (ic ? ic + 8 : 0)) }) : null;
        const S = n.style.sub ? wrapText(n.style.sub, { size: 12, weight: 500, maxWidth: Math.max(30, n.w - 32) }) : null;
        const lh = L ? Math.min(2, L.lines.length) * L.lineHeight : 0, sh = S ? Math.min(3, S.lines.length) * S.lineHeight : 0;
        let y = Math.max(14, (n.h - lh - sh - (S ? 4 : 0)) / 2);
        if (icName) g.appendChild(deviceIcon(icName, n.w - 16 - ic, 14, ic, color));
        if (L) { textBlock(g, L.lines.slice(0, 2), { cx: 16, cy: y + lh / 2, size: 15, weight: 700, color, lineHeight: L.lineHeight, anchor: 'start' }); y += lh + 4; }
        if (S) textBlock(g, S.lines.slice(0, 3), { cx: 16, cy: y + sh / 2, size: 12, weight: 500, color: subColor, lineHeight: S.lineHeight, anchor: 'start' });
        return;
      }
      const pad = { decision: n.w * 0.4, triangle: n.w * 0.45, star: n.w * 0.5, hexagon: n.w * 0.3 }[n.type] ?? 24;
      const maxWidth = Math.max(30, n.w - pad);
      const L = n.label ? wrapText(n.label, { size: 13.5, weight: 600, maxWidth }) : null;
      const S = n.style.sub && n.type !== 'zone' ? wrapText(n.style.sub, { size: 11.5, weight: 500, maxWidth }) : null;
      if (n.type === 'zone') {
        if (L) textBlock(g, L.lines, { cx: n.w / 2, cy: Math.min(n.h / 2, 12 + (L.lines.length * L.lineHeight) / 2), size: 13.5, weight: 600, color, lineHeight: L.lineHeight });
        return;
      }
      const ic = icName ? Math.max(16, Math.min(30, n.h * 0.32)) : 0;
      const lh = L ? L.lines.length * L.lineHeight : 0, sh = S ? S.lines.length * S.lineHeight : 0;
      const cy = { document: n.h / 2 - 5, triangle: n.h * 0.66, star: n.h * 0.56, callout: n.h * 0.39 }[n.type] ?? n.h / 2;
      let y = cy - (ic + (ic && (L || S) ? 5 : 0) + lh + (S ? sh + 2 : 0)) / 2;
      if (icName) { g.appendChild(deviceIcon(icName, n.w / 2 - ic / 2, y, ic, color)); y += ic + 5; }
      if (L) { textBlock(g, L.lines, { cx: n.w / 2, cy: y + lh / 2, size: 13.5, weight: 600, color, lineHeight: L.lineHeight }); y += lh + 2; }
      if (S) textBlock(g, S.lines, { cx: n.w / 2, cy: y + sh / 2, size: 11.5, weight: 500, color: subColor, lineHeight: S.lineHeight });
    }
    function drawShape(g, n, t, lk) {
      const base = SHAPES[n.type] || SHAPES.process;
      if (base.device) {
        // Device: card with the device icon on top and its name underneath (topology-diagram style).
        const filled = !!n.style.fill && n.style.fill !== 'none';
        const fill = n.style.fill === 'none' ? 'transparent' : n.style.fill || lk.elev;
        const accent = n.style.stroke || base.fill;
        const fg = filled ? (luminance(fill) > 0.6 ? '#111827' : '#ffffff') : accent;
        g.appendChild(shapeEl(n.type, n.w, n.h, { fill, stroke: accent, 'stroke-width': filled ? 2 : 1.6, class: 'body', filter: t.shadow && n.style.fill !== 'none' ? shadow(t.deep ? 'deep' : 'soft') : null }));
        const label = n.label ? wrapText(n.label, { size: 12.5, weight: 600, maxWidth: Math.max(30, n.w - 14) }) : null;
        const textH = label ? Math.min(label.lines.length, 3) * label.lineHeight : 0;
        const size = Math.max(16, Math.min(n.w - 20, n.h - textH - 18, 64));
        g.appendChild(deviceIcon(base.device, (n.w - size) / 2, Math.max(6, (n.h - textH - size) / 2 - (label ? 2 : 0)), size, fg));
        if (label) textBlock(g, label.lines.slice(0, 3), { cx: n.w / 2, cy: n.h - textH / 2 - 8, size: 12.5, weight: 600, color: n.style.text || (filled ? fg : lk.text), lineHeight: label.lineHeight });
        return;
      }
      if (LANES.has(n.type)) {
        // Swimlane: tinted body (clicks go through to the shapes in it), coloured header with the name.
        const c = colorOf(n, t);
        const none = n.style.fill === 'none';
        const vert = n.type === 'lane';
        const band = vert ? 44 : 46;
        g.appendChild(shapeEl(n.type, n.w, n.h, { fill: none ? 'none' : mix(c, lk.bg, lk.dark ? 0.12 : 0.06), stroke: n.style.stroke || mix(c, lk.border, 0.45), 'stroke-width': 2, 'stroke-dasharray': n.style.dashed ? '8 6' : null, class: 'body', style: 'pointer-events:none' }));
        g.appendChild(svgEl('rect', { class: 'lane-head', x: 0, y: 0, width: vert ? n.w : band, height: vert ? band : n.h, rx: 6, fill: mix(c, lk.elev, lk.dark ? 0.35 : 0.2), stroke: 'none' }));
        g.appendChild(shapeEl(n.type, n.w, n.h, { fill: 'none', stroke: 'transparent', 'stroke-width': 14, class: 'hit' }));
        if (n.label) {
          const L = wrapText(n.label, { size: 15, weight: 650, maxWidth: (vert ? n.w : n.h) - 24 });
          const tg = textBlock(g, L.lines.slice(0, 1), { cx: vert ? n.w / 2 : band / 2, cy: vert ? band / 2 : n.h / 2, size: 15, weight: 650, color: n.style.text || lk.text, lineHeight: L.lineHeight });
          if (!vert) tg.setAttribute('transform', `rotate(-90 ${band / 2} ${n.h / 2})`);
        }
        return;
      }
      // "No fill": fill === 'none', or the shape's default (Area, Text) when no colour was chosen.
      const noFill = n.style.fill === 'none' || (!n.style.fill && base.noFill);
      const c = colorOf(n, t);
      const mode = noFill ? 'none' : n.style.grad ? 'gradient' : t.node;
      const dashed = n.style.dashed ?? base.dashed;
      const round = t.round;
      let fill = c, stroke = n.style.stroke || (luminance(c) > 0.85 ? lk.border : c), sw = 2, textColor, subColor, filter = null;
      if (mode === 'none') {
        fill = n.type === 'zone' ? 'none' : 'transparent';
        stroke = n.style.stroke || (base.noStroke ? 'transparent' : colorOf(n, t));
        textColor = n.style.text || lk.text;
        subColor = lk.text2;
      } else if (mode === 'glass') {
        fill = mix(c, lk.bg, 0.24);
        stroke = n.style.stroke || c; sw = 1.6;
        textColor = n.style.text || lk.text;
        subColor = lk.text2;
      } else {
        if (mode === 'gradient') { fill = gradFill(c); stroke = n.style.stroke || 'none'; sw = n.style.stroke ? 2 : 0; }
        const on = luminance(c) > 0.6 ? '#111827' : '#ffffff';
        textColor = n.style.text || on;
        subColor = mix(on, c, 0.78);
        if (t.shadow) filter = mode === 'gradient' ? shadow('color', c) : shadow(t.deep ? 'deep' : 'soft');
      }
      if (mode === 'framed') {
        // Infographic: a thick white frame around the coloured shape.
        g.appendChild(shapeEl(n.type, n.w, n.h, { fill: '#ffffff', stroke: '#ffffff', 'stroke-width': 16, 'stroke-linejoin': 'round', filter: t.shadow ? shadow('soft') : null, class: 'frame' }, round));
        filter = null;
        stroke = n.style.stroke || 'none';
        sw = n.style.stroke ? 2 : 0;
      }
      g.appendChild(shapeEl(n.type, n.w, n.h, { fill, stroke, 'stroke-width': sw, 'stroke-dasharray': dashed ? '8 6' : null, class: 'body', filter }, round));
      if (n.type === 'zone') g.appendChild(shapeEl(n.type, n.w, n.h, { fill: 'none', stroke: 'transparent', 'stroke-width': 14, class: 'hit' }));
      nodeText(g, n, textColor, subColor, t);
    }
    /** Shapes' box, and the canvas title above it when it is shown. */
    function nodesBox() {
      const x1 = Math.min(...nodes.map((n) => n.x)), y1 = Math.min(...nodes.map((n) => n.y));
      const x2 = Math.max(...nodes.map((n) => n.x + n.w)), y2 = Math.max(...nodes.map((n) => n.y + n.h));
      return { x1, y1, x2, y2 };
    }
    function drawTitle(t, lk) {
      gDeco.innerHTML = '';
      if (!t.title || !nodes.length) return;
      const b = nodesBox();
      const cx = (b.x1 + b.x2) / 2;
      const title = $('[data-title]').value.trim() || 'Untitled flowchart';
      const tw = wrapText(title, { size: 28, weight: 800, maxWidth: Math.max(300, b.x2 - b.x1) });
      textBlock(gDeco, tw.lines.slice(0, 2), { cx, cy: b.y1 - 70 - (tw.lines.length - 1) * tw.lineHeight / 2, size: 28, weight: 800, color: lk.dark ? '#ffffff' : (t.light ? '#1e2a5a' : lk.text), lineHeight: tw.lineHeight });
      if (data.description) {
        const dw = wrapText(data.description.slice(0, 220), { size: 13, weight: 450, maxWidth: Math.max(320, Math.min(640, b.x2 - b.x1)) });
        textBlock(gDeco, dw.lines.slice(0, 2), { cx, cy: b.y1 - 34, size: 13, weight: 450, color: lk.text2, lineHeight: dw.lineHeight });
      }
    }
    /** Redraw the canvas; the inspector is rebuilt too unless the user is typing in it (it would lose focus). */
    function render({ panel = true } = {}) {
      const t = T(), lk = look();
      applyBackdrop();
      gEdges.innerHTML = '';
      gNodes.innerHTML = '';
      gLanes.innerHTML = '';
      ribbons.innerHTML = '';
      drawTitle(t, lk);
      edges.forEach((e) => drawEdge(e, t, lk));
      nodes.forEach((n) => {
        const isSel = selected.has(n.key);
        const g = svgEl('g', { class: 'fc-node' + (isSel ? ' selected' : '') + (LANES.has(n.type) ? ' fc-lane' : ''), 'data-key': n.key, transform: `translate(${n.x} ${n.y})`, style: 'cursor:move' });
        drawShape(g, n, t, lk);
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
        if (!LANES.has(n.type)) PORTS.forEach((p) => {
          const [px, py] = portPos({ x: 0, y: 0, w: n.w, h: n.h }, p);
          g.appendChild(svgEl('circle', { class: 'fc-port', 'data-port': p, cx: px, cy: py, r: mobile ? 8 : 6 }));
        });
        (LANES.has(n.type) ? gLanes : gNodes).appendChild(g);
      });
      if (panel) renderPanel();
      $('[data-a="undo"]').disabled = !undoStack.length;
      $('[data-a="redo"]').disabled = !redoStack.length;
      player?.refresh();
    }
    /** Lines for the flowing-data animation, in the order the process runs. */
    function flowList() {
      const t = T();
      const items = edges.map((e) => {
        const geo = edgeGeom(e, t);
        if (!geo) return null;
        const a = byKey(e.source), b = byKey(e.target);
        const lineW = t.line === 'ribbon' && !e.style.route ? 14 : t.lineW || 2;
        return {
          from: e.source, to: e.target, d: geo.d, color: e.style.stroke && e.style.stroke !== '#ffffff' ? e.style.stroke : colorOf(a, t),
          dur: Math.max(0.6, Math.min(1.7, Math.hypot(geo.p2[0] - geo.p1[0], geo.p2[1] - geo.p1[1]) / 240)),
          r: Math.max(4.5, Math.min(8, lineW * 0.6)),
          target: { x: b.x, y: b.y, w: b.w, h: b.h, rx: Math.min(t.round ?? 9, b.h / 2) },
        };
      }).filter(Boolean);
      const when = schedule(items);
      return items.map((f) => ({ ...f, delay: when.get(f) }));
    }
    function bbox() {
      if (!nodes.length) return { x: -100, y: -60, w: 200, h: 120 };
      const b = nodesBox();
      const top = T().title ? b.y1 - 100 : b.y1;
      return { x: b.x1 - 10, y: top - 10, w: b.x2 - b.x1 + 20, h: b.y2 - top + 20 };
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
          <div class="field"><label>Route</label><div class="seg fc-seg">${[['', 'Theme'], ['curve', 'Curved'], ['elbow', 'Elbow'], ['straight', 'Straight']].map(([v, l]) => html`<button type="button" class="btn xs ${(edge.style.route || '') === v ? 'active' : ''}" data-route="${v}">${l}</button>`)}</div></div>
          <div class="field"><label>Thickness</label><div class="seg fc-seg">${[['s', 'Thin'], ['', 'Normal'], ['l', 'Thick']].map(([v, l]) => html`<button type="button" class="btn xs ${(edge.style.width || '') === v ? 'active' : ''}" data-ewidth="${v}">${l}</button>`)}</div></div>
          <label class="check small mb-2"><input type="checkbox" data-edge-dashed ${edge.style.dashed ? 'checked' : ''}> Dashed line</label>
          <div class="field"><label>Color</label>${swatchRow('edge-color', edge.style.stroke)}</div>
          <div class="grid grid-2" style="gap:6px"><button class="btn sm" data-a="reverse">${icon('arrow-left-right', 'sm')} Reverse</button><button class="btn sm danger" data-a="delete">${icon('trash-2', 'sm')} Delete</button></div>`);
        return;
      }
      if (selected.size === 1) {
        const n = byKey([...selected][0]);
        panel.innerHTML = String(html`${head('Shape')}
          <div class="field"><label>Text</label><textarea class="textarea" rows="2" data-node-label>${n.label}</textarea></div>
          ${SHAPES[n.type]?.device || LANES.has(n.type) || n.type === 'zone' ? '' : html`<div class="field"><label>Second line <span class="subtle">(optional)</span></label><input class="input sm" data-node-sub maxlength="200" value="${n.style.sub || ''}" placeholder="e.g. 40% monthly increase · Step 2"></div>
          <div class="field"><label>Icon</label><div class="fc-icons"><button type="button" class="fc-ic ${!n.style.icon ? 'active' : ''}" data-node-icon="" aria-label="No icon">${icon('slash', 'sm')}</button>${NODE_ICONS.map((i) => html`<button type="button" class="fc-ic ${n.style.icon === i ? 'active' : ''}" data-node-icon="${i}" aria-label="${i}">${icon(i, 'sm')}</button>`)}</div></div>`}
          <div class="field"><label>Type</label><select class="select sm" data-node-type>${GROUPS.map(([g, gl]) => html`<optgroup label="${gl}">${Object.entries(SHAPES).filter(([, x]) => (x.group || 'flow') === g).map(([t, x]) => html`<option value="${t}" ${n.type === t ? 'selected' : ''}>${t === 'connector' ? 'Connector' : x.label.replace('?', '')}</option>`)}</optgroup>`)}</select></div>
          <div class="field"><label>Fill</label>${swatchRow('fill', n.style.fill || (SHAPES[n.type]?.noFill ? 'none' : ''), true, true)}</div>
          <div class="field"><label>Border</label>${swatchRow('stroke', n.style.stroke)}</div>
          ${SHAPES[n.type]?.device ? '' : html`<label class="check small mb-2"><input type="checkbox" data-node-dashed ${(n.style.dashed ?? SHAPES[n.type]?.dashed) ? 'checked' : ''}> Dashed border</label>`}
          ${SHAPES[n.type]?.device || LANES.has(n.type) || SHAPES[n.type]?.noFill ? '' : html`<label class="check small mb-2"><input type="checkbox" data-node-grad ${n.style.grad ? 'checked' : ''}> Gradient fill</label>`}
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
      const t = T();
      const cur = THEMES[theme.preset] ? theme.preset : 'classic';
      const seg = (k, opts) => html`<div class="seg fc-seg">${opts.map(([v, l]) => html`<button type="button" class="btn xs ${t[k] === v ? 'active' : ''}" data-theme-k="${k}" data-theme-v="${v}">${l}</button>`)}</div>`;
      const sw = (k, label, on) => html`<label class="switch fc-sw"><input type="checkbox" data-theme-toggle="${k}" ${on ? 'checked' : ''}><span class="track"></span><span>${label}</span></label>`;
      panel.innerHTML = String(html`${head('Flowchart')}
        ${canEdit ? html`<div class="fc-look" data-look>
        <label class="fc-h">${icon('palette', 'sm')} Theme</label>
        <div class="fc-presets">${Object.entries(THEMES).map(([k, p]) => html`<button type="button" class="fc-preset ${cur === k ? 'active' : ''}" data-theme-preset="${k}" data-p="${k}">
          <span class="fc-pv">${(p.preview || ['#22c55e', '#6366f1', '#f59e0b']).map((c, i) => html`<i style="--c:${c}"></i>${i < 2 ? html`<b></b>` : ''}`)}</span><span class="fc-pl">${p.label}</span></button>`)}</div>
        <div class="field"><label>Lines</label>${seg('line', [['curve', 'Curved'], ['elbow', 'Elbow'], ['straight', 'Straight'], ['ribbon', 'Ribbon']])}</div>
        <div class="field"><label>Line ends</label>${seg('end', [['arrow', 'Arrow'], ['chevron', 'Badge'], ['dot', 'Dots'], ['none', 'None']])}</div>
        <div class="field"><label>Line names</label>${seg('labels', [['box', 'Box'], ['pill', 'Pill'], ['plain', 'Text']])}</div>
        <div class="field"><label>Background</label>${seg('bg', [['plain', 'Plain'], ['gradient', 'Gradient'], ['dark', 'Dark']])}</div>
        ${sw('shadow', 'Shadows', t.shadow)}${sw('flow', 'Moving lines', !!theme.flow)}${sw('title', 'Title on the canvas', t.title)}
        </div>` : ''}
        <div class="field mt-3"><label>Description</label><textarea class="textarea" rows="4" data-desc placeholder="Describe this process…">${data.description || ''}</textarea></div>
        <label class="check small mb-1"><input type="checkbox" data-setting="grid" ${settings.grid ? 'checked' : ''}> Show grid</label>
        <label class="check small mb-2"><input type="checkbox" data-setting="snap" ${settings.snap ? 'checked' : ''}> Snap to grid</label>
        <dl class="kv small"><dt>Shapes</dt><dd>${nodes.length}</dd><dt>Connectors</dt><dd>${edges.length}</dd></dl>
        <p class="small subtle mt-3">Tip: drag from a port (the dots on a shape's edge) to another shape to connect them. Press Delete to remove the selection.</p>`);
    }

    // ------------------------------------------------------------ actions
    function addNode(type, wx, wy) {
      const s = SHAPES[type];
      const key = uid('n');
      const node = { key, type, label: s.label, x: snap(wx - s.w / 2), y: snap(wy - s.h / 2), w: s.w, h: s.h, style: s.sub ? { sub: s.sub } : {} };
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
      const g = stage.viewport.querySelector(`.fc-node[data-key="${CSS.escape(k)}"] .body`);
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
    const onNodeDown = (e) => {
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
    };
    gNodes.addEventListener('pointerdown', onNodeDown);
    gLanes.addEventListener('pointerdown', onNodeDown);
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
        const target = [...nodes].reverse().find((n) => n.key !== op.from && !LANES.has(n.type) && w.x >= n.x - 10 && w.x <= n.x + n.w + 10 && w.y >= n.y - 10 && w.y <= n.y + n.h + 10);
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
        const target = [...nodes].reverse().find((n) => n.key !== o.from && !LANES.has(n.type) && w.x >= n.x - 10 && w.x <= n.x + n.w + 10 && w.y >= n.y - 10 && w.y <= n.y + n.h + 10);
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
    [gNodes, gLanes].forEach((layer) => layer.addEventListener('dblclick', (e) => { const g = e.target.closest('.fc-node'); if (g) editLabel(g.dataset.key); }));
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
      const pre = e.target.closest('[data-theme-preset]');
      if (pre) return setTheme({ preset: pre.dataset.themePreset });
      const tk = e.target.closest('[data-theme-k]');
      if (tk) return setTheme({ [tk.dataset.themeK]: tk.dataset.themeV });
      const ni = e.target.closest('[data-node-icon]');
      if (ni && selected.size === 1) return change(() => { const n = byKey([...selected][0]); n.style = { ...n.style, icon: ni.dataset.nodeIcon || undefined }; });
      const rt = e.target.closest('[data-route]');
      if (rt && selEdge) return change(() => { const ed = edges.find((x) => x.key === selEdge); ed.style = { ...ed.style, route: rt.dataset.route || undefined }; });
      const ew = e.target.closest('[data-ewidth]');
      if (ew && selEdge) return change(() => { const ed = edges.find((x) => x.key === selEdge); ed.style = { ...ed.style, width: ew.dataset.ewidth || undefined }; });
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
        case 'play':
          if (!edges.length) { toast('Connect a few shapes first — the data flows along the lines.', 'info'); break; }
          player.toggle();
          break;
        case 'style': {
          selected.clear(); selEdge = null;
          const p = $('[data-panel]');
          p.classList.remove('hidden');
          render();
          p.querySelector('[data-look]')?.scrollIntoView({ block: 'start' });
          break;
        }
        case 'export': {
          const name = safeName($('[data-title]').value);
          const bg = look().bg;
          const keep = new Set(selected); const keepE = selEdge;
          const clean = (fn) => async () => { selected.clear(); selEdge = null; render(); try { await fn(); } catch (err) { toastError(err); } selected = keep; selEdge = keepE; render(); };
          menu(e.target.closest('[data-a]'), [
            { label: 'Export as PNG', icon: 'image', onClick: clean(() => exportPng(stage, bbox(), bg, name)) },
            { label: 'Export as SVG', icon: 'file-code', onClick: clean(() => exportSvg(stage, bbox(), bg, name)) },
            { label: 'Export as PDF', icon: 'file-text', onClick: clean(() => exportPdf(stage, bbox(), bg, name)) },
            { label: 'Export animated video (MP4)', icon: 'film', onClick: clean(async () => { const r = await exportFlowVideo({ stage, bbox: bbox(), background: bg, getFlows: flowList, name }); if (r) toast(r.ext === 'mp4' ? `Video saved (${Math.round(r.seconds)} s, ${r.width}×${r.height})` : 'This browser can only record WebM — saved as .webm', r.ext === 'mp4' ? 'success' : 'warning'); }) },
            { divider: true },
            { label: isOwner ? 'Duplicate flowchart' : 'Make a copy', icon: 'copy', onClick: async () => { await save(); const r = await api.post(`flowcharts/${id}/duplicate`).catch(toastError); if (r) navigate(`/flowcharts/${r.id}`); } },
            isOwner && { label: 'Move to trash', icon: 'trash-2', danger: true, onClick: async () => { if (await confirm({ title: 'Delete flowchart?', message: 'It will be moved to the trash.', confirmText: 'Delete' })) { await api.post(`items/flowchart/${id}/trash`).catch(toastError); ctx.beforeLeave = null; navigate('/flowcharts'); } } },
          ], { align: 'end' });
          break;
        }
      }
    });
    el.addEventListener('focusin', (e) => { if (e.target.matches('[data-node-label],[data-node-sub],[data-edge-label],[data-size]')) pushHistory(); });
    el.addEventListener('input', (e) => {
      const t = e.target;
      const n = selected.size === 1 ? byKey([...selected][0]) : null;
      // Typing in the inspector updates the canvas only — the field keeps focus, caret and IME composition.
      if (t.matches('[data-node-label]') && n) { n.label = t.value.slice(0, 500); render({ panel: false }); markDirty(); }
      if (t.matches('[data-node-sub]') && n) { n.style = { ...n.style, sub: t.value.slice(0, 200) || undefined }; render({ panel: false }); markDirty(); }
      if (t.matches('[data-edge-label]') && selEdge) { edges.find((x) => x.key === selEdge).label = t.value.slice(0, 255); render({ panel: false }); markDirty(); }
      if (t.matches('[data-size]') && n && +t.value >= 20) { n[t.dataset.size] = Math.min(2000, +t.value); render({ panel: false }); markDirty(); }
      if (t.matches('[data-desc]')) { data.description = t.value; markDirty(); if (T().title) render({ panel: false }); }
      if (t.matches('[data-title]')) { ctx.setTitle(t.value); markDirty(); if (T().title) render({ panel: false }); }
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      const n = selected.size === 1 ? byKey([...selected][0]) : null;
      if (t.matches('[data-node-type]') && n) change(() => (n.type = t.value));
      if (t.matches('[data-node-dashed]') && n) change(() => (n.style = { ...n.style, dashed: t.checked }));
      if (t.matches('[data-node-grad]') && n) change(() => (n.style = { ...n.style, grad: t.checked || undefined }));
      if (t.matches('[data-theme-toggle]')) setTheme({ [t.dataset.themeToggle]: t.checked });
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
          settings: { ...settings, theme },
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

    player = createFlowPlayer({ stage, getFlows: flowList, onState: (on) => {
      const b = $('[data-a="play"]');
      b.classList.toggle('active', on);
      b.innerHTML = String(html`${icon(on ? 'pause' : 'play', 'sm')}<span class="hide-sm" data-play-label>${on ? 'Stop' : 'Play'}</span>`);
    } });
    render();
    requestAnimationFrame(() => {
      if (data.viewport && data.viewport.zoom) stage.setViewport(data.viewport);
      else stage.fit(bbox(), 80, 1);
      vpDirty = false;
    });
    return () => {
      player.destroy();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKeyUp);
      autosave.cancel();
      stage.destroy();
      shell.saveHandler = null;
    };
  },
};
