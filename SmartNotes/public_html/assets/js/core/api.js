// JSON API client (fetch) with CSRF handling and upload progress (XHR).
import { emit, state } from './store.js';

/** Upload endpoints that accept a finished chunked upload (upload_token) instead of a file field. */
const CHUNKED_ROUTES = new Set(['files/upload', 'audio/upload', 'admin/restore-upload']);
/** Extra fields for the pieces of some routes (backups may be .sql/.gz/.zip of any size). */
const CHUNK_PURPOSE = { 'admin/restore-upload': 'backup' };

export class ApiError extends Error {
  constructor(message, status = 0, errors = {}) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

let csrf = '';
export const setCsrf = (t) => { csrf = t || csrf; };
export const getCsrf = () => csrf;

export function url(route, query = {}) {
  const qs = new URLSearchParams({ route });
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, v);
  });
  return `api/index.php?${qs.toString()}`;
}

async function refreshCsrf() {
  const r = await fetch(url('app'), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (j?.data?.csrf) csrf = j.data.csrf;
}

async function request(method, route, { query, body, form, signal, retry = true } = {}) {
  const headers = { Accept: 'application/json', 'X-Requested-With': 'fetch' };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url(route, query), { method, headers, body: payload, credentials: 'same-origin', signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Network error — check your connection.', 0);
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (res.status === 419 && retry) {
    await refreshCsrf();
    return request(method, route, { query, body, form, signal, retry: false });
  }
  if (!res.ok || !json || json.ok === false) {
    const msg = json?.message || `Request failed (${res.status})`;
    if (res.status === 401) emit('unauthorized');
    if (res.status === 403 && json?.errors?.password_change_required) emit('password-required');
    throw new ApiError(msg, res.status, json?.errors || {});
  }
  return json.data !== undefined ? json.data : json;
}

export const api = {
  get: (route, query, opts = {}) => request('GET', route, { query, ...opts }),
  post: (route, body = {}, opts = {}) => request('POST', route, { body, ...opts }),
  form: (route, form, opts = {}) => request('POST', route, { form, ...opts }),
  raw: request,
  /**
   * Multipart upload with progress callback (0..1). Files larger than one piece (server-defined, below
   * PHP's upload limit) are sent in chunks with retries, so the admin's size limits are the only limit.
   */
  upload(route, form, onProgress) {
    const file = typeof form?.get === 'function' ? form.get('file') : null;
    const piece = state.limits?.chunk_bytes || 8 * 1024 * 1024;
    if (CHUNKED_ROUTES.has(route) && file instanceof Blob && file.size > piece) return chunkedUpload(route, form, file, piece, onProgress, CHUNK_PURPOSE[route]);
    return xhrPost(route, form, onProgress);
  },
};

function xhrPost(route, form, onProgress, retried = false) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url(route));
    xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.withCredentials = true;
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let j = null;
      try { j = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status === 419 && !retried) {
        refreshCsrf().then(() => xhrPost(route, form, onProgress, true).then(resolve, reject));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && j && j.ok !== false) resolve(j.data !== undefined ? j.data : j);
      else if (xhr.status === 413) reject(new ApiError('The file is larger than the server allows.', 413));
      else reject(new ApiError(j?.message || `Upload failed (${xhr.status})`, xhr.status, j?.errors || {}));
    };
    xhr.onerror = () => reject(new ApiError('Network error during upload.', 0));
    xhr.send(form);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chunkedUpload(route, form, file, piece, onProgress, purpose = '') {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const total = Math.ceil(file.size / piece);
  const name = file.name || 'file';
  try {
    for (let i = 0; i < total; i++) {
      const start = i * piece;
      const blob = file.slice(start, Math.min(file.size, start + piece));
      const fd = new FormData();
      Object.entries({ upload_token: token, index: i, total, size: file.size, name, purpose }).forEach(([k, v]) => fd.append(k, String(v)));
      fd.append('chunk', blob, 'chunk');
      const progress = onProgress && ((p) => onProgress(Math.min(0.99, (start + p * blob.size) / file.size)));
      for (let attempt = 0; ; attempt++) {
        try {
          await xhrPost('uploads/chunk', fd, progress);
          break;
        } catch (e) {
          // Network drops and server hiccups are retried; refusals (type, size, full disk) are not.
          const retry = e.status === 0 || (e.status >= 500 && e.status !== 507);
          if (!retry || attempt >= 4) throw e;
          await sleep(1000 * 2 ** attempt);
        }
      }
    }
    const fin = new FormData();
    for (const [k, v] of form.entries()) if (k !== 'file') fin.append(k, v);
    fin.append('upload_token', token);
    const r = await xhrPost(route, fin);
    onProgress?.(1);
    return r;
  } catch (e) {
    const c = new FormData();
    c.append('upload_token', token);
    xhrPost('uploads/cancel', c).catch(() => {});
    throw e;
  }
}
