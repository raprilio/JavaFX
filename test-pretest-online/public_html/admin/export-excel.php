<?php
/** Export hasil ujian ke Excel (.xlsx). Admin only. Mengikuti filter halaman Test Results. */
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/admin_auth.php';
require_once dirname(__DIR__) . '/includes/admin_lib.php';
require_once dirname(__DIR__) . '/includes/xlsx.php';

finalize_expired_attempts();
$f = admin_results_filters($_GET);
[$rows] = admin_results_fetch($f);

$headers = ['Nama', 'Username', 'Department', 'Exam', 'Type', 'Correct', 'Wrong', 'Unanswered', 'Score', 'Percentage', 'Status', 'Pindah Tab', 'Duration', 'Start Time', 'Submit Time'];
$data = [];
foreach ($rows as $r) {
    $data[] = [
        $r['name'], $r['username'], $r['department'] ?? '', $r['exam_title'], type_label($r['exam_type']),
        (int) $r['correct_answers'], (int) $r['wrong_answers'], (int) $r['unanswered'],
        (float) $r['score'], (float) $r['percentage'],
        (int) $r['pending_review'] > 0 ? 'Perlu penilaian' : ((int) $r['passed'] ? 'Lulus' : 'Tidak Lulus'),
        (int) $r['tab_switches'],
        fmt_duration($r['duration'] !== null ? (int) $r['duration'] : null),
        fmt_date($r['started_at'], 'd-m-Y H:i'), fmt_date($r['submitted_at'], 'd-m-Y H:i'),
    ];
}

log_activity('export', 'Export Excel hasil ujian (' . count($data) . ' baris)');
xlsx_download(
    'hasil-ujian-' . date('Ymd-His') . '.xlsx',
    'Hasil Ujian',
    $headers,
    $data,
    app_name() . ' — ' . institution_full() . ' — Laporan Hasil Ujian (' . admin_filter_summary($f) . ') · ' . date('d-m-Y H:i')
);
