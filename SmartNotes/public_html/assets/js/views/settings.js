// Personal settings: profile, appearance, notifications, email, security, storage, categories, tags, data.
import { html, icon, fmtBytes, timeAgo, h } from '../core/dom.js';
import { api, setCsrf } from '../core/api.js';
import { state, emit, applyBootstrap } from '../core/store.js';
import { navigate } from '../core/router.js';
import { toast, toastError, confirm, prompt, formData, showFieldErrors, withLoading, avatarHtml, switchHtml, ACCENTS, PALETTE } from '../core/ui.js';
import { applyAll } from '../core/theme.js';
import { renderSidebar } from '../core/shell.js';
import { pickFiles } from '../components/attachments.js';
import { sortable } from '../components/sortable.js';
import { REMINDERS } from '../components/forms.js';
import { pinStatus, setupPin, resetPinDialog, removePinDialog, lockNow } from '../components/notePin.js';

const TABS = [
  ['profile', 'Profile', 'user'], ['appearance', 'Appearance', 'palette'], ['notifications', 'Notifications', 'bell'], ['email', 'Email', 'mail'],
  ['security', 'Security', 'shield'], ['storage', 'Storage', 'hard-drive'], ['categories', 'Categories', 'folder'], ['tags', 'Tags', 'hash'], ['data', 'Import / export', 'database'],
];

async function saveSettings(patch) {
  try {
    state.settings = await api.post('profile/settings', patch);
    applyAll();
    emit('theme:changed');
    return state.settings;
  } catch (e) { toastError(e); }
}

const card = (title, desc, body) => html`<div class="card"><div class="card-head"><div><h3>${title}</h3>${desc ? html`<p class="small muted" style="margin:2px 0 0">${desc}</p>` : ''}</div></div><div class="card-body">${body}</div></div>`;

// ------------------------------------------------------------------ tabs
const tabs = {
  profile(el, rerender) {
    const u = state.user;
    el.innerHTML = String(html`${card('Profile', 'Your personal information.', html`
      <div class="row mb-3" style="gap:18px"><div data-avatar>${avatarHtml(u, 'lg')}</div>
        <div class="col" style="gap:6px"><div class="row"><button class="btn sm" data-a="avatar">${icon('upload', 'sm')} Upload photo</button>${u.avatar_url ? html`<button class="btn ghost sm" data-a="avatar-remove">Remove</button>` : ''}</div><span class="small subtle">JPG, PNG or WEBP. Square images look best.</span></div></div>
      <form data-form class="form-grid">
        <div class="field"><label>Full name</label><input class="input" name="name" value="${u.name}" required></div>
        <div class="field"><label>E-mail</label><input class="input" type="email" name="email" value="${u.email}" required><span class="hint">Used for sign in and reminders.</span></div>
        <div class="field"><label>Job title</label><input class="input" name="job_title" value="${u.job_title || ''}"></div>
        <div class="field"><label>Phone</label><input class="input" name="phone" value="${u.phone || ''}"></div>
        <div class="field span-2"><label>Bio</label><textarea class="textarea" name="bio" rows="3">${u.bio || ''}</textarea></div>
        <div class="span-2 row"><button class="btn primary" type="submit">Save profile</button><span class="small subtle">Member since ${new Date(u.created_at.replace(' ', 'T')).toLocaleDateString()} · Role: ${u.role}</span></div>
      </form>`)}`);
    const form = el.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try { const r = await api.post('profile', formData(form)); applyBootstrap(r); renderSidebar(); toast('Profile saved', 'success'); }
        catch (err) { showFieldErrors(form, err.errors); toastError(err); }
      });
    });
    el.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'avatar') {
        const [f] = await pickFiles({ accept: 'image/jpeg,image/png,image/webp', multiple: false });
        if (!f) return;
        const fd = new FormData();
        fd.append('file', f);
        try { const r = await api.upload('profile/avatar', fd); applyBootstrap(r); renderSidebar(); rerender(); toast('Photo updated', 'success'); } catch (err) { toastError(err); }
      }
      if (a === 'avatar-remove') { try { const r = await api.post('profile/avatar/remove'); applyBootstrap(r); renderSidebar(); rerender(); } catch (err) { toastError(err); } }
    });
  },

  appearance(el, rerender) {
    const s = state.settings;
    const accent = s.accent_color || state.branding.default_accent;
    el.innerHTML = String(html`
      ${card('Theme', 'Choose how SmartNotes looks to you.', html`<div class="theme-cards">${[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']].map(([v, l]) => html`
        <button class="theme-card ${s.theme === v ? 'active' : ''}" data-theme="${v}"><div class="preview ${v}"><i></i><span></span></div>${l}</button>`)}</div>`)}
      ${card('Accent color', 'Used for buttons, highlights and links.', html`<div class="accent-row">${ACCENTS.map((c) => html`<button class="accent-dot ${accent === c ? 'active' : ''}" style="--sw:${c}" data-accent="${c}" aria-label="${c}"></button>`)}
        <label class="row small" style="gap:8px;margin-left:8px">Custom <input type="color" value="${accent}" data-accent-custom></label>
        <button class="btn ghost sm" data-accent="">Reset</button></div>`)}
      ${card('Layout', '', html`
        <div class="setting-row"><div class="info"><b>Collapsed sidebar</b><span>Show only icons in the sidebar on desktop.</span></div>${switchHtml('sidebar', s.sidebar_style === 'collapsed')}</div>
        <div class="setting-row"><div class="info"><b>Compact mode</b><span>Reduce spacing to fit more on screen.</span></div>${switchHtml('compact', s.compact_mode)}</div>`)}
      ${card('Background image', 'A subtle image behind the app. Content stays readable thanks to an automatic overlay.', html`
        <div class="brand-preview mb-2" style="${s.background_url || state.branding.background_url ? `background-image:url('${s.background_url || state.branding.background_url}')` : ''}">${s.background_url || state.branding.background_url ? '' : html`<span class="subtle small">No background</span>`}</div>
        <div class="row wrap"><button class="btn sm" data-a="bg">${icon('upload', 'sm')} Upload image</button>${s.background_url ? html`<button class="btn ghost sm" data-a="bg-remove">Remove</button>` : ''}
          <label class="row small grow" style="gap:10px;min-width:220px">Opacity <input type="range" min="0" max="60" value="${s.background_opacity}" data-opacity><span data-opv>${s.background_opacity}%</span></label></div>`)}`);
    el.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-theme]');
      if (t) { await saveSettings({ theme: t.dataset.theme }); return rerender(); }
      const a = e.target.closest('[data-accent]');
      if (a) { await saveSettings({ accent_color: a.dataset.accent || null }); return rerender(); }
      const act = e.target.closest('[data-a]')?.dataset.a;
      if (act === 'bg') {
        const [f] = await pickFiles({ accept: 'image/jpeg,image/png,image/webp', multiple: false });
        if (!f) return;
        const fd = new FormData();
        fd.append('file', f);
        try { state.settings = await api.upload('profile/background', fd); applyAll(); rerender(); toast('Background updated', 'success'); } catch (err) { toastError(err); }
      }
      if (act === 'bg-remove') { state.settings = await api.post('profile/background/remove').catch(toastError) || state.settings; applyAll(); rerender(); }
    });
    el.addEventListener('change', async (e) => {
      if (e.target.matches('[data-accent-custom]')) { await saveSettings({ accent_color: e.target.value }); rerender(); }
      if (e.target.name === 'sidebar') { await saveSettings({ sidebar_style: e.target.checked ? 'collapsed' : 'expanded' }); document.querySelector('.app')?.classList.toggle('sidebar-collapsed', e.target.checked); }
      if (e.target.name === 'compact') saveSettings({ compact_mode: e.target.checked });
      if (e.target.matches('[data-opacity]')) saveSettings({ background_opacity: +e.target.value });
    });
    el.addEventListener('input', (e) => {
      if (e.target.matches('[data-opacity]')) {
        el.querySelector('[data-opv]').textContent = e.target.value + '%';
        document.querySelector('.app-bg')?.style.setProperty('--bg-image-opacity', String(e.target.value / 100));
      }
      if (e.target.matches('[data-accent-custom]')) document.documentElement.style.setProperty('--accent', e.target.value);
    });
  },

  notifications(el, rerender) {
    const s = state.settings;
    const perm = window.Notification?.permission;
    el.innerHTML = String(html`
      ${card('Reminders', 'Choose which reminders you receive (in-app and by e-mail).', html`
        <div class="setting-row"><div class="info"><b>Task reminders</b><span>Before a task's due date/time.</span></div>${switchHtml('notify_task', s.notify_task)}</div>
        <div class="setting-row"><div class="info"><b>Meeting reminders</b><span>e.g. “Meeting Project Dukcapil akan dimulai 30 menit lagi.”</span></div>${switchHtml('notify_meeting', s.notify_meeting)}</div>
        <div class="setting-row"><div class="info"><b>Schedule reminders</b><span>Calendar events, schedules and reminders.</span></div>${switchHtml('notify_schedule', s.notify_schedule)}</div>
        <div class="setting-row"><div class="info"><b>Default reminder</b><span>Pre-selected when you create tasks, events and meetings.</span></div>
          <select class="select sm" style="width:auto" data-default>${REMINDERS.map(([v, l]) => html`<option value="${v}" ${String(s.default_reminder ?? '') === v ? 'selected' : ''}>${l}</option>`)}</select></div>`)}
      ${card('Desktop notifications', 'Show a system notification when a reminder arrives while SmartNotes is open in a background tab.', html`
        <div class="row between"><span class="small">${perm === 'granted' ? 'Enabled in this browser.' : perm === 'denied' ? 'Blocked — allow notifications in your browser settings.' : 'Not enabled yet.'}</span>
        ${perm !== 'granted' && window.Notification ? html`<button class="btn sm" data-a="desktop" ${perm === 'denied' ? 'disabled' : ''}>Enable</button>` : ''}</div>`)}`);
    el.addEventListener('change', (e) => {
      if (e.target.name) saveSettings({ [e.target.name]: e.target.checked }).then(() => toast('Saved', 'success', { timeout: 1200 }));
      if (e.target.matches('[data-default]')) saveSettings({ default_reminder: e.target.value === '' ? null : +e.target.value }).then(() => toast('Saved', 'success', { timeout: 1200 }));
    });
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-a="desktop"]')) { await Notification.requestPermission(); rerender(); }
    });
  },

  email(el, rerender) {
    const s = state.settings;
    el.innerHTML = String(html`
      ${!state.smtpConfigured ? html`<div class="card card-pad mb-3" style="border-color:var(--warning);background:var(--warning-soft)"><div class="row">${icon('alert-triangle')}<div><b>E-mail is not configured yet</b><div class="small">${state.isAdminArea ? html`Configure SMTP in <a href="#/admin/email">Admin → Email & reminders</a>.` : 'Ask your administrator to configure SMTP. In-app reminders still work.'}</div></div></div></div>` : ''}
      ${card('E-mail notifications', `Reminders are sent to ${state.user.email}.`, html`
        <div class="setting-row"><div class="info"><b>Send reminders by e-mail</b><span>Master switch for all reminder e-mails.</span></div>${switchHtml('email_notifications', s.email_notifications)}</div>
        <div class="setting-row"><div class="info"><b>Daily agenda</b><span>A summary of today's tasks, meetings and schedule every morning.</span></div>${switchHtml('notify_daily_agenda', s.notify_daily_agenda)}</div>
        <div class="setting-row"><div class="info"><b>Weekly agenda</b><span>Every Monday: your week ahead.</span></div>${switchHtml('notify_weekly_agenda', s.notify_weekly_agenda)}</div>
        <div class="setting-row"><div class="info"><b>Agenda delivery time</b><span>Time of day for daily/weekly agenda e-mails.</span></div><input class="input sm" type="time" style="width:auto" value="${s.daily_agenda_time}" data-time></div>`)}`);
    el.addEventListener('change', (e) => {
      if (e.target.name) saveSettings({ [e.target.name]: e.target.checked }).then(() => toast('Saved', 'success', { timeout: 1200 }));
      if (e.target.matches('[data-time]')) saveSettings({ daily_agenda_time: e.target.value }).then(() => toast('Saved', 'success', { timeout: 1200 }));
    });
  },

  async security(el, rerender) {
    el.innerHTML = String(html`
      ${card('Change password', 'Use at least 8 characters with letters and numbers.', html`<form data-pw class="form-grid">
        <div class="field span-2"><label>Current password</label><input class="input" type="password" name="current_password" autocomplete="current-password" required></div>
        <div class="field"><label>New password</label><input class="input" type="password" name="password" autocomplete="new-password" required></div>
        <div class="field"><label>Confirm new password</label><input class="input" type="password" name="password_confirm" autocomplete="new-password" required></div>
        <div class="span-2"><button class="btn primary" type="submit">Update password</button></div></form>`)}
      ${card('Notes PIN', 'Lock private notes behind a 4–8 digit PIN. Locked notes hide their text, images and files until the PIN is entered on this device.', html`<div data-pin><span class="spinner"></span></div>`)}
      ${card('Signed-in devices', 'Devices where you chose “Remember me”.', html`<div data-devices><span class="spinner"></span></div>`)}`);
    async function loadPin() {
      try {
        const st = await pinStatus();
        el.querySelector('[data-pin]').innerHTML = String(st.has_pin ? html`
          <div class="row wrap" style="gap:8px;align-items:center">
            <span class="badge success">${icon('lock', 'sm')} PIN active</span>
            <span class="small subtle">${st.locked_notes} locked note${st.locked_notes === 1 ? '' : 's'} · ${st.unlocked ? `unlocked on this device for ${Math.ceil(st.expires_in / 60)} more min` : 'locked on this device'}${st.blocked_until ? ' · blocked after too many wrong PINs' : ''}</span>
          </div>
          <div class="row wrap mt-2" style="gap:8px">
            <button class="btn sm" data-pin-act="change">${icon('key-round', 'sm')} Change PIN</button>
            <button class="btn sm" data-pin-act="reset">${icon('rotate-ccw', 'sm')} Forgot PIN</button>
            ${st.unlocked ? html`<button class="btn sm" data-pin-act="lock">${icon('lock', 'sm')} Lock now</button>` : ''}
            <button class="btn sm danger ghost" data-pin-act="remove">${icon('lock-open', 'sm')} Remove PIN</button>
          </div>
          <p class="small subtle mt-2">Lock a note from its ⋯ menu. The PIN protects against other people using your account on this device; administrators with database access can still read the text.</p>`
          : html`<button class="btn" data-pin-act="set">${icon('lock', 'sm')} Set a notes PIN</button>`);
      } catch (e) { toastError(e); }
    }
    loadPin();
    el.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-pin-act]')?.dataset.pinAct;
      if (!a) return;
      if (a === 'set' && await setupPin()) loadPin();
      if (a === 'change' && await setupPin({ change: true })) loadPin();
      if (a === 'reset' && await resetPinDialog()) loadPin();
      if (a === 'remove' && await removePinDialog()) loadPin();
      if (a === 'lock') { await lockNow().catch(toastError); loadPin(); }
    });
    const form = el.querySelector('[data-pw]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(form);
      if (d.password !== d.password_confirm) { showFieldErrors(form, { password_confirm: 1 }); return toast('New passwords do not match', 'error'); }
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try { await api.post('profile/password', d); form.reset(); toast('Password updated. Other devices were signed out.', 'success'); loadDevices(); }
        catch (err) { showFieldErrors(form, err.errors); toastError(err); }
      });
    });
    async function loadDevices() {
      try {
        const r = await api.get('profile/sessions');
        el.querySelector('[data-devices]').innerHTML = String(html`${r.devices.length ? r.devices.map((d) => html`<div class="list-item" style="cursor:default" data-id="${d.id}">
          <span class="li-icon">${icon(/Mobile|Android|iPhone/i.test(d.user_agent || '') ? 'smartphone' : 'monitor', 'sm')}</span>
          <div class="li-main"><div class="li-title">${(d.user_agent || 'Unknown device').replace(/\(.*?\)/g, '').slice(0, 70)}${d.current ? html` <span class="badge success">This device</span>` : ''}</div>
          <div class="li-sub">${d.ip_address || ''} · last active ${timeAgo(d.last_used_at || d.created_at)}</div></div>
          ${d.current ? '' : html`<button class="btn sm" data-revoke="${d.id}">Sign out</button>`}</div>`) : html`<p class="small subtle">No remembered devices.</p>`}
          <div class="row between mt-2"><span class="small subtle">Last sign-in: ${r.last_login_at ? timeAgo(r.last_login_at) : '—'}</span>${r.devices.length > 1 ? html`<button class="btn sm danger" data-revoke-all>Sign out all other devices</button>` : ''}</div>`);
      } catch (e) { toastError(e); }
    }
    el.addEventListener('click', async (e) => {
      const r = e.target.closest('[data-revoke]');
      if (r) { await api.post(`profile/sessions/${r.dataset.revoke}/revoke`).catch(toastError); loadDevices(); }
      if (e.target.closest('[data-revoke-all]')) {
        if (await confirm({ title: 'Sign out other devices?', message: 'All remembered devices except this one will be signed out.', confirmText: 'Sign out' })) { await api.post('profile/sessions/revoke-all').catch(toastError); loadDevices(); }
      }
    });
    loadDevices();
  },

  async storage(el, rerender) {
    el.innerHTML = String(card('Storage', 'Space used by your uploads and recordings.', html`<div data-st><span class="spinner"></span></div>`));
    try {
      const r = await api.get('profile/storage');
      const colors = { image: '#6366f1', document: '#0ea5e9', recordings: '#ec4899', audio: '#f97316', archive: '#a855f7', other: '#64748b' };
      const total = r.total || 1;
      el.querySelector('[data-st]').innerHTML = String(html`<div class="row between mb-1"><b style="font-size:22px">${fmtBytes(r.total)}</b><a class="btn sm" href="#/drive">Open Drive</a></div>
        <div class="storage-bar mb-3">${Object.entries(r.by_kind).map(([k, v]) => html`<span style="width:${(v.size / total) * 100}%;background:${colors[k] || '#999'}" data-tip="${k}: ${fmtBytes(v.size)}"></span>`)}</div>
        <div class="grid grid-3" style="gap:10px">${Object.entries(r.by_kind).map(([k, v]) => html`<div class="row small"><span class="legend-dot" style="background:${colors[k] || '#999'}"></span><span class="grow" style="text-transform:capitalize">${k}</span><b>${fmtBytes(v.size)}</b><span class="subtle">${v.count}</span></div>`)}</div>
        <p class="small subtle mt-3">${icon('infinity', 'sm')} No storage quota — your files are kept on the hosting's own storage. Maximum size per file: ${uploadLimitsText(state.limits)}. Large files are uploaded in pieces automatically.</p>`);
    } catch (e) { toastError(e); }
  },

  categories(el, rerender) {
    const render = () => {
      el.innerHTML = String(html`${['note', 'task'].map((type) => card(type === 'note' ? 'Note categories' : 'Task categories', 'Drag to reorder. Click a color to change it.', html`
        <div data-list="${type}">${state.categories[type].map((c) => html`<div class="sortable-item" data-id="${c.id}" data-type="${type}">
          <span class="handle">${icon('grip-vertical', 'sm')}</span>
          <button class="accent-dot" style="--sw:${c.color};width:22px;height:22px;border-width:2px" data-color-of="${c.id}" aria-label="Color"></button>
          <span class="grow truncate">${c.name}</span><span class="small subtle">${c.count}</span>
          <button class="btn ghost icon xs" data-rename="${c.id}" aria-label="Rename">${icon('pencil', 'sm')}</button>
          <button class="btn ghost icon xs" data-del="${c.id}" aria-label="Delete">${icon('trash-2', 'sm')}</button></div>`)}</div>
        <form class="row mt-2" data-add="${type}"><input class="input sm" name="name" placeholder="New category name" maxlength="80"><button class="btn sm primary" type="submit">${icon('plus', 'sm')} Add</button></form>`))}`);
      ['note', 'task'].forEach((type) => sortable(el.querySelector(`[data-list="${type}"]`), {
        item: '.sortable-item', list: `[data-list="${type}"]`, handle: '.handle',
        onDrop: async (_it, list) => {
          const ids = Array.from(list.querySelectorAll('.sortable-item')).map((x) => +x.dataset.id);
          try { const r = await api.post('categories/reorder', { type, ids }); state.categories[type] = r.list; emit('categories:changed'); } catch (e) { toastError(e); }
        },
      }));
    };
    render();
    const typeOf = (node) => node.closest('[data-type]')?.dataset.type || 'note';
    el.addEventListener('submit', async (e) => {
      const f = e.target.closest('[data-add]');
      if (!f) return;
      e.preventDefault();
      const name = f.name.value.trim();
      if (!name) return;
      try {
        const r = await api.post('categories', { type: f.dataset.add, name, color: PALETTE[state.categories[f.dataset.add].length % PALETTE.length] });
        state.categories[f.dataset.add] = r.list;
        emit('categories:changed');
        render();
        toast('Category added', 'success');
      } catch (err) { toastError(err); }
    });
    el.addEventListener('click', async (e) => {
      const rn = e.target.closest('[data-rename]');
      const del = e.target.closest('[data-del]');
      const col = e.target.closest('[data-color-of]');
      if (rn) {
        const type = typeOf(rn);
        const c = state.categories[type].find((x) => x.id === +rn.dataset.rename);
        const name = await prompt({ title: 'Rename category', value: c.name });
        if (!name) return;
        try { const r = await api.post(`categories/${c.id}`, { type, name }); state.categories[type] = r.list; emit('categories:changed'); render(); } catch (err) { toastError(err); }
      }
      if (del) {
        const type = typeOf(del);
        const c = state.categories[type].find((x) => x.id === +del.dataset.del);
        if (!(await confirm({ title: `Delete “${c.name}”?`, message: `${c.count} item(s) will become uncategorized. Nothing else is deleted.`, confirmText: 'Delete' }))) return;
        try { const r = await api.post(`categories/${c.id}/delete`, { type }); state.categories[type] = r.list; emit('categories:changed'); render(); } catch (err) { toastError(err); }
      }
      if (col) {
        const type = typeOf(col);
        const wrap = h(`<div class="swatches">${PALETTE.map((p) => `<button class="swatch" data-pick="${p}" style="--sw:${p}"></button>`).join('')}</div>`);
        const { popover } = await import('../core/ui.js');
        const pop = popover(col, wrap);
        wrap.addEventListener('click', async (ev) => {
          const p = ev.target.closest('[data-pick]');
          if (!p) return;
          pop.close();
          try { const r = await api.post(`categories/${col.dataset.colorOf}`, { type, color: p.dataset.pick }); state.categories[type] = r.list; emit('categories:changed'); render(); } catch (err) { toastError(err); }
        });
      }
    });
  },

  tags(el, rerender) {
    const render = () => {
      el.innerHTML = String(card('Tags', 'Tags are shared by notes and tasks. Type #tag in the tag field of a note or task to create one.', state.tags.length
        ? html`<div class="list">${state.tags.map((t) => html`<div class="list-item" style="cursor:default"><span class="tag">#${t.name}</span><span class="grow"></span><span class="small subtle">${t.count} item${t.count === 1 ? '' : 's'}</span>
          <a class="btn ghost icon xs" href="#/notes?tag=${encodeURIComponent(t.name)}" data-tip="View notes">${icon('eye', 'sm')}</a>
          <button class="btn ghost icon xs" data-rename="${t.id}">${icon('pencil', 'sm')}</button><button class="btn ghost icon xs" data-del="${t.id}">${icon('trash-2', 'sm')}</button></div>`)}</div>`
        : html`<p class="small subtle">No tags yet.</p>`));
    };
    render();
    el.addEventListener('click', async (e) => {
      const rn = e.target.closest('[data-rename]');
      const del = e.target.closest('[data-del]');
      if (rn) {
        const t = state.tags.find((x) => x.id === +rn.dataset.rename);
        const name = await prompt({ title: 'Rename tag', value: t.name });
        if (!name) return;
        try { state.tags = await api.post(`tags/${t.id}`, { name }); render(); } catch (err) { toastError(err); }
      }
      if (del) {
        const t = state.tags.find((x) => x.id === +del.dataset.del);
        if (!(await confirm({ title: `Delete #${t.name}?`, message: 'The tag is removed from all notes and tasks.', confirmText: 'Delete' }))) return;
        try { state.tags = await api.post(`tags/${t.id}/delete`); render(); } catch (err) { toastError(err); }
      }
    });
  },

  data(el, rerender) {
    el.innerHTML = String(html`
      ${card('Export your data', 'Download everything you created (notes, tasks, calendar, meetings, mind maps, flowcharts and file metadata) as JSON.', html`<a class="btn" href="api/index.php?route=profile/export">${icon('download', 'sm')} Download export (.json)</a>`)}
      ${card('Import data', 'Import a SmartNotes export file. Items are added to your account — nothing is overwritten. Binary files are not included in exports.', html`<button class="btn" data-a="import">${icon('upload', 'sm')} Choose export file…</button>`)}`);
    el.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-a="import"]')) return;
      const [f] = await pickFiles({ accept: '.json,application/json', multiple: false });
      if (!f) return;
      const fd = new FormData();
      fd.append('file', f);
      const btn = e.target.closest('[data-a]');
      await withLoading(btn, async () => {
        try {
          const r = await api.upload('profile/import', fd);
          toast(`Imported ${Object.entries(r).map(([k, v]) => `${v} ${k}`).join(', ')}`, 'success', { timeout: 6000 });
          const boot = await api.get('app');
          setCsrf(boot.csrf);
          applyBootstrap(boot);
          renderSidebar();
        } catch (err) { toastError(err); }
      });
    });
  },
};

export default {
  title: 'Settings',
  async render(el, ctx) {
    const tab = TABS.some(([k]) => k === ctx.params.tab) ? ctx.params.tab : 'profile';
    el.innerHTML = String(html`<div class="page-head"><div><h1>Settings</h1><p>Personalise SmartNotes and manage your account.</p></div></div>
      <div class="settings-layout"><nav class="settings-nav">${TABS.map(([k, l, i]) => html`<a class="nav-item ${k === tab ? 'active' : ''}" href="#/settings/${k}">${icon(i, 'sm')}<span>${l}</span></a>`)}</nav>
      <div class="settings-card col" style="gap:18px" data-tab></div></div>`);
    ctx.setTitle('Settings');
    const container = el.querySelector('[data-tab]');
    const mountTab = () => {
      const d = document.createElement('div');
      d.className = 'col';
      d.style.gap = '18px';
      container.replaceChildren(d);
      return tabs[tab](d, mountTab);
    };
    await mountTab();
    void navigate;
  },
};

function uploadLimitsText(l = {}) {
  const kinds = l.kinds || ['image', 'audio', 'video', 'document', 'archive'];
  const mb = (v) => (!v ? 'no limit' : v >= 1024 && v % 1024 === 0 ? `${v / 1024} GB` : `${v} MB`);
  const parts = [['image', 'images', l.image_mb], ['audio', 'audio', l.audio_mb], ['video', 'video', l.video_mb], ['document', 'documents', l.file_mb]]
    .map(([k, label, v]) => (kinds.includes(k) ? `${label} ${mb(v)}` : `${label} not allowed`));
  if (!kinds.includes('archive')) parts.push('ZIP not allowed');
  return parts.join(', ');
}
