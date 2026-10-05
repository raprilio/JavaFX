<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/auth.php';

$me = current_user();
$data = load_user_attempt(get_int('attempt'), (int) $me['id']);
if (!$data) {
    flash('warning', 'Hasil ujian tidak ditemukan.');
    redirect('dashboard.php');
}
['attempt' => $attempt, 'exam' => $exam] = $data;

if ($attempt['status'] === 'in_progress') {
    redirect('exam.php?id=' . (int) $exam['id']);
}
// Kebijakan backend: Test (atau pre-test dengan show_result=0) tidak boleh melihat score
if (!exam_user_can_view_score($exam)) {
    redirect('test-submitted.php?attempt=' . (int) $attempt['id']);
}

$r = attempt_public_summary($attempt, $exam);
$passed = $r['passed'];
$clr = $passed ? 'var(--green)' : 'var(--red)';

$pageTitle = 'Hasil Pre-Test';
$activeMenu = 'history';
require __DIR__ . '/includes/header.php';
?>
<div class="result-shell fade-in">
    <div class="card-x result-card">
        <div class="small-caps" style="color:var(--blue)">Pre-Test Selesai</div>
        <h1 class="h4 fw-800 mt-2 mb-0"><?= e($exam['title']) ?></h1>

        <div class="score-ring" style="--val: <?= e((string) min(100, max(0, $r['score']))) ?>; --clr: <?= $clr ?>">
            <div class="inner">
                <div class="num" data-count="<?= e((string) $r['score']) ?>" data-dec="1"><?= e(fmt_num($r['score'], 1)) ?></div>
                <div class="of">/ 100</div>
            </div>
        </div>

        <span class="status-banner <?= $passed ? 'bs-green' : 'bs-red' ?>">STATUS: <?= $passed ? 'LULUS' : 'TIDAK LULUS' ?></span>

        <div class="result-stats">
            <div><strong class="text-success"><?= (int) $r['correct'] ?></strong><span>Benar</span></div>
            <div><strong class="text-danger"><?= (int) $r['wrong'] ?></strong><span>Salah</span></div>
            <div><strong class="text-secondary"><?= (int) $r['unanswered'] ?></strong><span>Tidak Dijawab</span></div>
        </div>

        <p class="text-muted mb-1">Passing Grade: <strong><?= e(fmt_num($r['passing_grade'], 1)) ?></strong></p>
        <?php if ($r['pending_review'] > 0): ?>
            <p class="small text-warning mb-0"><i class="bi bi-hourglass-split"></i> <?= (int) $r['pending_review'] ?> jawaban essay menunggu penilaian administrator. Score dapat berubah.</p>
        <?php endif; ?>
        <p class="small text-muted">Dikirim: <?= e(fmt_date($attempt['submitted_at'])) ?></p>

        <div class="d-flex gap-2 justify-content-center flex-wrap mt-4">
            <?php if ($passed && $r['pending_review'] === 0 && setting_on('certificate_enabled')): ?>
                <a href="<?= e(url('user/certificate.php?attempt=' . (int) $attempt['id'])) ?>" class="btn btn-soft px-4"><i class="bi bi-award me-1"></i>Sertifikat</a>
            <?php endif; ?>
            <?php if (exam_user_can_view_review($exam)): ?>
                <a href="<?= e(url('user/review.php?attempt=' . (int) $attempt['id'])) ?>" class="btn btn-gold px-4"><i class="bi bi-book me-1"></i>Lihat Pembahasan</a>
            <?php endif; ?>
            <a href="<?= e(url('dashboard.php')) ?>" class="btn btn-primary px-4"><i class="bi bi-house me-1"></i>Kembali ke Dashboard</a>
        </div>
    </div>
</div>
<?php require __DIR__ . '/includes/footer.php'; ?>
