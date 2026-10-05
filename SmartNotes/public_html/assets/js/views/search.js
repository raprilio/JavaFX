// Advanced global search with filters (type, category, tag, date range, favorite, archived).
import { html, icon, debounce, fmtDay, highlight } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { setQuery } from '../core/router.js';
import { toastError, empty } from '../core/ui.js';

const TYPES = [['all', 'Everything', 'search'], ['note', 'Notes', 'notebook-pen'], ['task', 'Tasks', 'square-check-big'], ['meeting', 'Meetings', 'users'], ['event', 'Calendar', 'calendar-days'],
  ['mindmap', 'Mind maps', 'network'], ['flowchart', 'Flowcharts', 'workflow'], ['audio', 'Audio', 'mic'], ['file', 'Files', 'paperclip']];
const LABEL = Object.fromEntries(TYPES.map(([k, l, i]) => [k, [l, i]]));

export default {
  title: 'Search',
  async render(el, ctx) {
    const f = { q: ctx.query.q || '', type: ctx.query.type || 'all', category: ctx.query.category || '', tag: ctx.query.tag || '', from: ctx.query.from || '', to: ctx.query.to || '', favorite: ctx.query.favorite === '1', archived: ctx.query.archived ?? '' };
    el.innerHTML = String(html`
      <div class="page-head"><div><h1>Search</h1><p>Find anything across notes, tasks, meetings, calendar, mind maps, flowcharts, audio and files.</p></div></div>
      <div class="card card-pad mb-3">
        <div class="input-icon mb-2">${icon('search')}<input class="input" style="height:48px;font-size:16px" type="search" placeholder="Type to search…" value="${f.q}" data-q autofocus></div>
        <div class="chips mb-2">${TYPES.map(([k, l, i]) => html`<button class="chip ${f.type === k ? 'active' : ''}" data-type="${k}">${icon(i, 'sm')} ${l}</button>`)}</div>
        <div class="row wrap" style="gap:10px">
          <select class="select sm" style="width:auto" data-f="category"><option value="">Any category</option>${state.categories.note.map((c) => html`<option value="${c.id}" ${String(c.id) === f.category ? 'selected' : ''}>${c.name}</option>`)}</select>
          <select class="select sm" style="width:auto" data-f="tag"><option value="">Any tag</option>${state.tags.map((t) => html`<option value="${t.name}" ${t.name === f.tag ? 'selected' : ''}>#${t.name}</option>`)}</select>
          <label class="row small" style="gap:6px">From <input class="input sm" type="date" style="width:auto" data-f="from" value="${f.from}"></label>
          <label class="row small" style="gap:6px">To <input class="input sm" type="date" style="width:auto" data-f="to" value="${f.to}"></label>
          <label class="check small"><input type="checkbox" data-f="favorite" ${f.favorite ? 'checked' : ''}> Favorites</label>
          <select class="select sm" style="width:auto" data-f="archived"><option value="">Archived: any</option><option value="0" ${f.archived === '0' ? 'selected' : ''}>Not archived</option><option value="1" ${f.archived === '1' ? 'selected' : ''}>Archived only</option></select>
        </div>
      </div>
      <div data-results></div>`);
    const results = el.querySelector('[data-results]');
    let ctrl;
    async function run() {
      setQuery({ q: f.q, type: f.type !== 'all' ? f.type : '', category: f.category, tag: f.tag, from: f.from, to: f.to, favorite: f.favorite ? '1' : '', archived: f.archived });
      if (!f.q && !f.tag && !f.category && !f.favorite && !f.from && f.archived === '') {
        results.innerHTML = String(empty({ icon: 'search', title: 'Start typing to search', text: 'Results update as you type. Use filters to narrow down by type, category, tag or date.' }));
        return;
      }
      results.innerHTML = '<div style="padding:40px;text-align:center"><span class="spinner"></span></div>';
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const r = await api.get('search', { q: f.q, type: f.type, category: f.category, tag: f.tag, from: f.from, to: f.to, favorite: f.favorite ? 1 : '', archived: f.archived, limit: f.type === 'all' ? 10 : 50 }, { signal: ctrl.signal });
        const groups = Object.entries(r.groups);
        const count = groups.reduce((s, [, l]) => s + l.length, 0);
        results.innerHTML = count ? String(html`<p class="small muted mb-2">${count} result${count === 1 ? '' : 's'}</p>${groups.map(([type, list]) => html`
          <div class="card mb-3"><div class="card-head"><h3>${icon(LABEL[type]?.[1] || 'file', 'sm')} ${LABEL[type]?.[0] || type} <span class="subtle small">${list.length}</span></h3>
            ${f.type === 'all' && list.length >= 10 ? html`<button class="btn ghost sm" data-type="${type}">Show all</button>` : ''}</div>
          <div class="card-body list">${list.map((x) => html`<a class="list-item" href="${x.link}"><span class="li-icon">${icon(LABEL[type]?.[1] || 'file', 'sm')}</span>
            <div class="li-main"><div class="li-title">${highlight(x.title, f.q)}</div>${x.snippet ? html`<div class="li-sub">${highlight(x.snippet, f.q)}</div>` : ''}</div>
            <div class="row hide-sm" style="gap:6px">${(x.meta || []).map((m) => html`<span class="badge" style="text-transform:capitalize">${m}</span>`)}</div>
            ${x.date ? html`<span class="tiny subtle nowrap">${fmtDay(x.date)}</span>` : ''}</a>`)}</div></div>`)}`)
          : String(empty({ icon: 'search-x', title: 'No results', text: 'Try different keywords or remove some filters.' }));
      } catch (e) { if (e.name !== 'AbortError') toastError(e); }
    }
    const deb = debounce(run, 280);
    el.querySelector('[data-q]').addEventListener('input', (e) => { f.q = e.target.value.trim(); deb(); });
    el.addEventListener('change', (e) => {
      const k = e.target.dataset.f;
      if (!k) return;
      f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      run();
    });
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-type]');
      if (!t) return;
      f.type = t.dataset.type;
      el.querySelectorAll('.chips [data-type]').forEach((c) => c.classList.toggle('active', c.dataset.type === f.type));
      run();
    });
    run();
  },
};
