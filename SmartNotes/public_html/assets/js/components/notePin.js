// Notes PIN: lock screen, unlock dialog, set / change / reset / remove PIN, lock & unlock a note.
import { html, icon, h } from '../core/dom.js';
import { api } from '../core/api.js';
import { emit } from '../core/store.js';
import { toast, toastError, modal, confirm } from '../core/ui.js';

const pinInput = (name, label, extra = '') => html`<div class="field" style="margin:0"><label for="pin-${name}">${label}</label>
  <input class="input pin-input" id="pin-${name}" name="${name}" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="8" placeholder="••••" ${extra}></div>`;

export const pinStatus = () => api.get('notes-pin');

function errorText(el, msg) {
  const e = el.querySelector('[data-pin-error]');
  if (e) { e.textContent = msg || ''; e.hidden = !msg; }
}

/** Inline lock screen used by the note editor. Resolves when the session is unlocked. */
export function renderLockScreen(el, note, onUnlocked) {
  el.innerHTML = String(html`<div class="lock-screen">
    <div class="lock-card">
      <div class="lock-ic">${icon('lock', 'xl')}</div>
      <h2>${note.title || 'Locked note'}</h2>
      <p class="muted">This note is locked. Enter your notes PIN to open it.</p>
      <form data-unlock class="col" style="gap:10px;width:100%">
        <input class="input pin-input lg" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="8" placeholder="PIN" aria-label="Notes PIN" autofocus>
        <p class="pin-error" data-pin-error hidden></p>
        <button class="btn primary block" type="submit">${icon('lock-open', 'sm')} Unlock</button>
      </form>
      <div class="row" style="gap:14px;justify-content:center"><a href="#/notes" class="small">${icon('arrow-left', 'sm')} Back to notes</a><a href="#" class="small" data-forgot>Forgot PIN?</a></div>
    </div></div>`);
  const form = el.querySelector('[data-unlock]');
  setTimeout(() => form.pin.focus(), 50);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.classList.add('loading');
    try {
      await api.post('notes-pin/unlock', { pin: form.pin.value });
      emit('notes:changed');
      onUnlocked();
    } catch (err) {
      errorText(form, err.message);
      form.pin.value = '';
      form.pin.focus();
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
    } finally { btn.classList.remove('loading'); }
  });
  el.querySelector('[data-forgot]').addEventListener('click', async (e) => {
    e.preventDefault();
    if (await resetPinDialog()) onUnlocked();
  });
}

/** Modal PIN prompt; resolves true once unlocked. */
export function unlockNotes(message = 'Enter your notes PIN to continue.') {
  const body = h(String(html`<form class="col" style="gap:10px" novalidate>
    <p class="muted" style="margin:0">${message}</p>
    ${pinInput('pin', 'Notes PIN', 'autofocus')}
    <p class="pin-error" data-pin-error hidden></p>
    <a href="#" class="small" data-forgot>Forgot PIN?</a></form>`));
  let dlg;
  body.addEventListener('submit', (e) => { e.preventDefault(); dlg.el.querySelector('.modal-foot .btn.primary').click(); });
  body.querySelector('[data-forgot]').addEventListener('click', async (e) => {
    e.preventDefault();
    if (await resetPinDialog()) dlg.close(true);
  });
  dlg = modal({
    title: 'Unlock notes', body, size: 'sm',
    actions: [{ label: 'Cancel' }, { label: 'Unlock', variant: 'primary', icon: 'lock-open', onClick: async () => {
      try {
        await api.post('notes-pin/unlock', { pin: body.querySelector('[name=pin]').value });
        emit('notes:changed');
        return true;
      } catch (err) {
        errorText(body, err.message);
        body.querySelector('[name=pin]').value = '';
        return false;
      }
    } }],
  });
  return dlg.result.then((r) => r === true);
}

/** First PIN, or change it (needs the current PIN). Resolves to the new status or null. */
export async function setupPin({ change = false } = {}) {
  const body = h(String(html`<form class="col" style="gap:12px" novalidate>
    ${change ? '' : html`<p class="muted" style="margin:0">Choose a 4–8 digit PIN. It protects every note you lock. Use a PIN you don't use for your bank card.</p>`}
    ${change ? pinInput('current_pin', 'Current PIN', 'autofocus') : ''}
    ${pinInput('pin', change ? 'New PIN' : 'PIN', change ? '' : 'autofocus')}
    ${pinInput('confirm', 'Repeat PIN')}
    <p class="pin-error" data-pin-error hidden></p></form>`));
  body.addEventListener('submit', (e) => e.preventDefault());
  const r = await modal({
    title: change ? 'Change notes PIN' : 'Set a notes PIN', body, size: 'sm',
    actions: [{ label: 'Cancel' }, { label: 'Save PIN', variant: 'primary', onClick: async () => {
      const v = (n) => body.querySelector(`[name=${n}]`)?.value.trim() || '';
      if (!/^\d{4,8}$/.test(v('pin'))) { errorText(body, 'The PIN must be 4–8 digits.'); return false; }
      if (v('pin') !== v('confirm')) { errorText(body, 'The PINs do not match.'); return false; }
      try {
        const st = await api.post('notes-pin', change ? { pin: v('pin'), current_pin: v('current_pin') } : { pin: v('pin') });
        toast(change ? 'Notes PIN changed' : 'Notes PIN set', 'success');
        return st;
      } catch (err) { errorText(body, err.message); return false; }
    } }],
  }).result;
  return r || null;
}

/** Forgot PIN: verify the account password and choose a new PIN. */
export async function resetPinDialog() {
  const body = h(String(html`<form class="col" style="gap:12px" novalidate>
    <p class="muted" style="margin:0">Confirm your account password and choose a new PIN. Your locked notes stay locked with the new PIN.</p>
    <div class="field" style="margin:0"><label for="pin-password">Account password</label><input class="input" id="pin-password" name="password" type="password" autocomplete="current-password" autofocus></div>
    ${pinInput('pin', 'New PIN')}
    ${pinInput('confirm', 'Repeat new PIN')}
    <p class="pin-error" data-pin-error hidden></p></form>`));
  body.addEventListener('submit', (e) => e.preventDefault());
  const r = await modal({
    title: 'Reset notes PIN', body, size: 'sm',
    actions: [{ label: 'Cancel' }, { label: 'Reset PIN', variant: 'primary', onClick: async () => {
      const v = (n) => body.querySelector(`[name=${n}]`).value.trim();
      if (!/^\d{4,8}$/.test(v('pin'))) { errorText(body, 'The PIN must be 4–8 digits.'); return false; }
      if (v('pin') !== v('confirm')) { errorText(body, 'The PINs do not match.'); return false; }
      try {
        await api.post('notes-pin', { pin: v('pin'), password: body.querySelector('[name=password]').value });
        toast('New notes PIN saved', 'success');
        emit('notes:changed');
        return true;
      } catch (err) { errorText(body, err.message); return false; }
    } }],
  }).result;
  return r === true;
}

/** Remove the PIN (all locked notes become normal notes). */
export async function removePinDialog() {
  const body = h(String(html`<form class="col" style="gap:12px" novalidate>
    <p class="muted" style="margin:0">All your locked notes will be unlocked and readable without a PIN.</p>
    ${pinInput('current_pin', 'Current PIN', 'autofocus')}
    <p class="pin-error" data-pin-error hidden></p></form>`));
  body.addEventListener('submit', (e) => e.preventDefault());
  const r = await modal({
    title: 'Remove notes PIN', body, size: 'sm',
    actions: [{ label: 'Cancel' }, { label: 'Remove PIN', variant: 'danger', onClick: async () => {
      try {
        const st = await api.post('notes-pin/remove', { current_pin: body.querySelector('[name=current_pin]').value });
        toast('Notes PIN removed', 'success');
        emit('notes:changed');
        return st;
      } catch (err) { errorText(body, err.message); return false; }
    } }],
  }).result;
  return r || null;
}

/** Lock (or remove the lock of) one note. Returns the updated note payload or null. */
export async function toggleNoteLock(note) {
  try {
    if (!note.is_locked) {
      let st = await pinStatus();
      if (!st.has_pin) {
        st = await setupPin();
        if (!st) return null;
      }
      const r = await api.post(`notes/${note.id}/lock`, { locked: true });
      toast('Note locked — it needs your PIN to open', 'success');
      emit('notes:changed');
      return r;
    }
    if (!(await confirm({ title: 'Remove the lock?', message: 'Anyone using your account will be able to open this note without the PIN.', confirmText: 'Remove lock', danger: false }))) return null;
    let r;
    try {
      r = await api.post(`notes/${note.id}/lock`, { locked: false });
    } catch (e) {
      if (e.status !== 423 || !(await unlockNotes('Enter your notes PIN to remove the lock.'))) throw e.status === 423 ? Object.assign(new Error('The note is still locked.'), { quiet: true }) : e;
      r = await api.post(`notes/${note.id}/lock`, { locked: false });
    }
    toast('Lock removed', 'success');
    emit('notes:changed');
    return r;
  } catch (e) {
    if (!e.quiet) toastError(e);
    return null;
  }
}

/** Lock every locked note again right now (ends the unlocked session window). */
export async function lockNow() {
  await api.post('notes-pin/lock');
  emit('notes:changed');
  toast('Locked notes are locked again', 'success', { timeout: 1800 });
}
