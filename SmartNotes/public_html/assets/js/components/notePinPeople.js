// Admin: pin a note for chosen people (v1.24) — like "Pin for everyone", but only for the people tagged in the note
// (or anyone else the admin adds). They see it in "Pinned by admin — for you", read-only, and get a notification.
import { html, icon, h } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { modal, toast } from '../core/ui.js';
import { userPicker } from './userPicker.js';

/**
 * @param {{id:number, title?:string, pin_targets?:Array, mentions?:Array}} note
 * @param {Array<{id:number,name:string}>} [mentions] the people @mentioned now (the editor passes its live list)
 * @returns {Promise<object|null>} the saved note payload, or null when cancelled
 */
export async function openPinPeople(note, mentions = note.mentions || []) {
  let current = note.pin_targets;
  if (!current) current = (await api.get(`notes/${note.id}`)).pin_targets || [];
  const tagged = mentions.filter((p) => p.id !== state.user.id);
  const picker = userPicker({ value: current.length ? current : tagged, placeholder: 'Type a name…' });
  const body = h(String(html`<div class="col" style="gap:12px">
    <p class="muted small" style="margin:0">These people see <b>${note.title || 'Untitled'}</b> pinned at the top of their notes (read-only) and get a notification.${current.length ? '' : tagged.length ? ' The people tagged with @ in the note are filled in.' : ' Nobody is tagged with @ in this note yet — add people here.'}</p>
    <div data-pick></div>
    ${tagged.length ? html`<button type="button" class="btn ghost sm" data-tagged style="width:max-content">${icon('at-sign', 'sm')} Add everyone tagged (${tagged.length})</button>` : ''}
  </div>`));
  body.querySelector('[data-pick]').appendChild(picker.el);
  body.querySelector('[data-tagged]')?.addEventListener('click', () => {
    picker.set([...new Map([...picker.users(), ...tagged].map((u) => [u.id, u])).values()]);
  });
  const save = async (ids) => {
    const r = await api.post(`notes/${note.id}/pin-people`, { user_ids: ids });
    toast(ids.length ? `Pinned for ${ids.length} ${ids.length === 1 ? 'person' : 'people'}` : 'Unpinned for tagged people', 'success');
    return r;
  };
  const m = modal({
    title: 'Pin for tagged people',
    body,
    size: 'sm',
    actions: [
      ...(current.length ? [{ label: 'Unpin for all of them', left: true, onClick: () => save([]) }] : []),
      { label: 'Cancel', value: null },
      { label: 'Pin for them', variant: 'primary', icon: 'pin', onClick: () => {
        const ids = picker.get();
        if (!ids.length) { toast('Choose at least one person', 'info'); return false; }
        return save(ids);
      } },
    ],
  });
  return m.result;
}
