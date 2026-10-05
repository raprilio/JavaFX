<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/admin_auth.php';

$pageTitle = 'Exams';
$layout = 'admin';
$activeMenu = 'exams';
require dirname(__DIR__) . '/includes/header.php';
?>
<?php if (!exam_type_enabled('pretest') || !exam_type_enabled('test')): ?>
    <div class="alert alert-warning soft-alert d-flex align-items-center gap-2 flex-wrap">
        <i class="bi bi-toggle-off fs-5"></i>
        <span class="flex-fill">Modul <strong><?= e(implode(' & ', array_map(fn ($t) => $t === 'test' ? 'Test' : 'Pre-Test', array_diff(['pretest', 'test'], enabled_exam_types())))) ?></strong> sedang nonaktif — ujian jenis ini tidak terlihat oleh peserta walaupun diaktifkan.</span>
        <a href="<?= e(url('admin/settings.php')) ?>" class="btn btn-sm btn-light">Pengaturan</a>
    </div>
<?php endif; ?>
<div class="card-x">
    <div class="card-x-header filter-bar">
        <div class="input-icon flex-fill" style="max-width:320px"><i class="bi bi-search"></i><input class="form-control" id="fQ" placeholder="Cari judul ujian..."></div>
        <select class="form-select w-auto" id="fType"><option value="">Semua jenis</option><option value="pretest">Pre-Test</option><option value="test">Test</option></select>
        <select class="form-select w-auto" id="fStatus"><option value="">Semua status</option><option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option></select>
        <a href="<?= e(url('admin/exam-edit.php')) ?>" class="btn btn-primary ms-auto"><i class="bi bi-plus-lg me-1"></i>Buat Ujian</a>
    </div>
    <div class="table-responsive">
        <table class="table table-x table-stack">
            <thead><tr><th>Ujian</th><th>Jenis</th><th>Aktif</th><th class="text-end">Soal</th><th class="text-end">Durasi</th><th>Jadwal</th><th class="text-end">Submission</th><th>Hasil ke peserta</th><th class="text-end">Aksi</th></tr></thead>
            <tbody id="examBody"><tr><td colspan="9" class="text-center py-5"><div class="spinner-border spinner-border-sm"></div></td></tr></tbody>
        </table>
    </div>
</div>
<script>window.MODULES = <?= js_json(['pretest' => exam_type_enabled('pretest'), 'test' => exam_type_enabled('test')]) ?>;</script>
<?php
$extraScripts = ['js/admin-exams.js'];
require dirname(__DIR__) . '/includes/footer.php';
