// Admin: pin a note for chosen people (v1.24) — like "Pin for everyone", but only for the people tagged in the note
// (or anyone else the admin adds). They see it in "Pinned by admin — for you", read-only, and get a notification.
import { api } from '../core/api.js';
import { openPinPeople as dialog } from './pinPeople.js';

/**
 * @param {{id:number, title?:string, pin_targets?:Array, mentions?:Array}} note
 * @param {Array<{id:number,name:string}>} [mentions] the people @mentioned now (the editor passes its live list)
 * @returns {Promise<object|null>} the saved note payload, or null when cancelled
 */
export async function openPinPeople(note, mentions = note.mentions || []) {
  const current = note.pin_targets || (await api.get(`notes/${note.id}`)).pin_targets || [];
  return dialog({
    title: 'Pin for tagged people', itemTitle: note.title, what: 'notes', current,
    suggested: mentions, suggestedLabel: 'Everyone tagged with @',
    save: (ids) => api.post(`notes/${note.id}/pin-people`, { user_ids: ids }),
  });
}
