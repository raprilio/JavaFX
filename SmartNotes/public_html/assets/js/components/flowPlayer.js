// Flowing data for flowcharts and mind maps (v1.18): glowing pulses travel along the lines in the order of the
// process (or from the centre of a mind map outwards), and the shape they reach lights up. "Play" runs it on the
// canvas; "Export video" renders the same timeline frame by frame into an MP4 file.
import { svgEl, renderPng } from './canvas.js';
import { html, downloadBlob } from '../core/dom.js';
import { modal } from '../core/ui.js';
import { muxFeeder } from './mp4Feed.js';

/**
 * A flow: { d: SVG path data of the line in world coordinates, color, delay: s, dur: s, r: pulse radius,
 *           target?: {x, y, w, h, rx} shape to light up when the pulse arrives }
 */
const TRAIL = [0, 0.055, 0.11, 0.165];
const HOLD = 1.1; // pause before the timeline starts again (s)
const GLOW = 0.7; // how long a reached shape stays lit (s)

/** Order the flows: lines leaving the first shapes start first, the next ones when the pulse arrives. */
export function levels(edges, from = (e) => e.source, to = (e) => e.target) {
  const out = new Map(), inDeg = new Map(), adj = new Map();
  edges.forEach((e) => {
    inDeg.set(to(e), (inDeg.get(to(e)) || 0) + 1);
    if (!inDeg.has(from(e))) inDeg.set(from(e), inDeg.get(from(e)) || 0);
    (adj.get(from(e)) || adj.set(from(e), []).get(from(e))).push(to(e));
  });
  let queue = [...inDeg.keys()].filter((k) => !inDeg.get(k));
  if (!queue.length && edges.length) queue = [from(edges[0])]; // a loop: start anywhere
  const level = new Map(queue.map((k) => [k, 0]));
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    (adj.get(k) || []).forEach((n) => { if (!level.has(n)) { level.set(n, level.get(k) + 1); queue.push(n); } });
  }
  edges.forEach((e) => out.set(e, level.get(from(e)) ?? 0));
  return out;
}

/**
 * Start time of every line: a line starts when the first pulse reaches the shape it leaves from.
 * items: [{ from, to, dur }] → Map(item → delay in seconds)
 */
export function schedule(items) {
  const order = levels(items, (e) => e.from, (e) => e.to);
  const arrive = new Map();
  const out = new Map();
  [...items].sort((a, b) => order.get(a) - order.get(b)).forEach((e) => {
    const start = arrive.get(e.from) ?? 0;
    out.set(e, start);
    const at = start + e.dur;
    if (!arrive.has(e.to) || arrive.get(e.to) > at) arrive.set(e.to, at);
  });
  return out;
}

function prepare(flows, host) {
  // Measure every line once with an SVG path (also used to place the pulses).
  return flows.map((f) => {
    const p = svgEl('path', { d: f.d, fill: 'none', stroke: 'none' });
    host.appendChild(p);
    let len = 0;
    try { len = p.getTotalLength(); } catch { /* not rendered */ }
    return { ...f, path: p, len };
  }).filter((f) => f.len > 1);
}
const periodOf = (flows) => Math.max(1.5, ...flows.map((f) => f.delay + f.dur)) + HOLD;

/** Pulses visible at time t: [{x, y, r, color, alpha}] and lit shapes [{target, color, alpha}]. */
function frameAt(flows, t) {
  const dots = [], lit = [];
  flows.forEach((f) => {
    const p = (t - f.delay) / f.dur;
    TRAIL.forEach((back, i) => {
      const q = p - back;
      if (q < 0 || q > 1) return;
      const pt = f.path.getPointAtLength(q * f.len);
      dots.push({ x: pt.x, y: pt.y, r: f.r * (1 - i * 0.2), color: f.color, alpha: 1 - i * 0.25, head: i === 0 });
    });
    const since = t - (f.delay + f.dur);
    if (f.target && since >= 0 && since < GLOW) lit.push({ target: f.target, color: f.color, alpha: 1 - since / GLOW });
  });
  return { dots, lit };
}

/**
 * @param {{stage: any, getFlows: () => Array, onState?: (playing: boolean) => void}} o
 */
export function createFlowPlayer({ stage, getFlows, onState }) {
  let layer = null, flows = [], raf = 0, t0 = 0, period = 1;
  const playing = () => !!layer;

  function build() {
    if (!layer) return;
    layer.innerHTML = '';
    const measure = svgEl('g', { visibility: 'hidden' });
    layer.appendChild(measure);
    flows = prepare(getFlows(), measure);
    period = periodOf(flows);
  }
  function draw(now) {
    if (!layer) return;
    const t = ((now - t0) / 1000) % period;
    const { dots, lit } = frameAt(flows, t);
    const g = svgEl('g');
    lit.forEach(({ target: b, color, alpha }) => g.appendChild(svgEl('rect', { x: b.x - 5, y: b.y - 5, width: b.w + 10, height: b.h + 10, rx: (b.rx ?? 12) + 5, fill: 'none', stroke: color, 'stroke-width': 3, opacity: (alpha * 0.9).toFixed(3), class: 'flow-glow' })));
    dots.forEach((d) => {
      g.appendChild(svgEl('circle', { cx: d.x, cy: d.y, r: d.r * 2.3, fill: d.color, opacity: (0.22 * d.alpha).toFixed(3) }));
      g.appendChild(svgEl('circle', { cx: d.x, cy: d.y, r: d.r, fill: d.color, opacity: d.alpha.toFixed(3) }));
      if (d.head) g.appendChild(svgEl('circle', { cx: d.x, cy: d.y, r: d.r * 0.45, fill: '#ffffff' }));
    });
    layer.lastChild?.dataset?.frame && layer.lastChild.remove();
    g.dataset.frame = '1';
    layer.appendChild(g);
    raf = requestAnimationFrame(draw);
  }
  function play() {
    if (layer) return;
    layer = svgEl('g', { class: 'ui-only flow-layer', 'pointer-events': 'none' });
    stage.viewport.appendChild(layer);
    build();
    t0 = performance.now();
    raf = requestAnimationFrame(draw);
    onState?.(true);
  }
  function stop() {
    cancelAnimationFrame(raf);
    layer?.remove();
    layer = null;
    onState?.(false);
  }
  return {
    play, stop, playing,
    toggle() { playing() ? stop() : play(); },
    /** The drawing changed: measure the lines again (keeps the timeline running). */
    refresh() { if (layer) build(); },
    destroy: stop,
  };
}

// ------------------------------------------------------------------ video
const EVEN = (v) => Math.max(2, Math.round(v / 2) * 2);

/** Pick the first codec this browser can encode (H.264 plays everywhere; VP9 / AV1 in MP4 as fallbacks). */
async function pickCodec(width, height, fps) {
  if (typeof VideoEncoder === 'undefined') return null;
  const tries = [['avc', 'avc1.640028'], ['avc', 'avc1.4d0028'], ['avc', 'avc1.42001f'], ['vp9', 'vp09.00.40.08'], ['av1', 'av01.0.08M.08']];
  for (const [muxCodec, codec] of tries) {
    const cfg = { codec, width, height, bitrate: Math.round(width * height * fps * 0.12), framerate: fps };
    if (muxCodec === 'avc') cfg.avc = { format: 'avc' };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { muxCodec, cfg }; } catch { /* try next */ }
  }
  return null;
}

/**
 * Render the flowing-data animation of a diagram into a video and download it.
 * @param {{stage, bbox, background: string, getFlows: () => Array, name: string, seconds?: number, fps?: number}} o
 */
export async function exportFlowVideo({ stage, bbox, background, getFlows, name, seconds, fps = 30 }) {
  const measure = svgEl('g', { visibility: 'hidden', class: 'ui-only' });
  stage.viewport.appendChild(measure);
  let cancelled = false, finished = false;
  const ui = modal({
    title: 'Exporting video', size: 'sm',
    body: html`<div class="vid-prog"><p class="small" data-vtext>Preparing…</p><div class="upload-progress"><span data-vbar style="width:0%"></span></div>
      <p class="tiny subtle mt-2">The animation is rendered frame by frame — you can keep this tab open in the background.</p></div>`,
    actions: [{ label: 'Cancel', value: 'cancel' }],
  });
  ui.result.then(() => { if (!finished) cancelled = true; }); // Cancel, Esc or ✕
  const setP = (k, text) => { const b = ui.body.querySelector('[data-vbar]'), tx = ui.body.querySelector('[data-vtext]'); if (b) b.style.width = Math.round(k * 100) + '%'; if (tx) tx.textContent = text; };
  try {
    const flows = prepare(getFlows(), measure);
    if (!flows.length) throw new Error('Connect a few shapes first — the animation runs along the lines.');
    const period = periodOf(flows);
    const total = seconds || Math.min(30, Math.max(6, period * 2));
    // The diagram itself, drawn once; pulses are painted on top of it for every frame.
    const pad = 40;
    const outW = bbox.w + pad * 2, outH = bbox.h + pad * 2;
    const scale = Math.max(0.5, Math.min(2, 1920 / outW, 1080 / outH));
    const { canvas: still } = await renderPng(stage, bbox, background, scale);
    const W = EVEN(still.width), H = EVEN(still.height);
    const s = W / outW;
    const X = (x) => (x - (bbox.x - pad)) * s, Y = (y) => (y - (bbox.y - pad)) * s;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const paint = (t) => {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(still, 0, 0, W, H);
      const { dots, lit } = frameAt(flows, t % period);
      lit.forEach(({ target: b, color, alpha }) => {
        ctx.save();
        ctx.globalAlpha = alpha * 0.9;
        ctx.strokeStyle = color; ctx.lineWidth = 3 * s; ctx.shadowColor = color; ctx.shadowBlur = 14 * s;
        ctx.beginPath();
        ctx.roundRect(X(b.x - 5), Y(b.y - 5), (b.w + 10) * s, (b.h + 10) * s, ((b.rx ?? 12) + 5) * s);
        ctx.stroke();
        ctx.restore();
      });
      dots.forEach((d) => {
        ctx.save();
        ctx.globalAlpha = d.alpha;
        ctx.fillStyle = d.color; ctx.shadowColor = d.color; ctx.shadowBlur = d.r * 2.4 * s;
        ctx.beginPath(); ctx.arc(X(d.x), Y(d.y), d.r * s, 0, Math.PI * 2); ctx.fill();
        if (d.head) { ctx.shadowBlur = 0; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(X(d.x), Y(d.y), d.r * 0.45 * s, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      });
    };
    const frames = Math.round(total * fps);
    const codec = await pickCodec(W, H, fps);
    let blob, ext = 'mp4';
    if (codec) {
      const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({ target, video: { codec: codec.muxCodec, width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
      let failure = null;
      const feed = muxFeeder(muxer, codec);
      const enc = new VideoEncoder({ output: (chunk, meta) => { try { feed(chunk, meta); } catch (e) { failure = e; } }, error: (e) => { failure = e; } });
      enc.configure(codec.cfg);
      for (let i = 0; i < frames; i++) {
        if (cancelled) { enc.close(); return null; }
        if (failure) throw failure;
        paint(i / fps);
        const vf = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        enc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
        vf.close();
        while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
        if (i % 10 === 0) { setP(i / frames, `Rendering frame ${i + 1} of ${frames}…`); await new Promise((r) => setTimeout(r, 0)); }
      }
      setP(1, 'Finishing…');
      await enc.flush();
      if (failure) throw failure;
      muxer.finalize();
      blob = new Blob([target.buffer], { type: 'video/mp4' });
    } else {
      // No WebCodecs: record the canvas in real time (MP4 where the browser can, WebM otherwise).
      const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((m) => window.MediaRecorder?.isTypeSupported(m));
      if (!mime) throw new Error('This browser cannot record video. Try Chrome, Edge or Safari.');
      ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
      const rec = new MediaRecorder(cv.captureStream(fps), { mimeType: mime, videoBitsPerSecond: 6e6 });
      const parts = [];
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      const done = new Promise((r) => (rec.onstop = r));
      rec.start(500);
      const start = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          const t = (performance.now() - start) / 1000;
          if (cancelled || t >= total) return resolve();
          paint(t);
          setP(t / total, `Recording… ${Math.ceil(total - t)} s`);
          requestAnimationFrame(tick);
        };
        tick();
      });
      rec.stop();
      await done;
      if (cancelled) return null;
      blob = new Blob(parts, { type: mime.split(';')[0] });
    }
    downloadBlob(blob, `${name}.${ext}`);
    return { ext, size: blob.size, codec: codec?.cfg.codec || 'mediarecorder', width: W, height: H, seconds: total };
  } finally {
    finished = true;
    measure.remove();
    ui.close();
  }
}
