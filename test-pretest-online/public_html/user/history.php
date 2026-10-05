<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/auth.php';

if (is_admin()) {
    redirect('admin/results.php');
}
$me = current_user();
finalize_expired_attempts((int) $me['id']);
$history = user_history((int) $me['id']);

$pageTitle = 'Riwayat Ujian';
$activeMenu = 'history';
require dirname(__DIR__) . '/includes/header.php';
?>
<div class="d-flex align-items-center mb-3">
    <div>
        <h1 class="h4 fw-800 mb-0">Riwayat Ujian</h1>
        <p class="text-muted mb-0 small">Seluruh ujian yang telah Anda kirim.</p>
    </div>
</div>

<?php if (!$history): ?>
    <div class="card-x"><div class="empty-state"><i class="bi bi-clock-history"></i>Belum ada riwayat ujian.</div></div>
<?php else: ?>
<div class="row g-3">
    <?php foreach ($history as $h): ?>
        <div class="col-md-6 col-xl-4 fade-in">
            <div class="card-x exam-card hover-lift <?= $h['type'] === 'test' ? 'is-test' : '' ?>">
                <div class="d-flex justify-content-between align-items-center">
                    <span class="badge-type <?= $h['type'] === 'test' ? 'badge-test' : 'badge-pretest' ?>"><?= e(type_label($h['type'])) ?></span>
                    <small class="text-muted"><i class="bi bi-clock me-1"></i><?= e(fmt_date($h['submitted_at'])) ?></small>
                </div>
                <h3><?= e($h['title']) ?></h3>
                <?php if ((int) $h['result_visible'] === 1): ?>
                    <div class="d-flex align-items-end gap-3 my-2">
                        <div><div class="small-caps">Score</div><div class="fs-2 fw-800 lh-1"><?= e(fmt_num($h['score'], 1)) ?></div></div>
                        <div class="ms-auto text-end">
                            <div class="small-caps">Status</div>
                            <span class="badge badge-soft <?= (int) $h['passed'] ? 'bs-green' : 'bs-red' ?>"><?= (int) $h['passed'] ? 'Lulus' : 'Tidak Lulus' ?></span>
                        </div>
                    </div>
                    <div class="small text-muted mb-3"><?= (int) $h['correct_answers'] ?> benar · <?= (int) $h['wrong_answers'] ?> salah · <?= (int) $h['unanswered'] ?> tidak dijawab</div>
                    <div class="mt-auto d-flex gap-2">
                        <a href="<?= e(url('pretest-result.php?attempt=' . (int) $h['id'])) ?>" class="btn btn-soft btn-sm flex-fill">Detail Hasil</a>
                        <?php if ((int) $h['review_available'] === 1): ?>
                            <a href="<?= e(url('user/review.php?attempt=' . (int) $h['id'])) ?>" class="btn btn-light btn-sm flex-fill">Pembahasan</a>
                        <?php endif; ?>
                        <?php if ((int) $h['passed'] === 1 && (int) $h['pending_review'] === 0 && setting_on('certificate_enabled')): ?>
                            <a href="<?= e(url('user/certificate.php?attempt=' . (int) $h['id'])) ?>" class="btn btn-light btn-sm" title="Sertifikat"><i class="bi bi-award"></i></a>
                        <?php endif; ?>
                    </div>
                <?php else: ?>
                    <div class="my-2">
                        <div class="small-caps">Status</div>
                        <div class="fw-bold">Selesai</div>
                    </div>
                    <div class="mt-auto">
                        <span class="badge badge-soft bs-gray w-100 py-2"><i class="bi bi-hourglass-split me-1"></i>Hasil: Diproses</span>
                    </div>
                <?php endif; ?>
            </div>
        </div>
    <?php endforeach; ?>
</div>
<?php endif; ?>
<?php require dirname(__DIR__) . '/includes/footer.php'; ?>
