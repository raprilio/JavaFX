// Table tools for the note editor (v1.16): a size picker to insert, a bar above the table the caret is in
// (rows, columns, header, colour, order, widths, delete) and "+" strips on the right / bottom edge to grow it.
// Every change goes through `mutate`, so it lands in the editor's own undo history.
import { html, icon, h } from '../core/dom.js';
import { menu, popover } from '../core/ui.js';

const CELL_COLORS = ['', '#fee2e2', '#ffedd5', '#fef9c3', '#dcfce7', '#ccfbf1', '#dbeafe', '#e0e7ff', '#f3e8ff', '#fce7f3', '#f1f5f9'];
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
    <span class="sep"></span><span class="tbl-lbl">Table</span>
    <button type="button" class="btn ghost icon xs" data-t="color" data-tip="Cell colour" aria-label="Cell colour">${icon('paint-bucket', 'sm')}</button>
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
  const rowsOf = (t) => Array.from(t.rows);
  const colCount = (t) => Math.max(0, ...rowsOf(t).map((r) => r.cells.length));
  const widthOf = (c) => parseFloat(c?.style.width) || c?.getBoundingClientRect().width || 0;
  const fixed = (t) => t.classList.contains('sn-table-fixed');
  const caretCell = () => {
    const s = window.getSelection();
    if (!s.rangeCount || !editor.contains(s.anchorNode)) return null;
    const n = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
    const c = n?.closest('td,th');
    return c && editor.contains(c) ? c : null;
  };
  const newCell = (tag) => { const c = document.createElement(tag); c.innerHTML = '<br>'; return c; };
  const focusCell = (c) => { if (c) { placeCaret(c); cell = c; } };
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

  // ------------------------------------------------------------------ operations
  function insertRow(ref, after) {
    const t = ref.closest('table');
    const row = ref.parentElement;
    const inHead = row.parentElement.tagName === 'THEAD';
    const tr = document.createElement('tr');
    const n = colCount(t);
    if (inHead && after) {
      let body = t.tBodies[0];
      if (!body) { body = document.createElement('tbody'); t.appendChild(body); }
      for (let i = 0; i < n; i++) tr.appendChild(newCell('td'));
      body.insertBefore(tr, body.firstChild);
    } else {
      const tag = inHead ? 'th' : 'td';
      for (let i = 0; i < n; i++) tr.appendChild(newCell(tag));
      keepWidths(t, () => (after ? row.after(tr) : row.before(tr)));
    }
    focusCell(tr.cells[Math.min(ref.cellIndex, tr.cells.length - 1)]);
  }
  function deleteRow(ref) {
    const t = ref.closest('table');
    const rows = rowsOf(t);
    if (rows.length <= 1) return deleteTable(t);
    const row = ref.parentElement;
    const i = rows.indexOf(row);
    const idx = ref.cellIndex;
    keepWidths(t, () => {
      const sec = row.parentElement;
      row.remove();
      if (!sec.rows.length && sec.tagName !== 'TABLE') sec.remove();
    });
    const next = rowsOf(t)[Math.min(i, rowsOf(t).length - 1)];
    focusCell(next?.cells[Math.min(idx, next.cells.length - 1)]);
  }
  function insertCol(ref, after) {
    const t = ref.closest('table');
    const idx = ref.cellIndex;
    const w = fixed(t) ? widthOf(t.rows[0].cells[Math.min(idx, t.rows[0].cells.length - 1)]) : 0;
    let target = null;
    rowsOf(t).forEach((r) => {
      const c = r.cells[Math.min(idx, r.cells.length - 1)];
      const n = newCell(c?.tagName === 'TH' ? 'th' : 'td');
      if (!c) r.appendChild(n); else if (after) c.after(n); else c.before(n);
      if (r === ref.parentElement) target = n;
    });
    if (w) { t.rows[0].cells[after ? idx + 1 : idx].style.width = Math.round(w) + 'px'; fitFixed(t); }
    focusCell(target);
  }
  function deleteCol(ref) {
    const t = ref.closest('table');
    if (colCount(t) <= 1) return deleteTable(t);
    const idx = ref.cellIndex;
    const row = ref.parentElement;
    const w = fixed(t) ? widthOf(t.rows[0].cells[idx]) : 0;
    rowsOf(t).forEach((r) => r.cells[idx]?.remove());
    if (fixed(t)) t.style.width = Math.max(MIN_COL, Math.round((parseFloat(t.style.width) || 0) - w)) + 'px';
    focusCell(row.cells[Math.min(idx, row.cells.length - 1)]);
  }
  function moveRow(ref, dir) {
    const row = ref.parentElement;
    const sib = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sib) return;
    const t = ref.closest('table');
    const idx = ref.cellIndex;
    keepWidths(t, () => (dir < 0 ? sib.before(row) : sib.after(row)));
    // The widths travel with the cells of the old first row; put them back on the new first row.
    if (fixed(t)) {
      const all = rowsOf(t);
      const w = all.flatMap((r) => Array.from(r.cells)).filter((c) => c.style.width);
      const byIdx = new Map(w.map((c) => [c.cellIndex, c.style.width]));
      all.forEach((r, ri) => Array.from(r.cells).forEach((c) => { if (ri) c.style.removeProperty('width'); else if (byIdx.has(c.cellIndex)) c.style.width = byIdx.get(c.cellIndex); }));
    }
    focusCell(row.cells[idx]);
  }
  function moveCol(ref, dir) {
    const t = ref.closest('table');
    const idx = ref.cellIndex;
    const to = idx + dir;
    if (to < 0 || to >= colCount(t)) return;
    rowsOf(t).forEach((r) => {
      const a = r.cells[idx], b = r.cells[to];
      if (!a || !b) return;
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
      Array.from(first.cells).forEach((c) => swap(c, 'th'));
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
  function colorCells(cells, color) {
    cells.forEach((c) => { if (color) c.style.backgroundColor = color; else c.style.removeProperty('background-color'); if (!c.getAttribute('style')) c.removeAttribute('style'); });
  }
  const rowCells = (c) => Array.from(c.parentElement.cells);
  const colCells = (c) => rowsOf(c.closest('table')).map((r) => r.cells[c.cellIndex]).filter(Boolean);

  // ------------------------------------------------------------------ actions
  function run(act, btn) {
    const c = cell && editor.contains(cell) ? cell : null;
    const t = c?.closest('table') || table;
    if (!t || !editor.contains(t)) return;
    const lastCell = () => { const r = t.rows[t.rows.length - 1]; return r.cells[Math.min(c ? c.cellIndex : 0, r.cells.length - 1)]; };
    const lastCol = () => { const r = c ? c.parentElement : t.rows[t.rows.length - 1]; return r.cells[r.cells.length - 1]; };
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
      case 'color': return c && colorMenu(btn, c);
      case 'more': return moreMenu(btn, t, c);
    }
  }
  function colorMenu(btn, c) {
    let scope = 'cell';
    const wrap = h(String(html`<div><div class="menu-title">Colour</div>
      <div class="seg tbl-scope">${[['cell', 'Cell'], ['row', 'Row'], ['col', 'Column']].map(([k, l]) => html`<button type="button" class="btn xs ${k === 'cell' ? 'active' : ''}" data-scope="${k}">${l}</button>`)}</div>
      <div class="swatches">${CELL_COLORS.map((col) => html`<button type="button" class="swatch" data-c="${col}" style="--sw:${col || 'var(--bg-elev)'}" aria-label="${col || 'No colour'}">${col ? '' : icon('slash', 'sm')}</button>`)}</div></div>`));
    const p = popover(btn, wrap);
    wrap.addEventListener('mousedown', (e) => e.preventDefault());
    wrap.addEventListener('click', (e) => {
      const sc = e.target.closest('[data-scope]');
      if (sc) { scope = sc.dataset.scope; wrap.querySelectorAll('[data-scope]').forEach((b) => b.classList.toggle('active', b === sc)); return; }
      const s = e.target.closest('[data-c]');
      if (!s) return;
      p.close();
      mutate(() => colorCells(scope === 'row' ? rowCells(c) : scope === 'col' ? colCells(c) : [c], s.dataset.c));
    });
  }
  function moreMenu(btn, t, c) {
    const first = Array.from(t.rows[0]?.cells || []);
    menu(btn, [
      c && { label: 'Move row up', icon: 'arrow-up', disabled: !c.parentElement.previousElementSibling, onClick: () => mutate(() => moveRow(c, -1)) },
      c && { label: 'Move row down', icon: 'arrow-down', disabled: !c.parentElement.nextElementSibling, onClick: () => mutate(() => moveRow(c, 1)) },
      c && { label: 'Move column left', icon: 'arrow-left', disabled: c.cellIndex === 0, onClick: () => mutate(() => moveCol(c, -1)) },
      c && { label: 'Move column right', icon: 'arrow-right', disabled: c.cellIndex >= colCount(t) - 1, onClick: () => mutate(() => moveCol(c, 1)) },
      { divider: true },
      { label: t.tHead ? 'Remove header row' : 'First row as header', icon: 'panel-top', onClick: () => mutate(() => toggleHeader(t)) },
      { label: 'Equal column widths', icon: 'columns-3', onClick: () => mutate(() => { first.forEach((x) => (x.style.width = (100 / first.length).toFixed(2) + '%')); t.classList.add('sn-table-fixed'); t.style.width = '100%'; }) },
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
    hl(b === addCol ? rowsOf(t).map((r) => r.cells[r.cells.length - 1]).filter(Boolean) : Array.from(t.rows[t.rows.length - 1].cells), 'tbl-hl');
  }));
  [addCol, addRow].forEach((b) => b.addEventListener('pointerleave', () => hl(null)));

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
  const onSel = () => schedule();
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
