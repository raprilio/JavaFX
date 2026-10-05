/* Admin — detail hasil: grading essay, hitung ulang, hapus attempt */
(function () {
    'use strict';
    const id = window.ATTEMPT_ID;

    document.querySelectorAll('.grade-form').forEach((f) => f.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const r = await App.api('api/admin/attempts.php', { method: 'POST', data: { action: 'grade', answer_id: f.dataset.answer, points: f.elements.points.value } });
            App.toast(r.message);
            setTimeout(() => location.reload(), 600);
        } catch (err) { App.toast(err.message, 'error'); }
    }));

    document.querySelector('[data-action="regrade"]')?.addEventListener('click', async () => {
        if (!await App.confirm({ title: 'Hitung ulang nilai?', message: 'Nilai soal otomatis dihitung ulang berdasarkan kunci jawaban terbaru. Nilai essay tetap.' })) return;
        try { const r = await App.api('api/admin/attempts.php', { method: 'POST', data: { action: 'regrade', id } }); App.toast(r.message); setTimeout(() => location.reload(), 600); }
        catch (err) { App.toast(err.message, 'error'); }
    });

    document.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
        if (!await App.confirm({ title: 'Hapus attempt ini?', message: 'Seluruh jawaban dan score attempt ini akan dihapus permanen. Peserta dapat mengerjakan ulang.', variant: 'danger', okText: 'Hapus', icon: 'bi-trash' })) return;
        try { await App.api('api/admin/attempts.php', { method: 'POST', data: { action: 'delete', id } }); location.href = App.url('admin/results.php'); }
        catch (err) { App.toast(err.message, 'error'); }
    });
})();
