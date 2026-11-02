// "Everyone" row of the share dialogs (v1.29): share a note, recording, mind map, flowchart, file or folder with every
// user — people added later get it too. Turning it off keeps the people you shared with one by one.
import { html, icon, h } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, toastError, confirm } from '../core/ui.js';

const WHAT = { note: 'note', audio: 'recording', mindmap: 'mind map', flowchart: 'flowchart', file: 'file', folder: 'folder' };

/**
 * @param {{type:string, id:number, onChange?:(state:object|null, initial?:boolean)=>void}} o
 * @returns {HTMLElement} the row (filled in once the state is loaded)
 */
export function shareAllRow({ type, id, onChange }) {
  const el = h('<div class="share-all" data-share-all><span class="spinner"></span></div>');
  let st = null, perms = ['view'], users = 0;
  const paint = () => {
    el.innerHTML = String(html`<span class="share-all-ic">${icon('globe', 'sm')}</span>
      <div class="grow" style="min-width:0"><b>Everyone</b><div class="tiny subtle">${st ? `Shared with all ${st.people} ${st.people === 1 ? 'user' : 'users'} · people added later get it too` : `All ${users} other ${users === 1 ? 'user' : 'users'}, also people added later`}</div></div>
      ${perms.includes('edit') ? html`<select class="select sm" style="width:auto" data-all-perm aria-label="Permission for everyone"><option value="view" ${st?.permission !== 'edit' ? 'selected' : ''}>Can view</option><option value="edit" ${st?.permission === 'edit' ? 'selected' : ''}>Can edit</option></select>` : ''}
      <label class="switch" aria-label="Share with everyone"><input type="checkbox" data-all-on ${st ? 'checked' : ''}><span class="track"></span></label>`);
  };
  const save = async (on) => {
    const permission = el.querySelector('[data-all-perm]')?.value || 'view';
    try {
      st = (await api.post(`shares-all/${type}/${id}`, { on, permission })).everyone;
      toast(on ? `Shared with everyone (${permission === 'edit' ? 'can edit' : 'can view'})` : 'No longer shared with everyone', 'success', { timeout: 1800 });
      onChange?.(st);
    } catch (e) { toastError(e); }
    paint();
  };
  el.addEventListener('change', async (e) => {
    if (e.target.matches('[data-all-on]')) {
      const on = e.target.checked;
      if (on && !(await confirm({ title: 'Share with everyone?', message: `Every user — and everyone who joins later — can open this ${WHAT[type]} and gets a notification. You can turn it off any time.`, confirmText: 'Share with everyone', danger: false, icon: 'globe' }))) { e.target.checked = false; return; }
      return save(on);
    }
    if (e.target.matches('[data-all-perm]') && st) save(true);
  });
  api.get(`shares-all/${type}/${id}`).then((r) => { st = r.everyone; perms = r.perms; users = r.users; paint(); onChange?.(st, true); }).catch((e) => { el.innerHTML = `<p class="small text-danger" style="margin:0">${e.message}</p>`; });
  return el;
}
