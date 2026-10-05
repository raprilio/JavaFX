// Voice recorder (MediaRecorder + Web Audio waveform) and audio player with waveform.
import { html, icon, h, fmtDuration, fmtBytes, timeAgo, esc } from '../core/dom.js';
import { api } from '../core/api.js';
import { modal, toast, toastError } from '../core/ui.js';

const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
const extFor = (mime) => (mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : mime.includes('mpeg') ? 'mp3' : 'webm');

export function recorderSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

/** Downsample a list of peak values to n bars (0..1). */
function downsample(values, n = 120) {
  if (!values.length) return [];
  const out = [];
  const step = values.length / n;
  for (let i = 0; i < n; i++) {
    const s = Math.floor(i * step), e = Math.max(s + 1, Math.floor((i + 1) * step));
    let m = 0;
    for (let k = s; k < e && k < values.length; k++) m = Math.max(m, values[k]);
    out.push(+m.toFixed(3));
  }
  const max = Math.max(...out, 0.01);
  return out.map((v) => +(Math.min(1, v / max)).toFixed(3));
}

/** Compute waveform peaks for an uploaded audio file. */
export async function peaksFromFile(file, n = 120) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const data = buf.getChannelData(0);
    const block = Math.floor(data.length / n) || 1;
    const peaks = [];
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let k = i * block; k < (i + 1) * block && k < data.length; k++) m = Math.max(m, Math.abs(data[k]));
      peaks.push(m);
    }
    const duration = buf.duration;
    if (ctx.state !== 'closed') ctx.close().catch(() => {});
    return { peaks: downsample(peaks, n), duration };
  } catch {
    return { peaks: [], duration: 0 };
  }
}

export async function uploadAudioFile(file, { noteId = null, title = '', duration = 0, peaks = [] } = {}, onProgress) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('title', title || file.name.replace(/\.[^.]+$/, ''));
  fd.append('duration', String(duration || 0));
  fd.append('waveform', JSON.stringify(peaks || []));
  if (noteId) fd.append('note_id', String(noteId));
  return api.upload('audio/upload', fd, onProgress);
}

/**
 * Open the recorder modal. Resolves with the saved audio record (or null).
 */
export function openRecorder({ noteId = null, title = '' } = {}) {
  if (!recorderSupported()) {
    toast('Audio recording is not supported in this browser.', 'error');
    return Promise.resolve(null);
  }
  if (!window.isSecureContext) {
    toast('Microphone access requires HTTPS. Please open the app via https://', 'error', { timeout: 7000 });
    return Promise.resolve(null);
  }
  let stream, rec, ctx, analyser, raf, chunks = [], peaks = [], blob = null, mime = '', objectUrl = null;
  let elapsed = 0, startedAt = 0, timer = null, state = 'idle'; // idle | recording | paused | stopped

  const body = h(String(html`<div class="recorder">
    <div class="rec-state" data-state>${icon('mic', 'sm')} Ready to record</div>
    <div class="rec-timer" data-timer>00:00</div>
    <canvas class="rec-canvas" width="900" height="180"></canvas>
    <div class="rec-controls">
      <button class="btn icon rec-side" data-a="pause" disabled data-tip="Pause">${icon('pause')}</button>
      <button class="rec-main" data-a="main" aria-label="Start recording">${icon('mic')}</button>
      <button class="btn icon rec-side" data-a="reset" disabled data-tip="Discard & restart">${icon('rotate-ccw')}</button>
    </div>
    <div data-review class="hidden" style="text-align:left;margin-top:16px">
      <audio controls style="width:100%" data-preview></audio>
      <div class="field mt-2"><label>Title</label><input class="input" data-title value="${title || 'Recording ' + new Date().toLocaleString()}"></div>
      <div class="upload-progress hidden" data-prog><span></span></div>
    </div>
    <p class="small subtle mt-2" data-hint>Tap the microphone to start. Your browser will ask for microphone permission.</p>
  </div>`));
  const $ = (s) => body.querySelector(s);
  const canvas = $('canvas');
  const c2d = canvas.getContext('2d');

  const m = modal({
    title: 'Voice recorder',
    body,
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Save recording', variant: 'primary', icon: 'check', onClick: () => save() },
    ],
  });
  const saveBtn = m.el.querySelector('.btn.primary');
  saveBtn.disabled = true;

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6366f1';
  const danger = getComputedStyle(document.documentElement).getPropertyValue('--danger').trim() || '#e5484d';
  const bars = [];
  function draw() {
    raf = requestAnimationFrame(draw);
    const W = canvas.width, H = canvas.height;
    c2d.clearRect(0, 0, W, H);
    if (analyser && state === 'recording') {
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
      bars.push(peak);
      peaks.push(peak);
      if (bars.length > 150) bars.shift();
    }
    const bw = W / 150;
    bars.forEach((v, i) => {
      const bh = Math.max(4, Math.min(H - 10, v * H * 1.6));
      c2d.fillStyle = state === 'recording' ? danger : accent;
      c2d.globalAlpha = 0.35 + 0.65 * (i / bars.length);
      c2d.beginPath();
      c2d.roundRect ? c2d.roundRect(i * bw + 1, (H - bh) / 2, bw - 3, bh, 3) : c2d.rect(i * bw + 1, (H - bh) / 2, bw - 3, bh);
      c2d.fill();
    });
    c2d.globalAlpha = 1;
  }
  draw();

  const tick = () => { $('[data-timer]').textContent = fmtDuration(elapsed + (state === 'recording' ? (Date.now() - startedAt) / 1000 : 0)); };
  const setState = (s) => {
    state = s;
    const st = $('[data-state]');
    const main = $('[data-a="main"]');
    if (s === 'recording') {
      st.innerHTML = '<span class="rec-dot"></span> Recording';
      main.classList.add('stop');
      main.innerHTML = '<span class="sq"></span>';
      main.setAttribute('aria-label', 'Stop recording');
      $('[data-a="pause"]').disabled = false;
      $('[data-a="pause"]').innerHTML = String(icon('pause'));
      $('[data-hint]').textContent = 'Press the square to stop. You can pause and resume anytime.';
    } else if (s === 'paused') {
      st.innerHTML = String(html`${icon('pause', 'sm')} Paused`);
      $('[data-a="pause"]').innerHTML = String(icon('play'));
    } else if (s === 'stopped') {
      st.innerHTML = String(html`${icon('check', 'sm')} Recorded`);
      main.classList.remove('stop');
      main.innerHTML = String(icon('mic'));
      $('[data-a="pause"]').disabled = true;
      $('[data-a="reset"]').disabled = false;
      $('[data-review]').classList.remove('hidden');
      $('[data-hint]').textContent = 'Listen back, rename, then save. Saved recordings are stored on the server.';
      saveBtn.disabled = false;
    }
  };

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const msg = e.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser settings and try again.'
        : e.name === 'NotFoundError' ? 'No microphone was found on this device.' : 'Could not access the microphone: ' + e.message;
      toast(msg, 'error', { timeout: 7000 });
      return;
    }
    mime = PREFERRED.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mime = rec.mimeType || mime || 'audio/webm';
    chunks = [];
    peaks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      blob = new Blob(chunks, { type: mime.split(';')[0] });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      $('[data-preview]').src = objectUrl;
      cleanupStream();
      setState('stopped');
    };
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    rec.start(1000);
    elapsed = 0;
    startedAt = Date.now();
    timer = setInterval(tick, 250);
    setState('recording');
  }
  function stop() {
    if (state === 'recording') elapsed += (Date.now() - startedAt) / 1000;
    clearInterval(timer);
    tick();
    if (rec && rec.state !== 'inactive') rec.stop();
  }
  function togglePause() {
    if (!rec) return;
    if (state === 'recording') {
      rec.pause();
      elapsed += (Date.now() - startedAt) / 1000;
      setState('paused');
    } else if (state === 'paused') {
      rec.resume();
      startedAt = Date.now();
      setState('recording');
    }
  }
  function cleanupStream() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    ctx = null;
    analyser = null;
  }
  function reset() {
    blob = null;
    bars.length = 0;
    elapsed = 0;
    $('[data-timer]').textContent = '00:00';
    $('[data-review]').classList.add('hidden');
    saveBtn.disabled = true;
    state = 'idle';
    $('[data-state]').innerHTML = String(html`${icon('mic', 'sm')} Ready to record`);
    $('[data-a="reset"]').disabled = true;
  }
  async function save() {
    if (!blob) return false;
    const file = new File([blob], `recording-${Date.now()}.${extFor(mime)}`, { type: blob.type });
    const prog = $('[data-prog]');
    prog.classList.remove('hidden');
    const saved = await uploadAudioFile(file, { noteId, title: $('[data-title]').value.trim(), duration: elapsed, peaks: downsample(peaks) }, (p) => (prog.firstElementChild.style.width = Math.round(p * 100) + '%'));
    toast('Recording saved', 'success');
    return saved;
  }

  body.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'main') {
      if (state === 'idle' || state === 'stopped') { if (state === 'stopped') reset(); start(); }
      else stop();
    } else if (a === 'pause') togglePause();
    else if (a === 'reset') { reset(); }
  });

  return m.result.then((r) => {
    cancelAnimationFrame(raf);
    clearInterval(timer);
    if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); }
    cleanupStream();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return r || null;
  });
}

// ===================================================================== player
let player = null; // { audio, item, el }
export function stopAudio() {
  if (player) {
    player.audio.pause();
    player.el?.classList.remove('playing');
    player = null;
  }
}

export function audioItemHtml(a, { actions = true } = {}) {
  const peaks = a.waveform?.length ? a.waveform : Array.from({ length: 60 }, (_, i) => 0.25 + 0.2 * Math.abs(Math.sin(i * 1.7)));
  const step = Math.max(1, Math.floor(peaks.length / 60));
  const bars = peaks.filter((_, i) => i % step === 0).slice(0, 60);
  return html`<div class="audio-item" data-audio="${a.id}">
    <button class="play-btn" data-play aria-label="Play">${icon('play')}</button>
    <div class="grow" style="min-width:0">
      <div class="row" style="gap:8px;margin-bottom:2px"><b class="truncate" data-title style="font-weight:600">${a.title}</b>
        ${a.note_title ? html`<a class="tag" href="#/notes/${a.note_id}">${icon('notebook-pen', 'sm')} ${a.note_title}</a>` : ''}</div>
      <div class="wave" data-wave>${bars.map((v) => html`<span style="height:${Math.max(12, Math.round(v * 100))}%"></span>`)}</div>
    </div>
    <div class="audio-time"><span data-cur>0:00</span> / ${fmtDuration(a.duration)}<div class="tiny subtle">${fmtBytes(a.size)} · ${timeAgo(a.created_at)}</div></div>
    ${actions ? html`<button class="btn ghost icon sm" data-more aria-label="More">${icon('more-vertical')}</button>` : ''}
  </div>`;
}

/** Wire play / seek behaviour for every .audio-item inside root. */
export function bindAudioPlayers(root, getItem) {
  const update = () => {
    if (!player) return;
    const { audio, el, item } = player;
    const dur = audio.duration && isFinite(audio.duration) ? audio.duration : item.duration || 1;
    const pct = audio.currentTime / dur;
    const bars = el.querySelectorAll('[data-wave] span');
    const on = Math.round(pct * bars.length);
    bars.forEach((b, i) => b.classList.toggle('on', i < on));
    const cur = el.querySelector('[data-cur]');
    if (cur) cur.textContent = fmtDuration(audio.currentTime).replace(/^0(\d)/, '$1');
  };
  root.addEventListener('click', (e) => {
    const el = e.target.closest('.audio-item');
    if (!el) return;
    const item = getItem(+el.dataset.audio);
    if (!item) return;
    if (e.target.closest('[data-play]')) {
      if (player && player.item.id === item.id) {
        if (player.audio.paused) { player.audio.play(); el.querySelector('[data-play]').innerHTML = String(icon('pause')); }
        else { player.audio.pause(); el.querySelector('[data-play]').innerHTML = String(icon('play')); }
        return;
      }
      stopAudio();
      document.querySelectorAll('.audio-item [data-play]').forEach((b) => (b.innerHTML = String(icon('play'))));
      const audio = new Audio(item.url);
      audio.preload = 'auto';
      player = { audio, item, el };
      el.classList.add('playing');
      audio.addEventListener('timeupdate', update);
      audio.addEventListener('ended', () => {
        el.querySelector('[data-play]').innerHTML = String(icon('play'));
        el.classList.remove('playing');
        el.querySelectorAll('[data-wave] span').forEach((b) => b.classList.remove('on'));
        player = null;
      });
      audio.play().then(() => (el.querySelector('[data-play]').innerHTML = String(icon('pause')))).catch((err) => toastError(new Error('Playback failed: ' + err.message)));
    } else if (e.target.closest('[data-wave]')) {
      const wave = e.target.closest('[data-wave]');
      const r = wave.getBoundingClientRect();
      const pct = (e.clientX - r.left) / r.width;
      if (!player || player.item.id !== item.id) {
        el.querySelector('[data-play]').click();
        setTimeout(() => player && (player.audio.currentTime = pct * (player.audio.duration || item.duration)), 300);
      } else player.audio.currentTime = pct * (player.audio.duration || item.duration);
    }
  });
}
export { esc };
