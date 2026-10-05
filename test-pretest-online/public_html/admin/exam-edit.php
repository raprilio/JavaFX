<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/admin_auth.php';

$id = get_int('id');
$exam = $id ? q_row('SELECT * FROM exams WHERE id = ?', [$id]) : null;
if ($id && !$exam) {
    flash('warning', 'Ujian tidak ditemukan.');
    redirect('admin/exams.php');
}
$x = $exam ?? [
    'title' => '', 'description' => '', 'instructions' => '', 'type' => 'pretest', 'duration' => 60,
    'passing_grade' => 70, 'show_result' => 1, 'show_correct_answer' => 0, 'random_question' => 0,
    'random_answer' => 0, 'question_count' => 0, 'max_attempts' => 1, 'start_date' => null, 'end_date' => null, 'status' => 'draft',
];
$categories = q_all('SELECT id, name FROM categories ORDER BY name');
$users = q_all("SELECT id, name, username, department FROM users WHERE role = 'user' ORDER BY name");
$depts = departments();
$hasAttempts = $id ? (int) q_val('SELECT COUNT(*) FROM exam_attempts WHERE exam_id = ?', [$id]) : 0;

$pageTitle = $exam ? 'Edit Ujian' : 'Buat Ujian';
$layout = 'admin';
$activeMenu = 'exams';
require dirname(__DIR__) . '/includes/header.php';
$chk = fn ($v) => (int) $v === 1 ? 'checked' : '';
?>
<div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
    <a href="<?= e(url('admin/exams.php')) ?>" class="btn btn-light btn-sm"><i class="bi bi-arrow-left"></i> Daftar Ujian</a>
    <?php if ($exam): ?>
        <h2 class="h5 fw-bold mb-0 ms-2"><?= e($exam['title']) ?></h2>
        <span class="badge-type <?= $exam['type'] === 'test' ? 'badge-test' : 'badge-pretest' ?>"><?= e(type_label($exam['type'])) ?></span>
        <a href="<?= e(url('admin/results.php?exam_id=' . $id)) ?>" class="btn btn-soft btn-sm ms-auto"><i class="bi bi-clipboard2-data"></i> Lihat Hasil (<?= $hasAttempts ?>)</a>
    <?php endif; ?>
</div>

<ul class="nav nav-pills mb-3 gap-1" role="tablist">
    <li class="nav-item"><button class="nav-link active" data-bs-toggle="pill" data-bs-target="#tabSettings" type="button"><i class="bi bi-sliders me-1"></i>Pengaturan</button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#tabQuestions" type="button" <?= $exam ? '' : 'disabled' ?>><i class="bi bi-list-check me-1"></i>Soal <span class="badge bg-light text-dark" id="poolBadge">0</span></button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#tabAssign" type="button" <?= $exam ? '' : 'disabled' ?>><i class="bi bi-person-check me-1"></i>Peserta</button></li>
</ul>

<div class="tab-content">
    <!-- ================= Pengaturan ================= -->
    <div class="tab-pane fade show active" id="tabSettings">
        <form id="settingsForm" class="row g-3">
            <input type="hidden" name="id" value="<?= (int) $id ?>">
            <div class="col-xl-8">
                <div class="card-x h-100"><div class="card-x-body">
                    <div class="mb-3"><label class="form-label">Judul Ujian *</label><input class="form-control" name="title" value="<?= e($x['title']) ?>" required maxlength="200"></div>
                    <div class="mb-3"><label class="form-label">Deskripsi</label><textarea class="form-control" name="description" rows="2"><?= e($x['description']) ?></textarea></div>
                    <div class="mb-3"><label class="form-label">Instruksi untuk peserta</label><textarea class="form-control" name="instructions" rows="6" placeholder="Kosongkan untuk memakai instruksi default."><?= e($x['instructions']) ?></textarea></div>
                    <div class="row g-3">
                        <div class="col-md-6"><label class="form-label">Mulai</label><input type="datetime-local" class="form-control" name="start_date" value="<?= e(to_datetime_local($x['start_date'])) ?>"></div>
                        <div class="col-md-6"><label class="form-label">Selesai</label><input type="datetime-local" class="form-control" name="end_date" value="<?= e(to_datetime_local($x['end_date'])) ?>"></div>
                    </div>
                </div></div>
            </div>
            <div class="col-xl-4">
                <div class="card-x mb-3"><div class="card-x-body">
                    <label class="form-label">Jenis Ujian</label>
                    <div class="row g-2 mb-3">
                        <div class="col-6"><input type="radio" class="btn-check" name="type" id="tPre" value="pretest" <?= $x['type'] === 'pretest' ? 'checked' : '' ?>><label class="btn btn-outline-primary w-100" for="tPre"><i class="bi bi-lightbulb"></i> Pre-Test</label></div>
                        <div class="col-6"><input type="radio" class="btn-check" name="type" id="tTest" value="test" <?= $x['type'] === 'test' ? 'checked' : '' ?>><label class="btn btn-outline-dark w-100" for="tTest"><i class="bi bi-patch-check"></i> Test</label></div>
                    </div>
                    <div class="alert alert-dark soft-alert small py-2" id="testNote" style="display:none"><i class="bi bi-shield-lock me-1"></i><strong>Test resmi:</strong> score tetap dihitung & disimpan, tetapi tidak pernah ditampilkan ke peserta (ditegakkan di server).</div>
                    <div class="row g-2 mb-3">
                        <div class="col-6"><label class="form-label">Durasi (menit)</label><input type="number" min="1" max="1440" class="form-control" name="duration" value="<?= (int) $x['duration'] ?>"></div>
                        <div class="col-6"><label class="form-label">Passing grade</label><input type="number" min="0" max="100" step="0.5" class="form-control" name="passing_grade" value="<?= e((string) (float) $x['passing_grade']) ?>"></div>
                        <div class="col-6"><label class="form-label">Jumlah soal</label><input type="number" min="0" class="form-control" name="question_count" value="<?= (int) $x['question_count'] ?>"><div class="form-text">0 = semua soal pool</div></div>
                        <div class="col-6"><label class="form-label">Maks. percobaan</label><input type="number" min="1" max="100" class="form-control" name="max_attempts" value="<?= (int) $x['max_attempts'] ?>"></div>
                    </div>
                    <div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" name="show_result" value="1" id="swResult" <?= $chk($x['show_result']) ?>><label class="form-check-label" for="swResult">Tampilkan score ke peserta</label></div>
                    <div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" name="show_correct_answer" value="1" id="swReview" <?= $chk($x['show_correct_answer']) ?>><label class="form-check-label" for="swReview">Aktifkan pembahasan</label></div>
                    <div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" name="random_question" value="1" id="swRq" <?= $chk($x['random_question']) ?>><label class="form-check-label" for="swRq">Random Question</label></div>
                    <div class="form-check form-switch mb-3"><input class="form-check-input" type="checkbox" name="random_answer" value="1" id="swRa" <?= $chk($x['random_answer']) ?>><label class="form-check-label" for="swRa">Random Answer</label></div>
                    <label class="form-label">Status</label>
                    <select class="form-select" name="status">
                        <?php foreach (['draft' => 'Draft', 'published' => 'Published', 'closed' => 'Closed'] as $k => $v): ?>
                            <option value="<?= $k ?>" <?= $x['status'] === $k ? 'selected' : '' ?>><?= $v ?></option>
                        <?php endforeach; ?>
                    </select>
                </div></div>
                <button class="btn btn-primary btn-lg w-100"><i class="bi bi-check2-circle me-1"></i>Simpan Pengaturan</button>
                <?php if ($hasAttempts): ?><p class="small text-muted mt-2 mb-0"><i class="bi bi-info-circle"></i> Perubahan tidak memengaruhi attempt yang sudah dimulai (soal & bobot sudah di-snapshot).</p><?php endif; ?>
            </div>
        </form>
    </div>

    <!-- ================= Soal ================= -->
    <div class="tab-pane fade" id="tabQuestions">
        <div class="row g-3">
            <div class="col-xl-7">
                <div class="card-x">
                    <div class="card-x-header filter-bar">
                        <h3 class="me-2">Question Bank</h3>
                        <input class="form-control form-control-sm flex-fill" style="max-width:220px" id="pQ" placeholder="Cari soal...">
                        <select class="form-select form-select-sm w-auto" id="pCat"><option value="">Semua kategori</option><?php foreach ($categories as $c): ?><option value="<?= (int) $c['id'] ?>"><?= e($c['name']) ?></option><?php endforeach; ?></select>
                        <select class="form-select form-select-sm w-auto" id="pType"><option value="">Semua tipe</option><?php foreach (QUESTION_TYPES as $t): ?><option value="<?= $t ?>"><?= e(question_type_label($t)) ?></option><?php endforeach; ?></select>
                        <button class="btn btn-soft btn-sm" id="btnAddAll" type="button"><i class="bi bi-plus-square"></i> Tambah semua</button>
                    </div>
                    <div class="card-x-body"><div class="pool-list" id="bankList"></div></div>
                </div>
            </div>
            <div class="col-xl-5">
                <div class="card-x" style="position:sticky;top:90px">
                    <div class="card-x-header">
                        <h3>Soal Ujian</h3><span class="badge badge-soft bs-blue" id="selCount">0</span>
                        <button class="btn btn-light btn-sm ms-auto" id="btnClear" type="button">Kosongkan</button>
                    </div>
                    <div class="card-x-body">
                        <p class="small text-muted" id="drawInfo"></p>
                        <div class="pool-list" id="selList" style="max-height:380px"></div>
                        <button class="btn btn-primary w-100 mt-3" id="btnSavePool" type="button"><i class="bi bi-check2-circle me-1"></i>Simpan Daftar Soal</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- ================= Peserta ================= -->
    <div class="tab-pane fade" id="tabAssign">
        <div class="alert alert-info soft-alert small"><i class="bi bi-info-circle me-1"></i>Jika tidak ada department maupun user yang dipilih, ujian <strong>terbuka untuk semua peserta</strong>.</div>
        <div class="row g-3">
            <div class="col-lg-4">
                <div class="card-x h-100">
                    <div class="card-x-header"><h3>Department</h3></div>
                    <div class="card-x-body">
                        <?php if (!$depts): ?><p class="text-muted small">Belum ada department pada data user.</p><?php endif; ?>
                        <?php foreach ($depts as $d): ?>
                            <div class="form-check mb-2"><input class="form-check-input dept-chk" type="checkbox" value="<?= e($d) ?>" id="d_<?= md5($d) ?>"><label class="form-check-label" for="d_<?= md5($d) ?>"><?= e($d) ?></label></div>
                        <?php endforeach; ?>
                    </div>
                </div>
            </div>
            <div class="col-lg-8">
                <div class="card-x h-100">
                    <div class="card-x-header"><h3>User Tertentu</h3><input class="form-control form-control-sm ms-auto" style="max-width:240px" id="uQ" placeholder="Cari user..."></div>
                    <div class="card-x-body">
                        <div class="pool-list" id="userList">
                            <?php foreach ($users as $u): ?>
                                <label data-search="<?= e(mb_strtolower($u['name'] . ' ' . $u['username'] . ' ' . $u['department'])) ?>">
                                    <input type="checkbox" class="form-check-input user-chk mt-1" value="<?= (int) $u['id'] ?>">
                                    <span><strong><?= e($u['name']) ?></strong> <small class="text-muted">@<?= e($u['username']) ?> · <?= e($u['department'] ?: '—') ?></small></span>
                                </label>
                            <?php endforeach; ?>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <button class="btn btn-primary mt-3 px-4" id="btnSaveAssign" type="button"><i class="bi bi-check2-circle me-1"></i>Simpan Assignment</button>
    </div>
</div>

<script>window.EXAM_ID = <?= (int) $id ?>;</script>
<?php
$extraScripts = ['js/admin-exam-edit.js'];
require dirname(__DIR__) . '/includes/footer.php';
