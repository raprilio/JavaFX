// "My mailboxes": every user connects their own Gmail / Yahoo / iCloud / IMAP mailbox (IMAP to read, SMTP to send).
// The company mailbox (Hostinger Mail API) is separate and only for administrators (see mailConnections.js).
import { html, icon, h, fmtDate } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, toastError, confirm, modal, withLoading } from '../core/ui.js';

const PROVIDERS = [
  ['gmail', 'Gmail', 'App password'],
  ['yahoo', 'Yahoo Mail', 'App password'],
  ['icloud', 'iCloud Mail', 'App-specific password'],
  ['custom', 'Other (IMAP / SMTP)', 'Password'],
];
const HELP = {
  gmail: html`<ol class="small muted" style="margin:6px 0 0;padding-left:18px">
    <li>Turn on <b>2-Step Verification</b> in your Google Account.</li>
    <li>Open <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a>, create an app password named “SmartNotes” and paste the 16 letters below.</li>
    <li>Your normal Gmail password will not work. Workspace (company) accounts may need the admin to allow app passwords.</li></ol>`,
  yahoo: html`<p class="small muted" style="margin:6px 0 0">Yahoo Account → Account security → <b>Generate app password</b>.</p>`,
  icloud: html`<p class="small muted" style="margin:6px 0 0">appleid.apple.com → Sign-In and Security → <b>App-Specific Passwords</b>.</p>`,
  custom: html`<p class="small muted" style="margin:6px 0 0">Ask your e-mail provider for the IMAP (incoming) and SMTP (outgoing) server settings.</p>`,
};
const SEC = [['ssl', 'SSL/TLS'], ['tls', 'STARTTLS'], ['none', 'None']];

function accountForm(a = null) {
  const p0 = a?.provider || 'gmail';
  const el = h(String(html`<form class="col mail-acc-form" style="gap:12px" autocomplete="off">
    <div class="field" style="margin:0"><label>Provider</label><select class="select" name="provider" ${a ? 'disabled' : ''}>${PROVIDERS.map(([v, l]) => html`<option value="${v}" ${v === p0 ? 'selected' : ''}>${l}</option>`)}</select>
      <div data-help></div></div>
    <div class="form-grid">
      <div class="field" style="margin:0"><label>E-mail address</label><input class="input" name="email" type="email" value="${a?.email || ''}" placeholder="you@gmail.com" required ${a ? 'readonly' : ''}></div>
      <div class="field" style="margin:0"><label data-pass-label>App password</label><input class="input" name="password" type="password" autocomplete="new-password" placeholder="${a ? 'Leave empty to keep the saved password' : 'xxxx xxxx xxxx xxxx'}" ${a ? '' : 'required'}></div>
      <div class="field" style="margin:0"><label>Name in the list <span class="subtle small">(optional)</span></label><input class="input" name="label" value="${a?.label || ''}" maxlength="80" placeholder="e.g. Gmail pribadi"></div>
      <div class="field" style="margin:0"><label>Sender name <span class="subtle small">(optional)</span></label><input class="input" name="display_name" value="${a?.display_name || ''}" maxlength="120" placeholder="e.g. Budi Santoso"></div>
    </div>
    <details data-adv ${p0 === 'custom' ? 'open' : ''}><summary class="small">Server settings</summary>
      <div class="form-grid mt-2">
        <div class="field" style="margin:0"><label>IMAP server</label><input class="input sm" name="imap_host" value="${a?.imap_host || ''}" placeholder="imap.example.com"></div>
        <div class="row" style="gap:8px"><div class="field" style="margin:0;width:90px;flex:none"><label>Port</label><input class="input sm" name="imap_port" type="number" value="${a?.imap_port || 993}"></div>
          <div class="field grow" style="margin:0"><label>Security</label><select class="select sm" name="imap_security">${SEC.map(([v, l]) => html`<option value="${v}" ${(a?.imap_security || 'ssl') === v ? 'selected' : ''}>${l}</option>`)}</select></div></div>
        <div class="field" style="margin:0"><label>SMTP server (sending)</label><input class="input sm" name="smtp_host" value="${a?.smtp_host || ''}" placeholder="smtp.example.com"></div>
        <div class="row" style="gap:8px"><div class="field" style="margin:0;width:90px;flex:none"><label>Port</label><input class="input sm" name="smtp_port" type="number" value="${a?.smtp_port || 465}"></div>
          <div class="field grow" style="margin:0"><label>Security</label><select class="select sm" name="smtp_security">${SEC.map(([v, l]) => html`<option value="${v}" ${(a?.smtp_security || 'ssl') === v ? 'selected' : ''}>${l}</option>`)}</select></div></div>
        <div class="field span-2" style="margin:0"><label>User name</label><input class="input sm" name="username" value="${a?.username || ''}" placeholder="Usually the e-mail address"></div>
      </div></details>
  </form>`));
  const sync = () => {
    const p = el.querySelector('[name="provider"]').value;
    el.querySelector('[data-help]').innerHTML = String(HELP[p]);
    el.querySelector('[data-pass-label]').textContent = PROVIDERS.find(([v]) => v === p)[2];
    if (p === 'custom') el.querySelector('[data-adv]').open = true;
  };
  el.querySelector('[name="provider"]').addEventListener('change', sync);
  sync();
  el.payload = () => {
    const d = Object.fromEntries(new FormData(el));
    d.provider = el.querySelector('[name="provider"]').value;
    // Preset providers fill the servers in on the server side unless the user typed their own.
    if (d.provider !== 'custom' && !el.querySelector('[data-adv]').open) ['imap_host', 'imap_port', 'imap_security', 'smtp_host', 'smtp_port', 'smtp_security', 'username'].forEach((k) => delete d[k]);
    if (!d.password) delete d.password;
    if (a) { delete d.email; delete d.provider; } // fixed once connected
    return d;
  };
  return el;
}

/** Add / edit a personal mailbox in a dialog. Resolves with the saved account or null. */
export async function openAccountForm(a = null) {
  const form = accountForm(a);
  const m = modal({
    title: a ? `Edit ${a.email}` : 'Add an e-mail account',
    body: form,
    className: 'mail-acc-modal',
    actions: [
      { label: 'Cancel', value: null },
      { label: a ? 'Save' : 'Connect', variant: 'primary', icon: 'plug', onClick: async () => {
        try {
          const saved = await api.post(a ? `mail/accounts/${a.id}` : 'mail/accounts', form.payload());
          toast(a ? 'Mailbox updated' : `${saved.email} connected`, 'success');
          return saved;
        } catch (e) { toastError(e); return false; }
      } },
    ],
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); m.el.querySelector('.btn.primary').click(); });
  return m.result;
}

/**
 * List of the user's own mailboxes with add / edit / delete.
 * @param {{accounts: Array, onChange?: () => void}} opts
 */
export function mailAccountsPanel({ accounts, onChange = () => {} }) {
  let list = accounts || [];
  const el = h('<div class="mail-accounts col" style="gap:10px"></div>');
  const paint = () => {
    el.innerHTML = String(html`
      ${list.length ? html`<div class="col" style="gap:8px">${list.map((a) => html`<div class="conn-row ${a.last_error ? 'bad' : 'ok'}" data-id="${a.id}">
          <span class="conn-ic">${icon(a.last_error ? 'mail-x' : 'mail', 'sm')}</span>
          <div class="grow" style="min-width:0"><b class="truncate" style="display:block">${a.label}</b>
            <div class="tiny subtle truncate">${a.email} · ${a.imap_host}${a.smtp_host ? '' : ' · read only (no SMTP)'} · added ${fmtDate(a.created_at)}</div>
            ${a.last_error ? html`<div class="small conn-err">${icon('alert-triangle', 'sm')} ${a.last_error}</div>` : ''}</div>
          <button type="button" class="btn ghost icon sm" data-act="edit" data-tip="Edit" aria-label="Edit ${a.email}">${icon('pencil', 'sm')}</button>
          <button type="button" class="btn ghost icon sm danger" data-act="remove" data-tip="Remove" aria-label="Remove ${a.email}">${icon('trash-2', 'sm')}</button></div>`)}</div>`
        : html`<p class="small subtle" style="margin:0">No personal mailbox yet. Connect Gmail or any IMAP mailbox — only you can see it.</p>`}
      <div><button type="button" class="btn primary sm" data-act="add">${icon('plus', 'sm')} Add e-mail (Gmail / IMAP)</button></div>`);
  };
  const refresh = async () => { try { list = (await api.get('mail/status')).accounts; } catch { /* keep */ } paint(); onChange(); };
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = list.find((x) => x.id === +b.closest('[data-id]')?.dataset.id);
    if (b.dataset.act === 'add') { if (await openAccountForm()) refresh(); }
    if (b.dataset.act === 'edit' && a) { if (await openAccountForm(a)) refresh(); }
    if (b.dataset.act === 'remove' && a) {
      if (!(await confirm({ title: `Remove ${a.email}?`, message: 'The mailbox disappears from SmartNotes and the saved password is deleted. Your e-mails stay with your provider.', confirmText: 'Remove' }))) return;
      await withLoading(b, async () => {
        try { await api.post(`mail/accounts/${a.id}/delete`); toast('Mailbox removed', 'success'); refresh(); } catch (err) { toastError(err); }
      });
    }
  });
  paint();
  return el;
}
