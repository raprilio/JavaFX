// Interactive mind map editor (SVG). Data is stored relationally in MySQL (mindmap_nodes / mindmap_edges).
import { html, icon, uid, debounce, h, esc } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { api } from '../core/api.js';
import { navigate } from '../core/router.js';
import { shell } from '../core/shell.js';
import { toast, toastError, menu, confirm, prompt } from '../core/ui.js';
import { createStage, svgEl, wrapText, textBlock, themeColors, exportPng, exportSvg, exportPdf, safeName } from '../components/canvas.js';

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b'];
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
    /** @type {Map<string, any>} */
    const nodes = new Map();
    data.nodes.forEach((n, i) => nodes.set(n.key, { ...n, order: n.order ?? i }));
    let links = data.edges.filter((e) => e.type === 'link').map((e) => ({ source: e.source, target: e.target, label: e.label || '' }));
    let sel = null, selLink = -1, connectFrom = null, dirty = false, saving = false;
    let vpDirty = false;
    const undoStack = [], redoStack = [];
    const sizes = new Map();
    const mobile = matchMedia('(max-width: 767px)').matches;

    el.innerHTML = String(html`<div class="canvas-page">
      <div class="canvas-bar">
        <a class="btn ghost icon sm" href="#/mindmaps" data-tip="Back">${icon('arrow-left')}</a>
        <input class="title-input" value="${data.title}" data-title maxlength="255" aria-label="Title">
        <span class="save-state" data-save><span class="d"></span><span data-save-text>Saved</span></span>
        <div class="grow"></div>
        <button class="btn ghost icon sm" data-a="undo" data-tip="Undo (Ctrl+Z)">${icon('undo-2', 'sm')}</button>
        <button class="btn ghost icon sm" data-a="redo" data-tip="Redo (Ctrl+Y)">${icon('redo-2', 'sm')}</button>
        <span class="divider-v"></span>
        <button class="btn ghost sm" data-a="child" data-tip="Add child (Tab)">${icon('git-branch-plus', 'sm')}<span class="hide-sm">Child</span></button>
        <button class="btn ghost sm" data-a="sibling" data-tip="Add sibling (Enter)">${icon('plus', 'sm')}<span class="hide-sm">Sibling</span></button>
        <button class="btn ghost icon sm" data-a="parent" data-tip="Add parent">${icon('arrow-up-from-dot', 'sm')}</button>
        <button class="btn ghost icon sm" data-a="connect" data-tip="Connect two nodes">${icon('spline', 'sm')}</button>
        <button class="btn ghost icon sm" data-a="layout" data-tip="Auto layout">${icon('wand-sparkles', 'sm')}</button>
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
    const branchColor = (n) => {
      if (n.color) return n.color;
      let c = n;
      for (let guard = 0; guard < 100; guard++) {
        const p = c.parent && nodes.get(c.parent);
        if (!p) return themeColors().accent;
        if (!p.parent || !nodes.has(p.parent)) return c.color || COLORS[Math.max(0, children(p.key).indexOf(c)) % COLORS.length];
        c = p;
        if (c.color) return c.color;
      }
      return themeColors().accent;
    };
    const snapshot = () => JSON.stringify({ nodes: [...nodes.values()], links });
    const pushHistory = () => { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; };
    const restoreSnap = (s) => { const d = JSON.parse(s); nodes.clear(); d.nodes.forEach((n) => nodes.set(n.key, n)); links = d.links; };

    function measure(n) {
      const d = depth(n);
      const isRoot = d === 0;
      const size = isRoot ? 18 : d === 1 ? 15 : 14;
      const weight = isRoot ? 700 : d === 1 ? 620 : 520;
      const t = wrapText(n.label || ' ', { size, weight, maxWidth: isRoot ? 260 : 220 });
      const padX = isRoot ? 22 : 14, padY = isRoot ? 14 : 9;
      const iconW = n.icon ? 22 : 0;
      const s = { w: Math.ceil(t.width + padX * 2 + iconW), h: Math.ceil(t.lines.length * t.lineHeight + padY * 2), t, size, weight, padX, iconW, depth: d };
      sizes.set(n.key, s);
      return s;
    }

    // ------------------------------------------------------------ layout
    function autoLayout() {
      [...nodes.values()].forEach(measure);
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
        if (ri > 0) { kids.forEach((c) => calcH(c.key)); }
        const rx = r.x ?? 0, ry = r.y ?? 0;
        const right = ri === 0 ? kids.slice(0, Math.ceil(kids.length / 2)) : kids;
        const left = ri === 0 ? kids.slice(Math.ceil(kids.length / 2)) : [];
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

    // ------------------------------------------------------------ render
    function edgePath(p, c, ps, cs) {
      const right = c.x >= p.x;
      const x1 = p.x + (right ? ps.w / 2 : -ps.w / 2), y1 = p.y;
      const x2 = c.x + (right ? -cs.w / 2 : cs.w / 2), y2 = c.y;
      const mx = (x1 + x2) / 2;
      return `M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
    }
    function render() {
      kidsCache = buildKids();
      try { renderInner(); } finally { kidsCache = null; }
    }
    function renderInner() {
      const th = themeColors();
      markerPath.setAttribute('fill', th.text2);
      [...nodes.values()].forEach(measure);
      gEdges.innerHTML = '';
      gLinks.innerHTML = '';
      gNodes.innerHTML = '';
      const visible = [...nodes.values()].filter((n) => !isHidden(n));
      // tree edges
      visible.forEach((n) => {
        if (!n.parent || !nodes.has(n.parent)) return;
        const p = nodes.get(n.parent);
        const d = sizes.get(n.key).depth;
        gEdges.appendChild(svgEl('path', { d: edgePath(p, n, sizes.get(p.key), sizes.get(n.key)), fill: 'none', stroke: branchColor(n), 'stroke-width': d === 1 ? 3 : 2, 'stroke-linecap': 'round', opacity: 0.85 }));
      });
      // free links
      links.forEach((l, i) => {
        const a = nodes.get(l.source), b = nodes.get(l.target);
        if (!a || !b || isHidden(a) || isHidden(b)) return;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - Math.min(120, Math.abs(a.x - b.x) * 0.25 + 40);
        const d = `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`;
        const g = svgEl('g', { 'data-link': i });
        g.appendChild(svgEl('path', { d, class: 'edge-path' + (selLink === i ? ' selected' : ''), fill: 'none', stroke: th.text2, 'stroke-width': 1.8, 'stroke-dasharray': '6 5', 'marker-end': 'url(#mm-arrow)' }));
        g.appendChild(svgEl('path', { d, class: 'edge-hit' }));
        if (l.label) {
          const t = wrapText(l.label, { size: 12, weight: 500, maxWidth: 160 });
          const lx = (a.x + 2 * mx + b.x) / 4, ly = (a.y + 2 * my + b.y) / 4;
          g.appendChild(svgEl('rect', { x: lx - t.width / 2 - 6, y: ly - (t.lines.length * t.lineHeight) / 2 - 3, width: t.width + 12, height: t.lines.length * t.lineHeight + 6, rx: 6, fill: th.elev, stroke: th.border }));
          textBlock(g, t.lines, { cx: lx, cy: ly, size: 12, weight: 500, color: th.text2, lineHeight: t.lineHeight });
        }
        gLinks.appendChild(g);
      });
      // nodes
      visible.forEach((n) => {
        const s = sizes.get(n.key);
        const color = branchColor(n);
        const isRoot = s.depth === 0;
        const g = svgEl('g', { class: 'mm-node', 'data-key': n.key, transform: `translate(${n.x - s.w / 2} ${n.y - s.h / 2})` });
        const fill = isRoot ? color : s.depth === 1 ? mix(color, th.elev, th.dark ? 0.28 : 0.16) : th.elev;
        g.appendChild(svgEl('rect', { class: 'body', width: s.w, height: s.h, rx: isRoot ? s.h / 2 : 11, fill, stroke: isRoot ? 'none' : color, 'stroke-width': s.depth === 1 ? 2 : 1.5 }));
        const textColor = isRoot ? '#ffffff' : th.text;
        if (n.icon && ICONS[n.icon]) {
          const ig = svgEl('g', { transform: `translate(${s.padX - 2} ${s.h / 2 - 9}) scale(0.75)`, fill: 'none', stroke: isRoot ? '#fff' : color, 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
          ig.innerHTML = ICONS[n.icon];
          g.appendChild(ig);
        }
        textBlock(g, s.t.lines, { cx: (s.w + s.iconW) / 2, cy: s.h / 2, size: s.size, weight: s.weight, color: textColor, lineHeight: s.t.lineHeight });
        if (n.notes) {
          const nd = svgEl('circle', { cx: s.w - 6, cy: 6, r: 4.5, fill: '#f59e0b', stroke: th.elev, 'stroke-width': 1.5 });
          const tt = svgEl('title'); tt.textContent = n.notes; nd.appendChild(tt);
          g.appendChild(nd);
        }
        const kids = children(n.key);
        if (kids.length) {
          const right = !n.parent || !nodes.has(n.parent) ? true : n.x >= nodes.get(n.parent).x;
          const tx = right ? s.w + 10 : -10;
          const tg = svgEl('g', { class: 'mm-toggle mm-toggle-ui', 'data-toggle': n.key, transform: `translate(${tx} ${s.h / 2})`, style: 'cursor:pointer' });
          tg.appendChild(svgEl('circle', { r: 9, fill: th.elev, stroke: color, 'stroke-width': 1.5 }));
          const tx2 = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': n.collapsed ? 10 : 13, 'font-weight': 700, fill: color, 'font-family': 'sans-serif' });
          tx2.textContent = n.collapsed ? String(descendants(n.key).size) : '−';
          tg.appendChild(tx2);
          g.appendChild(tg);
        }
        if (sel === n.key) g.appendChild(svgEl('rect', { class: 'sel-ring', x: -5, y: -5, width: s.w + 10, height: s.h + 10, rx: isRoot ? (s.h + 10) / 2 : 14 }));
        if (connectFrom === n.key) g.appendChild(svgEl('rect', { class: 'sel-ring', x: -8, y: -8, width: s.w + 16, height: s.h + 16, rx: 16, style: 'stroke:#f59e0b' }));
        gNodes.appendChild(g);
      });
      renderPanel();
      $('[data-a="undo"]').disabled = !undoStack.length;
      $('[data-a="redo"]').disabled = !redoStack.length;
    }
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
        panel.innerHTML = String(html`<div class="row between mb-2"><b>Mind map</b><button class="btn ghost icon xs" data-a="panel">${icon('x', 'sm')}</button></div>
          <div class="field"><label>Description</label><textarea class="textarea" rows="4" data-desc placeholder="What is this map about?">${data.description || ''}</textarea></div>
          <dl class="kv small"><dt>Nodes</dt><dd>${nodes.size}</dd><dt>Connections</dt><dd>${links.length}</dd></dl>
          <p class="small subtle mt-3">Select a node to edit its text, colour, icon and notes.</p>`);
        return;
      }
      const isRoot = !n.parent || !nodes.has(n.parent);
      panel.innerHTML = String(html`<div class="row between mb-2"><b>${isRoot ? 'Central topic' : 'Topic'}</b><button class="btn ghost icon xs" data-a="panel">${icon('x', 'sm')}</button></div>
        <div class="field"><label>Text</label><textarea class="textarea" rows="2" data-label>${n.label}</textarea></div>
        <div class="field"><label>Color</label><div class="swatches" style="padding:0;grid-template-columns:repeat(6,28px)">${COLORS.map((c) => html`<button class="swatch ${n.color === c ? 'active' : ''}" data-color="${c}" style="--sw:${c}"></button>`)}
          <button class="swatch ${!n.color ? 'active' : ''}" data-color="" style="--sw:var(--bg-soft)" data-tip="Auto">${icon('slash', 'sm')}</button></div></div>
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
    function change(fn, { layout = false } = {}) {
      pushHistory();
      fn();
      if (layout) autoLayout();
      render();
      markDirty();
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
      const n = nodes.get(k);
      if (!n) return;
      editor?.commit();
      const node = gNodes.querySelector(`[data-key="${CSS.escape(k)}"] .body`);
      if (!node) return;
      const r = node.getBoundingClientRect();
      const sr = stageEl.getBoundingClientRect();
      const ta = h(`<textarea class="node-editor" rows="1"></textarea>`);
      ta.value = n.label;
      const s = sizes.get(k);
      Object.assign(ta.style, {
        left: r.left - sr.left - 4 + 'px', top: r.top - sr.top - 4 + 'px', width: Math.max(140, r.width + 8) + 'px', minHeight: r.height + 8 + 'px',
        fontSize: s.size * stage.vp.zoom + 'px', fontWeight: s.weight,
      });
      stageEl.appendChild(ta);
      ta.focus();
      ta.select();
      let done = false;
      const commit = (save = true) => {
        if (done) return;
        done = true;
        const v = ta.value.trim();
        ta.remove();
        editor = null;
        if (save && v && v !== n.label) change(() => (n.label = v.slice(0, 500)), { layout: true });
        else if (isNew && !save) removeNode(k);
        stage.svg.focus({ preventScroll: true });
      };
      ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); commit(false); }
        if (e.key === 'Tab') { e.preventDefault(); commit(); addChild(k); }
      });
      ta.addEventListener('blur', () => commit());
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
      if (!drag.moved) { pushHistory(); drag.moved = true; }
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

    function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restoreSnap(undoStack.pop()); if (sel && !nodes.has(sel)) sel = null; render(); markDirty(); }
    function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restoreSnap(redoStack.pop()); render(); markDirty(); }
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
      if (iconBtn && sel) return change(() => (nodes.get(sel).icon = iconBtn.dataset.icon || null), { layout: true });
      if (!a) return;
      const target = sel || roots()[0]?.key;
      switch (a) {
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
        case 'export': {
          const name = safeName($('[data-title]').value);
          const bg = themeColors().bg;
          menu(e.target.closest('[data-a]'), [
            { label: 'Export as PNG', icon: 'image', onClick: () => exportPng(stage, bbox(), bg, name).catch(toastError) },
            { label: 'Export as SVG', icon: 'file-code', onClick: () => exportSvg(stage, bbox(), bg, name) },
            { label: 'Export as PDF', icon: 'file-text', onClick: () => exportPdf(stage, bbox(), bg, name).then(() => toast('PDF exported', 'success')).catch(toastError) },
            { divider: true },
            { label: 'Duplicate mind map', icon: 'copy', onClick: async () => { await save(); const r = await api.post(`mindmaps/${id}/duplicate`).catch(toastError); if (r) navigate(`/mindmaps/${r.id}`); } },
            { label: 'Move to trash', icon: 'trash-2', danger: true, onClick: async () => { if (await confirm({ title: 'Delete mind map?', message: 'It will be moved to the trash.', confirmText: 'Delete' })) { await api.post(`items/mindmap/${id}/trash`).catch(toastError); ctx.beforeLeave = null; navigate('/mindmaps'); } } },
          ], { align: 'end' });
          break;
        }
      }
    });
    el.addEventListener('input', (e) => {
      if (e.target.matches('[data-label]') && sel) { nodes.get(sel).label = e.target.value.slice(0, 500); render(); markDirty(); e.target.focus(); }
      if (e.target.matches('[data-notes]') && sel) { nodes.get(sel).notes = e.target.value; markDirty(); }
      if (e.target.matches('[data-desc]')) { data.description = e.target.value; markDirty(); }
      if (e.target.matches('[data-link-label]') && selLink >= 0) { links[selLink].label = e.target.value.slice(0, 255); render(); markDirty(); }
      if (e.target.matches('[data-title]')) { ctx.setTitle(e.target.value); markDirty(); }
    });
    el.addEventListener('focusin', (e) => { if (e.target.matches('[data-label],[data-notes],[data-link-label]')) pushHistory(); });

    // ------------------------------------------------------------ persistence
    const saveEl = $('[data-save]');
    const setSave = (cls, t) => { saveEl.className = 'save-state ' + cls; $('[data-save-text]').textContent = t; };
    function markViewport() { vpDirty = true; }
    function markDirty() { dirty = true; setSave('dirty', 'Unsaved'); autosave(); }
    const autosave = debounce(() => save(), 1500);
    async function save() {
      autosave.cancel();
      if (saving) return autosave();
      if (!dirty && !vpDirty) return;
      saving = true;
      setSave('saving', 'Saving…');
      try {
        const ordered = [];
        const walk = (list) => list.forEach((n, i) => { n.order = i; ordered.push(n); walk(children(n.key)); });
        walk(roots());
        nodes.forEach((n) => { if (!ordered.includes(n)) ordered.push(n); });
        await api.post(`mindmaps/${id}`, {
          title: $('[data-title]').value.trim() || 'Untitled mind map',
          description: data.description || '',
          viewport: { ...stage.vp },
          nodes: ordered.map((n) => ({ key: n.key, parent: n.parent && nodes.has(n.parent) ? n.parent : null, label: n.label, x: Math.round(n.x * 100) / 100, y: Math.round(n.y * 100) / 100, w: sizes.get(n.key)?.w, h: sizes.get(n.key)?.h, color: n.color, icon: n.icon, notes: n.notes, collapsed: !!n.collapsed, order: n.order })),
          edges: links.map((l) => ({ source: l.source, target: l.target, type: 'link', label: l.label })),
        });
        dirty = false;
        vpDirty = false;
        setSave('', 'Saved');
      } catch (err) {
        setSave('error', 'Not saved');
        toastError(err);
      } finally { saving = false; }
    }
    shell.saveHandler = async () => { dirty = true; await save(); toast('Mind map saved', 'success', { timeout: 1500 }); };
    ctx.beforeLeave = async () => { editor?.commit(); if (dirty || vpDirty) await save(); return true; };

    // ------------------------------------------------------------ init
    const needsLayout = [...nodes.values()].filter((n) => n.parent).every((n) => !n.x && !n.y);
    [...nodes.values()].forEach(measure);
    if (needsLayout) autoLayout();
    render();
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
      autosave.cancel();
      stage.destroy();
      shell.saveHandler = null;
    };
  },
};
