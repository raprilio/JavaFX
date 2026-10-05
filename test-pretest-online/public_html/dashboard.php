<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/auth.php';

if (is_admin()) {
    redirect('admin/index.php');
}

$me = current_user();
finalize_expired_attempts((int) $me['id']);

$exams = user_exam_list($me);
$history = user_history((int) $me['id'], 6);

$avail = ['pretest' => 0, 'test' => 0];
foreach ($exams as $ex) {
    if ($ex['can_start']) {
        $avail[$ex['type']]++;
    }
}

// Pre-Test terakhir yang hasilnya boleh dilihat peserta
$lastPretest = null;
$lastTest = null;
foreach ($history as $h) {
    if ($h['type'] === 'pretest' && (int) $h['result_visible'] === 1 && $lastPretest === null) {
        $lastPretest = $h;
    }
    if ($h['type'] === 'test' && $lastTest === null) {
        $lastTest = $h; // score sudah NULL dari SQL
    }
}

$firstName = explode(' ', trim($me['name']))[0];
$pageTitle = 'Dashboard';
$activeMenu = 'dashboard';
require __DIR__ . '/includes/header.php';
?>
<section class="hero mb-4 fade-in">
    <div class="position-relative" style="z-index:1">
        <div class="small-caps" style="color:var(--gold)"><?= e(tanggal_id()) ?></div>
        <h1 class="mt-1 mb-2">Selamat Datang, <?= e($firstName) ?> 👋</h1>
        <p><?= e($me['department'] ?: 'Peserta') ?><?= $me['position'] ? ' · ' . e($me['position']) : '' ?></p>
    </div>
</section>

<div class="row g-3 mb-4">
    <div class="col-6 col-lg-3 fade-in">
        <div class="summary-tile hover-lift">
            <i class="bi bi-lightbulb deco" style="color:var(--blue)"></i>
            <div class="label">Pre-Test</div>
            <div class="value"><?= (int) $avail['pretest'] ?></div>
            <div class="sub">Tersedia</div>
        </div>
    </div>
    <div class="col-6 col-lg-3 fade-in">
        <div class="summary-tile hover-lift">
            <i class="bi bi-patch-check deco" style="color:var(--gold)"></i>
            <div class="label">Test</div>
            <div class="value"><?= (int) $avail['test'] ?></div>
            <div class="sub">Tersedia</div>
        </div>
    </div>
    <div class="col-6 col-lg-3 fade-in">
        <div class="summary-tile hover-lift">
            <i class="bi bi-graph-up-arrow deco" style="color:var(--green)"></i>
            <div class="label">Pre-Test Terakhir</div>
            <?php if ($lastPretest): ?>
                <div class="value">Score <?= e(fmt_num($lastPretest['score'], 1)) ?></div>
                <div class="sub text-truncate"><?= e($lastPretest['title']) ?></div>
            <?php else: ?>
                <div class="value">—</div>
                <div class="sub">Belum ada</div>
            <?php endif; ?>
        </div>
    </div>
    <div class="col-6 col-lg-3 fade-in">
        <div class="summary-tile hover-lift">
            <i class="bi bi-send-check deco" style="color:var(--navy-700)"></i>
            <div class="label">Test Terakhir</div>
            <?php if ($lastTest): ?>
                <div class="value" style="font-size:1.15rem">Selesai</div>
                <div class="sub">Hasil Diproses · Score: —</div>
            <?php else: ?>
                <div class="value">—</div>
                <div class="sub">Belum ada</div>
            <?php endif; ?>
        </div>
    </div>
</div>

<div class="d-flex align-items-center mb-3">
    <h2 class="h5 fw-bold mb-0">Ujian Tersedia</h2>
    <span class="badge rounded-pill bs-gray badge-soft ms-2"><?= count($exams) ?></span>
</div>

<?php if (!$exams): ?>
    <div class="card-x"><div class="empty-state"><i class="bi bi-inbox"></i>Belum ada ujian yang ditugaskan kepada Anda.</div></div>
<?php else: ?>
<div class="row g-3 mb-4">
    <?php foreach ($exams as $ex): ?>
        <?php
        $btn = null;
        if ($ex['active_attempt_id']) {
            $btn = ['Lanjutkan', 'btn-gold', 'bi-play-circle'];
        } elseif ($ex['can_start']) {
            $btn = ['Mulai', 'btn-primary', 'bi-arrow-right-circle'];
        }
        if ($ex['attempts_done'] >= (int) $ex['max_attempts'] && !$ex['active_attempt_id']) {
            $state = ['Selesai', 'bs-green'];
        } elseif ($ex['active_attempt_id']) {
            $state = ['Sedang dikerjakan', 'bs-amber'];
        } elseif ($ex['not_started']) {
            $state = ['Belum dibuka', 'bs-gray'];
        } elseif (!$ex['is_open']) {
            $state = ['Ditutup', 'bs-gray'];
        } elseif ($ex['questions_total'] === 0) {
            $state = ['Belum ada soal', 'bs-gray'];
        } else {
            $state = ['Tersedia', 'bs-blue'];
        }
        ?>
        <div class="col-md-6 col-xl-4 fade-in">
            <div class="card-x exam-card hover-lift">
                <div class="d-flex justify-content-between align-items-center">
                    <span class="badge-type <?= $ex['type'] === 'test' ? 'badge-test' : 'badge-pretest' ?>"><?= e(type_label($ex['type'])) ?></span>
                    <span class="badge-soft badge <?= e($state[1]) ?>"><?= e($state[0]) ?></span>
                </div>
                <h3><?= e($ex['title']) ?></h3>
                <p class="text-muted small mb-0 line-clamp-2"><?= e($ex['description'] ?: 'Tidak ada deskripsi.') ?></p>
                <div class="meta">
                    <span><i class="bi bi-list-ol"></i><?= (int) $ex['questions_total'] ?> soal</span>
                    <span><i class="bi bi-stopwatch"></i><?= (int) $ex['duration'] ?> menit</span>
                    <span><i class="bi bi-arrow-repeat"></i><?= (int) $ex['attempts_done'] ?>/<?= (int) $ex['max_attempts'] ?> percobaan</span>
                    <?php if ($ex['end_date']): ?><span><i class="bi bi-calendar-x"></i>s.d. <?= e(fmt_date($ex['end_date'])) ?></span><?php endif; ?>
                </div>
                <div class="mt-auto">
                    <?php if ($btn): ?>
                        <a href="<?= e(url('exam.php?id=' . (int) $ex['id'])) ?>" class="btn <?= e($btn[1]) ?> w-100"><i class="bi <?= e($btn[2]) ?> me-1"></i><?= e($btn[0]) ?></a>
                    <?php else: ?>
                        <button class="btn btn-light w-100" disabled><?= $ex['type'] === 'test' && $ex['attempts_done'] > 0 ? 'Selesai — Hasil Diproses' : e($state[0]) ?></button>
                    <?php endif; ?>
                </div>
            </div>
        </div>
    <?php endforeach; ?>
</div>
<?php endif; ?>

<div class="card-x fade-in">
    <div class="card-x-header">
        <h2>Riwayat Terbaru</h2>
        <a href="<?= e(url('user/history.php')) ?>" class="ms-auto small fw-semibold">Lihat semua <i class="bi bi-arrow-right"></i></a>
    </div>
    <?php if (!$history): ?>
        <div class="empty-state"><i class="bi bi-clock-history"></i>Belum ada ujian yang diselesaikan.</div>
    <?php else: ?>
        <div class="table-responsive">
            <table class="table table-x">
                <thead><tr><th>Ujian</th><th>Jenis</th><th>Dikirim</th><th>Hasil</th></tr></thead>
                <tbody>
                <?php foreach ($history as $h): ?>
                    <tr>
                        <td class="fw-semibold"><?= e($h['title']) ?></td>
                        <td><span class="badge-type <?= $h['type'] === 'test' ? 'badge-test' : 'badge-pretest' ?>"><?= e(type_label($h['type'])) ?></span></td>
                        <td class="text-muted"><?= e(fmt_date($h['submitted_at'])) ?></td>
                        <td>
                            <?php if ((int) $h['result_visible'] === 1): ?>
                                <a href="<?= e(url('pretest-result.php?attempt=' . (int) $h['id'])) ?>" class="score-pill <?= (int) $h['passed'] ? 'bs-green' : 'bs-red' ?>"><?= e(fmt_num($h['score'], 1)) ?></a>
                            <?php else: ?>
                                <span class="badge badge-soft bs-gray"><i class="bi bi-hourglass-split me-1"></i>Selesai — Hasil Diproses</span>
                            <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    <?php endif; ?>
</div>
<?php require __DIR__ . '/includes/footer.php'; ?>
