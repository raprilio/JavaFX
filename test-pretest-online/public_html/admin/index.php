<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/admin_auth.php';

$pageTitle = 'Dashboard';
$layout = 'admin';
$activeMenu = 'dashboard';
require dirname(__DIR__) . '/includes/header.php';

$tiles = [
    ['total_users', 'Total User', 'bi-people', 'ic-blue'],
    ['total_pretest', 'Total Pre-Test', 'bi-lightbulb', 'ic-navy'],
    ['total_test', 'Total Test', 'bi-patch-check', 'ic-gold'],
    ['total_submissions', 'Total Submission', 'bi-send-check', 'ic-green'],
    ['avg_test', 'Rata-rata Score Test', 'bi-award', 'ic-amber'],
    ['avg_pretest', 'Rata-rata Score Pre-Test', 'bi-graph-up', 'ic-red'],
];
?>
<div class="row g-3 mb-4">
    <?php foreach ($tiles as [$key, $label, $icon, $cls]): ?>
        <div class="col-6 col-md-4 col-xxl-2">
            <div class="card-x stat-card hover-lift h-100">
                <div class="stat-icon <?= $cls ?>"><i class="bi <?= $icon ?>"></i></div>
                <div class="min-w-0">
                    <div class="stat-value" data-stat="<?= $key ?>"><span class="placeholder col-6"></span></div>
                    <div class="stat-label"><?= e($label) ?></div>
                </div>
            </div>
        </div>
    <?php endforeach; ?>
</div>

<div class="row g-3 mb-3">
    <div class="col-xl-8">
        <div class="card-x h-100">
            <div class="card-x-header"><h2>Distribusi Score</h2><span class="small text-muted ms-auto">Pre-Test vs Test</span></div>
            <div class="card-x-body"><div class="chart-box"><canvas id="chDist"></canvas></div></div>
        </div>
    </div>
    <div class="col-xl-4">
        <div class="card-x h-100">
            <div class="card-x-header"><h2>Lulus / Tidak Lulus</h2>
                <select class="form-select form-select-sm ms-auto w-auto" id="passType"><option value="test">Test</option><option value="pretest">Pre-Test</option></select>
            </div>
            <div class="card-x-body"><div class="chart-box"><canvas id="chPass"></canvas></div></div>
        </div>
    </div>
</div>

<div class="row g-3 mb-3">
    <div class="col-xl-7">
        <div class="card-x h-100">
            <div class="card-x-header"><h2>Jumlah Submission</h2><span class="small text-muted ms-auto">14 hari terakhir</span></div>
            <div class="card-x-body"><div class="chart-box"><canvas id="chDaily"></canvas></div></div>
        </div>
    </div>
    <div class="col-xl-5">
        <div class="card-x h-100">
            <div class="card-x-header"><h2>Pre-Test vs Test</h2><span class="small text-muted ms-auto">Rata-rata per department</span></div>
            <div class="card-x-body"><div class="chart-box"><canvas id="chCompare"></canvas></div></div>
        </div>
    </div>
</div>

<div class="row g-3 mb-3">
    <div class="col-xl-7">
        <div class="card-x h-100">
            <div class="card-x-header"><h2>Peserta & Rata-rata Score per Ujian</h2></div>
            <div class="card-x-body"><div class="chart-box"><canvas id="chExam"></canvas></div></div>
        </div>
    </div>
    <div class="col-xl-5">
        <div class="card-x h-100">
            <div class="card-x-header"><h2>Top 5 Score Test</h2><a href="<?= e(url('admin/results.php?type=test&sort=score&dir=desc')) ?>" class="ms-auto small fw-semibold">Ranking lengkap</a></div>
            <div id="topList" class="card-x-body pt-2"></div>
        </div>
    </div>
</div>

<div class="card-x">
    <div class="card-x-header"><h2>Submission Terbaru</h2><a href="<?= e(url('admin/results.php')) ?>" class="ms-auto small fw-semibold">Lihat semua <i class="bi bi-arrow-right"></i></a></div>
    <div class="table-responsive">
        <table class="table table-x">
            <thead><tr><th>Peserta</th><th>Ujian</th><th>Jenis</th><th>Score</th><th>Dikirim</th></tr></thead>
            <tbody id="recentBody"><tr><td colspan="5" class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm"></div></td></tr></tbody>
        </table>
    </div>
</div>
<?php
$extraScripts = ['https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js', 'js/admin-dashboard.js'];
require dirname(__DIR__) . '/includes/footer.php';
