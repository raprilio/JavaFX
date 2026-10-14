// Interactive mind map editor (SVG). Data is stored relationally in MySQL (mindmap_nodes / mindmap_edges).
import { html, icon, uid, debounce, h, esc } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { api } from '../core/api.js';
import { navigate } from '../core/router.js';
import { shell } from '../core/shell.js';
import { toast, toastError, menu, confirm, prompt } from '../core/ui.js';
import { openItemShare } from '../components/itemShare.js';
import { createStage, svgEl, wrapText, textBlock, themeColors, exportPng, exportSvg, exportPdf, safeName, FONT_STACK } from '../components/canvas.js';
import { createFlowPlayer, exportFlowVideo, schedule } from '../components/flowPlayer.js';

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b'];
const NEON = ['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#facc15', '#fb923c', '#60a5fa', '#f87171'];
// Looks for the whole map (v1.16). root / l1 / ln: how the central topic, main branches and sub-topics are filled.
const PRESETS = {
  classic: { label: 'Classic', edge: 'curve', bg: 'plain', font: 'sans', rainbow: true, root: 'solid', l1: 'soft', ln: 'outline', shape: 'rounded', rootShape: 'pill', edgeW: [3, 2], taper: [10, 5] },
  vivid: { label: 'Vivid', edge: 'taper', bg: 'dots', font: 'rounded', rainbow: true, root: 'gradient', l1: 'solid', ln: 'soft', shape: 'pill', rootShape: 'pill', edgeW: [3.5, 2.5], taper: [13, 6] },
  pastel: { label: 'Pastel', edge: 'curve', bg: 'gradient', font: 'rounded', rainbow: true, pastel: true, root: 'soft', l1: 'soft', ln: 'soft', shape: 'pill', rootShape: 'ellipse', edgeW: [4.5, 3], taper: [12, 6] },
  organic: { label: 'Organic', edge: 'taper', bg: 'plain', font: 'sans', rainbow: true, root: 'solid', l1: 'outline', ln: 'outline', shape: 'underline', rootShape: 'pill', edgeW: [3, 2], taper: [11, 4.5] },
  neon: { label: 'Neon', edge: 'curve', bg: 'gradient', font: 'sans', rainbow: true, dark: true, root: 'glow', l1: 'glow', ln: 'glow', shape: 'rounded', rootShape: 'pill', edgeW: [2.6, 2], taper: [9, 4] },
  mono: { label: 'Minimal', edge: 'elbow', bg: 'dots', font: 'sans', rainbow: false, mono: true, root: 'solid', l1: 'outline', ln: 'bare', shape: 'rect', rootShape: 'rect', edgeW: [2, 1.5], taper: [7, 3] },
};
const FONTS = {
  sans: FONT_STACK,
  rounded: "ui-rounded, 'Nunito', 'Quicksand', 'Varela Round', 'SF Pro Rounded', " + FONT_STACK,
  serif: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
  hand: "'Comic Neue', 'Segoe Print', 'Bradley Hand', 'Chalkboard SE', 'Comic Sans MS', cursive",
};
const SIZE_K = { s: 0.85, m: 1, l: 1.22, xl: 1.5 };
const SHAPES = [['', 'Auto'], ['rounded', 'Rounded'], ['pill', 'Pill'], ['rect', 'Box'], ['ellipse', 'Oval'], ['hexagon', 'Hexagon'], ['cloud', 'Cloud'], ['underline', 'Underline'], ['plain', 'Text only']];
const EMOJIS = ['💡', '⭐', '🎯', '🚀', '✅', '❗', '❓', '🔥', '💰', '📅', '👥', '📌', '🧠', '🛠️', '📈', '⚠️', '❤️', '🎉', '📝', '🔍', '⏰', '🏆', '🌱', '💬'];
const NODE_ICONS = ['lightbulb', 'star', 'flag', 'heart', 'check', 'circle-alert', 'target', 'rocket', 'book-open', 'briefcase', 'calendar', 'users', 'dollar-sign', 'code', 'zap', 'bookmark', 'message-circle', 'clock', 'trophy', 'circle-help'];
const GAP_X = 56, GAP_Y = 14;

export default {
  title: 'Mind map',
  async render(el, ctx) {
    const id = +ctx.params.id;
    let data;
    try { data = await api.get(`mindmaps/${id}`); } catch (e) {
      el.innerHTML = String(html`<div class="content"><div class="empty"><div class="empty-art">${icon('network', 'xl')}</div><h3>Mind map not found</h3><p>${e.message}</p><a class="btn primary" href="#/mindmaps">Back</a></div></div>`);
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
    /** @type {Map<string, any>} */
    const nodes = new Map();
    data.nodes.forEach((n, i) => nodes.set(n.key, { ...n, order: n.order ?? i }));
    let links = data.edges.filter((e) => e.type === 'link').map((e) => ({ source: e.source, target: e.target, label: e.label || '' }));
    let sel = null, selLink = -1, connectFrom = null, dirty = false, saving = false;
    let vpDirty = false;
    const undoStack = [], redoStack = [];
    const sizes = new Map();
    const mobile = matchMedia('(max-width: 767px)').matches;

    el.innerHTML = String(html`<div class="canvas-page ${canEdit ? '' : 'readonly'}">
      <div class="canvas-bar">
        <a class="btn ghost icon sm" href="#/mindmaps" data-tip="Back">${icon('arrow-left')}</a>
        <input class="title-input" value="${data.title}" data-title maxlength="255" aria-label="Title" ${canEdit ? '' : 'readonly'}>
        <span class="save-state" data-save><span class="d"></span><span data-save-text>${canEdit ? 'Saved' : 'View only'}</span></span>
        ${isOwner ? html`<button class="btn ghost sm ${shareCount ? 'active' : ''}" data-a="share" data-tip="Share with users">${icon('users', 'sm')}<span class="hide-sm">Share</span><span data-share-count>${shareCount || ''}</span></button>`
          : html`<span class="badge info shared-by">${icon('user', 'sm')} ${data.owner?.name} · ${canEdit ? 'can edit' : 'view only'}</span>${canEdit ? '' : html`<button class="btn sm" data-a="copy">${icon('copy', 'sm')}<span class="hide-sm">Make a copy</span></button>`}`}
        <div class="grow"></div>
        <button class="btn ghost icon sm" data-a="undo" data-edit data-tip="Undo (Ctrl+Z)">${icon('undo-2', 'sm')}</button>
        <button class="btn ghost icon sm" data-a="redo" data-edit data-tip="Redo (Ctrl+Y)">${icon('redo-2', 'sm')}</button>
        <span class="divider-v"></span>
        <button class="btn ghost sm" data-a="child" data-edit data-tip="Add child (Tab)">${icon('git-branch-plus', 'sm')}<span class="hide-sm">Child</span></button>
        <button class="btn ghost sm" data-a="sibling" data-edit data-tip="Add sibling (Enter)">${icon('plus', 'sm')}<span class="hide-sm">Sibling</span></button>
        <button class="btn ghost icon sm" data-a="parent" data-edit data-tip="Add parent">${icon('arrow-up-from-dot', 'sm')}</button>
        <button class="btn ghost icon sm" data-a="connect" data-edit data-tip="Connect two nodes">${icon('spline', 'sm')}</button>
        <button class="btn ghost icon sm" data-a="layout" data-edit data-tip="Auto layout">${icon('wand-sparkles', 'sm')}</button>
        <button class="btn ghost sm" data-a="style" data-edit data-tip="Look: theme, branches, layout">${icon('palette', 'sm')}<span class="hide-sm">Style</span></button>
        <button class="btn ghost sm flow-play" data-a="play" data-tip="Play: ideas flow out from the centre">${icon('play', 'sm')}<span class="hide-sm">Play</span></button>
        <button class="btn ghost icon sm" data-a="export" data-tip="Export">${icon('download', 'sm')}</button>
        <button class="btn ghost icon sm" data-a="panel" data-tip="Inspector">${icon('panel-right', 'sm')}</button>
      </div>
      <div class="canvas-body">
        <div class="canvas-stage" data-stage>
          <div class="canvas-zoom"><button class="btn ghost icon xs" data-a="zoom-out" aria-label="Zoom out">${icon('minus', 'sm')}</button><span data-zoom>100%</span>
            <button class="btn ghost icon xs" data-a="zoom-in" aria-label="Zoom in">${icon('plus', 'sm')}</button><button class="btn ghost icon xs" data-a="fit" data-tip="Fit to screen">${icon('maximize', 'sm')}</button></div>
          <div class="canvas-hint" data-hint>Tab: child · Enter: sibling · F2/double-click: edit · Space: collapse · Del: delete · Drag a node onto another to re-parent</div>
        </div>
        <aside class="canvas-panel ${mobile ? 'hidden' : ''}" data-panel></aside>
      </div></div>`);
    const $ = (s) => el.querySelector(s);
    const stageEl = $('[data-stage]');
    const stage = createStage(stageEl, { onChange: (vp) => { $('[data-zoom]').textContent = Math.round(vp.zoom * 100) + '%'; markViewport(); } });
    const gEdges = svgEl('g');
    const gLinks = svgEl('g');
    const gNodes = svgEl('g');
    stage.viewport.append(gEdges, gLinks, gNodes);
    const marker = svgEl('marker', { id: 'mm-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    const markerPath = svgEl('path', { d: 'M0 0 L10 5 L0 10 z' });
    marker.appendChild(markerPath);
    stage.defs.appendChild(marker);

    // ------------------------------------------------------------ model helpers
    let kidsCache = null;
    const buildKids = () => {
      const m = new Map();
      nodes.forEach((n) => { if (n.parent) (m.get(n.parent) || m.set(n.parent, []).get(n.parent)).push(n); });
      m.forEach((l) => l.sort((a, b) => a.order - b.order));
      return m;
    };
    const children = (k) => (kidsCache ? kidsCache.get(k) || [] : [...nodes.values()].filter((n) => n.parent === k).sort((a, b) => a.order - b.order));
    const roots = () => [...nodes.values()].filter((n) => !n.parent || !nodes.has(n.parent)).sort((a, b) => a.order - b.order);
    const depth = (n) => { let d = 0, c = n; while (c.parent && nodes.has(c.parent) && d < 100) { c = nodes.get(c.parent); d++; } return d; };
    const descendants = (k, acc = new Set()) => { children(k).forEach((c) => { acc.add(c.key); descendants(c.key, acc); }); return acc; };
    const isHidden = (n) => { let c = n; let i = 0; while (c.parent && nodes.has(c.parent) && i++ < 100) { c = nodes.get(c.parent); if (c.collapsed) return true; } return false; };

    // ------------------------------------------------------------ look (v1.16): a theme per map, a style per topic
    let theme = { ...(data.theme || {}) };
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    /** Effective look: the preset, with the map's own choices on top. */
    const T = () => {
      const t = { ...(PRESETS[theme.preset] || PRESETS.classic) };
      ['edge', 'layout', 'bg', 'font'].forEach((k) => { if (theme[k]) t[k] = theme[k]; });
      if (typeof theme.rainbow === 'boolean') t.rainbow = theme.rainbow;
      t.layout = t.layout || 'balanced';
      t.motion = theme.motion !== false && !reduceMotion;
      t.family = FONTS[t.font] || FONT_STACK;
      return t;
    };
    function look() {
      const th = themeColors();
      return T().dark ? { ...th, bg: '#0b1020', elev: '#121a33', soft: '#1a2340', border: '#2a3558', text: '#e8ecff', text2: '#9aa6cf', dark: true } : th;
    }
    function applyBackdrop() {
      const t = T(), lk = look();
      stageEl.dataset.mmBg = t.bg;
      stageEl.classList.toggle('mm-dark', !!t.dark);
      stageEl.style.background = t.bg === 'gradient'
        ? `radial-gradient(ellipse at 50% 38%, ${mix(t.dark ? '#4f46e5' : lk.accent, lk.bg, t.dark ? 0.32 : 0.12)}, ${lk.bg} 72%)`
        : lk.bg;
      stage.setGrid(t.bg === 'dots');
    }
    const branchColor = (n) => {
      if (n.color) return n.color;
      const t = T();
      if (!t.rainbow) return t.mono ? (look().dark ? '#cbd5e1' : '#334155') : themeColors().accent;
      const pal = t.dark ? NEON : COLORS;
      let c = n;
      for (let guard = 0; guard < 100; guard++) {
        const p = c.parent && nodes.get(c.parent);
        if (!p) return themeColors().accent;
        if (!p.parent || !nodes.has(p.parent)) return c.color || pal[Math.max(0, children(p.key).indexOf(c)) % pal.length];
        c = p;
        if (c.color) return c.color;
      }
      return themeColors().accent;
    };
    const snapshot = () => JSON.stringify({ nodes: [...nodes.values()], links, theme });
    const pushHistory = () => { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; };
    const restoreSnap = (s) => { const d = JSON.parse(s); nodes.clear(); d.nodes.forEach((n) => nodes.set(n.key, n)); links = d.links; if (d.theme) theme = d.theme; };

    const shapeOf = (n, d) => n.style?.shape || (d === 0 ? T().rootShape : d === 1 ? T().l1Shape || T().shape : T().shape);
    function measure(n) {
      const d = depth(n);
      const t = T();
      const st = n.style || {};
      const isRoot = d === 0;
      const size = Math.round((isRoot ? 18 : d === 1 ? 15 : 14) * (SIZE_K[st.size] || 1));
      const weight = st.bold ? 760 : isRoot ? 700 : d === 1 ? 620 : 520;
      const shape = shapeOf(n, d);
      const tx = wrapText(n.label || ' ', { size, weight, maxWidth: isRoot ? 260 : 220, family: t.family });
      let padX = isRoot ? 22 : 14, padY = isRoot ? 14 : 9;
      if (shape === 'underline' || shape === 'plain') { padX = 6; padY = 6; }
      const iconW = n.icon ? 22 : 0;
      const emojiW = st.emoji ? Math.round(size * 1.3) + 5 : 0;
      let w = tx.width + padX * 2 + iconW + emojiW, hh = tx.lines.length * tx.lineHeight + padY * 2;
      if (shape === 'ellipse') { w *= 1.2; hh *= 1.32; }
      if (shape === 'hexagon') w += hh * 0.55;
      if (shape === 'cloud') { w *= 1.22; hh *= 1.45; }
      const s = { w: Math.ceil(w), h: Math.ceil(hh), t: tx, size, weight, padX, iconW, emojiW, depth: d, shape };
      sizes.set(n.key, s);
      return s;
    }

    // ------------------------------------------------------------ layout
    function autoLayout() {
      [...nodes.values()].forEach(measure);
      const t = T();
      if (t.layout === 'down') return layoutDown();
      const subH = new Map();
      const calcH = (k) => {
        const n = nodes.get(k);
        const kids = n.collapsed ? [] : children(k);
        const own = sizes.get(k).h;
        const sum = kids.reduce((s, c) => s + calcH(c.key), 0) + GAP_Y * Math.max(0, kids.length - 1);
        const v = Math.max(own, sum);
        subH.set(k, v);
        return v;
      };
      const place = (k, side, x, y) => {
        const n = nodes.get(k);
        n.x = x; n.y = y;
        const kids = n.collapsed ? [] : children(k);
        const total = kids.reduce((s, c) => s + subH.get(c.key), 0) + GAP_Y * Math.max(0, kids.length - 1);
        let cy = y - total / 2;
        const w = sizes.get(k).w;
        kids.forEach((c) => {
          const ch = subH.get(c.key);
          const cw = sizes.get(c.key).w;
          place(c.key, side, x + side * (w / 2 + GAP_X + cw / 2), cy + ch / 2);
          cy += ch + GAP_Y;
        });
      };
      roots().forEach((r, ri) => {
        const kids = r.collapsed ? [] : children(r.key);
        kids.forEach((c) => calcH(c.key));
        const rx = r.x ?? 0, ry = r.y ?? 0;
        const oneSide = ri > 0 || t.layout === 'right';
        const right = oneSide ? kids : kids.slice(0, Math.ceil(kids.length / 2));
        const left = oneSide ? [] : kids.slice(Math.ceil(kids.length / 2));
        const w = sizes.get(r.key).w;
        [[right, 1], [left, -1]].forEach(([list, side]) => {
          const total = list.reduce((s, c) => s + subH.get(c.key), 0) + GAP_Y * Math.max(0, list.length - 1);
          let cy = ry - total / 2;
          list.forEach((c) => {
            const ch = subH.get(c.key);
            place(c.key, side, rx + side * (w / 2 + GAP_X * 1.4 + sizes.get(c.key).w / 2), cy + ch / 2);
            cy += ch + GAP_Y;
          });
        });
      });
    }
    /** Top-down (org chart): children in a row under their parent. */
    function layoutDown() {
      const GX = 24, GY = 62;
      const subW = new Map();
      const calcW = (k) => {
        const n = nodes.get(k);
        const kids = n.collapsed ? [] : children(k);
        const sum = kids.reduce((a, c) => a + calcW(c.key), 0) + GX * Math.max(0, kids.length - 1);
        const v = Math.max(sizes.get(k).w, sum);
        subW.set(k, v);
        return v;
      };
      const place = (k, x, y) => {
        const n = nodes.get(k);
        n.x = x; n.y = y;
        const kids = n.collapsed ? [] : children(k);
        const total = kids.reduce((a, c) => a + subW.get(c.key), 0) + GX * Math.max(0, kids.length - 1);
        let cx = x - total / 2;
        const h = sizes.get(k).h;
        kids.forEach((c) => {
          const cw = subW.get(c.key);
          place(c.key, cx + cw / 2, y + h / 2 + GY + sizes.get(c.key).h / 2);
          cx += cw + GX;
        });
      };
      roots().forEach((r) => { calcW(r.key); place(r.key, r.x ?? 0, r.y ?? 0); });
    }

    // ------------------------------------------------------------ render
    /** Where a branch leaves the parent and reaches the child (underlined topics connect at the line's end). */
    function anchors(pa, ps, a, s, vert) {
      if (vert) return [{ x: pa.x, y: pa.y + (ps.h * pa.s) / 2 }, { x: a.x, y: a.y - (s.h * a.s) / 2 }];
      const sd = a.x >= pa.x ? 1 : -1;
      return [
        { x: pa.x + (sd * ps.w * pa.s) / 2, y: ps.shape === 'underline' ? pa.y + (ps.h * pa.s) / 2 : pa.y },
        { x: a.x - (sd * s.w * a.s) / 2, y: s.shape === 'underline' ? a.y + (s.h * a.s) / 2 : a.y },
      ];
    }
    const ctrl = (p, c, vert) => (vert ? [{ x: p.x, y: (p.y + c.y) / 2 }, { x: c.x, y: (p.y + c.y) / 2 }] : [{ x: (p.x + c.x) / 2, y: p.y }, { x: (p.x + c.x) / 2, y: c.y }]);
    function curvePath(p, c, vert) { const [c1, c2] = ctrl(p, c, vert); return `M${p.x} ${p.y} C${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${c.x} ${c.y}`; }
    function roundPoly(pts, r) {
      let d = `M${pts[0].x} ${pts[0].y}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], b = pts[i], c = pts[i + 1];
        const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
        const rr = Math.min(r, l1 / 2, l2 / 2);
        if (rr < 0.5) { d += ` L${b.x} ${b.y}`; continue; }
        d += ` L${b.x + ((a.x - b.x) * rr) / l1} ${b.y + ((a.y - b.y) * rr) / l1} Q${b.x} ${b.y} ${b.x + ((c.x - b.x) * rr) / l2} ${b.y + ((c.y - b.y) * rr) / l2}`;
      }
      const z = pts[pts.length - 1];
      return d + ` L${z.x} ${z.y}`;
    }
    function elbowPath(p, c, vert) {
      if (vert) { const my = (p.y + c.y) / 2; return roundPoly([p, { x: p.x, y: my }, { x: c.x, y: my }, c], 10); }
      const mx = (p.x + c.x) / 2;
      return roundPoly([p, { x: mx, y: p.y }, { x: mx, y: c.y }, c], 10);
    }
    /** A branch that is thick at the parent and thin at the child (organic look). */
    function taperPath(p, c, w0, w1, vert) {
      const [c1, c2] = ctrl(p, c, vert);
      const L = [], R = [];
      for (let i = 0; i <= 22; i++) {
        const t = i / 22, u = 1 - t;
        const x = u * u * u * p.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * c.x;
        const y = u * u * u * p.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * c.y;
        const dx = 3 * u * u * (c1.x - p.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (c.x - c2.x);
        const dy = 3 * u * u * (c1.y - p.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (c.y - c2.y);
        const len = Math.hypot(dx, dy) || 1;
        const hw = (w0 + (w1 - w0) * t) / 2;
        L.push(`${(x - (dy / len) * hw).toFixed(1)} ${(y + (dx / len) * hw).toFixed(1)}`);
        R.push(`${(x + (dy / len) * hw).toFixed(1)} ${(y - (dx / len) * hw).toFixed(1)}`);
      }
      return `M${L.join(' L')} L${R.reverse().join(' L')} Z`;
    }
    function edgeEl(t, pa, ps, a, s, color, vert) {
      const [p, c] = anchors(pa, ps, a, s, vert);
      const d = s.depth;
      const glow = t.dark ? 'url(#mm-glow)' : null;
      const col = t.pastel ? mix(color, look().elev, 0.62) : color;
      if (t.edge === 'taper') {
        const w0 = (d === 1 ? t.taper[0] : t.taper[1]) * Math.max(0.3, a.s);
        return svgEl('path', { d: taperPath(p, c, w0, Math.max(1.4, w0 * 0.28), vert), fill: col, opacity: 0.92, filter: glow });
      }
      const path = t.edge === 'straight' ? `M${p.x} ${p.y} L${c.x} ${c.y}` : t.edge === 'elbow' ? elbowPath(p, c, vert) : curvePath(p, c, vert);
      return svgEl('path', { d: path, fill: 'none', stroke: col, 'stroke-width': d === 1 ? t.edgeW[0] : t.edgeW[1], 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.88, filter: glow });
    }
    function shapeEl(shape, w, hgt, attrs) {
      if (shape === 'ellipse') return svgEl('ellipse', { cx: w / 2, cy: hgt / 2, rx: w / 2, ry: hgt / 2, ...attrs });
      if (shape === 'hexagon') { const k = hgt * 0.3; return svgEl('polygon', { points: `${k},0 ${w - k},0 ${w},${hgt / 2} ${w - k},${hgt} ${k},${hgt} 0,${hgt / 2}`, ...attrs }); }
      if (shape === 'cloud') {
        const X = (v) => ((v * w) / 100).toFixed(1), Y = (v) => ((v * hgt) / 60).toFixed(1);
        const pts = [[20, 50], [8, 50, 1, 40, 8, 31], [1, 22, 12, 11, 24, 15], [28, 3, 47, 1, 54, 11], [62, 2, 80, 4, 82, 16], [97, 16, 101, 33, 91, 40], [99, 51, 87, 61, 74, 54], [66, 62, 47, 62, 40, 54], [31, 60, 17, 59, 20, 50]];
        const d = `M${X(pts[0][0])} ${Y(pts[0][1])} ` + pts.slice(1).map((q) => `C${X(q[0])} ${Y(q[1])}, ${X(q[2])} ${Y(q[3])}, ${X(q[4])} ${Y(q[5])}`).join(' ') + ' Z';
        return svgEl('path', { d, ...attrs });
      }
      const rx = shape === 'pill' ? hgt / 2 : shape === 'rect' ? 4 : shape === 'underline' || shape === 'plain' ? 6 : 11;
      return svgEl('rect', { width: w, height: hgt, rx, ...attrs });
    }
    const gradIds = new Set();
    function gradient(color) {
      const id = 'mmg-' + color.replace(/[^0-9a-z]/gi, '');
      if (!gradIds.has(id)) {
        const g = svgEl('linearGradient', { id, x1: 0, y1: 0, x2: 1, y2: 1 });
        g.append(svgEl('stop', { offset: '0%', 'stop-color': mix('#ffffff', color, 0.28) }), svgEl('stop', { offset: '100%', 'stop-color': mix('#000000', color, 0.12) }));
        stage.defs.appendChild(g);
        gradIds.add(id);
      }
      return `url(#${id})`;
    }
    const readable = (hex) => {
      if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#ffffff';
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62 ? '#111827' : '#ffffff';
    };
    {
      const f = svgEl('filter', { id: 'mm-glow', x: '-40%', y: '-40%', width: '180%', height: '180%' });
      f.append(svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 3, result: 'b' }));
      const m = svgEl('feMerge');
      m.append(svgEl('feMergeNode', { in: 'b' }), svgEl('feMergeNode', { in: 'SourceGraphic' }));
      f.append(m);
      stage.defs.appendChild(f);
    }

    function drawNode(n, a, t, th) {
      const s = sizes.get(n.key);
      const color = branchColor(n);
      const st = n.style || {};
      const d = s.depth;
      const shape = s.shape;
      let mode = st.fill === 'none' ? 'outline' : st.fill || (d === 0 ? t.root : d === 1 ? t.l1 : t.ln);
      if (shape === 'underline' || shape === 'plain') mode = 'bare';
      const g = svgEl('g', { class: 'mm-node', 'data-key': n.key, transform: `translate(${a.x - (s.w * a.s) / 2} ${a.y - (s.h * a.s) / 2})${a.s !== 1 ? ` scale(${a.s})` : ''}`, opacity: a.o < 1 ? a.o.toFixed(3) : null });
      let fill = th.elev, stroke = 'none', sw = 0, text = th.text, filter = null, iconCol = color;
      switch (mode) {
        case 'solid': fill = color; text = iconCol = readable(color); break;
        case 'gradient': fill = gradient(color); text = iconCol = '#ffffff'; break;
        case 'soft':
          fill = mix(color, th.elev, th.dark ? 0.3 : t.pastel ? 0.28 : 0.16);
          if (!t.pastel) { stroke = color; sw = d === 1 ? 2 : 1.5; } else text = mix(color, th.text, 0.38);
          break;
        case 'glow': fill = mix(color, th.elev, 0.16); stroke = color; sw = 2; text = mix(color, '#ffffff', 0.45); filter = 'url(#mm-glow)'; break;
        case 'bare': fill = 'transparent'; text = d === 0 ? color : th.text; break;
        default: stroke = color; sw = d === 1 ? 2 : 1.5; // outline
      }
      g.appendChild(shapeEl(shape, s.w, s.h, { class: 'body', fill, stroke, 'stroke-width': sw, filter }));
      if (shape === 'underline') g.appendChild(svgEl('path', { d: `M0 ${s.h} L${s.w} ${s.h}`, stroke: color, 'stroke-width': d <= 1 ? 3.5 : 2.5, 'stroke-linecap': 'round', filter }));
      let x0 = (s.w - (s.emojiW + s.iconW + s.t.width)) / 2;
      if (st.emoji) {
        const e = svgEl('text', { x: x0 + (s.emojiW - 5) / 2, y: s.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': Math.round(s.size * 1.18) });
        e.textContent = st.emoji;
        g.appendChild(e);
        x0 += s.emojiW;
      }
      if (n.icon && ICONS[n.icon]) {
        const ig = svgEl('g', { transform: `translate(${x0} ${s.h / 2 - 9}) scale(0.75)`, fill: 'none', stroke: iconCol, 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        ig.innerHTML = ICONS[n.icon];
        g.appendChild(ig);
        x0 += s.iconW;
      }
      textBlock(g, s.t.lines, { cx: x0 + s.t.width / 2, cy: s.h / 2, size: s.size, weight: s.weight, color: text, lineHeight: s.t.lineHeight, family: t.family });
      if (n.notes) {
        const nd = svgEl('circle', { cx: s.w - 6, cy: 6, r: 4.5, fill: '#f59e0b', stroke: th.elev, 'stroke-width': 1.5 });
        const tt = svgEl('title'); tt.textContent = n.notes; nd.appendChild(tt);
        g.appendChild(nd);
      }
      const kids = children(n.key);
      if (kids.length) {
        const vert = t.layout === 'down';
        const right = !n.parent || !nodes.has(n.parent) ? true : n.x >= nodes.get(n.parent).x;
        const pos = vert ? `${s.w / 2} ${s.h + 11}` : `${right ? s.w + 10 : -10} ${shape === 'underline' ? s.h : s.h / 2}`;
        const tg = svgEl('g', { class: 'mm-toggle mm-toggle-ui', 'data-toggle': n.key, transform: `translate(${pos})`, style: 'cursor:pointer' });
        tg.appendChild(svgEl('circle', { r: 9, fill: th.elev, stroke: color, 'stroke-width': 1.5 }));
        const tx2 = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': n.collapsed ? 10 : 13, 'font-weight': 700, fill: color, 'font-family': 'sans-serif' });
        tx2.textContent = n.collapsed ? String(descendants(n.key).size) : '−';
        tg.appendChild(tx2);
        g.appendChild(tg);
      }
      const round = shape === 'pill' || shape === 'ellipse' || shape === 'cloud';
      if (sel === n.key) g.appendChild(svgEl('rect', { class: 'sel-ring', x: -5, y: -5, width: s.w + 10, height: s.h + 10, rx: round ? (s.h + 10) / 2 : 14 }));
      if (connectFrom === n.key) g.appendChild(svgEl('rect', { class: 'sel-ring', x: -8, y: -8, width: s.w + 16, height: s.h + 16, rx: 16, style: 'stroke:#f59e0b' }));
      gNodes.appendChild(g);
    }

    let anim = null, animRaf = 0;
    let player = null; // flowing data (v1.18)
    function render({ panel = true } = {}) {
      kidsCache = buildKids();
      try { renderInner(panel); } finally { kidsCache = null; }
    }
    function renderInner(panel = true) {
      const t = T(), th = look();
      applyBackdrop();
      markerPath.setAttribute('fill', th.text2);
      [...nodes.values()].forEach(measure);
      gEdges.innerHTML = '';
      gLinks.innerHTML = '';
      gNodes.innerHTML = '';
      const P = (n) => anim?.get(n.key) || { x: n.x, y: n.y, s: 1, o: 1 };
      let visible = [...nodes.values()].filter((n) => !isHidden(n));
      if (anim) visible = visible.concat([...nodes.values()].filter((n) => isHidden(n) && anim.has(n.key))); // topics folding away
      const vert = t.layout === 'down';
      // tree branches
      visible.forEach((n) => {
        if (!n.parent || !nodes.has(n.parent)) return;
        const p = nodes.get(n.parent);
        const a = P(n);
        const e = edgeEl(t, P(p), sizes.get(p.key), a, sizes.get(n.key), branchColor(n), vert);
        if (a.o < 1) e.setAttribute('opacity', (0.9 * a.o).toFixed(3));
        gEdges.appendChild(e);
      });
      // free links
      links.forEach((l, i) => {
        const na = nodes.get(l.source), nb = nodes.get(l.target);
        if (!na || !nb || isHidden(na) || isHidden(nb)) return;
        const a = P(na), b = P(nb);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - Math.min(120, Math.abs(a.x - b.x) * 0.25 + 40);
        const d = `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`;
        const g = svgEl('g', { 'data-link': i });
        g.appendChild(svgEl('path', { d, class: 'edge-path' + (selLink === i ? ' selected' : ''), fill: 'none', stroke: th.text2, 'stroke-width': 1.8, 'stroke-dasharray': '6 5', 'marker-end': 'url(#mm-arrow)' }));
        g.appendChild(svgEl('path', { d, class: 'edge-hit' }));
        if (l.label) {
          const tw = wrapText(l.label, { size: 12, weight: 500, maxWidth: 160, family: t.family });
          const lx = (a.x + 2 * mx + b.x) / 4, ly = (a.y + 2 * my + b.y) / 4;
          g.appendChild(svgEl('rect', { x: lx - tw.width / 2 - 6, y: ly - (tw.lines.length * tw.lineHeight) / 2 - 3, width: tw.width + 12, height: tw.lines.length * tw.lineHeight + 6, rx: 6, fill: th.elev, stroke: th.border }));
          textBlock(g, tw.lines, { cx: lx, cy: ly, size: 12, weight: 500, color: th.text2, lineHeight: tw.lineHeight, family: t.family });
        }
        gLinks.appendChild(g);
      });
      visible.forEach((n) => drawNode(n, P(n), t, th));
      if (panel) renderPanel(); // not while the user types in it
      $('[data-a="undo"]').disabled = !undoStack.length;
      $('[data-a="redo"]').disabled = !redoStack.length;
      if (!anim) player?.refresh();
    }
    /** Branches for the flowing-data animation: from the central topic outwards, level by level. */
    function flowList() {
      const t = T(), vert = t.layout === 'down';
      const one = (n) => ({ x: n.x, y: n.y, s: 1, o: 1 });
      kidsCache = buildKids();
      try {
        [...nodes.values()].forEach(measure);
        const items = [...nodes.values()].filter((n) => n.parent && nodes.has(n.parent) && !isHidden(n)).map((n) => {
          const p = nodes.get(n.parent), s = sizes.get(n.key), ps = sizes.get(p.key);
          const [a, c] = anchors(one(p), ps, one(n), s, vert);
          const d = t.edge === 'straight' ? `M${a.x} ${a.y} L${c.x} ${c.y}` : t.edge === 'elbow' ? elbowPath(a, c, vert) : curvePath(a, c, vert);
          const round = s.shape === 'pill' || s.shape === 'ellipse' || s.shape === 'cloud';
          return { from: p.key, to: n.key, d, color: branchColor(n), dur: 0.8, r: s.depth === 1 ? 6.5 : 4.5,
            target: { x: n.x - s.w / 2, y: n.y - s.h / 2, w: s.w, h: s.h, rx: round ? s.h / 2 : 11 } };
        });
        const when = schedule(items);
        return items.map((f) => ({ ...f, delay: when.get(f) }));
      } finally { kidsCache = null; }
    }

    // ------------------------------------------------------------ motion: topics glide to their new place, new ones grow out of their parent
    const positions = () => { const m = new Map(); nodes.forEach((n) => m.set(n.key, { x: n.x, y: n.y, vis: !isHidden(n) })); return m; };
    function animateFrom(prev) {
      if (!prev || !T().motion || nodes.size > 220) return;
      cancelAnimationFrame(animRaf);
      anim = null;
      const start = new Map(), end = new Map();
      const seenBefore = (n) => { let p = n.parent && nodes.get(n.parent); while (p) { const w = prev.get(p.key); if (w?.vis) return w; p = p.parent && nodes.get(p.parent); } return null; };
      nodes.forEach((n) => {
        const was = prev.get(n.key), vis = !isHidden(n);
        if (vis) {
          end.set(n.key, { x: n.x, y: n.y, s: 1, o: 1 });
          if (was?.vis) start.set(n.key, { x: was.x, y: was.y, s: 1, o: 1 });
          else { const o = seenBefore(n) || { x: n.x, y: n.y }; start.set(n.key, { x: o.x, y: o.y, s: 0.3, o: 0 }); }
        } else if (was?.vis) {
          let p = n.parent && nodes.get(n.parent);
          while (p && isHidden(p)) p = p.parent && nodes.get(p.parent);
          start.set(n.key, { x: was.x, y: was.y, s: 1, o: 1 });
          end.set(n.key, { x: p ? p.x : was.x, y: p ? p.y : was.y, s: 0.3, o: 0 });
        }
      });
      let moving = false;
      start.forEach((a, k) => { const b = end.get(k); if (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5 || a.s !== b.s || a.o !== b.o) moving = true; });
      if (!moving) return;
      const t0 = performance.now(), D = 340;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / D);
        if (k >= 1) { anim = null; render({ panel: false }); return; }
        const e = 1 - Math.pow(1 - k, 3);
        anim = new Map();
        start.forEach((a, key) => { const b = end.get(key); anim.set(key, { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, s: a.s + (b.s - a.s) * e, o: a.o + (b.o - a.o) * e }); });
        render({ panel: false });
        animRaf = requestAnimationFrame(step);
      };
      animRaf = requestAnimationFrame(step);
    }
    const stopAnim = () => { if (anim || animRaf) { cancelAnimationFrame(animRaf); animRaf = 0; anim = null; } };

    function mix(hex, base, amt) {
      const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      if (!/^#[0-9a-f]{6}$/i.test(hex) || !/^#[0-9a-f]{6}$/i.test(base)) return base;
      const a = p(hex), b = p(base);
      return '#' + a.map((v, i) => Math.round(v * amt + b[i] * (1 - amt)).toString(16).padStart(2, '0')).join('');
    }
    function bbox() {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      [...nodes.values()].filter((n) => !isHidden(n)).forEach((n) => {
        const s = sizes.get(n.key) || measure(n);
        x1 = Math.min(x1, n.x - s.w / 2 - 14); y1 = Math.min(y1, n.y - s.h / 2);
        x2 = Math.max(x2, n.x + s.w / 2 + 14); y2 = Math.max(y2, n.y + s.h / 2);
      });
      return isFinite(x1) ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : { x: -100, y: -50, w: 200, h: 100 };
    }

    // ------------------------------------------------------------ panel
    function renderPanel() {
      const panel = $('[data-panel]');
      if (panel.classList.contains('hidden')) return;
      const n = sel && nodes.get(sel);
      if (selLink >= 0 && links[selLink]) {
        const l = links[selLink];
        panel.innerHTML = String(html`<div class="row between mb-2"><b>Connection</b><button class="btn ghost icon xs" data-a="panel">${icon('x', 'sm')}</button></div>
          <div class="field"><label>Label</label><input class="input sm" data-link-label value="${l.label || ''}" placeholder="e.g. depends on"></div>
          <p class="small muted">${nodes.get(l.source)?.label} → ${nodes.get(l.target)?.label}</p>
          <button class="btn sm danger block" data-a="delete">${icon('trash-2', 'sm')} Delete connection</button>`);
        return;
      }
      if (!n) {
        const t = T();
        const cur = PRESETS[theme.preset] ? theme.preset : 'classic';
        const seg = (k, opts) => html`<div class="seg mm-seg">${opts.map(([v, l, ic]) => html`<button type="button" class="btn xs ${t[k] === v ? 'active' : ''}" data-theme-k="${k}" data-theme-v="${v}">${ic ? icon(ic, 'sm') : ''}${l}</button>`)}</div>`;
        panel.innerHTML = String(html`<div class="row between mb-2"><b>Mind map</b><button class="btn ghost icon xs" data-a="panel">${icon('x', 'sm')}</button></div>
          ${canEdit ? html`<div class="mm-look" data-look>
          <label class="mm-h">${icon('palette', 'sm')} Theme</label>
          <div class="mm-presets">${Object.entries(PRESETS).map(([k, p]) => html`<button type="button" class="mm-preset ${cur === k ? 'active' : ''}" data-theme-preset="${k}" style="--pbg:${p.dark ? '#0b1020' : p.bg === 'gradient' ? 'linear-gradient(135deg,#eef2ff,#fdf2f8)' : 'var(--bg)'}">
            <span class="mm-pv">${(p.dark ? NEON : p.rainbow ? COLORS : ['#334155', '#334155', '#334155']).slice(0, 3).map((c, i) => html`<i style="--c:${p.pastel ? mix(c, '#ffffff', 0.45) : c};--r:${p.shape === 'pill' || i === 0 ? '9px' : p.shape === 'underline' ? '0' : '3px'}" class="${p.shape === 'underline' && i ? 'ul' : ''} ${p.root === 'glow' ? 'glow' : ''}"></i>`)}</span>
            <span class="mm-pl">${p.label}</span></button>`)}</div>
          <div class="field"><label>Branches</label>${seg('edge', [['curve', 'Curved'], ['taper', 'Tapered'], ['elbow', 'Elbow'], ['straight', 'Straight']])}</div>
          <div class="field"><label>Layout</label>${seg('layout', [['balanced', 'Both sides'], ['right', 'Right'], ['down', 'Top-down']])}</div>
          <div class="field"><label>Background</label>${seg('bg', [['plain', 'Plain'], ['dots', 'Dots'], ['gradient', 'Glow']])}</div>
          <div class="field"><label>Font</label>${seg('font', [['sans', 'Sans'], ['rounded', 'Rounded'], ['serif', 'Serif'], ['hand', 'Hand']])}</div>
          <label class="switch mm-sw"><input type="checkbox" data-theme-toggle="rainbow" ${t.rainbow ? 'checked' : ''}><span class="track"></span><span>Rainbow branches</span></label>
          <label class="switch mm-sw"><input type="checkbox" data-theme-toggle="motion" ${theme.motion !== false ? 'checked' : ''}><span class="track"></span><span>Animations</span></label>
          </div>` : ''}
          <div class="field mt-3"><label>Description</label><textarea class="textarea" rows="4" data-desc placeholder="What is this map about?">${data.description || ''}</textarea></div>
          <dl class="kv small"><dt>Nodes</dt><dd>${nodes.size}</dd><dt>Connections</dt><dd>${links.length}</dd></dl>
          <p class="small subtle mt-3">Select a topic to change its text, colour, shape, sticker, icon and notes.</p>`);
        return;
      }
      const isRoot = !n.parent || !nodes.has(n.parent);
      panel.innerHTML = String(html`<div class="row between mb-2"><b>${isRoot ? 'Central topic' : 'Topic'}</b><button class="btn ghost icon xs" data-a="panel">${icon('x', 'sm')}</button></div>
        <div class="field"><label>Text</label><textarea class="textarea" rows="2" data-label>${n.label}</textarea></div>
        <div class="field"><label>Color</label><div class="swatches" style="padding:0;grid-template-columns:repeat(6,28px)">${COLORS.map((c) => html`<button class="swatch ${n.color === c ? 'active' : ''}" data-color="${c}" style="--sw:${c}"></button>`)}
          <button class="swatch ${!n.color ? 'active' : ''}" data-color="" style="--sw:var(--bg-soft)" data-tip="Auto">${icon('slash', 'sm')}</button></div></div>
        <div class="field"><label>Shape</label><div class="seg mm-seg">${SHAPES.map(([k, l]) => html`<button type="button" class="btn xs ${(n.style?.shape || '') === k ? 'active' : ''}" data-shape="${k}">${l}</button>`)}</div></div>
        <div class="field"><label>Sticker</label><div class="mm-emojis">
          <button type="button" class="mm-emo ${!n.style?.emoji ? 'active' : ''}" data-emoji="" aria-label="No sticker">${icon('slash', 'sm')}</button>
          ${EMOJIS.map((e) => html`<button type="button" class="mm-emo ${n.style?.emoji === e ? 'active' : ''}" data-emoji="${e}">${e}</button>`)}</div>
          <input class="input sm mt-1" data-emoji-custom maxlength="8" placeholder="…or type / paste any emoji" value="${n.style?.emoji && !EMOJIS.includes(n.style.emoji) ? n.style.emoji : ''}"></div>
        <div class="field"><label>Text</label><div class="seg mm-seg">${[['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']].map(([k, l]) => html`<button type="button" class="btn xs ${(n.style?.size || 'm') === k ? 'active' : ''}" data-tsize="${k}">${l}</button>`)}
          <button type="button" class="btn xs ${n.style?.bold ? 'active' : ''}" data-bold>${icon('bold', 'sm')}</button></div></div>
        <div class="field"><label>Fill</label><div class="seg mm-seg">${[['', 'Auto'], ['solid', 'Solid'], ['soft', 'Soft'], ['none', 'Outline']].map(([k, l]) => html`<button type="button" class="btn xs ${(n.style?.fill || '') === k ? 'active' : ''}" data-fill="${k}">${l}</button>`)}</div></div>
        <div class="field"><label>Icon</label><div class="swatches" style="padding:0;grid-template-columns:repeat(6,28px)">
          <button class="swatch ${!n.icon ? 'active' : ''}" data-icon="" style="--sw:var(--bg-soft)">${icon('slash', 'sm')}</button>
          ${NODE_ICONS.map((i) => html`<button class="swatch ${n.icon === i ? 'active' : ''}" data-icon="${i}" style="--sw:var(--bg-elev)">${icon(i, 'sm')}</button>`)}</div></div>
        <div class="field"><label>Notes</label><textarea class="textarea" rows="4" data-notes placeholder="Details, links, ideas…">${n.notes || ''}</textarea></div>
        <div class="grid grid-2" style="gap:6px">
          <button class="btn sm" data-a="child">${icon('git-branch-plus', 'sm')} Child</button>
          <button class="btn sm" data-a="sibling">${icon('plus', 'sm')} Sibling</button>
          <button class="btn sm" data-a="parent">${icon('arrow-up-from-dot', 'sm')} Parent</button>
          <button class="btn sm" data-a="duplicate">${icon('copy', 'sm')} Duplicate</button>
          <button class="btn sm" data-a="collapse">${icon(n.collapsed ? 'chevrons-up-down' : 'chevrons-down-up', 'sm')} ${n.collapsed ? 'Expand' : 'Collapse'}</button>
          <button class="btn sm" data-a="edit">${icon('pencil', 'sm')} Edit</button>
        </div>
        ${!isRoot || roots().length > 1 ? html`<button class="btn sm danger block mt-2" data-a="delete">${icon('trash-2', 'sm')} Delete topic</button>` : ''}`);
    }

    // ------------------------------------------------------------ mutations
    function change(fn, { layout = false, panel = true } = {}) {
      if (!canEdit) return;
      const prev = positions();
      stopAnim();
      pushHistory();
      fn();
      if (layout) autoLayout();
      render({ panel });
      markDirty();
      animateFrom(prev);
    }
    /** Topic look: shape, sticker, size, bold, fill (empty values fall back to the theme). */
    function setStyle(k, patch) {
      change(() => {
        const n = nodes.get(k);
        const st = { ...(n.style || {}), ...patch };
        Object.keys(st).forEach((x) => { if (st[x] === '' || st[x] == null || st[x] === false || (x === 'size' && st[x] === 'm')) delete st[x]; });
        n.style = Object.keys(st).length ? st : null;
      }, { layout: true });
    }
    function setTheme(patch) {
      change(() => {
        theme = patch.preset ? { preset: patch.preset, layout: theme.layout, motion: theme.motion } : { ...theme, ...patch };
        Object.keys(theme).forEach((x) => theme[x] === undefined && delete theme[x]);
      }, { layout: true });
      if ('layout' in patch) requestAnimationFrame(() => stage.fit(bbox(), 80, 1));
    }
    function addChild(parentKey) {
      const p = nodes.get(parentKey);
      if (!p) return;
      const key = uid('n');
      change(() => {
        if (p.collapsed) p.collapsed = false;
        const kids = children(parentKey);
        nodes.set(key, { key, parent: parentKey, label: 'New topic', x: p.x + 200, y: p.y, color: null, icon: null, notes: '', collapsed: false, order: kids.length ? Math.max(...kids.map((k) => k.order)) + 1 : 0 });
      }, { layout: true });
      select(key);
      setTimeout(() => editLabel(key, true), 30);
    }
    function addSibling(k) {
      const n = nodes.get(k);
      if (!n) return;
      if (!n.parent || !nodes.has(n.parent)) return addChild(k);
      const key = uid('n');
      change(() => {
        children(n.parent).forEach((s) => { if (s.order > n.order) s.order += 1; });
        nodes.set(key, { key, parent: n.parent, label: 'New topic', x: n.x, y: n.y + 50, color: null, icon: null, notes: '', collapsed: false, order: n.order + 1 });
      }, { layout: true });
      select(key);
      setTimeout(() => editLabel(key, true), 30);
    }
    function addParent(k) {
      const n = nodes.get(k);
      if (!n) return;
      const key = uid('n');
      change(() => {
        nodes.set(key, { key, parent: n.parent && nodes.has(n.parent) ? n.parent : null, label: 'New topic', x: n.x, y: n.y, color: null, icon: null, notes: '', collapsed: false, order: n.order });
        n.parent = key;
        n.order = 0;
      }, { layout: true });
      select(key);
      setTimeout(() => editLabel(key, true), 30);
    }
    function removeNode(k) {
      const n = nodes.get(k);
      if (!n) return;
      if ((!n.parent || !nodes.has(n.parent)) && roots().length <= 1) return toast('The central topic cannot be deleted.', 'warning');
      const gone = descendants(k);
      gone.add(k);
      change(() => {
        gone.forEach((g) => nodes.delete(g));
        links = links.filter((l) => !gone.has(l.source) && !gone.has(l.target));
      });
      select(n.parent && nodes.has(n.parent) ? n.parent : null);
    }
    function duplicate(k) {
      const n = nodes.get(k);
      if (!n || !n.parent) return toast('Select a topic (not the central topic) to duplicate.', 'warning');
      change(() => {
        const map = new Map();
        const copy = (src, parent, dy) => {
          const nk = uid('n');
          map.set(src.key, nk);
          nodes.set(nk, { ...src, key: nk, parent, y: src.y + dy, order: src.order + (parent === n.parent ? 0.5 : 0) });
          children(src.key).forEach((c) => copy(c, nk, dy));
        };
        copy(n, n.parent, 60);
        children(n.parent).forEach((c, i) => (c.order = i));
      }, { layout: true });
    }
    function reparent(k, newParent) {
      if (k === newParent || descendants(k).has(newParent)) return;
      change(() => {
        const n = nodes.get(k);
        n.parent = newParent;
        const kids = children(newParent).filter((c) => c.key !== k);
        n.order = kids.length ? Math.max(...kids.map((c) => c.order)) + 1 : 0;
        nodes.get(newParent).collapsed = false;
      }, { layout: true });
    }
    function select(k) {
      sel = k;
      selLink = -1;
      render();
    }

    // ------------------------------------------------------------ label editing
    let editor = null;
    function editLabel(k, isNew = false) {
      if (!canEdit) return;
      const n = nodes.get(k);
      if (!n) return;
      editor?.commit();
      const node = gNodes.querySelector(`[data-key="${CSS.escape(k)}"] .body`);
      if (!node) return;
      // Phones: bring the shape into the upper part of the screen first, so the keyboard does not cover the text box.
      if (matchMedia('(pointer: coarse)').matches) {
        const rr = node.getBoundingClientRect();
        if (rr.bottom > window.innerHeight * 0.42) { stage.vp.y -= rr.top - window.innerHeight * 0.2; stage.apply(); }
      }
      const r = node.getBoundingClientRect();
      const sr = stageEl.getBoundingClientRect();
      const ta = h(`<textarea class="node-editor" rows="1"></textarea>`);
      ta.value = n.label;
      const s = sizes.get(k);
      Object.assign(ta.style, {
        left: r.left - sr.left - 4 + 'px', top: r.top - sr.top - 4 + 'px', width: Math.max(140, r.width + 8) + 'px', minHeight: r.height + 8 + 'px',
        fontSize: s.size * stage.vp.zoom + 'px', fontWeight: s.weight, fontFamily: T().family,
      });
      stageEl.appendChild(ta);
      ta.focus();
      ta.select();
      let done = false;
      // `to`: where the focus is going. Clicking a field in the side panel must not rebuild the panel
      // (that would throw away the field just clicked) nor pull the focus back to the canvas.
      const commit = (save = true, to = null) => {
        if (done) return;
        done = true;
        const v = ta.value.trim();
        const intoPanel = !!to?.closest?.('[data-panel]');
        ta.remove();
        editor = null;
        if (save && v && v !== n.label) change(() => (n.label = v.slice(0, 500)), { layout: true, panel: !intoPanel });
        else if (isNew && !save) removeNode(k);
        if (intoPanel) { const f = $('[data-panel] [data-label]'); if (f && f.value !== n.label) f.value = n.label; }
        else stage.svg.focus({ preventScroll: true });
      };
      ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); commit(false); }
        if (e.key === 'Tab') { e.preventDefault(); commit(); addChild(k); }
      });
      ta.addEventListener('blur', (e) => commit(true, e.relatedTarget));
      editor = { commit };
    }

    // ------------------------------------------------------------ pointer interaction
    let drag = null;
    stage.setPanFilter(() => true);
    stage.cancelInteraction = () => { drag = null; };
    stage.onBackgroundClick = () => { if (connectFrom) { connectFrom = null; setHint(); } select(null); };
    gNodes.addEventListener('pointerdown', (e) => {
      if (stage.isPinching()) return;
      const tog = e.target.closest('[data-toggle]');
      if (tog) {
        e.stopPropagation();
        const n = nodes.get(tog.dataset.toggle);
        change(() => (n.collapsed = !n.collapsed), { layout: false });
        return;
      }
      const g = e.target.closest('.mm-node');
      if (!g) return;
      e.stopPropagation();
      const k = g.dataset.key;
      if (connectFrom) {
        if (connectFrom !== k && !links.some((l) => l.source === connectFrom && l.target === k)) {
          const from = connectFrom;
          change(() => links.push({ source: from, target: k, label: '' }));
          toast('Nodes connected', 'success', { timeout: 1500 });
        }
        connectFrom = null;
        setHint();
        render();
        return;
      }
      const w = stage.toWorld(e.clientX, e.clientY);
      const sub = descendants(k);
      sub.add(k);
      const orig = new Map([...sub].map((s) => [s, { x: nodes.get(s).x, y: nodes.get(s).y }]));
      drag = { k, sx: w.x, sy: w.y, orig, moved: false, wasSelected: sel === k, pointerId: e.pointerId, target: null };
      stage.svg.setPointerCapture(e.pointerId);
    });
    stage.svg.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const w = stage.toWorld(e.clientX, e.clientY);
      const dx = w.x - drag.sx, dy = w.y - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) * stage.vp.zoom < 4) return;
      if (!drag.moved) { stopAnim(); pushHistory(); drag.moved = true; }
      drag.orig.forEach((p, k) => { const n = nodes.get(k); n.x = p.x + dx; n.y = p.y + dy; });
      // drop target detection
      drag.target = null;
      for (const n of nodes.values()) {
        if (drag.orig.has(n.key) || isHidden(n)) continue;
        const s = sizes.get(n.key);
        if (s && Math.abs(w.x - n.x) < s.w / 2 && Math.abs(w.y - n.y) < s.h / 2) { drag.target = n.key; break; }
      }
      render();
      if (drag.target) gNodes.querySelector(`[data-key="${CSS.escape(drag.target)}"] .body`)?.setAttribute('stroke-width', 4);
    });
    stage.svg.addEventListener('pointerup', (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const d = drag;
      drag = null;
      if (d.moved) {
        if (d.target && d.target !== nodes.get(d.k).parent) {
          undoStack.pop(); // reparent records its own history entry
          d.orig.forEach((p, k) => { const n = nodes.get(k); n.x = p.x; n.y = p.y; });
          reparent(d.k, d.target);
          toast('Topic moved', 'success', { timeout: 1200 });
        } else { render(); markDirty(); }
        return;
      }
      if (d.wasSelected) editLabel(d.k);
      else select(d.k);
    });
    gNodes.addEventListener('dblclick', (e) => {
      const g = e.target.closest('.mm-node');
      if (g) editLabel(g.dataset.key);
    });
    gLinks.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('[data-link]');
      if (!g) return;
      e.stopPropagation();
      sel = null;
      selLink = +g.dataset.link;
      if ($('[data-panel]').classList.contains('hidden') && !mobile) $('[data-panel]').classList.remove('hidden');
      render();
    });

    // ------------------------------------------------------------ keyboard
    const onKey = (e) => {
      if (e.target.closest('input, textarea, [contenteditable="true"]') || document.querySelector('.modal-root')) return;
      if (!canEdit && e.key !== ' ' && e.key !== 'Escape') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
      if (e.key === ' ' && !sel) { stage.spaceDown = true; return; }
      if (e.key === 'Escape') { connectFrom = null; setHint(); return select(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selLink >= 0) { e.preventDefault(); const i = selLink; selLink = -1; return change(() => links.splice(i, 1)); }
      if (!sel) return;
      const n = nodes.get(sel);
      if (e.key === 'Tab') { e.preventDefault(); addChild(sel); }
      else if (e.key === 'Enter') { e.preventDefault(); addSibling(sel); }
      else if (e.key === 'F2') { e.preventDefault(); editLabel(sel); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeNode(sel); }
      else if (e.key === ' ') { e.preventDefault(); if (children(sel).length) change(() => (n.collapsed = !n.collapsed)); }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(sel); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const kids = children(sel).filter((c) => (e.key === 'ArrowRight' ? c.x > n.x : c.x < n.x));
        if (kids.length) select(kids[0].key);
        else if (n.parent && nodes.has(n.parent)) { const p = nodes.get(n.parent); if ((e.key === 'ArrowLeft') === (p.x < n.x)) select(p.key); }
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const sibs = n.parent ? children(n.parent).filter((s) => (s.x >= nodes.get(n.parent).x) === (n.x >= nodes.get(n.parent).x)) : [];
        const i = sibs.indexOf(n) + (e.key === 'ArrowDown' ? 1 : -1);
        if (sibs[i]) select(sibs[i].key);
      } else if (e.key.length === 1 && !mod && /\S/.test(e.key)) {
        editLabel(sel);
      }
    };
    const onKeyUp = (e) => { if (e.key === ' ') stage.spaceDown = false; };
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKeyUp);

    function undo() { if (!undoStack.length) return; const prev = positions(); stopAnim(); redoStack.push(snapshot()); restoreSnap(undoStack.pop()); if (sel && !nodes.has(sel)) sel = null; render(); markDirty(); animateFrom(prev); }
    function redo() { if (!redoStack.length) return; const prev = positions(); stopAnim(); undoStack.push(snapshot()); restoreSnap(redoStack.pop()); if (sel && !nodes.has(sel)) sel = null; render(); markDirty(); animateFrom(prev); }
    function setHint() {
      $('[data-hint]').textContent = connectFrom ? 'Click another topic to connect it — Esc to cancel' : 'Tab: child · Enter: sibling · F2/double-click: edit · Space: collapse · Del: delete · Drag a node onto another to re-parent';
      $('[data-a="connect"]').classList.toggle('active', !!connectFrom);
    }

    // ------------------------------------------------------------ toolbar & panel events
    el.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      const colorBtn = e.target.closest('[data-color]');
      const iconBtn = e.target.closest('[data-icon]');
      if (colorBtn && sel) return change(() => (nodes.get(sel).color = colorBtn.dataset.color || null));
      const st = e.target.closest('[data-shape],[data-emoji],[data-tsize],[data-bold],[data-fill]');
      if (st && sel) {
        const n = nodes.get(sel);
        if ('shape' in st.dataset) return setStyle(sel, { shape: st.dataset.shape });
        if ('emoji' in st.dataset) return setStyle(sel, { emoji: st.dataset.emoji });
        if ('tsize' in st.dataset) return setStyle(sel, { size: st.dataset.tsize });
        if ('bold' in st.dataset) return setStyle(sel, { bold: !n.style?.bold });
        if ('fill' in st.dataset) return setStyle(sel, { fill: st.dataset.fill });
      }
      const pre = e.target.closest('[data-theme-preset]');
      if (pre) return setTheme({ preset: pre.dataset.themePreset });
      const tk = e.target.closest('[data-theme-k]');
      if (tk) return setTheme({ [tk.dataset.themeK]: tk.dataset.themeV });
      if (iconBtn && sel) return change(() => (nodes.get(sel).icon = iconBtn.dataset.icon || null), { layout: true });
      if (!a) return;
      const target = sel || roots()[0]?.key;
      switch (a) {
        case 'share': {
          const n = await openItemShare({ type: 'mindmap', id, title: $('[data-title]').value });
          if (n !== null) { shareCount = n; const b = e.target.closest('[data-a]'); b.classList.toggle('active', n > 0); b.querySelector('[data-share-count]').textContent = n || ''; }
          break;
        }
        case 'copy': { const r = await api.post(`mindmaps/${id}/duplicate`).catch(toastError); if (r) { toast('Copied to your account — you can edit the copy', 'success'); navigate(`/mindmaps/${r.id}`); } break; }
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'child': addChild(target); break;
        case 'sibling': addSibling(target); break;
        case 'parent': addParent(target); break;
        case 'duplicate': duplicate(sel); break;
        case 'delete': if (selLink >= 0) { const i = selLink; selLink = -1; change(() => links.splice(i, 1)); } else if (sel) removeNode(sel); break;
        case 'edit': if (sel) editLabel(sel); break;
        case 'collapse': if (sel) change(() => (nodes.get(sel).collapsed = !nodes.get(sel).collapsed), { layout: true }); break;
        case 'connect':
          if (connectFrom) { connectFrom = null; } else if (!sel) { toast('Select the first topic, then click Connect.', 'info'); } else { connectFrom = sel; }
          setHint(); render(); break;
        case 'layout': change(() => {}, { layout: true }); stage.fit(bbox()); break;
        case 'zoom-in': stage.zoomAt(1.2); break;
        case 'zoom-out': stage.zoomAt(1 / 1.2); break;
        case 'fit': stage.fit(bbox()); break;
        case 'panel': $('[data-panel]').classList.toggle('hidden'); renderPanel(); break;
        case 'play':
          if (nodes.size < 2) { toast('Add a few topics first — ideas flow along the branches.', 'info'); break; }
          player.toggle();
          break;
        case 'style': {
          sel = null; selLink = -1;
          const p = $('[data-panel]');
          p.classList.remove('hidden');
          render();
          p.querySelector('[data-look]')?.scrollIntoView({ block: 'start' });
          break;
        }
        case 'export': {
          const name = safeName($('[data-title]').value);
          const bg = look().bg;
          menu(e.target.closest('[data-a]'), [
            { label: 'Export as PNG', icon: 'image', onClick: () => exportPng(stage, bbox(), bg, name).catch(toastError) },
            { label: 'Export as SVG', icon: 'file-code', onClick: () => exportSvg(stage, bbox(), bg, name) },
            { label: 'Export as PDF', icon: 'file-text', onClick: () => exportPdf(stage, bbox(), bg, name).then(() => toast('PDF exported', 'success')).catch(toastError) },
            { label: 'Export animated video (MP4)', icon: 'film', onClick: async () => {
              const keep = sel; sel = null; selLink = -1; render();
              try { const r = await exportFlowVideo({ stage, bbox: bbox(), background: bg, getFlows: flowList, name }); if (r) toast(r.ext === 'mp4' ? `Video saved (${Math.round(r.seconds)} s, ${r.width}×${r.height})` : 'This browser can only record WebM — saved as .webm', r.ext === 'mp4' ? 'success' : 'warning'); } catch (err) { toastError(err); }
              sel = keep; render();
            } },
            { divider: true },
            { label: isOwner ? 'Duplicate mind map' : 'Make a copy', icon: 'copy', onClick: async () => { await save(); const r = await api.post(`mindmaps/${id}/duplicate`).catch(toastError); if (r) navigate(`/mindmaps/${r.id}`); } },
            isOwner && { label: 'Move to trash', icon: 'trash-2', danger: true, onClick: async () => { if (await confirm({ title: 'Delete mind map?', message: 'It will be moved to the trash.', confirmText: 'Delete' })) { await api.post(`items/mindmap/${id}/trash`).catch(toastError); ctx.beforeLeave = null; navigate('/mindmaps'); } } },
          ], { align: 'end' });
          break;
        }
      }
    });
    el.addEventListener('input', (e) => {
      if (e.target.matches('[data-label]') && sel) { nodes.get(sel).label = e.target.value.slice(0, 500); render({ panel: false }); markDirty(); }
      if (e.target.matches('[data-notes]') && sel) { nodes.get(sel).notes = e.target.value; markDirty(); }
      if (e.target.matches('[data-desc]')) { data.description = e.target.value; markDirty(); }
      if (e.target.matches('[data-link-label]') && selLink >= 0) { links[selLink].label = e.target.value.slice(0, 255); render({ panel: false }); markDirty(); }
      if (e.target.matches('[data-title]')) { ctx.setTitle(e.target.value); markDirty(); }
    });
    el.addEventListener('change', (e) => {
      if (e.target.matches('[data-theme-toggle]')) setTheme({ [e.target.dataset.themeToggle]: e.target.checked });
      if (e.target.matches('[data-emoji-custom]') && sel) setStyle(sel, { emoji: [...e.target.value.trim()].slice(0, 4).join('') });
    });
    el.addEventListener('focusin', (e) => { if (e.target.matches('[data-label],[data-notes],[data-link-label]')) pushHistory(); });

    // ------------------------------------------------------------ persistence
    const saveEl = $('[data-save]');
    const setSave = (cls, t) => { saveEl.className = 'save-state ' + cls; $('[data-save-text]').textContent = t; };
    // Only the owner's zoom/position is remembered; collaborators keep their own view.
    function markViewport() { if (isOwner) vpDirty = true; }
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
        const ordered = [];
        const walk = (list) => list.forEach((n, i) => { n.order = i; ordered.push(n); walk(children(n.key)); });
        walk(roots());
        nodes.forEach((n) => { if (!ordered.includes(n)) ordered.push(n); });
        const r = await api.post(`mindmaps/${id}`, {
          base_revision: revision,
          title: $('[data-title]').value.trim() || 'Untitled mind map',
          description: data.description || '',
          viewport: { ...stage.vp },
          theme,
          nodes: ordered.map((n) => ({ key: n.key, parent: n.parent && nodes.has(n.parent) ? n.parent : null, label: n.label, x: Math.round(n.x * 100) / 100, y: Math.round(n.y * 100) / 100, w: sizes.get(n.key)?.w, h: sizes.get(n.key)?.h, color: n.color, icon: n.icon, style: n.style || null, notes: n.notes, collapsed: !!n.collapsed, order: n.order })),
          edges: links.map((l) => ({ source: l.source, target: l.target, type: 'link', label: l.label })),
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
        } else {
          setSave('error', 'Not saved');
          toastError(err);
        }
      } finally { saving = false; }
    }
    shell.saveHandler = async () => { dirty = true; await save(); toast('Mind map saved', 'success', { timeout: 1500 }); };
    ctx.beforeLeave = async () => { editor?.commit(); if (dirty || vpDirty) await save(); return true; };

    // ------------------------------------------------------------ init
    const needsLayout = [...nodes.values()].filter((n) => n.parent).every((n) => !n.x && !n.y);
    [...nodes.values()].forEach(measure);
    if (needsLayout) autoLayout();
    player = createFlowPlayer({ stage, getFlows: flowList, onState: (on) => {
      const b = $('[data-a="play"]');
      b.classList.toggle('active', on);
      b.innerHTML = String(html`${icon(on ? 'pause' : 'play', 'sm')}<span class="hide-sm">${on ? 'Stop' : 'Play'}</span>`);
    } });
    render();
    // Opening a map: the branches grow out of the central topic.
    if (nodes.size > 1 && nodes.size <= 120) { const intro = new Map(); roots().forEach((r) => intro.set(r.key, { x: r.x, y: r.y, vis: true })); animateFrom(intro); }
    requestAnimationFrame(() => {
      if (data.viewport && data.viewport.zoom) stage.setViewport(data.viewport);
      else stage.fit(bbox(), 80, 1);
      vpDirty = false;
      const r = roots()[0];
      if (r && nodes.size === 1) { select(r.key); }
    });
    stage.svg.focus({ preventScroll: true });
    void esc; void prompt;
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKeyUp);
      cancelAnimationFrame(animRaf);
      player.destroy();
      autosave.cancel();
      stage.destroy();
      shell.saveHandler = null;
    };
  },
};
