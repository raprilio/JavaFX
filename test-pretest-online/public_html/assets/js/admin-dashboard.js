/* Admin dashboard charts */
(async function () {
    'use strict';
    const C = { navy: '#13265a', blue: '#2f6bff', gold: '#d4a72c', green: '#16a36a', red: '#e04848', muted: '#94a0bb', grid: '#eef0f6' };
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    Chart.defaults.color = '#6b7690';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.maintainAspectRatio = false;
    const gridOpt = { grid: { color: C.grid }, border: { display: false } };
    const noGrid = { grid: { display: false }, border: { display: false } };

    let s;
    try { s = await App.api('api/admin/stats.php'); } catch (e) { App.toast(e.message, 'error'); return; }

    const t = s.totals;
    const set = (k, v) => { const el = document.querySelector(`[data-stat="${k}"]`); if (el) el.textContent = v; };
    set('total_users', App.num(t.total_users));
    set('total_pretest', App.num(t.total_pretest));
    set('total_test', App.num(t.total_test));
    set('total_submissions', App.num(t.total_submissions));
    set('avg_test', t.avg_test !== null ? App.num(t.avg_test, 1) : '—');
    set('avg_pretest', t.avg_pretest !== null ? App.num(t.avg_pretest, 1) : '—');

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
            { label: 'Pre-Test', data: s.daily.pretest, borderColor: C.blue, backgroundColor: 'rgba(47,107,255,.12)', fill: true, tension: .35, pointRadius: 3 },
            { label: 'Test', data: s.daily.test, borderColor: C.gold, backgroundColor: 'rgba(212,167,44,.12)', fill: true, tension: .35, pointRadius: 3 },
        ] },
        options: { scales: { x: noGrid, y: { ...gridOpt, beginAtZero: true, ticks: { precision: 0 } } }, interaction: { mode: 'index', intersect: false } },
    });

    new Chart(document.getElementById('chCompare'), {
        type: 'bar',
        data: { labels: s.per_dept.map((d) => d.department), datasets: [
            { label: 'Pre-Test', data: s.per_dept.map((d) => d.avg_pretest), backgroundColor: C.blue, borderRadius: 6, maxBarThickness: 22 },
            { label: 'Test', data: s.per_dept.map((d) => d.avg_test), backgroundColor: C.navy, borderRadius: 6, maxBarThickness: 22 },
        ] },
        options: { scales: { x: noGrid, y: { ...gridOpt, beginAtZero: true, max: 100 } } },
    });

    new Chart(document.getElementById('chExam'), {
        data: { labels: s.per_exam.map((e) => (e.title.length > 22 ? e.title.slice(0, 22) + '…' : e.title)), datasets: [
            { type: 'bar', label: 'Peserta', data: s.per_exam.map((e) => e.participants), backgroundColor: 'rgba(19,38,90,.85)', borderRadius: 6, yAxisID: 'y', maxBarThickness: 28 },
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
