// Hostinger Mail API settings: list / add / rename / delete API connections (one token per e-mail order or domain),
// plus the default mailbox and sender name. Used in Mail → Settings and Admin → Email & reminders.
import { html, icon, h, fmtDate } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, toastError, confirm, prompt, withLoading } from '../core/ui.js';

/**
 * @param {{status: object, onChange?: (status: object) => void, compact?: boolean}} opts
 * @returns {HTMLElement}
 */
export function mailSettingsPanel({ status, onChange = () => {}, compact = false }) {
  let st = status;
  const el = h('<div class="mail-settings col" style="gap:18px"></div>');

  const update = (next, msg) => {
    st = next;
    if (msg) toast(msg, 'success');
    paint();
    onChange(st);
  };

  function paint() {
    const conns = st.connections || [];
    const byConn = (id) => (st.mailboxes || []).filter((m) => m.connection === id);
    el.innerHTML = String(html`
      <section>
        <div class="row between mb-2"><div class="section-title" style="margin:0">${icon('plug', 'sm')} API connections <span class="subtle small">${conns.length}</span></div>
          ${conns.length ? html`<button type="button" class="btn ghost sm" data-act="refresh">${icon('refresh-cw', 'sm')} Check again</button>` : ''}</div>
        ${conns.length ? html`<div class="col" style="gap:8px">${conns.map((c) => html`<div class="mc-row ${c.error ? 'bad' : 'ok'}" data-id="${c.id}">
            <span class="mc-ic">${icon(c.error ? 'unplug' : 'plug', 'sm')}</span>
            <div class="grow" style="min-width:0">
              <div class="row" style="gap:6px"><b class="truncate">${c.label}</b>${c.source === 'config' ? html`<span class="badge">config.php</span>` : ''}</div>
              <div class="tiny subtle">Token <code>${c.token_hint}</code>${c.added_at ? html` · added ${fmtDate(c.added_at)}` : ''}</div>
              ${c.error ? html`<div class="small mc-err">${icon('alert-triangle', 'sm')} ${c.error}</div>`
                : html`<div class="mc-boxes">${c.mailboxes.length ? c.mailboxes.map((a) => html`<span class="badge">${icon('at-sign', 'xs')} ${a}</span>`) : html`<span class="tiny subtle">No mailboxes in this order yet</span>`}</div>`}
            </div>
            ${c.source === 'config' ? html`<span class="tiny subtle" data-tip="Remove it from app/config.php">${icon('lock', 'sm')}</span>` : html`
              <button type="button" class="btn ghost icon sm" data-act="rename" data-tip="Rename" aria-label="Rename ${c.label}">${icon('pencil', 'sm')}</button>
              <button type="button" class="btn ghost icon sm danger" data-act="remove" data-tip="Delete API" aria-label="Delete ${c.label}">${icon('trash-2', 'sm')}</button>`}
          </div>`)}</div>` : html`<p class="small subtle" style="margin:0">No API connected yet. Add the token of your Hostinger e-mail order below.</p>`}
      </section>

      <section>
        <div class="section-title">${icon('plus', 'sm')} Add API</div>
        <form class="form-grid" data-form="add" autocomplete="off">
          <div class="field" style="margin:0"><label for="mc-label">Name <span class="subtle small">(optional)</span></label><input class="input" id="mc-label" name="label" maxlength="80" placeholder="e.g. contoh.co.id"></div>
          <div class="field" style="margin:0"><label for="mc-token">API token</label><input class="input" id="mc-token" name="token" type="password" autocomplete="new-password" placeholder="Paste the Hostinger Mail API token" required></div>
          <div class="field span-2" style="margin:0"><button class="btn primary" type="submit" style="width:max-content">${icon('plug', 'sm')} Add API</button>
            <span class="hint">The token is checked with Hostinger before it is saved, then stored encrypted. Add one token per domain / e-mail order.</span></div>
        </form>
        ${compact ? '' : html`<details class="mc-help mt-2"><summary class="small">Where do I find the token?</summary><ol class="small muted" style="margin:6px 0 0;padding-left:18px">
          <li>Open <b>hPanel → Emails</b> and choose the domain.</li>
          <li>Open the <b>email provisioning / Mail API</b> section and create an <b>API token</b>.</li>
          <li>A token can read every mailbox of that order — keep it secret.</li></ol></details>`}
      </section>

      ${(st.mailboxes || []).length ? html`<section>
        <div class="section-title">${icon('settings-2', 'sm')} Defaults</div>
        <form class="form-grid" data-form="defaults">
          <div class="field" style="margin:0"><label>Default mailbox</label><select class="select" name="default_mailbox">
            ${conns.filter((c) => byConn(c.id).length).map((c) => html`<optgroup label="${c.label}">${byConn(c.id).map((m) => html`<option value="${m.resourceId}" ${m.resourceId === st.default_mailbox ? 'selected' : ''}>${m.address}</option>`)}</optgroup>`)}
          </select></div>
          <div class="field" style="margin:0"><label>Sender display name</label><input class="input" name="display_name" value="${st.display_name || ''}" maxlength="120" placeholder="e.g. PT Contoh Indonesia"></div>
          <div class="field span-2" style="margin:0"><button class="btn" type="submit" style="width:max-content">${icon('save', 'sm')} Save defaults</button></div>
        </form>
      </section>` : ''}
      ${conns.length && conns.some((c) => c.source !== 'config') ? html`<div><button type="button" class="btn ghost sm danger" data-act="remove-all">${icon('unplug', 'sm')} Delete all APIs</button></div>` : ''}`);
  }

  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('[type=submit]');
    if (form.dataset.form === 'add') {
      await withLoading(btn, async () => {
        try {
          const next = await api.post('mail/settings', { token: form.token.value.trim(), label: form.label.value.trim() });
          const added = next.connections[next.connections.length - 1];
          update(next, `API added — ${added?.mailboxes.length ?? 0} mailbox${added?.mailboxes.length === 1 ? '' : 'es'} found`);
        } catch (err) { toastError(err); form.token.focus(); }
      });
    } else if (form.dataset.form === 'defaults') {
      await withLoading(btn, async () => {
        try { update(await api.post('mail/settings', { default_mailbox: form.default_mailbox.value, display_name: form.display_name.value }), 'Mail defaults saved'); } catch (err) { toastError(err); }
      });
    }
  });

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('[data-id]')?.dataset.id;
    const conn = (st.connections || []).find((c) => c.id === id);
    try {
      if (b.dataset.act === 'refresh') {
        update(await api.get('mail/status', { refresh: 1 }), 'Connections checked');
      } else if (b.dataset.act === 'remove' && conn) {
        const ok = await confirm({ title: `Delete API "${conn.label}"?`, message: `${conn.mailboxes.length ? conn.mailboxes.join(', ') + ' will disappear from Mail. ' : ''}The token is removed from SmartNotes; your e-mails stay on Hostinger.`, confirmText: 'Delete API' });
        if (ok) update(await api.post('mail/settings', { remove: id }), 'API deleted');
      } else if (b.dataset.act === 'rename' && conn) {
        const label = await prompt({ title: 'Rename API connection', label: 'Name', value: conn.label });
        if (label && label.trim() !== conn.label) update(await api.post('mail/settings', { rename: id, label: label.trim() }), 'Renamed');
      } else if (b.dataset.act === 'remove-all') {
        const ok = await confirm({ title: 'Delete all APIs?', message: 'Every saved Hostinger Mail token is removed and Mail is disconnected. Your e-mails stay on Hostinger.', confirmText: 'Delete all' });
        if (ok) update(await api.post('mail/settings', { disconnect: true }), 'All APIs deleted');
      }
    } catch (err) { toastError(err); }
  });

  paint();
  return el;
}
