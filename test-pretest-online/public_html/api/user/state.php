<?php
/** GET ?attempt_id= — sinkronisasi sisa waktu dari server. */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

['attempt' => $attempt, 'exam' => $exam] = api_user_attempt(get_int('attempt_id'));

if ($attempt['status'] === 'in_progress' && attempt_is_expired($attempt, EXAM_GRACE_SECONDS)) {
    finalize_attempt((int) $attempt['id'], 'auto_submitted');
    $attempt['status'] = 'auto_submitted';
}

if ($attempt['status'] !== 'in_progress') {
    json_out(['ok' => true, 'status' => 'submitted', 'redirect' => attempt_result_url($attempt, $exam)]);
}

json_out([
    'ok'          => true,
    'status'      => 'in_progress',
    'remaining'   => attempt_remaining_seconds($attempt),
    'server_time' => now(),
]);
