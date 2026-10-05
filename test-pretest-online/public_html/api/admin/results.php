<?php
/** GET — daftar hasil ujian (filter, sort, paging). Admin only. */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

finalize_expired_attempts();

$f = admin_results_filters($_GET);
$page = max(1, get_int('page', 1));
$per = min(100, max(10, get_int('per_page', 25)));
[$rows, $total] = admin_results_fetch($f, $page, $per);

[$where, $params] = admin_results_where($f);
$summary = q_row(
    "SELECT COUNT(*) AS n, ROUND(AVG(a.score), 1) AS avg_score, MAX(a.score) AS max_score, MIN(a.score) AS min_score,
            SUM(a.passed = 1) AS passed
       FROM exam_attempts a JOIN users u ON u.id = a.user_id JOIN exams e ON e.id = a.exam_id WHERE $where",
    $params
);

json_out([
    'ok'      => true,
    'data'    => $rows,
    'total'   => $total,
    'page'    => $page,
    'pages'   => (int) ceil($total / $per),
    'summary' => $summary,
]);
