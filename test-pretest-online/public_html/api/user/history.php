<?php
/** GET — riwayat ujian peserta (score Test sudah di-NULL-kan di SQL lalu dibuang). */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$rows = [];
foreach (user_history((int) current_user()['id']) as $h) {
    $item = [
        'attempt_id'   => (int) $h['id'],
        'exam'         => $h['title'],
        'type'         => $h['type'],
        'status'       => 'submitted',
        'submitted_at' => $h['submitted_at'],
    ];
    if ((int) $h['result_visible'] === 1) {
        $item['score'] = (float) $h['score'];
        $item['passed'] = (bool) $h['passed'];
    } else {
        $item['result'] = 'Diproses';
    }
    $rows[] = $item;
}
json_out(['ok' => true, 'data' => $rows]);
