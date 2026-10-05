<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/auth.php';

if (is_admin()) {
    flash('info', 'Administrator tidak mengerjakan ujian. Gunakan akun peserta untuk mencoba.');
    redirect('admin/exams.php');
}

$me = current_user();
$examId = get_int('id');
$exam = $examId ? q_row('SELECT * FROM exams WHERE id = ?', [$examId]) : null;
if (!$exam || ($exam['status'] !== 'published' && $exam['status'] !== 'closed') || !user_is_assigned($me, $examId)) {
    flash('warning', 'Ujian tidak ditemukan atau tidak tersedia untuk Anda.');
    redirect('dashboard.php');
}

finalize_expired_attempts((int) $me['id']);

// ---- Mulai ujian (POST) ----------------------------------------------
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    verify_csrf();
    try {
        start_attempt($me, $examId);
    } catch (RuntimeException $e) {
        flash('warning', $e->getMessage());
    }
    redirect('exam.php?id=' . $examId);
}

$attempt = q_row(
    "SELECT * FROM exam_attempts WHERE user_id = ? AND exam_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1",
    [$me['id'], $examId]
);

// Attempt aktif tetapi waktu habis -> finalisasi sekarang (server-side)
if ($attempt && attempt_is_expired($attempt)) {
    finalize_attempt((int) $attempt['id'], 'auto_submitted');
    flash('info', 'Waktu ujian telah habis. Jawaban Anda dikirim otomatis.');
    redirect(attempt_result_url($attempt, $exam));
}

/* ====================================================================
 *  MODE 1: Instruksi (belum ada attempt aktif)
 * ==================================================================== */
if (!$attempt) {
    $list = array_values(array_filter(user_exam_list($me), fn ($x) => (int) $x['id'] === $examId));
    $info = $list[0] ?? null;
    $pageTitle = $exam['title'];
    $activeMenu = 'dashboard';
    require __DIR__ . '/includes/header.php';
    ?>
    <div class="row justify-content-center">
        <div class="col-lg-9 col-xl-8">
            <a href="<?= e(url('dashboard.php')) ?>" class="small fw-semibold d-inline-block mb-3"><i class="bi bi-arrow-left"></i> Kembali ke Dashboard</a>
            <div class="card-x fade-in">
                <div class="card-x-body p-4 p-md-5">
                    <span class="badge-type <?= $exam['type'] === 'test' ? 'badge-test' : 'badge-pretest' ?>"><?= e(type_label($exam['type'])) ?></span>
                    <h1 class="h3 fw-800 mt-3 mb-2"><?= e($exam['title']) ?></h1>
                    <p class="text-muted"><?= nl2br_e($exam['description']) ?></p>

                    <div class="row g-3 my-3">
                        <div class="col-6 col-md-3"><div class="summary-tile text-center py-3"><div class="label">Soal</div><div class="value" style="font-size:1.35rem"><?= (int) ($info['questions_total'] ?? 0) ?></div></div></div>
                        <div class="col-6 col-md-3"><div class="summary-tile text-center py-3"><div class="label">Durasi</div><div class="value" style="font-size:1.35rem"><?= (int) $exam['duration'] ?>'</div></div></div>
                        <div class="col-6 col-md-3"><div class="summary-tile text-center py-3"><div class="label">Percobaan</div><div class="value" style="font-size:1.35rem"><?= (int) ($info['attempts_done'] ?? 0) ?>/<?= (int) $exam['max_attempts'] ?></div></div></div>
                        <div class="col-6 col-md-3"><div class="summary-tile text-center py-3"><div class="label">Hasil</div><div class="value" style="font-size:1rem;padding-top:.45rem"><?= exam_user_can_view_score($exam) ? 'Langsung tampil' : 'Diproses admin' ?></div></div></div>
                    </div>

                    <h2 class="h6 fw-bold mt-4">Instruksi</h2>
                    <div class="instruction-box mb-4"><?= $exam['instructions'] ? e($exam['instructions']) : "Bacalah setiap soal dengan teliti.\nJawaban tersimpan otomatis setiap kali Anda memilih atau mengetik jawaban.\nTimer berjalan di server — menutup browser tidak menghentikan waktu.\nJika waktu habis, jawaban akan dikirim otomatis." ?></div>

                    <ul class="list-unstyled small text-muted mb-4">
                        <li class="mb-2"><i class="bi bi-cloud-check text-success me-2"></i>Jawaban disimpan otomatis ke server (auto-save).</li>
                        <li class="mb-2"><i class="bi bi-stopwatch text-primary me-2"></i>Waktu dihitung sejak tombol <strong>Mulai</strong> ditekan dan diverifikasi oleh server.</li>
                        <li class="mb-2"><i class="bi bi-lock text-warning me-2"></i>Setelah dikirim, jawaban tidak dapat diubah.</li>
                        <?php if ($exam['type'] === 'test'): ?>
                            <li><i class="bi bi-shield-check text-secondary me-2"></i>Ini adalah <strong>Test resmi</strong>. Hasil akan diproses oleh administrator dan tidak ditampilkan setelah submit.</li>
                        <?php endif; ?>
                    </ul>

                    <?php if ($info && $info['can_start']): ?>
                        <form method="post" data-confirm="Timer akan mulai berjalan setelah Anda menekan Mulai. Lanjutkan?">
                            <?= csrf_field() ?>
                            <button class="btn btn-primary btn-lg px-5"><i class="bi bi-play-fill me-1"></i>Mulai <?= e(type_label($exam['type'])) ?></button>
                        </form>
                    <?php else: ?>
                        <div class="alert alert-secondary soft-alert mb-0">
                            <?php if ($info && $info['attempts_done'] >= (int) $exam['max_attempts']): ?>
                                <?= $exam['type'] === 'test' ? 'Anda telah menyelesaikan test ini. Hasil sedang diproses oleh administrator.' : 'Batas percobaan untuk pre-test ini sudah habis.' ?>
                            <?php elseif ($info && $info['not_started']): ?>
                                Ujian dibuka pada <?= e(fmt_date($exam['start_date'])) ?>.
                            <?php else: ?>
                                Ujian sedang tidak tersedia.
                            <?php endif; ?>
                        </div>
                    <?php endif; ?>
                </div>
            </div>
        </div>
    </div>
    <?php
    require __DIR__ . '/includes/footer.php';
    exit;
}

/* ====================================================================
 *  MODE 2: Mengerjakan ujian
 * ==================================================================== */
$questions = attempt_questions_for_user((int) $attempt['id']);
$boot = [
    'attemptId' => (int) $attempt['id'],
    'examType'  => $exam['type'],
    'remaining' => attempt_remaining_seconds($attempt),
    'questions' => $questions,
];

$pageTitle = $exam['title'];
$layout = 'exam';
require __DIR__ . '/includes/header.php';
?>
<div class="exam-topbar">
    <div class="container-xl d-flex align-items-center gap-3">
        <img src="<?= e(url('assets/images/logo.svg')) ?>" width="30" height="30" alt="" class="d-none d-sm-block">
        <div class="min-w-0">
            <div class="title text-truncate"><?= e($exam['title']) ?></div>
            <small style="color:#9fb0d6"><?= e(type_label($exam['type'])) ?> · <?= e($me['name']) ?></small>
        </div>
        <div class="ms-auto timer" id="timer" title="Sisa waktu"><i class="bi bi-stopwatch"></i><span>--:--</span></div>
    </div>
</div>
<div class="exam-progress"><div id="progressBar" style="width:0"></div></div>

<div class="container-xl py-4">
    <div class="row g-4">
        <div class="col-lg-8">
            <div class="card-x question-card" id="questionCard">
                <div class="text-center text-muted py-5"><div class="spinner-border"></div></div>
            </div>
            <div class="d-flex align-items-center gap-2 mt-3 flex-wrap">
                <button class="btn btn-light" id="btnPrev"><i class="bi bi-chevron-left"></i> Sebelumnya</button>
                <button class="btn btn-light" id="btnFlag"><i class="bi bi-flag"></i> <span>Tandai</span></button>
                <span class="save-status ms-auto me-2" id="saveStatus"></span>
                <button class="btn btn-primary" id="btnNext">Berikutnya <i class="bi bi-chevron-right"></i></button>
            </div>
        </div>
        <div class="col-lg-4">
            <div class="card-x" style="position:sticky;top:90px">
                <div class="card-x-header">
                    <h3>Navigasi Soal</h3>
                    <span class="ms-auto small text-muted"><strong id="answeredCount">0</strong>/<?= count($questions) ?> terjawab</span>
                </div>
                <div class="card-x-body">
                    <div class="q-nav" id="qNav"></div>
                    <div class="d-flex flex-wrap gap-3 small text-muted mt-3">
                        <span><span class="legend-dot" style="background:var(--green-soft);border-color:#9fdcc1"></span>Terjawab</span>
                        <span><span class="legend-dot" style="box-shadow:inset 0 -3px 0 var(--amber)"></span>Ditandai</span>
                        <span><span class="legend-dot" style="background:var(--blue);border-color:var(--blue)"></span>Aktif</span>
                    </div>
                    <hr>
                    <button class="btn btn-gold w-100 btn-lg" id="btnSubmit"><i class="bi bi-send me-1"></i>Submit <?= $exam['type'] === 'test' ? 'Test' : 'Pre-Test' ?></button>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Konfirmasi submit -->
<div class="modal fade" id="submitModal" tabindex="-1" data-bs-backdrop="static">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-body text-center p-4">
                <div class="stat-icon ic-gold mx-auto mb-3" style="width:64px;height:64px;border-radius:18px;display:grid;place-items:center;font-size:1.7rem"><i class="bi bi-send-check"></i></div>
                <h5 class="fw-bold">Apakah Anda yakin ingin mengirim jawaban?</h5>
                <p class="text-muted mb-2">Setelah dikirim, jawaban tidak dapat diubah.</p>
                <p class="small mb-0" id="submitUnanswered"></p>
            </div>
            <div class="modal-footer justify-content-center border-0 pt-0 pb-4">
                <button type="button" class="btn btn-light px-4" data-bs-dismiss="modal">Kembali</button>
                <button type="button" class="btn btn-primary px-4" id="btnConfirmSubmit">Submit <?= $exam['type'] === 'test' ? 'Test' : 'Pre-Test' ?></button>
            </div>
        </div>
    </div>
</div>

<script>window.EXAM_BOOT = <?= js_json($boot) ?>;</script>
<?php
$extraScripts = ['js/exam.js'];
require __DIR__ . '/includes/footer.php';
