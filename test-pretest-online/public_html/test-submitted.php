<?php
/**
 * Halaman konfirmasi setelah submit Test.
 * Sengaja TIDAK mengambil kolom score/benar/salah dari database.
 */
declare(strict_types=1);
require_once __DIR__ . '/includes/auth.php';

$me = current_user();
$row = q_row(
    'SELECT a.id, a.status, a.submitted_at, e.id AS exam_id, e.title, e.type, e.show_result
       FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
      WHERE a.id = ? AND a.user_id = ?',
    [get_int('attempt'), $me['id']]
);
if (!$row) {
    flash('warning', 'Data ujian tidak ditemukan.');
    redirect('dashboard.php');
}
if ($row['status'] === 'in_progress') {
    redirect('exam.php?id=' . (int) $row['exam_id']);
}
if (exam_user_can_view_score($row)) {
    redirect('pretest-result.php?attempt=' . (int) $row['id']);
}

$isTest = $row['type'] === 'test';
$pageTitle = $isTest ? 'Test Berhasil Dikirim' : 'Jawaban Terkirim';
$activeMenu = 'history';
require __DIR__ . '/includes/header.php';
?>
<div class="result-shell fade-in">
    <div class="card-x result-card">
        <div class="success-icon"><i class="bi bi-check2"></i></div>
        <h1 class="h3 fw-800 mb-2"><?= $isTest ? 'TEST BERHASIL DIKIRIM' : 'JAWABAN BERHASIL DIKIRIM' ?></h1>
        <p class="fw-semibold mb-1"><?= e($row['title']) ?></p>
        <p class="text-muted mb-4">Terima kasih. Jawaban Anda telah berhasil disimpan.<br><?= $isTest ? 'Test Anda telah selesai. ' : '' ?>Hasil <?= $isTest ? 'test' : 'ujian' ?> akan diproses oleh administrator.</p>
        <?php if ($row['status'] === 'auto_submitted'): ?>
            <div class="alert alert-warning soft-alert small"><i class="bi bi-stopwatch me-1"></i>Waktu habis — jawaban dikirim otomatis oleh sistem.</div>
        <?php endif; ?>
        <div class="small text-muted mb-4"><i class="bi bi-clock me-1"></i>Dikirim: <?= e(fmt_date($row['submitted_at'])) ?></div>
        <a href="<?= e(url('dashboard.php')) ?>" class="btn btn-primary btn-lg px-5"><i class="bi bi-house me-1"></i>Kembali ke Dashboard</a>
    </div>
</div>
<?php require __DIR__ . '/includes/footer.php'; ?>
