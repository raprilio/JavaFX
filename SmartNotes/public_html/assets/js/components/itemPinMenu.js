// Pin menu of the flowchart and mind map editors (v1.26 / v1.27): pin to top for me (anyone) and, on my own item,
// pin for everyone / for chosen people (people with the "Pin for everyone" permission — administrators always).
import { api } from '../core/api.js';
import { can } from '../core/store.js';
import { menu, confirm, toast, toastError } from '../core/ui.js';
import { openPinPeople } from './pinPeople.js';

export const pinActive = (p) => !!(p.pinned || p.pinned_global || p.pin_target_count);

/**
 * @param {HTMLElement} btn the pin button (gets .active while something is pinned)
 * @param {{type:'flowchart'|'mindmap', id:number, what:string, title:()=>string, isOwner:boolean, pins:object, onChange:(pins:object)=>void}} o
 */
export function openItemPinMenu(btn, { type, id, what, title, isOwner, pins, onChange }) {
  const done = (p) => { onChange(p); btn.classList.toggle('active', pinActive(p)); };
  const setPin = async (scope, on) => {
    try {
      done(await api.post(`pins/${type}/${id}`, { scope, pinned: on }));
      toast(on ? (scope === 'me' ? 'Pinned to the top of your list' : 'Pinned for everyone') : 'Unpinned', 'success', { timeout: 1600 });
    } catch (err) { toastError(err); }
  };
  menu(btn, [
    { label: pins.pinned ? 'Unpin (only me)' : 'Pin to top (only me)', icon: 'pin', onClick: () => setPin('me', !pins.pinned) },
    ...(isOwner && can('pin_everyone') ? [
      { label: pins.pinned_global ? 'Unpin for everyone' : 'Pin for everyone', icon: 'megaphone', onClick: async () => {
        if (!pins.pinned_global && !(await confirm({ title: 'Pin for everyone?', message: `This ${what} appears pinned at the top of every user's list (view only for them) and they get a notification.`, confirmText: 'Pin for everyone', danger: false, icon: 'megaphone' }))) return;
        setPin('everyone', !pins.pinned_global);
      } },
      { label: pins.pin_target_count ? `Pinned for people (${pins.pin_target_count})…` : 'Pin for people…', icon: 'user-check', onClick: async () => {
        const shares = (await api.get(`${type === 'mindmap' ? 'mindmaps' : 'flowcharts'}/${id}`).catch(() => null))?.shares || [];
        const r = await openPinPeople({ title: 'Pin for people', itemTitle: title(), what: `${what}s`, current: pins.pin_targets || [],
          suggested: shares.map((x) => ({ id: x.user_id, name: x.name, email: x.email })), suggestedLabel: 'Everyone it is shared with', prefill: false,
          save: (ids) => api.post(`pins/${type}/${id}/people`, { user_ids: ids }) });
        if (r) done(r);
      } },
    ] : []),
  ], { align: 'end' });
}
