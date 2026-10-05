// Chip-style multi value input (tags, participants).
import { html, icon, h, esc } from '../core/dom.js';

export function tagInput({ value = [], suggestions = [], placeholder = 'Add…', normalize = (v) => v.trim(), prefix = '', onChange } = {}) {
  let items = [...value];
  const el = h('<div class="tag-input" style="position:relative"></div>');
  const listId = 'dl' + Math.random().toString(36).slice(2);

  function render() {
    el.innerHTML = String(html`${items.map((t, i) => html`<span class="tag">${prefix}${t}<button type="button" data-i="${i}" aria-label="Remove">${icon('x', 'sm')}</button></span>`)}
      <input type="text" placeholder="${items.length ? '' : placeholder}" list="${listId}" autocomplete="off" enterkeyhint="done">
      <datalist id="${listId}">${suggestions.filter((s) => !items.includes(s)).slice(0, 50).map((s) => html`<option value="${s}">`)}</datalist>`);
    input = el.querySelector('input');
    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', () => commit());
    input.addEventListener('input', () => {
      if (suggestions.includes(normalize(input.value))) commit();
    });
  }
  let input;
  function commit() {
    const raw = input.value;
    if (!raw.trim()) return;
    raw.split(/[,;\n]/).forEach((p) => {
      const v = normalize(p);
      if (v && !items.includes(v)) items.push(v);
    });
    input.value = '';
    render();
    input.focus();
    onChange?.(items);
  }
  function onKey(e) {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab' && input.value.trim()) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input.value && items.length) {
      items.pop();
      render();
      input.focus();
      onChange?.(items);
    }
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) {
      items.splice(+b.dataset.i, 1);
      render();
      onChange?.(items);
    }
    input.focus();
  });
  render();
  return {
    el,
    get: () => { if (input.value.trim()) commit(); return [...items]; },
    set: (v) => { items = [...v]; render(); },
  };
}

export const normalizeTag = (v) => v.trim().replace(/^#/, '').toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** "Jane Doe <jane@x.com>" | "jane@x.com" | "Jane" -> {name, email} */
export function parseParticipant(s) {
  const t = String(s).trim();
  const m = t.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim() };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { name: t, email: t };
  return { name: t, email: null };
}
export const formatParticipant = (p) => (p.email && p.email !== p.name ? `${p.name} <${p.email}>` : p.name || p.email || '');
export { esc };
