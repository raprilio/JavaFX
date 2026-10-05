// Hash router with lazy-loaded views and leave guards.
const routes = [];
let current = null; // { cleanup, beforeLeave, path }
let mountFn = null;
let navigating = false;
let skipNext = false;

export function route(pattern, loader, meta = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '\\/?$');
  routes.push({ pattern, re, keys, loader, meta });
}

export function parseHash(hash = location.hash) {
  const h = hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function match(path) {
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { ...r, params };
    }
  }
  return null;
}

export function navigate(to, { replace = false } = {}) {
  const target = to.startsWith('#') ? to : '#' + to;
  if (target === location.hash) return handle();
  if (replace) {
    history.replaceState(null, '', target);
    handle();
  } else location.hash = target;
}

/** Update the query string without re-rendering the view. */
export function setQuery(query) {
  const { path } = parseHash();
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false)).toString();
  skipNext = true;
  history.replaceState(null, '', '#' + path + (qs ? '?' + qs : ''));
  setTimeout(() => (skipNext = false), 0);
}

export function currentLeaveGuard() { return current?.beforeLeave; }

let lastHash = location.hash;
async function handle() {
  if (skipNext) return;
  if (navigating) return;
  if (current?.beforeLeave && location.hash !== lastHash) {
    navigating = true;
    let ok = true;
    try { ok = await current.beforeLeave(); } catch { ok = true; }
    navigating = false;
    if (ok === false) {
      history.replaceState(null, '', lastHash || '#/');
      return;
    }
  }
  lastHash = location.hash;
  const { path, query } = parseHash();
  const m = match(path);
  if (current?.cleanup) {
    try { current.cleanup(); } catch (e) { console.error(e); }
  }
  current = null;
  await mountFn(m, { path, query });
}

export function setCurrent(c) { current = c; }

export function startRouter(mount) {
  mountFn = mount;
  window.addEventListener('hashchange', handle);
  return handle();
}
