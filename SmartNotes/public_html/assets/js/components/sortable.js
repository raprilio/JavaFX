// Pointer-based drag & drop sorting (mouse + touch) across one or more lists.
// layout: 'list' (vertical lists, e.g. a board), 'grid' (cards in rows) or 'columns' (CSS columns / masonry):
// in grid / columns the card under the pointer decides the spot (left / right half, or upper / lower half).
// canDrag(item) may refuse an item; on touch, `delay` is a long press so normal scrolling keeps working.
export function sortable(root, { item, list, handle = null, onDrop, delay = 0, layout = 'list', canDrag = null }) {
  let drag = null;

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const it = e.target.closest(item);
    if (!it || !root.contains(it)) return;
    if (handle && !e.target.closest(handle)) return;
    // Controls inside the item keep working; the item itself may be a link (it opens on click, moves on drag).
    const ctl = e.target.closest('button, a, input, select, textarea, label, [data-no-drag]');
    if (ctl && ctl !== it && it.contains(ctl)) return;
    if (canDrag && !canDrag(it)) return;
    const startX = e.clientX, startY = e.clientY;
    const touch = e.pointerType === 'touch';
    let started = false;
    let holdTimer = null;
    const pointerId = e.pointerId;

    const begin = () => {
      started = true;
      const r = it.getBoundingClientRect();
      const ghost = it.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.style.width = r.width + 'px';
      ghost.style.left = r.left + 'px';
      ghost.style.top = r.top + 'px';
      document.body.appendChild(ghost);
      const ph = document.createElement('div');
      ph.className = 'drag-placeholder';
      ph.style.height = r.height + 'px';
      if (layout !== 'list') ph.style.width = r.width + 'px';
      // in a CSS grid the placeholder takes the same columns / rows as the item (e.g. dashboard widgets)
      if (it.style.gridColumn) ph.style.gridColumn = it.style.gridColumn;
      if (it.style.gridRow) ph.style.gridRow = it.style.gridRow;
      window.addEventListener('touchmove', noScroll, { passive: false });
      it.after(ph);
      it.classList.add('drag-source');
      it.style.display = 'none';
      drag = { it, ghost, ph, dx: startX - r.left, dy: startY - r.top, fromList: it.closest(list) };
      document.body.style.userSelect = 'none';
      navigator.vibrate?.(10);
    };

    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      if (!started) {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (touch && delay) { if (dist > 8) cancel(); return; }
        if (dist < 6) return;
        begin();
      }
      ev.preventDefault();
      drag.ghost.style.left = ev.clientX - drag.dx + 'px';
      drag.ghost.style.top = ev.clientY - drag.dy + 'px';
      drag.ghost.style.display = 'none';
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      drag.ghost.style.display = '';
      const targetList = under?.closest(list);
      root.querySelectorAll(list).forEach((l) => l.classList.toggle('drop-over', l === targetList));
      if (!targetList || !root.contains(targetList)) return;
      if (layout !== 'list') {
        const over = under?.closest(item);
        if (over && over !== drag.it && targetList.contains(over)) {
          const r = over.getBoundingClientRect();
          // grid: the top-left half of the card (split on the diagonal) means "before" — works for one or many columns
          const before = layout === 'grid' ? (ev.clientX - r.left) / r.width + (ev.clientY - r.top) / r.height < 1 : ev.clientY < r.top + r.height / 2;
          if (before) { if (over.previousElementSibling !== drag.ph) over.before(drag.ph); } else if (over.nextElementSibling !== drag.ph) over.after(drag.ph);
        } else if (!over && !under?.closest('.drag-placeholder') && !targetList.querySelector(item + ':not(.drag-source)')) targetList.appendChild(drag.ph);
        autoScroll(ev);
        return;
      }
      const siblings = Array.from(targetList.querySelectorAll(item)).filter((x) => x !== drag.it);
      let before = null;
      for (const s of siblings) {
        const r = s.getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) { before = s; break; }
      }
      if (before) before.before(drag.ph); else targetList.appendChild(drag.ph);
      // auto-scroll horizontally scrolling boards
      const sc = root.querySelector('[data-scroll]') || root;
      const rr = sc.getBoundingClientRect();
      if (ev.clientX > rr.right - 40) sc.scrollLeft += 12;
      if (ev.clientX < rr.left + 40) sc.scrollLeft -= 12;
    };

    const up = (ev) => {
      if (ev && ev.pointerId !== pointerId) return;
      cleanupListeners();
      clearTimeout(holdTimer);
      if (!started || !drag) return;
      const toList = drag.ph.parentElement;
      drag.ph.replaceWith(drag.it);
      drag.it.style.display = '';
      drag.it.classList.remove('drag-source');
      drag.ghost.remove();
      root.querySelectorAll(list).forEach((l) => l.classList.remove('drop-over'));
      document.body.style.userSelect = '';
      const index = Array.from(toList.querySelectorAll(item)).indexOf(drag.it);
      const d = drag;
      drag = null;
      // Suppress the click that follows a drag
      const stop = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
      d.it.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => d.it.removeEventListener('click', stop, { capture: true }), 50);
      onDrop?.(d.it, toList, index, d.fromList);
    };
    const cancel = () => { cleanupListeners(); clearTimeout(holdTimer); };
    const cleanupListeners = () => {
      window.removeEventListener('touchmove', noScroll);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    if (touch && delay) holdTimer = setTimeout(() => { begin(); delay = delay; }, delay);
  }

  // While dragging on a touch screen the page must not scroll under the finger.
  const noScroll = (ev) => { if (drag) ev.preventDefault(); };
  // Near the top / bottom of the window the page scrolls, so long lists can be arranged.
  const autoScroll = (ev) => {
    if (ev.clientY < 70) window.scrollBy(0, -14);
    else if (ev.clientY > innerHeight - 70) window.scrollBy(0, 14);
    const sc = root.closest('.main-scroll, .content, main');
    if (sc && sc.scrollHeight > sc.clientHeight) { if (ev.clientY < 90) sc.scrollTop -= 14; else if (ev.clientY > innerHeight - 90) sc.scrollTop += 14; }
  };
  root.addEventListener('pointerdown', onDown);
  return () => root.removeEventListener('pointerdown', onDown);
}
