// Table tools for the note editor (v1.16): a size picker to insert, a bar above the table the caret is in
// (rows, columns, merge / split, fill + text colour, header, order, widths, delete) and "+" strips on the right / bottom
// edge to grow it. v1.20: merged cells (colspan / rowspan) are understood by every operation.
// Every change goes through `mutate`, so it lands in the editor's own undo history.
import { html, icon, h } from '../core/dom.js';
import { menu, popover, toast } from '../core/ui.js';

const CELL_COLORS = ['', '#fee2e2', '#ffedd5', '#fef9c3', '#dcfce7', '#ccfbf1', '#dbeafe', '#e0e7ff', '#f3e8ff', '#fce7f3', '#f1f5f9', '#e5e7eb',
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b', '#1e293b', '#111827'];
/** 'auto' = readable on the fill (theme text, or white on dark fills). */
const TEXT_COLORS = ['auto', '#111827', '#ffffff', '#64748b', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#db2777'];
const rgbHex = (v) => {
  if (!v) return '';
  if (v[0] === '#') return v.length === 4 ? '#' + [...v.slice(1)].map((x) => x + x).join('') : v;
  const m = v.match(/\d+/g);
  return m && m.length >= 3 ? '#' + m.slice(0, 3).map((x) => (+x).toString(16).padStart(2, '0')).join('') : '';
};
const MIN_COL = 48;

/** Grid picker: hover (or drag a finger) over the squares and click to insert a table of that size. */
export function tablePicker(anchor, onPick) {
  const R = 8, C = 10;
  let header = true;
  const wrap = h(String(html`<div class="tbl-pick">
    <div class="menu-title" data-size>Insert table</div>
    <div class="tbl-grid" style="--c:${C}">${Array.from({ length: R * C }, (_, i) => html`<button type="button" class="tbl-sq" data-r="${Math.floor(i / C) + 1}" data-c="${(i % C) + 1}" aria-label="${(i % C) + 1} × ${Math.floor(i / C) + 1}"></button>`)}</div>
    <label class="tbl-hdr"><input type="checkbox" checked data-header> Header row</label></div>`));
  const p = popover(anchor, wrap);
  const paint = (r, c) => {
    wrap.querySelectorAll('.tbl-sq').forEach((s) => s.classList.toggle('on', +s.dataset.r <= r && +s.dataset.c <= c));
    wrap.querySelector('[data-size]').textContent = r && c ? `${c} columns × ${r} rows` : 'Insert table';
  };
  paint(3, 3);
  wrap.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
  const at = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.tbl-sq');
  wrap.addEventListener('pointermove', (e) => { const s = at(e); if (s) paint(+s.dataset.r, +s.dataset.c); });
  wrap.addEventListener('pointerdown', (e) => { const s = at(e); if (s && e.pointerType !== 'mouse') { try { s.releasePointerCapture(e.pointerId); } catch { /* ignore */ } } });
  wrap.addEventListener('change', (e) => { if (e.target.matches('[data-header]')) header = e.target.checked; });
  wrap.addEventListener('click', (e) => {
    const s = e.target.closest('.tbl-sq');
    if (!s) return;
    p.close();
    onPick(+s.dataset.c, +s.dataset.r, header);
  });
  return p;
}

export function tableHtml(cols, rows, header = true) {
  const cells = (tag, n, label) => Array.from({ length: n }, (_, i) => `<${tag}>${label ? label(i) : '<br>'}</${tag}>`).join('');
  let t = '<table>';
  if (header) t += `<thead><tr>${cells('th', cols, (i) => `Header ${i + 1}`)}</tr></thead>`;
  t += '<tbody>' + Array.from({ length: Math.max(1, header ? rows - 1 : rows) }, () => `<tr>${cells('td', cols)}</tr>`).join('') + '</tbody></table><p><br></p>';
  return t;
}

/**
 * @param {{editor: HTMLElement, toolbar: HTMLElement, mutate: (fn: Function) => void, placeCaret: (n: Node, end?: boolean) => void}} o
 */
export function tableTools({ editor, toolbar, mutate, placeCaret }) {
  const editable = () => editor.getAttribute('contenteditable') !== 'false' && editor.isConnected;
  const bar = h(String(html`<div class="tbl-bar" role="toolbar" aria-label="Table" hidden>
    <span class="tbl-lbl">Row</span>
    <button type="button" class="btn ghost icon xs" data-t="row-above" data-tip="Insert row above" aria-label="Insert row above">${icon('arrow-up-to-line', 'sm')}</button>
    <button type="button" class="btn ghost icon xs" data-t="row-below" data-tip="Insert row below" aria-label="Insert row below">${icon('arrow-down-to-line', 'sm')}</button>
    <button type="button" class="btn ghost icon xs danger-h" data-t="row-del" data-tip="Delete row" aria-label="Delete row">${icon('trash-2', 'sm')}</button>
    <span class="sep"></span><span class="tbl-lbl">Column</span>
    <button type="button" class="btn ghost icon xs" data-t="col-left" data-tip="Insert column left" aria-label="Insert column left">${icon('arrow-left-to-line', 'sm')}</button>
    <button type="button" class="btn ghost icon xs" data-t="col-right" data-tip="Insert column right" aria-label="Insert column right">${icon('arrow-right-to-line', 'sm')}</button>
    <button type="button" class="btn ghost icon xs danger-h" data-t="col-del" data-tip="Delete column" aria-label="Delete column">${icon('trash-2', 'sm')}</button>
    <span class="sep"></span><span class="tbl-lbl">Cell</span>
    <button type="button" class="btn ghost icon xs" data-t="merge" data-tip="Merge cells (drag across cells to pick several)" aria-label="Merge cells">${icon('table-cells-merge', 'sm')}</button>
    <button type="button" class="btn ghost icon xs" data-t="split" data-tip="Split merged cell" aria-label="Split cell">${icon('table-cells-split', 'sm')}</button>
    <button type="button" class="btn ghost icon xs" data-t="color" data-tip="Fill colour" aria-label="Fill colour">${icon('paint-bucket', 'sm')}</button>
    <button type="button" class="btn ghost icon xs" data-t="text-color" data-tip="Text colour" aria-label="Text colour">${icon('baseline', 'sm')}</button>
    <span class="sep"></span><span class="tbl-lbl">Table</span>
    <button type="button" class="btn ghost icon xs" data-t="more" data-tip="More table options" aria-label="More table options">${icon('more-horizontal', 'sm')}</button>
    <button type="button" class="btn ghost icon xs danger-h" data-t="table-del" data-tip="Delete table" aria-label="Delete table">${icon('trash-2', 'sm')}</button>
  </div>`));
  const addCol = h(`<button type="button" class="tbl-add tbl-add-col" hidden data-t="col-end" aria-label="Add column">${icon('plus', 'sm')}</button>`);
  const addRow = h(`<button type="button" class="tbl-add tbl-add-row" hidden data-t="row-end" aria-label="Add row">${icon('plus', 'sm')}</button>`);
  document.body.append(bar, addCol, addRow);

  let cell = null;   // cell with the caret
  let table = null;  // table the tools are shown for (caret or hover)
  let hover = null;

  // ------------------------------------------------------------------ model helpers
  // Merged cells (colspan / rowspan) make cellIndex differ from the column, so every operation works on a
  // logical grid: M[row][col] is the cell covering that slot (a merged cell fills every slot it covers).
  const rowsOf = (t) => Array.from(t.rows);
  function gridOf(t) {
    const rows = rowsOf(t);
    const M = rows.map(() => []);
    const pos = new Map();
    const secEnd = rows.map((tr) => rows.lastIndexOf(Array.from(tr.parentElement.rows).at(-1)));
    rows.forEach((tr, r) => {
      let c = 0;
      Array.from(tr.cells).forEach((cell) => {
        while (M[r][c]) c++;
        const room = secEnd[r] - r + 1; // a rowspan never leaves its thead / tbody
        const rs = Math.max(1, Math.min(cell.rowSpan || room, room));
        const cs = Math.max(1, cell.colSpan || 1);
        pos.set(cell, { r, c, rs, cs });
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) M[r + i][c + j] = cell;
        c += cs;
      });
    });
    return { rows, M, pos, cols: Math.max(0, ...M.map((x) => x.length)) };
  }
  const uniq = (list) => [...new Set(list.filter(Boolean))];
  const cellsIn = (g, r0, r1, c0, c1) => { const out = []; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(g.M[r]?.[c]); return uniq(out); };
  const colCount = (t) => gridOf(t).cols;
  const widthOf = (c) => parseFloat(c?.style.width) || c?.getBoundingClientRect().width || 0;
  const fixed = (t) => t.classList.contains('sn-table-fixed');
  const setSpan = (c, prop, n) => { const a = prop === 'rowSpan' ? 'rowspan' : 'colspan'; if (n > 1) c.setAttribute(a, n); else c.removeAttribute(a); };
  const cellOf = (n) => { const e = n?.nodeType === 1 ? n : n?.parentElement; const c = e?.closest?.('td,th'); return c && editor.contains(c) ? c : null; };
  const caretCell = () => {
    const s = window.getSelection();
    if (!s.rangeCount || !editor.contains(s.anchorNode)) return null;
    return cellOf(s.anchorNode);
  };
  const newCell = (tag) => { const c = document.createElement(tag); c.innerHTML = '<br>'; return c; };
  const focusCell = (c) => { if (c) { placeCaret(c); cell = c; } };
  /** Put a new cell into row `tr` so that it lands on logical column `c` (pos is the grid before the change). */
  const placeAt = (tr, n, c, pos) => tr.insertBefore(n, Array.from(tr.cells).find((x) => pos.has(x) && pos.get(x).c >= c) || null);
  /** Rows left without cells (everything covered by a rowspan) are removed and the rowspans shrink. */
  function normalize(t) {
    for (let guard = 0; guard < 50; guard++) {
      const g = gridOf(t);
      const r = g.rows.findIndex((tr) => !tr.cells.length);
      if (r < 0) return;
      uniq(g.M[r] || []).forEach((x) => setSpan(x, 'rowSpan', g.pos.get(x).rs - 1));
      const sec = g.rows[r].parentElement;
      g.rows[r].remove();
      if (!sec.rows.length && sec.tagName !== 'TABLE') sec.remove();
    }
  }
  /** Widths live on the first row; keep them there whatever row ends up first. */
  function keepWidths(t, fn) {
    const old = fixed(t) ? Array.from(t.rows[0]?.cells || []).map((c) => c.style.width) : null;
    fn();
    if (old && t.rows[0]) Array.from(t.rows[0].cells).forEach((c, i) => { if (old[i] && !c.style.width) c.style.width = old[i]; });
  }
  function fitFixed(t) {
    if (!fixed(t) || !t.rows[0]) return;
    const first = Array.from(t.rows[0].cells);
    let ws = first.map((c) => widthOf(c) || 120);
    const max = Math.max(200, editor.clientWidth - 4);
    const sum = ws.reduce((a, b) => a + b, 0);
    if (sum > max) ws = ws.map((w) => Math.max(MIN_COL, Math.floor(w * max / sum)));
    first.forEach((c, i) => (c.style.width = Math.round(ws[i]) + 'px'));
    t.style.width = Math.round(ws.reduce((a, b) => a + b, 0)) + 'px';
  }
  /** Width of one logical column in a fixed table (a merged first-row cell shares its width). */
  const colWidth = (g, c) => { const x = g.M[0]?.[c]; return x ? widthOf(x) / g.pos.get(x).cs : 0; };

  // ------------------------------------------------------------------ operations
  function insertRow(ref, after) {
    const t = ref.closest('table');
    const g = gridOf(t);
    const p = g.pos.get(ref);
    const b = after ? p.r + p.rs : p.r; // logical index of the new row
    const refRow = g.rows[after ? b - 1 : b];
    const inHead = refRow.parentElement.tagName === 'THEAD';
    const toBody = inHead && after && !refRow.nextElementSibling;
    const tag = inHead && !toBody ? 'th' : 'td';
    const tr = document.createElement('tr');
    const grown = new Set();
    for (let c = 0; c < g.cols; c++) {
      const above = g.M[b - 1]?.[c], below = g.M[b]?.[c];
      if (!toBody && above && above === below) {
        // a merged cell crosses the new row: it grows instead of getting a neighbour
        if (!grown.has(above)) { grown.add(above); setSpan(above, 'rowSpan', g.pos.get(above).rs + 1); }
        continue;
      }
      tr.appendChild(newCell(tag));
    }
    if (toBody) {
      let body = t.tBodies[0];
      if (!body) { body = document.createElement('tbody'); t.appendChild(body); }
      body.insertBefore(tr, body.firstChild);
    } else keepWidths(t, () => (after ? refRow.after(tr) : refRow.before(tr)));
    const g2 = gridOf(t);
    const r = g2.rows.indexOf(tr);
    focusCell(g2.M[r]?.[p.c] || tr.cells[0]);
  }
  /** Delete logical rows r0..r1; merged cells that reach outside the range shrink (and move down if they start inside). */
  function deleteRows(t, r0, r1) {
    const g = gridOf(t);
    const moves = [];
    cellsIn(g, r0, r1, 0, g.cols - 1).forEach((x) => {
      const p = g.pos.get(x);
      const end = p.r + p.rs - 1;
      const overlap = Math.min(end, r1) - Math.max(p.r, r0) + 1;
      if (p.r < r0) setSpan(x, 'rowSpan', p.rs - overlap);
      else if (end > r1) { setSpan(x, 'rowSpan', end - r1); moves.push([x, p.c]); }
    });
    moves.sort((a, b) => a[1] - b[1]).forEach(([x, c]) => placeAt(g.rows[r1 + 1], x, c, g.pos));
    keepWidths(t, () => {
      for (let r = r1; r >= r0; r--) {
        const sec = g.rows[r].parentElement;
        g.rows[r].remove();
        if (!sec.rows.length && sec.tagName !== 'TABLE') sec.remove();
      }
    });
    normalize(t);
  }
  function deleteRow(ref) {
    const t = ref.closest('table');
    const g = gridOf(t);
    const p = g.pos.get(ref);
    if (p.rs >= g.rows.length) return deleteTable(t);
    deleteRows(t, p.r, p.r + p.rs - 1);
    const g2 = gridOf(t);
    const r = Math.min(p.r, g2.rows.length - 1);
    focusCell(g2.M[r]?.[Math.min(p.c, (g2.M[r]?.length || 1) - 1)]);
  }
  function insertCol(ref, after) {
    const t = ref.closest('table');
    const g = gridOf(t);
    const p = g.pos.get(ref);
    const b = after ? p.c + p.cs : p.c; // logical index of the new column
    const w = fixed(t) ? colWidth(g, p.c) : 0;
    const grown = new Set();
    let target = null;
    g.rows.forEach((tr, r) => {
      const left = g.M[r][b - 1], right = g.M[r][b];
      if (left && left === right) {
        if (!grown.has(left)) {
          grown.add(left);
          setSpan(left, 'colSpan', g.pos.get(left).cs + 1);
          if (w && r === 0) left.style.width = Math.round(widthOf(left) + w) + 'px';
        }
        if (r === p.r) target = left;
        return;
      }
      const n = newCell(tr.parentElement.tagName === 'THEAD' ? 'th' : 'td');
      placeAt(tr, n, b, g.pos);
      if (w && r === 0) n.style.width = Math.round(w) + 'px';
      if (r === p.r) target = n;
    });
    if (w) fitFixed(t);
    focusCell(target);
  }
  /** Delete logical columns c0..c1; merged cells that reach outside the range get narrower. */
  function deleteCols(t, c0, c1) {
    const g = gridOf(t);
    cellsIn(g, 0, g.rows.length - 1, c0, c1).forEach((x) => {
      const p = g.pos.get(x);
      const overlap = Math.min(p.c + p.cs - 1, c1) - Math.max(p.c, c0) + 1;
      if (overlap >= p.cs) return x.remove();
      if (fixed(t) && p.r === 0) x.style.width = Math.round(widthOf(x) * (p.cs - overlap) / p.cs) + 'px';
      setSpan(x, 'colSpan', p.cs - overlap);
    });
    normalize(t);
    fitFixed(t);
  }
  function deleteCol(ref) {
    const t = ref.closest('table');
    const g = gridOf(t);
    const p = g.pos.get(ref);
    if (p.cs >= g.cols) return deleteTable(t);
    deleteCols(t, p.c, p.c + p.cs - 1);
    const g2 = gridOf(t);
    const r = Math.min(p.r, g2.rows.length - 1);
    focusCell(g2.M[r]?.[Math.min(p.c, (g2.M[r]?.length || 1) - 1)]);
  }
  /** Moving is only possible where no merged cell crosses the rows / columns involved. */
  const plainRows = (g, ...rs) => rs.every((r) => g.M[r] && uniq(g.M[r]).every((x) => g.pos.get(x).rs === 1));
  const plainCols = (g, ...cs) => cs.every((c) => uniq(g.M.map((row) => row[c])).every((x) => g.pos.get(x).cs === 1 && g.pos.get(x).rs === 1));
  function canMoveRow(ref, dir) {
    const g = gridOf(ref.closest('table'));
    const p = g.pos.get(ref);
    const row = g.rows[p.r];
    const sib = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
    return !!sib && p.rs === 1 && plainRows(g, p.r, g.rows.indexOf(sib));
  }
  function moveRow(ref, dir) {
    const row = ref.parentElement;
    const sib = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sib) return;
    const t = ref.closest('table');
    keepWidths(t, () => (dir < 0 ? sib.before(row) : sib.after(row)));
    // The widths travel with the cells of the old first row; put them back on the new first row.
    if (fixed(t)) {
      const all = rowsOf(t);
      const w = all.flatMap((r) => Array.from(r.cells)).filter((c) => c.style.width);
      const byIdx = new Map(w.map((c) => [c.cellIndex, c.style.width]));
      all.forEach((r, ri) => Array.from(r.cells).forEach((c) => { if (ri) c.style.removeProperty('width'); else if (byIdx.has(c.cellIndex)) c.style.width = byIdx.get(c.cellIndex); }));
    }
    focusCell(ref);
  }
  function canMoveCol(ref, dir) {
    const g = gridOf(ref.closest('table'));
    const p = g.pos.get(ref);
    const to = p.c + dir;
    return to >= 0 && to < g.cols && p.cs === 1 && plainCols(g, p.c, to);
  }
  function moveCol(ref, dir) {
    const t = ref.closest('table');
    const g = gridOf(t);
    const p = g.pos.get(ref);
    const to = p.c + dir;
    if (to < 0 || to >= g.cols) return;
    g.rows.forEach((tr, r) => {
      const a = g.M[r][p.c], b = g.M[r][to];
      if (!a || !b || a.parentElement !== tr || b.parentElement !== tr) return;
      if (dir < 0) b.before(a); else b.after(a);
    });
    focusCell(ref);
  }
  function toggleHeader(t) {
    const head = t.tHead;
    const swap = (c, tag) => { const n = document.createElement(tag); n.innerHTML = c.innerHTML; if (c.getAttribute('style')) n.setAttribute('style', c.getAttribute('style')); ['colspan', 'rowspan'].forEach((a) => c.hasAttribute(a) && n.setAttribute(a, c.getAttribute(a))); c.replaceWith(n); return n; };
    if (head) {
      let body = t.tBodies[0];
      if (!body) { body = document.createElement('tbody'); t.appendChild(body); }
      Array.from(head.rows).reverse().forEach((r) => { Array.from(r.cells).forEach((c) => swap(c, 'td')); body.insertBefore(r, body.firstChild); });
      head.remove();
    } else {
      const first = t.rows[0];
      if (!first) return;
      const th = document.createElement('thead');
      t.insertBefore(th, t.firstChild);
      th.appendChild(first);
      Array.from(first.cells).forEach((c) => { c.removeAttribute('rowspan'); swap(c, 'th'); });
    }
    focusCell(t.rows[0]?.cells[0]);
  }
  function deleteTable(t) {
    let after = t.nextElementSibling;
    if (!after) { after = document.createElement('p'); after.innerHTML = '<br>'; t.after(after); }
    t.remove();
    hide();
    placeCaret(after);
  }

  // ------------------------------------------------------------------ merge / split
  /** The rectangle from cell a to cell b, grown until no merged cell sticks out of it. */
  function rectOf(a, b) {
    const t = a.closest('table');
    const g = gridOf(t);
    const pa = g.pos.get(a), pb = g.pos.get(b);
    if (!pa || !pb) return null;
    let r0 = Math.min(pa.r, pb.r), c0 = Math.min(pa.c, pb.c);
    let r1 = Math.max(pa.r + pa.rs, pb.r + pb.rs) - 1, c1 = Math.max(pa.c + pa.cs, pb.c + pb.cs) - 1;
    for (let changed = true; changed;) {
      changed = false;
      for (const x of cellsIn(g, r0, r1, c0, c1)) {
        const p = g.pos.get(x);
        if (p.r < r0) { r0 = p.r; changed = true; }
        if (p.c < c0) { c0 = p.c; changed = true; }
        if (p.r + p.rs - 1 > r1) { r1 = p.r + p.rs - 1; changed = true; }
        if (p.c + p.cs - 1 > c1) { c1 = p.c + p.cs - 1; changed = true; }
      }
    }
    return { t, g, r0, r1, c0, c1, cells: cellsIn(g, r0, r1, c0, c1) };
  }
  const hasContent = (c) => !!(c.textContent.trim() || c.querySelector('img,ul,ol,table,hr,figure'));
  /** Merge a rectangle into its top-left cell; the text of the other cells is kept (one line each). */
  function merge(rect) {
    const { t, g, r0, r1, c0, c1, cells } = rect;
    if (cells.length < 2) return false;
    if (g.rows[r0].parentElement !== g.rows[r1].parentElement) throw new Error('The header row cannot be merged with the rows below it.');
    const keep = g.M[r0][c0];
    const extra = cells.filter((x) => x !== keep && hasContent(x)).map((x) => x.innerHTML);
    if (extra.length) keep.innerHTML = (hasContent(keep) ? [keep.innerHTML, ...extra] : extra).join('<br>');
    if (fixed(t) && r0 === 0) {
      let w = 0;
      for (let c = c0; c <= c1; c++) w += colWidth(g, c);
      keep.style.width = Math.round(w) + 'px';
    }
    cells.forEach((x) => x !== keep && x.remove());
    setSpan(keep, 'rowSpan', r1 - r0 + 1);
    setSpan(keep, 'colSpan', c1 - c0 + 1);
    normalize(t);
    focusCell(keep);
    return true;
  }
  /** Split a merged cell back into single cells (the text stays in the first one). */
  function split(x) {
    const t = x.closest('table');
    const g = gridOf(t);
    const p = g.pos.get(x);
    if (p.rs === 1 && p.cs === 1) return;
    const w = fixed(t) && p.r === 0 ? widthOf(x) / p.cs : 0;
    setSpan(x, 'rowSpan', 1);
    setSpan(x, 'colSpan', 1);
    if (w) x.style.width = Math.round(w) + 'px';
    const tag = x.tagName.toLowerCase();
    for (let r = p.r; r < p.r + p.rs; r++) {
      let prev = x;
      for (let c = p.c; c < p.c + p.cs; c++) {
        if (r === p.r && c === p.c) continue;
        const n = newCell(tag);
        ['background-color', 'color', 'text-align'].forEach((k) => x.style.getPropertyValue(k) && n.style.setProperty(k, x.style.getPropertyValue(k)));
        if (r === p.r) { prev.after(n); prev = n; if (w) n.style.width = Math.round(w) + 'px'; } else placeAt(g.rows[r], n, c, g.pos);
      }
    }
    focusCell(x);
  }
  /** Cells chosen by dragging across them (or Shift+click / Shift+arrows): a rectangle, or null. */
  function cellRange() {
    const s = window.getSelection();
    if (!s.rangeCount || s.isCollapsed) return null;
    const a = cellOf(s.anchorNode), b = cellOf(s.focusNode);
    if (!a || !b || a === b || a.closest('table') !== b.closest('table')) return null;
    return rectOf(a, b);
  }
  const neighbour = (c, dir) => {
    const g = gridOf(c.closest('table'));
    const p = g.pos.get(c);
    return dir === 'right' ? g.M[p.r]?.[p.c + p.cs] : g.M[p.r + p.rs]?.[p.c];
  };
  const isMerged = (c) => c && (c.rowSpan > 1 || c.colSpan > 1);

  // ------------------------------------------------------------------ colour
  const lum = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 1;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const isWhite = (v) => /^(#fff(fff)?|white|rgb\(255, 255, 255\))$/i.test((v || '').trim());
  function colorCells(cells, color) {
    cells.forEach((c) => {
      if (color) c.style.backgroundColor = color; else c.style.removeProperty('background-color');
      // Keep the text readable: white text on a dark fill, the theme's text (dark on light fills, via CSS) otherwise.
      if (color && lum(color) < 0.3) { if (!c.style.color || lum(rgbHex(c.style.color)) < 0.3) c.style.color = '#ffffff'; } else if (isWhite(c.style.color)) c.style.removeProperty('color');
      if (!c.getAttribute('style')) c.removeAttribute('style');
    });
  }
  function textColorCells(cells, color) {
    cells.forEach((c) => {
      if (color === 'auto') {
        c.style.removeProperty('color');
        const bg = rgbHex(c.style.backgroundColor);
        if (bg && lum(bg) < 0.3) c.style.color = '#ffffff';
      } else if (color) c.style.color = color;
      else c.style.removeProperty('color');
      if (!c.getAttribute('style')) c.removeAttribute('style');
    });
  }
  const rowCells = (c) => { const g = gridOf(c.closest('table')); const p = g.pos.get(c); return cellsIn(g, p.r, p.r + p.rs - 1, 0, g.cols - 1); };
  const colCells = (c) => { const g = gridOf(c.closest('table')); const p = g.pos.get(c); return cellsIn(g, 0, g.rows.length - 1, p.c, p.c + p.cs - 1); };
  /** For colour: just this row / column (a merged cell only counts once). */
  const lineCells = (c, scope) => { const g = gridOf(c.closest('table')); const p = g.pos.get(c); return scope === 'row' ? uniq(g.M[p.r]) : uniq(g.M.map((r) => r[p.c])); };

  // ------------------------------------------------------------------ actions
  function run(act, btn) {
    const c = cell && editor.contains(cell) ? cell : null;
    const t = c?.closest('table') || table;
    if (!t || !editor.contains(t)) return;
    const g = gridOf(t);
    const lastCell = () => { const p = c && g.pos.get(c); return g.M[g.rows.length - 1][Math.min(p ? p.c : 0, g.M[g.rows.length - 1].length - 1)]; };
    const lastCol = () => { const p = c && g.pos.get(c); const row = g.M[p ? p.r : g.rows.length - 1]; return row[row.length - 1]; };
    switch (act) {
      case 'row-above': return c && mutate(() => insertRow(c, false));
      case 'row-below': return c && mutate(() => insertRow(c, true));
      case 'row-end': return mutate(() => insertRow(lastCell(), true));
      case 'row-del': return c && mutate(() => deleteRow(c));
      case 'col-left': return c && mutate(() => insertCol(c, false));
      case 'col-right': return c && mutate(() => insertCol(c, true));
      case 'col-end': return mutate(() => insertCol(lastCol(), true));
      case 'col-del': return c && mutate(() => deleteCol(c));
      case 'table-del': return mutate(() => deleteTable(t));
      case 'merge': return c && mergeMenu(btn, c);
      case 'split': return c && isMerged(c) && mutate(() => split(c));
      case 'color': return c && colorMenu(btn, c, 'fill');
      case 'text-color': return c && colorMenu(btn, c, 'text');
      case 'more': return moreMenu(btn, t, c);
    }
  }
  function doMerge(rect) {
    if (!rect) return;
    try { mutate(() => merge(rect)); } catch (e) { toast(e.message, 'error'); }
  }
  function mergeMenu(btn, c) {
    const range = cellRange();
    if (range && range.cells.length > 1) return doMerge(range);
    const right = neighbour(c, 'right'), down = neighbour(c, 'down');
    menu(btn, [
      { title: 'Merge cells' },
      { label: 'Merge with the cell to the right', icon: 'arrow-right', disabled: !right, onClick: () => doMerge(rectOf(c, right)) },
      { label: 'Merge with the cell below', icon: 'arrow-down', disabled: !down, onClick: () => doMerge(rectOf(c, down)) },
      { label: 'Split cell', icon: 'table-cells-split', disabled: !isMerged(c), onClick: () => mutate(() => split(c)) },
      { title: 'Tip: drag across cells (or Shift+click) to merge several at once' },
    ]);
  }
  function colorMenu(btn, c, kind) {
    const range = cellRange();
    let scope = range ? 'sel' : 'cell';
    const scopes = [...(range ? [['sel', `Selected (${range.cells.length})`]] : []), ['cell', 'Cell'], ['row', 'Row'], ['col', 'Column']];
    const list = kind === 'text' ? TEXT_COLORS : CELL_COLORS;
    const wrap = h(String(html`<div class="tbl-color"><div class="menu-title">${kind === 'text' ? 'Text colour' : 'Fill colour'}</div>
      <div class="seg tbl-scope">${scopes.map(([k, l]) => html`<button type="button" class="btn xs ${k === scope ? 'active' : ''}" data-scope="${k}">${l}</button>`)}</div>
      <div class="swatches">${list.map((col) => html`<button type="button" class="swatch ${kind === 'text' ? 'txt' : ''}" data-c="${col}" style="--sw:${kind === 'text' ? (col === 'auto' ? 'var(--text)' : col) : col || 'var(--bg-elev)'}" aria-label="${col === 'auto' ? 'Automatic' : col || 'No colour'}" data-tip="${col === 'auto' ? 'Automatic (readable on the fill)' : ''}">${kind === 'text' ? (col === 'auto' ? icon('wand-sparkles', 'sm') : 'A') : col ? '' : icon('slash', 'sm')}</button>`)}</div>
      ${kind === 'fill' ? html`<div class="tiny subtle tbl-note">Text on dark fills turns white automatically.</div>` : ''}</div>`));
    const p = popover(btn, wrap);
    wrap.addEventListener('mousedown', (e) => e.preventDefault());
    wrap.addEventListener('click', (e) => {
      const sc = e.target.closest('[data-scope]');
      if (sc) { scope = sc.dataset.scope; wrap.querySelectorAll('[data-scope]').forEach((b) => b.classList.toggle('active', b === sc)); return; }
      const s = e.target.closest('[data-c]');
      if (!s) return;
      p.close();
      const cells = scope === 'sel' ? range.cells : scope === 'cell' ? [c] : lineCells(c, scope);
      mutate(() => (kind === 'text' ? textColorCells(cells, s.dataset.c) : colorCells(cells, s.dataset.c)));
    });
  }
  function moreMenu(btn, t, c) {
    const first = Array.from(t.rows[0]?.cells || []);
    const merged = !!t.querySelector('[rowspan],[colspan]');
    menu(btn, [
      c && { label: 'Move row up', icon: 'arrow-up', disabled: !canMoveRow(c, -1), onClick: () => mutate(() => moveRow(c, -1)) },
      c && { label: 'Move row down', icon: 'arrow-down', disabled: !canMoveRow(c, 1), onClick: () => mutate(() => moveRow(c, 1)) },
      c && { label: 'Move column left', icon: 'arrow-left', disabled: !canMoveCol(c, -1), onClick: () => mutate(() => moveCol(c, -1)) },
      c && { label: 'Move column right', icon: 'arrow-right', disabled: !canMoveCol(c, 1), onClick: () => mutate(() => moveCol(c, 1)) },
      merged && c && { title: 'Rows / columns with merged cells cannot be moved' },
      { divider: true },
      c && { label: 'Split cell', icon: 'table-cells-split', disabled: !isMerged(c), onClick: () => mutate(() => split(c)) },
      merged && { label: 'Split all merged cells', icon: 'table-cells-split', onClick: () => mutate(() => Array.from(t.querySelectorAll('[rowspan],[colspan]')).forEach(split)) },
      { label: t.tHead ? 'Remove header row' : 'First row as header', icon: 'panel-top', onClick: () => mutate(() => toggleHeader(t)) },
      { label: 'Equal column widths', icon: 'columns-3', onClick: () => mutate(() => { const n = gridOf(t).cols; first.forEach((x) => (x.style.width = (100 * (x.colSpan || 1) / n).toFixed(2) + '%')); t.classList.add('sn-table-fixed'); t.style.width = '100%'; }) },
      { label: 'Fit to page width', icon: 'move-horizontal', onClick: () => mutate(() => { first.forEach((x) => x.style.removeProperty('width')); t.classList.remove('sn-table-fixed'); t.style.removeProperty('width'); }) },
      { label: 'Fit to content', icon: 'shrink', onClick: () => mutate(() => { first.forEach((x) => x.style.removeProperty('width')); t.classList.remove('sn-table-fixed'); t.style.width = 'auto'; }) },
      { title: 'Tip: drag a column border to resize · Tab in the last cell adds a row' },
      { divider: true },
      { label: 'Delete table', icon: 'trash-2', danger: true, onClick: () => mutate(() => deleteTable(t)) },
    ], { align: 'end' });
  }

  // Highlight what a button will change (red for delete).
  const hl = (cells, cls) => { editor.querySelectorAll('.tbl-hl, .tbl-del').forEach((x) => x.classList.remove('tbl-hl', 'tbl-del')); cells?.forEach((x) => x.classList.add(cls)); };
  bar.addEventListener('pointerover', (e) => {
    const b = e.target.closest('[data-t]');
    const c = cell;
    if (!b || !c || !editor.contains(c)) return hl(null);
    const a = b.dataset.t;
    if (a === 'row-del') hl(rowCells(c), 'tbl-del');
    else if (a === 'col-del') hl(colCells(c), 'tbl-del');
    else if (a === 'table-del') hl(Array.from(c.closest('table').querySelectorAll('td,th')), 'tbl-del');
    else if (a === 'merge') { const r = cellRange(); hl(r ? r.cells : null, 'tbl-hl'); }
    else if (a.startsWith('row')) hl(rowCells(c), 'tbl-hl');
    else if (a.startsWith('col')) hl(colCells(c), 'tbl-hl');
    else hl(null);
  });
  bar.addEventListener('pointerleave', () => hl(null));
  for (const el of [bar, addCol, addRow]) {
    // Keep the caret in the cell while using the tools (mouse, pen and touch).
    el.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-t]')) e.preventDefault(); });
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) { e.preventDefault(); hl(null); run(b.dataset.t, b); } });
  }
  [addCol, addRow].forEach((b) => b.addEventListener('pointerenter', () => {
    const t = table;
    if (!t) return;
    const g = gridOf(t);
    hl(b === addCol ? uniq(g.M.map((r) => r[g.cols - 1])) : uniq(g.M[g.rows.length - 1]), 'tbl-hl');
  }));
  [addCol, addRow].forEach((b) => b.addEventListener('pointerleave', () => hl(null)));
  /** Cells inside a drag selection get a tint, so you see what "Merge" will join. */
  function paintRange() {
    const r = cellRange();
    const want = new Set(r ? r.cells : []);
    editor.querySelectorAll('.tbl-sel').forEach((x) => { if (!want.has(x)) x.classList.remove('tbl-sel'); });
    want.forEach((x) => x.classList.add('tbl-sel'));
    const m = bar.querySelector('[data-t="merge"]');
    if (m) m.classList.toggle('pulse-on', want.size > 1);
    const sp = bar.querySelector('[data-t="split"]');
    if (sp) sp.disabled = !isMerged(caretCell());
  }

  // ------------------------------------------------------------------ placement
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(); }); };
  function hide() { bar.hidden = addCol.hidden = addRow.hidden = true; table = null; }
  function place() {
    if (!editable()) return hide();
    cell = caretCell();
    const t = cell?.closest('table') || (hover && editor.contains(hover) ? hover : null);
    if (!t) return hide();
    table = t;
    const r = t.getBoundingClientRect();
    const er = editor.getBoundingClientRect();
    const vv = window.visualViewport;
    const vTop = vv ? vv.offsetTop : 0, vH = vv ? vv.height : innerHeight;
    const tb = toolbar.getBoundingClientRect();
    const minTop = Math.max(vTop + 4, tb.height && tb.bottom > 0 && tb.bottom < vH ? tb.bottom + 4 : 0);
    if (r.bottom < minTop + 10 || r.top > vTop + vH) return hide();
    // bar: only with the caret in a cell (it acts on that cell)
    bar.hidden = !cell;
    const sp = bar.querySelector('[data-t="split"]');
    if (sp) sp.disabled = !isMerged(cell);
    if (cell) {
      const bh = bar.offsetHeight || 36, bw = bar.offsetWidth || 360;
      const top = Math.max(minTop, r.top - bh - 6);
      bar.style.top = Math.min(top, r.bottom - 8) + 'px';
      bar.style.left = Math.max(8, Math.min(innerWidth - bw - 8, r.left)) + 'px';
    }
    const right = Math.min(r.right, er.right + 2);
    addCol.hidden = false;
    addCol.style.left = Math.min(right + 3, innerWidth - (addCol.offsetWidth || 26) - 2) + 'px';
    addCol.style.top = Math.max(r.top, minTop) + 'px';
    addCol.style.height = Math.max(24, r.bottom - Math.max(r.top, minTop)) + 'px';
    addRow.hidden = false;
    addRow.style.left = r.left + 'px';
    addRow.style.top = r.bottom + 3 + 'px';
    addRow.style.width = Math.max(40, right - r.left) + 'px';
  }
  // Hover: the "+" strips show for any table under the mouse; the bar needs the caret in a cell.
  const onMove = (e) => {
    if (e.pointerType === 'touch') return;
    const t = e.target.closest?.('table');
    const over = t && editor.contains(t) ? t : [addCol, addRow, bar].some((x) => x.contains(e.target)) ? hover : null;
    if (over !== hover) { hover = over; schedule(); }
  };
  const onSel = () => { schedule(); paintRange(); };
  editor.addEventListener('pointermove', onMove);
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('selectionchange', onSel);
  window.addEventListener('scroll', onSel, true);
  window.addEventListener('resize', onSel);
  window.visualViewport?.addEventListener('resize', onSel);
  window.visualViewport?.addEventListener('scroll', onSel);
  editor.addEventListener('input', onSel);
  editor.addEventListener('blur', () => setTimeout(() => { if (!editor.contains(document.activeElement) && document.activeElement !== editor) { cell = null; schedule(); } }, 150));

  return {
    /** Tab in the last cell adds a row (word-processor behaviour). */
    tabFromLast(c) { mutate(() => insertRow(c, true)); const r = c.parentElement.nextElementSibling; if (r) focusCell(r.cells[0]); },
    refresh: schedule,
    run,
    destroy() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('selectionchange', onSel);
      window.removeEventListener('scroll', onSel, true);
      window.removeEventListener('resize', onSel);
      window.visualViewport?.removeEventListener('resize', onSel);
      window.visualViewport?.removeEventListener('scroll', onSel);
      bar.remove(); addCol.remove(); addRow.remove();
    },
  };
}
