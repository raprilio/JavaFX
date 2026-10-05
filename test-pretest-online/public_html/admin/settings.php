<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/admin_auth.php';

$s = settings_all();
$pageTitle = 'Pengaturan';
$layout = 'admin';
$activeMenu = 'settings';
require dirname(__DIR__) . '/includes/header.php';
$chk = fn (string $k) => $s[$k] === '1' ? 'checked' : '';
?>
<form id="settingsForm" enctype="multipart/form-data" autocomplete="off">
<div class="row g-3">
    <div class="col-xl-8">
        <!-- Modul -->
        <div class="card-x mb-3">
            <div class="card-x-header"><h2><i class="bi bi-toggles me-1"></i>Aktivasi Modul Ujian</h2><span class="small text-muted ms-auto">Hanya administrator yang dapat mengubah</span></div>
            <div class="card-x-body">
                <div class="row g-3">
                    <?php foreach (['pretest' => ['Pre-Test', 'bi-lightbulb', 'Score langsung tampil ke peserta'], 'test' => ['Test', 'bi-patch-check', 'Ujian resmi — score hanya untuk admin']] as $t => [$label, $icon, $desc]): ?>
                        <div class="col-md-6">
                            <label class="module-switch w-100 <?= $s[$t . '_enabled'] === '1' ? 'on' : '' ?>" style="cursor:pointer">
                                <div class="stat-icon <?= $t === 'test' ? 'ic-gold' : 'ic-blue' ?>" style="width:46px;height:46px;border-radius:14px;display:grid;place-items:center;font-size:1.25rem"><i class="bi <?= $icon ?>"></i></div>
                                <div class="flex-fill min-w-0">
                                    <div class="fw-bold"><?= $label ?></div>
                                    <div class="small text-muted"><?= $desc ?></div>
                                    <div class="state mt-1"><?= $s[$t . '_enabled'] === '1' ? '● AKTIF' : '● NONAKTIF' ?></div>
                                </div>
                                <div class="form-check form-switch m-0"><input class="form-check-input module-chk" type="checkbox" name="<?= $t ?>_enabled" value="1" <?= $chk($t . '_enabled') ?>></div>
                            </label>
                        </div>
                    <?php endforeach; ?>
                </div>
                <p class="small text-muted mt-3 mb-0"><i class="bi bi-info-circle"></i> Modul nonaktif disembunyikan dari peserta dan tidak dapat dimulai (ditolak oleh server). Peserta yang sedang mengerjakan tetap dapat menyelesaikan ujiannya.</p>
            </div>
        </div>

        <!-- Identitas -->
        <div class="card-x mb-3">
            <div class="card-x-header"><h2><i class="bi bi-building me-1"></i>Identitas Aplikasi & Instansi</h2></div>
            <div class="card-x-body">
                <div class="row g-3">
                    <div class="col-md-6"><label class="form-label">Nama aplikasi *</label><input class="form-control" name="app_name" value="<?= e($s['app_name']) ?>" maxlength="60" required></div>
                    <div class="col-md-6"><label class="form-label">Tagline</label><input class="form-control" name="app_tagline" value="<?= e($s['app_tagline']) ?>" maxlength="120"></div>
                    <div class="col-md-6"><label class="form-label">Nama instansi *</label><input class="form-control" name="institution_name" value="<?= e($s['institution_name']) ?>" maxlength="150" required></div>
                    <div class="col-md-6"><label class="form-label">Wilayah</label><input class="form-control" name="institution_region" value="<?= e($s['institution_region']) ?>" maxlength="120" placeholder="contoh: Kota Bandung"></div>
                    <div class="col-12"><label class="form-label">Pesan halaman login</label><textarea class="form-control" name="login_message" rows="2" maxlength="300"><?= e($s['login_message']) ?></textarea></div>
                    <div class="col-12"><label class="form-label">Teks footer</label><input class="form-control" name="footer_text" value="<?= e($s['footer_text']) ?>" maxlength="200" placeholder="Kosongkan untuk memakai nama instansi"></div>
                </div>
            </div>
        </div>

        <!-- Pengumuman -->
        <div class="card-x mb-3">
            <div class="card-x-header"><h2><i class="bi bi-megaphone me-1"></i>Pengumuman Peserta</h2></div>
            <div class="card-x-body">
                <textarea class="form-control" name="announcement" rows="3" maxlength="1000" placeholder="Contoh: Test Kompetensi Pelayanan dilaksanakan Senin, 12 Oktober 2026 pukul 09.00 WIB. Kosongkan untuk menyembunyikan."><?= e($s['announcement']) ?></textarea>
                <div class="form-text">Tampil di bagian atas dashboard seluruh peserta.</div>
            </div>
        </div>

        <!-- Pengawasan & sertifikat -->
        <div class="card-x mb-3">
            <div class="card-x-header"><h2><i class="bi bi-shield-check me-1"></i>Pengawasan & Sertifikat</h2></div>
            <div class="card-x-body">
                <div class="form-check form-switch mb-3">
                    <input class="form-check-input" type="checkbox" name="anti_cheat" value="1" id="swCheat" <?= $chk('anti_cheat') ?>>
                    <label class="form-check-label fw-semibold" for="swCheat">Deteksi pindah tab / aplikasi</label>
                    <div class="small text-muted">Setiap kali peserta meninggalkan halaman ujian, jumlahnya dicatat dan ditampilkan di Test Results.</div>
                </div>
                <div class="form-check form-switch mb-3">
                    <input class="form-check-input" type="checkbox" name="certificate_enabled" value="1" id="swCert" <?= $chk('certificate_enabled') ?>>
                    <label class="form-check-label fw-semibold" for="swCert">Sertifikat Pre-Test</label>
                    <div class="small text-muted">Peserta yang LULUS Pre-Test dapat mencetak sertifikat dengan kode verifikasi. (Test resmi tidak menerbitkan sertifikat otomatis.)</div>
                </div>
                <div class="row g-3">
                    <div class="col-md-6"><label class="form-label">Nama penandatangan</label><input class="form-control" name="certificate_signer_name" value="<?= e($s['certificate_signer_name']) ?>" maxlength="120" placeholder="Nama Kepala Dinas"></div>
                    <div class="col-md-6"><label class="form-label">Jabatan penandatangan</label><input class="form-control" name="certificate_signer_title" value="<?= e($s['certificate_signer_title']) ?>" maxlength="120"></div>
                </div>
            </div>
        </div>
    </div>

    <div class="col-xl-4">
        <div class="card-x mb-3">
            <div class="card-x-header"><h2><i class="bi bi-image me-1"></i>Logo Aplikasi</h2></div>
            <div class="card-x-body">
                <label class="logo-drop d-block" id="logoDrop">
                    <img src="<?= e(app_logo_url()) ?>" alt="Logo" id="logoPreview">
                    <div class="small text-muted mt-3"><i class="bi bi-cloud-arrow-up"></i> Klik atau seret file ke sini</div>
                    <div class="small text-muted">PNG / JPG / WEBP · maks 1 MB · disarankan 512×512 latar transparan</div>
                    <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" class="d-none" id="logoInput">
                </label>
                <?php if ($s['logo'] !== ''): ?>
                    <button type="button" class="btn btn-soft-danger btn-sm w-100 mt-3" id="btnRemoveLogo"><i class="bi bi-trash"></i> Hapus logo (pakai default)</button>
                <?php endif; ?>
                <p class="small text-muted mt-3 mb-0">Logo dipakai di sidebar, halaman login, halaman ujian, favicon, laporan PDF, dan sertifikat.</p>
            </div>
        </div>

        <div class="card-x mb-3">
            <div class="card-x-header"><h2><i class="bi bi-palette me-1"></i>Warna Tema</h2></div>
            <div class="card-x-body">
                <div class="d-flex gap-3 align-items-center mb-3">
                    <input type="color" class="form-control form-control-color" name="primary_color" value="<?= e($s['primary_color']) ?>" id="cPrimary">
                    <div><div class="fw-semibold">Warna utama</div><div class="small text-muted">Tombol, link, highlight</div></div>
                </div>
                <div class="d-flex gap-3 align-items-center mb-3">
                    <input type="color" class="form-control form-control-color" name="accent_color" value="<?= e($s['accent_color']) ?>" id="cAccent">
                    <div><div class="fw-semibold">Warna aksen</div><div class="small text-muted">Badge Test, tombol Submit</div></div>
                </div>
                <div class="d-flex flex-wrap gap-2" id="presets">
                    <?php foreach ([['#2f6bff', '#d4a72c', 'Navy Gold'], ['#0f766e', '#f59e0b', 'Teal'], ['#1d4ed8', '#e11d48', 'Merah Putih'], ['#7c3aed', '#f59e0b', 'Ungu'], ['#15803d', '#ca8a04', 'Hijau']] as [$p, $a, $n]): ?>
                        <button type="button" class="btn btn-light btn-sm" data-p="<?= $p ?>" data-a="<?= $a ?>"><span class="d-inline-block rounded-circle me-1" style="width:10px;height:10px;background:<?= $p ?>"></span><span class="d-inline-block rounded-circle me-1" style="width:10px;height:10px;background:<?= $a ?>"></span><?= $n ?></button>
                    <?php endforeach; ?>
                </div>
            </div>
        </div>

        <div class="d-grid" style="position:sticky;top:90px">
            <button class="btn btn-primary btn-lg"><i class="bi bi-check2-circle me-1"></i>Simpan Pengaturan</button>
        </div>
    </div>
</div>
</form>
<?php
$extraScripts = ['js/admin-settings.js'];
require dirname(__DIR__) . '/includes/footer.php';
