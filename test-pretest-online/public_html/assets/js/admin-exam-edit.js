/* Admin — buat/edit ujian */
(function () {
    'use strict';
    const examId = window.EXAM_ID;
    const form = document.getElementById('settingsForm');
    const typeLabels = { multiple_choice: 'MC', multiple_answer: 'MA', true_false: 'T/F', short_answer: 'Short', essay: 'Essay' };

    /* ---------- Pengaturan ---------- */
    function applyTypePolicy() {
        const isTest = form.querySelector('input[name="type"]:checked').value === 'test';
        ['swResult', 'swReview'].forEach((id) => {
            const el = document.getElementById(id);
            if (isTest) el.checked = false;
            el.disabled = isTest;
        });
        document.getElementById('testNote').style.display = isTest ? '' : 'none';
    }
    form.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener('change', applyTypePolicy));
    applyTypePolicy();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const data = Object.fromEntries(fd.entries());
        ['show_result', 'show_correct_answer', 'random_question', 'random_answer'].forEach((k) => { data[k] = fd.has(k) ? 1 : 0; });
        data.action = 'save';
        try {
            const r = await App.api('api/admin/exams.php', { method: 'POST', data });
            App.toast(r.message);
            if (!examId) setTimeout(() => { location.href = App.url('admin/exam-edit.php?id=' + r.id); }, 700);
        } catch (err) { App.toast(err.message, 'error'); }
    });

    if (!examId) return;

    /* ---------- Pool soal ---------- */
    let bank = [];
    let selected = [];
    const bankList = document.getElementById('bankList');
    const selList = document.getElementById('selList');

    function renderBank() {
        const set = new Set(selected);
        bankList.innerHTML = bank.length ? bank.map((q) => `
            <label>
                <input type="checkbox" class="form-check-input mt-1 bank-chk" value="${q.id}" ${set.has(Number(q.id)) ? 'checked' : ''}>
                <span class="min-w-0 flex-fill"><span class="line-clamp-2">${App.esc(q.question)}</span>
                <small class="text-muted">#${q.id} · ${typeLabels[q.question_type]} · ${App.esc(q.category || 'Tanpa kategori')} · ${App.num(q.points, 2)} pt</small></span>
            </label>`).join('') : '<div class="empty-state py-4"><i class="bi bi-search"></i>Tidak ada soal.</div>';
    }

    const qMap = new Map();
    function renderSelected() {
        selList.innerHTML = selected.length ? selected.map((id, i) => {
            const q = qMap.get(id);
            return `<label class="align-items-center">
                <span class="fw-bold text-muted" style="width:26px">${i + 1}.</span>
                <span class="flex-fill min-w-0 small line-clamp-2">${q ? App.esc(q.question) : '#' + id}</span>
                <span class="btn-group btn-group-sm">
                    <button type="button" class="btn btn-light" data-up="${i}" ${i === 0 ? 'disabled' : ''}><i class="bi bi-arrow-up"></i></button>
                    <button type="button" class="btn btn-light" data-down="${i}" ${i === selected.length - 1 ? 'disabled' : ''}><i class="bi bi-arrow-down"></i></button>
                    <button type="button" class="btn btn-light text-danger" data-rm="${i}"><i class="bi bi-x-lg"></i></button>
                </span></label>`;
        }).join('') : '<div class="empty-state py-4"><i class="bi bi-inbox"></i>Belum ada soal dipilih.</div>';
        document.getElementById('selCount').textContent = selected.length;
        document.getElementById('poolBadge').textContent = selected.length;
        const count = Number(form.elements.question_count.value || 0);
        const rq = form.elements.random_question.checked;
        document.getElementById('drawInfo').innerHTML = count > 0 && count < selected.length
            ? `Setiap peserta mendapat <strong>${count}</strong> dari ${selected.length} soal${rq ? ' secara <strong>acak</strong>' : ' (urutan teratas)'}.`
            : `Peserta mengerjakan semua <strong>${selected.length}</strong> soal${rq ? ' dengan urutan acak' : ''}.`;
    }

    async function loadBank() {
        const r = await App.api('api/admin/questions.php', { params: { action: 'list', all: 1, q: pQ.value, category_id: pCat.value, type: pType.value } });
        bank = r.data;
        bank.forEach((q) => qMap.set(Number(q.id), q));
        renderBank();
        renderSelected();
    }

    bankList.addEventListener('change', (e) => {
        const c = e.target.closest('.bank-chk');
        if (!c) return;
        const id = Number(c.value);
        selected = c.checked ? [...selected, id] : selected.filter((x) => x !== id);
        renderSelected();
    });
    selList.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        e.preventDefault();
        const i = Number(b.dataset.up ?? b.dataset.down ?? b.dataset.rm);
        if (b.dataset.up !== undefined) [selected[i - 1], selected[i]] = [selected[i], selected[i - 1]];
        if (b.dataset.down !== undefined) [selected[i + 1], selected[i]] = [selected[i], selected[i + 1]];
        if (b.dataset.rm !== undefined) selected.splice(i, 1);
        renderSelected();
        renderBank();
    });
    document.getElementById('btnAddAll').addEventListener('click', () => {
        const set = new Set(selected);
        bank.forEach((q) => { if (!set.has(Number(q.id))) selected.push(Number(q.id)); });
        renderBank(); renderSelected();
    });
    document.getElementById('btnClear').addEventListener('click', () => { selected = []; renderBank(); renderSelected(); });
    document.getElementById('btnSavePool').addEventListener('click', async () => {
        try { const r = await App.api('api/admin/exams.php', { method: 'POST', data: { action: 'set_questions', exam_id: examId, question_ids: selected } }); App.toast(r.message); }
        catch (err) { App.toast(err.message, 'error'); }
    });
    const pQ = document.getElementById('pQ'), pCat = document.getElementById('pCat'), pType = document.getElementById('pType');
    pQ.addEventListener('input', App.debounce(loadBank, 300));
    pCat.addEventListener('change', loadBank);
    pType.addEventListener('change', loadBank);
    form.elements.question_count.addEventListener('input', renderSelected);
    form.elements.random_question.addEventListener('change', renderSelected);

    /* ---------- Assignment ---------- */
    document.getElementById('uQ').addEventListener('input', (e) => {
        const s = e.target.value.toLowerCase();
        document.querySelectorAll('#userList label').forEach((l) => { l.style.display = l.dataset.search.includes(s) ? '' : 'none'; });
    });
    document.getElementById('btnSaveAssign').addEventListener('click', async () => {
        const user_ids = [...document.querySelectorAll('.user-chk:checked')].map((c) => Number(c.value));
        const departments = [...document.querySelectorAll('.dept-chk:checked')].map((c) => c.value);
        try { const r = await App.api('api/admin/exams.php', { method: 'POST', data: { action: 'set_assignments', exam_id: examId, user_ids, departments } }); App.toast(r.message); }
        catch (err) { App.toast(err.message, 'error'); }
    });

    (async () => {
        try {
            const r = await App.api('api/admin/exams.php', { params: { action: 'get', id: examId } });
            selected = r.data.question_ids;
            const users = new Set(r.data.assigned_users);
            const depts = new Set(r.data.assigned_departments);
            document.querySelectorAll('.user-chk').forEach((c) => { c.checked = users.has(Number(c.value)); });
            document.querySelectorAll('.dept-chk').forEach((c) => { c.checked = depts.has(c.value); });
            await loadBank();
            // pastikan soal terpilih yang tidak lolos filter tetap punya label
            if (selected.some((id) => !qMap.has(id))) {
                const all = await App.api('api/admin/questions.php', { params: { action: 'list', all: 1 } });
                all.data.forEach((q) => qMap.set(Number(q.id), q));
                renderSelected();
            }
        } catch (err) { App.toast(err.message, 'error'); }
    })();
})();
