// Pointer-based drag & drop sorting (mouse + touch) across one or more lists.
export function sortable(root, { item, list, handle = null, onDrop, delay = 0 }) {
  let drag = null;

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const it = e.target.closest(item);
    if (!it || !root.contains(it)) return;
    if (handle && !e.target.closest(handle)) return;
    if (e.target.closest('button, a, input, select, textarea, [data-no-drag]')) return;
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
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    if (touch && delay) holdTimer = setTimeout(() => { begin(); delay = delay; }, delay);
  }

  root.addEventListener('pointerdown', onDown);
  return () => root.removeEventListener('pointerdown', onDown);
}
