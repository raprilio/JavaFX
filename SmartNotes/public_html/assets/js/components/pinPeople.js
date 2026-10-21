// "Pin for people…" dialog (v1.24 notes, v1.26 flowcharts): an administrator chooses who sees an item pinned at the top
// of their list (read-only) — they get a notification. Suggested people (e.g. the ones @tagged) can be added in one click.
import { html, icon, h } from '../core/dom.js';
import { state } from '../core/store.js';
import { modal, toast } from '../core/ui.js';
import { userPicker } from './userPicker.js';

/**
 * @param {{title:string, itemTitle:string, what:string, current:Array, suggested?:Array, suggestedLabel?:string, prefill?:boolean, save:(ids:number[])=>Promise<any>}} o
 * @returns {Promise<any|null>} the save result, or null when cancelled
 */
export function openPinPeople({ title, itemTitle, what, current, suggested = [], suggestedLabel = '', prefill = true, save }) {
  const others = suggested.filter((p) => p.id !== state.user.id);
  const picker = userPicker({ value: current.length ? current : prefill ? others : [], placeholder: 'Type a name…' });
  const body = h(String(html`<div class="col" style="gap:12px">
    <p class="muted small" style="margin:0">These people see <b>${itemTitle || 'Untitled'}</b> pinned at the top of their ${what} (read-only) and get a notification.${current.length || !prefill ? '' : others.length ? ` ${suggestedLabel} are filled in.` : ''}</p>
    <div data-pick></div>
    ${others.length ? html`<button type="button" class="btn ghost sm" data-suggested style="width:max-content">${icon('user-plus', 'sm')} Add ${suggestedLabel.toLowerCase()} (${others.length})</button>` : ''}
  </div>`));
  body.querySelector('[data-pick]').appendChild(picker.el);
  body.querySelector('[data-suggested]')?.addEventListener('click', () => {
    picker.set([...new Map([...picker.users(), ...others].map((u) => [u.id, u])).values()]);
  });
  const run = async (ids) => {
    const r = await save(ids);
    toast(ids.length ? `Pinned for ${ids.length} ${ids.length === 1 ? 'person' : 'people'}` : 'Unpinned for those people', 'success');
    return r;
  };
  return modal({
    title, body, size: 'sm',
    actions: [
      ...(current.length ? [{ label: 'Unpin for all of them', left: true, onClick: () => run([]) }] : []),
      { label: 'Cancel', value: null },
      { label: 'Pin for them', variant: 'primary', icon: 'pin', onClick: () => {
        const ids = picker.get();
        if (!ids.length) { toast('Choose at least one person', 'info'); return false; }
        return run(ids);
      } },
    ],
  }).result;
}
