/* Admin — daftar ujian */
(function () {
    'use strict';
    const body = document.getElementById('examBody');
    const modules = window.MODULES || {};
    const moduleOff = (t) => modules[t] === false;

    async function load() {
        try {
            const r = await App.api('api/admin/exams.php', { params: { action: 'list', q: fQ.value, type: fType.value, status: fStatus.value } });
            if (!r.data.length) {
                body.innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="bi bi-journal-plus"></i>Belum ada ujian. Klik "Buat Ujian" untuk memulai.</div></td></tr>';
                return;
            }
            body.innerHTML = r.data.map((e) => {
                const n = Number(e.question_count) > 0 ? Math.min(Number(e.question_count), Number(e.pool_count)) : Number(e.pool_count);
                const sched = e.start_date || e.end_date ? `<small>${App.date(e.start_date)}<br>s.d. ${App.date(e.end_date)}</small>` : '<small class="text-muted">Tanpa batas</small>';
                const vis = e.type === 'test'
                    ? '<span class="badge badge-soft bs-gray"><i class="bi bi-eye-slash"></i> Disembunyikan</span>'
                    : (Number(e.show_result) ? '<span class="badge badge-soft bs-blue"><i class="bi bi-eye"></i> Score tampil</span>' : '<span class="badge badge-soft bs-gray"><i class="bi bi-eye-slash"></i> Disembunyikan</span>');
                return `<tr>
                    <td class="td-main"><a href="${App.url('admin/exam-edit.php?id=' + e.id)}" class="fw-semibold text-reset">${App.esc(e.title)}</a>
                        <div class="small text-muted">${Number(e.assignments) ? e.assignments + ' assignment' : 'Semua peserta'}${Number(e.random_question) ? ' · <i class="bi bi-shuffle"></i> acak' : ''}${e.status === 'closed' ? ' · <span class="text-danger">ditutup</span>' : ''}</div></td>
                    <td data-label="Jenis">${App.typeBadge(e.type)}${moduleOff(e.type) ? '<div class="small text-danger mt-1"><i class="bi bi-toggle-off"></i> modul nonaktif</div>' : ''}</td>
                    <td data-label="Aktif"><div class="form-check form-switch m-0"><input class="form-check-input active-sw" type="checkbox" data-id="${e.id}" ${e.status === 'published' ? 'checked' : ''} title="Aktifkan / nonaktifkan untuk peserta"></div></td>
                    <td data-label="Soal" class="text-end">${n}<small class="text-muted">/${e.pool_count}</small></td>
                    <td data-label="Durasi" class="text-end">${e.duration}m</td>
                    <td data-label="Jadwal">${sched}</td>
                    <td data-label="Submission" class="text-end"><a href="${App.url('admin/results.php?exam_id=' + e.id)}" class="fw-semibold">${e.submissions}</a>${Number(e.in_progress) ? `<div class="small text-warning">${e.in_progress} aktif</div>` : ''}</td>
                    <td data-label="Hasil">${vis}</td>
                    <td class="text-end text-nowrap td-actions">
                        <a class="btn btn-soft btn-sm" href="${App.url('admin/exam-edit.php?id=' + e.id)}" title="Edit"><i class="bi bi-pencil"></i></a>
                        <button class="btn btn-light btn-sm" data-dup="${e.id}" title="Duplikat"><i class="bi bi-copy"></i></button>
                        <a class="btn btn-light btn-sm" href="${App.url('admin/results.php?exam_id=' + e.id)}" title="Hasil"><i class="bi bi-clipboard2-data"></i></a>
                        <button class="btn btn-soft-danger btn-sm" data-del="${e.id}" title="Hapus"><i class="bi bi-trash"></i></button>
                    </td>
                </tr>`;
            }).join('');
        } catch (err) { App.toast(err.message, 'error'); }
    }

    body.addEventListener('change', async (ev) => {
        const s = ev.target.closest('.active-sw');
        if (!s) return;
        try {
            await App.api('api/admin/exams.php', { method: 'POST', data: { action: 'set_status', id: s.dataset.id, status: s.checked ? 'published' : 'draft' } });
            App.toast(s.checked ? 'Ujian diaktifkan untuk peserta.' : 'Ujian dinonaktifkan (draft).', s.checked ? 'success' : 'warning');
        } catch (err) { App.toast(err.message, 'error'); s.checked = !s.checked; }
    });
    body.addEventListener('click', async (ev) => {
        const dup = ev.target.closest('[data-dup]');
        if (dup) {
            try { const r = await App.api('api/admin/exams.php', { method: 'POST', data: { action: 'duplicate', id: dup.dataset.dup } }); App.toast(r.message); load(); }
            catch (err) { App.toast(err.message, 'error'); }
            return;
        }
        const b = ev.target.closest('[data-del]');
        if (!b) return;
        if (!await App.confirm({ title: 'Hapus ujian?', message: 'Ujian yang sudah memiliki hasil tidak dapat dihapus.', variant: 'danger', okText: 'Hapus', icon: 'bi-trash' })) return;
        try { const r = await App.api('api/admin/exams.php', { method: 'POST', data: { action: 'delete', id: b.dataset.del } }); App.toast(r.message); load(); }
        catch (err) { App.toast(err.message, 'error'); }
    });
    const fQ = document.getElementById('fQ'), fType = document.getElementById('fType'), fStatus = document.getElementById('fStatus');
    fQ.addEventListener('input', App.debounce(load, 300));
    fType.addEventListener('change', load);
    fStatus.addEventListener('change', load);
    load();
})();
