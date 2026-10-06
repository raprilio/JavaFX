<?php
/** Verifikasi publik sertifikat Pre-Test: verify.php?code=CERT-… */
declare(strict_types=1);
require_once __DIR__ . '/includes/functions.php';

app_session_start();
$code = strtoupper(trim(get_str('code')));
$row = null;
if ($code !== '' && ($aid = certificate_verify($code))) {
    $row = q_row(
        "SELECT a.submitted_at, a.passed, a.pending_review, u.name, u.department, e.title, e.type, e.show_result
           FROM exam_attempts a JOIN users u ON u.id = a.user_id JOIN exams e ON e.id = a.exam_id
          WHERE a.id = ? AND a.status <> 'in_progress'",
        [$aid]
    );
    if ($row && !(exam_user_can_view_score($row) && (int) $row['passed'] === 1 && (int) $row['pending_review'] === 0)) {
        $row = null;
    }
}
$pageTitle = 'Verifikasi Sertifikat';
$layout = 'plain';
require __DIR__ . '/includes/header.php';
?>
<div class="container py-5" style="max-width:560px">
    <div class="text-center mb-4">
        <img src="<?= e(app_logo_url()) ?>" class="<?= e(logo_class('auth-logo')) ?> mb-3" alt="">
        <div class="small-caps"><?= e(institution_full()) ?></div>
        <h1 class="h4 fw-800 mt-2">Verifikasi Sertifikat</h1>
    </div>
    <form class="card-x card-x-body mb-3 d-flex gap-2" method="get">
        <input class="form-control" name="code" value="<?= e($code) ?>" placeholder="CERT-123-XXXXXXXXXX" required>
        <button class="btn btn-primary">Cek</button>
    </form>
    <?php if ($code !== ''): ?>
        <?php if ($row): ?>
            <div class="card-x card-x-body text-center fade-in">
                <div class="success-icon" style="width:80px;height:80px;font-size:2.4rem"><i class="bi bi-patch-check"></i></div>
                <h2 class="h5 fw-800 text-success">Sertifikat VALID</h2>
                <dl class="kv text-start mt-3">
                    <dt>Nama</dt><dd><?= e($row['name']) ?></dd>
                    <dt>Unit</dt><dd><?= e($row['department'] ?: '—') ?></dd>
                    <dt>Ujian</dt><dd><?= e($row['title']) ?></dd>
                    <dt>Tanggal</dt><dd><?= e(tanggal_id(strtotime((string) $row['submitted_at']), false)) ?></dd>
                    <dt>Status</dt><dd><span class="badge badge-soft bs-green">LULUS</span></dd>
                </dl>
            </div>
        <?php else: ?>
            <div class="card-x card-x-body text-center fade-in">
                <div class="icon-bubble ic-red mx-auto mb-3"><i class="bi bi-x-octagon"></i></div>
                <h2 class="h5 fw-800 text-danger">Sertifikat tidak ditemukan</h2>
                <p class="text-muted mb-0">Kode tidak valid atau sertifikat tidak diterbitkan oleh sistem ini.</p>
            </div>
        <?php endif; ?>
    <?php endif; ?>
    <p class="text-center mt-4"><a href="<?= e(url('login.php')) ?>" class="small fw-semibold"><i class="bi bi-arrow-left"></i> Ke halaman login</a></p>
</div>
<?php require __DIR__ . '/includes/footer.php'; ?>
