/* Admin — Pengaturan */
(function () {
    'use strict';
    const form = document.getElementById('settingsForm');
    const input = document.getElementById('logoInput');
    const drop = document.getElementById('logoDrop');
    const preview = document.getElementById('logoPreview');

    /** Validasi + pratinjau gambar; drag & drop ke area label. */
    function imagePicker(dropEl, inputEl, maxMb, label, onPreview) {
        const take = (file) => {
            if (!file) return;
            if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { App.toast(`Format ${label} harus PNG, JPG, atau WEBP.`, 'error'); inputEl.value = ''; return; }
            if (file.size > maxMb * 1024 * 1024) { App.toast(`Ukuran ${label} maksimal ${maxMb} MB.`, 'error'); inputEl.value = ''; return; }
            onPreview(URL.createObjectURL(file));
        };
        inputEl.addEventListener('change', () => take(inputEl.files[0]));
        ['dragenter', 'dragover'].forEach((ev) => dropEl.addEventListener(ev, (e) => { e.preventDefault(); dropEl.classList.add('drag'); }));
        ['dragleave', 'drop'].forEach((ev) => dropEl.addEventListener(ev, (e) => { e.preventDefault(); dropEl.classList.remove('drag'); }));
        dropEl.addEventListener('drop', (e) => {
            if (!e.dataTransfer.files.length) return;
            const dt = new DataTransfer();
            dt.items.add(e.dataTransfer.files[0]);
            inputEl.files = dt.files;
            take(inputEl.files[0]);
        });
    }
    const previewDark = document.getElementById('logoPreviewDark');
    imagePicker(drop, input, 2, 'logo', (src) => { preview.src = src; previewDark.src = src; });
    document.getElementById('swPlate').addEventListener('change', (e) => {
        [preview, previewDark].forEach((img) => img.classList.toggle('logo-plate', e.target.checked));
    });

    const wallInput = document.getElementById('wallInput');
    const wallPreview = document.getElementById('wallPreview');
    const wallDrop = document.getElementById('wallDrop');
    imagePicker(wallDrop, wallInput, 4, 'wallpaper', (src) => { wallPreview.src = src; wallPreview.classList.remove('d-none'); });
    const ov = document.getElementById('ovRange');
    ov.addEventListener('input', () => {
        document.getElementById('ovVal').textContent = ov.value + '%';
        wallDrop.style.setProperty('--o', ov.value / 100);
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
        ['pretest_enabled', 'test_enabled', 'anti_cheat', 'certificate_enabled', 'logo_plate', 'wallpaper_sidebar'].forEach((k) => fd.set(k, form.elements[k].checked ? 1 : 0));
        if (!input.files.length) fd.delete('logo');
        if (!wallInput.files.length) fd.delete('wallpaper');
        const btn = form.querySelector('button.btn-primary');
        btn.disabled = true;
        try {
            const r = await App.api('api/admin/settings.php', { method: 'POST', data: fd });
            App.toast(r.message);
            setTimeout(() => location.reload(), 700);
        } catch (err) { App.toast(err.message, 'error', 5000); btn.disabled = false; }
    });

    document.getElementById('btnRemoveWall')?.addEventListener('click', async () => {
        if (!await App.confirm({ title: 'Hapus wallpaper?', message: 'Panel kiri login kembali memakai latar bawaan.', variant: 'danger', okText: 'Hapus' })) return;
        try { const r = await App.api('api/admin/settings.php', { method: 'POST', data: { action: 'remove_wallpaper' } }); App.toast(r.message); setTimeout(() => location.reload(), 600); }
        catch (err) { App.toast(err.message, 'error'); }
    });

    document.getElementById('btnRemoveLogo')?.addEventListener('click', async () => {
        if (!await App.confirm({ title: 'Hapus logo?', message: 'Aplikasi akan kembali memakai logo default.', variant: 'danger', okText: 'Hapus' })) return;
        try { const r = await App.api('api/admin/settings.php', { method: 'POST', data: { action: 'remove_logo' } }); App.toast(r.message); setTimeout(() => location.reload(), 600); }
        catch (err) { App.toast(err.message, 'error'); }
    });
})();
