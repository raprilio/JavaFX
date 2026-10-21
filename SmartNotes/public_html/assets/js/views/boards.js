// Shared list page for mind maps and flowcharts.
// v1.26 flowcharts: pin to the top for me (anyone), for everyone or for chosen people (administrators, own flowcharts).
import { html, icon, timeAgo, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { openPinPeople } from '../components/pinPeople.js';
import { navigate } from '../core/router.js';
import { toast, toastError, menu, confirm, prompt, empty, contextMenu } from '../core/ui.js';
import { newMindmap, newFlowchart } from '../core/actions.js';
import { openItemShare, leaveShared } from '../components/itemShare.js';

export function boardsView(kind) {
  const cfg = kind === 'mindmap'
    ? { route: 'mindmaps', type: 'mindmap', title: 'Mind Maps', icon: 'network', color: '#eab308', create: newMindmap, sub: 'Brainstorm visually and organise ideas into connected topics.', emptyText: 'Start from a central topic and branch out with children and siblings.' }
    : { route: 'flowcharts', type: 'flowchart', pins: true, title: 'Flowcharts', icon: 'workflow', color: '#0ea5e9', create: newFlowchart, sub: 'Design processes with start/end, process, decision, input/output, database and document shapes.', emptyText: 'Drag shapes onto the canvas and connect them to map out any process.' };
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
          paint();
        } catch (e) { toastError(e); }
      }
      const card = (m) => html`<a class="card hoverable bd-item ${m.pinned_global ? 'pin-global' : m.pinned_for_me ? 'pin-forme' : ''}" href="#/${cfg.route}/${m.id}" data-id="${m.id}" style="color:inherit;text-decoration:none;overflow:hidden">
            <div style="height:96px;display:grid;place-items:center;background:linear-gradient(135deg, ${cfg.color}22, ${cfg.color}08);color:${cfg.color}">${icon(cfg.icon, 'xl')}</div>
            <div class="card-pad" style="padding:14px 16px"><div class="row between"><b class="truncate">${m.title}</b><span class="row" style="gap:2px">${cfg.pins ? html`<button class="btn ghost icon xs board-pin ${m.pinned ? 'on' : ''}" data-pin aria-label="${m.pinned ? 'Unpin' : 'Pin'}" data-tip="${m.pinned ? 'Unpin' : 'Pin to top (only me)'}">${icon(m.pinned ? 'pin-off' : 'pin', 'sm')}</button>` : ''}<button class="btn ghost icon xs" data-more aria-label="More">${icon('more-vertical', 'sm')}</button></span></div>
              <div class="small subtle truncate">${m.description || (kind === 'mindmap' ? `${m.node_count} topics` : `${m.node_count} shapes · ${m.edge_count} connectors`)}</div>
              <div class="row mt-1" style="gap:6px;flex-wrap:wrap"><span class="tiny subtle">${icon('clock', 'sm')} Edited ${timeAgo(m.updated_at)}</span>
                ${m.pinned_global ? html`<span class="badge warning bc-global">${icon('megaphone', 'sm')} ${m.pinned_global_by || 'Admin'} · for everyone</span>` : ''}
                ${!m.pinned_global && m.pinned_for_me ? html`<span class="badge accent bc-forme">${icon('user-check', 'sm')} ${m.pinned_for_me_by || 'Admin'} · for you</span>` : ''}
                ${m.pin_target_count ? html`<span class="badge accent bc-people" data-tip="Pinned for ${m.pin_target_count} ${m.pin_target_count === 1 ? 'person' : 'people'}">${icon('user-check', 'sm')} ${m.pin_target_count}</span>` : ''}
                ${m.shared ? html`<span class="badge info">${icon('user', 'sm')} ${m.owner_name} · ${m.access === 'edit' ? 'can edit' : 'view'}</span>` : m.share_count ? html`<span class="badge info" data-tip="Shared with ${m.share_count}">${icon('users', 'sm')} ${m.share_count}</span>` : ''}</div></div></a>`;
      function paint() {
        if (!items.length) {
          list.innerHTML = String(html`<div style="grid-column:1/-1">${empty({ icon: cfg.icon, title: q ? 'Nothing found' : `No ${cfg.title.toLowerCase()} yet`, text: cfg.emptyText, action: `<button class="btn primary" data-act="new">Create ${kind === 'mindmap' ? 'a mind map' : 'a flowchart'}</button>` })}</div>`);
          return;
        }
        const by = (k) => (a, b) => String(b[k] || '').localeCompare(String(a[k] || '')); // newest pin first
        const global = items.filter((m) => m.pinned_global).sort(by('pinned_global_at'));
        const forMe = items.filter((m) => !m.pinned_global && m.pinned_for_me).sort(by('pinned_for_me_at'));
        const mine = items.filter((m) => !m.pinned_global && !m.pinned_for_me && m.pinned).sort(by('pinned_at'));
        const rest = items.filter((m) => !m.pinned_global && !m.pinned_for_me && !m.pinned);
        const secs = [['global', 'megaphone', 'Pinned by admin — for everyone', global], ['people', 'user-check', 'Pinned by admin — for you', forMe], ['mine', 'pin', 'Pinned by me', mine],
          ['rest', cfg.icon, `Other ${cfg.title.toLowerCase()}`, rest]].filter((x) => x[3].length);
        list.innerHTML = secs.length > 1 || secs[0][0] !== 'rest'
          ? secs.map(([k, ic, label, arr]) => `<div class="board-sec-head ${k}">${icon(ic, 'sm')} ${label} <span class="subtle">${arr.length}</span></div>${arr.map((m) => String(card(m))).join('')}`).join('')
          : rest.map((m) => String(card(m))).join('');
      }
      async function pin(m, scope, on) {
        try {
          const r = await api.post(`pins/${cfg.type}/${m.id}`, { scope, pinned: on });
          Object.assign(m, r);
          paint();
          toast(on ? (scope === 'me' ? 'Pinned to the top of your list' : 'Pinned for everyone') : 'Unpinned', 'success', { timeout: 1600 });
        } catch (e) { toastError(e); }
      }
      async function pinPeople(m) {
        const full = await api.get(`${cfg.route}/${m.id}`).catch(toastError);
        if (!full) return;
        const r = await openPinPeople({ title: 'Pin for people', itemTitle: m.title, what: cfg.title.toLowerCase(), current: full.pins?.pin_targets || [],
          suggested: (full.shares || []).map((x) => ({ id: x.user_id, name: x.name, email: x.email })), suggestedLabel: 'Everyone it is shared with', prefill: false,
          save: (ids) => api.post(`pins/${cfg.type}/${m.id}/people`, { user_ids: ids }) });
        if (r) { Object.assign(m, r); paint(); }
      }
      /** Pin entries of the ⋯ menu (v1.26). */
      const pinItems = (m) => (!cfg.pins ? [] : [
        { label: m.pinned ? 'Unpin (only me)' : 'Pin to top (only me)', icon: 'pin', onClick: () => pin(m, 'me', !m.pinned) },
        ...(state.user.role === 'admin' && !m.shared ? [
          { label: m.pinned_global ? 'Unpin for everyone' : 'Pin for everyone', icon: 'megaphone', onClick: async () => {
            if (!m.pinned_global && !(await confirm({ title: 'Pin for everyone?', message: `"${m.title}" appears pinned at the top of every user's ${cfg.title.toLowerCase()} (view only for them) and they get a notification.`, confirmText: 'Pin for everyone', danger: false, icon: 'megaphone' }))) return;
            pin(m, 'everyone', !m.pinned_global);
          } },
          { label: m.pin_target_count ? `Pinned for people (${m.pin_target_count})…` : 'Pin for people…', icon: 'user-check', onClick: () => pinPeople(m) },
        ] : []),
      ]);
      function moreMenu(anchor, m) {
        if (m.shared) {
          const shared = [
            { label: 'Open', icon: 'square-arrow-out-up-right', onClick: () => navigate(`/${cfg.route}/${m.id}`) },
            ...pinItems(m),
            { label: 'Make a copy', icon: 'copy', onClick: async () => { const r = await api.post(`${cfg.route}/${m.id}/duplicate`).catch(toastError); if (r) { toast('Copied to your account', 'success'); navigate(`/${cfg.route}/${r.id}`); } } },
            ...(m.in_shares === false ? [] : [{ divider: true },
              { label: 'Remove from my list', icon: 'log-out', danger: true, onClick: async () => { try { await leaveShared(cfg.type, m.id); load(); } catch (e) { toastError(e); } } }]),
          ];
          return anchor instanceof Event ? contextMenu(anchor, shared) : menu(anchor, shared, { align: 'end' });
        }
        const items2 = [
          { label: 'Share…', icon: 'users', onClick: async () => { if ((await openItemShare({ type: cfg.type, id: m.id, title: m.title })) !== null) load(); } },
          { label: 'Open', icon: 'square-arrow-out-up-right', onClick: () => navigate(`/${cfg.route}/${m.id}`) },
          ...pinItems(m),
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
        const pb = e.target.closest('[data-pin]');
        if (pb) {
          e.preventDefault();
          const m = items.find((x) => x.id === +pb.closest('[data-id]').dataset.id);
          return pin(m, 'me', !m.pinned);
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
