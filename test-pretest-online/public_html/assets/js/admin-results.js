/* Admin — Test Results */
(function () {
    'use strict';
    const form = document.getElementById('filterForm');
    const tbody = document.querySelector('#resultsTable tbody');
    let page = 1;
    let ctrl;

    const params = () => Object.fromEntries(new FormData(form).entries());

    function syncSortHeaders() {
        const { sort, dir } = params();
        document.querySelectorAll('th.sortable').forEach((th) => {
            th.classList.remove('asc', 'desc');
            if (th.dataset.sort === sort) th.classList.add(dir.toLowerCase());
        });
    }

    function exportLinks() {
        const qs = new URLSearchParams(Object.entries(params()).filter(([, v]) => v !== '')).toString();
        document.getElementById('btnExcel').href = App.url('admin/export-excel.php?' + qs);
        document.getElementById('btnPdf').href = App.url('admin/export-pdf.php?' + qs);
        history.replaceState(null, '', '?' + qs);
    }

    async function load() {
        syncSortHeaders();
        exportLinks();
        ctrl?.abort();
        ctrl = new AbortController();
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-5 text-muted"><div class="spinner-border spinner-border-sm"></div></td></tr>';
        try {
            const r = await App.api('api/admin/results.php', { params: { ...params(), page }, signal: ctrl.signal });
            render(r);
        } catch (e) {
            if (e.name === 'AbortError') return;
            tbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger py-4">${App.esc(e.message)}</td></tr>`;
        }
    }

    function render(r) {
        const s = r.summary || {};
        const set = (k, v) => { document.querySelector(`[data-sum="${k}"]`).textContent = v; };
        set('n', App.num(s.n));
        set('avg_score', s.avg_score !== null ? App.num(s.avg_score, 1) : '—');
        set('max_score', s.max_score !== null ? App.num(s.max_score, 1) : '—');
        set('pass_rate', Number(s.n) ? App.num((Number(s.passed) / Number(s.n)) * 100, 1) + '%' : '—');

        if (!r.data.length) {
            tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="bi bi-inbox"></i>Tidak ada hasil yang cocok dengan filter.</div></td></tr>';
        } else {
            tbody.innerHTML = r.data.map((x) => {
                const ini = x.name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
                const pending = Number(x.pending_review) > 0 ? `<span class="badge badge-soft bs-amber ms-1" title="Essay belum dinilai"><i class="bi bi-hourglass-split"></i> ${x.pending_review}</span>` : '';
                const auto = x.status === 'auto_submitted' ? '<span class="badge badge-soft bs-gray ms-1" title="Dikirim otomatis saat waktu habis"><i class="bi bi-stopwatch"></i></span>' : '';
                const tabs = Number(x.tab_switches) > 0 ? `<span class="badge badge-soft ${Number(x.tab_switches) >= 3 ? 'bs-red' : 'bs-amber'} ms-1" title="Meninggalkan halaman ujian"><i class="bi bi-eye-slash"></i> ${x.tab_switches}</span>` : '';
                return `<tr class="clickable" data-id="${x.id}">
                    <td class="td-main"><div class="user-cell"><div class="avatar">${App.esc(ini)}</div><div class="min-w-0"><div class="fw-semibold">${App.esc(x.name)}</div><small class="text-muted">${App.esc(x.department || '@' + x.username)}</small></div></div></td>
                    <td data-label="Ujian"><div class="fw-semibold">${App.esc(x.exam_title)}</div>${App.typeBadge(x.exam_type)}</td>
                    <td data-label="Benar" class="text-end text-success fw-semibold">${x.correct_answers}</td>
                    <td data-label="Salah" class="text-end text-danger fw-semibold">${x.wrong_answers}</td>
                    <td data-label="Kosong" class="text-end text-muted">${x.unanswered}</td>
                    <td data-label="Score" class="text-end"><span class="score-pill ${App.scoreClass(x.score, x.passing_grade)}">${App.num(x.score, 1)}</span>${pending}</td>
                    <td data-label="Durasi" class="text-nowrap">${App.duration(x.duration)}${auto}${tabs}</td>
                    <td data-label="Tanggal" class="text-muted text-nowrap">${App.date(x.submitted_at)}</td>
                    <td class="text-end d-none d-md-table-cell"><i class="bi bi-chevron-right text-muted"></i></td>
                </tr>`;
            }).join('');
        }
        const from = r.total ? (r.page - 1) * 25 + 1 : 0;
        document.getElementById('pageInfo').textContent = `Menampilkan ${from}–${Math.min(r.page * 25, r.total)} dari ${r.total} hasil`;
        App.pagination(document.getElementById('pager'), r, (p) => { page = p; load(); });
    }

    tbody.addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-id]');
        if (tr) location.href = App.url('admin/result-detail.php?id=' + tr.dataset.id);
    });
    document.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => {
        const s = form.elements.sort, d = form.elements.dir;
        if (s.value === th.dataset.sort) d.value = d.value.toLowerCase() === 'asc' ? 'desc' : 'asc';
        else { s.value = th.dataset.sort; d.value = ['name', 'exam'].includes(th.dataset.sort) ? 'asc' : 'desc'; }
        page = 1; load();
    }));
    form.addEventListener('submit', (e) => { e.preventDefault(); page = 1; load(); });
    document.getElementById('btnFilterToggle')?.addEventListener('click', () => form.classList.toggle('show-adv'));
    form.addEventListener('change', () => { page = 1; load(); });
    form.elements.q.addEventListener('input', App.debounce(() => { page = 1; load(); }, 350));
    document.getElementById('btnReset').addEventListener('click', () => {
        form.querySelectorAll('input:not([type=hidden]), select').forEach((el) => { el.value = ''; });
        form.elements.sort.value = 'submitted_at';
        form.elements.dir.value = 'desc';
        page = 1; load();
    });
    load();
})();
