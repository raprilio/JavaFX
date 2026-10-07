#!/usr/bin/env node
/*
 * Server antrian (opsional) — tanpa dependensi, cukup Node.js 18+.
 * Wajib dipakai bila ada LEBIH DARI SATU kiosk, supaya nomor tidak bentrok.
 *
 *   node server.js                 → http://localhost:8080
 *   PORT=9000 ADMIN_PIN=xxxx node server.js
 *
 * Endpoint:
 *   GET  /api/state                 status antrian hari ini (tanpa data NIK)
 *   POST /api/tickets               { serviceId, priority, kategori, nikHash, kioskId }
 *   POST /api/help                  { kioskId, time, screen }
 *   POST /api/call                  { pin, serviceId, priority }   ← untuk integrasi aplikasi loket
 *   POST /api/admin/settings        { pin, disabled?, ignoreSchedule? }
 *   POST /api/admin/reset           { pin }
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('./js/queue-core.js');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

function loadConfig() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8'), sandbox);
  return sandbox.window.KIOSK_CONFIG;
}
const CFG = loadConfig();
const ADMIN_PIN = String(process.env.ADMIN_PIN || CFG.adminPin);
if (!process.env.ADMIN_PIN) console.warn('[!] ADMIN_PIN tidak di-set — memakai PIN dari config.js (dapat dilihat siapa pun yang membuka kiosk).');

/* ---------- Penyimpanan berkas ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
let state = null;

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }
function writeJson(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file); // atomik: tidak ada berkas setengah tertulis bila listrik padam
}
function now() { return Core.nowIn(CFG.timezone); }
function queueFile(date) { return path.join(DATA_DIR, 'antrian-' + date + '.json'); }
function load() {
  const date = now().date;
  if (!state || state.date !== date) state = Core.ensureDay(readJson(queueFile(date)), date);
  return state;
}
function save() { writeJson(queueFile(state.date), state); }
function settings() { return Object.assign({ disabled: {}, ignoreSchedule: false }, readJson(SETTINGS_FILE)); }

/* ---------- HTTP ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 10240) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function pinOk(body) { return body && String(body.pin) === ADMIN_PIN; }

const api = {
  'GET /api/state': () => [200, Object.assign(Core.publicState(load()), { settings: settings() })],

  'POST /api/tickets': (b) => {
    if (typeof b.serviceId !== 'string') return [400, { ok: false, reason: 'bad-request' }];
    if (b.nikHash != null && !/^[0-9a-f]{64}$/.test(b.nikHash)) return [400, { ok: false, reason: 'bad-request' }];
    const set = settings(), n = now();
    if (!Core.schedule(CFG, n, set.ignoreSchedule).open) return [200, { ok: false, reason: 'closed' }];
    const st = load();
    const r = Core.issue(st, CFG.layanan, set, {
      serviceId: b.serviceId, priority: !!b.priority, kategori: typeof b.kategori === 'string' ? b.kategori.slice(0, 32) : null,
      nikHash: b.nikHash || null, kioskId: typeof b.kioskId === 'string' ? b.kioskId.slice(0, 32) : null,
    }, n.hhmm);
    if (r.ok) save();
    return [200, r];
  },

  'POST /api/help': (b) => {
    const st = load();
    Core.addHelp(st, { time: now().hhmm, kioskId: String(b.kioskId || '').slice(0, 32), screen: String(b.screen || '').slice(0, 16) });
    save();
    console.log(`[BANTUAN] ${now().hhmm} — ${b.kioskId} meminta petugas`);
    return [200, { ok: true }];
  },

  'POST /api/call': (b) => {
    if (!pinOk(b)) return [403, { ok: false, reason: 'pin' }];
    const st = load();
    const no = Core.call(st, CFG.layanan, b.serviceId, !!b.priority);
    if (no) save();
    return [200, { ok: !!no, no }];
  },

  'POST /api/admin/settings': (b) => {
    if (!pinOk(b)) return [403, { ok: false, reason: 'PIN salah' }];
    const cur = settings();
    if (b.disabled && typeof b.disabled === 'object') cur.disabled = b.disabled;
    if (typeof b.ignoreSchedule === 'boolean') cur.ignoreSchedule = b.ignoreSchedule;
    writeJson(SETTINGS_FILE, cur);
    return [200, { ok: true }];
  },

  'POST /api/admin/reset': (b) => {
    if (!pinOk(b)) return [403, { ok: false, reason: 'PIN salah' }];
    state = Core.emptyState(now().date);
    save();
    return [200, { ok: true }];
  },
};

function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  // Tolak path traversal & folder data (berisi hash NIK).
  if (!file.startsWith(ROOT + path.sep) || file.startsWith(DATA_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  const route = req.method + ' ' + new URL(req.url, 'http://x').pathname;
  const handler = api[route];
  if (!handler) {
    if (route.startsWith('GET /api/') || route.startsWith('POST ')) return send(res, 404, { ok: false, reason: 'not-found' });
    return serveStatic(req, res);
  }
  let body;
  try {
    body = req.method === 'POST' ? await readBody(req) : {};
  } catch (e) {
    return send(res, 400, { ok: false, reason: 'bad-request' });
  }
  try {
    const [code, out] = handler(body);
    send(res, code, out);
  } catch (e) {
    console.error(e);
    send(res, 500, { ok: false, reason: 'server-error' });
  }
}).listen(PORT, HOST, () => {
  console.log(`Kiosk antrian ${CFG.instansi.singkatan} berjalan di http://localhost:${PORT}`);
});
