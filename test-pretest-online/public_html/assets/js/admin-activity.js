/* Admin — Log Aktivitas */
(function () {
    'use strict';
    const META = {
        login: ['bi-box-arrow-in-right', 'ic-green', 'Login'],
        login_failed: ['bi-shield-exclamation', 'ic-red', 'Login gagal'],
        logout: ['bi-box-arrow-right', 'ic-navy', 'Logout'],
        exam_start: ['bi-play-circle', 'ic-blue', 'Mulai ujian'],
        exam_submit: ['bi-send-check', 'ic-green', 'Submit ujian'],
        exam_auto_submit: ['bi-stopwatch', 'ic-amber', 'Auto-submit'],
        module_toggle: ['bi-toggles', 'ic-gold', 'Modul'],
        settings: ['bi-gear', 'ic-gold', 'Pengaturan'],
        user: ['bi-person-gear', 'ic-navy', 'User'],
        question: ['bi-collection', 'ic-navy', 'Soal'],
        exam: ['bi-journal-check', 'ic-navy', 'Ujian'],
        result: ['bi-clipboard2-data', 'ic-navy', 'Hasil'],
        export: ['bi-download', 'ic-blue', 'Export'],
    };
    let page = 1;
    const fQ = document.getElementById('fQ'), fAction = document.getElementById('fAction'), fDate = document.getElementById('fDate');

    async function load() {
        try {
            const r = await App.api('api/admin/activity.php', { params: { q: fQ.value, action: fAction.value, date: fDate.value, page } });
            if (fAction.options.length <= 1) {
                r.actions.forEach((a) => fAction.add(new Option(META[a] ? META[a][2] : a, a)));
            }
            document.getElementById('logInfo').textContent = `${r.total} aktivitas`;
            document.getElementById('logList').innerHTML = r.data.length ? r.data.map((l) => {
                const m = META[l.action] || ['bi-dot', 'ic-navy', l.action];
                return `<div class="timeline-item">
                    <div class="dot ${m[1]}"><i class="bi ${m[0]}"></i></div>
                    <div class="min-w-0 flex-fill">
                        <div class="fw-semibold">${App.esc(l.description || m[2])}</div>
                        <div class="small text-muted">${l.name ? App.esc(l.name) + ' (@' + App.esc(l.username) + ')' : 'Sistem / tamu'} · ${App.esc(l.ip_address || '-')}</div>
                    </div>
                    <div class="small text-muted text-nowrap text-end">${App.date(l.created_at)}<br><span class="badge badge-soft bs-gray">${App.esc(m[2])}</span></div>
                </div>`;
            }).join('') : '<div class="empty-state"><i class="bi bi-activity"></i>Belum ada aktivitas.</div>';
            App.pagination(document.getElementById('logPager'), r, (p) => { page = p; load(); });
        } catch (e) { App.toast(e.message, 'error'); }
    }
    fQ.addEventListener('input', App.debounce(() => { page = 1; load(); }, 300));
    fAction.addEventListener('change', () => { page = 1; load(); });
    fDate.addEventListener('change', () => { page = 1; load(); });
    load();
})();
