/* Admin — Question Bank */
(function () {
    'use strict';
    const T = { multiple_choice: 'Multiple Choice', multiple_answer: 'Multiple Answer', true_false: 'True / False', short_answer: 'Short Answer', essay: 'Essay' };
    const D = { easy: ['Mudah', 'bs-green'], medium: ['Sedang', 'bs-amber'], hard: ['Sulit', 'bs-red'] };
    const body = document.getElementById('qBody');
    const qModal = new bootstrap.Modal('#qModal');
    const catModal = new bootstrap.Modal('#catModal');
    const qForm = document.getElementById('qForm');
    const optList = document.getElementById('optList');
    let page = 1;
    let locked = false;
    let categories = [];

    /* ---------- List ---------- */
    async function load() {
        try {
            const r = await App.api('api/admin/questions.php', { params: { action: 'list', page, q: fQ.value, category_id: fCat.value, type: fType.value, difficulty: fDiff.value } });
            body.innerHTML = r.data.length ? r.data.map((q) => `
                <tr>
                    <td class="td-main"><div class="line-clamp-2 fw-semibold">${App.esc(q.question)}</div><small class="text-muted">#${q.id}${Number(q.used) ? ' · <i class="bi bi-lock"></i> dipakai' : ''}</small></td>
                    <td data-label="Tipe"><span class="badge badge-soft bs-blue">${T[q.question_type]}</span></td>
                    <td data-label="Kategori">${App.esc(q.category || '—')}</td>
                    <td data-label="Level"><span class="badge badge-soft ${D[q.difficulty][1]}">${D[q.difficulty][0]}</span></td>
                    <td data-label="Point" class="text-end">${App.num(q.points, 2)}</td>
                    <td class="text-end text-nowrap td-actions">
                        <button class="btn btn-soft btn-sm" data-edit="${q.id}"><i class="bi bi-pencil"></i></button>
                        <button class="btn btn-soft-danger btn-sm" data-del="${q.id}" ${Number(q.used) ? 'disabled title="Dipakai dalam hasil ujian"' : ''}><i class="bi bi-trash"></i></button>
                    </td>
                </tr>`).join('') : '<tr><td colspan="6"><div class="empty-state"><i class="bi bi-collection"></i>Belum ada soal.</div></td></tr>';
            document.getElementById('qInfo').textContent = `${r.total} soal`;
            App.pagination(document.getElementById('qPager'), r, (p) => { page = p; load(); });
        } catch (e) { App.toast(e.message, 'error'); }
    }

    async function loadCats() {
        const r = await App.api('api/admin/questions.php', { params: { action: 'categories' } });
        categories = r.data;
        const opts = categories.map((c) => `<option value="${c.id}">${App.esc(c.name)}</option>`).join('');
        const keep = fCat.value;
        fCat.innerHTML = '<option value="">Semua kategori</option><option value="none">Tanpa kategori</option>' + opts;
        fCat.value = keep;
        document.getElementById('qCat').innerHTML = '<option value="">— Tanpa kategori —</option>' + opts;
        document.getElementById('catList').innerHTML = categories.length ? categories.map((c) => `
            <li class="list-group-item d-flex align-items-center gap-2">
                <div class="min-w-0 flex-fill"><div class="fw-semibold text-truncate">${App.esc(c.name)}</div><small class="text-muted">${c.questions} soal</small></div>
                <button class="btn btn-light btn-sm" data-cedit="${c.id}"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-light btn-sm text-danger" data-cdel="${c.id}"><i class="bi bi-trash"></i></button>
            </li>`).join('') : '<li class="list-group-item text-muted small">Belum ada kategori.</li>';
    }

    /* ---------- Editor opsi ---------- */
    function optRow(o = {}, type) {
        const multi = type === 'multiple_answer';
        const isShort = type === 'short_answer';
        const tf = type === 'true_false';
        const div = document.createElement('div');
        div.className = 'option-row';
        div.dataset.id = o.id || '';
        div.innerHTML = `
            ${isShort ? '<i class="bi bi-check2 text-success"></i>' : `<input class="form-check-input mt-0 opt-correct" type="${multi ? 'checkbox' : 'radio'}" name="correct" title="Jawaban benar" ${Number(o.is_correct) ? 'checked' : ''} ${locked ? 'disabled' : ''}>`}
            <input class="form-control opt-text" value="${App.esc(o.option_text || '')}" placeholder="${isShort ? 'Jawaban yang diterima' : 'Teks pilihan'}" ${tf && !locked ? 'readonly' : ''}>
            ${tf || locked ? '' : '<button type="button" class="btn btn-light btn-sm text-danger opt-rm"><i class="bi bi-x-lg"></i></button>'}`;
        return div;
    }

    function renderOptions(type, options) {
        optList.innerHTML = '';
        const wrap = document.getElementById('optWrap');
        wrap.style.display = type === 'essay' ? 'none' : '';
        document.getElementById('btnAddOpt').style.display = type === 'true_false' || locked ? 'none' : '';
        document.getElementById('optLabel').textContent = type === 'short_answer' ? 'Jawaban yang diterima' : 'Pilihan jawaban';
        document.getElementById('optHelp').textContent = {
            multiple_choice: 'Pilih tepat satu jawaban benar (radio).',
            multiple_answer: 'Centang semua jawaban benar. Peserta harus memilih kombinasi yang tepat.',
            true_false: 'Pilih mana yang benar.',
            short_answer: 'Jawaban peserta dicocokkan tanpa membedakan huruf besar/kecil & spasi berlebih.',
        }[type] || '';
        if (type === 'true_false' && (!options || options.length !== 2)) options = [{ option_text: 'Benar', is_correct: 1 }, { option_text: 'Salah', is_correct: 0 }];
        if (!options || !options.length) options = type === 'short_answer' ? [{}] : [{}, {}, {}, {}];
        options.forEach((o) => optList.appendChild(optRow(o, type)));
    }

    document.getElementById('qType').addEventListener('change', (e) => {
        const cur = collectOptions();
        const t = e.target.value;
        renderOptions(t, t === 'true_false' ? null : cur.map((o) => ({ option_text: o.text, is_correct: t === 'multiple_choice' ? 0 : o.is_correct })));
    });
    document.getElementById('btnAddOpt').addEventListener('click', () => optList.appendChild(optRow({}, document.getElementById('qType').value)));
    optList.addEventListener('click', (e) => { const b = e.target.closest('.opt-rm'); if (b) b.closest('.option-row').remove(); });

    function collectOptions() {
        return [...optList.querySelectorAll('.option-row')].map((r) => ({
            id: Number(r.dataset.id) || 0,
            text: r.querySelector('.opt-text').value,
            is_correct: r.querySelector('.opt-correct') ? (r.querySelector('.opt-correct').checked ? 1 : 0) : 1,
        }));
    }

    function openEditor(q) {
        qForm.reset();
        locked = !!(q && q.used);
        qForm.elements.id.value = q ? q.id : '';
        document.getElementById('qModalTitle').textContent = q ? `Edit Soal #${q.id}` : 'Soal Baru';
        document.getElementById('usedNote').style.display = locked ? '' : 'none';
        qForm.elements.question_type.disabled = locked;
        qForm.elements.points.disabled = locked;
        const prev = document.getElementById('imgPreview');
        prev.classList.toggle('d-none', !(q && q.image_url));
        if (q && q.image_url) prev.querySelector('img').src = q.image_url;
        if (q) {
            qForm.elements.question_type.value = q.question_type;
            qForm.elements.category_id.value = q.category_id || '';
            qForm.elements.difficulty.value = q.difficulty;
            qForm.elements.points.value = Number(q.points);
            qForm.elements.question.value = q.question;
            qForm.elements.explanation.value = q.explanation || '';
        } else if (fCat.value && fCat.value !== 'none') {
            qForm.elements.category_id.value = fCat.value;
        }
        renderOptions(qForm.elements.question_type.value, q ? q.options : null);
        qModal.show();
    }

    qForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(qForm);
        fd.set('action', 'save');
        fd.set('question_type', qForm.elements.question_type.value);
        fd.set('points', qForm.elements.points.value);
        fd.set('options', JSON.stringify(collectOptions()));
        if (!qForm.elements.image.files.length) fd.delete('image');
        try {
            const r = await App.api('api/admin/questions.php', { method: 'POST', data: fd });
            App.toast(r.message);
            qModal.hide();
            load(); loadCats();
        } catch (err) { App.toast(err.message, 'error', 5000); }
    });

    body.addEventListener('click', async (e) => {
        const ed = e.target.closest('[data-edit]');
        const del = e.target.closest('[data-del]');
        if (ed) {
            try { const r = await App.api('api/admin/questions.php', { params: { action: 'get', id: ed.dataset.edit } }); openEditor(r.data); }
            catch (err) { App.toast(err.message, 'error'); }
        }
        if (del) {
            if (!await App.confirm({ title: 'Hapus soal?', message: 'Soal akan dihapus permanen dari question bank dan semua ujian.', variant: 'danger', okText: 'Hapus', icon: 'bi-trash' })) return;
            try { const r = await App.api('api/admin/questions.php', { method: 'POST', data: { action: 'delete', id: del.dataset.del } }); App.toast(r.message); load(); loadCats(); }
            catch (err) { App.toast(err.message, 'error', 5000); }
        }
    });

    /* ---------- Kategori ---------- */
    const catForm = document.getElementById('catForm');
    document.getElementById('btnNewCat').addEventListener('click', () => { catForm.reset(); catForm.elements.id.value = ''; catModal.show(); });
    document.getElementById('catList').addEventListener('click', async (e) => {
        const ed = e.target.closest('[data-cedit]');
        const del = e.target.closest('[data-cdel]');
        if (ed) {
            const c = categories.find((x) => String(x.id) === ed.dataset.cedit);
            catForm.elements.id.value = c.id; catForm.elements.name.value = c.name; catForm.elements.description.value = c.description || '';
            catModal.show();
        }
        if (del) {
            if (!await App.confirm({ title: 'Hapus kategori?', message: 'Soal di dalamnya tidak terhapus, hanya menjadi tanpa kategori.', variant: 'danger', okText: 'Hapus' })) return;
            try { const r = await App.api('api/admin/questions.php', { method: 'POST', data: { action: 'category_delete', id: del.dataset.cdel } }); App.toast(r.message); loadCats(); load(); }
            catch (err) { App.toast(err.message, 'error'); }
        }
    });
    catForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const r = await App.api('api/admin/questions.php', { method: 'POST', data: { action: 'category_save', ...Object.fromEntries(new FormData(catForm).entries()) } });
            App.toast(r.message); catModal.hide(); loadCats();
        } catch (err) { App.toast(err.message, 'error'); }
    });

    document.getElementById('importForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        fd.set('action', 'import');
        const out = document.getElementById('importResult');
        out.innerHTML = '<div class="spinner-border spinner-border-sm"></div> Memproses...';
        try {
            const r = await App.api('api/admin/questions.php', { method: 'POST', data: fd });
            out.innerHTML = `<div class="alert alert-success soft-alert py-2 mb-2">${App.esc(r.message)}</div>` +
                (r.skipped.length ? `<div class="alert alert-warning soft-alert py-2 mb-0"><strong>${r.skipped.length} baris dilewati:</strong><br>${r.skipped.map(App.esc).join('<br>')}</div>` : '');
            loadCats(); load();
        } catch (err) { out.innerHTML = `<div class="alert alert-danger soft-alert py-2">${App.esc(err.message)}</div>`; }
    });

    const fQ = document.getElementById('fQ'), fCat = document.getElementById('fCat'), fType = document.getElementById('fType'), fDiff = document.getElementById('fDiff');
    fQ.addEventListener('input', App.debounce(() => { page = 1; load(); }, 300));
    [fCat, fType, fDiff].forEach((el) => el.addEventListener('change', () => { page = 1; load(); }));
    document.getElementById('btnNew').addEventListener('click', () => openEditor(null));
    loadCats().then(load);
})();
