// Admin mailbox (Hostinger Mail API): folders, message list, reader with sandboxed HTML, compose / reply / forward,
// attachments preview and "Save to Drive".
import { html, icon, h, fmtBytes, debounce, initials } from '../core/dom.js';
import { api, url as apiUrl } from '../core/api.js';
import { state } from '../core/store.js';
import { setQuery, navigate } from '../core/router.js';
import { toast, toastError, menu, confirm, modal, empty, withLoading } from '../core/ui.js';
import { openFilePreview } from '../components/filePreview.js';
import { tagInput, normalizeTag } from '../components/tagInput.js';
import { folderOptions } from './drive.js';
import { mailSettingsPanel } from '../components/mailConnections.js';

const SPECIAL = { '\\Sent': ['send', 'Sent'], '\\Drafts': ['file-pen', 'Drafts'], '\\Junk': ['octagon-alert', 'Spam'], '\\Trash': ['trash-2', 'Trash'], '\\Archive': ['archive', 'Archive'] };
const POLL_MS = 120000;

const folderIcon = (f) => (f.path.toUpperCase() === 'INBOX' ? 'inbox' : SPECIAL[f.special]?.[0] || 'folder');
const folderLabel = (f) => (f.path.toUpperCase() === 'INBOX' ? 'Inbox' : SPECIAL[f.special]?.[1] || f.name);
const who = (a) => (a ? a.name || a.address : '');
const fullAddr = (a) => (a ? (a.name ? `${a.name} <${a.address}>` : a.address) : '');

function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' });
}
const longDate = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function attIcon(a) {
  if (a.type.startsWith('image/')) return 'image';
  if (a.type === 'application/pdf') return 'file-text';
  if (a.type.startsWith('audio/')) return 'music';
  return 'paperclip';
}
const previewable = (a) => /^image\/(png|jpe?g|gif|webp)$/i.test(a.type) || a.type === 'application/pdf';

export default {
  title: 'Mail',
  async render(el, ctx) {
    ctx.setTitle('Mail');
    if (state.user.role !== 'admin') {
      el.innerHTML = String(empty({ icon: 'shield-alert', title: 'Administrators only', text: 'The company mailbox can only be opened by users with the Admin role.' }));
      return;
    }
    let status = null;
    const s = { mailbox: ctx.query.mailbox || '', folder: ctx.query.folder || 'INBOX', page: 1, q: '', flagged: false };
    let folders = [];
    let quota = null;
    let list = { items: [], total: 0, pages: 1, page: 1 };
    let open = null; // current message
    const selected = new Set();
    let timer = null;
    let listReq = 0;

    // ---------------------------------------------------------------- setup / connection
    async function boot() {
      el.innerHTML = '<div style="padding:60px;text-align:center"><span class="spinner"></span></div>';
      try { status = await api.get('mail/status'); } catch (e) { el.innerHTML = String(empty({ icon: 'alert-triangle', title: 'Could not load the mailbox', text: e.message })); return; }
      if (!status.configured || (!status.mailboxes.length && !status.error)) return renderSetup();
      const ids = status.mailboxes.map((m) => m.resourceId);
      if (!ids.includes(s.mailbox)) s.mailbox = ids.includes(status.default_mailbox) ? status.default_mailbox : ids[0] || '';
      renderShell();
      if (status.error) { setReader(html`<div class="mail-error">${icon('plug', 'lg')}<h3>Hostinger Mail API is not responding</h3><p>${status.error}</p><button class="btn" data-act="settings">${icon('settings-2', 'sm')} Mail settings & APIs</button></div>`); return; }
      await Promise.all([loadFolders(), loadList()]);
      timer = setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('.modal-root')) { loadFolders(true); loadList(true); } }, POLL_MS);
    }

    function renderSetup() {
      el.innerHTML = String(html`
        <div class="page-head"><div><h1>Mail</h1><p>Read and answer the company mailbox right inside ${state.branding?.app_name || 'SmartNotes'}.</p></div></div>
        <div class="card mail-setup">
          <div class="mail-setup-ic">${icon('mailbox', 'xl')}</div>
          <h2>Connect your Hostinger mailbox</h2>
          ${status.error ? html`<p class="mail-setup-err">${icon('alert-triangle', 'sm')} ${status.error}</p>` : ''}
          <div data-panel></div>
        </div>`);
      el.querySelector('[data-panel]').appendChild(mailSettingsPanel({
        status,
        onChange: (next) => { status = next; if (next.mailboxes.length) { s.mailbox = ''; boot(); } },
      }));
    }

    /** Mail → Settings: add / delete API connections, default mailbox, sender name. */
    async function openSettings() {
      let changed = false;
      const before = status.connections.map((c) => c.id).join();
      const body = mailSettingsPanel({ status, compact: false, onChange: (next) => { status = next; changed = true; } });
      await modal({ title: 'Mail settings', body, size: 'lg', className: 'mail-settings-modal', actions: [{ label: 'Done', variant: 'primary' }] }).result;
      if (!changed) return;
      if (status.connections.map((c) => c.id).join() !== before || !status.mailboxes.some((m) => m.resourceId === s.mailbox)) {
        s.mailbox = '';
        boot();
      }
    }

    // ---------------------------------------------------------------- layout
    /** Mailbox switcher options, grouped per API connection (domain) when there are several. */
    function mailboxOptions() {
      const opt = (m) => html`<option value="${m.resourceId}" ${m.resourceId === s.mailbox ? 'selected' : ''}>${m.address}</option>`;
      const conns = status.connections.filter((c) => status.mailboxes.some((m) => m.connection === c.id));
      if (conns.length < 2) return status.mailboxes.map(opt);
      return conns.map((c) => html`<optgroup label="${c.label}">${status.mailboxes.filter((m) => m.connection === c.id).map(opt)}</optgroup>`);
    }

    function renderShell() {
      const multi = status.mailboxes.length > 1;
      el.innerHTML = String(html`
        <div class="mail" data-state="list">
          <aside class="mail-side">
            ${multi ? html`<select class="select sm" data-mailbox aria-label="Mailbox">${mailboxOptions()}</select>`
              : html`<div class="mail-addr truncate" title="${status.mailboxes[0]?.address || ''}">${icon('at-sign', 'sm')} ${status.mailboxes[0]?.address || ''}</div>`}
            <button class="btn primary block" data-act="compose">${icon('pencil-line', 'sm')} Compose</button>
            <nav class="mail-folders" data-folders></nav>
            <div class="mail-quota" data-quota></div>
            ${status.connections.some((c) => c.error) ? html`<button class="mail-conn bad small" data-act="settings" style="border:0;cursor:pointer;text-align:left">${icon('unplug', 'sm')} ${status.connections.filter((c) => c.error).length} API connection needs attention</button>` : ''}
          </aside>
          <section class="mail-list">
            <div class="mail-list-bar">
              <select class="select sm mail-folder-select" data-folder-select aria-label="Folder"></select>
              <div class="input-icon grow">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search mail… (from:, subject:)" data-search></div>
              <button class="btn ghost icon sm ${s.flagged ? 'active' : ''}" data-act="flagged" data-tip="Starred only" aria-label="Starred only">${icon('star', 'sm')}</button>
              <button class="btn ghost icon sm" data-act="refresh" data-tip="Refresh" aria-label="Refresh">${icon('refresh-cw', 'sm')}</button>
              <button class="btn ghost icon sm" data-act="settings" data-tip="Mail settings & APIs" aria-label="Mail settings">${icon('settings-2', 'sm')}</button>
            </div>
            <div class="mail-bulk hidden" data-bulk></div>
            <div class="mail-rows" data-rows></div>
            <div class="mail-pager" data-pager></div>
          </section>
          <section class="mail-read" data-read></section>
        </div>`);
      setReader(null);
    }
    const $ = (sel) => el.querySelector(sel);
    const mailEl = () => $('.mail');

    function setReader(content) {
      const r = $('[data-read]');
      if (!r) return;
      if (!content) {
        r.innerHTML = String(html`<div class="mail-read-empty">${icon('mail-open', 'xl')}<p>Select a message to read it</p></div>`);
        mailEl()?.setAttribute('data-state', 'list');
        return;
      }
      r.innerHTML = String(content);
    }

    // ---------------------------------------------------------------- folders
    async function loadFolders(quiet = false) {
      try {
        const r = await api.get('mail/folders', { mailbox: s.mailbox });
        folders = r.items;
        quota = r.quota;
        renderFolders();
      } catch (e) { if (!quiet) toastError(e); }
    }
    function renderFolders() {
      const nav = $('[data-folders]');
      if (!nav) return;
      nav.innerHTML = String(html`${folders.map((f) => html`<button class="mail-folder ${f.path === s.folder ? 'active' : ''}" data-folder="${f.path}" data-special="${f.special || ''}">
        ${icon(folderIcon(f), 'sm')}<span class="grow truncate">${folderLabel(f)}</span>${f.unread ? html`<span class="count">${f.unread}</span>` : ''}</button>`)}`);
      $('[data-folder-select]').innerHTML = String(html`${folders.map((f) => html`<option value="${f.path}" ${f.path === s.folder ? 'selected' : ''}>${folderLabel(f)}${f.unread ? ` (${f.unread})` : ''}</option>`)}`);
      const q = $('[data-quota]');
      q.innerHTML = quota ? String(html`<div class="small subtle">${fmtBytes(quota.used)} of ${fmtBytes(quota.limit)} used</div><div class="progress"><span style="width:${Math.min(100, quota.percent)}%"></span></div>`) : '';
      const inbox = folders.find((f) => f.path.toUpperCase() === 'INBOX');
      const navCount = document.querySelector('.sidebar .nav-item[data-path="/mail"] .count');
      if (navCount) navCount.textContent = inbox?.unread || '';
    }
    const currentFolder = () => folders.find((f) => f.path === s.folder);
    const trashFolder = () => folders.find((f) => f.special === '\\Trash');
    const inTrashOrJunk = () => ['\\Trash', '\\Junk'].includes(currentFolder()?.special);
    const isSentLike = () => ['\\Sent', '\\Drafts'].includes(currentFolder()?.special);

    // ---------------------------------------------------------------- list
    async function loadList(quiet = false) {
      const rows = $('[data-rows]');
      if (!rows) return;
      const req = ++listReq;
      if (!quiet) rows.innerHTML = String(html`${Array.from({ length: 8 }, () => html`<div class="mail-row skel"><span class="skeleton" style="width:40%"></span><span class="skeleton" style="width:80%"></span></div>`)}`);
      try {
        const r = await api.get('mail/messages', { mailbox: s.mailbox, folder: s.folder, page: s.page, q: s.q, flagged: s.flagged ? 1 : '' });
        if (req !== listReq) return;
        list = r;
        renderList();
      } catch (e) {
        if (req !== listReq) return;
        if (!quiet) rows.innerHTML = String(empty({ icon: 'alert-triangle', title: 'Could not load messages', text: e.message }));
      }
    }
    function renderList() {
      const rows = $('[data-rows]');
      selected.forEach((u) => { if (!list.items.some((m) => m.uid === u)) selected.delete(u); });
      if (!list.items.length) {
        rows.innerHTML = String(empty({ icon: s.q ? 'search' : 'inbox', title: s.q ? 'No messages found' : 'This folder is empty', text: s.q ? 'Try other words, or search with from: or subject:' : '' }));
      } else {
        rows.innerHTML = String(html`${list.items.map((m) => html`<div class="mail-row ${m.unseen ? 'unseen' : ''} ${open?.uid === m.uid && open?.folder === s.folder ? 'active' : ''} ${selected.has(m.uid) ? 'selected' : ''}" data-uid="${m.uid}" tabindex="0">
          <label class="mail-check" data-stop><input type="checkbox" data-pick ${selected.has(m.uid) ? 'checked' : ''} aria-label="Select"></label>
          <button class="mail-star ${m.flagged ? 'on' : ''}" data-star aria-label="Star">${icon('star', 'sm')}</button>
          <div class="mail-row-main">
            <div class="mail-row-top"><span class="mail-from truncate">${isSentLike() ? 'To: ' + (m.to.map(who).join(', ') || '—') : who(m.from) || '(unknown sender)'}</span>${m.answered ? icon('reply', 'xs') : ''}<span class="mail-date">${shortDate(m.date)}</span></div>
            <div class="mail-row-sub"><span class="truncate">${m.subject || '(no subject)'}</span>${m.has_attachments ? icon('paperclip', 'xs') : ''}</div>
          </div></div>`)}`);
      }
      const from = list.total ? (list.page - 1) * list.per_page + 1 : 0;
      $('[data-pager]').innerHTML = String(html`<span class="small subtle">${list.total ? `${from}–${from + list.items.length - 1} of ${list.total}` : ''}</span>
        <button class="btn ghost icon sm" data-page="-1" ${list.page <= 1 ? 'disabled' : ''} aria-label="Newer">${icon('chevron-left', 'sm')}</button>
        <button class="btn ghost icon sm" data-page="1" ${list.page >= list.pages ? 'disabled' : ''} aria-label="Older">${icon('chevron-right', 'sm')}</button>`);
      renderBulk();
    }
    function renderBulk() {
      const b = $('[data-bulk]');
      b.classList.toggle('hidden', !selected.size);
      if (!selected.size) return;
      b.innerHTML = String(html`<label class="check small"><input type="checkbox" data-all ${selected.size === list.items.length ? 'checked' : ''}> ${selected.size} selected</label>
        <div class="grow"></div>
        <button class="btn ghost sm" data-bulk-act="read">${icon('mail-open', 'sm')}<span class="hide-sm">Read</span></button>
        <button class="btn ghost sm" data-bulk-act="unread">${icon('mail', 'sm')}<span class="hide-sm">Unread</span></button>
        <button class="btn ghost sm" data-bulk-act="move">${icon('folder-input', 'sm')}<span class="hide-sm">Move</span></button>
        <button class="btn ghost sm danger" data-bulk-act="delete">${icon('trash-2', 'sm')}<span class="hide-sm">Delete</span></button>`);
    }

    // ---------------------------------------------------------------- actions
    async function setFlags(uids, add = [], remove = [], folder = s.folder) {
      await api.post('mail/flags', { mailbox: s.mailbox, folder, uids, add, remove });
      list.items.forEach((m) => {
        if (!uids.includes(m.uid)) return;
        if (add.includes('\\Seen')) m.unseen = false;
        if (remove.includes('\\Seen')) m.unseen = true;
        if (add.includes('\\Flagged')) m.flagged = true;
        if (remove.includes('\\Flagged')) m.flagged = false;
      });
      if (open && uids.includes(open.uid)) {
        if (add.includes('\\Flagged')) open.flagged = true;
        if (remove.includes('\\Flagged')) open.flagged = false;
      }
      renderList();
      loadFolders(true);
    }
    async function moveTo(uids, target) {
      await api.post('mail/move', { mailbox: s.mailbox, folder: s.folder, uids, target });
      const f = folders.find((x) => x.path === target);
      toast(`${uids.length === 1 ? 'Message' : uids.length + ' messages'} moved to ${f ? folderLabel(f) : target}`, 'success');
      afterRemove(uids);
    }
    async function remove(uids) {
      const trash = trashFolder();
      if (trash && !inTrashOrJunk()) return moveTo(uids, trash.path);
      if (!(await confirm({ title: `Delete ${uids.length === 1 ? 'this message' : uids.length + ' messages'} forever?`, message: 'Messages deleted from Trash or Spam cannot be recovered.', confirmText: 'Delete forever' }))) return;
      await api.post('mail/delete', { mailbox: s.mailbox, folder: s.folder, uids });
      toast('Deleted', 'success');
      afterRemove(uids);
    }
    function afterRemove(uids) {
      uids.forEach((u) => selected.delete(u));
      if (open && uids.includes(open.uid)) { open = null; setReader(null); }
      loadList(true);
      loadFolders(true);
    }
    function moveMenu(anchor, uids) {
      return menu(anchor, [{ title: 'Move to' }, ...folders.filter((f) => f.path !== s.folder).map((f) => ({ label: folderLabel(f), icon: folderIcon(f), onClick: () => moveTo(uids, f.path).catch(toastError) }))], { align: 'end' });
    }

    // ---------------------------------------------------------------- reader
    async function openMessage(uid) {
      mailEl()?.setAttribute('data-state', 'read');
      setReader(html`<div style="padding:60px;text-align:center"><span class="spinner"></span></div>`);
      const folder = s.folder;
      try {
        const m = await api.get('mail/message', { mailbox: s.mailbox, folder, uid });
        if (s.folder !== folder) return;
        open = { ...m, folder };
        const row = list.items.find((x) => x.uid === uid);
        if (row && row.unseen) { row.unseen = false; loadFolders(true); }
        renderList();
        renderReader();
      } catch (e) {
        setReader(html`<div class="mail-error">${icon('alert-triangle', 'lg')}<h3>Could not open the message</h3><p>${e.message}</p></div>`);
      }
    }
    function renderReader(showImages = false) {
      const m = open;
      const files = m.attachments.filter((a) => !a.inline);
      setReader(html`
        <div class="mail-read-bar">
          <button class="btn ghost icon sm mail-back" data-act="back" aria-label="Back to list">${icon('arrow-left', 'sm')}</button>
          <button class="btn ghost sm" data-r="reply">${icon('reply', 'sm')}<span class="hide-sm">Reply</span></button>
          <button class="btn ghost sm" data-r="replyall">${icon('reply-all', 'sm')}<span class="hide-sm">Reply all</span></button>
          <button class="btn ghost sm" data-r="forward">${icon('forward', 'sm')}<span class="hide-sm">Forward</span></button>
          <div class="grow"></div>
          <button class="btn ghost icon sm mail-star ${m.flagged ? 'on' : ''}" data-r="star" data-tip="Star" aria-label="Star">${icon('star', 'sm')}</button>
          <button class="btn ghost icon sm" data-r="unread" data-tip="Mark as unread" aria-label="Mark as unread">${icon('mail', 'sm')}</button>
          <button class="btn ghost icon sm" data-r="move" data-tip="Move" aria-label="Move">${icon('folder-input', 'sm')}</button>
          <button class="btn ghost icon sm" data-r="delete" data-tip="${inTrashOrJunk() || !trashFolder() ? 'Delete forever' : 'Move to Trash'}" aria-label="Delete">${icon('trash-2', 'sm')}</button>
          <button class="btn ghost icon sm" data-r="more" aria-label="More">${icon('ellipsis-vertical', 'sm')}</button>
        </div>
        <div class="mail-read-scroll">
          <h2 class="mail-subject">${m.subject || '(no subject)'}</h2>
          <div class="mail-meta">
            <span class="avatar">${initials(who(m.from) || '?')}</span>
            <div class="grow" style="min-width:0">
              <div><b>${m.from?.name || m.from?.address || '(unknown sender)'}</b> ${m.from?.name ? html`<span class="subtle small">&lt;${m.from.address}&gt;</span>` : ''}</div>
              <div class="small subtle truncate" title="${m.to.map(fullAddr).join(', ')}">to ${m.to.map(who).join(', ') || '—'}${m.cc.length ? html` · cc ${m.cc.map(who).join(', ')}` : ''}</div>
            </div>
            <span class="small subtle mail-when">${longDate(m.date)}</span>
          </div>
          ${m.remote_images && !showImages ? html`<div class="mail-remote">${icon('eye-off', 'sm')}<span class="grow">Remote images are blocked to protect your privacy (tracking pixels).</span><button class="btn sm" data-r="images">Show images</button></div>` : ''}
          ${files.length ? html`<div class="mail-atts">${files.map((a) => html`<div class="mail-att" data-att="${a.id}">
              <button class="mail-att-main" data-att-open title="${a.name}">${icon(attIcon(a), 'sm')}<span class="truncate">${a.name}</span><span class="subtle tiny">${fmtBytes(a.size)}</span></button>
              <button class="btn ghost icon xs" data-att-menu aria-label="Attachment actions">${icon('ellipsis-vertical', 'sm')}</button></div>`)}</div>` : ''}
          <iframe class="mail-frame" title="Message" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>
        </div>`);
      const frame = $('.mail-frame');
      // scrollHeight never reports less than the frame's own height, so collapse it before measuring.
      const fit = () => {
        try {
          const doc = frame.contentDocument.documentElement;
          frame.style.height = '1px';
          frame.style.height = Math.max(120, doc.scrollHeight + 2) + 'px';
        } catch { /* keep the default height */ }
      };
      frame.addEventListener('load', () => {
        fit();
        // Images load after "load" for srcdoc; re-measure as they arrive.
        try { frame.contentDocument.querySelectorAll('img').forEach((img) => img.addEventListener('load', fit)); } catch { /* ignore */ }
      });
      if (showImages) frame.src = apiUrl('mail/html', { mailbox: s.mailbox, folder: m.folder, uid: m.uid });
      else frame.srcdoc = m.html_doc;
    }

    const attUrl = (a, dl = false) => apiUrl('mail/attachment', { mailbox: s.mailbox, folder: open.folder, uid: open.uid, id: a.id, dl: dl ? 1 : '' });
    function previewAttachment(a) {
      if (!previewable(a)) { window.location.href = attUrl(a, true); return; }
      const isImg = a.type.startsWith('image/');
      const imgs = open.attachments.filter((x) => !x.inline && /^image\//.test(x.type)).map((x) => ({ id: x.id, name: x.name, kind: 'image', preview: 'image', url: attUrl(x), download_url: attUrl(x, true) }));
      const file = { id: a.id, name: a.name, kind: isImg ? 'image' : 'document', preview: isImg ? 'image' : 'pdf', mime_type: a.type, url: attUrl(a), download_url: attUrl(a, true) };
      openFilePreview(file, isImg ? imgs : [file]);
    }
    async function saveToDrive(a) {
      let folders0 = [];
      try { folders0 = folderOptions(await api.get('drive/folders')); } catch { /* root only */ }
      const tags = tagInput({ value: [], suggestions: state.tags.map((t) => t.name), placeholder: 'Add tag, e.g. invoice', normalize: normalizeTag, prefix: '#' });
      const body = h(String(html`<div class="col" style="gap:14px">
        <div class="mail-att static">${icon(attIcon(a), 'sm')}<span class="truncate">${a.name}</span><span class="subtle tiny">${fmtBytes(a.size)}</span></div>
        <div class="field" style="margin:0"><label>Folder</label><select class="select" data-folder><option value="">My Drive (root)</option>${folders0.map((f) => html`<option value="${f.id}">${f.label}</option>`)}</select></div>
        <div class="field" style="margin:0"><label>Tags <span class="subtle small">— notes with the same tag will show this file</span></label><div data-tags></div></div>
      </div>`));
      body.querySelector('[data-tags]').appendChild(tags.el);
      modal({
        title: 'Save to Drive', body, size: 'sm',
        actions: [{ label: 'Cancel' }, { label: 'Save', variant: 'primary', icon: 'hard-drive-download', onClick: async () => {
          const r = await api.post('mail/save-to-drive', { mailbox: s.mailbox, folder: open.folder, uid: open.uid, id: a.id, folder_id: body.querySelector('[data-folder]').value || null, tags: tags.get() });
          toast('Saved to Drive', 'success', { action: 'Open', onAction: () => navigate(`/drive?open=${r.id}`) });
        } }],
      });
    }

    // ---------------------------------------------------------------- compose
    function compose(mode = 'new') {
      const m = open;
      const me = status.mailboxes.find((x) => x.resourceId === s.mailbox)?.address?.toLowerCase();
      let to = '';
      let cc = '';
      let subject = '';
      if (m && mode !== 'new') {
        const strip = (t) => (t || '').replace(/^((re|fwd?|aw|wg)\s*:\s*)+/i, '');
        subject = (mode === 'forward' ? 'Fwd: ' : 'Re: ') + strip(m.subject);
        if (mode === 'reply' || mode === 'replyall') to = m.from ? fullAddr(m.from) : '';
        if (mode === 'replyall') {
          const seen = new Set([me, m.from?.address?.toLowerCase()]);
          const add = (arr) => arr.filter((x) => x.address && !seen.has(x.address.toLowerCase()) && seen.add(x.address.toLowerCase()));
          to = [to, ...add(m.to).map(fullAddr)].filter(Boolean).join(', ');
          cc = add(m.cc).map(fullAddr).join(', ');
        }
      }
      const origFiles = m ? m.attachments.filter((a) => !a.inline) : [];
      const files = [];
      const driveFiles = [];
      const body = h(String(html`<form class="mail-compose" novalidate>
        <div class="mc-row"><label>From</label><select class="select sm" name="mailbox">${status.mailboxes.map((x) => html`<option value="${x.resourceId}" ${x.resourceId === s.mailbox ? 'selected' : ''}>${status.display_name ? `${status.display_name} <${x.address}>` : x.address}</option>`)}</select></div>
        <div class="mc-row"><label for="mc-to">To</label><input class="input sm" id="mc-to" name="to" value="${to}" placeholder="name@example.com, …" autocomplete="email" ${to ? '' : 'autofocus'}><button class="btn ghost xs" type="button" data-ccbcc ${cc ? 'hidden' : ''}>Cc/Bcc</button></div>
        <div class="mc-row ${cc ? '' : 'hidden'}" data-cc><label for="mc-cc">Cc</label><input class="input sm" id="mc-cc" name="cc" value="${cc}"></div>
        <div class="mc-row hidden" data-cc><label for="mc-bcc">Bcc</label><input class="input sm" id="mc-bcc" name="bcc"></div>
        <div class="mc-row"><label for="mc-subject">Subject</label><input class="input sm" id="mc-subject" name="subject" value="${subject}" maxlength="900"></div>
        <textarea class="textarea mc-body" name="body" rows="12" placeholder="Write your message…" ${to ? 'autofocus' : ''}></textarea>
        ${m && mode !== 'new' ? html`<label class="check small"><input type="checkbox" name="include_original" checked> Include the original message below your text</label>` : ''}
        ${mode === 'forward' && origFiles.length ? html`<label class="check small"><input type="checkbox" name="forward_attachments" checked> Forward original attachments (${origFiles.length}: ${origFiles.map((a) => a.name).join(', ')})</label>` : ''}
        <div class="mc-files" data-files></div>
        <div class="row wrap" style="gap:8px">
          <button class="btn sm" type="button" data-attach>${icon('paperclip', 'sm')} Attach files</button>
          <button class="btn sm" type="button" data-drive>${icon('hard-drive', 'sm')} From Drive</button>
          <span class="small subtle">Max 20 MB in total</span>
        </div>
        <input type="file" multiple hidden data-file-input>
      </form>`));
      const form = body;
      const renderFiles = () => {
        form.querySelector('[data-files]').innerHTML = String(html`${files.map((f, i) => html`<span class="mail-att static">${icon('paperclip', 'sm')}<span class="truncate">${f.name}</span><span class="subtle tiny">${fmtBytes(f.size)}</span><button class="btn ghost icon xs" type="button" data-rm-file="${i}" aria-label="Remove">${icon('x', 'sm')}</button></span>`)}
          ${driveFiles.map((f, i) => html`<span class="mail-att static">${icon('hard-drive', 'sm')}<span class="truncate">${f.name}</span><span class="subtle tiny">${fmtBytes(f.size)}</span><button class="btn ghost icon xs" type="button" data-rm-drive="${i}" aria-label="Remove">${icon('x', 'sm')}</button></span>`)}`);
      };
      form.addEventListener('click', async (e) => {
        if (e.target.closest('[data-ccbcc]')) { form.querySelectorAll('[data-cc]').forEach((x) => x.classList.remove('hidden')); e.target.closest('[data-ccbcc]').hidden = true; }
        if (e.target.closest('[data-attach]')) form.querySelector('[data-file-input]').click();
        const rf = e.target.closest('[data-rm-file]');
        if (rf) { files.splice(+rf.dataset.rmFile, 1); renderFiles(); }
        const rd = e.target.closest('[data-rm-drive]');
        if (rd) { driveFiles.splice(+rd.dataset.rmDrive, 1); renderFiles(); }
        if (e.target.closest('[data-drive]')) {
          const picked = await pickDriveFiles();
          picked.forEach((f) => { if (!driveFiles.some((x) => x.id === f.id)) driveFiles.push(f); });
          renderFiles();
        }
      });
      form.querySelector('[data-file-input]').addEventListener('change', (e) => { files.push(...e.target.files); e.target.value = ''; renderFiles(); });
      const dirty = () => form.body.value.trim() || files.length || driveFiles.length;
      const dlg = modal({
        title: { new: 'New message', reply: 'Reply', replyall: 'Reply all', forward: 'Forward' }[mode], body, size: 'lg', dismissible: false, className: 'mail-compose-modal',
        actions: [
          { label: 'Discard', left: true, variant: 'ghost', onClick: async () => (dirty() ? ((await confirm({ title: 'Discard this message?', confirmText: 'Discard' })) ? undefined : false) : undefined) },
          { label: 'Send', variant: 'primary', icon: 'send', onClick: async () => {
            const fd = new FormData();
            const v = (n) => form.elements[n]?.value ?? '';
            if (!v('to').trim() && !v('cc').trim() && !v('bcc').trim()) { toast('Add at least one recipient', 'error'); form.to.focus(); return false; }
            if (!v('subject').trim() && !(await confirm({ title: 'Send without a subject?', confirmText: 'Send', danger: false }))) return false;
            ['mailbox', 'to', 'cc', 'bcc', 'subject', 'body'].forEach((n) => fd.append(n, v(n)));
            fd.append('mode', mode === 'replyall' ? 'reply' : mode);
            if (m && mode !== 'new') {
              fd.append('ref_folder', m.folder);
              fd.append('ref_uid', m.uid);
              fd.append('include_original', form.elements.include_original?.checked ? '1' : '0');
              fd.append('forward_attachments', form.elements.forward_attachments?.checked ? '1' : '0');
            }
            files.forEach((f) => fd.append('files[]', f, f.name));
            driveFiles.forEach((f) => fd.append('drive_ids[]', f.id));
            try {
              await api.upload('mail/send', fd);
            } catch (err) {
              toast(err.message, 'error', { timeout: 8000 });
              return false;
            }
            toast('Message sent', 'success');
            if (isSentLike()) loadList(true);
            loadFolders(true);
            if (open && mode !== 'new') { open.answered = mode !== 'forward' || open.answered; }
          } },
        ],
      });
      return dlg;
    }

    async function pickDriveFiles() {
      const chosen = new Map();
      const body = h(String(html`<div class="col" style="gap:10px">
        <div class="input-icon">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search Drive…" data-q autofocus></div>
        <div class="list mail-drive-pick" data-items><div style="padding:30px;text-align:center"><span class="spinner"></span></div></div></div>`));
      const load = async (q = '') => {
        try {
          const r = await api.get('drive', { view: 'all', q });
          body.querySelector('[data-items]').innerHTML = r.items.length ? String(html`${r.items.map((f) => html`<label class="list-item"><input type="checkbox" value="${f.id}" ${chosen.has(f.id) ? 'checked' : ''}><span class="li-main truncate">${f.name}</span><span class="small subtle">${fmtBytes(f.size)}</span></label>`)}`) : String(empty({ icon: 'hard-drive', title: 'No files' }));
          body.querySelectorAll('input[type=checkbox]').forEach((c) => c.addEventListener('change', () => {
            const f = r.items.find((x) => x.id === +c.value);
            if (c.checked) chosen.set(f.id, f); else chosen.delete(f.id);
          }));
        } catch (e) { toastError(e); }
      };
      body.querySelector('[data-q]').addEventListener('input', debounce((e) => load(e.target.value), 300));
      load();
      const res = await modal({ title: 'Attach from Drive', body, size: 'sm', actions: [{ label: 'Cancel' }, { label: 'Attach', variant: 'primary', value: true }] }).result;
      return res ? [...chosen.values()] : [];
    }

    // ---------------------------------------------------------------- events
    el.addEventListener('click', async (e) => {
      const t = e.target;
      const act = t.closest('[data-act]')?.dataset.act;
      if (act === 'compose') return compose('new');
      if (act === 'settings') return openSettings();
      if (act === 'refresh') { loadFolders(); return loadList(); }
      if (act === 'flagged') { s.flagged = !s.flagged; t.closest('[data-act]').classList.toggle('active', s.flagged); s.page = 1; return loadList(); }
      if (act === 'back') { mailEl().setAttribute('data-state', 'list'); return; }

      const fb = t.closest('[data-folder]');
      if (fb) {
        s.folder = fb.dataset.folder; s.page = 1; selected.clear(); open = null;
        setQuery({ mailbox: s.mailbox, folder: s.folder === 'INBOX' ? '' : s.folder });
        renderFolders(); setReader(null); return loadList();
      }
      const pg = t.closest('[data-page]');
      if (pg) { s.page = Math.max(1, list.page + +pg.dataset.page); return loadList(); }

      const row = t.closest('.mail-row[data-uid]');
      if (row) {
        const uid = +row.dataset.uid;
        if (t.closest('[data-stop]')) return;
        if (t.closest('[data-star]')) { const m = list.items.find((x) => x.uid === uid); return setFlags([uid], m.flagged ? [] : ['\\Flagged'], m.flagged ? ['\\Flagged'] : []).catch(toastError); }
        return openMessage(uid);
      }
      const ba = t.closest('[data-bulk-act]')?.dataset.bulkAct;
      if (ba) {
        const uids = [...selected];
        try {
          if (ba === 'read') await setFlags(uids, ['\\Seen']);
          if (ba === 'unread') await setFlags(uids, [], ['\\Seen']);
          if (ba === 'move') return moveMenu(t.closest('[data-bulk-act]'), uids);
          if (ba === 'delete') await remove(uids);
        } catch (err) { toastError(err); }
        return;
      }
      const r = t.closest('[data-r]')?.dataset.r;
      if (r && open) {
        try {
          if (['reply', 'replyall', 'forward'].includes(r)) return compose(r);
          if (r === 'star') { await setFlags([open.uid], open.flagged ? [] : ['\\Flagged'], open.flagged ? ['\\Flagged'] : [], open.folder); t.closest('[data-r]').classList.toggle('on', open.flagged); return; }
          if (r === 'unread') { await setFlags([open.uid], [], ['\\Seen'], open.folder); open = null; setReader(null); return; }
          if (r === 'move') return moveMenu(t.closest('[data-r]'), [open.uid]);
          if (r === 'delete') return remove([open.uid]);
          if (r === 'images') return renderReader(true);
          if (r === 'more') {
            return menu(t.closest('[data-r]'), [
              { label: 'Download original (.eml)', icon: 'download', onClick: () => { window.location.href = apiUrl('mail/source', { mailbox: s.mailbox, folder: open.folder, uid: open.uid }); } },
              ...(open.remote_images ? [{ label: 'Show remote images', icon: 'image', onClick: () => renderReader(true) }] : []),
            ], { align: 'end' });
          }
        } catch (err) { toastError(err); }
        return;
      }
      const att = t.closest('[data-att]');
      if (att && open) {
        const a = open.attachments.find((x) => x.id === att.dataset.att);
        if (t.closest('[data-att-menu]')) {
          return menu(t.closest('[data-att-menu]'), [
            ...(previewable(a) ? [{ label: 'Preview', icon: 'eye', onClick: () => previewAttachment(a) }] : []),
            { label: 'Download', icon: 'download', onClick: () => { window.location.href = attUrl(a, true); } },
            { label: 'Save to Drive', icon: 'hard-drive-download', onClick: () => saveToDrive(a) },
          ], { align: 'end' });
        }
        if (t.closest('[data-att-open]')) return previewAttachment(a);
      }
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('[data-mailbox]')) {
        s.mailbox = t.value; s.folder = 'INBOX'; s.page = 1; selected.clear(); open = null;
        setQuery({ mailbox: s.mailbox, folder: '' });
        setReader(null); loadFolders(); loadList();
      }
      if (t.matches('[data-folder-select]')) {
        s.folder = t.value; s.page = 1; selected.clear(); open = null;
        renderFolders(); setReader(null); loadList();
      }
      if (t.matches('[data-pick]')) {
        const uid = +t.closest('[data-uid]').dataset.uid;
        if (t.checked) selected.add(uid); else selected.delete(uid);
        t.closest('.mail-row').classList.toggle('selected', t.checked);
        renderBulk();
      }
      if (t.matches('[data-all]')) {
        if (t.checked) list.items.forEach((m) => selected.add(m.uid)); else selected.clear();
        renderList();
      }
    });
    el.addEventListener('input', debounce((e) => {
      if (!e.target.matches('[data-search]')) return;
      s.q = e.target.value.trim(); s.page = 1; loadList();
    }, 450));
    el.addEventListener('keydown', (e) => {
      const row = e.target.closest?.('.mail-row[data-uid]');
      if (row && (e.key === 'Enter' || e.key === ' ') && !e.target.closest('[data-stop],[data-star]')) { e.preventDefault(); openMessage(+row.dataset.uid); }
    });

    await boot();
    return () => clearInterval(timer);
  },
};
