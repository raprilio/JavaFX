<?php
/** POST {attempt_id, question_id, answer} — auto-save satu jawaban. */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

require_method('POST');
verify_csrf();

['attempt' => $attempt, 'exam' => $exam] = api_user_attempt(in_int('attempt_id'));

if ($attempt['status'] !== 'in_progress') {
    json_error('Ujian sudah dikirim. Jawaban tidak dapat diubah.', 409, [
        'expired'  => true,
        'redirect' => attempt_result_url($attempt, $exam),
    ]);
}

// Validasi waktu di server (toleransi jaringan EXAM_GRACE_SECONDS)
if (attempt_is_expired($attempt, EXAM_GRACE_SECONDS)) {
    finalize_attempt((int) $attempt['id'], 'auto_submitted');
    json_error('Waktu ujian telah habis. Jawaban dikirim otomatis.', 409, [
        'expired'  => true,
        'redirect' => attempt_result_url($attempt, $exam),
    ]);
}

try {
    save_answer($attempt, in_int('question_id'), input()['answer'] ?? null);
} catch (RuntimeException $e) {
    json_error($e->getMessage(), 422);
}

json_out([
    'ok'        => true,
    'saved_at'  => now(),
    'remaining' => attempt_remaining_seconds($attempt),
]);
