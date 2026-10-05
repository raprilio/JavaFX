<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/admin_auth.php';

$pageTitle = 'Question Bank';
$layout = 'admin';
$activeMenu = 'questions';
require dirname(__DIR__) . '/includes/header.php';
?>
<div class="row g-3">
    <div class="col-xl-9">
        <div class="card-x">
            <div class="card-x-header filter-bar">
                <div class="input-icon flex-fill" style="max-width:280px"><i class="bi bi-search"></i><input class="form-control" id="fQ" placeholder="Cari pertanyaan..."></div>
                <select class="form-select w-auto" id="fCat"><option value="">Semua kategori</option></select>
                <select class="form-select w-auto" id="fType">
                    <option value="">Semua tipe</option>
                    <?php foreach (QUESTION_TYPES as $t): ?><option value="<?= $t ?>"><?= e(question_type_label($t)) ?></option><?php endforeach; ?>
                </select>
                <select class="form-select w-auto" id="fDiff"><option value="">Semua level</option><option value="easy">Mudah</option><option value="medium">Sedang</option><option value="hard">Sulit</option></select>
                <button class="btn btn-primary ms-auto" id="btnNew"><i class="bi bi-plus-lg me-1"></i>Soal Baru</button>
            </div>
            <div class="table-responsive">
                <table class="table table-x">
                    <thead><tr><th style="width:50%">Pertanyaan</th><th>Tipe</th><th>Kategori</th><th>Level</th><th class="text-end">Point</th><th class="text-end">Aksi</th></tr></thead>
                    <tbody id="qBody"></tbody>
                </table>
            </div>
            <div class="d-flex align-items-center p-3 border-top"><small class="text-muted" id="qInfo"></small><div class="ms-auto" id="qPager"></div></div>
        </div>
    </div>
    <div class="col-xl-3">
        <div class="card-x">
            <div class="card-x-header"><h3>Kategori</h3><button class="btn btn-soft btn-sm ms-auto" id="btnNewCat"><i class="bi bi-plus-lg"></i></button></div>
            <div class="card-x-body p-0"><ul class="list-group list-group-flush" id="catList"></ul></div>
        </div>
    </div>
</div>

<!-- Modal soal -->
<div class="modal fade" id="qModal" tabindex="-1">
    <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <form class="modal-content" id="qForm">
            <div class="modal-header"><h5 class="modal-title" id="qModalTitle">Soal Baru</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body">
                <input type="hidden" name="id">
                <div class="alert alert-warning soft-alert small" id="usedNote" style="display:none"><i class="bi bi-lock me-1"></i>Soal ini sudah dipakai dalam hasil ujian. Tipe, point, jumlah opsi, dan kunci jawaban <strong>dikunci</strong> agar hasil tetap konsisten. Anda masih dapat memperbaiki teks.</div>
                <div class="row g-3">
                    <div class="col-md-4"><label class="form-label">Tipe soal</label>
                        <select class="form-select" name="question_type" id="qType">
                            <?php foreach (QUESTION_TYPES as $t): ?><option value="<?= $t ?>"><?= e(question_type_label($t)) ?></option><?php endforeach; ?>
                        </select></div>
                    <div class="col-md-4"><label class="form-label">Kategori</label><select class="form-select" name="category_id" id="qCat"><option value="">— Tanpa kategori —</option></select></div>
                    <div class="col-6 col-md-2"><label class="form-label">Level</label><select class="form-select" name="difficulty"><option value="easy">Mudah</option><option value="medium" selected>Sedang</option><option value="hard">Sulit</option></select></div>
                    <div class="col-6 col-md-2"><label class="form-label">Point</label><input type="number" step="0.25" min="0.25" class="form-control" name="points" value="1"></div>
                    <div class="col-12"><label class="form-label">Pertanyaan *</label><textarea class="form-control" name="question" rows="4" required></textarea></div>
                    <div class="col-12">
                        <label class="form-label">Gambar (opsional)</label>
                        <div class="d-flex gap-3 align-items-center">
                            <input type="file" class="form-control" name="image" accept="image/png,image/jpeg,image/webp,image/gif">
                            <div id="imgPreview" class="d-none text-nowrap"><img src="" alt="" style="height:48px;border-radius:8px"> <label class="small ms-1"><input type="checkbox" name="remove_image" value="1"> Hapus</label></div>
                        </div>
                    </div>
                    <div class="col-12" id="optWrap">
                        <label class="form-label d-flex align-items-center"><span id="optLabel">Pilihan jawaban</span>
                            <button type="button" class="btn btn-soft btn-sm ms-auto" id="btnAddOpt"><i class="bi bi-plus-lg"></i> Tambah</button></label>
                        <div id="optList"></div>
                        <div class="form-text" id="optHelp"></div>
                    </div>
                    <div class="col-12"><label class="form-label">Pembahasan / Explanation</label><textarea class="form-control" name="explanation" rows="3"></textarea></div>
                </div>
            </div>
            <div class="modal-footer"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Batal</button><button class="btn btn-primary px-4">Simpan Soal</button></div>
        </form>
    </div>
</div>

<!-- Modal kategori -->
<div class="modal fade" id="catModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <form class="modal-content" id="catForm">
            <div class="modal-header"><h5 class="modal-title">Kategori</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body">
                <input type="hidden" name="id">
                <div class="mb-3"><label class="form-label">Nama *</label><input class="form-control" name="name" required maxlength="100"></div>
                <div><label class="form-label">Deskripsi</label><input class="form-control" name="description" maxlength="255"></div>
            </div>
            <div class="modal-footer"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Batal</button><button class="btn btn-primary">Simpan</button></div>
        </form>
    </div>
</div>
<?php
$extraScripts = ['js/admin-questions.js'];
require dirname(__DIR__) . '/includes/footer.php';
