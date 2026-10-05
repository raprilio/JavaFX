/* ExamPro — shared helpers */
(function () {
    'use strict';

    const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.content || '';
    const BASE = meta('base-url');

    const App = {
        url(path) { return BASE + '/' + String(path).replace(/^\/+/, ''); },

        /**
         * Fetch wrapper. data: FormData | object (dikirim sebagai JSON) | undefined
         */
        async api(path, { method = 'GET', data, params, signal } = {}) {
            let url = App.url(path);
            if (params) {
                const qs = new URLSearchParams();
                Object.entries(params).forEach(([k, v]) => {
                    if (v !== undefined && v !== null && v !== '') qs.append(k, v);
                });
                const s = qs.toString();
                if (s) url += (url.includes('?') ? '&' : '?') + s;
            }
            const headers = { 'X-CSRF-Token': meta('csrf-token'), 'Accept': 'application/json' };
            let body;
            if (data instanceof FormData) {
                body = data;
            } else if (data !== undefined) {
                headers['Content-Type'] = 'application/json';
                body = JSON.stringify(data);
            }
            const res = await fetch(url, { method, headers, body, signal, credentials: 'same-origin' });
            let json;
            try { json = await res.json(); } catch (e) { json = { ok: false, message: 'Respons server tidak valid.' }; }
            if (res.status === 401) {
                App.toast(json.message || 'Sesi berakhir.', 'error');
                setTimeout(() => { location.href = App.url('login.php'); }, 1200);
            }
            if (!res.ok || json.ok === false) {
                const err = new Error(json.message || `HTTP ${res.status}`);
                err.status = res.status;
                err.data = json;
                throw err;
            }
            return json;
        },

        toast(message, type = 'success', ms = 3200) {
            const icons = { success: 'bi-check-circle-fill', error: 'bi-exclamation-octagon-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };
            const el = document.createElement('div');
            el.className = `toast-x ${type}`;
            el.innerHTML = `<i class="bi ${icons[type] || icons.info}"></i><span></span>`;
            el.querySelector('span').textContent = message;
            document.getElementById('toast-stack')?.appendChild(el);
            setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms);
        },

        /** Konfirmasi berbasis modal Bootstrap. Resolve true/false. */
        confirm({ title = 'Konfirmasi', message = '', okText = 'Ya, lanjutkan', cancelText = 'Batal', variant = 'primary', icon = 'bi-question-circle' } = {}) {
            return new Promise((resolve) => {
                const wrap = document.createElement('div');
                wrap.innerHTML = `
<div class="modal fade" tabindex="-1">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-body text-center p-4">
        <div class="stat-icon mx-auto mb-3 ${variant === 'danger' ? 'ic-red' : 'ic-blue'}" style="width:60px;height:60px;border-radius:18px;display:grid;place-items:center;font-size:1.6rem"><i class="bi ${icon}"></i></div>
        <h5 class="fw-bold mb-2" data-title></h5>
        <div class="text-muted" data-msg></div>
      </div>
      <div class="modal-footer justify-content-center border-0 pt-0 pb-4">
        <button type="button" class="btn btn-light px-4" data-cancel></button>
        <button type="button" class="btn btn-${variant === 'danger' ? 'danger' : 'primary'} px-4" data-ok></button>
      </div>
    </div>
  </div>
</div>`;
                const el = wrap.firstElementChild;
                el.querySelector('[data-title]').textContent = title;
                el.querySelector('[data-msg]').innerHTML = message;
                el.querySelector('[data-ok]').textContent = okText;
                el.querySelector('[data-cancel]').textContent = cancelText;
                document.body.appendChild(el);
                const modal = new bootstrap.Modal(el);
                let result = false;
                el.querySelector('[data-ok]').addEventListener('click', () => { result = true; modal.hide(); });
                el.querySelector('[data-cancel]').addEventListener('click', () => modal.hide());
                el.addEventListener('hidden.bs.modal', () => { el.remove(); resolve(result); });
                modal.show();
            });
        },

        esc(s) {
            return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        },

        debounce(fn, ms = 300) {
            let t;
            return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
        },

        num(n, dec = 0) {
            if (n === null || n === undefined || n === '') return '—';
            const f = Number(n);
            return f.toLocaleString('id-ID', { minimumFractionDigits: Number.isInteger(f) ? 0 : dec, maximumFractionDigits: dec });
        },

        duration(sec) {
            if (sec === null || sec === undefined) return '—';
            sec = Number(sec);
            const m = Math.floor(sec / 60), s = sec % 60;
            if (m >= 60) return `${Math.floor(m / 60)}j ${String(m % 60).padStart(2, '0')}m`;
            return s ? `${m}m ${String(s).padStart(2, '0')}s` : `${m}m`;
        },

        date(dt) {
            if (!dt) return '—';
            const d = new Date(dt.replace(' ', 'T'));
            if (isNaN(d)) return dt;
            const p = (x) => String(x).padStart(2, '0');
            return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
        },

        scoreClass(score, pass) {
            if (score === null || score === undefined) return 'bs-gray';
            return Number(score) >= Number(pass ?? 70) ? 'bs-green' : 'bs-red';
        },

        typeBadge(type) {
            return type === 'test'
                ? '<span class="badge-type badge-test">TEST</span>'
                : '<span class="badge-type badge-pretest">PRE-TEST</span>';
        },

        pagination(container, { page, pages }, onPage) {
            container.innerHTML = '';
            if (pages <= 1) return;
            const ul = document.createElement('ul');
            ul.className = 'pagination pagination-sm mb-0';
            const add = (label, p, disabled, active) => {
                const li = document.createElement('li');
                li.className = `page-item ${disabled ? 'disabled' : ''} ${active ? 'active' : ''}`;
                li.innerHTML = `<a class="page-link" href="#">${label}</a>`;
                li.addEventListener('click', (e) => { e.preventDefault(); if (!disabled && !active) onPage(p); });
                ul.appendChild(li);
            };
            add('‹', page - 1, page <= 1);
            const start = Math.max(1, page - 2), end = Math.min(pages, page + 2);
            for (let i = start; i <= end; i++) add(i, i, false, i === page);
            add('›', page + 1, page >= pages);
            container.appendChild(ul);
        },
    };

    // Sidebar mobile
    document.addEventListener('click', (e) => {
        if (e.target.closest('[data-sidebar-toggle]')) document.body.classList.toggle('sidebar-open');
        if (e.target.closest('[data-sidebar-close]')) document.body.classList.remove('sidebar-open');
    });

    // Konfirmasi untuk form biasa: <form data-confirm="pesan">
    document.addEventListener('submit', async (e) => {
        const f = e.target;
        if (f.dataset.confirm && !f.dataset.confirmed) {
            e.preventDefault();
            const ok = await App.confirm({ message: App.esc(f.dataset.confirm), variant: f.dataset.variant || 'primary' });
            if (ok) { f.dataset.confirmed = '1'; f.requestSubmit ? f.requestSubmit() : f.submit(); }
        }
    });

    // Toggle password
    document.addEventListener('click', (e) => {
        const b = e.target.closest('[data-toggle-password]');
        if (!b) return;
        const input = document.querySelector(b.dataset.togglePassword);
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
        b.querySelector('i')?.classList.toggle('bi-eye');
        b.querySelector('i')?.classList.toggle('bi-eye-slash');
    });

    window.App = App;
})();
