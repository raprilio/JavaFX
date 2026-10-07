// Shared list page for mind maps and flowcharts.
import { html, icon, timeAgo, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { navigate } from '../core/router.js';
import { toast, toastError, menu, confirm, prompt, empty, contextMenu } from '../core/ui.js';
import { newMindmap, newFlowchart } from '../core/actions.js';
import { openItemShare, leaveShared } from '../components/itemShare.js';

export function boardsView(kind) {
  const cfg = kind === 'mindmap'
    ? { route: 'mindmaps', type: 'mindmap', title: 'Mind Maps', icon: 'network', color: '#eab308', create: newMindmap, sub: 'Brainstorm visually and organise ideas into connected topics.', emptyText: 'Start from a central topic and branch out with children and siblings.' }
    : { route: 'flowcharts', type: 'flowchart', title: 'Flowcharts', icon: 'workflow', color: '#0ea5e9', create: newFlowchart, sub: 'Design processes with start/end, process, decision, input/output, database and document shapes.', emptyText: 'Drag shapes onto the canvas and connect them to map out any process.' };
  return {
    title: cfg.title,
    async render(el, ctx) {
      let items = [];
      let q = '';
      let scope = ['mine', 'shared'].includes(ctx?.query?.scope) ? ctx.query.scope : '';
      el.innerHTML = String(html`
        <div class="page-head"><div><h1>${cfg.title}</h1><p>${cfg.sub}</p></div><button class="btn primary" data-act="new">${icon('plus', 'sm')} New ${kind === 'mindmap' ? 'mind map' : 'flowchart'}</button></div>
        <div class="toolbar"><div class="chips">${[['', 'All', cfg.icon], ['mine', 'Mine', 'user'], ['shared', 'Shared with me', 'users']].map(([v, l, i]) => html`<button class="chip ${scope === v ? 'active' : ''}" data-scope="${v}">${icon(i, 'sm')} ${l}</button>`)}</div>
          <div class="grow"></div><div class="input-icon" style="width:min(300px,100%)">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search…" data-search></div></div>
        <div class="grid grid-auto" data-list>${Array.from({ length: 4 }, () => html`<div class="skeleton" style="height:170px;border-radius:18px"></div>`)}</div>`);
      const list = el.querySelector('[data-list]');
      async function load() {
        try {
          items = await api.get(cfg.route, { q, scope });
          list.innerHTML = items.length ? items.map((m) => String(html`<a class="card hoverable" href="#/${cfg.route}/${m.id}" data-id="${m.id}" style="color:inherit;text-decoration:none;overflow:hidden">
            <div style="height:96px;display:grid;place-items:center;background:linear-gradient(135deg, ${cfg.color}22, ${cfg.color}08);color:${cfg.color}">${icon(cfg.icon, 'xl')}</div>
            <div class="card-pad" style="padding:14px 16px"><div class="row between"><b class="truncate">${m.title}</b><button class="btn ghost icon xs" data-more aria-label="More">${icon('more-vertical', 'sm')}</button></div>
              <div class="small subtle truncate">${m.description || (kind === 'mindmap' ? `${m.node_count} topics` : `${m.node_count} shapes · ${m.edge_count} connectors`)}</div>
              <div class="row mt-1" style="gap:6px;flex-wrap:wrap"><span class="tiny subtle">${icon('clock', 'sm')} Edited ${timeAgo(m.updated_at)}</span>
                ${m.shared ? html`<span class="badge info">${icon('user', 'sm')} ${m.owner_name} · ${m.access === 'edit' ? 'can edit' : 'view'}</span>` : m.share_count ? html`<span class="badge info" data-tip="Shared with ${m.share_count}">${icon('users', 'sm')} ${m.share_count}</span>` : ''}</div></div></a>`)).join('')
            : String(html`<div style="grid-column:1/-1">${empty({ icon: cfg.icon, title: q ? 'Nothing found' : `No ${cfg.title.toLowerCase()} yet`, text: cfg.emptyText, action: `<button class="btn primary" data-act="new">Create ${kind === 'mindmap' ? 'a mind map' : 'a flowchart'}</button>` })}</div>`);
        } catch (e) { toastError(e); }
      }
      function moreMenu(anchor, m) {
        if (m.shared) {
          const shared = [
            { label: 'Open', icon: 'square-arrow-out-up-right', onClick: () => navigate(`/${cfg.route}/${m.id}`) },
            { label: 'Make a copy', icon: 'copy', onClick: async () => { const r = await api.post(`${cfg.route}/${m.id}/duplicate`).catch(toastError); if (r) { toast('Copied to your account', 'success'); navigate(`/${cfg.route}/${r.id}`); } } },
            { divider: true },
            { label: 'Remove from my list', icon: 'log-out', danger: true, onClick: async () => { try { await leaveShared(cfg.type, m.id); load(); } catch (e) { toastError(e); } } },
          ];
          return anchor instanceof Event ? contextMenu(anchor, shared) : menu(anchor, shared, { align: 'end' });
        }
        const items2 = [
          { label: 'Share…', icon: 'users', onClick: async () => { if ((await openItemShare({ type: cfg.type, id: m.id, title: m.title })) !== null) load(); } },
          { label: 'Open', icon: 'square-arrow-out-up-right', onClick: () => navigate(`/${cfg.route}/${m.id}`) },
          { label: 'Rename', icon: 'pencil', onClick: async () => {
            const t = await prompt({ title: 'Rename', value: m.title });
            if (t) { await api.post(`${cfg.route}/${m.id}`, { title: t }).catch(toastError); load(); }
          } },
          { label: 'Duplicate', icon: 'copy', onClick: async () => { await api.post(`${cfg.route}/${m.id}/duplicate`).catch(toastError); toast('Duplicated', 'success'); load(); } },
          { divider: true },
          { label: 'Move to trash', icon: 'trash-2', danger: true, onClick: async () => {
            if (!(await confirm({ title: 'Delete?', message: `"${m.title}" will be moved to the trash.`, confirmText: 'Delete' }))) return;
            await api.post(`items/${cfg.type}/${m.id}/trash`).catch(toastError);
            toast('Moved to trash', 'success', { action: 'Undo', onAction: () => api.post(`items/${cfg.type}/${m.id}/restore`).then(load) });
            load();
          } },
        ];
        return anchor instanceof Event ? contextMenu(anchor, items2) : menu(anchor, items2, { align: 'end' });
      }
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-act="new"]')) return cfg.create();
        const sc = e.target.closest('[data-scope]');
        if (sc) {
          scope = sc.dataset.scope;
          el.querySelectorAll('[data-scope]').forEach((c) => c.classList.toggle('active', c === sc));
          return load();
        }
        const more = e.target.closest('[data-more]');
        if (more) {
          e.preventDefault();
          const m = items.find((x) => x.id === +more.closest('[data-id]').dataset.id);
          moreMenu(more, m);
        }
      });
      el.addEventListener('contextmenu', (e) => {
        const c = e.target.closest('[data-id]');
        if (c) moreMenu(e, items.find((x) => x.id === +c.dataset.id));
      });
      const search = debounce(load, 300);
      el.querySelector('[data-search]').addEventListener('input', (e) => { q = e.target.value.trim(); search(); });
      await load();
    },
  };
}
