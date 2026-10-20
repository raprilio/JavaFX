// Note editor: rich text, checklist, images, audio, files, tags, category, color, autosave.
import { html, icon, h, esc, fmtDateTime, timeAgo, debounce, raw, fileBadge, fmtBytes, downloadBlob } from '../core/dom.js';
import { api, url as apiUrl, getCsrf } from '../core/api.js';
import { state, emit } from '../core/store.js';
import { navigate } from '../core/router.js';
import { shell } from '../core/shell.js';
import { toast, toastError, menu, confirm, colorPicker, setTitle, prompt, modal } from '../core/ui.js';
import { createRTE } from '../components/rte.js';
import { tagInput, normalizeTag } from '../components/tagInput.js';
import { uploadFile, pickFiles } from '../components/attachments.js';
import { openImageViewer } from '../components/imageViewer.js';
import { audioItemHtml, bindAudioPlayers, openRecorder, uploadAudioFile, peaksFromFile, stopAudio } from '../components/audio.js';
import { openTaskForm, refreshTags } from '../components/forms.js';
import { openShareDialog } from '../components/share.js';
import { openPinPeople } from '../components/notePinPeople.js';
import { openFilePreview } from '../components/filePreview.js';
import { renderLockScreen, unlockNotes, toggleNoteLock, lockNow } from '../components/notePin.js';
import { openDrawingEditor, openDrawingViewer, normalizeDrawing } from '../components/drawPad.js';
import { openHref } from '../components/rteInline.js';

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
              : note.shared ? html`<button class="btn ghost icon sm ${note.share_pinned ? 'active' : ''}" data-a="spin" data-tip="Pin to my shared notes">${icon('pin', 'sm')}</button>` : ''}
            ${isOwner && (note.pin_targets || []).length && !trashed ? html`<span class="badge accent" data-people-badge data-tip="Pinned for ${(note.pin_targets || []).map((p) => p.name).join(', ')}">${icon('user-check', 'sm')}<span class="hide-sm">For ${note.pin_targets.length}</span></span>` : ''}
            ${isOwner && note.pinned_global && !trashed ? html`<span class="badge warning" data-global-badge data-tip="Everyone sees this note pinned at the top of their notes">${icon('megaphone', 'sm')}<span class="hide-sm">For everyone</span></span>` : ''}
            <button class="btn ghost icon sm" data-a="info" data-tip="Details">${icon('panel-right', 'sm')}</button>
            <button class="btn ghost icon sm" data-a="more" data-tip="More">${icon('more-horizontal', 'sm')}</button>
          </div>
          ${!isOwner && note.pinned_global ? html`<div class="share-banner global">${icon('megaphone', 'sm')}<span>Pinned for everyone by <b>${note.owner?.name || 'an administrator'}</b>${note.shared ? (role === 'edit' ? ' · shared with you, you can edit the title and text' : ' · view only') : ' · view only'}</span></div>` : ''}
          ${!isOwner && !note.pinned_global && note.pinned_for_me && !note.shared ? html`<div class="share-banner forme">${icon('user-check', 'sm')}<span>Pinned for you by <b>${note.pinned_by_name || 'an administrator'}</b> · view only</span></div>` : ''}
          ${!isOwner && !note.pinned_global && (note.shared || !note.pinned_for_me) ? html`<div class="share-banner">${icon('users', 'sm')}<span>Shared by <b>${note.owner?.name || 'another user'}</b> · ${role === 'edit' ? 'you can edit the title, text and checklists' : 'view only — the text and checklists cannot be changed'}${note.updated_by_name ? html` · last edited by ${note.updated_by_name}` : ''}</span></div>` : ''}
          <div data-toolbar></div>
          <div class="editor-paper" style="position:relative">
            <div class="drop-hint">${icon('upload', 'lg')}&nbsp; Drop to attach</div>
            <textarea class="note-title" rows="1" placeholder="Title" maxlength="255" data-title>${note.title || ''}</textarea>
            <div class="note-dates"><span>${icon('calendar-plus', 'sm')} Created ${fmtDateTime(note.created_at)}</span><span data-updated>${icon('clock', 'sm')} Edited ${timeAgo(note.updated_at)}</span><span data-words></span></div>
            <div class="mf-bar" data-mf hidden></div>
            <div data-editor></div>
            <section class="attach-section" data-refs></section>
            <section class="attach-section" data-images></section>
            <section class="attach-section" data-audio></section>
            <section class="attach-section" data-files></section>
            <section class="attach-section" data-folders></section>
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
            <button class="btn sm" data-a="link-folder">${icon('folder-plus', 'sm')} Link Drive folder</button>
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
      placeholder: 'Start writing… "@" mentions someone, "#" adds a link or a note reference, "# " makes a heading, "[] " a checklist.',
      noteId: id,
      onChange: () => { markDirty(); people(); },
      onMention: (u) => offerShare(u),
      onFocusPerson: (uid) => setFocus(uid),
      onImages: isOwner ? (list) => uploadImages(list, true) : undefined,
      onAudio: isOwner ? (list) => (list ? uploadAudios(list) : record()) : undefined,
      onFiles: isOwner ? (list) => uploadFiles(list) : undefined,
      media: isOwner && !trashed,
      onDraw: isOwner && !trashed ? () => drawNew() : undefined,
      onDrawingOpen: (fig, img) => openDrawing(fig, img),
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

    // ------------------------------------------------------------ @mentions: focus on a person (v1.16)
    // Everyone who can read the note can narrow it to the parts that mention them (or anyone else mentioned).
    let focusId = null, hits = [], hitAt = 0;
    const mfBar = $('[data-mf]');
    function paintPeople() {
      const list = rte.mentions();
      if (focusId && !list.some((p) => p.id === focusId)) { focusId = null; rte.focusPerson(null); }
      rte.editor.querySelectorAll('.sn-mention').forEach((m) => m.classList.toggle('me', +m.dataset.userId === state.user.id));
      mfBar.hidden = !list.length;
      if (!list.length) return;
      const me = list.find((p) => p.id === state.user.id);
      const ordered = me ? [me, ...list.filter((p) => p !== me)] : list;
      mfBar.innerHTML = String(html`<span class="mf-lbl">${icon('at-sign', 'xs')} Mentioned</span>
        ${ordered.map((p) => html`<button type="button" class="mf-chip ${p.id === focusId ? 'active' : ''} ${p.id === state.user.id ? 'me' : ''}" data-mf-user="${p.id}" aria-pressed="${p.id === focusId}">${p.id === state.user.id ? 'Me' : p.name}<b>${p.count}</b></button>`)}
        ${focusId ? html`<span class="mf-nav"><button type="button" class="btn ghost icon xs" data-mf-go="-1" aria-label="Previous mention">${icon('chevron-up', 'sm')}</button><span class="tiny" data-mf-pos>${hits.length ? hitAt + 1 : 0} / ${hits.length}</span><button type="button" class="btn ghost icon xs" data-mf-go="1" aria-label="Next mention">${icon('chevron-down', 'sm')}</button><button type="button" class="btn ghost icon xs" data-mf-user="0" data-tip="Show everything" aria-label="Show everything">${icon('x', 'sm')}</button></span>` : ''}`);
    }
    const people = debounce(() => { paintPeople(); paintRefs(); if (focusId) { hits = rte.focusPerson(focusId); hitAt = Math.min(hitAt, Math.max(0, hits.length - 1)); } }, 300);
    function setFocus(uid) {
      focusId = uid && uid !== focusId ? +uid : null;
      hits = rte.focusPerson(focusId);
      hitAt = 0;
      paintPeople();
      if (focusId && !hits.length) toast('This note does not mention them', 'info', { timeout: 1800 });
      hits[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    mfBar.addEventListener('click', (e) => {
      const u = e.target.closest('[data-mf-user]');
      if (u) return setFocus(+u.dataset.mfUser === focusId ? null : +u.dataset.mfUser || null);
      const g = e.target.closest('[data-mf-go]');
      if (g && hits.length) {
        hitAt = (hitAt + +g.dataset.mfGo + hits.length) % hits.length;
        hits[hitAt].scrollIntoView({ block: 'center', behavior: 'smooth' });
        const pos = mfBar.querySelector('[data-mf-pos]');
        if (pos) pos.textContent = `${hitAt + 1} / ${hits.length}`;
      }
    });
    /** A person was just mentioned: the owner may share the note with them so they can open it. */
    async function offerShare(u) {
      if (!u || u.id === state.user.id || !isOwner) return;
      if (note.pinned_global || (note.shares || []).some((s) => s.user_id === u.id) || (note.pin_targets || []).some((p) => p.id === u.id)) return;
      if (note.is_locked) return toast(`${u.name} cannot open a locked note`, 'info', { timeout: 2500 });
      if (state.branding?.allow_note_sharing === false) return;
      toast(`${u.name} cannot open this note yet`, 'info', { timeout: 9000, action: 'Share (view)', onAction: async () => {
        try {
          await save();
          await api.post(`notes/${id}/shares`, { user_ids: [u.id], permission: 'view' });
          note.shares = (await api.get(`notes/${id}`)).shares || [];
          const b = el.querySelector('[data-a="share"]');
          if (b) { b.classList.toggle('active', note.shares.length > 0); b.querySelector('[data-share-count]').textContent = note.shares.length || ''; }
          toast(`Shared with ${u.name} — they were notified`, 'success', { timeout: 2000 });
        } catch (err) { toastError(err); }
      } });
    }

    // ------------------------------------------------------------ references: every link in the note (v1.16)
    function paintRefs() {
      const box = $('[data-refs]');
      const list = rte.links();
      box.innerHTML = list.length ? String(html`<h4>${icon('link', 'sm')} References <span class="subtle">${list.length}</span></h4>
        <div class="ref-list">${list.map((l, i) => html`<a class="ref-row" href="${l.href}" data-ref="${i}" ${l.internal ? '' : raw('target="_blank" rel="noopener noreferrer"')}>
          <span class="ref-ic">${icon(l.internal ? 'file-text' : 'globe', 'sm')}</span>
          <span class="ref-main"><b class="truncate">${l.text || l.href}</b><span class="tiny subtle truncate" style="display:block">${l.internal ? 'Note in SmartNotes' : l.href.replace(/^https?:\/\/(www\.)?/i, '')}</span></span>
          ${icon(l.internal ? 'chevron-right' : 'external-link', 'sm')}</a>`)}</div>`) : '';
      box._links = list;
    }
    $('[data-refs]').addEventListener('click', (e) => {
      const r = e.target.closest('[data-ref]');
      if (!r) return;
      e.preventDefault();
      openHref(r.getAttribute('href'));
    });
    paintPeople();
    paintRefs();
    if (ctx.query.mention) setTimeout(() => setFocus(ctx.query.mention === 'me' ? state.user.id : +ctx.query.mention), 120);

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
    // ------------------------------------------------------------ handwriting (pen)
    // Stroke JSON goes gzip-compressed when the browser can (multi-page notebooks get large).
    async function drawingForm(r) {
      const fd = new FormData();
      const json = JSON.stringify(r.data);
      if (typeof CompressionStream === 'function' && json.length > 20000) {
        const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
        fd.append('data_gz', gz, 'strokes.json.gz');
      } else fd.append('data', json);
      fd.append('png', r.blob, 'handwriting.png');
      return fd;
    }
    const caption = (pages) => `Handwriting · ${pages} page${pages === 1 ? '' : 's'}`;
    const figureHtml = (d, view) => `<figure class="sn-drawing" data-drawing-id="${d.id}" data-view="${view}" data-pages="${d.pages || 1}" contenteditable="false"><img src="${d.png_url}" data-drawing-id="${d.id}" alt="Handwriting"><figcaption>${caption(d.pages || 1)}</figcaption></figure><p><br></p>`;
    /** Keep the figure's caption / page count in step with the drawing. */
    function decorate(fig, pages) {
      if (pages) fig.dataset.pages = pages;
      let cap = fig.querySelector('figcaption');
      if (!cap) { cap = document.createElement('figcaption'); fig.appendChild(cap); }
      cap.textContent = caption(+fig.dataset.pages || 1);
    }
    async function drawNew() {
      // A note that already has content gets the drawing minimized like an attachment; an empty note shows it full size.
      const hasContent = !!(rte.getText().trim() || rte.editor.querySelector('img, figure, table'));
      const r = await openDrawingEditor({ title: 'Handwriting' });
      if (!r?.data) return;
      try {
        const fd = await drawingForm(r);
        fd.append('note_id', id);
        const d = await api.upload('drawings', fd);
        rte.insertHTML(figureHtml(d, hasContent ? 'card' : 'full'));
        save();
        if (hasContent) toast('Handwriting added — click it to preview', 'success', { timeout: 2500 });
      } catch (e) { toastError(e); }
    }
    async function editDrawing(fig, img, d) {
      const did = +fig.dataset.drawingId;
      const r = await openDrawingEditor({ data: d.data, title: 'Handwriting' });
      if (!r) return;
      if (r.remove) return removeDrawing(fig, false);
      try {
        const u = await api.upload(`drawings/${did}`, await drawingForm(r));
        fig.querySelectorAll('img').forEach((im) => im.setAttribute('src', u.png_url));
        decorate(fig, u.pages);
        markDirty();
      } catch (e) { toastError(e); }
    }
    async function removeDrawing(fig, ask = true) {
      if (ask && !(await confirm({ title: 'Delete this handwriting?', message: 'It is removed from the note. You can undo right after.', confirmText: 'Delete' }))) return;
      const parent = fig.parentNode, next = fig.nextSibling;
      fig.remove();
      markDirty();
      toast('Handwriting deleted', 'success', { action: 'Undo', onAction: () => { parent.insertBefore(fig, next && next.parentNode === parent ? next : null); markDirty(); } });
    }
    /** Click on a drawing: preview its pages; the owner can edit, minimize / expand or delete it from there. */
    async function openDrawing(fig, img) {
      const did = +fig.dataset.drawingId;
      const canEdit = isOwner && !readOnly;
      let d;
      try { d = await api.get(`drawings/${did}`); } catch (e) { return toastError(e); }
      if (!d.data) return openImageViewer([{ id: did, name: 'Handwriting', url: img.getAttribute('src'), download_url: img.getAttribute('src') }], 0);
      decorate(fig, normalizeDrawing(d.data).pages);
      const card = fig.dataset.view === 'card';
      const act = await openDrawingViewer({
        data: d.data, title: 'Handwriting', pngUrl: img.getAttribute('src'),
        actions: canEdit ? [
          { key: 'delete', label: 'Delete', icon: 'trash-2', danger: true },
          { key: 'toggle', label: card ? 'Show full size in note' : 'Minimize in note', icon: card ? 'maximize-2' : 'minimize-2' },
          { key: 'edit', label: 'Edit', icon: 'pen-line', primary: true },
        ] : [],
      });
      if (act === 'edit') return editDrawing(fig, img, d);
      if (act === 'delete') return removeDrawing(fig);
      if (act === 'toggle') { fig.dataset.view = card ? 'full' : 'card'; markDirty(); }
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
          ...(note.shared ? [{ divider: true },
          { label: 'Remove from my shared notes', icon: 'log-out', danger: true, onClick: async () => {
            if (!(await confirm({ title: 'Remove this note?', message: 'You will no longer see this shared note. The owner keeps it.', confirmText: 'Remove' }))) return;
            await save();
            await api.post(`notes/${id}/leave`).catch(toastError);
            ctx.beforeLeave = null;
            navigate('/notes?filter=shared');
          } }] : []),
        ], { align: 'end' });
      }
      if (a === 'more') {
        menu(btn, [
          { label: note.is_archived ? 'Unarchive' : 'Archive', icon: 'archive', onClick: async () => { const r = await saveField({ is_archived: !note.is_archived }); toast(r?.is_archived ? 'Note archived' : 'Note unarchived', 'success'); } },
          ...(trashed ? [] : [{ label: 'Link Drive folder', icon: 'folder-plus', onClick: () => linkFolder() }]),
          { label: 'Duplicate', icon: 'copy', onClick: async () => { await save(); const r = await api.post(`notes/${id}/duplicate`).catch(toastError); if (r) navigate(`/notes/${r.id}`); } },
          ...(!trashed && state.user.role === 'admin' ? [{ label: note.pinned_global ? 'Unpin for everyone' : 'Pin for everyone', icon: 'megaphone', disabled: note.is_locked, onClick: async () => {
            const on = !note.pinned_global;
            if (on && !(await confirm({ title: 'Pin for everyone?', message: 'This note appears pinned at the top of every user\'s notes (read-only for them) and they get a notification.', confirmText: 'Pin for everyone', danger: false, icon: 'megaphone' }))) return;
            await save();
            try { const r = await api.post(`notes/${id}/pin-global`, { pinned: on }); note.pinned_global = r.pinned_global; toast(on ? 'Pinned for everyone' : 'Unpinned for everyone', 'success'); emit('notes:changed'); remount(); } catch (e) { toastError(e); }
          } }] : []),
          ...(!trashed && state.user.role === 'admin' ? [{ label: (note.pin_targets || []).length ? `Pinned for tagged people (${note.pin_targets.length})…` : 'Pin for tagged people…', icon: 'user-check', disabled: note.is_locked, onClick: async () => {
            await save();
            const r = await openPinPeople(note, rte.mentions());
            if (r) { note.pin_targets = r.pin_targets; emit('notes:changed'); remount(); }
          } }] : []),
          ...(trashed || note.pinned_global || (note.pin_targets || []).length ? [] : [{ label: note.is_locked ? 'Remove lock' : 'Lock with PIN', icon: note.is_locked ? 'lock-open' : 'lock', onClick: async () => { await save(); if (await toggleNoteLock(note)) remount(); } }]),
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
        $('[data-tasks]').innerHTML = r.items.length ? r.items.map((t) => String(html`<a class="list-item" href="#/tasks/mine?open=${t.id}" style="padding:6px 4px">
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

    // ------------------------------------------------------------ linked Drive folders (v1.14)
    // The note shows the files of the folders linked to it; a click previews a file, sub-folders open in place.
    let linkedFolders = [];
    const browse = new Map(); // folder id -> { trail: [{id, name}], folders, items, total, loading }
    const SHOW = 48;
    async function loadFolders() {
      try { linkedFolders = await api.get(`notes/${id}/folders`); } catch { linkedFolders = []; }
      renderFolders();
    }
    function folderCount(f) {
      if (!f.access) return 'Not shared with you';
      const parts = [`${f.file_count} file${f.file_count === 1 ? '' : 's'}`];
      if (f.folder_count) parts.push(`${f.folder_count} folder${f.folder_count === 1 ? '' : 's'}`);
      if (!f.mine) parts.push(`${f.owner_name}'s Drive`);
      return parts.join(' · ');
    }
    const driveHref = (f, cur) => (f.access === 'owner' ? `#/drive?folder=${cur}` : `#/drive?view=shared&folder=${cur}`);
    function renderFolders() {
      const box = $('[data-folders]');
      if (!box) return;
      const canLink = isOwner && !trashed;
      box.innerHTML = linkedFolders.length ? String(html`<h4>${icon('folder-open', 'sm')} Drive folders <span class="subtle">${linkedFolders.length}</span>
          ${canLink ? html`<button class="btn ghost xs nf-add" data-a="link-folder">${icon('plus', 'sm')} Link folder</button>` : ''}</h4>
        <div class="col" style="gap:8px">${linkedFolders.map((f) => {
          const b = browse.get(f.id);
          const cur = b ? b.trail[b.trail.length - 1].id : f.id;
          return html`<div class="nf-card ${b ? 'open' : ''} ${f.access ? '' : 'locked'}" data-nf="${f.id}" style="--fc:${f.color || 'var(--accent)'}">
            <div class="nf-head" data-nf-toggle="${f.id}" role="button" tabindex="0" aria-expanded="${b ? 'true' : 'false'}">
              <span class="nf-ic">${icon(f.access ? (b ? 'folder-open' : 'folder') : 'folder-lock', 'sm')}</span>
              <div class="grow" style="min-width:0"><div class="truncate nf-name">${f.name}</div><div class="tiny subtle truncate">${folderCount(f)}</div></div>
              ${f.access ? html`<a class="btn ghost icon xs" href="${driveHref(f, cur)}" data-tip="Open in Drive" aria-label="Open in Drive">${icon('external-link', 'sm')}</a>` : ''}
              ${canLink ? html`<button class="btn ghost icon xs" data-nf-unlink="${f.id}" data-tip="Unlink from this note" aria-label="Unlink ${f.name}">${icon('unlink', 'sm')}</button>` : ''}
              ${f.access ? html`<span class="nf-chev">${icon('chevron-down', 'sm')}</span>` : ''}
            </div>
            ${b ? html`<div class="nf-body">
              ${b.trail.length > 1 ? html`<div class="nf-trail small">${b.trail.map((t, i) => html`${i ? icon('chevron-right', 'xs') : ''}<a href="#" data-nf-go="${f.id}:${i}">${t.name}</a>`)}</div>` : ''}
              ${b.loading ? html`<div class="small subtle" style="padding:10px"><span class="spinner"></span></div>`
                : b.error ? html`<div class="small subtle">${b.error}</div>`
                : !b.folders.length && !b.items.length ? html`<div class="small subtle" style="padding:6px 2px">This folder is empty.</div>`
                : html`<div class="nf-grid">
                  ${b.folders.map((d) => html`<button type="button" class="nf-tile dir" data-nf-sub="${f.id}:${d.id}" title="${d.name}">${icon('folder', 'lg')}<span class="truncate">${d.name}</span></button>`)}
                  ${b.items.slice(0, SHOW).map((x, i) => html`<button type="button" class="nf-tile" data-nf-file="${f.id}:${i}" title="${x.name}">${x.thumb_url ? html`<img src="${x.thumb_url}" alt="" loading="lazy">` : fileBadge(x.name)}<span class="truncate">${x.name}</span></button>`)}</div>
                  ${b.total > SHOW ? html`<a class="small" href="${driveHref(f, cur)}">${icon('external-link', 'xs')} ${b.total - SHOW} more in Drive</a>` : ''}`}
            </div>` : ''}
          </div>`;
        })}</div>`)
        : '';
    }
    async function openSub(fid, folderId, name) {
      const f = linkedFolders.find((x) => x.id === fid);
      if (!f?.access) return;
      const b = browse.get(fid) || { trail: [{ id: f.id, name: f.name }], folders: [], items: [], total: 0 };
      if (folderId !== f.id && !b.trail.some((t) => t.id === folderId)) b.trail.push({ id: folderId, name });
      b.loading = true;
      b.error = null;
      browse.set(fid, b);
      renderFolders();
      try {
        const r = await api.get('drive', f.access === 'owner' ? { folder: folderId, per_page: 200, sort: 'name' } : { view: 'shared', folder: folderId });
        Object.assign(b, { folders: r.folders || [], items: r.items || [], total: r.total ?? (r.items || []).length, loading: false });
      } catch (err) { Object.assign(b, { loading: false, error: err.message }); }
      renderFolders();
    }
    async function pickFolder() {
      let mine = [], shared = [];
      try { [mine, shared] = await Promise.all([api.get('drive/folders'), api.get('drive', { view: 'shared' }).then((r) => r.folders || []).catch(() => [])]); } catch (e) { return toastError(e); }
      const kids = new Map();
      mine.forEach((f) => { const k = f.parent_id || 0; kids.set(k, [...(kids.get(k) || []), f]); });
      const linked = new Set(linkedFolders.map((f) => f.id));
      const rows = [];
      const walk = (pid, depth, trail) => (kids.get(pid) || []).forEach((f) => { rows.push({ ...f, depth, path: [...trail, f.name].join(' / ') }); walk(f.id, depth + 1, [...trail, f.name]); });
      walk(0, 0, []);
      shared.forEach((f) => rows.push({ ...f, depth: 0, path: f.name, owner: f.owner_name }));
      if (!rows.length) {
        toast('You have no Drive folders yet — create one in Drive first', 'info', { action: 'Open Drive', onAction: () => navigate('/drive') });
        return null;
      }
      const body = h(String(html`<div><input class="input mb-2" type="search" placeholder="Search folders…" data-q autocomplete="off">
        <div class="nf-pick">${rows.map((f) => html`<button type="button" class="nf-pick-row ${linked.has(f.id) ? 'done' : ''}" data-pick="${f.id}" data-path="${f.path.toLowerCase()}" style="--d:${f.depth}" ${linked.has(f.id) ? 'disabled' : ''}>
          <span style="color:${f.color || 'var(--accent)'}">${icon('folder', 'sm')}</span><span class="grow truncate">${f.name}${f.owner ? html` <span class="subtle small">· ${f.owner}</span>` : ''}</span>${linked.has(f.id) ? html`<span class="tiny subtle">linked</span>` : ''}</button>`)}</div></div>`));
      const m = modal({ title: 'Link a Drive folder', size: 'sm', body, actions: [{ label: 'Cancel', value: null }] });
      body.querySelector('[data-q]').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        body.querySelectorAll('[data-pick]').forEach((b) => { b.style.display = !q || b.dataset.path.includes(q) ? '' : 'none'; b.style.setProperty('--d', q ? 0 : rows.find((r) => r.id === +b.dataset.pick).depth); });
      });
      body.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b && !b.disabled) m.close(+b.dataset.pick); });
      setTimeout(() => body.querySelector('[data-q]').focus(), 50);
      return m.result;
    }
    async function linkFolder() {
      const fid = await pickFolder();
      if (!fid) return;
      try {
        linkedFolders = await api.post(`notes/${id}/folders`, { folder_id: fid });
        toast('Folder linked to this note', 'success', { timeout: 1500 });
        openSub(fid, fid);
      } catch (e) { toastError(e); }
    }
    el.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.closest('[data-a="link-folder"]')) { e.preventDefault(); return linkFolder(); }
      const un = t.closest('[data-nf-unlink]');
      if (un) {
        const f = linkedFolders.find((x) => x.id === +un.dataset.nfUnlink);
        if (!(await confirm({ title: `Unlink "${f.name}"?`, message: 'The folder and its files stay in Drive; only the link from this note is removed.', confirmText: 'Unlink' }))) return;
        try { linkedFolders = await api.post(`notes/${id}/folders/${f.id}/delete`); browse.delete(f.id); renderFolders(); } catch (err) { toastError(err); }
        return;
      }
      if (t.closest('.nf-head a')) return;
      const tg = t.closest('[data-nf-toggle]');
      if (tg) {
        const fid = +tg.dataset.nfToggle;
        const f = linkedFolders.find((x) => x.id === fid);
        if (!f.access) return toast(`${f.owner_name} has not shared this folder with you`, 'info');
        if (browse.has(fid)) { browse.delete(fid); renderFolders(); } else openSub(fid, fid);
        return;
      }
      const sub = t.closest('[data-nf-sub]');
      if (sub) { const [fid, did] = sub.dataset.nfSub.split(':').map(Number); return openSub(fid, did, sub.title); }
      const go = t.closest('[data-nf-go]');
      if (go) { e.preventDefault(); const [fid, i] = go.dataset.nfGo.split(':').map(Number); const b = browse.get(fid); b.trail = b.trail.slice(0, i + 1); return openSub(fid, b.trail[i].id); }
      const fl = t.closest('[data-nf-file]');
      if (fl) { const [fid, i] = fl.dataset.nfFile.split(':').map(Number); const b = browse.get(fid); openFilePreview(b.items[i], b.items); }
    });
    el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-nf-toggle]')) { e.preventDefault(); e.target.click(); } });
    loadFolders();
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
    if (isNew && ctx.query.draw === '1' && isOwner) setTimeout(() => drawNew(), 80);
    else if (isNew) setTimeout(() => titleEl.focus(), 50);
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
