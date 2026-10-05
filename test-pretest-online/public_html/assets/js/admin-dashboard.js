/* Admin dashboard charts */
(async function () {
    'use strict';
    // Saklar modul Pre-Test / Test (hanya admin)
    document.querySelectorAll('[data-module]').forEach((box) => {
        const chk = box.querySelector('input');
        chk.addEventListener('change', async () => {
            const type = box.dataset.module;
            const label = type === 'test' ? 'Test' : 'Pre-Test';
            if (!chk.checked && !await App.confirm({ title: `Nonaktifkan ${label}?`, message: `Peserta tidak akan dapat melihat maupun memulai ${label}. Peserta yang sedang mengerjakan tetap dapat menyelesaikan.`, variant: 'danger', okText: 'Nonaktifkan', icon: 'bi-toggle-off' })) {
                chk.checked = true;
                return;
            }
            try {
                const r = await App.api('api/admin/settings.php', { method: 'POST', data: { action: 'toggle_module', type, enabled: chk.checked ? 1 : 0 } });
                box.classList.toggle('on', r.enabled);
                box.querySelector('.state').textContent = r.enabled ? '● AKTIF — terlihat oleh peserta' : '● NONAKTIF — disembunyikan dari peserta';
                document.querySelectorAll('.module-pills span').forEach((p) => {
                    if (p.textContent.trim() === label) { p.classList.toggle('on', r.enabled); p.classList.toggle('off', !r.enabled); }
                });
                App.toast(r.message, r.enabled ? 'success' : 'warning');
            } catch (e) { chk.checked = !chk.checked; App.toast(e.message, 'error'); }
        });
    });

    const css = (v, d) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d;
    const C = { navy: '#13265a', blue: css('--blue', '#2f6bff'), gold: css('--gold', '#d4a72c'), green: '#12a150', red: '#e04848', muted: '#94a0bb', grid: '#eef0f6' };
    const alpha = (hex, a) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16)).join(',')},${a})`;
    const dark = () => App.theme() === 'dark';
    C.grid = dark() ? '#22304f' : '#eef0f6';
    Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
    Chart.defaults.color = dark() ? '#94a1bd' : '#66728c';
    document.addEventListener('themechange', () => location.reload());
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.maintainAspectRatio = false;
    const gridOpt = { grid: { color: C.grid }, border: { display: false } };
    const noGrid = { grid: { display: false }, border: { display: false } };

    let s;
    try { s = await App.api('api/admin/stats.php'); } catch (e) { App.toast(e.message, 'error'); return; }

    const t = s.totals;
    const set = (k, v) => { const el = document.querySelector(`[data-stat="${k}"]`); if (el) el.textContent = v; };
    const count = (k, v, dec = 0) => {
        const el = document.querySelector(`[data-stat="${k}"]`);
        if (!el) return;
        if (v === null || v === undefined) { el.textContent = '—'; return; }
        el.dataset.count = v; el.dataset.dec = dec; App.countUp(el);
    };
    count('total_users', t.total_users);
    count('total_pretest', t.total_pretest);
    count('total_test', t.total_test);
    count('total_submissions', t.total_submissions);
    count('avg_test', t.avg_test, 1);
    count('avg_pretest', t.avg_pretest, 1);

    const buckets = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-89', '90-100'];
    new Chart(document.getElementById('chDist'), {
        type: 'bar',
        data: { labels: buckets, datasets: [
            { label: 'Pre-Test', data: s.distribution.pretest, backgroundColor: C.blue, borderRadius: 6, maxBarThickness: 26 },
            { label: 'Test', data: s.distribution.test, backgroundColor: C.gold, borderRadius: 6, maxBarThickness: 26 },
        ] },
        options: { scales: { x: noGrid, y: { ...gridOpt, beginAtZero: true, ticks: { precision: 0 } } } },
    });

    const passChart = new Chart(document.getElementById('chPass'), {
        type: 'doughnut',
        data: { labels: ['Lulus', 'Tidak Lulus'], datasets: [{ data: [0, 0], backgroundColor: [C.green, C.red], borderWidth: 0, hoverOffset: 6 }] },
        options: { cutout: '68%', plugins: { legend: { position: 'bottom' } } },
    });
    const updatePass = () => {
        const p = s.pass[document.getElementById('passType').value];
        passChart.data.datasets[0].data = [p.passed, p.failed];
        passChart.update();
    };
    document.getElementById('passType').addEventListener('change', updatePass);
    updatePass();

    new Chart(document.getElementById('chDaily'), {
        type: 'line',
        data: { labels: s.daily.labels, datasets: [
            { label: 'Pre-Test', data: s.daily.pretest, borderColor: C.blue, backgroundColor: alpha(C.blue, .12), fill: true, tension: .35, pointRadius: 3 },
            { label: 'Test', data: s.daily.test, borderColor: C.gold, backgroundColor: alpha(C.gold, .12), fill: true, tension: .35, pointRadius: 3 },
        ] },
        options: { scales: { x: noGrid, y: { ...gridOpt, beginAtZero: true, ticks: { precision: 0 } } }, interaction: { mode: 'index', intersect: false } },
    });

    new Chart(document.getElementById('chCompare'), {
        type: 'bar',
        data: { labels: s.per_dept.map((d) => d.department), datasets: [
            { label: 'Pre-Test', data: s.per_dept.map((d) => d.avg_pretest), backgroundColor: C.blue, borderRadius: 6, maxBarThickness: 22 },
            { label: 'Test', data: s.per_dept.map((d) => d.avg_test), backgroundColor: C.gold, borderRadius: 6, maxBarThickness: 22 },
        ] },
        options: { scales: { x: noGrid, y: { ...gridOpt, beginAtZero: true, max: 100 } } },
    });

    new Chart(document.getElementById('chExam'), {
        data: { labels: s.per_exam.map((e) => (e.title.length > 22 ? e.title.slice(0, 22) + '…' : e.title)), datasets: [
            { type: 'bar', label: 'Peserta', data: s.per_exam.map((e) => e.participants), backgroundColor: dark() ? 'rgba(120,150,230,.6)' : 'rgba(19,38,90,.85)', borderRadius: 6, yAxisID: 'y', maxBarThickness: 28 },
            { type: 'line', label: 'Rata-rata Score', data: s.per_exam.map((e) => e.avg_score), borderColor: C.gold, backgroundColor: C.gold, yAxisID: 'y1', tension: .3 },
        ] },
        options: { scales: {
            x: noGrid,
            y: { ...gridOpt, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Peserta' } },
            y1: { position: 'right', beginAtZero: true, max: 100, grid: { display: false }, border: { display: false }, title: { display: true, text: 'Score' } },
        } },
    });

    const top = document.getElementById('topList');
    top.innerHTML = s.top.length ? s.top.map((r, i) => `
        <a href="${App.url('admin/result-detail.php?id=' + r.id)}" class="d-flex align-items-center gap-3 py-2 border-bottom text-reset">
            <span class="fw-800 ${i === 0 ? 'text-warning' : 'text-muted'}" style="width:22px">#${i + 1}</span>
            <div class="avatar">${App.esc(r.name.split(' ').slice(0, 2).map((x) => x[0]).join('').toUpperCase())}</div>
            <div class="min-w-0 flex-fill"><div class="fw-semibold text-truncate">${App.esc(r.name)}</div><small class="text-muted text-truncate d-block">${App.esc(r.title)}</small></div>
            <span class="score-pill bs-green">${App.num(r.score, 1)}</span>
        </a>`).join('') : '<div class="empty-state py-4"><i class="bi bi-trophy"></i>Belum ada data Test.</div>';

    document.getElementById('recentBody').innerHTML = s.recent.length ? s.recent.map((r) => `
        <tr class="clickable" onclick="location.href='${App.url('admin/result-detail.php?id=' + r.id)}'">
            <td class="fw-semibold">${App.esc(r.name)}</td>
            <td>${App.esc(r.title)}</td>
            <td>${App.typeBadge(r.type)}</td>
            <td><span class="score-pill ${Number(r.passed) ? 'bs-green' : 'bs-red'}">${App.num(r.score, 1)}</span></td>
            <td class="text-muted">${App.date(r.submitted_at)}</td>
        </tr>`).join('') : '<tr><td colspan="5"><div class="empty-state py-4"><i class="bi bi-inbox"></i>Belum ada submission.</div></td></tr>';
})();
