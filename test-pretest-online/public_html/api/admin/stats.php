<?php
/** GET — statistik dashboard admin (termasuk score Test). */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

finalize_expired_attempts();

$done = "a.status <> 'in_progress'";

$totals = q_row(
    "SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'user') AS total_users,
        (SELECT COUNT(*) FROM users WHERE role = 'user' AND status = 'active') AS active_users,
        (SELECT COUNT(*) FROM exams WHERE type = 'pretest') AS total_pretest,
        (SELECT COUNT(*) FROM exams WHERE type = 'test') AS total_test,
        (SELECT COUNT(*) FROM questions) AS total_questions,
        (SELECT COUNT(*) FROM exam_attempts a WHERE $done) AS total_submissions,
        (SELECT COUNT(*) FROM exam_attempts a WHERE a.status = 'in_progress') AS in_progress,
        (SELECT COUNT(*) FROM exam_attempts a WHERE $done AND a.pending_review > 0) AS pending_review,
        (SELECT ROUND(AVG(a.score), 1) FROM exam_attempts a JOIN exams e ON e.id = a.exam_id WHERE $done AND e.type = 'test') AS avg_test,
        (SELECT ROUND(AVG(a.score), 1) FROM exam_attempts a JOIN exams e ON e.id = a.exam_id WHERE $done AND e.type = 'pretest') AS avg_pretest"
);

// Distribusi score (0-9, 10-19, ..., 90-100)
$dist = ['pretest' => array_fill(0, 10, 0), 'test' => array_fill(0, 10, 0)];
foreach (q_all(
    "SELECT e.type, LEAST(9, FLOOR(a.score / 10)) AS bucket, COUNT(*) AS n
       FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
      WHERE $done GROUP BY e.type, bucket"
) as $r) {
    $dist[$r['type']][(int) $r['bucket']] = (int) $r['n'];
}

// Submission 14 hari terakhir
$days = [];
for ($i = 13; $i >= 0; $i--) {
    $days[date('Y-m-d', strtotime("-$i day"))] = ['pretest' => 0, 'test' => 0];
}
foreach (q_all(
    "SELECT DATE(a.submitted_at) AS d, e.type, COUNT(*) AS n
       FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
      WHERE $done AND a.submitted_at >= ? GROUP BY d, e.type",
    [array_key_first($days) . ' 00:00:00']
) as $r) {
    if (isset($days[$r['d']])) {
        $days[$r['d']][$r['type']] = (int) $r['n'];
    }
}

// Lulus / tidak lulus per jenis
$pass = ['pretest' => ['passed' => 0, 'failed' => 0], 'test' => ['passed' => 0, 'failed' => 0]];
foreach (q_all(
    "SELECT e.type, SUM(a.passed = 1) AS passed, SUM(a.passed = 0) AS failed
       FROM exam_attempts a JOIN exams e ON e.id = a.exam_id WHERE $done GROUP BY e.type"
) as $r) {
    $pass[$r['type']] = ['passed' => (int) $r['passed'], 'failed' => (int) $r['failed']];
}

// Per ujian: peserta & rata-rata
$perExam = q_all(
    "SELECT e.id, e.title, e.type, COUNT(a.id) AS submissions, COUNT(DISTINCT a.user_id) AS participants,
            ROUND(AVG(a.score), 1) AS avg_score
       FROM exams e LEFT JOIN exam_attempts a ON a.exam_id = e.id AND $done
      GROUP BY e.id, e.title, e.type
      ORDER BY submissions DESC, e.id DESC LIMIT 10"
);

// Pre-Test vs Test per department
$perDept = q_all(
    "SELECT COALESCE(NULLIF(u.department, ''), 'Tanpa Dept') AS department,
            ROUND(AVG(CASE WHEN e.type = 'pretest' THEN a.score END), 1) AS avg_pretest,
            ROUND(AVG(CASE WHEN e.type = 'test' THEN a.score END), 1) AS avg_test
       FROM exam_attempts a JOIN users u ON u.id = a.user_id JOIN exams e ON e.id = a.exam_id
      WHERE $done GROUP BY department ORDER BY department LIMIT 12"
);

$recent = q_all(
    "SELECT a.id, a.score, a.passed, a.submitted_at, u.name, e.title, e.type
       FROM exam_attempts a JOIN users u ON u.id = a.user_id JOIN exams e ON e.id = a.exam_id
      WHERE $done ORDER BY a.submitted_at DESC LIMIT 6"
);

$top = q_all(
    "SELECT a.id, a.score, u.name, u.department, e.title, e.type
       FROM exam_attempts a JOIN users u ON u.id = a.user_id JOIN exams e ON e.id = a.exam_id
      WHERE $done AND e.type = 'test' ORDER BY a.score DESC, a.duration ASC LIMIT 5"
);

json_out([
    'ok'           => true,
    'totals'       => $totals,
    'distribution' => $dist,
    'daily'        => ['labels' => array_map(fn ($d) => date('d/m', strtotime($d)), array_keys($days)),
                       'pretest' => array_column(array_values($days), 'pretest'),
                       'test' => array_column(array_values($days), 'test')],
    'pass'         => $pass,
    'per_exam'     => $perExam,
    'per_dept'     => $perDept,
    'recent'       => $recent,
    'top'          => $top,
]);
