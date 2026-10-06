// JSON API client (fetch) with CSRF handling and upload progress (XHR).
import { emit } from './store.js';

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
  /** Multipart upload with progress callback (0..1). */
  upload(route, form, onProgress) {
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
        if (xhr.status === 419) {
          refreshCsrf().then(() => api.upload(route, form, onProgress).then(resolve, reject));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300 && j && j.ok !== false) resolve(j.data !== undefined ? j.data : j);
        else {
          if (xhr.status === 413) reject(new ApiError('The file is larger than the server allows.', 413));
          else reject(new ApiError(j?.message || `Upload failed (${xhr.status})`, xhr.status, j?.errors || {}));
        }
      };
      xhr.onerror = () => reject(new ApiError('Network error during upload.', 0));
      xhr.send(form);
    });
  },
};
