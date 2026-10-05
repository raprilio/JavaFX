// Global app state + tiny event bus. Persistent data always lives in MySQL via the API;
// this is only an in-memory cache of the current session.
const listeners = {};

export const state = {
  booted: false,
  user: null,
  settings: null,
  branding: null,
  categories: { note: [], task: [] },
  tags: [],
  limits: {},
  unread: 0,
  smtpConfigured: false,
  isAdminArea: false,
};

export function on(evt, fn) {
  (listeners[evt] ||= new Set()).add(fn);
  return () => listeners[evt].delete(fn);
}

export function emit(evt, payload) {
  (listeners[evt] || []).forEach((fn) => {
    try { fn(payload); } catch (e) { console.error(e); }
  });
}

export function applyBootstrap(d) {
  state.branding = d.branding;
  state.user = d.user;
  if (d.user) {
    state.settings = d.settings;
    state.categories = d.categories || { note: [], task: [] };
    state.tags = d.tags || [];
    state.limits = d.limits || {};
    state.unread = d.unread_notifications || 0;
    state.smtpConfigured = !!d.smtp_configured;
    state.isAdminArea = !!d.is_admin_area;
  }
  emit('bootstrap', d);
}

export const can = (perm) => !!state.user && (state.user.role === 'admin' || (state.user.permissions || []).includes(perm));
