<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/admin_auth.php';

$exams = q_all('SELECT id, title, type FROM exams ORDER BY type, title');
$users = q_all("SELECT id, name, username FROM users WHERE role = 'user' ORDER BY name");
$depts = departments();

$pageTitle = 'Test Results';
$layout = 'admin';
$activeMenu = 'results';
require dirname(__DIR__) . '/includes/header.php';
$sel = fn (string $k, string $v) => get_str($k) === $v ? 'selected' : '';
?>
<div class="row g-3 mb-3" id="summaryTiles">
    <div class="col-6 col-lg-3"><div class="card-x stat-card"><div class="stat-icon ic-blue"><i class="bi bi-send-check"></i></div><div><div class="stat-value" data-sum="n">—</div><div class="stat-label">Submission</div></div></div></div>
    <div class="col-6 col-lg-3"><div class="card-x stat-card"><div class="stat-icon ic-gold"><i class="bi bi-bar-chart"></i></div><div><div class="stat-value" data-sum="avg_score">—</div><div class="stat-label">Rata-rata Score</div></div></div></div>
    <div class="col-6 col-lg-3"><div class="card-x stat-card"><div class="stat-icon ic-green"><i class="bi bi-arrow-up-right"></i></div><div><div class="stat-value" data-sum="max_score">—</div><div class="stat-label">Score Tertinggi</div></div></div></div>
    <div class="col-6 col-lg-3"><div class="card-x stat-card"><div class="stat-icon ic-navy"><i class="bi bi-patch-check"></i></div><div><div class="stat-value" data-sum="pass_rate">—</div><div class="stat-label">Tingkat Kelulusan</div></div></div></div>
</div>

<div class="card-x">
    <form class="card-x-header filter-bar filter-collapsible" id="filterForm" autocomplete="off">
        <div class="row g-2 w-100 align-items-end">
            <div class="col-12 col-md-4 col-xl-3 d-flex gap-2">
                <div class="input-icon flex-fill"><i class="bi bi-search"></i><input class="form-control" name="q" placeholder="Cari nama, username, ujian..." value="<?= e(get_str('q')) ?>"></div>
                <button type="button" class="btn btn-light d-md-none" id="btnFilterToggle" aria-label="Filter"><i class="bi bi-sliders"></i></button>
            </div>
            <div class="filter-adv col-6 col-md-4 col-xl-2">
                <select class="form-select" name="type">
                    <option value="">Semua jenis</option>
                    <option value="test" <?= $sel('type', 'test') ?>>Test</option>
                    <option value="pretest" <?= $sel('type', 'pretest') ?>>Pre-Test</option>
                </select>
            </div>
            <div class="filter-adv col-6 col-md-4 col-xl-3">
                <select class="form-select" name="exam_id">
                    <option value="">Semua ujian</option>
                    <?php foreach ($exams as $x): ?><option value="<?= (int) $x['id'] ?>" <?= $sel('exam_id', (string) $x['id']) ?>>[<?= e(type_label($x['type'])) ?>] <?= e($x['title']) ?></option><?php endforeach; ?>
                </select>
            </div>
            <div class="filter-adv col-6 col-md-4 col-xl-2">
                <select class="form-select" name="user_id">
                    <option value="">Semua peserta</option>
                    <?php foreach ($users as $u): ?><option value="<?= (int) $u['id'] ?>" <?= $sel('user_id', (string) $u['id']) ?>><?= e($u['name']) ?></option><?php endforeach; ?>
                </select>
            </div>
            <div class="filter-adv col-6 col-md-4 col-xl-2">
                <select class="form-select" name="department">
                    <option value="">Semua department</option>
                    <?php foreach ($depts as $d): ?><option <?= $sel('department', $d) ?>><?= e($d) ?></option><?php endforeach; ?>
                </select>
            </div>
            <div class="filter-adv col-6 col-md-3 col-xl-2"><label class="small text-muted">Dari tanggal</label><input type="date" class="form-control" name="date_from" value="<?= e(get_str('date_from')) ?>"></div>
            <div class="filter-adv col-6 col-md-3 col-xl-2"><label class="small text-muted">Sampai tanggal</label><input type="date" class="form-control" name="date_to" value="<?= e(get_str('date_to')) ?>"></div>
            <div class="filter-adv col-3 col-md-2 col-xl-1"><label class="small text-muted">Score min</label><input type="number" min="0" max="100" class="form-control" name="score_min" value="<?= e(get_str('score_min')) ?>"></div>
            <div class="filter-adv col-3 col-md-2 col-xl-1"><label class="small text-muted">Score max</label><input type="number" min="0" max="100" class="form-control" name="score_max" value="<?= e(get_str('score_max')) ?>"></div>
            <div class="filter-adv col-6 col-md-2 col-xl-2">
                <label class="small text-muted">Hasil</label>
                <select class="form-select" name="result">
                    <option value="">Semua</option>
                    <option value="passed" <?= $sel('result', 'passed') ?>>Lulus</option>
                    <option value="failed" <?= $sel('result', 'failed') ?>>Tidak lulus</option>
                    <option value="review" <?= $sel('result', 'review') ?>>Perlu penilaian essay</option>
                </select>
            </div>
            <div class="col-12 col-xl-4 d-flex gap-2 justify-content-xl-end">
                <button type="button" class="btn btn-light" id="btnReset"><i class="bi bi-x-circle"></i> Reset</button>
                <a class="btn btn-soft" id="btnExcel" href="#"><i class="bi bi-file-earmark-excel"></i> Excel</a>
                <a class="btn btn-soft-danger" id="btnPdf" href="#" target="_blank"><i class="bi bi-file-earmark-pdf"></i> PDF</a>
            </div>
        </div>
        <input type="hidden" name="sort" value="<?= e(get_str('sort', 'submitted_at')) ?>">
        <input type="hidden" name="dir" value="<?= e(get_str('dir', 'desc')) ?>">
    </form>
    <div class="table-responsive">
        <table class="table table-x table-stack" id="resultsTable">
            <thead>
            <tr>
                <th class="sortable" data-sort="name">User</th>
                <th class="sortable" data-sort="exam">Ujian</th>
                <th class="text-end sortable" data-sort="correct">Benar</th>
                <th class="text-end">Salah</th>
                <th class="text-end">Kosong</th>
                <th class="text-end sortable" data-sort="score">Score</th>
                <th class="sortable" data-sort="duration">Durasi</th>
                <th class="sortable" data-sort="submitted_at">Tanggal</th>
                <th></th>
            </tr>
            </thead>
            <tbody></tbody>
        </table>
    </div>
    <div class="d-flex align-items-center p-3 border-top flex-wrap gap-2">
        <small class="text-muted" id="pageInfo"></small>
        <div class="ms-auto" id="pager"></div>
    </div>
</div>
<?php
$extraScripts = ['js/admin-results.js'];
require dirname(__DIR__) . '/includes/footer.php';
