// Login, register, forgot password, reset password.
import { html, icon, raw } from '../core/dom.js';
import { api, setCsrf } from '../core/api.js';
import { state, applyBootstrap, emit } from '../core/store.js';
import { navigate } from '../core/router.js';
import { toast, formData, showFieldErrors, withLoading, setTitle } from '../core/ui.js';
import { applyAll } from '../core/theme.js';

const FEATURES = [['notebook-pen', 'Rich notes'], ['square-check-big', 'Tasks & boards'], ['calendar-days', 'Calendar & meetings'], ['network', 'Mind maps'], ['workflow', 'Flowcharts'], ['mic', 'Voice notes']];

function layout(inner) {
  const b = state.branding || {};
  return html`<div class="auth">
    <section class="auth-art ${b.background_url ? 'has-bg' : ''}" ${b.background_url ? raw(`style="background-image:url('${b.background_url}')"`) : ''}>
      <span class="auth-orb" style="width:340px;height:340px;right:-80px;top:-60px"></span>
      <span class="auth-orb" style="width:220px;height:220px;left:30%;bottom:8%;animation-delay:-3s"></span>
      <a class="brand" href="#/login">${b.logo_url ? html`<img class="brand-logo" src="${b.logo_url}" alt="">` : html`<span class="brand-mark">${icon('notebook-pen')}</span>`}<span>${b.app_name}</span></a>
      <div>
        <h2>Your notes, tasks and plans — beautifully in one place.</h2>
        <p>${b.app_tagline || 'Capture ideas, organise work and never miss a meeting.'}</p>
        <div class="auth-features">${FEATURES.map(([i, t]) => html`<div class="auth-feature">${icon(i, 'sm')} ${t}</div>`)}</div>
      </div>
      <small style="opacity:.6">© ${new Date().getFullYear()} ${b.app_name}</small>
    </section>
    <section class="auth-panel"><div class="auth-box">
      <div class="auth-mobile-brand">${b.logo_url ? html`<img class="brand-logo" src="${b.logo_url}" alt="">` : html`<span class="brand"><span class="brand-mark">${icon('notebook-pen')}</span>${b.app_name}</span>`}</div>
      ${inner}
    </div></section>
  </div>`;
}

const pw = (name, label, extra = '') => html`<div class="field"><label for="${name}">${label}</label><div class="pw-wrap">
  <input class="input" id="${name}" type="password" name="${name}" ${raw(extra)}><button type="button" class="btn ghost icon" data-toggle-pw aria-label="Show password">${icon('eye')}</button></div></div>`;

const VIEWS = {
  login: () => html`<h1>Welcome back</h1><p class="sub">Sign in to continue to your workspace.</p>
    <form data-form="login" novalidate>
      <div class="field"><label for="email">E-mail</label><input class="input" id="email" type="email" name="email" autocomplete="username" required autofocus></div>
      ${pw('password', 'Password', 'autocomplete="current-password" required')}
      <div class="row between mb-3"><label class="check small"><input type="checkbox" name="remember" checked> Remember me</label><a class="small" href="#/forgot-password">Forgot password?</a></div>
      <button class="btn primary lg block" type="submit">Sign in ${icon('arrow-right', 'sm')}</button>
    </form>
    ${state.branding?.allow_registration ? html`<p class="small muted mt-3" style="text-align:center">No account yet? <a href="#/register">Create one</a></p>` : ''}`,
  register: () => html`<h1>Create your account</h1><p class="sub">Start organising your work in minutes.</p>
    <form data-form="register" novalidate>
      <div class="field"><label for="name">Full name</label><input class="input" id="name" name="name" autocomplete="name" required autofocus></div>
      <div class="field"><label for="email">E-mail</label><input class="input" id="email" type="email" name="email" autocomplete="email" required></div>
      ${pw('password', 'Password', 'autocomplete="new-password" required')}
      <p class="hint small subtle" style="margin-top:-6px">At least 8 characters with letters and numbers.</p>
      <button class="btn primary lg block mt-2" type="submit">Create account</button>
    </form><p class="small muted mt-3" style="text-align:center">Already registered? <a href="#/login">Sign in</a></p>`,
  forgot: () => html`<h1>Forgot password?</h1><p class="sub">Enter your e-mail and we will send you a link to reset it.</p>
    <form data-form="forgot" novalidate>
      <div class="field"><label for="email">E-mail</label><input class="input" id="email" type="email" name="email" required autofocus></div>
      <button class="btn primary lg block" type="submit">Send reset link</button>
    </form><p class="small mt-3" style="text-align:center"><a href="#/login">${icon('arrow-left', 'sm')} Back to sign in</a></p>`,
  reset: () => html`<h1>Set a new password</h1><p class="sub">Choose a strong password you don't use elsewhere.</p>
    <form data-form="reset" novalidate>
      ${pw('password', 'New password', 'autocomplete="new-password" required autofocus')}
      ${pw('password_confirm', 'Confirm password', 'autocomplete="new-password" required')}
      <button class="btn primary lg block" type="submit">Reset password</button>
    </form><p class="small mt-3" style="text-align:center"><a href="#/login">${icon('arrow-left', 'sm')} Back to sign in</a></p>`,
};

export default {
  async render(root, { meta, query }) {
    const mode = meta.mode;
    if (mode === 'register' && !state.branding?.allow_registration) return navigate('/login', { replace: true });
    setTitle({ login: 'Sign in', register: 'Register', forgot: 'Forgot password', reset: 'Reset password' }[mode]);
    applyAll();
    root.innerHTML = String(layout(VIEWS[mode]()));
    const form = root.querySelector('form');
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-toggle-pw]');
      if (!t) return;
      const inp = t.previousElementSibling;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      t.innerHTML = String(icon(inp.type === 'password' ? 'eye' : 'eye-off'));
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      const d = formData(form);
      showFieldErrors(form, {});
      await withLoading(btn, async () => {
        try {
          if (mode === 'login') {
            if (!d.email || !d.password) return showFieldErrors(form, { email: !d.email, password: !d.password });
            const r = await api.post('auth/login', d);
            setCsrf(r.csrf);
            applyBootstrap(r);
            toast(`Welcome back, ${r.user.name.split(' ')[0]}!`, 'success');
            emit('login');
          } else if (mode === 'register') {
            const r = await api.post('auth/register', d);
            setCsrf(r.csrf);
            applyBootstrap(r);
            toast('Account created — welcome!', 'success');
            emit('login');
          } else if (mode === 'forgot') {
            await api.post('auth/forgot', d);
            form.innerHTML = String(html`<div class="empty" style="padding:10px 0"><div class="empty-art">${icon('mail-check', 'xl')}</div><h3>Check your inbox</h3>
              <p>If an account exists for <b>${d.email}</b>, a reset link is on its way. The link is valid for 60 minutes.</p></div>`);
          } else if (mode === 'reset') {
            if (d.password !== d.password_confirm) {
              showFieldErrors(form, { password_confirm: 1 });
              return toast('Passwords do not match', 'error');
            }
            await api.post('auth/reset', { token: query.token, password: d.password });
            toast('Password updated. Please sign in.', 'success');
            navigate('/login');
          }
        } catch (err) {
          showFieldErrors(form, err.errors || {});
          toast(err.message, 'error');
        }
      });
    });
  },
};
