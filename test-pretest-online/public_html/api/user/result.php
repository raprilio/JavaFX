<?php
/**
 * GET ?id={attempt_id} — hasil ujian versi peserta.
 *
 *   Pre-Test (show_result = 1) : score, benar, salah, tidak dijawab, status lulus.
 *   Test                       : HANYA {"status":"submitted","message":"Test berhasil dikirim."}
 *
 * Penyaringan dilakukan oleh attempt_public_summary() di server.
 */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$id = get_int('id', get_int('attempt_id'));
['attempt' => $attempt, 'exam' => $exam] = api_user_attempt($id);

if ($attempt['status'] === 'in_progress' && attempt_is_expired($attempt, EXAM_GRACE_SECONDS)) {
    finalize_attempt((int) $attempt['id'], 'auto_submitted');
    $attempt = q_row('SELECT * FROM exam_attempts WHERE id = ?', [$attempt['id']]);
}

if (!exam_user_can_view_score($exam)) {
    // Respons minimal — tidak ada field nilai sama sekali
    json_out([
        'ok'      => true,
        'status'  => $attempt['status'] === 'in_progress' ? 'in_progress' : 'submitted',
        'message' => $attempt['status'] === 'in_progress'
            ? 'Ujian sedang dikerjakan.'
            : ($exam['type'] === 'test' ? 'Test berhasil dikirim.' : 'Jawaban berhasil dikirim.'),
    ]);
}

json_out(['ok' => true] + attempt_public_summary($attempt, $exam));
