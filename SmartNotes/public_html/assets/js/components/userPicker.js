// "Tag users" field: chips of registered users with a searchable dropdown (users/directory).
import { html, icon, h, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { avatarHtml } from '../core/ui.js';

let directoryCache = null;
async function directory(q = '') {
  if (!q && directoryCache) return directoryCache;
  const list = await api.get('users/directory', { q });
  if (!q) directoryCache = list;
  return list;
}

/**
 * @param {{value?: Array<{id:number,name:string,email?:string}>, placeholder?: string}} opts
 * @returns {{el: HTMLElement, get: () => number[], set: (users: Array) => void}}
 */
export function userPicker({ value = [], placeholder = 'Type a name to tag colleagues…' } = {}) {
  let picked = value.map((u) => ({ id: +u.id, name: u.name, email: u.email || '' }));
  let options = [];
  let active = 0;
  const el = h(String(html`<div class="user-picker">
    <div class="up-box"><span data-chips></span><input class="up-input" type="text" placeholder="${placeholder}" autocomplete="off" aria-label="Tag users"></div>
    <div class="up-drop hidden" role="listbox"></div></div>`));
  const input = el.querySelector('input');
  const drop = el.querySelector('.up-drop');

  function paintChips() {
    el.querySelector('[data-chips]').innerHTML = picked.map((u) => String(html`<span class="up-chip" data-id="${u.id}">${icon('at-sign', 'xs')}${u.name}<button type="button" data-rm="${u.id}" aria-label="Remove ${u.name}">${icon('x', 'xs')}</button></span>`)).join('');
    input.placeholder = picked.length ? '' : placeholder;
  }
  function paintDrop() {
    const ids = new Set(picked.map((u) => u.id));
    const list = options.filter((o) => !ids.has(o.id)).slice(0, 8);
    if (!list.length || document.activeElement !== input) { drop.classList.add('hidden'); return; }
    active = Math.min(active, list.length - 1);
    drop.innerHTML = list.map((o, i) => String(html`<button type="button" class="up-opt ${i === active ? 'active' : ''}" data-pick="${o.id}" role="option">
      ${avatarHtml(o, 'sm')}<span class="grow" style="min-width:0"><b class="truncate" style="display:block">${o.name}</b><span class="tiny subtle truncate" style="display:block">${o.email}${o.job_title ? ' · ' + o.job_title : ''}</span></span></button>`)).join('');
    drop.classList.remove('hidden');
  }
  const search = debounce(async () => {
    try { options = await directory(input.value.trim()); } catch { options = []; }
    active = 0;
    paintDrop();
  }, 200);
  function pick(id) {
    const o = options.find((x) => x.id === id);
    if (o && !picked.some((u) => u.id === id)) picked.push({ id: o.id, name: o.name, email: o.email });
    input.value = '';
    paintChips();
    search();
    input.focus();
  }
  input.addEventListener('focus', search);
  input.addEventListener('input', search);
  input.addEventListener('blur', () => setTimeout(() => drop.classList.add('hidden'), 150));
  input.addEventListener('keydown', (e) => {
    const opts = [...drop.querySelectorAll('[data-pick]')];
    if (e.key === 'ArrowDown' && opts.length) { e.preventDefault(); active = (active + 1) % opts.length; paintDrop(); }
    else if (e.key === 'ArrowUp' && opts.length) { e.preventDefault(); active = (active - 1 + opts.length) % opts.length; paintDrop(); }
    else if (e.key === 'Enter' && opts.length && !drop.classList.contains('hidden')) { e.preventDefault(); pick(+opts[active].dataset.pick); }
    else if (e.key === 'Backspace' && !input.value && picked.length) { picked.pop(); paintChips(); paintDrop(); }
  });
  el.addEventListener('mousedown', (e) => { if (e.target.closest('[data-pick]')) e.preventDefault(); });
  el.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pick]');
    if (p) return pick(+p.dataset.pick);
    const rm = e.target.closest('[data-rm]');
    if (rm) { picked = picked.filter((u) => u.id !== +rm.dataset.rm); paintChips(); return; }
    if (e.target.closest('.up-box')) input.focus();
  });
  paintChips();
  return {
    el,
    get: () => picked.map((u) => u.id),
    set: (users) => { picked = users.map((u) => ({ id: +u.id, name: u.name, email: u.email || '' })); paintChips(); },
  };
}
