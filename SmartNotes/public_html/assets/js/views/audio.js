// Audio notes: record, upload, play with waveform, rename, attach to note, delete.
import { html, icon, debounce, fmtDuration } from '../core/dom.js';
import { api } from '../core/api.js';
import { on } from '../core/store.js';
import { setQuery } from '../core/router.js';
import { toast, toastError, menu, confirm, prompt, empty, skeletonRows, modal } from '../core/ui.js';
import { audioItemHtml, bindAudioPlayers, uploadAudioFile, peaksFromFile, stopAudio, recorderSupported } from '../components/audio.js';
import { newRecording } from '../core/actions.js';
import { pickFiles } from '../components/attachments.js';
import { noteOptions } from '../components/forms.js';

export default {
  title: 'Audio Notes',
  async render(el, ctx) {
    let items = [];
    let q = ctx.query.q || '';
    el.innerHTML = String(html`
      <div class="page-head"><div><h1>Audio notes</h1><p data-sub>Record ideas and meetings directly from your browser.</p></div>
        <div class="row"><button class="btn" data-act="upload">${icon('upload', 'sm')} Upload audio</button>
        <button class="btn primary" data-act="record" ${recorderSupported() ? '' : 'disabled'}>${icon('mic', 'sm')} Record</button></div></div>
      <div class="card card-pad mb-3 row wrap" style="gap:18px;background:linear-gradient(120deg,var(--accent-softer),transparent)">
        <button class="rec-main" data-act="record" aria-label="Start recording" style="width:60px;height:60px">${icon('mic')}</button>
        <div class="grow" style="min-width:200px"><b style="font-size:16px">Quick voice note</b><p class="small muted" style="margin:2px 0 0">Tap to start recording. Pause, resume, listen back and save — recordings are stored on the server and available on all your devices.</p></div>
      </div>
      <div class="toolbar"><div class="input-icon" style="width:min(300px,100%)">${icon('search', 'sm')}<input class="input sm" type="search" placeholder="Search recordings…" value="${q}" data-search></div></div>
      <div data-list>${skeletonRows(4)}</div>`);
    const list = el.querySelector('[data-list]');

    async function load() {
      try {
        const r = await api.get('audio', { q, per_page: 100 });
        items = r.items;
        const total = items.reduce((s, a) => s + a.duration, 0);
        el.querySelector('[data-sub]').textContent = `${r.total} recording${r.total === 1 ? '' : 's'} · ${fmtDuration(total)} total`;
        list.innerHTML = items.length ? items.map((a) => String(audioItemHtml(a))).join('')
          : String(empty({ icon: 'mic', title: q ? 'No recordings found' : 'No audio notes yet', text: 'Record a voice memo or upload MP3, WAV, M4A, OGG or WEBM files.', action: recorderSupported() ? '<button class="btn primary" data-act="record">Start recording</button>' : '' }));
        if (ctx.query.play) {
          const it = list.querySelector(`[data-audio="${ctx.query.play}"]`);
          it?.scrollIntoView({ block: 'center' });
          it?.classList.add('playing');
          ctx.query.play = null;
        }
      } catch (e) { toastError(e); }
    }
    bindAudioPlayers(list, (id) => items.find((a) => a.id === id));

    async function upload() {
      const files = (await pickFiles({ accept: 'audio/*,.mp3,.wav,.m4a,.ogg,.webm,.aac' })).filter(Boolean);
      for (const f of files) {
        const t = toast(`Uploading ${f.name}…`, 'info', { timeout: 120000 });
        try {
          const meta = await peaksFromFile(f);
          await uploadAudioFile(f, { duration: meta.duration, peaks: meta.peaks });
          toast(`${f.name} uploaded`, 'success');
        } catch (e) { toastError(e); } finally { t(); }
      }
      load();
    }

    async function attachToNote(a) {
      const body = html`<div class="field"><label>Note</label><select class="select" data-note>${await noteOptions(a.note_id)}</select><span class="hint">The recording will appear in the selected note.</span></div>`;
      const m = modal({
        title: 'Attach to note', size: 'sm', body,
        actions: [{ label: 'Cancel' }, { label: 'Save', variant: 'primary', onClick: (ctx2) => ctx2.body.querySelector('[data-note]').value || '' }],
      });
      const v = await m.result;
      if (v === null || v === undefined) return;
      try { await api.post(`audio/${a.id}`, { note_id: v || null }); toast(v ? 'Attached to note' : 'Detached from note', 'success'); load(); } catch (e) { toastError(e); }
    }

    el.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'record') return newRecording();
      if (act === 'upload') return upload();
      const more = e.target.closest('[data-more]');
      if (!more) return;
      const a = items.find((x) => x.id === +more.closest('.audio-item').dataset.audio);
      menu(more, [
        { label: 'Rename', icon: 'pencil', onClick: async () => {
          const t = await prompt({ title: 'Rename recording', label: 'Title', value: a.title });
          if (!t) return;
          try { await api.post(`audio/${a.id}`, { title: t }); toast('Renamed', 'success'); load(); } catch (err) { toastError(err); }
        } },
        { label: a.note_id ? 'Change note' : 'Attach to note', icon: 'notebook-pen', onClick: () => attachToNote(a) },
        { label: 'Download', icon: 'download', onClick: () => window.open(a.url, '_blank', 'noopener') },
        { divider: true },
        { label: 'Delete', icon: 'trash-2', danger: true, onClick: async () => {
          if (!(await confirm({ title: 'Delete recording?', message: `"${a.title}" will be moved to the trash.`, confirmText: 'Delete' }))) return;
          stopAudio();
          try { await api.post(`items/audio/${a.id}/trash`); toast('Recording moved to trash', 'success', { action: 'Undo', onAction: () => api.post(`items/audio/${a.id}/restore`).then(load) }); load(); } catch (err) { toastError(err); }
        } },
      ], { align: 'end' });
    });
    const search = debounce(() => { setQuery({ q }); load(); }, 300);
    el.querySelector('[data-search]').addEventListener('input', (e) => { q = e.target.value.trim(); search(); });
    await load();
    const off = on('audio:changed', load);
    return () => { off(); stopAudio(); };
  },
};
