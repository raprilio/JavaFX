/* Admin — Pengaturan */
(function () {
    'use strict';
    const form = document.getElementById('settingsForm');
    const input = document.getElementById('logoInput');
    const drop = document.getElementById('logoDrop');
    const preview = document.getElementById('logoPreview');

    function previewFile(file) {
        if (!file) return;
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { App.toast('Format logo harus PNG, JPG, atau WEBP.', 'error'); input.value = ''; return; }
        if (file.size > 1024 * 1024) { App.toast('Ukuran logo maksimal 1 MB.', 'error'); input.value = ''; return; }
        preview.src = URL.createObjectURL(file);
    }
    input.addEventListener('change', () => previewFile(input.files[0]));
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e) => {
        if (!e.dataTransfer.files.length) return;
        const dt = new DataTransfer();
        dt.items.add(e.dataTransfer.files[0]);
        input.files = dt.files;
        previewFile(input.files[0]);
    });

    // Live preview warna
    const applyColors = () => {
        const p = form.elements.primary_color.value, a = form.elements.accent_color.value;
        const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16)).join(', ');
        const r = document.documentElement.style;
        r.setProperty('--blue', p); r.setProperty('--bs-primary', p); r.setProperty('--primary-rgb', rgb(p));
        r.setProperty('--gold', a); r.setProperty('--accent-rgb', rgb(a));
    };
    form.elements.primary_color.addEventListener('input', applyColors);
    form.elements.accent_color.addEventListener('input', applyColors);
    document.getElementById('presets').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        form.elements.primary_color.value = b.dataset.p;
        form.elements.accent_color.value = b.dataset.a;
        applyColors();
    });

    document.querySelectorAll('.module-chk').forEach((c) => c.addEventListener('change', () => {
        const box = c.closest('.module-switch');
        box.classList.toggle('on', c.checked);
        box.querySelector('.state').textContent = c.checked ? '● AKTIF' : '● NONAKTIF';
    }));

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        fd.set('action', 'save');
        ['pretest_enabled', 'test_enabled', 'anti_cheat', 'certificate_enabled'].forEach((k) => fd.set(k, form.elements[k].checked ? 1 : 0));
        if (!input.files.length) fd.delete('logo');
        const btn = form.querySelector('button.btn-primary');
        btn.disabled = true;
        try {
            const r = await App.api('api/admin/settings.php', { method: 'POST', data: fd });
            App.toast(r.message);
            setTimeout(() => location.reload(), 700);
        } catch (err) { App.toast(err.message, 'error', 5000); btn.disabled = false; }
    });

    document.getElementById('btnRemoveLogo')?.addEventListener('click', async () => {
        if (!await App.confirm({ title: 'Hapus logo?', message: 'Aplikasi akan kembali memakai logo default.', variant: 'danger', okText: 'Hapus' })) return;
        try { const r = await App.api('api/admin/settings.php', { method: 'POST', data: { action: 'remove_logo' } }); App.toast(r.message); setTimeout(() => location.reload(), 600); }
        catch (err) { App.toast(err.message, 'error'); }
    });
})();
