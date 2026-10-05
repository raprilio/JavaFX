<?php
/**
 * POST {attempt_id} — kirim ujian.
 * Score dihitung & disimpan ke MySQL untuk SEMUA jenis ujian, tetapi respons
 * ke peserta tidak pernah berisi angka score. Untuk Test hanya status + pesan.
 */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

require_method('POST');
verify_csrf();

['attempt' => $attempt, 'exam' => $exam] = api_user_attempt(in_int('attempt_id'));

if ($attempt['status'] === 'in_progress') {
    $status = attempt_is_expired($attempt, EXAM_GRACE_SECONDS) ? 'auto_submitted' : 'submitted';
    finalize_attempt((int) $attempt['id'], $status);
}

$response = [
    'ok'       => true,
    'status'   => 'submitted',
    'redirect' => attempt_result_url($attempt, $exam),
];
$response['message'] = $exam['type'] === 'test' ? 'Test berhasil dikirim.' : 'Pre-Test berhasil dikirim.';

json_out($response);
