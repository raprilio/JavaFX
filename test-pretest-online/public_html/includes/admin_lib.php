<?php
/**
 * Fungsi khusus admin (query hasil/score). Defense-in-depth: file ini menolak
 * dieksekusi jika user yang login bukan admin.
 */
declare(strict_types=1);

if (!function_exists('is_admin') || !is_admin()) {
    http_response_code(403);
    exit('Forbidden');
}

const RESULT_SORTS = [
    'score'        => 'a.score',
    'submitted_at' => 'a.submitted_at',
    'name'         => 'u.name',
    'exam'         => 'e.title',
    'duration'     => 'a.duration',
    'correct'      => 'a.correct_answers',
];

function admin_results_filters(array $src): array
{
    $g = fn ($k) => isset($src[$k]) && is_scalar($src[$k]) ? trim((string) $src[$k]) : '';
    $sort = $g('sort');
    return [
        'q'          => $g('q'),
        'exam_id'    => (int) $g('exam_id'),
        'user_id'    => (int) $g('user_id'),
        'department' => $g('department'),
        'type'       => in_array($g('type'), ['pretest', 'test'], true) ? $g('type') : '',
        'date_from'  => preg_match('/^\d{4}-\d{2}-\d{2}$/', $g('date_from')) ? $g('date_from') : '',
        'date_to'    => preg_match('/^\d{4}-\d{2}-\d{2}$/', $g('date_to')) ? $g('date_to') : '',
        'score_min'  => is_numeric($g('score_min')) ? (float) $g('score_min') : null,
        'score_max'  => is_numeric($g('score_max')) ? (float) $g('score_max') : null,
        'result'     => in_array($g('result'), ['passed', 'failed', 'review'], true) ? $g('result') : '',
        'sort'       => isset(RESULT_SORTS[$sort]) ? $sort : 'submitted_at',
        'dir'        => strtolower($g('dir')) === 'asc' ? 'ASC' : 'DESC',
    ];
}

function admin_results_where(array $f): array
{
    $w = ["a.status <> 'in_progress'"];
    $p = [];
    if ($f['q'] !== '') {
        $w[] = '(u.name LIKE ? OR u.username LIKE ? OR e.title LIKE ?)';
        $like = '%' . $f['q'] . '%';
        array_push($p, $like, $like, $like);
    }
    if ($f['exam_id'] > 0) { $w[] = 'a.exam_id = ?'; $p[] = $f['exam_id']; }
    if ($f['user_id'] > 0) { $w[] = 'a.user_id = ?'; $p[] = $f['user_id']; }
    if ($f['department'] !== '') { $w[] = 'u.department = ?'; $p[] = $f['department']; }
    if ($f['type'] !== '') { $w[] = 'e.type = ?'; $p[] = $f['type']; }
    if ($f['date_from'] !== '') { $w[] = 'a.submitted_at >= ?'; $p[] = $f['date_from'] . ' 00:00:00'; }
    if ($f['date_to'] !== '') { $w[] = 'a.submitted_at <= ?'; $p[] = $f['date_to'] . ' 23:59:59'; }
    if ($f['score_min'] !== null) { $w[] = 'a.score >= ?'; $p[] = $f['score_min']; }
    if ($f['score_max'] !== null) { $w[] = 'a.score <= ?'; $p[] = $f['score_max']; }
    if ($f['result'] === 'passed') { $w[] = 'a.passed = 1'; }
    if ($f['result'] === 'failed') { $w[] = 'a.passed = 0'; }
    if ($f['result'] === 'review') { $w[] = 'a.pending_review > 0'; }
    return [implode(' AND ', $w), $p];
}

/** @return array{0: array, 1: int} rows, total */
function admin_results_fetch(array $f, int $page = 0, int $perPage = 25): array
{
    [$where, $params] = admin_results_where($f);
    $from = "FROM exam_attempts a JOIN users u ON u.id = a.user_id JOIN exams e ON e.id = a.exam_id WHERE $where";
    $total = (int) q_val("SELECT COUNT(*) $from", $params);
    $order = RESULT_SORTS[$f['sort']] . ' ' . $f['dir'] . ', a.id DESC';
    $sql = "SELECT a.id, a.user_id, a.exam_id, a.started_at, a.submitted_at, a.duration, a.status,
                   a.total_questions, a.correct_answers, a.wrong_answers, a.unanswered, a.pending_review,
                   a.total_points, a.max_points, a.score, a.percentage, a.passed, a.tab_switches,
                   u.name, u.username, u.department, u.position,
                   e.title AS exam_title, e.type AS exam_type, e.passing_grade
              $from ORDER BY $order";
    if ($page > 0) {
        $sql .= ' LIMIT ' . (int) $perPage . ' OFFSET ' . (int) (($page - 1) * $perPage);
    }
    return [q_all($sql, $params), $total];
}

function admin_filter_summary(array $f): string
{
    $parts = [];
    if ($f['exam_id']) { $parts[] = 'Ujian: ' . (q_val('SELECT title FROM exams WHERE id = ?', [$f['exam_id']]) ?? '-'); }
    if ($f['user_id']) { $parts[] = 'Peserta: ' . (q_val('SELECT name FROM users WHERE id = ?', [$f['user_id']]) ?? '-'); }
    if ($f['type']) { $parts[] = 'Jenis: ' . type_label($f['type']); }
    if ($f['department']) { $parts[] = 'Department: ' . $f['department']; }
    if ($f['date_from'] || $f['date_to']) { $parts[] = 'Tanggal: ' . ($f['date_from'] ?: '…') . ' s.d. ' . ($f['date_to'] ?: '…'); }
    if ($f['score_min'] !== null || $f['score_max'] !== null) { $parts[] = 'Score: ' . ($f['score_min'] ?? 0) . '–' . ($f['score_max'] ?? 100); }
    if ($f['result']) { $parts[] = 'Hasil: ' . ['passed' => 'Lulus', 'failed' => 'Tidak lulus', 'review' => 'Perlu penilaian'][$f['result']]; }
    if ($f['q']) { $parts[] = 'Cari: "' . $f['q'] . '"'; }
    return $parts ? implode(' · ', $parts) : 'Semua data';
}

/** Ranking attempt dalam exam yang sama (berdasarkan score). */
function attempt_rank(array $attempt): array
{
    $total = (int) q_val("SELECT COUNT(*) FROM exam_attempts WHERE exam_id = ? AND status <> 'in_progress'", [$attempt['exam_id']]);
    $higher = (int) q_val(
        "SELECT COUNT(*) FROM exam_attempts WHERE exam_id = ? AND status <> 'in_progress' AND score > ?",
        [$attempt['exam_id'], $attempt['score'] ?? 0]
    );
    return [$higher + 1, $total];
}
