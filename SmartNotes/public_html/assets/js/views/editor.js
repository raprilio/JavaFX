// Note editor: rich text, checklist, images, audio, files, tags, category, color, autosave.
import { html, icon, h, esc, fmtDateTime, timeAgo, debounce, raw, fileBadge, fmtBytes, downloadBlob } from '../core/dom.js';
import { api, url as apiUrl, getCsrf } from '../core/api.js';
import { state, emit } from '../core/store.js';
import { navigate } from '../core/router.js';
import { shell } from '../core/shell.js';
import { toast, toastError, menu, confirm, colorPicker, setTitle, prompt } from '../core/ui.js';
import { createRTE } from '../components/rte.js';
import { tagInput, normalizeTag } from '../components/tagInput.js';
import { uploadFile, pickFiles } from '../components/attachments.js';
import { openImageViewer } from '../components/imageViewer.js';
import { audioItemHtml, bindAudioPlayers, openRecorder, uploadAudioFile, peaksFromFile, stopAudio } from '../components/audio.js';
import { openTaskForm, refreshTags } from '../components/forms.js';
import { openShareDialog } from '../components/share.js';
import { openFilePreview } from '../components/filePreview.js';
import { renderLockScreen, unlockNotes, toggleNoteLock, lockNow } from '../components/notePin.js';

export default {
  title: 'Note',
  async render(el, ctx) {
    const id = +ctx.params.id;
    let note;
    try {
      note = await api.get(`notes/${id}`);
    } catch (e) {
      el.innerHTML = String(html`<div class="content"><div class="empty"><div class="empty-art">${icon('file-x', 'xl')}</div><h3>Note not found</h3><p>${e.message}</p><a class="btn primary" href="#/notes">Back to notes</a></div></div>`);
      return;
    }
    // Re-mount the route (proper cleanup) after the lock state changes.
    const remount = () => navigate(location.hash.slice(1) || `/notes/${id}`);
    if (note.locked) {
      ctx.setTitle(note.title || 'Locked note');
      renderLockScreen(el, note, remount);
      return;
    }
    const isNew = ctx.query.new === '1';
    const trashed = !!note.deleted_at;
    const role = note.access || 'owner';
    const isOwner = role === 'owner';
    const readOnly = trashed || role === 'view';
    ctx.setTitle(note.title || 'Untitled note');

    let conflict = false;
    let closeConflictToast = null;
    let dirty = false, saving = false, lastSaved = { title: note.title, content: note.content || '' };
    let images = note.attachments.filter((a) => a.kind === 'image');
    let files = note.attachments.filter((a) => a.kind !== 'image');
    let audio = note.audio || [];

    el.innerHTML = String(html`
      <div class="editor-shell">
        <div class="editor-main" data-nc="${note.color || ''}" data-nbg="${note.background || ''}">
          <div class="editor-top">
            <a class="btn ghost icon sm" href="#/notes" data-tip="Back to notes">${icon('arrow-left')}</a>
            <span class="save-state" data-save><span class="d"></span><span data-save-text>Saved</span></span>
            <div class="grow"></div>
            ${trashed ? html`<span class="badge danger">${icon('trash-2', 'sm')} In trash</span><button class="btn sm" data-a="restore">${icon('rotate-ccw', 'sm')} Restore</button>` : ''}
            ${isOwner && !trashed && state.branding?.allow_note_sharing !== false ? html`<button class="btn ghost sm ${(note.shares || []).length ? 'active' : ''}" data-a="share" data-tip="Share with users">${icon('users', 'sm')}<span class="hide-sm">Share</span><span data-share-count>${(note.shares || []).length || ''}</span></button>` : ''}
            ${isOwner && note.is_locked && !trashed ? html`<button class="btn ghost icon sm active" data-a="lock-now" data-tip="Locked note · lock now">${icon('lock', 'sm')}</button>` : ''}
            ${isOwner ? html`<button class="btn ghost icon sm ${note.is_pinned ? 'active' : ''}" data-a="pin" data-tip="Pin">${icon('pin', 'sm')}</button>
            <button class="btn ghost icon sm ${note.is_favorite ? 'active' : ''}" data-a="favorite" data-tip="Favorite">${icon('star', 'sm')}</button>
            <button class="btn ghost icon sm" data-a="color" data-tip="Color & background">${icon('palette', 'sm')}</button>`
              : html`<button class="btn ghost icon sm ${note.share_pinned ? 'active' : ''}" data-a="spin" data-tip="Pin to my shared notes">${icon('pin', 'sm')}</button>`}
            <button class="btn ghost icon sm" data-a="info" data-tip="Details">${icon('panel-right', 'sm')}</button>
            <button class="btn ghost icon sm" data-a="more" data-tip="More">${icon('more-horizontal', 'sm')}</button>
          </div>
          ${!isOwner ? html`<div class="share-banner">${icon('users', 'sm')}<span>Shared by <b>${note.owner?.name || 'another user'}</b> · ${role === 'edit' ? 'you can edit the title and text' : 'view only'}${note.updated_by_name ? html` · last edited by ${note.updated_by_name}` : ''}</span></div>` : ''}
          <div data-toolbar></div>
          <div class="editor-paper" style="position:relative">
            <div class="drop-hint">${icon('upload', 'lg')}&nbsp; Drop to attach</div>
            <textarea class="note-title" rows="1" placeholder="Title" maxlength="255" data-title>${note.title || ''}</textarea>
            <div class="note-dates"><span>${icon('calendar-plus', 'sm')} Created ${fmtDateTime(note.created_at)}</span><span data-updated>${icon('clock', 'sm')} Edited ${timeAgo(note.updated_at)}</span><span data-words></span></div>
            <div data-editor></div>
            <section class="attach-section" data-images></section>
            <section class="attach-section" data-audio></section>
            <section class="attach-section" data-files></section>
            <div data-uploads></div>
          </div>
        </div>
        <aside class="inspector" data-inspector>
          <div class="row between show-sm" style="margin-bottom:6px"><b>Details</b><button class="btn ghost icon sm" data-a="info">${icon('x', 'sm')}</button></div>
          ${isOwner ? html`<h4>Category</h4>
          <select class="select sm" data-category><option value="">No category</option>${state.categories.note.map((c) => html`<option value="${c.id}" ${c.id === note.category_id ? 'selected' : ''}>${c.name}</option>`)}</select>
          <h4>Tags</h4><div data-tags></div>
          <h4>Quick actions</h4>
          <div class="col" style="gap:6px">
            <button class="btn sm" data-a="checklist-task">${icon('square-check-big', 'sm')} Create task from note</button>
            <button class="btn sm" data-a="record">${icon('mic', 'sm')} Record audio</button>
            <button class="btn sm" data-a="attach">${icon('paperclip', 'sm')} Attach file</button>
          </div>
          <h4>Related tasks</h4><div data-tasks></div>
          <h4>Linked Drive files <span class="subtle" style="text-transform:none;letter-spacing:0">(same #tag)</span></h4><div data-related class="related-files"></div>`
          : html`<h4>Owner</h4><p class="small">${note.owner?.name}<br><span class="subtle">${note.owner?.email}</span></p><h4>Your access</h4><p class="small">${role === 'edit' ? 'Can edit title & text' : 'View only'}</p>`}
          <h4>Info</h4>
          <dl class="kv small"><dt>Type</dt><dd data-type>${note.note_type}</dd><dt>Created</dt><dd>${fmtDateTime(note.created_at)}</dd><dt>Updated</dt><dd data-upd2>${fmtDateTime(note.updated_at)}</dd>
            <dt>Images</dt><dd data-cnt-img>${images.length}</dd><dt>Audio</dt><dd data-cnt-audio>${audio.length}</dd><dt>Files</dt><dd data-cnt-files>${files.length}</dd></dl>
        </aside>
      </div>`);
    const $ = (s) => el.querySelector(s);
    const main = $('.editor-main');
    const titleEl = $('[data-title]');
    const autoGrow = () => { titleEl.style.height = 'auto'; titleEl.style.height = titleEl.scrollHeight + 'px'; };
    autoGrow();

    // ------------------------------------------------------------ editor
    const rte = createRTE({
      content: note.content,
      placeholder: 'Start writing… Type "# " for a heading, "- " for a list, "[] " for a checklist.',
      onChange: () => markDirty(),
      onImages: isOwner ? (list) => uploadImages(list, true) : undefined,
      onAudio: isOwner ? (list) => (list ? uploadAudios(list) : record()) : undefined,
      onFiles: isOwner ? (list) => uploadFiles(list) : undefined,
      media: isOwner && !trashed,
      onImageOpen: (img) => {
        const fid = +img.dataset.fileId || +(img.getAttribute('src').match(/files\/(\d+)/) || [])[1];
        const k = images.findIndex((x) => x.id === fid);
        openImageViewer(images, Math.max(0, k), { onDelete: (im) => removeImage(im.id, false), onRotate: (u) => refreshImg(u) });
      },
    });
    $('[data-toolbar]').appendChild(rte.toolbar);
    $('[data-editor]').appendChild(rte.editor);
    if (readOnly) { rte.editor.contentEditable = 'false'; titleEl.readOnly = true; rte.toolbar.style.display = 'none'; }
    const tags = isOwner && tagInput({ value: note.tags, suggestions: state.tags.map((t) => t.name), placeholder: 'Add tag…', normalize: normalizeTag, prefix: '#', onChange: (v) => saveField({ tags: v }).then(refreshTags).then(() => loadRelated()) });
    if (tags) $('[data-tags]').appendChild(tags.el);

    // ------------------------------------------------------------ save
    const saveEl = $('[data-save]');
    function setSave(stateName, text) {
      saveEl.className = 'save-state ' + stateName;
      $('[data-save-text]').textContent = text;
    }
    function words() {
      const t = rte.getText().trim();
      const n = t ? t.split(/\s+/).length : 0;
      $('[data-words]').textContent = `${n} word${n === 1 ? '' : 's'} · ${t.length} chars`;
    }
    words();
    function markDirty() {
      if (readOnly) return;
      dirty = true;
      setSave('dirty', 'Unsaved changes');
      autosave();
      words();
    }
    const autosave = debounce(() => save(), 1200);
    async function save() {
      autosave.cancel();
      if (conflict) return;
      if (saving) { autosave(); return; }
      const payload = {};
      const title = titleEl.value.trim();
      const content = rte.getHTML();
      if (title !== lastSaved.title) payload.title = title;
      if (content !== lastSaved.content) payload.content = content;
      if (!Object.keys(payload).length) { dirty = false; setSave('', 'Saved'); return; }
      saving = true;
      let relock = false;
      setSave('saving', 'Saving…');
      try {
        payload.base_updated_at = note.updated_at;
        const r = await api.post(`notes/${id}`, payload);
        lastSaved = { title, content };
        note.updated_at = r.updated_at;
        note.note_type = r.note_type;
        dirty = false;
        setSave('', 'Saved');
        $('[data-updated]').innerHTML = String(html`${icon('clock', 'sm')} Edited just now`);
        $('[data-type]').textContent = r.note_type;
        $('[data-upd2]').textContent = fmtDateTime(r.updated_at);
        ctx.setTitle(title || 'Untitled note');
      } catch (e) {
        if (e.status === 423) {
          // The unlock window expired while editing: ask for the PIN after this attempt, then save again.
          setSave('error', 'Locked — enter your PIN');
          relock = true;
        } else if (e.status === 409) {
          // Someone else saved a newer version: never overwrite it silently.
          conflict = true;
          setSave('error', 'Conflict — not saved');
          closeConflictToast?.();
          closeConflictToast = toast(e.message, 'warning', { action: 'Reload', onAction: () => { dirty = false; location.reload(); }, timeout: 15000 });
        } else {
          setSave('error', 'Not saved — retrying');
          toastError(e);
          setTimeout(() => dirty && save(), 5000);
        }
      } finally { saving = false; }
      if (relock && await unlockNotes('Your notes were locked again after a period of inactivity. Enter your PIN to save your changes.')) save();
    }
    async function saveField(data) {
      try {
        const r = await api.post(`notes/${id}`, data);
        Object.assign(note, { is_pinned: r.is_pinned, is_favorite: r.is_favorite, is_archived: r.is_archived, color: r.color, background: r.background, category_id: r.category_id });
        return r;
      } catch (e) { toastError(e); }
    }
    shell.saveHandler = async () => { await save(); toast('Note saved', 'success', { timeout: 1500 }); };
    titleEl.addEventListener('input', () => { autoGrow(); markDirty(); });
    titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); rte.focus(); } });

    // ------------------------------------------------------------ attachments
    function renderImages() {
      $('[data-cnt-img]').textContent = images.length;
      $('[data-images]').innerHTML = images.length ? String(html`<h4>${icon('images', 'sm')} Images <span class="subtle">${images.length}</span></h4>
        <div class="gallery">${images.map((im, k) => html`<div class="g-item" data-k="${k}"><img src="${im.thumb_url}" alt="${im.name}" loading="lazy">
          <button class="btn icon xs g-del" data-del-img="${im.id}" aria-label="Delete">${icon('trash-2', 'sm')}</button></div>`)}</div>`) : '';
    }
    function renderAudio() {
      $('[data-cnt-audio]').textContent = audio.length;
      $('[data-audio]').innerHTML = audio.length ? String(html`<h4>${icon('audio-lines', 'sm')} Audio <span class="subtle">${audio.length}</span></h4>${audio.map((a) => audioItemHtml({ ...a, note_title: null }))}`) : '';
    }
    function renderFiles() {
      $('[data-cnt-files]').textContent = files.length;
      $('[data-files]').innerHTML = files.length ? String(html`<h4>${icon('paperclip', 'sm')} Files <span class="subtle">${files.length}</span></h4>${files.map((f) => html`${f.kind === 'video' ? html`<video class="note-video" controls playsinline preload="metadata" src="${f.url}"></video>` : ''}<div class="file-row" data-file="${f.id}">
        ${f.kind === 'video' ? html`<span class="file-icon video-badge" style="--fc:#0ea5e9">${icon('video', 'sm')}</span>` : fileBadge(f.name)}<div class="grow" style="min-width:0"><div class="truncate" style="font-weight:560">${f.name}</div><div class="tiny subtle">${fmtBytes(f.size)} · ${timeAgo(f.created_at)}</div></div>
        <a class="btn ghost icon sm" href="${f.url}" target="_blank" rel="noopener" data-tip="Open">${icon('external-link', 'sm')}</a>
        <a class="btn ghost icon sm" href="${f.download_url}" download data-tip="Download">${icon('download', 'sm')}</a>
        <button class="btn ghost icon sm" data-del-file="${f.id}" data-tip="Remove">${icon('trash-2', 'sm')}</button></div>`)}`) : '';
    }
    function refreshImg(u) {
      const i = images.findIndex((x) => x.id === u.id);
      if (i >= 0) images[i] = u;
      rte.editor.querySelectorAll(`img[data-file-id="${u.id}"]`).forEach((img) => (img.src = `api/index.php?route=files/${u.id}/raw&v=${u.v}`));
      renderImages();
      markDirty();
    }
    renderImages(); renderAudio(); renderFiles();
    bindAudioPlayers($('[data-audio]'), (aid) => audio.find((a) => a.id === aid));

    function progressRow(name) {
      const row = h(String(html`<div class="file-row">${fileBadge(name)}<div class="grow"><div class="truncate small">${name}</div><div class="upload-progress"><span></span></div></div></div>`));
      $('[data-uploads]').appendChild(row);
      return { set: (p) => (row.querySelector('span').style.width = Math.round(p * 100) + '%'), done: () => row.remove() };
    }
    async function uploadImages(list, inline) {
      for (const file of list) {
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast(`${file.name}: only JPG, PNG and WEBP images are supported`, 'warning'); continue; }
        const p = progressRow(file.name);
        try {
          const up = await uploadFile(file, { note_id: id, accept: 'image' }, p.set);
          images.push(up);
          if (inline) rte.insertHTML(`<img src="api/index.php?route=files/${up.id}/raw" data-file-id="${up.id}" alt="${esc(up.name)}"><p><br></p>`);
          renderImages();
        } catch (e) { toastError(e); } finally { p.done(); }
      }
      save();
    }
    async function uploadFiles(list) {
      for (const file of list) {
        if (/^image\/(jpeg|png|webp)$/.test(file.type)) { await uploadImages([file], true); continue; }
        if (/^audio\//.test(file.type)) { await uploadAudios([file]); continue; }
        const p = progressRow(file.name);
        try {
          files.push(await uploadFile(file, { note_id: id }, p.set));
          renderFiles();
          toast(`${file.name} attached`, 'success');
        } catch (e) { toastError(e); } finally { p.done(); }
      }
    }
    async function uploadAudios(list) {
      for (const file of list) {
        const p = progressRow(file.name);
        try {
          const meta = await peaksFromFile(file);
          audio.push(await uploadAudioFile(file, { noteId: id, duration: meta.duration, peaks: meta.peaks }, p.set));
          renderAudio();
          toast('Audio attached', 'success');
        } catch (e) { toastError(e); } finally { p.done(); }
      }
    }
    async function record() {
      const saved = await openRecorder({ noteId: id, title: (titleEl.value.trim() || 'Note') + ' — recording' });
      if (saved) { audio.push(saved); renderAudio(); emit('audio:changed'); }
    }
    async function removeImage(fid, ask = true) {
      if (ask && !(await confirm({ title: 'Delete image?', message: 'The image will be removed from this note and moved to the trash.', confirmText: 'Delete' }))) return;
      try {
        if (ask) await api.post(`items/file/${fid}/trash`);
        images = images.filter((x) => x.id !== fid);
        rte.editor.querySelectorAll(`img[data-file-id="${fid}"]`).forEach((i) => i.remove());
        renderImages();
        markDirty();
      } catch (e) { toastError(e); }
    }

    // ------------------------------------------------------------ actions
    el.addEventListener('click', async (e) => {
      const g = e.target.closest('.g-item');
      const delImg = e.target.closest('[data-del-img]');
      if (delImg) return removeImage(+delImg.dataset.delImg);
      if (g) return openImageViewer(images, +g.dataset.k, { onDelete: (im) => removeImage(im.id, false), onRotate: refreshImg });
      const delFile = e.target.closest('[data-del-file]');
      if (delFile) {
        if (!(await confirm({ title: 'Remove file?', message: 'The file will be moved to the trash.', confirmText: 'Remove' }))) return;
        try { await api.post(`items/file/${delFile.dataset.delFile}/trash`); files = files.filter((f) => f.id !== +delFile.dataset.delFile); renderFiles(); } catch (err) { toastError(err); }
        return;
      }
      const more = e.target.closest('.audio-item [data-more]');
      if (more) {
        const a = audio.find((x) => x.id === +more.closest('.audio-item').dataset.audio);
        return menu(more, [
          { label: 'Rename', icon: 'pencil', onClick: async () => { const t = await prompt({ title: 'Rename recording', value: a.title }); if (t) { await api.post(`audio/${a.id}`, { title: t }).catch(toastError); a.title = t; renderAudio(); } } },
          { label: 'Download', icon: 'download', onClick: () => window.open(a.url, '_blank') },
          { label: 'Detach from note', icon: 'unlink', onClick: async () => { await api.post(`audio/${a.id}`, { note_id: null }).catch(toastError); audio = audio.filter((x) => x.id !== a.id); renderAudio(); } },
          { divider: true },
          { label: 'Delete', icon: 'trash-2', danger: true, onClick: async () => { if (await confirm({ title: 'Delete recording?', message: 'It will be moved to the trash.', confirmText: 'Delete' })) { stopAudio(); await api.post(`items/audio/${a.id}/trash`).catch(toastError); audio = audio.filter((x) => x.id !== a.id); renderAudio(); } } },
        ], { align: 'end' });
      }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      const btn = e.target.closest('[data-a]');
      if (a === 'share') {
        const shares = await openShareDialog({ ...note, id });
        note.shares = shares;
        btn.classList.toggle('active', shares.length > 0);
        btn.querySelector('[data-share-count]').textContent = shares.length || '';
      }
      if (a === 'spin') {
        try {
          const r = await api.post(`notes/${id}/share-pin`, { pinned: !note.share_pinned });
          note.share_pinned = r.pinned;
          btn.classList.toggle('active', r.pinned);
          toast(r.pinned ? 'Pinned to your shared notes' : 'Unpinned', 'success', { timeout: 1500 });
        } catch (err) { toastError(err); }
      }
      if (a === 'pin') { const r = await saveField({ is_pinned: !note.is_pinned }); btn.classList.toggle('active', !!r?.is_pinned); toast(r?.is_pinned ? 'Pinned' : 'Unpinned', 'success', { timeout: 1500 }); }
      if (a === 'favorite') { const r = await saveField({ is_favorite: !note.is_favorite }); btn.classList.toggle('active', !!r?.is_favorite); toast(r?.is_favorite ? 'Added to favorites' : 'Removed from favorites', 'success', { timeout: 1500 }); }
      if (a === 'color') colorPicker(btn, note.color, async (c) => { await saveField({ color: c }); main.dataset.nc = note.color || ''; }, { backgrounds: true, currentBg: note.background, onBg: async (b) => { await saveField({ background: b }); main.dataset.nbg = note.background || ''; } });
      if (a === 'info') $('[data-inspector]').classList.toggle('open');
      if (a === 'lock-now') { await save(); await lockNow().catch(toastError); remount(); }
      if (a === 'record') record();
      if (a === 'attach') uploadFiles(await pickFiles());
      if (a === 'restore') { await api.post(`items/note/${id}/restore`).catch(toastError); toast('Note restored', 'success'); navigate(`/notes/${id}`, { replace: true }); }
      if (a === 'checklist-task') {
        await save();
        const t = await openTaskForm(null, { title: titleEl.value.trim() || 'Follow up', note_id: id });
        if (t?.id) loadTasks();
      }
      if (a === 'more' && !isOwner) {
        return menu(btn, [
          { label: 'Export as HTML', icon: 'file-code', onClick: () => exportNote('html') },
          { label: 'Export as text', icon: 'file-text', onClick: () => exportNote('txt') },
          { label: 'Print / save as PDF', icon: 'printer', onClick: () => window.print() },
          { divider: true },
          { label: 'Remove from my shared notes', icon: 'log-out', danger: true, onClick: async () => {
            if (!(await confirm({ title: 'Remove this note?', message: 'You will no longer see this shared note. The owner keeps it.', confirmText: 'Remove' }))) return;
            await save();
            await api.post(`notes/${id}/leave`).catch(toastError);
            ctx.beforeLeave = null;
            navigate('/notes?filter=shared');
          } },
        ], { align: 'end' });
      }
      if (a === 'more') {
        menu(btn, [
          { label: note.is_archived ? 'Unarchive' : 'Archive', icon: 'archive', onClick: async () => { const r = await saveField({ is_archived: !note.is_archived }); toast(r?.is_archived ? 'Note archived' : 'Note unarchived', 'success'); } },
          { label: 'Duplicate', icon: 'copy', onClick: async () => { await save(); const r = await api.post(`notes/${id}/duplicate`).catch(toastError); if (r) navigate(`/notes/${r.id}`); } },
          ...(trashed ? [] : [{ label: note.is_locked ? 'Remove lock' : 'Lock with PIN', icon: note.is_locked ? 'lock-open' : 'lock', onClick: async () => { await save(); if (await toggleNoteLock(note)) remount(); } }]),
          { label: 'Export as HTML', icon: 'file-code', onClick: () => exportNote('html') },
          { label: 'Export as text', icon: 'file-text', onClick: () => exportNote('txt') },
          { label: 'Print / save as PDF', icon: 'printer', onClick: () => window.print() },
          { divider: true },
          { label: 'Move to trash', icon: 'trash-2', danger: true, onClick: async () => {
            await save();
            await api.post(`items/note/${id}/trash`).catch(toastError);
            emit('notes:changed');
            toast('Note moved to trash', 'success', { action: 'Undo', onAction: () => api.post(`items/note/${id}/restore`).then(() => navigate(`/notes/${id}`)) });
            ctx.beforeLeave = null;
            navigate('/notes');
          } },
        ], { align: 'end' });
      }
    });
    $('[data-category]')?.addEventListener('change', (e) => saveField({ category_id: e.target.value || null }));

    function exportNote(kind) {
      const title = titleEl.value.trim() || 'note';
      if (kind === 'txt') downloadBlob(new Blob([title + '\n\n' + rte.getText()], { type: 'text/plain' }), title + '.txt');
      else downloadBlob(new Blob([`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><h1>${esc(title)}</h1>${rte.getHTML()}`], { type: 'text/html' }), title + '.html');
    }

    async function loadTasks() {
      try {
        const r = await api.get('tasks', { note_id: id });
        $('[data-tasks]').innerHTML = r.items.length ? r.items.map((t) => String(html`<a class="list-item" href="#/tasks?open=${t.id}" style="padding:6px 4px">
          <span class="t-check ${t.status === 'completed' ? 'on' : ''} prio-${t.priority}" style="width:18px;height:18px">${icon('check')}</span><span class="li-main truncate small">${t.title}</span></a>`)).join('')
          : '<p class="small subtle">No tasks linked yet.</p>';
      } catch { /* ignore */ }
    }
    let related = [];
    async function loadRelated() {
      const box = $('[data-related]');
      if (!box) return;
      try {
        related = await api.get(`notes/${id}/related-files`);
        box.innerHTML = related.length ? related.map((f) => String(html`<div class="file-row" data-rel="${f.id}" style="padding:7px 9px">${fileBadge(f.name)}
          <div class="grow" style="min-width:0"><div class="truncate small" style="font-weight:560">${f.name}</div><div class="tiny subtle truncate">${f.tags.map((t) => '#' + t).join(' ')}</div></div></div>`)).join('')
          : '<p class="small subtle">Add a #tag that is also used on a Drive file to link it here.</p>';
      } catch { /* ignore */ }
    }
    if (isOwner) { loadTasks(); loadRelated(); }
    el.addEventListener('click', (e) => {
      const r = e.target.closest('[data-rel]');
      if (r) openFilePreview(related.find((f) => f.id === +r.dataset.rel), related);
    });

    // Drag & drop anywhere on the paper
    const paper = $('.editor-paper');
    let depth = 0;
    paper.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { depth++; paper.classList.add('dragging-file'); } });
    paper.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; paper.classList.remove('dragging-file'); } });
    paper.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    paper.addEventListener('drop', (e) => {
      depth = 0;
      paper.classList.remove('dragging-file');
      if (e.defaultPrevented || !e.dataTransfer?.files?.length || !isOwner) return;
      e.preventDefault();
      uploadFiles(Array.from(e.dataTransfer.files));
    });

    // Flush unsaved changes when the tab is hidden/closed (sendBeacon carries the CSRF token in the body).
    const onHide = () => {
      if (!dirty || readOnly || conflict) return;
      const fd = new FormData();
      fd.append('_csrf', getCsrf());
      fd.append('title', titleEl.value.trim());
      fd.append('content', rte.getHTML());
      fd.append('base_updated_at', note.updated_at || '');
      navigator.sendBeacon?.(apiUrl(`notes/${id}`), fd);
    };
    const onBeforeUnload = (e) => { if (dirty) { onHide(); e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);

    ctx.beforeLeave = async () => {
      if (conflict && dirty) {
        const leave = await confirm({ title: 'Discard your changes?', message: 'Someone else saved a newer version of this note, so your latest edits were not saved. Leave and discard them? (Tip: copy your text first.)', confirmText: 'Discard & leave' });
        if (!leave) return false;
        dirty = false;
        return true;
      }
      if (dirty) await save();
      // Discard brand-new notes that were left completely empty.
      if (isNew && !titleEl.value.trim() && !rte.getText().trim() && !images.length && !audio.length && !files.length && !rte.editor.querySelector('img,table,hr')) {
        api.post(`items/note/${id}/destroy`).catch(() => {});
      }
      return true;
    };
    if (isNew) setTimeout(() => titleEl.focus(), 50);
    setTitle(note.title || 'Untitled note');

    return () => {
      closeConflictToast?.();
      stopAudio();
      rte.destroy();
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      shell.saveHandler = null;
    };
  },
};
export { raw };
