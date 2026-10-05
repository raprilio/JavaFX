<?php
/**
 * Exam engine: kebijakan visibilitas score, pembuatan attempt,
 * auto-save, penilaian otomatis, dan finalisasi (submit / timeout).
 *
 * ATURAN INTI (ditegakkan di sini, bukan di frontend):
 *   - Score SELALU dihitung & disimpan untuk semua jenis ujian.
 *   - Peserta hanya boleh melihat score jika exam_user_can_view_score() === true,
 *     yaitu type = 'pretest' DAN show_result = 1. Untuk type = 'test' fungsi ini
 *     SELALU false, walaupun kolom show_result di database diubah manual.
 */
declare(strict_types=1);

const QUESTION_TYPES = ['multiple_choice', 'multiple_answer', 'true_false', 'short_answer', 'essay'];
const OPTION_BASED_TYPES = ['multiple_choice', 'multiple_answer', 'true_false'];

/* ------------------------------------------------------------------ */
/*  Kebijakan visibilitas (single source of truth)                     */
/* ------------------------------------------------------------------ */

function exam_user_can_view_score(array $exam): bool
{
    return ($exam['type'] ?? '') === 'pretest' && (int) ($exam['show_result'] ?? 0) === 1;
}

function exam_user_can_view_review(array $exam): bool
{
    return exam_user_can_view_score($exam) && (int) ($exam['show_correct_answer'] ?? 0) === 1;
}

/**
 * Normalisasi pengaturan exam sebelum disimpan.
 * Test resmi tidak pernah boleh menampilkan hasil/pembahasan ke peserta.
 */
function exam_enforce_policy(array $data): array
{
    if (($data['type'] ?? '') === 'test') {
        $data['show_result'] = 0;
        $data['show_correct_answer'] = 0;
    }
    return $data;
}

/**
 * Ringkasan attempt yang AMAN untuk dikirim ke peserta.
 * Field nilai hanya disertakan jika kebijakan mengizinkan.
 */
function attempt_public_summary(array $attempt, array $exam): array
{
    $finished = $attempt['status'] !== 'in_progress';
    $out = [
        'attempt_id' => (int) $attempt['id'],
        'exam_title' => $exam['title'],
        'exam_type'  => $exam['type'],
        'status'     => $finished ? 'submitted' : 'in_progress',
        'submitted_at' => $attempt['submitted_at'],
    ];
    if (!$finished) {
        $out['message'] = 'Ujian sedang dikerjakan.';
        return $out;
    }
    if (!exam_user_can_view_score($exam)) {
        $out['message'] = 'Test berhasil dikirim.';
        return $out;
    }
    $out += [
        'score'          => (float) $attempt['score'],
        'correct'        => (int) $attempt['correct_answers'],
        'wrong'          => (int) $attempt['wrong_answers'],
        'unanswered'     => (int) $attempt['unanswered'],
        'pending_review' => (int) $attempt['pending_review'],
        'passing_grade'  => (float) $exam['passing_grade'],
        'passed'         => (bool) $attempt['passed'],
        'message'        => 'Pre-Test selesai.',
    ];
    return $out;
}

/* ------------------------------------------------------------------ */
/*  Ketersediaan exam untuk user                                       */
/* ------------------------------------------------------------------ */

function exam_is_open(array $exam, ?int $ts = null): bool
{
    $ts = $ts ?? time();
    if ($exam['status'] !== 'published') {
        return false;
    }
    if (!empty($exam['start_date']) && $ts < strtotime($exam['start_date'])) {
        return false;
    }
    if (!empty($exam['end_date']) && $ts > strtotime($exam['end_date'])) {
        return false;
    }
    return true;
}

function user_is_assigned(array $user, int $examId): bool
{
    $total = (int) q_val('SELECT COUNT(*) FROM exam_assignments WHERE exam_id = ?', [$examId]);
    if ($total === 0) {
        return true; // tanpa assignment = terbuka untuk semua user
    }
    return (int) q_val(
        'SELECT COUNT(*) FROM exam_assignments
          WHERE exam_id = ? AND (user_id = ? OR (department IS NOT NULL AND department = ?))',
        [$examId, $user['id'], (string) ($user['department'] ?? '')]
    ) > 0;
}

/**
 * Daftar exam published yang boleh diakses user beserta status attempt-nya.
 * TIDAK mengandung field score.
 */
function user_exam_list(array $user): array
{
    // Modul yang dinonaktifkan admin tidak pernah ditampilkan ke peserta
    $types = enabled_exam_types();
    if (!$types) {
        return [];
    }
    $exams = q_all(
        "SELECT e.id, e.title, e.description, e.type, e.duration, e.max_attempts,
                e.start_date, e.end_date, e.status, e.question_count,
                (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id) AS pool_count
           FROM exams e
          WHERE e.status = 'published'
            AND e.type IN (" . in_placeholders($types) . ")
            AND (
                NOT EXISTS (SELECT 1 FROM exam_assignments a WHERE a.exam_id = e.id)
                OR EXISTS (SELECT 1 FROM exam_assignments a
                            WHERE a.exam_id = e.id
                              AND (a.user_id = ? OR (a.department IS NOT NULL AND a.department = ?)))
            )
          ORDER BY e.type = 'test', e.start_date IS NULL, e.start_date, e.id DESC",
        array_merge($types, [$user['id'], (string) ($user['department'] ?? '')])
    );
    if (!$exams) {
        return [];
    }
    $ids = array_column($exams, 'id');
    $stats = [];
    foreach (q_all(
        'SELECT exam_id,
                SUM(status <> \'in_progress\') AS done,
                MAX(CASE WHEN status = \'in_progress\' THEN id END) AS active_id
           FROM exam_attempts
          WHERE user_id = ? AND exam_id IN (' . in_placeholders($ids) . ')
          GROUP BY exam_id',
        array_merge([$user['id']], $ids)
    ) as $r) {
        $stats[(int) $r['exam_id']] = $r;
    }
    $now = time();
    foreach ($exams as &$e) {
        $s = $stats[(int) $e['id']] ?? ['done' => 0, 'active_id' => null];
        $e['questions_total'] = (int) $e['question_count'] > 0
            ? min((int) $e['question_count'], (int) $e['pool_count'])
            : (int) $e['pool_count'];
        $e['attempts_done'] = (int) $s['done'];
        $e['active_attempt_id'] = $s['active_id'] ? (int) $s['active_id'] : null;
        $e['is_open'] = exam_is_open($e, $now);
        $e['not_started'] = !empty($e['start_date']) && $now < strtotime($e['start_date']);
        $e['can_start'] = $e['is_open'] && $e['questions_total'] > 0
            && ($e['active_attempt_id'] !== null || $e['attempts_done'] < (int) $e['max_attempts']);
        unset($e['question_count'], $e['pool_count']);
    }
    unset($e);
    return $exams;
}

/* ------------------------------------------------------------------ */
/*  Membuat attempt                                                    */
/* ------------------------------------------------------------------ */

/**
 * Memulai (atau melanjutkan) attempt. Mengembalikan attempt_id.
 * @throws RuntimeException pesan ramah untuk user
 */
function start_attempt(array $user, int $examId): int
{
    finalize_expired_attempts((int) $user['id']);

    $pdo = db();
    $pdo->beginTransaction();
    try {
        // Serialisasi per user agar tidak tercipta 2 attempt bersamaan
        q('SELECT id FROM users WHERE id = ? FOR UPDATE', [$user['id']]);

        $exam = q_row('SELECT * FROM exams WHERE id = ?', [$examId]);
        if (!$exam || !exam_is_open($exam)) {
            throw new RuntimeException('Ujian tidak tersedia atau di luar jadwal.');
        }
        if (!exam_type_enabled($exam['type'])) {
            throw new RuntimeException(($exam['type'] === 'test' ? 'Test' : 'Pre-Test') . ' sedang dinonaktifkan oleh administrator.');
        }
        if (!user_is_assigned($user, $examId)) {
            throw new RuntimeException('Anda tidak terdaftar pada ujian ini.');
        }

        $active = q_val(
            "SELECT id FROM exam_attempts WHERE user_id = ? AND exam_id = ? AND status = 'in_progress' LIMIT 1",
            [$user['id'], $examId]
        );
        if ($active) {
            $pdo->commit();
            return (int) $active;
        }

        $done = (int) q_val(
            "SELECT COUNT(*) FROM exam_attempts WHERE user_id = ? AND exam_id = ? AND status <> 'in_progress'",
            [$user['id'], $examId]
        );
        if ($done >= (int) $exam['max_attempts']) {
            throw new RuntimeException('Batas percobaan untuk ujian ini sudah habis.');
        }

        $pool = q_all(
            'SELECT q.id, q.points, q.question_type
               FROM exam_questions eq JOIN questions q ON q.id = eq.question_id
              WHERE eq.exam_id = ?
              ORDER BY eq.question_order, eq.id',
            [$examId]
        );
        if (!$pool) {
            throw new RuntimeException('Ujian belum memiliki soal.');
        }
        if ((int) $exam['random_question'] === 1) {
            shuffle($pool);
        }
        $limit = (int) $exam['question_count'];
        if ($limit > 0 && $limit < count($pool)) {
            $pool = array_slice($pool, 0, $limit);
        }

        $nowTs = time();
        $deadlineTs = $nowTs + (int) $exam['duration'] * 60;
        if (!empty($exam['end_date'])) {
            $deadlineTs = min($deadlineTs, strtotime($exam['end_date']));
        }

        q(
            'INSERT INTO exam_attempts (user_id, exam_id, started_at, deadline_at, total_questions, status, ip_address, user_agent, created_at)
             VALUES (?, ?, ?, ?, ?, \'in_progress\', ?, ?, ?)',
            [
                $user['id'], $examId, date('Y-m-d H:i:s', $nowTs), date('Y-m-d H:i:s', $deadlineTs),
                count($pool), client_ip(), substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
                date('Y-m-d H:i:s', $nowTs),
            ]
        );
        $attemptId = (int) $pdo->lastInsertId();

        // Snapshot soal yang diberikan + urutan opsi (agar dapat direkonstruksi)
        $ins = $pdo->prepare(
            'INSERT INTO attempt_questions (attempt_id, question_id, question_order, option_order, points) VALUES (?, ?, ?, ?, ?)'
        );
        $order = 1;
        foreach ($pool as $q) {
            $optIds = [];
            if (in_array($q['question_type'], OPTION_BASED_TYPES, true)) {
                $optIds = array_map('intval', array_column(
                    q_all('SELECT id FROM question_options WHERE question_id = ? ORDER BY sort_order, id', [$q['id']]),
                    'id'
                ));
                if ((int) $exam['random_answer'] === 1 && $q['question_type'] !== 'true_false') {
                    shuffle($optIds);
                }
            }
            $ins->execute([$attemptId, $q['id'], $order++, $optIds ? implode(',', $optIds) : null, $q['points']]);
        }

        $pdo->commit();
        log_activity('exam_start', 'Memulai ' . type_label($exam['type']) . ': ' . $exam['title'], (int) $user['id']);
        return $attemptId;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

/* ------------------------------------------------------------------ */
/*  Memuat attempt milik user                                          */
/* ------------------------------------------------------------------ */

/** Attempt + exam milik user tertentu (null jika bukan miliknya). */
function load_user_attempt(int $attemptId, int $userId): ?array
{
    $attempt = q_row('SELECT * FROM exam_attempts WHERE id = ? AND user_id = ?', [$attemptId, $userId]);
    if (!$attempt) {
        return null;
    }
    $exam = q_row('SELECT * FROM exams WHERE id = ?', [$attempt['exam_id']]);
    return $exam ? ['attempt' => $attempt, 'exam' => $exam] : null;
}

function attempt_remaining_seconds(array $attempt): int
{
    return max(0, strtotime($attempt['deadline_at']) - time());
}

function attempt_is_expired(array $attempt, int $grace = 0): bool
{
    return time() > strtotime($attempt['deadline_at']) + $grace;
}

/**
 * Payload soal untuk peserta. TIDAK PERNAH menyertakan is_correct / explanation.
 */
function attempt_questions_for_user(int $attemptId): array
{
    $rows = q_all(
        'SELECT aq.question_id, aq.question_order, aq.option_order, aq.points,
                q.question, q.question_type, q.image
           FROM attempt_questions aq JOIN questions q ON q.id = aq.question_id
          WHERE aq.attempt_id = ?
          ORDER BY aq.question_order',
        [$attemptId]
    );
    if (!$rows) {
        return [];
    }
    $qids = array_column($rows, 'question_id');
    $opts = [];
    foreach (q_all(
        'SELECT id, question_id, option_text FROM question_options WHERE question_id IN (' . in_placeholders($qids) . ')',
        $qids
    ) as $o) {
        $opts[(int) $o['question_id']][(int) $o['id']] = $o['option_text'];
    }
    $answers = [];
    foreach (q_all('SELECT * FROM exam_answers WHERE attempt_id = ?', [$attemptId]) as $a) {
        $answers[(int) $a['question_id']] = $a;
    }

    $out = [];
    foreach ($rows as $r) {
        $qid = (int) $r['question_id'];
        $options = [];
        if ($r['option_order']) {
            foreach (explode(',', $r['option_order']) as $oid) {
                $oid = (int) $oid;
                if (isset($opts[$qid][$oid])) {
                    $options[] = ['id' => $oid, 'text' => $opts[$qid][$oid]];
                }
            }
        }
        $a = $answers[$qid] ?? null;
        $answer = null;
        if ($a) {
            if ($r['question_type'] === 'multiple_answer') {
                $answer = $a['selected_options'] ? array_map('intval', explode(',', $a['selected_options'])) : [];
            } elseif (in_array($r['question_type'], ['short_answer', 'essay'], true)) {
                $answer = (string) $a['answer_text'];
            } else {
                $answer = $a['selected_option_id'] !== null ? (int) $a['selected_option_id'] : null;
            }
        }
        $out[] = [
            'id'      => $qid,
            'no'      => (int) $r['question_order'],
            'type'    => $r['question_type'],
            'text'    => $r['question'],
            'image'   => $r['image'] ? url('uploads/questions/' . $r['image']) : null,
            'points'  => (float) $r['points'],
            'options' => $options,
            'answer'  => $answer,
        ];
    }
    return $out;
}

/* ------------------------------------------------------------------ */
/*  Auto-save jawaban                                                  */
/* ------------------------------------------------------------------ */

/**
 * Simpan / perbarui jawaban satu soal. Validasi kepemilikan opsi dilakukan di sini.
 * @param mixed $value int (single), int[] (multiple), string (text)
 */
function save_answer(array $attempt, int $questionId, $value): void
{
    $aq = q_row(
        'SELECT aq.option_order, q.question_type
           FROM attempt_questions aq JOIN questions q ON q.id = aq.question_id
          WHERE aq.attempt_id = ? AND aq.question_id = ?',
        [$attempt['id'], $questionId]
    );
    if (!$aq) {
        throw new RuntimeException('Soal tidak termasuk dalam ujian ini.');
    }
    $allowed = $aq['option_order'] ? array_map('intval', explode(',', $aq['option_order'])) : [];

    $selected = null;
    $selectedMulti = null;
    $text = null;
    $type = $aq['question_type'];

    if ($type === 'multiple_answer') {
        $ids = array_values(array_unique(array_map('intval', is_array($value) ? $value : [])));
        $ids = array_values(array_intersect($ids, $allowed));
        sort($ids);
        $selectedMulti = $ids ? implode(',', $ids) : null;
    } elseif ($type === 'short_answer' || $type === 'essay') {
        $text = mb_substr(is_scalar($value) ? trim((string) $value) : '', 0, 20000);
        if ($text === '') {
            $text = null;
        }
    } else {
        $id = is_numeric($value) ? (int) $value : 0;
        if ($id !== 0 && !in_array($id, $allowed, true)) {
            throw new RuntimeException('Pilihan jawaban tidak valid.');
        }
        $selected = $id ?: null;
    }

    q(
        'INSERT INTO exam_answers (attempt_id, question_id, selected_option_id, selected_options, answer_text, answered_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE selected_option_id = VALUES(selected_option_id),
                                 selected_options = VALUES(selected_options),
                                 answer_text = VALUES(answer_text),
                                 answered_at = VALUES(answered_at)',
        [$attempt['id'], $questionId, $selected, $selectedMulti, $text, now()]
    );
}

/* ------------------------------------------------------------------ */
/*  Penilaian                                                          */
/* ------------------------------------------------------------------ */

function answer_is_empty(?array $a): bool
{
    if ($a === null) {
        return true;
    }
    return $a['selected_option_id'] === null
        && ($a['selected_options'] === null || $a['selected_options'] === '')
        && trim((string) ($a['answer_text'] ?? '')) === '';
}

function normalize_text(string $s): string
{
    return preg_replace('/\s+/u', ' ', mb_strtolower(trim($s))) ?? '';
}

/**
 * @return array{0: ?int, 1: float} [is_correct (null=pending/kosong), points]
 */
function grade_answer(string $type, float $maxPoints, array $correctOptions, ?array $answer): array
{
    if (answer_is_empty($answer)) {
        return [null, 0.0];
    }
    switch ($type) {
        case 'multiple_choice':
        case 'true_false':
            $ok = in_array((int) $answer['selected_option_id'], array_map('intval', array_column($correctOptions, 'id')), true);
            break;
        case 'multiple_answer':
            $sel = array_map('intval', explode(',', (string) $answer['selected_options']));
            $cor = array_map('intval', array_column($correctOptions, 'id'));
            sort($sel);
            sort($cor);
            $ok = $cor !== [] && $sel === $cor;
            break;
        case 'short_answer':
            $given = normalize_text((string) $answer['answer_text']);
            $ok = false;
            foreach ($correctOptions as $o) {
                if ($given !== '' && normalize_text((string) $o['option_text']) === $given) {
                    $ok = true;
                    break;
                }
            }
            break;
        case 'essay':
        default:
            return [null, 0.0]; // dinilai manual oleh admin
    }
    return [$ok ? 1 : 0, $ok ? $maxPoints : 0.0];
}

/** Hitung ulang total attempt dari exam_answers (dipakai saat submit & grading essay). */
function recalc_attempt_totals(int $attemptId): void
{
    $attempt = q_row('SELECT a.id, e.passing_grade FROM exam_attempts a JOIN exams e ON e.id = a.exam_id WHERE a.id = ?', [$attemptId]);
    if (!$attempt) {
        return;
    }
    $rows = q_all(
        'SELECT aq.points AS max_points, q.question_type,
                ea.id AS answer_id, ea.is_correct, ea.points, ea.selected_option_id, ea.selected_options, ea.answer_text
           FROM attempt_questions aq
           JOIN questions q ON q.id = aq.question_id
      LEFT JOIN exam_answers ea ON ea.attempt_id = aq.attempt_id AND ea.question_id = aq.question_id
          WHERE aq.attempt_id = ?',
        [$attemptId]
    );
    $total = count($rows);
    $correct = $wrong = $unanswered = $pending = 0;
    $earned = $max = 0.0;
    foreach ($rows as $r) {
        $max += (float) $r['max_points'];
        $ans = $r['answer_id'] ? $r : null;
        if (answer_is_empty($ans)) {
            $unanswered++;
            continue;
        }
        if ($r['is_correct'] === null) {
            $pending++;
            continue;
        }
        $earned += (float) $r['points'];
        if ((int) $r['is_correct'] === 1) {
            $correct++;
        } else {
            $wrong++;
        }
    }
    $score = $max > 0 ? round($earned / $max * 100, 2) : 0.0;
    $pct = $total > 0 ? round($correct / $total * 100, 2) : 0.0;
    q(
        'UPDATE exam_attempts
            SET total_questions = ?, correct_answers = ?, wrong_answers = ?, unanswered = ?, pending_review = ?,
                total_points = ?, max_points = ?, score = ?, percentage = ?, passed = ?
          WHERE id = ?',
        [$total, $correct, $wrong, $unanswered, $pending, $earned, $max, $score, $pct,
         $score >= (float) $attempt['passing_grade'] ? 1 : 0, $attemptId]
    );
}

/**
 * Finalisasi attempt: nilai semua jawaban, hitung score, simpan ke MySQL.
 * Idempoten — aman dipanggil berulang (submit ganda / timeout bersamaan).
 * @return bool true jika attempt baru saja difinalisasi oleh panggilan ini
 */
function finalize_attempt(int $attemptId, string $status = 'submitted'): bool
{
    $pdo = db();
    $ownTx = !$pdo->inTransaction();
    if ($ownTx) {
        $pdo->beginTransaction();
    }
    try {
        $attempt = q_row('SELECT * FROM exam_attempts WHERE id = ? FOR UPDATE', [$attemptId]);
        if (!$attempt || $attempt['status'] !== 'in_progress') {
            if ($ownTx) {
                $pdo->commit();
            }
            return false;
        }

        $rows = q_all(
            'SELECT aq.question_id, aq.points AS max_points, q.question_type
               FROM attempt_questions aq JOIN questions q ON q.id = aq.question_id
              WHERE aq.attempt_id = ?',
            [$attemptId]
        );
        $qids = array_column($rows, 'question_id');
        $correctMap = [];
        if ($qids) {
            foreach (q_all(
                'SELECT id, question_id, option_text FROM question_options
                  WHERE is_correct = 1 AND question_id IN (' . in_placeholders($qids) . ')',
                $qids
            ) as $o) {
                $correctMap[(int) $o['question_id']][] = $o;
            }
        }
        $answers = [];
        foreach (q_all('SELECT * FROM exam_answers WHERE attempt_id = ?', [$attemptId]) as $a) {
            $answers[(int) $a['question_id']] = $a;
        }

        $upd = $pdo->prepare('UPDATE exam_answers SET is_correct = ?, points = ? WHERE id = ?');
        foreach ($rows as $r) {
            $qid = (int) $r['question_id'];
            $ans = $answers[$qid] ?? null;
            if ($ans === null) {
                continue;
            }
            [$isCorrect, $points] = grade_answer($r['question_type'], (float) $r['max_points'], $correctMap[$qid] ?? [], $ans);
            $upd->execute([$isCorrect, $points, $ans['id']]);
        }

        $nowTs = time();
        $deadlineTs = strtotime($attempt['deadline_at']);
        $endTs = min($nowTs, $deadlineTs);
        $duration = max(0, $endTs - strtotime($attempt['started_at']));
        q(
            'UPDATE exam_attempts SET status = ?, submitted_at = ?, duration = ? WHERE id = ?',
            [$status, date('Y-m-d H:i:s', $nowTs > $deadlineTs ? $deadlineTs : $nowTs), $duration, $attemptId]
        );
        recalc_attempt_totals($attemptId);

        if ($ownTx) {
            $pdo->commit();
        }
        $title = (string) q_val('SELECT title FROM exams WHERE id = ?', [$attempt['exam_id']]);
        log_activity($status === 'auto_submitted' ? 'exam_auto_submit' : 'exam_submit',
            ($status === 'auto_submitted' ? 'Waktu habis, dikirim otomatis: ' : 'Mengirim jawaban: ') . $title, (int) $attempt['user_id']);
        return true;
    } catch (Throwable $e) {
        if ($ownTx && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

/**
 * Pengganti cron di shared hosting: finalisasi attempt yang waktunya habis.
 * Dipanggil saat user membuka dashboard/ujian dan saat admin membuka hasil.
 */
function finalize_expired_attempts(?int $userId = null): int
{
    $limit = date('Y-m-d H:i:s', time() - EXAM_GRACE_SECONDS);
    $sql = "SELECT id FROM exam_attempts WHERE status = 'in_progress' AND deadline_at < ?";
    $params = [$limit];
    if ($userId !== null) {
        $sql .= ' AND user_id = ?';
        $params[] = $userId;
    }
    $n = 0;
    foreach (q_all($sql . ' LIMIT 200', $params) as $r) {
        if (finalize_attempt((int) $r['id'], 'auto_submitted')) {
            $n++;
        }
    }
    return $n;
}

/** URL halaman hasil sesuai kebijakan visibilitas. */
function attempt_result_url(array $attempt, array $exam): string
{
    return exam_user_can_view_score($exam)
        ? 'pretest-result.php?attempt=' . (int) $attempt['id']
        : 'test-submitted.php?attempt=' . (int) $attempt['id'];
}

/**
 * Riwayat ujian user. Score, benar/salah, dan status lulus DI-NULL-KAN
 * langsung di SQL untuk exam yang tidak mengizinkan peserta melihat hasil
 * (semua Test resmi), sehingga nilai tidak pernah keluar dari database.
 */
function user_history(int $userId, int $limit = 0): array
{
    $visible = "(e.type = 'pretest' AND e.show_result = 1)";
    $sql = "SELECT a.id, a.exam_id, a.status, a.started_at, a.submitted_at,
                   e.title, e.type,
                   CASE WHEN $visible THEN 1 ELSE 0 END AS result_visible,
                   CASE WHEN $visible THEN a.score END           AS score,
                   CASE WHEN $visible THEN a.correct_answers END AS correct_answers,
                   CASE WHEN $visible THEN a.wrong_answers END   AS wrong_answers,
                   CASE WHEN $visible THEN a.unanswered END      AS unanswered,
                   CASE WHEN $visible THEN a.passed END          AS passed,
                   CASE WHEN $visible THEN a.pending_review END  AS pending_review,
                   CASE WHEN $visible THEN e.passing_grade END   AS passing_grade,
                   CASE WHEN $visible AND e.show_correct_answer = 1 THEN 1 ELSE 0 END AS review_available
              FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
             WHERE a.user_id = ? AND a.status <> 'in_progress'
             ORDER BY a.submitted_at DESC, a.id DESC";
    if ($limit > 0) {
        $sql .= ' LIMIT ' . (int) $limit;
    }
    return q_all($sql, [$userId]);
}

/**
 * Detail per soal sebuah attempt (termasuk kunci jawaban).
 * HANYA boleh dipanggil oleh halaman admin, atau halaman pembahasan setelah
 * exam_user_can_view_review() bernilai true.
 */
function attempt_detail_rows(int $attemptId): array
{
    $rows = q_all(
        'SELECT aq.question_id, aq.question_order, aq.option_order, aq.points AS max_points,
                q.question, q.question_type, q.explanation, q.image,
                ea.id AS answer_id, ea.selected_option_id, ea.selected_options, ea.answer_text,
                ea.is_correct, ea.points, ea.answered_at
           FROM attempt_questions aq
           JOIN questions q ON q.id = aq.question_id
      LEFT JOIN exam_answers ea ON ea.attempt_id = aq.attempt_id AND ea.question_id = aq.question_id
          WHERE aq.attempt_id = ?
          ORDER BY aq.question_order',
        [$attemptId]
    );
    if (!$rows) {
        return [];
    }
    $qids = array_column($rows, 'question_id');
    $opts = [];
    foreach (q_all(
        'SELECT id, question_id, option_text, is_correct FROM question_options
          WHERE question_id IN (' . in_placeholders($qids) . ') ORDER BY sort_order, id',
        $qids
    ) as $o) {
        $opts[(int) $o['question_id']][(int) $o['id']] = $o;
    }
    $letters = range('A', 'Z');
    $out = [];
    foreach ($rows as $r) {
        $qid = (int) $r['question_id'];
        $order = $r['option_order'] ? array_map('intval', explode(',', $r['option_order'])) : array_keys($opts[$qid] ?? []);
        $selected = [];
        if ($r['selected_option_id'] !== null) {
            $selected[] = (int) $r['selected_option_id'];
        }
        if (!empty($r['selected_options'])) {
            $selected = array_map('intval', explode(',', $r['selected_options']));
        }
        $options = [];
        $userLetters = [];
        $correctLetters = [];
        $i = 0;
        foreach ($order as $oid) {
            if (!isset($opts[$qid][$oid])) {
                continue;
            }
            $o = $opts[$qid][$oid];
            $letter = $letters[$i++] ?? '?';
            $isSel = in_array($oid, $selected, true);
            if ($isSel) {
                $userLetters[] = $letter;
            }
            if ((int) $o['is_correct'] === 1) {
                $correctLetters[] = $letter;
            }
            $options[] = ['id' => $oid, 'letter' => $letter, 'text' => $o['option_text'], 'is_correct' => (int) $o['is_correct'] === 1, 'selected' => $isSel];
        }
        $isText = in_array($r['question_type'], ['short_answer', 'essay'], true);
        $empty = answer_is_empty($r['answer_id'] ? $r : null);
        if ($empty) {
            $state = 'unanswered';
        } elseif ($r['is_correct'] === null) {
            $state = 'pending';
        } else {
            $state = (int) $r['is_correct'] === 1 ? 'correct' : 'wrong';
        }
        $acceptedText = $r['question_type'] === 'short_answer'
            ? implode(' / ', array_column(array_filter($opts[$qid] ?? [], fn ($o) => (int) $o['is_correct'] === 1), 'option_text'))
            : '';
        $out[] = [
            'question_id'   => $qid,
            'no'            => (int) $r['question_order'],
            'type'          => $r['question_type'],
            'question'      => $r['question'],
            'image'         => $r['image'],
            'explanation'   => $r['explanation'],
            'options'       => $isText ? [] : $options,
            'user_answer'   => $empty ? '—' : ($isText ? (string) $r['answer_text'] : implode(', ', $userLetters)),
            'correct_answer'=> $r['question_type'] === 'essay' ? '(dinilai manual)' : ($isText ? $acceptedText : implode(', ', $correctLetters)),
            'state'         => $state,
            'points'        => (float) $r['points'],
            'max_points'    => (float) $r['max_points'],
            'answer_id'     => $r['answer_id'] ? (int) $r['answer_id'] : null,
        ];
    }
    return $out;
}

function state_label(string $state): array
{
    return [
        'correct'    => ['BENAR', 'bs-green'],
        'wrong'      => ['SALAH', 'bs-red'],
        'pending'    => ['MENUNGGU PENILAIAN', 'bs-amber'],
        'unanswered' => ['TIDAK DIJAWAB', 'bs-gray'],
    ][$state] ?? [$state, 'bs-gray'];
}
