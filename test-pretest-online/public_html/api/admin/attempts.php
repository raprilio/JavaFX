<?php
/**
 * POST action=grade   {answer_id, points}  — nilai jawaban essay
 * POST action=delete  {id}                 — hapus attempt (peserta dapat mengulang)
 * POST action=regrade {id}                 — hitung ulang nilai otomatis dari kunci terbaru
 */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

require_method('POST');
verify_csrf();

switch (admin_action()) {
    case 'grade':
        $ans = q_row(
            'SELECT ea.id, ea.attempt_id, aq.points AS max_points, q.question_type
               FROM exam_answers ea
               JOIN attempt_questions aq ON aq.attempt_id = ea.attempt_id AND aq.question_id = ea.question_id
               JOIN questions q ON q.id = ea.question_id
              WHERE ea.id = ?',
            [in_int('answer_id')]
        );
        if (!$ans) {
            json_error('Jawaban tidak ditemukan.', 404);
        }
        $status = q_val('SELECT status FROM exam_attempts WHERE id = ?', [$ans['attempt_id']]);
        if ($status === 'in_progress') {
            json_error('Attempt masih berlangsung.', 409);
        }
        $points = (float) str_replace(',', '.', in_str('points', '0'));
        if ($points < 0 || $points > (float) $ans['max_points']) {
            json_error('Point harus antara 0 dan ' . (float) $ans['max_points'] . '.', 422);
        }
        q('UPDATE exam_answers SET points = ?, is_correct = ?, graded_by = ? WHERE id = ?',
            [$points, $points > 0 ? 1 : 0, current_user()['id'], $ans['id']]);
        recalc_attempt_totals((int) $ans['attempt_id']);
        log_activity('result', 'Menilai essay (attempt #' . $ans['attempt_id'] . ', point ' . $points . ')');
        json_out(['ok' => true, 'message' => 'Nilai disimpan.']);

    case 'regrade':
        $id = in_int('id');
        $attempt = q_row("SELECT * FROM exam_attempts WHERE id = ? AND status <> 'in_progress'", [$id]);
        if (!$attempt) {
            json_error('Attempt tidak ditemukan.', 404);
        }
        $pdo = db();
        $pdo->beginTransaction();
        $rows = q_all(
            'SELECT ea.*, aq.points AS max_points, q.question_type
               FROM exam_answers ea
               JOIN attempt_questions aq ON aq.attempt_id = ea.attempt_id AND aq.question_id = ea.question_id
               JOIN questions q ON q.id = ea.question_id
              WHERE ea.attempt_id = ?',
            [$id]
        );
        foreach ($rows as $r) {
            if ($r['question_type'] === 'essay') {
                continue; // nilai manual dipertahankan
            }
            $correct = q_all('SELECT id, option_text FROM question_options WHERE question_id = ? AND is_correct = 1', [$r['question_id']]);
            [$ok, $pts] = grade_answer($r['question_type'], (float) $r['max_points'], $correct, $r);
            q('UPDATE exam_answers SET is_correct = ?, points = ? WHERE id = ?', [$ok, $pts, $r['id']]);
        }
        recalc_attempt_totals($id);
        $pdo->commit();
        log_activity('result', 'Menghitung ulang nilai attempt #' . $id);
        json_out(['ok' => true, 'message' => 'Nilai dihitung ulang.']);

    case 'delete':
        $n = q('DELETE FROM exam_attempts WHERE id = ?', [in_int('id')])->rowCount();
        if ($n) {
            log_activity('result', 'Menghapus attempt #' . in_int('id'));
        }
        json_out(['ok' => $n > 0, 'message' => $n ? 'Attempt dihapus. Peserta dapat mengerjakan ulang.' : 'Attempt tidak ditemukan.']);

    default:
        json_error('Aksi tidak dikenal.');
}
