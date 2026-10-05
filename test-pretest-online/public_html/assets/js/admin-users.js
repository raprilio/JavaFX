/* Admin — User management */
(function () {
    'use strict';
    const body = document.getElementById('uBody');
    const modal = new bootstrap.Modal('#uModal');
    const form = document.getElementById('uForm');
    let page = 1;

    async function load() {
        try {
            const r = await App.api('api/admin/users.php', { params: { action: 'list', page, q: fQ.value, role: fRole.value, department: fDept.value, status: fStatus.value } });
            body.innerHTML = r.data.length ? r.data.map((u) => {
                const ini = u.name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
                const me = Number(u.id) === window.ME_ID;
                return `<tr>
                    <td class="td-main"><div class="user-cell"><div class="avatar">${App.esc(ini)}</div><div class="min-w-0"><div class="fw-semibold">${App.esc(u.name)}${me ? ' <span class="badge bs-blue badge-soft">Anda</span>' : ''}</div><small class="text-muted">@${App.esc(u.username)}${u.email ? ' · ' + App.esc(u.email) : ''}</small></div></div></td>
                    <td data-label="Department">${App.esc(u.department || '—')}<div class="small text-muted">${App.esc(u.position || '')}</div></td>
                    <td data-label="Role">${u.role === 'admin' ? '<span class="badge-type badge-test">ADMIN</span>' : '<span class="badge-type badge-pretest">USER</span>'}</td>
                    <td data-label="Aktif"><div class="form-check form-switch mb-0"><input class="form-check-input" type="checkbox" data-toggle="${u.id}" ${u.status === 'active' ? 'checked' : ''} ${me ? 'disabled' : ''}></div></td>
                    <td data-label="Ujian" class="text-end"><a href="${App.url('admin/results.php?user_id=' + u.id)}">${u.attempts}</a></td>
                    <td data-label="Login terakhir" class="text-muted small">${App.date(u.last_login_at)}</td>
                    <td class="text-end text-nowrap td-actions">
                        <button class="btn btn-soft btn-sm" data-edit="${u.id}" title="Edit"><i class="bi bi-pencil"></i></button>
                        <button class="btn btn-light btn-sm" data-reset="${u.id}" data-name="${App.esc(u.name)}" title="Reset password"><i class="bi bi-key"></i></button>
                        <button class="btn btn-soft-danger btn-sm" data-del="${u.id}" data-name="${App.esc(u.name)}" ${me ? 'disabled' : ''} title="Hapus"><i class="bi bi-trash"></i></button>
                    </td></tr>`;
            }).join('') : '<tr><td colspan="7"><div class="empty-state"><i class="bi bi-people"></i>Tidak ada user.</div></td></tr>';
            document.getElementById('uInfo').textContent = `${r.total} user`;
            App.pagination(document.getElementById('uPager'), r, (p) => { page = p; load(); });
        } catch (e) { App.toast(e.message, 'error'); }
    }

    function open(u) {
        form.reset();
        form.elements.id.value = u ? u.id : '';
        document.getElementById('uTitle').textContent = u ? 'Edit User' : 'User Baru';
        document.getElementById('pwHint').textContent = u ? '(kosongkan jika tidak diubah)' : '(min. 8 karakter)';
        form.elements.password.required = !u;
        const assigned = new Set(u ? u.assigned_exam_ids : []);
        document.querySelectorAll('.exam-chk').forEach((c) => { c.checked = assigned.has(Number(c.value)); });
        if (u) ['name', 'username', 'email', 'department', 'position', 'role', 'status'].forEach((k) => { form.elements[k].value = u[k] || ''; });
        if (!u) { form.elements.role.value = 'user'; form.elements.status.value = 'active'; }
        modal.show();
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        data.action = data.id ? 'update' : 'create';
        try {
            const r = await App.api('api/admin/users.php', { method: 'POST', data });
            const userId = data.id || r.id;
            const exam_ids = [...document.querySelectorAll('.exam-chk:checked')].map((c) => Number(c.value));
            await App.api('api/admin/users.php', { method: 'POST', data: { action: 'assign_exams', user_id: userId, exam_ids } });
            App.toast(r.message);
            modal.hide();
            load();
        } catch (err) { App.toast(err.message, 'error', 5000); }
    });

    body.addEventListener('click', async (e) => {
        const ed = e.target.closest('[data-edit]'), rs = e.target.closest('[data-reset]'), del = e.target.closest('[data-del]');
        try {
            if (ed) { const r = await App.api('api/admin/users.php', { params: { action: 'get', id: ed.dataset.edit } }); open(r.data); }
            if (rs) {
                if (!await App.confirm({ title: 'Reset password?', message: `Password baru acak akan dibuat untuk <strong>${App.esc(rs.dataset.name)}</strong>.`, icon: 'bi-key' })) return;
                const r = await App.api('api/admin/users.php', { method: 'POST', data: { action: 'reset_password', id: rs.dataset.reset } });
                await App.confirm({ title: 'Password direset', message: `Password baru:<br><code class="fs-5 user-select-all">${App.esc(r.password)}</code><br><small>Salin dan berikan kepada user.</small>`, okText: 'Selesai', cancelText: 'Tutup', icon: 'bi-check-circle' });
            }
            if (del) {
                if (!await App.confirm({ title: 'Hapus user?', message: `<strong>${App.esc(del.dataset.name)}</strong> beserta seluruh riwayat ujiannya akan dihapus permanen.`, variant: 'danger', okText: 'Hapus', icon: 'bi-trash' })) return;
                const r = await App.api('api/admin/users.php', { method: 'POST', data: { action: 'delete', id: del.dataset.del } });
                App.toast(r.message); load();
            }
        } catch (err) { App.toast(err.message, 'error'); }
    });

    body.addEventListener('change', async (e) => {
        const t = e.target.closest('[data-toggle]');
        if (!t) return;
        try { const r = await App.api('api/admin/users.php', { method: 'POST', data: { action: 'toggle_status', id: t.dataset.toggle } }); App.toast(r.status === 'active' ? 'User diaktifkan' : 'User dinonaktifkan'); }
        catch (err) { App.toast(err.message, 'error'); t.checked = !t.checked; }
    });

    document.getElementById('importForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        fd.set('action', 'import');
        const out = document.getElementById('importResult');
        out.innerHTML = '<div class="spinner-border spinner-border-sm"></div> Memproses...';
        try {
            const r = await App.api('api/admin/users.php', { method: 'POST', data: fd });
            out.innerHTML = `<div class="alert alert-success soft-alert py-2 mb-2">${App.esc(r.message)}</div>` +
                (r.skipped.length ? `<div class="alert alert-warning soft-alert py-2 mb-0"><strong>${r.skipped.length} baris dilewati:</strong><br>${r.skipped.map(App.esc).join('<br>')}</div>` : '');
            load();
        } catch (err) { out.innerHTML = `<div class="alert alert-danger soft-alert py-2">${App.esc(err.message)}</div>`; }
    });

    const fQ = document.getElementById('fQ'), fRole = document.getElementById('fRole'), fDept = document.getElementById('fDept'), fStatus = document.getElementById('fStatus');
    fQ.addEventListener('input', App.debounce(() => { page = 1; load(); }, 300));
    [fRole, fDept, fStatus].forEach((el) => el.addEventListener('change', () => { page = 1; load(); }));
    document.getElementById('btnNew').addEventListener('click', () => open(null));
    load();
})();
