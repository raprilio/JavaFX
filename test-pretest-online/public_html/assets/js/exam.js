/* ExamPro — exam runner: render soal, auto-save, timer, submit */
(function () {
    'use strict';
    const B = window.EXAM_BOOT;
    if (!B) return;

    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);
    const questions = B.questions;
    const flagKey = `exam_flags_${B.attemptId}`;
    const posKey = `exam_pos_${B.attemptId}`;
    let flags = new Set(JSON.parse(localStorage.getItem(flagKey) || '[]'));
    let idx = Math.min(Number(localStorage.getItem(posKey) || 0), questions.length - 1);
    let endAt = Date.now() + B.remaining * 1000;
    let submitting = false;
    let finished = false;

    const pending = new Map();   // questionId -> answer value (belum terkirim)
    const timers = new Map();    // debounce untuk input teks
    let inflight = 0;

    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    /* ---------------- Render ---------------- */
    function isAnswered(q) {
        const a = q.answer;
        if (a === null || a === undefined) return false;
        if (Array.isArray(a)) return a.length > 0;
        if (typeof a === 'string') return a.trim() !== '';
        return true;
    }

    function renderNav() {
        $$('[data-qnav]').forEach((nav) => {
            nav.innerHTML = '';
            questions.forEach((q, i) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = i + 1;
                b.className = [isAnswered(q) ? 'answered' : '', flags.has(q.id) ? 'flagged' : '', i === idx ? 'current' : ''].join(' ');
                b.addEventListener('click', () => {
                    go(i);
                    const sheet = bootstrap.Offcanvas.getInstance('#navSheet');
                    if (sheet) sheet.hide();
                });
                nav.appendChild(b);
            });
        });
        const answered = questions.filter(isAnswered).length;
        $$('[data-answered]').forEach((el) => { el.textContent = answered; });
        $('#progressBar').style.width = (questions.length ? (answered / questions.length) * 100 : 0) + '%';
    }

    function renderQuestion(animate = true) {
        const q = questions[idx];
        const card = $('#questionCard');
        const typeLabel = {
            multiple_choice: 'Pilih satu jawaban', multiple_answer: 'Pilih satu atau lebih jawaban',
            true_false: 'Benar atau Salah', short_answer: 'Jawaban singkat', essay: 'Uraian / Essay',
        }[q.type];

        let body = '';
        if (q.type === 'short_answer') {
            body = `<input type="text" class="form-control form-control-lg" id="txtAnswer" maxlength="500" placeholder="Ketik jawaban Anda..." autocomplete="off">`;
        } else if (q.type === 'essay') {
            body = `<textarea class="form-control" id="txtAnswer" rows="8" placeholder="Tulis jawaban Anda..."></textarea>`;
        } else {
            const multi = q.type === 'multiple_answer';
            body = q.options.map((o, i) => {
                const sel = multi ? (q.answer || []).includes(o.id) : q.answer === o.id;
                return `<label class="option ${multi ? 'multi' : ''} ${sel ? 'selected' : ''}" data-opt="${o.id}">
                    <input type="${multi ? 'checkbox' : 'radio'}" name="opt" value="${o.id}" ${sel ? 'checked' : ''}>
                    <span class="key">${multi && sel ? '<i class="bi bi-check-lg"></i>' : LETTERS[i]}</span>
                    <span class="txt">${App.esc(o.text)}</span>
                </label>`;
            }).join('');
        }

        card.innerHTML = `
            <div class="d-flex align-items-center gap-2 flex-wrap">
                <span class="question-no">Soal ${idx + 1} dari ${questions.length}</span>
                <span class="badge badge-soft bs-gray ms-auto">${App.esc(typeLabel)} · ${App.num(q.points, 2)} poin</span>
            </div>
            <div class="question-text">${App.esc(q.text)}</div>
            ${q.image ? `<img src="${App.esc(q.image)}" class="question-img" alt="Gambar soal">` : ''}
            <div class="${animate ? 'fade-in' : ''}">${body}</div>`;

        if (q.type === 'short_answer' || q.type === 'essay') {
            const t = $('#txtAnswer');
            t.value = q.answer || '';
            t.addEventListener('input', () => {
                q.answer = t.value;
                renderNav();
                clearTimeout(timers.get(q.id));
                setStatus('saving', 'Mengetik...');
                timers.set(q.id, setTimeout(() => queueSave(q), 800));
            });
            t.addEventListener('blur', () => { if (timers.has(q.id)) { clearTimeout(timers.get(q.id)); timers.delete(q.id); queueSave(q); } });
        } else {
            card.querySelectorAll('.option').forEach((el) => {
                el.addEventListener('click', (e) => {
                    e.preventDefault();
                    const id = Number(el.dataset.opt);
                    if (q.type === 'multiple_answer') {
                        const cur = new Set(q.answer || []);
                        cur.has(id) ? cur.delete(id) : cur.add(id);
                        q.answer = [...cur];
                    } else {
                        q.answer = id;
                    }
                    renderQuestion(false);
                    renderNav();
                    queueSave(q);
                });
            });
        }

        const last = idx === questions.length - 1;
        $$('[data-prev]').forEach((b) => { b.disabled = idx === 0; });
        $$('[data-next]').forEach((b) => {
            const compact = !b.textContent.trim();
            b.innerHTML = compact
                ? `<i class="bi ${last ? 'bi-check2-circle' : 'bi-chevron-right'}"></i>`
                : (last ? 'Selesai <i class="bi bi-check2-circle"></i>' : 'Berikutnya <i class="bi bi-chevron-right"></i>');
        });
        $$('[data-flag]').forEach((fb) => {
            fb.classList.toggle('btn-warning', flags.has(q.id));
            fb.classList.toggle('btn-light', !flags.has(q.id));
            const sp = fb.querySelector('span');
            if (sp) sp.textContent = flags.has(q.id) ? 'Ditandai' : 'Tandai';
        });
        localStorage.setItem(posKey, String(idx));
    }

    function go(i) {
        if (i < 0 || i >= questions.length) return;
        idx = i;
        renderQuestion();
        renderNav();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ---------------- Auto-save ---------------- */
    function setStatus(kind, text) {
        const icon = { ok: 'bi-check-circle-fill', err: 'bi-exclamation-triangle-fill', saving: 'bi-arrow-repeat spin' }[kind] || '';
        $$('[data-save-status]').forEach((el) => {
            el.classList.remove('ok', 'err', 'saving');
            el.classList.add(kind);
            el.innerHTML = icon ? `<i class="bi ${icon}"></i> ${App.esc(text)}` : App.esc(text);
        });
    }

    function queueSave(q) {
        timers.delete(q.id);
        pending.set(q.id, q.answer);
        flush();
    }

    async function flush() {
        if (finished) return;
        const items = [...pending.entries()];
        if (!items.length) return;
        pending.clear();
        setStatus('saving', 'Menyimpan...');
        for (const [qid, answer] of items) {
            inflight++;
            try {
                await App.api('api/user/save-answer.php', { method: 'POST', data: { attempt_id: B.attemptId, question_id: qid, answer } });
                if (!pending.size) setStatus('ok', 'Answer saved');
            } catch (err) {
                if (err.data && err.data.expired) { return onExpired(err.data.redirect); }
                if (!pending.has(qid)) pending.set(qid, answer); // simpan untuk dicoba ulang
                setStatus('err', 'Gagal menyimpan — mencoba ulang...');
                if (err.status && err.status < 500 && err.status !== 419) App.toast(err.message, 'error');
            } finally {
                inflight--;
            }
        }
    }
    setInterval(() => { if (pending.size && !inflight) flush(); }, 5000);

    async function waitForSaves() {
        timers.forEach((t, qid) => { clearTimeout(t); const q = questions.find((x) => x.id === qid); if (q) pending.set(qid, q.answer); });
        timers.clear();
        await flush();
        const start = Date.now();
        while ((inflight > 0 || pending.size) && Date.now() - start < 8000) {
            await new Promise((r) => setTimeout(r, 250));
            if (pending.size && !inflight) await flush();
        }
    }

    /* ---------------- Timer (server sumber kebenaran) ---------------- */
    const timerEl = $('#timer');
    function tick() {
        const left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
        const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
        const p = (x) => String(x).padStart(2, '0');
        timerEl.querySelector('span').textContent = h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
        timerEl.classList.toggle('warn', left <= 300 && left > 60);
        timerEl.classList.toggle('danger', left <= 60);
        if (left <= 0 && !submitting && !finished) {
            App.toast('Waktu habis! Jawaban dikirim otomatis.', 'warning', 5000);
            doSubmit(true);
        }
    }
    setInterval(tick, 1000);
    tick();

    async function syncTime() {
        if (finished) return;
        try {
            const r = await App.api('api/user/state.php', { params: { attempt_id: B.attemptId } });
            if (r.status !== 'in_progress') return onExpired(r.redirect);
            endAt = Date.now() + r.remaining * 1000;
        } catch (e) { /* abaikan, coba lagi nanti */ }
    }
    setInterval(syncTime, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncTime(); });

    function onExpired(redirect) {
        finished = true;
        location.href = App.url(redirect || 'dashboard.php');
    }

    /* ---------------- Submit ---------------- */
    const submitModal = new bootstrap.Modal('#submitModal');
    function openSubmit() {
        const sheet = bootstrap.Offcanvas.getInstance('#navSheet');
        if (sheet) sheet.hide();
        const un = questions.filter((q) => !isAnswered(q)).length;
        $('#submitUnanswered').innerHTML = un
            ? `<span class="text-danger fw-semibold"><i class="bi bi-exclamation-circle"></i> ${un} soal belum dijawab.</span>`
            : '<span class="text-success fw-semibold"><i class="bi bi-check-circle"></i> Semua soal sudah dijawab.</span>';
        submitModal.show();
    }

    async function doSubmit(auto = false) {
        if (submitting) return;
        submitting = true;
        const btn = $('#btnConfirmSubmit');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Mengirim...';
        try {
            await waitForSaves();
            const r = await App.api('api/user/submit.php', { method: 'POST', data: { attempt_id: B.attemptId, auto: auto ? 1 : 0 } });
            finished = true;
            localStorage.removeItem(flagKey);
            localStorage.removeItem(posKey);
            location.href = App.url(r.redirect);
        } catch (err) {
            if (err.data && err.data.redirect) return onExpired(err.data.redirect);
            submitting = false;
            btn.disabled = false;
            btn.textContent = B.examType === 'test' ? 'Submit Test' : 'Submit Pre-Test';
            App.toast(err.message || 'Gagal mengirim. Periksa koneksi lalu coba lagi.', 'error', 5000);
            if (auto) setTimeout(() => doSubmit(true), 4000);
        }
    }

    /* ---------------- Events ---------------- */
    $$('[data-prev]').forEach((b) => b.addEventListener('click', () => go(idx - 1)));
    $$('[data-next]').forEach((b) => b.addEventListener('click', () => (idx === questions.length - 1 ? openSubmit() : go(idx + 1))));
    $$('[data-flag]').forEach((b) => b.addEventListener('click', () => {
        const id = questions[idx].id;
        flags.has(id) ? flags.delete(id) : flags.add(id);
        localStorage.setItem(flagKey, JSON.stringify([...flags]));
        renderQuestion(false);
        renderNav();
    }));
    $$('[data-submit]').forEach((b) => b.addEventListener('click', openSubmit));
    $('#btnConfirmSubmit').addEventListener('click', () => doSubmit(false));
    window.addEventListener('beforeunload', (e) => {
        if (!finished && (pending.size || inflight || timers.size)) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
        if (e.key === 'ArrowRight') go(idx + 1);
        if (e.key === 'ArrowLeft') go(idx - 1);
    });

    /* ---------------- Pengawasan: deteksi pindah tab ---------------- */
    if (B.antiCheat) {
        let lastSent = 0;
        let away = false;
        const report = () => {
            if (finished || submitting || Date.now() - lastSent < 1500) return;
            lastSent = Date.now();
            away = true;
            const fd = new FormData();
            fd.append('csrf_token', document.querySelector('meta[name="csrf-token"]').content);
            fd.append('attempt_id', B.attemptId);
            fd.append('event', 'tab_switch');
            fetch(App.url('api/user/event.php'), { method: 'POST', body: fd, credentials: 'same-origin', keepalive: true })
                .then((r) => r.json()).then((j) => { if (j.ok) B.tabSwitches = j.tab_switches; }).catch(() => {});
        };
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) report();
            else if (away && !finished) {
                away = false;
                setTimeout(() => {
                    document.getElementById('cheatCount').textContent = Math.max(1, B.tabSwitches);
                    bootstrap.Modal.getOrCreateInstance('#cheatModal').show();
                }, 300);
            }
        });
        window.addEventListener('blur', () => { if (!document.hidden) report(); });
        window.addEventListener('focus', () => {
            if (away && !document.hidden && !finished) {
                away = false;
                setTimeout(() => {
                    document.getElementById('cheatCount').textContent = Math.max(1, B.tabSwitches);
                    bootstrap.Modal.getOrCreateInstance('#cheatModal').show();
                }, 300);
            }
        });
    }

    if (!questions.length) {
        $('#questionCard').innerHTML = '<div class="empty-state"><i class="bi bi-inbox"></i>Tidak ada soal.</div>';
        return;
    }
    renderQuestion();
    renderNav();
})();
