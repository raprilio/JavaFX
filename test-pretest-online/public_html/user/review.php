<?php
/** Pembahasan Pre-Test — hanya jika type=pretest, show_result=1, show_correct_answer=1. */
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/auth.php';

$me = current_user();
$data = load_user_attempt(get_int('attempt'), (int) $me['id']);
if (!$data || $data['attempt']['status'] === 'in_progress' || !exam_user_can_view_review($data['exam'])) {
    flash('warning', 'Pembahasan tidak tersedia untuk ujian ini.');
    redirect('user/history.php');
}
['attempt' => $attempt, 'exam' => $exam] = $data;
$rows = attempt_detail_rows((int) $attempt['id']);

$pageTitle = 'Pembahasan';
$activeMenu = 'history';
require dirname(__DIR__) . '/includes/header.php';
?>
<div class="row justify-content-center">
<div class="col-lg-9">
    <a href="<?= e(url('pretest-result.php?attempt=' . (int) $attempt['id'])) ?>" class="small fw-semibold d-inline-block mb-3"><i class="bi bi-arrow-left"></i> Kembali ke hasil</a>
    <div class="card-x mb-3">
        <div class="card-x-body d-flex align-items-center gap-3 flex-wrap">
            <div>
                <span class="badge-type badge-pretest">PRE-TEST</span>
                <h1 class="h5 fw-800 mt-2 mb-0">Pembahasan: <?= e($exam['title']) ?></h1>
            </div>
            <div class="ms-auto text-end">
                <div class="small-caps">Score</div>
                <div class="fs-3 fw-800 lh-1"><?= e(fmt_num($attempt['score'], 1)) ?></div>
            </div>
        </div>
    </div>
    <?php foreach ($rows as $r): [$lbl, $cls] = state_label($r['state']); ?>
        <div class="card-x review-item <?= e($r['state']) ?> mb-3 fade-in">
            <div class="card-x-body">
                <div class="d-flex align-items-center gap-2 mb-2">
                    <span class="question-no">Soal <?= (int) $r['no'] ?></span>
                    <span class="badge badge-soft <?= e($cls) ?> ms-auto"><?= e($lbl) ?></span>
                </div>
                <div class="fw-semibold mb-3" style="white-space:pre-wrap"><?= e($r['question']) ?></div>
                <?php if ($r['image']): ?><img src="<?= e(url('uploads/questions/' . $r['image'])) ?>" class="question-img" alt=""><?php endif; ?>
                <?php if ($r['options']): ?>
                    <?php foreach ($r['options'] as $o): ?>
                        <div class="opt-review <?= $o['is_correct'] ? 'is-correct' : ($o['selected'] ? 'is-wrong' : '') ?>">
                            <strong><?= e($o['letter']) ?>.</strong>
                            <span class="flex-fill" style="white-space:pre-wrap"><?= e($o['text']) ?></span>
                            <?php if ($o['selected']): ?><span class="badge text-bg-light">Jawaban Anda</span><?php endif; ?>
                            <?php if ($o['is_correct']): ?><i class="bi bi-check-circle-fill text-success"></i><?php endif; ?>
                        </div>
                    <?php endforeach; ?>
                <?php else: ?>
                    <div class="small"><span class="text-muted">Jawaban Anda:</span> <strong style="white-space:pre-wrap"><?= e($r['user_answer']) ?></strong></div>
                    <div class="small"><span class="text-muted">Jawaban benar:</span> <strong><?= e($r['correct_answer']) ?></strong></div>
                <?php endif; ?>
                <?php if ($r['explanation']): ?>
                    <div class="instruction-box mt-3 small"><strong><i class="bi bi-lightbulb text-warning"></i> Pembahasan:</strong><br><?= e($r['explanation']) ?></div>
                <?php endif; ?>
            </div>
        </div>
    <?php endforeach; ?>
    <div class="text-center my-4"><a href="<?= e(url('dashboard.php')) ?>" class="btn btn-primary px-4">Kembali ke Dashboard</a></div>
</div>
</div>
<?php require dirname(__DIR__) . '/includes/footer.php'; ?>
