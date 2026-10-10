// Admin panel: overview & charts, users, branding, general settings, e-mail & reminders, categories, backup, activity log.
import { html, icon, fmtBytes, fmtDateTime, timeAgo, loadScript, debounce, h, initials } from '../core/dom.js';
import { api } from '../core/api.js';
import { state, can, emit } from '../core/store.js';
import { toast, toastError, confirm, modal, formData, showFieldErrors, withLoading, switchHtml, ACCENTS, empty, prompt } from '../core/ui.js';
import { pickFiles } from '../components/attachments.js';
import { themeColors } from '../components/canvas.js';
import { mailSettingsPanel } from '../components/mailConnections.js';
import { brandHtml } from '../core/shell.js';

const TABS = [
  ['overview', 'Overview', 'chart-column', 'view_stats'], ['users', 'Users', 'users', 'manage_users'], ['branding', 'Branding', 'image', 'manage_branding'],
  ['general', 'General', 'sliders-horizontal', 'manage_settings'], ['uploads', 'Uploads & storage', 'hard-drive-upload', 'manage_settings'], ['email', 'Email & reminders', 'mail', 'manage_email'], ['categories', 'Categories', 'folder', 'manage_categories'],
  ['backup', 'Backup & data', 'database-backup', 'manage_backup'], ['activity', 'Activity log', 'activity', 'view_stats'],
];
const remount = (el, fn) => {
  const fresh = el.cloneNode(false);
  el.replaceWith(fresh);
  return fn(fresh);
};
const card = (title, body, extra = '') => html`<div class="card"><div class="card-head"><h3>${title}</h3>${extra}</div><div class="card-body">${body}</div></div>`;
let charts = [];

const tabs = {
  async overview(el) {
    el.innerHTML = '<div style="padding:40px;text-align:center"><span class="spinner"></span></div>';
    const d = await api.get('admin/stats');
    const c = d.counts, s = d.system;
    const stat = (l, v, ic, col, foot = '') => html`<div class="card stat" style="--c:${col}"><div class="row between"><span class="stat-icon">${icon(ic)}</span><span class="stat-foot">${foot}</span></div><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div>`;
    el.innerHTML = String(html`
      <div class="stats-grid">
        ${stat('Total users', c.users, 'users', '#6366f1', `${c.active_users_7d} active (7d)`)}
        ${stat('Total notes', c.notes.toLocaleString(), 'notebook-pen', '#8b5cf6')}
        ${stat('Total tasks', c.tasks.toLocaleString(), 'list-todo', '#f59e0b')}
        ${stat('Completed tasks', c.tasks_completed.toLocaleString(), 'circle-check', '#10b981', c.tasks ? Math.round((c.tasks_completed / c.tasks) * 100) + '%' : '')}
        ${stat('Upcoming meetings', c.meetings_upcoming, 'calendar-clock', '#0ea5e9')}
        ${stat('Storage usage', fmtBytes(c.upload_dir_bytes), 'hard-drive', '#64748b', `DB ${fmtBytes(c.db_bytes)}`)}
        ${stat('Audio files', c.audio, 'mic', '#ec4899')}
        ${stat('Mind maps', c.mindmaps, 'network', '#eab308')}
        ${stat('Flowcharts', c.flowcharts, 'workflow', '#14b8a6')}
      </div>
      <div class="grid grid-2 mb-3">
        ${card(html`${icon('chart-line', 'sm')} Notes created per day`, html`<div class="chart-box"><canvas data-chart="notes"></canvas></div>`)}
        ${card(html`${icon('chart-column', 'sm')} Task completion`, html`<div class="chart-box"><canvas data-chart="tasks"></canvas></div>`)}
        ${card(html`${icon('activity', 'sm')} User activity (active users per day)`, html`<div class="chart-box"><canvas data-chart="users"></canvas></div>`)}
        ${card(html`${icon('chart-pie', 'sm')} Storage usage`, html`<div class="chart-box"><canvas data-chart="storage"></canvas></div>`)}
      </div>
      <div class="grid grid-2">
        ${card(html`${icon('server', 'sm')} System health`, html`<dl class="kv">
          <dt>App version</dt><dd>${s.app_version}</dd><dt>PHP</dt><dd>${s.php}</dd><dt>MySQL</dt><dd>${s.mysql}</dd>
          <dt>Upload limit</dt><dd>${s.upload_max} (post ${s.post_max})</dd>
          <dt>GD (images)</dt><dd>${s.gd ? html`<span class="badge success">Available</span>` : html`<span class="badge warning">Missing</span>`}</dd>
          <dt>Zip</dt><dd>${s.zip ? html`<span class="badge success">Available</span>` : html`<span class="badge warning">Missing</span>`}</dd>
          <dt>SMTP</dt><dd>${s.smtp_configured ? html`<span class="badge success">Configured</span>` : html`<span class="badge danger">Not configured</span>`}</dd>
          <dt>Scheduler</dt><dd>${s.last_cron_run ? html`Last run ${timeAgo(s.last_cron_run)} <span class="subtle">(${s.last_cron_source})</span>` : html`<span class="badge warning">Never ran</span>`}</dd>
          <dt>Queue</dt><dd>${s.pending_reminders} reminders · ${s.pending_emails} e-mails pending · ${s.failed_emails_7d} failed (7d)</dd></dl>`)}
        ${card(html`${icon('trophy', 'sm')} Most active users`, html`<div class="list">${d.top_users.map((u) => html`<div class="list-item" style="cursor:default"><span class="avatar sm">${initials(u.name)}</span><div class="li-main"><div class="li-title">${u.name}</div><div class="li-sub">${u.email}</div></div><span class="small subtle">${u.notes} notes · ${u.tasks} tasks</span></div>`)}</div>`)}
      </div>`);
    await loadScript('assets/vendor/chart.min.js');
    const Chart = window.Chart;
    const th = themeColors();
    Chart.defaults.color = th.text2;
    Chart.defaults.borderColor = th.dark ? 'rgba(255,255,255,.08)' : 'rgba(15,23,42,.08)';
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    const labels = d.charts.labels.map((x) => x.slice(5));
    const common = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 10, usePointStyle: true } } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } };
    charts.forEach((ch) => ch.destroy());
    charts = [
      new Chart(el.querySelector('[data-chart="notes"]'), { type: 'line', data: { labels, datasets: [{ label: 'Notes', data: d.charts.notes_per_day, borderColor: th.accent, backgroundColor: th.accent + '22', fill: true, tension: 0.35, pointRadius: 0 }] }, options: { ...common, plugins: { legend: { display: false } } } }),
      new Chart(el.querySelector('[data-chart="tasks"]'), { type: 'bar', data: { labels, datasets: [{ label: 'Created', data: d.charts.tasks_created, backgroundColor: '#94a3b8', borderRadius: 4 }, { label: 'Completed', data: d.charts.tasks_completed, backgroundColor: '#10b981', borderRadius: 4 }] }, options: common }),
      new Chart(el.querySelector('[data-chart="users"]'), { type: 'line', data: { labels, datasets: [{ label: 'Active users', data: d.charts.active_users, borderColor: '#0ea5e9', backgroundColor: '#0ea5e922', fill: true, tension: 0.35, pointRadius: 0 }] }, options: { ...common, plugins: { legend: { display: false } } } }),
      new Chart(el.querySelector('[data-chart="storage"]'), { type: 'doughnut', data: { labels: Object.keys(d.charts.storage).map((k) => k[0].toUpperCase() + k.slice(1)), datasets: [{ data: Object.values(d.charts.storage), backgroundColor: ['#ec4899', '#6366f1', '#0ea5e9', '#a855f7', '#f97316', '#64748b'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmtBytes(ctx.raw)}` } } } } }),
    ];
  },

  async users(el) {
    let data = await api.get('admin/users');
    let q = '';
    const paint = () => {
      el.innerHTML = String(card(html`${icon('users', 'sm')} Users <span class="subtle small">${data.items.length}</span>`, html`
        <div class="toolbar"><div class="input-icon grow" style="max-width:300px">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search users…" value="${q}" data-q></div><div class="grow"></div><button class="btn primary sm" data-a="new">${icon('user-plus', 'sm')} Add user</button></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th class="hide-sm">Status</th><th class="hide-sm">Content</th><th class="hide-sm">Last login</th><th></th></tr></thead><tbody>
        ${data.items.map((u) => html`<tr data-id="${u.id}"><td><div class="row"><span class="avatar sm">${initials(u.name)}</span><div style="min-width:0"><div class="truncate" style="font-weight:600">${u.name}</div><div class="tiny subtle truncate">${u.email}</div></div></div></td>
          <td><span class="badge ${u.role === 'admin' ? 'accent' : ''}">${u.role}</span>${u.permissions.length && u.role !== 'admin' ? html` <span class="badge info" data-tip="${u.permissions.join(', ')}">+${u.permissions.length}</span>` : ''}</td>
          <td class="hide-sm"><span class="badge ${u.status === 'active' ? 'success' : 'danger'}">${u.status}</span>${u.must_change_password ? html` <span class="badge warning" data-tip="Must set a new password at next sign-in">${icon('key-round', 'sm')}</span>` : ''}</td>
          <td class="hide-sm small">${u.notes} notes · ${u.tasks} tasks · ${fmtBytes(u.storage)}</td>
          <td class="hide-sm small">${u.last_login_at ? timeAgo(u.last_login_at) : 'Never'}</td>
          <td class="nowrap"><button class="btn ghost icon sm" data-edit="${u.id}" aria-label="Edit" data-tip="Edit">${icon('pencil', 'sm')}</button><button class="btn ghost icon sm" data-logout="${u.id}" aria-label="Sign out everywhere" data-tip="Sign out of all devices">${icon('log-out', 'sm')}</button>${u.id !== state.user.id ? html`<button class="btn ghost icon sm" data-del="${u.id}" aria-label="Delete">${icon('trash-2', 'sm')}</button>` : ''}</td></tr>`)}
        </tbody></table></div>`));
    };
    const reload = async () => { data = await api.get('admin/users', { q }); paint(); };
    paint();
    const userForm = (u = null) => {
      const isAdmin = state.user.role === 'admin';
      const form = h(String(html`<form class="form-grid" autocomplete="off">
        <div class="field"><label>Full name</label><input class="input" name="name" value="${u?.name || ''}" required></div>
        <div class="field"><label>E-mail</label><input class="input" type="email" name="email" value="${u?.email || ''}" required></div>
        <div class="field"><label>${u ? 'New password (optional)' : 'Password'}</label><input class="input" type="text" name="password" autocomplete="new-password" placeholder="${u ? 'Leave empty to keep' : 'Min. 8 chars, letters & numbers'}"></div>
        <div class="field"><label>Role</label><select class="select" name="role" ${isAdmin ? '' : 'disabled'}><option value="user" ${u?.role !== 'admin' ? 'selected' : ''}>User</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Admin</option></select></div>
        ${u ? html`<div class="field"><label>Status</label><select class="select" name="status"><option value="active" ${u.status === 'active' ? 'selected' : ''}>Active</option><option value="suspended" ${u.status === 'suspended' ? 'selected' : ''}>Suspended</option></select></div>` : html`<div class="field"><label>&nbsp;</label><label class="check small"><input type="checkbox" name="send_welcome" ${state.smtpConfigured ? 'checked' : 'disabled'}> Send welcome e-mail</label></div>`}
        <div class="field span-2"><label class="check small"><input type="checkbox" name="must_change_password" checked> Require ${u ? 'a new password at next sign-in (when you set a password above)' : 'the user to choose their own password at first sign-in'}</label>
          <span class="hint">Each user has their own login. Setting a password or suspending signs the user out of every device immediately.</span></div>
        ${isAdmin ? html`<div class="field span-2"><label>Extra permissions (for users)</label><div class="grid grid-2" style="gap:6px">${Object.entries(data.permissions).map(([k, l]) => html`<label class="check small"><input type="checkbox" name="perm_${k}" ${u?.permissions?.includes(k) ? 'checked' : ''}> ${l}</label>`)}</div><span class="hint">Users only manage their own data. Permissions grant access to parts of this admin panel.</span></div>` : ''}
      </form>`));
      return form;
    };
    const openForm = (u = null) => {
      const form = userForm(u);
      modal({
        title: u ? `Edit ${u.name}` : 'Add user', size: 'lg', body: form,
        actions: [{ label: 'Cancel' }, {
          label: u ? 'Save changes' : 'Create user', variant: 'primary', onClick: async () => {
            const d = formData(form);
            const perms = Object.keys(data.permissions).filter((k) => d['perm_' + k]);
            const payload = { name: d.name, email: d.email, role: d.role || 'user', permissions: perms, send_welcome: d.send_welcome, must_change_password: d.must_change_password };
            if (d.password) payload.password = d.password;
            if (u) payload.status = d.status;
            try {
              await api.post(u ? `admin/users/${u.id}` : 'admin/users', payload);
              toast(u ? 'User updated' : 'User created', 'success');
              reload();
            } catch (e) { showFieldErrors(form, e.errors); throw e; }
          },
        }],
      });
    };
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-a="new"]')) return openForm();
      const ed = e.target.closest('[data-edit]');
      if (ed) return openForm(data.items.find((u) => u.id === +ed.dataset.edit));
      const lo = e.target.closest('[data-logout]');
      if (lo) {
        const u = data.items.find((x) => x.id === +lo.dataset.logout);
        if (!(await confirm({ title: `Sign out ${u.name}?`, message: 'The user is signed out of every browser and device and must sign in again.', confirmText: 'Sign out everywhere' }))) return;
        try { await api.post(`admin/users/${u.id}/logout`); toast(`${u.name} was signed out everywhere`, 'success'); } catch (err) { toastError(err); }
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        const u = data.items.find((x) => x.id === +del.dataset.del);
        const typed = await prompt({ title: `Delete ${u.name}?`, label: `This permanently deletes the account and ALL of its notes, tasks, files and recordings. Type DELETE to confirm.`, confirmText: 'Delete user' });
        if (typed !== 'DELETE') { if (typed !== null) toast('Type DELETE to confirm', 'warning'); return; }
        try { await api.post(`admin/users/${u.id}/delete`); toast('User deleted', 'success'); reload(); } catch (err) { toastError(err); }
      }
    });
    el.addEventListener('input', debounce((e) => { if (e.target.matches('[data-q]')) { q = e.target.value.trim(); reload().then(() => { const i = el.querySelector('[data-q]'); i.focus(); i.setSelectionRange(q.length, q.length); }); } }, 300));
  },

  async branding(el) {
    const s = await api.get('admin/settings');
    const b = s.branding;
    const asset = (type, label, url, hint) => html`<div class="card card-pad"><div class="row between mb-2"><b>${label}</b><span class="small subtle">${hint}</span></div>
      <div class="brand-preview mb-2" style="${type === 'background' && url ? `background-image:url('${url}')` : ''}">${url ? (type !== 'background' ? html`<img src="${url}" alt="">` : '') : html`<span class="small subtle">Default</span>`}</div>
      <div class="row"><button class="btn sm" data-up="${type}">${icon('upload', 'sm')} Upload</button>${url ? html`<button class="btn ghost sm" data-rm="${type}">Remove</button>` : ''}</div></div>`;
    el.innerHTML = String(html`
      ${card('App identity', html`<form class="form-grid" data-text><div class="field"><label>Application name</label><input class="input" name="app_name" value="${b.app_name}" maxlength="60"></div>
        <div class="field"><label>Tagline</label><input class="input" name="app_tagline" value="${s.app_tagline || ''}" maxlength="120"></div><div class="span-2"><button class="btn primary" type="submit">Save</button></div></form>`)}
      ${card(html`${icon('ruler', 'sm')} Logo layout`, html`<form data-logo class="col" style="gap:14px">
        <div class="field" style="margin:0"><label>Display</label><div class="btn-group" data-mode>${[['logo', 'Logo only'], ['logo_name', 'Logo + name'], ['name', 'Name only']].map(([v, l]) => html`<button type="button" class="btn ${b.logo_display === v ? 'active' : ''}" data-v="${v}">${l}</button>`)}</div>
          ${b.logo_url ? '' : html`<span class="hint">Upload a logo below to use the logo modes.</span>`}</div>
        <div class="form-grid">
          <div class="field"><label>Sidebar logo height <b data-out="logo_height">${b.logo_height}px</b></label><input type="range" min="16" max="120" name="logo_height" value="${b.logo_height}"></div>
          <div class="field"><label>Max logo width <b data-out="logo_max_width">${b.logo_max_width}px</b></label><input type="range" min="40" max="240" name="logo_max_width" value="${b.logo_max_width}"><span class="hint">The sidebar column is 260px wide (≈ 230px usable).</span></div>
          <div class="field"><label>Login page logo height <b data-out="login_logo_height">${b.login_logo_height}px</b></label><input type="range" min="20" max="160" name="login_logo_height" value="${b.login_logo_height}"></div>
          <div class="field"><label>Presets</label><div class="row wrap" style="gap:6px">${[['Compact', 28, 150, 40], ['Balanced', 36, 190, 52], ['Large', 56, 230, 80]].map(([l, a, w, g]) => html`<button type="button" class="btn sm" data-preset="${a},${w},${g}">${l}</button>`)}</div></div>
        </div>
        <div><div class="label mb-1">Live preview</div><div class="logo-preview" data-preview></div></div>
        <div><button class="btn primary" type="submit">Save logo layout</button></div></form>`)}
      <div class="grid grid-3">${asset('logo', 'Logo', b.logo_url, 'PNG/WEBP, transparent, ~400×100')}${asset('favicon', 'Favicon', b.favicon_url, 'Square PNG, 256×256')}${asset('background', 'Login & app background', b.background_url, 'JPG/WEBP, 1920×1080')}</div>
      <p class="small subtle">Branding is applied to every page, the login screen and e-mails. Users can override the app background in their own appearance settings.</p>`);
    const lf = el.querySelector('[data-logo]');
    const cur = { logo_display: b.logo_display, logo_height: b.logo_height, logo_max_width: b.logo_max_width, login_logo_height: b.login_logo_height };
    const preview = () => {
      ['logo_height', 'logo_max_width', 'login_logo_height'].forEach((k) => { cur[k] = +lf[k].value; lf.querySelector(`[data-out="${k}"]`).textContent = cur[k] + 'px'; });
      const pb = { ...b, ...cur };
      const vars = `--logo-h:${cur.logo_height}px;--logo-maxw:${cur.logo_max_width}px`;
      lf.querySelector('[data-preview]').innerHTML = String(html`
        <div class="mock" style="${vars}"><div class="sidebar-head" style="padding:0;min-height:0">${brandHtml(pb)}</div><div class="mock-nav"><i style="width:80%"></i><i style="width:65%"></i><i style="width:72%"></i></div><div class="tiny subtle mt-2">Sidebar (260px)</div></div>
        <div class="mock collapsed" style="${vars}">${pb.logo_url && cur.logo_display !== 'name' ? html`<img src="${pb.logo_url}" alt="" style="max-width:46px;max-height:40px">` : html`<span class="brand-mark">${icon('notebook-pen')}</span>`}<div class="tiny subtle mt-2" style="text-align:center">Collapsed</div></div>
        <div class="mock" style="grid-column:1/-1;background:linear-gradient(140deg,var(--accent),color-mix(in srgb,var(--accent) 40%,#0f172a));color:#fff;--login-logo-h:${cur.login_logo_height}px">
          <div class="auth-art" style="padding:0;background:none;min-height:0;display:block">${pb.logo_url ? html`<img class="brand-logo" src="${pb.logo_url}" alt="">` : html`<span class="brand-mark">${icon('notebook-pen')}</span>`} <b>${cur.logo_display !== 'logo' || !pb.logo_url ? pb.app_name : ''}</b></div>
          <div class="tiny mt-2" style="opacity:.8">Login page</div></div>`);
    };
    preview();
    lf.addEventListener('input', preview);
    lf.addEventListener('click', (e) => {
      const m = e.target.closest('[data-v]');
      if (m) { cur.logo_display = m.dataset.v; lf.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('active', x === m)); preview(); }
      const p = e.target.closest('[data-preset]');
      if (p) { const [a, w, g] = p.dataset.preset.split(',').map(Number); lf.logo_height.value = a; lf.logo_max_width.value = w; lf.login_logo_height.value = g; preview(); }
    });
    lf.addEventListener('submit', async (e) => {
      e.preventDefault();
      await withLoading(lf.querySelector('[type=submit]'), async () => {
        try { state.branding = await api.post('admin/branding-text', cur); emit('branding:changed'); toast('Logo layout saved', 'success'); } catch (err) { toastError(err); }
      });
    });
    el.querySelector('[data-text]').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { state.branding = await api.post('admin/branding-text', formData(e.target)); emit('branding:changed'); toast('Branding saved', 'success'); } catch (err) { toastError(err); }
    });
    el.addEventListener('click', async (e) => {
      const up = e.target.closest('[data-up]');
      const rm = e.target.closest('[data-rm]');
      if (up) {
        const [f] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp', multiple: false });
        if (!f) return;
        const fd = new FormData();
        fd.append('file', f);
        try { state.branding = await api.upload(`admin/branding/${up.dataset.up}`, fd); emit('branding:changed'); toast('Uploaded', 'success'); remount(el, tabs.branding); } catch (err) { toastError(err); }
      }
      if (rm) { try { state.branding = await api.post(`admin/branding/${rm.dataset.rm}/remove`); emit('branding:changed'); remount(el, tabs.branding); } catch (err) { toastError(err); } }
    });
  },

  async general(el) {
    const s = await api.get('admin/settings');
    el.innerHTML = String(html`<form data-form class="col" style="gap:18px">
      ${card('Defaults for new users', html`<div class="form-grid">
        <div class="field"><label>Default theme</label><select class="select" name="default_theme">${['system', 'light', 'dark'].map((t) => html`<option value="${t}" ${s.default_theme === t ? 'selected' : ''}>${t}</option>`)}</select></div>
        <div class="field"><label>Default accent color</label><div class="row">${ACCENTS.slice(0, 6).map((c) => html`<label><input type="radio" name="default_accent" value="${c}" class="sr-only" ${s.default_accent === c ? 'checked' : ''}><span class="accent-dot" style="--sw:${c};width:26px;height:26px"></span></label>`)}<input type="color" data-custom-accent value="${s.default_accent}"></div></div>
        <div class="field"><label>Default reminder (minutes before)</label><input class="input" type="number" min="0" max="10080" name="default_reminder_minutes" value="${s.default_reminder_minutes}"></div>
        <div class="field"><label>Self registration</label>${switchHtml('allow_registration', s.allow_registration === '1', 'Allow visitors to create accounts')}<span class="hint">Keep off so only administrators create accounts.</span></div>
        <div class="field"><label>Sharing</label>${switchHtml('allow_note_sharing', s.allow_note_sharing !== '0', 'Users may share notes, audio, mind maps, flowcharts and Drive files with other users')}</div></div>`)}
      ${card('Trash', html`<div class="form-grid">
        <div class="field"><label>Upload limits</label><a class="btn sm" href="#/admin/uploads" style="width:max-content">${icon('hard-drive-upload', 'sm')} Uploads & storage settings</a></div>
        <div class="field"><label>Auto-delete trash after (days)</label><input class="input" type="number" min="0" max="3650" name="trash_auto_delete_days" value="${s.trash_auto_delete_days}"><span class="hint">0 = never delete automatically.</span></div></div>`)}
      ${card('Application URL', html`<div class="field"><label>Public URL</label><input class="input" name="app_url" value="${s.app_url || ''}" placeholder="https://notes.example.com/"><span class="hint">Used for links inside e-mails sent by the cron job.</span></div>`)}
      <div><button class="btn primary" type="submit">Save settings</button></div></form>`);
    const form = el.querySelector('form');
    const syncDots = () => form.querySelectorAll('[name="default_accent"]').forEach((r) => r.nextElementSibling.classList.toggle('active', r.checked));
    syncDots();
    form.addEventListener('change', (e) => {
      syncDots();
      if (e.target.matches('[data-custom-accent]')) { form.querySelectorAll('[name="default_accent"]').forEach((r) => (r.checked = false)); }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(form);
      if (!d.default_accent) d.default_accent = form.querySelector('[data-custom-accent]').value;
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try { await api.post('admin/settings', d); const boot = await api.get('app'); state.branding = boot.branding; emit('branding:changed'); toast('Settings saved', 'success'); } catch (err) { toastError(err); }
      });
    });
  },

  async uploads(el) {
    const [s, st] = await Promise.all([api.get('admin/settings'), api.get('admin/storage')]);
    const KINDS = [
      ['image', 'Images', 'image', 'JPG, PNG, WebP — in notes, Drive and attachments', 'max_image_mb', 8],
      ['audio', 'Audio', 'mic', 'Voice recordings and MP3, WAV, M4A, OGG, WebM files', 'max_audio_mb', 25],
      ['video', 'Video', 'video', 'MP4, WebM, MOV, M4V', 'max_video_mb', 100],
      ['document', 'Documents', 'file-text', 'PDF, Word, Excel, PowerPoint, TXT, CSV (the size limit also applies to ZIP)', 'max_file_mb', 20],
      ['archive', 'ZIP archives', 'file-archive', 'ZIP files in Drive and attachments', null, null],
    ];
    const on = new Set(s.upload_kinds || []);
    const mbVal = (k, d) => (s[k] === null || s[k] === undefined || s[k] === '' ? d : +s[k]);
    const used = st.uploads_bytes + st.db_bytes;
    const cap = st.plan_bytes || null;
    const pct = cap ? Math.min(100, (used / cap) * 100) : null;
    const kindColors = { image: '#ec4899', recordings: '#6366f1', audio: '#0ea5e9', video: '#f97316', document: '#a855f7', archive: '#64748b' };
    const kindsUsed = Object.entries(st.by_kind).filter(([, v]) => v.size > 0);
    const byTotal = kindsUsed.reduce((a, [, v]) => a + v.size, 0);
    const topUsers = st.top_users.filter((u) => u.bytes > 0);
    el.innerHTML = String(html`<form data-form class="col" style="gap:18px">
      <div class="share-banner" style="margin:0">${icon('infinity', 'sm')}<span><b>No upload limits and no storage quota.</b> Files of any size can be uploaded — every file goes to the <code>uploads/</code> folder of your hosting (hPanel → File Manager), never into MySQL. The only ceiling is your hosting plan's disk space.</span></div>
      ${card(html`${icon('hard-drive', 'sm')} Storage on this hosting`, html`
        <div class="stats-grid" style="margin-bottom:14px">
          <div class="card stat" style="--c:#6366f1"><div class="stat-value">${fmtBytes(st.uploads_bytes)}</div><div class="stat-label">Files in uploads/</div></div>
          <div class="card stat" style="--c:#0ea5e9"><div class="stat-value">${fmtBytes(st.db_bytes)}</div><div class="stat-label">Database (text & metadata)</div></div>
          <div class="card stat" style="--c:#22c55e"><div class="stat-value" data-free>${st.disk_free === null ? '—' : fmtBytes(st.disk_free)}</div><div class="stat-label">Free disk reported by the server</div></div>
          <div class="card stat" style="--c:#f59e0b"><div class="stat-value">${fmtBytes(st.pending_bytes)}</div><div class="stat-label">Unfinished uploads</div></div>
        </div>
        ${cap ? html`<div class="row between small mb-1"><span>${fmtBytes(used)} of ${fmtBytes(cap)} plan</span><b style="color:${pct > 90 ? 'var(--danger)' : 'inherit'}">${pct.toFixed(1)}%</b></div>
          <div class="storage-bar mb-3"><span style="width:${pct}%;background:${pct > 90 ? 'var(--danger)' : 'var(--accent)'}"></span></div>
          ${pct > 90 ? html`<p class="small" style="color:var(--danger)">${icon('alert-triangle', 'sm')} Almost full. Empty the trash, delete old backups, or upgrade the hosting plan.</p>` : ''}` : ''}
        ${byTotal ? html`<div class="label mb-1">Files by type</div><div class="storage-bar mb-2">${kindsUsed.map(([k, v]) => html`<span style="width:${(v.size / byTotal) * 100}%;background:${kindColors[k] || '#999'}" data-tip="${k}: ${fmtBytes(v.size)}"></span>`)}</div>` : ''}
        <div class="row small" style="flex-wrap:wrap;gap:12px">${kindsUsed.map(([k, v]) => html`<span class="row" style="gap:6px"><span class="dot" style="background:${kindColors[k] || '#999'};width:9px;height:9px;border-radius:50%;display:inline-block"></span>${k} · ${v.count} · ${fmtBytes(v.size)}</span>`)}</div>
        <div class="form-grid mt-3">
          <div class="field"><label>Hosting plan disk size (GB)</label><input class="input" type="number" min="0" max="100000" name="storage_plan_gb" value="${s.storage_plan_gb || 0}"><span class="hint">Only for the usage bar above (see hPanel → Dashboard → Disk usage). 0 = don't show. This is <b>not</b> a limit.</span></div>
          <div class="field"><label>Keep free on the server (MB)</label><input class="input" type="number" min="0" max="1048576" name="min_free_disk_mb" value="${s.min_free_disk_mb ?? 200}"><span class="hint">Uploads that would leave less free space are refused, so the app, sessions and backups keep working. 0 = off.</span></div>
        </div>
        ${topUsers.length ? html`<div class="label mt-3 mb-1">Largest users</div><div class="table-wrap"><table class="table"><tbody>${topUsers.map((u) => html`<tr><td>${u.name} <span class="subtle tiny">${u.email}</span></td><td style="text-align:right">${fmtBytes(u.bytes)}</td></tr>`)}</tbody></table></div>` : ''}
        ${st.pending_bytes ? html`<button type="button" class="btn sm mt-2" data-act="cleanup">${icon('trash-2', 'sm')} Remove unfinished uploads</button>` : ''}`)}
      ${card(html`${icon('sliders-horizontal', 'sm')} File types`, html`
        <p class="small muted" style="margin-top:0">Turn a file type off to block it everywhere (Drive, note attachments, audio recordings). Size: <b>0 = no limit</b> (the default). Only enter a number if you ever want to cap a type. Profile photos and branding images are always allowed.</p>
        <div class="col" style="gap:10px">${KINDS.map(([k, label, ic, hint, key, def]) => html`<div class="upload-rule">
          <label class="switch"><input type="checkbox" name="upload_kinds[]" value="${k}" ${on.has(k) ? 'checked' : ''}><span class="track"></span></label>
          <div class="grow" style="min-width:0"><div class="row" style="gap:6px;font-weight:600">${icon(ic, 'sm')} ${label}</div><div class="tiny subtle">${hint}</div></div>
          ${key ? html`<div class="row" style="gap:6px"><input class="input sm" type="number" min="0" max="1048576" name="${key}" value="${mbVal(key, def)}" style="width:110px" aria-label="${label} max size in MB"><span class="small subtle">MB</span><span class="badge" data-unl="${key}">${mbVal(key, def) === 0 ? 'No limit' : ''}</span></div>` : html`<span class="small subtle">uses the Documents limit</span>`}
        </div>`)}</div>`)}
      ${card(html`${icon('upload', 'sm')} Large files`, html`<p class="small muted" style="margin:0">Your server accepts at most <b>${st.server.upload_max_filesize}</b> per request (PHP <code>upload_max_filesize</code>, post <code>${st.server.post_max_size}</code>). SmartNotes sends bigger files automatically in pieces of <b>${fmtBytes(st.server.chunk_bytes)}</b>, retries a piece if the connection drops, and joins them on the server — so a 2 GB video or a large backup works without changing PHP settings.</p>`)}
      <div><button class="btn primary" type="submit">Save upload settings</button></div></form>`);
    const form = el.querySelector('form');
    form.addEventListener('input', (e) => {
      const b = e.target.name && form.querySelector(`[data-unl="${e.target.name}"]`);
      if (b) b.textContent = e.target.value === '0' ? 'No limit' : '';
    });
    form.querySelector('[data-act="cleanup"]')?.addEventListener('click', async () => {
      try { const r = await api.post('admin/storage/cleanup'); toast(`Removed ${r.removed} unfinished upload(s), ${fmtBytes(r.bytes)} freed`, 'success'); remount(el, tabs.uploads); } catch (err) { toastError(err); }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(form);
      d.upload_kinds = d.upload_kinds || [];
      if (!d.upload_kinds.length && !(await confirm({ title: 'Block all uploads?', message: 'With every file type turned off, users cannot upload anything (profile photos still work).', confirmText: 'Block uploads', danger: true }))) return;
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try { await api.post('admin/settings', d); const boot = await api.get('app'); state.limits = boot.limits || state.limits; toast('Upload settings saved', 'success'); remount(el, tabs.uploads); } catch (err) { toastError(err); }
      });
    });
  },

  async email(el) {
    const s = await api.get('admin/email');
    const fromConfig = s.source === 'config';
    el.innerHTML = String(html`
      ${card(html`${icon('mail', 'sm')} SMTP server`, html`
        ${fromConfig ? html`<div class="badge info mb-2">${icon('lock', 'sm')} Defined in app/config.php — edit that file to change it.</div>` : ''}
        <form data-form class="form-grid">
          <div class="field"><label>SMTP host</label><input class="input" name="host" value="${s.host}" placeholder="smtp.hostinger.com" ${fromConfig ? 'disabled' : ''}></div>
          <div class="field"><label>Port</label><input class="input" type="number" name="port" value="${s.port}" ${fromConfig ? 'disabled' : ''}></div>
          <div class="field"><label>Username</label><input class="input" name="username" value="${s.username}" autocomplete="off" ${fromConfig ? 'disabled' : ''}></div>
          <div class="field"><label>Password</label><input class="input" type="password" name="password" autocomplete="new-password" placeholder="${s.password_set ? '•••••••• (saved, leave empty to keep)' : ''}" ${fromConfig ? 'disabled' : ''}><span class="hint">Stored encrypted with your APP key.</span></div>
          <div class="field"><label>Encryption</label><select class="select" name="encryption" ${fromConfig ? 'disabled' : ''}>${[['tls', 'TLS / STARTTLS (587)'], ['ssl', 'SSL (465)'], ['none', 'None (25)']].map(([v, l]) => html`<option value="${v}" ${s.encryption === v ? 'selected' : ''}>${l}</option>`)}</select></div>
          <div class="field"><label>Sender name</label><input class="input" name="from_name" value="${s.from_name}" ${fromConfig ? 'disabled' : ''}></div>
          <div class="field span-2"><label>Sender e-mail</label><input class="input" type="email" name="from_email" value="${s.from_email}" placeholder="noreply@yourdomain.com" ${fromConfig ? 'disabled' : ''}></div>
          <div class="span-2 row wrap">${fromConfig ? '' : html`<button class="btn primary" type="submit">Save SMTP</button>`}<button class="btn" type="button" data-a="test">${icon('send', 'sm')} Send test e-mail</button>
            <span class="badge ${s.configured ? 'success' : 'danger'}">${s.configured ? 'Configured' : 'Not configured'}</span></div>
        </form>
        <details class="mt-3 small"><summary style="cursor:pointer;font-weight:600">Common settings</summary><dl class="kv mt-2">
          <dt>Hostinger</dt><dd>smtp.hostinger.com · 465 SSL (or 587 TLS) · full mailbox address as username</dd>
          <dt>Gmail</dt><dd>smtp.gmail.com · 587 TLS · use an App Password (2-step verification required)</dd>
          <dt>Microsoft 365</dt><dd>smtp.office365.com · 587 TLS · SMTP AUTH must be enabled for the mailbox</dd>
          <dt>cPanel mail</dt><dd>mail.yourdomain.com · 465 SSL · mailbox address & password</dd></dl></details>`)}
      ${card(html`${icon('alarm-clock', 'sm')} Reminder scheduler`, html`
        <p class="small muted">Shared hosting has no background service, so reminders are processed by a scheduler that runs either from a <b>cPanel Cron Job</b> (recommended, precise) or piggy-backed on user traffic (fallback, runs at most every 2 minutes while someone uses the app).</p>
        <div class="field"><label>cPanel → Cron Jobs → “Once per five minutes”, command:</label><div class="code-box">${s.cron_command} >/dev/null 2>&1</div></div>
        ${s.cron_url ? html`<div class="field"><label>Or call this URL from an external cron service:</label><div class="code-box">${s.cron_url}</div><span class="hint">The real token is in app/config.php (cron.token).</span></div>` : ''}
        <div class="setting-row"><div class="info"><b>Traffic-based fallback</b><span>Process reminders while users are active (keep enabled if you cannot add a cron job).</span></div>${switchHtml('web_cron_enabled', s.web_cron_enabled)}</div>
        <div class="row between mt-2"><span class="small">${s.last_cron_run ? html`Last run: <b>${fmtDateTime(s.last_cron_run)}</b> (${s.last_cron_source})` : 'The scheduler has not run yet.'}</span><button class="btn sm" data-a="run">${icon('play', 'sm')} Run now</button></div>`)}
      ${state.user.role === 'admin' ? html`<div data-hmail></div>` : ''}
      ${card(html`${icon('inbox', 'sm')} E-mail log`, html`<div class="chips mb-2">${['', 'pending', 'sent', 'failed'].map((st) => html`<button class="chip ${st === '' ? 'active' : ''}" data-st="${st}">${st || 'All'} ${st && s.stats[st] ? html`<span class="subtle">${s.stats[st]}</span>` : ''}</button>`)}</div><div data-logs></div>`)}`);
    const form = el.querySelector('[data-form]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try { await api.post('admin/email', formData(form)); state.smtpConfigured = true; toast('SMTP settings saved', 'success'); remount(el, tabs.email); } catch (err) { toastError(err); }
      });
    });
    let status = '';
    const loadLogs = async () => {
      const r = await api.get('admin/email/logs', { status });
      el.querySelector('[data-logs]').innerHTML = r.items.length ? String(html`<div class="table-wrap"><table class="table"><thead><tr><th>Subject</th><th class="hide-sm">To</th><th>Status</th><th class="hide-sm">Scheduled</th><th></th></tr></thead><tbody>
        ${r.items.map((m) => html`<tr><td><div class="truncate" style="max-width:340px;font-weight:560">${m.subject}</div><div class="tiny subtle">${m.notification_type}${m.user_name ? ' · ' + m.user_name : ''}</div>${m.error_message ? html`<div class="tiny" style="color:var(--danger)">${m.error_message}</div>` : ''}</td>
          <td class="hide-sm small">${m.recipient_email}</td><td><span class="badge ${{ sent: 'success', failed: 'danger', pending: 'warning' }[m.status] || ''}">${m.status}</span></td>
          <td class="hide-sm small nowrap">${fmtDateTime(m.sent_at || m.scheduled_at)}</td><td>${m.status === 'failed' ? html`<button class="btn ghost sm" data-retry="${m.id}">Retry</button>` : ''}</td></tr>`)}</tbody></table></div>`)
        : String(empty({ icon: 'inbox', title: 'No e-mails', text: 'Reminder, agenda and test e-mails will be listed here.' }));
    };
    loadLogs();
    const hm = el.querySelector('[data-hmail]');
    if (hm) {
      // Mailbox (Hostinger Mail API) connections — inbox for admins, separate from the SMTP used for reminders.
      hm.innerHTML = String(card(html`${icon('mailbox', 'sm')} Mail inbox — Hostinger Mail API`, html`<div style="padding:20px;text-align:center"><span class="spinner"></span></div>`, html`<a class="btn ghost sm" href="#/mail">${icon('external-link', 'sm')} Open Mail</a>`));
      api.get('mail/status').then((st) => {
        const body = hm.querySelector('.card-body');
        body.innerHTML = '<p class="small muted" style="margin-top:0">Read and answer company e-mail in the Mail menu. Add one API token per domain (Hostinger e-mail order); delete a token to disconnect it. SMTP above is only used for reminder e-mails.</p>';
        body.appendChild(mailSettingsPanel({ status: st, compact: true }));
      }).catch((err) => { hm.querySelector('.card-body').innerHTML = String(html`<p class="small" style="color:var(--danger)">${err.message}</p>`); });
    }
    el.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'test') {
        const to = await prompt({ title: 'Send test e-mail', label: 'Recipient', value: state.user.email, type: 'email', confirmText: 'Send' });
        if (!to) return;
        const t = toast('Sending…', 'info', { timeout: 30000 });
        try { const r = await api.raw('POST', 'admin/email/test', { body: { to } }); t(); toast(r?.message || 'Test e-mail sent', 'success'); } catch (err) { t(); toast(err.message, 'error', { timeout: 10000 }); }
        loadLogs();
      }
      if (a === 'run') {
        await withLoading(e.target.closest('[data-a]'), async () => {
          try { const r = await api.post('admin/scheduler/run'); toast(`Scheduler: ${r.reminders} reminders, ${r.emails_sent} e-mails sent, ${r.emails_failed} failed`, 'success', { timeout: 6000 }); loadLogs(); } catch (err) { toastError(err); }
        });
      }
      const st = e.target.closest('[data-st]');
      if (st) { status = st.dataset.st; el.querySelectorAll('[data-st]').forEach((c) => c.classList.toggle('active', c === st)); loadLogs(); }
      const rt = e.target.closest('[data-retry]');
      if (rt) { try { const r = await api.post(`admin/email/${rt.dataset.retry}/retry`); toast(r.sent ? 'E-mail sent' : 'Sending failed again — see the error message', r.sent ? 'success' : 'error'); loadLogs(); } catch (err) { toastError(err); } }
    });
    el.addEventListener('change', async (e) => {
      if (e.target.name === 'web_cron_enabled') { try { await api.post('admin/settings', { web_cron_enabled: e.target.checked }); toast('Saved', 'success'); } catch (err) { toastError(err); } }
    });
  },

  async categories(el) {
    const d = await api.get('admin/categories');
    el.innerHTML = String(card('Default categories', html`<p class="small muted">These categories are created for every new user. One per line.</p>
      <form class="form-grid" data-form><div class="field"><label>Note categories</label><textarea class="textarea" rows="9" name="note">${d.note.join('\n')}</textarea></div>
      <div class="field"><label>Task categories</label><textarea class="textarea" rows="9" name="task">${d.task.join('\n')}</textarea></div>
      <div class="span-2 row"><label class="check small"><input type="checkbox" name="apply"> Also add missing categories to all existing users</label><div class="grow"></div><button class="btn primary" type="submit">Save</button></div></form>`));
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
      try { const r = await api.post('admin/categories', { note: lines(f.note), task: lines(f.task), apply_to_existing: f.apply }); toast(`Saved${r.applied ? ` · ${r.applied} categories added to users` : ''}`, 'success'); } catch (err) { toastError(err); }
    });
  },

  async backup(el) {
    const load = async () => {
      const r = await api.get('admin/backups');
      const users = can('manage_users') ? (await api.get('admin/users')).items : [];
      el.innerHTML = String(html`
        ${card(html`${icon('database-backup', 'sm')} Create backup`, html`<p class="small muted">Backups are generated with pure PHP (no shell access needed) and stored in <code>storage/backups</code>, which is not publicly accessible.</p>
          <div class="row wrap"><button class="btn primary" data-make="database">${icon('database', 'sm')} Database backup (.sql.gz)</button>
          <button class="btn" data-make="uploads" ${r.zip ? '' : 'disabled'}>${icon('folder-archive', 'sm')} Uploads archive (.zip)</button>
          <button class="btn" data-make="both" ${r.zip ? '' : 'disabled'}>${icon('package', 'sm')} Both</button></div>`)}
        ${card(html`${icon('archive', 'sm')} Backups`, r.items.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>File</th><th>Type</th><th>Size</th><th class="hide-sm">Created</th><th></th></tr></thead><tbody>
          ${r.items.map((b) => html`<tr><td class="small" style="word-break:break-all">${b.name}</td><td><span class="badge">${b.type}</span></td><td class="nowrap">${fmtBytes(b.size)}</td><td class="hide-sm small nowrap">${fmtDateTime(b.created_at)}</td>
            <td class="nowrap"><a class="btn ghost icon sm" href="api/index.php?route=admin/backups/${encodeURIComponent(b.name)}/download" data-tip="Download">${icon('download', 'sm')}</a>
            <button class="btn ghost icon sm" data-restore="${b.name}" data-tip="Restore">${icon('rotate-ccw', 'sm')}</button>
            <button class="btn ghost icon sm" data-delete="${b.name}" data-tip="Delete">${icon('trash-2', 'sm')}</button></td></tr>`)}</tbody></table></div>` : html`<p class="small subtle">No backups yet.</p>`)}
        ${card(html`${icon('upload', 'sm')} Restore from file`, html`<p class="small muted">Upload a <b>.sql</b> / <b>.sql.gz</b> database dump (replaces ALL current data) or an uploads <b>.zip</b> archive (adds/overwrites files). A safety backup is created automatically before a database restore.</p>
          <button class="btn danger" data-a="restore-upload">${icon('upload', 'sm')} Upload & restore…</button>`)}
        ${users.length ? card(html`${icon('file-json', 'sm')} Export user data`, html`<div class="row wrap"><select class="select" style="max-width:320px" data-user>${users.map((u) => html`<option value="${u.id}">${u.name} — ${u.email}</option>`)}</select>
          <button class="btn" data-a="export-user">${icon('download', 'sm')} Export JSON</button></div><p class="small subtle mt-1">Users can export/import their own data from Settings → Import / export.</p>`) : ''}`);
    };
    await load();
    const askRestore = async (what) => {
      const v = await prompt({ title: 'Confirm restore', label: `Restoring ${what} cannot be undone (a safety backup is created first for databases). Type RESTORE to continue.`, confirmText: 'Restore' });
      if (v !== 'RESTORE') { if (v !== null) toast('Type RESTORE to confirm', 'warning'); return false; }
      return true;
    };
    el.addEventListener('click', async (e) => {
      const mk = e.target.closest('[data-make]');
      if (mk) {
        await withLoading(mk, async () => { try { await api.post('admin/backups', { type: mk.dataset.make }); toast('Backup created', 'success'); await load(); } catch (err) { toastError(err); } });
        return;
      }
      const del = e.target.closest('[data-delete]');
      if (del) {
        if (!(await confirm({ title: 'Delete backup?', message: del.dataset.delete, confirmText: 'Delete' }))) return;
        try { await api.post(`admin/backups/${encodeURIComponent(del.dataset.delete)}/delete`); load(); } catch (err) { toastError(err); }
        return;
      }
      const rs = e.target.closest('[data-restore]');
      if (rs) {
        if (!(await askRestore(rs.dataset.restore))) return;
        const t = toast('Restoring… do not close this page', 'warning', { timeout: 600000 });
        try { const r = await api.raw('POST', `admin/backups/${encodeURIComponent(rs.dataset.restore)}/restore`, { body: { confirm: 'RESTORE' } }); t(); toast(r.message || 'Restored', 'success', { timeout: 8000 }); setTimeout(() => location.reload(), 1500); } catch (err) { t(); toastError(err); }
        return;
      }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'restore-upload') {
        const [f] = await pickFiles({ accept: '.sql,.gz,.zip', multiple: false });
        if (!f || !(await askRestore(f.name))) return;
        const fd = new FormData();
        fd.append('file', f);
        fd.append('confirm', 'RESTORE');
        const t = toast('Uploading & restoring…', 'warning', { timeout: 600000 });
        try { await api.upload('admin/restore-upload', fd); t(); toast('Restore completed', 'success'); setTimeout(() => location.reload(), 1500); } catch (err) { t(); toastError(err); }
      }
      if (a === 'export-user') window.location.href = `api/index.php?route=admin/users/${el.querySelector('[data-user]').value}/export`;
    });
  },

  async activity(el) {
    let page = 1, q = '';
    el.innerHTML = String(card(html`${icon('activity', 'sm')} Activity log`, html`<div class="toolbar"><div class="input-icon" style="width:min(300px,100%)">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search action, description, e-mail…" data-q></div></div><div data-list></div><div class="pager" data-pager></div>`));
    const load = async () => {
      const r = await api.get('admin/activity', { page, q });
      el.querySelector('[data-list]').innerHTML = r.items.length ? String(html`<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>User</th><th>Action</th><th class="hide-sm">Details</th><th class="hide-sm">IP</th></tr></thead><tbody>
        ${r.items.map((a) => html`<tr><td class="small nowrap" title="${a.created_at}">${timeAgo(a.created_at)}</td><td class="small">${a.user_name || html`<span class="subtle">system</span>`}</td>
          <td><span class="badge">${a.action}</span></td><td class="hide-sm small">${a.description || ''}${a.entity_id ? html` <span class="subtle">#${a.entity_id}</span>` : ''}</td><td class="hide-sm tiny subtle">${a.ip_address}</td></tr>`)}</tbody></table></div>`)
        : String(empty({ icon: 'activity', title: 'No activity found' }));
      const pages = Math.ceil(r.total / r.per_page);
      el.querySelector('[data-pager]').innerHTML = pages > 1 ? String(html`<span class="small subtle">Page ${page} of ${pages}</span><button class="btn sm" data-p="-1" ${page <= 1 ? 'disabled' : ''}>${icon('chevron-left', 'sm')}</button><button class="btn sm" data-p="1" ${page >= pages ? 'disabled' : ''}>${icon('chevron-right', 'sm')}</button>`) : '';
    };
    el.addEventListener('click', (e) => { const p = e.target.closest('[data-p]'); if (p) { page += +p.dataset.p; load(); } });
    el.querySelector('[data-q]').addEventListener('input', debounce((e) => { q = e.target.value.trim(); page = 1; load(); }, 300));
    await load();
  },
};

export default {
  title: 'Admin',
  async render(el, ctx) {
    const allowed = TABS.filter(([, , , perm]) => can(perm));
    if (!allowed.length) {
      el.innerHTML = String(empty({ icon: 'shield-x', title: 'Access denied', text: 'You do not have permission to view the admin panel.' }));
      return;
    }
    const tab = allowed.some(([k]) => k === ctx.params.tab) ? ctx.params.tab : allowed[0][0];
    el.innerHTML = String(html`<div class="page-head"><div><h1>Admin panel</h1><p>Manage users, branding, e-mail, reminders and backups.</p></div></div>
      <div class="settings-layout"><nav class="settings-nav">${allowed.map(([k, l, i]) => html`<a class="nav-item ${k === tab ? 'active' : ''}" href="#/admin/${k}">${icon(i, 'sm')}<span>${l}</span></a>`)}</nav>
      <div class="col" style="gap:18px;min-width:0" data-tab></div></div>`);
    ctx.setTitle('Admin · ' + allowed.find(([k]) => k === tab)[1]);
    const container = el.querySelector('[data-tab]');
    const d = document.createElement('div');
    d.className = 'col';
    d.style.gap = '18px';
    container.appendChild(d);
    try { await tabs[tab](d); } catch (e) { toastError(e); }
    return () => { charts.forEach((c) => c.destroy()); charts = []; };
  },
};
