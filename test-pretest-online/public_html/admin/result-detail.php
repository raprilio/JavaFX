<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/admin_auth.php';
require_once dirname(__DIR__) . '/includes/admin_lib.php';

$id = get_int('id');
$a = q_row(
    'SELECT a.*, u.name, u.username, u.email, u.department, u.position,
            e.title AS exam_title, e.type AS exam_type, e.passing_grade, e.duration AS exam_duration
       FROM exam_attempts a JOIN users u ON u.id = a.user_id JOIN exams e ON e.id = a.exam_id
      WHERE a.id = ?',
    [$id]
);
if (!$a) {
    flash('warning', 'Hasil tidak ditemukan.');
    redirect('admin/results.php');
}
if ($a['status'] === 'in_progress' && attempt_is_expired($a, EXAM_GRACE_SECONDS)) {
    finalize_attempt($id, 'auto_submitted');
    redirect('admin/result-detail.php?id=' . $id);
}
$rows = attempt_detail_rows($id);
[$rank, $rankTotal] = $a['status'] !== 'in_progress' ? attempt_rank($a) : [null, null];
$passed = (int) $a['passed'] === 1;

$pageTitle = 'Detail Test Result';
$layout = 'admin';
$activeMenu = 'results';
require dirname(__DIR__) . '/includes/header.php';
?>
<div class="d-flex align-items-center gap-2 mb-3 no-print flex-wrap">
    <a href="<?= e(url('admin/results.php')) ?>" class="btn btn-light btn-sm"><i class="bi bi-arrow-left"></i> Kembali</a>
    <div class="ms-auto d-flex gap-2 flex-wrap">
        <button class="btn btn-light btn-sm" onclick="window.print()"><i class="bi bi-printer"></i> Cetak</button>
        <?php if ($a['exam_type'] === 'pretest' && $passed && (int) $a['pending_review'] === 0 && setting_on('certificate_enabled') && exam_user_can_view_score(q_row('SELECT type, show_result FROM exams WHERE id = ?', [$a['exam_id']]) ?? [])): ?>
            <a class="btn btn-light btn-sm" href="<?= e(url('user/certificate.php?attempt=' . $id)) ?>" target="_blank"><i class="bi bi-award"></i> Sertifikat</a>
        <?php endif; ?>
        <?php if ($a['status'] !== 'in_progress'): ?>
            <button class="btn btn-soft btn-sm" data-action="regrade"><i class="bi bi-arrow-repeat"></i> Hitung Ulang</button>
        <?php endif; ?>
        <button class="btn btn-soft-danger btn-sm" data-action="delete"><i class="bi bi-trash"></i> Hapus Attempt</button>
    </div>
</div>

<div class="row g-3 mb-3">
    <div class="col-lg-4">
        <div class="card-x h-100 text-center">
            <div class="card-x-body p-4">
                <span class="badge-type <?= $a['exam_type'] === 'test' ? 'badge-test' : 'badge-pretest' ?>"><?= e(type_label($a['exam_type'])) ?></span>
                <?php if ($a['status'] === 'in_progress'): ?>
                    <div class="py-5"><span class="badge badge-soft bs-amber fs-6">Sedang dikerjakan</span></div>
                <?php else: ?>
                    <div class="score-ring" style="--val: <?= e((string) (float) $a['score']) ?>; --clr: <?= $passed ? 'var(--green)' : 'var(--red)' ?>">
                        <div class="inner"><div class="num"><?= e(fmt_num($a['score'], 1)) ?></div><div class="of">/ 100</div></div>
                    </div>
                    <span class="status-banner <?= $passed ? 'bs-green' : 'bs-red' ?>"><?= $passed ? 'LULUS' : 'TIDAK LULUS' ?></span>
                    <div class="small text-muted mt-2">Passing grade <?= e(fmt_num($a['passing_grade'], 1)) ?> · Ranking <strong>#<?= (int) $rank ?></strong> dari <?= (int) $rankTotal ?></div>
                <?php endif; ?>
            </div>
        </div>
    </div>
    <div class="col-lg-8">
        <div class="card-x h-100">
            <div class="card-x-header"><h2><i class="bi bi-person-badge me-1"></i><?= e($a['name']) ?></h2><span class="text-muted small">@<?= e($a['username']) ?></span></div>
            <div class="card-x-body">
                <div class="row g-4">
                    <div class="col-md-6">
                        <dl class="kv">
                            <dt>Nama</dt><dd><?= e($a['name']) ?></dd>
                            <dt>Department</dt><dd><?= e($a['department'] ?: '—') ?></dd>
                            <dt>Jabatan</dt><dd><?= e($a['position'] ?: '—') ?></dd>
                            <dt>Ujian</dt><dd><?= e($a['exam_title']) ?></dd>
                            <dt>Jenis</dt><dd><?= e(type_label($a['exam_type'])) ?></dd>
                        </dl>
                    </div>
                    <div class="col-md-6">
                        <dl class="kv">
                            <dt>Mulai</dt><dd><?= e(fmt_date($a['started_at'])) ?></dd>
                            <dt>Submit</dt><dd><?= e(fmt_date($a['submitted_at'])) ?><?= $a['status'] === 'auto_submitted' ? ' <span class="badge badge-soft bs-gray">otomatis</span>' : '' ?></dd>
                            <dt>Durasi</dt><dd><?= $a['duration'] !== null ? e(fmt_duration((int) $a['duration'])) : '—' ?> <small class="text-muted">/ <?= (int) $a['exam_duration'] ?>m</small></dd>
                            <dt>Point</dt><dd><?= e(fmt_num($a['total_points'], 2)) ?> / <?= e(fmt_num($a['max_points'], 2)) ?></dd>
                            <dt>IP Address</dt><dd><?= e($a['ip_address'] ?: '—') ?></dd>
                            <dt>Pindah tab</dt><dd><?php $ts = (int) $a['tab_switches']; ?><span class="badge badge-soft <?= $ts === 0 ? 'bs-green' : ($ts >= 3 ? 'bs-red' : 'bs-amber') ?>"><i class="bi <?= $ts ? 'bi-eye-slash' : 'bi-shield-check' ?>"></i> <?= $ts ?> kali</span></dd>
                        </dl>
                    </div>
                </div>
                <div class="row g-2 mt-2 text-center">
                    <div class="col-6 col-md-3"><div class="summary-tile py-2"><div class="label">Benar</div><div class="value text-success" style="font-size:1.4rem"><?= (int) $a['correct_answers'] ?></div></div></div>
                    <div class="col-6 col-md-3"><div class="summary-tile py-2"><div class="label">Salah</div><div class="value text-danger" style="font-size:1.4rem"><?= (int) $a['wrong_answers'] ?></div></div></div>
                    <div class="col-6 col-md-3"><div class="summary-tile py-2"><div class="label">Tidak dijawab</div><div class="value text-secondary" style="font-size:1.4rem"><?= (int) $a['unanswered'] ?></div></div></div>
                    <div class="col-6 col-md-3"><div class="summary-tile py-2"><div class="label">Persentase</div><div class="value" style="font-size:1.4rem"><?= e(fmt_num($a['percentage'], 1)) ?>%</div></div></div>
                </div>
                <?php if ((int) $a['pending_review'] > 0): ?>
                    <div class="alert alert-warning soft-alert small mt-3 mb-0"><i class="bi bi-hourglass-split me-1"></i><?= (int) $a['pending_review'] ?> jawaban essay menunggu penilaian. Score akan diperbarui setelah dinilai.</div>
                <?php endif; ?>
            </div>
        </div>
    </div>
</div>

<div class="card-x">
    <div class="card-x-header"><h2>Detail Jawaban</h2><span class="small text-muted ms-auto"><?= count($rows) ?> soal</span></div>
    <div class="card-x-body">
        <?php foreach ($rows as $r): [$lbl, $cls] = state_label($r['state']); ?>
            <div class="card-x review-item <?= e($r['state']) ?> mb-3">
                <div class="card-x-body">
                    <div class="d-flex align-items-center gap-2 mb-2 flex-wrap">
                        <span class="question-no">Question <?= (int) $r['no'] ?></span>
                        <span class="badge badge-soft bs-gray"><?= e(question_type_label($r['type'])) ?></span>
                        <span class="badge badge-soft <?= e($cls) ?> ms-auto">Status: <?= e($lbl) ?></span>
                    </div>
                    <div class="fw-semibold mb-3" style="white-space:pre-wrap"><?= e($r['question']) ?></div>
                    <?php if ($r['image']): ?><img src="<?= e(url('uploads/questions/' . $r['image'])) ?>" class="question-img" style="max-height:200px" alt=""><?php endif; ?>
                    <?php foreach ($r['options'] as $o): ?>
                        <div class="opt-review <?= $o['is_correct'] ? 'is-correct' : ($o['selected'] ? 'is-wrong' : '') ?>">
                            <strong><?= e($o['letter']) ?>.</strong><span class="flex-fill" style="white-space:pre-wrap"><?= e($o['text']) ?></span>
                            <?php if ($o['selected']): ?><span class="badge text-bg-light">Jawaban user</span><?php endif; ?>
                            <?php if ($o['is_correct']): ?><i class="bi bi-check-circle-fill text-success"></i><?php endif; ?>
                        </div>
                    <?php endforeach; ?>
                    <div class="row g-2 small mt-1">
                        <div class="col-md-5"><span class="text-muted">Jawaban User:</span> <strong style="white-space:pre-wrap"><?= e($r['user_answer']) ?></strong></div>
                        <div class="col-md-4"><span class="text-muted">Jawaban Benar:</span> <strong><?= e($r['correct_answer']) ?></strong></div>
                        <div class="col-md-3 text-md-end"><span class="text-muted">Point:</span> <strong><?= e(fmt_num($r['points'], 2)) ?></strong> / <?= e(fmt_num($r['max_points'], 2)) ?></div>
                    </div>
                    <?php if ($r['type'] === 'essay' && $r['answer_id'] && $a['status'] !== 'in_progress'): ?>
                        <form class="d-flex gap-2 align-items-center mt-3 no-print grade-form" data-answer="<?= (int) $r['answer_id'] ?>">
                            <label class="small fw-semibold">Nilai essay:</label>
                            <input type="number" step="0.25" min="0" max="<?= e((string) $r['max_points']) ?>" class="form-control form-control-sm" style="width:110px" name="points" value="<?= $r['state'] === 'pending' ? '' : e((string) $r['points']) ?>" required>
                            <span class="small text-muted">/ <?= e(fmt_num($r['max_points'], 2)) ?></span>
                            <button class="btn btn-primary btn-sm">Simpan Nilai</button>
                        </form>
                    <?php endif; ?>
                    <?php if ($r['explanation']): ?>
                        <div class="small text-muted mt-2"><i class="bi bi-lightbulb"></i> <?= e($r['explanation']) ?></div>
                    <?php endif; ?>
                </div>
            </div>
        <?php endforeach; ?>
    </div>
</div>

<script>window.ATTEMPT_ID = <?= (int) $id ?>;</script>
<?php
$extraScripts = ['js/admin-detail.js'];
require dirname(__DIR__) . '/includes/footer.php';
