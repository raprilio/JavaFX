<?php
/**
 * GET  action=list|get
 * POST action=save|set_questions|set_assignments|set_status|delete
 */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$action = admin_action() ?: 'list';

if ($action === 'list') {
    $w = ['1=1'];
    $p = [];
    if (in_array(get_str('type'), ['pretest', 'test'], true)) { $w[] = 'e.type = ?'; $p[] = get_str('type'); }
    if (in_array(get_str('status'), ['draft', 'published', 'closed'], true)) { $w[] = 'e.status = ?'; $p[] = get_str('status'); }
    if (($s = get_str('q')) !== '') { $w[] = 'e.title LIKE ?'; $p[] = "%$s%"; }
    $rows = q_all(
        'SELECT e.*,
                (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id) AS pool_count,
                (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id AND a.status <> \'in_progress\') AS submissions,
                (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id AND a.status = \'in_progress\') AS in_progress,
                (SELECT COUNT(*) FROM exam_assignments s WHERE s.exam_id = e.id) AS assignments
           FROM exams e WHERE ' . implode(' AND ', $w) . ' ORDER BY e.id DESC',
        $p
    );
    json_out(['ok' => true, 'data' => $rows]);
}

if ($action === 'get') {
    $e = q_row('SELECT * FROM exams WHERE id = ?', [get_int('id')]);
    if (!$e) {
        json_error('Ujian tidak ditemukan.', 404);
    }
    $e['question_ids'] = array_map('intval', array_column(q_all('SELECT question_id FROM exam_questions WHERE exam_id = ? ORDER BY question_order, id', [$e['id']]), 'question_id'));
    $e['assigned_users'] = array_map('intval', array_column(q_all('SELECT user_id FROM exam_assignments WHERE exam_id = ? AND user_id IS NOT NULL', [$e['id']]), 'user_id'));
    $e['assigned_departments'] = array_column(q_all('SELECT department FROM exam_assignments WHERE exam_id = ? AND department IS NOT NULL', [$e['id']]), 'department');
    json_out(['ok' => true, 'data' => $e]);
}

require_method('POST');
verify_csrf();

switch ($action) {
    case 'save':
        $id = in_int('id');
        if ($id && !q_val('SELECT id FROM exams WHERE id = ?', [$id])) {
            json_error('Ujian tidak ditemukan.', 404);
        }
        $d = [
            'title'               => mb_substr(in_str('title'), 0, 200),
            'description'         => in_str('description') ?: null,
            'instructions'        => in_str('instructions') ?: null,
            'type'                => in_str('type') === 'test' ? 'test' : 'pretest',
            'duration'            => max(1, min(1440, in_int('duration', 60))),
            'passing_grade'       => max(0, min(100, (float) str_replace(',', '.', in_str('passing_grade', '70')))),
            'show_result'         => in_int('show_result') ? 1 : 0,
            'show_correct_answer' => in_int('show_correct_answer') ? 1 : 0,
            'random_question'     => in_int('random_question') ? 1 : 0,
            'random_answer'       => in_int('random_answer') ? 1 : 0,
            'question_count'      => max(0, in_int('question_count')),
            'max_attempts'        => max(1, min(100, in_int('max_attempts', 1))),
            'start_date'          => parse_datetime_local(in_str('start_date')),
            'end_date'            => parse_datetime_local(in_str('end_date')),
            'status'              => in_array(in_str('status'), ['draft', 'published', 'closed'], true) ? in_str('status') : 'draft',
        ];
        if ($d['title'] === '') {
            json_error('Judul ujian wajib diisi.', 422);
        }
        if ($d['start_date'] && $d['end_date'] && strtotime($d['end_date']) <= strtotime($d['start_date'])) {
            json_error('Tanggal selesai harus setelah tanggal mulai.', 422);
        }
        // KEBIJAKAN: Test resmi tidak pernah menampilkan hasil ke peserta
        $d = exam_enforce_policy($d);

        $cols = array_keys($d);
        if ($id) {
            q('UPDATE exams SET ' . implode(', ', array_map(fn ($c) => "$c = ?", $cols)) . ' WHERE id = ?', array_merge(array_values($d), [$id]));
        } else {
            $cols[] = 'created_by';
            $cols[] = 'created_at';
            q('INSERT INTO exams (' . implode(', ', $cols) . ') VALUES (' . in_placeholders($cols) . ')',
                array_merge(array_values($d), [current_user()['id'], now()]));
            $id = (int) db()->lastInsertId();
        }
        json_out(['ok' => true, 'id' => $id, 'message' => 'Pengaturan ujian disimpan.'
            . ($d['type'] === 'test' ? ' (Test: hasil otomatis disembunyikan dari peserta.)' : '')]);

    case 'set_questions':
        $id = in_int('exam_id');
        if (!q_val('SELECT id FROM exams WHERE id = ?', [$id])) {
            json_error('Ujian tidak ditemukan.', 404);
        }
        $qids = array_values(array_unique(array_filter(array_map('intval', (array) (input()['question_ids'] ?? [])))));
        $pdo = db();
        $pdo->beginTransaction();
        q('DELETE FROM exam_questions WHERE exam_id = ?', [$id]);
        $ins = $pdo->prepare('INSERT INTO exam_questions (exam_id, question_id, question_order) SELECT ?, id, ? FROM questions WHERE id = ?');
        foreach ($qids as $i => $qid) {
            $ins->execute([$id, $i + 1, $qid]);
        }
        $pdo->commit();
        json_out(['ok' => true, 'message' => count($qids) . ' soal ditetapkan ke ujian.']);

    case 'set_assignments':
        $id = in_int('exam_id');
        if (!q_val('SELECT id FROM exams WHERE id = ?', [$id])) {
            json_error('Ujian tidak ditemukan.', 404);
        }
        $users = array_values(array_unique(array_filter(array_map('intval', (array) (input()['user_ids'] ?? [])))));
        $depts = array_values(array_unique(array_filter(array_map(fn ($d) => mb_substr(trim((string) $d), 0, 100), (array) (input()['departments'] ?? [])))));
        $pdo = db();
        $pdo->beginTransaction();
        q('DELETE FROM exam_assignments WHERE exam_id = ?', [$id]);
        foreach ($users as $uid) {
            q('INSERT INTO exam_assignments (exam_id, user_id, created_at) SELECT ?, id, ? FROM users WHERE id = ?', [$id, now(), $uid]);
        }
        foreach ($depts as $dep) {
            q('INSERT INTO exam_assignments (exam_id, department, created_at) VALUES (?, ?, ?)', [$id, $dep, now()]);
        }
        $pdo->commit();
        json_out(['ok' => true, 'message' => ($users || $depts) ? 'Assignment disimpan.' : 'Assignment dikosongkan — ujian terbuka untuk semua peserta.']);

    case 'set_status':
        $status = in_str('status');
        if (!in_array($status, ['draft', 'published', 'closed'], true)) {
            json_error('Status tidak valid.', 422);
        }
        q('UPDATE exams SET status = ? WHERE id = ?', [$status, in_int('id')]);
        json_out(['ok' => true, 'message' => 'Status ujian diperbarui.']);

    case 'delete':
        $id = in_int('id');
        if (q_val('SELECT 1 FROM exam_attempts WHERE exam_id = ? LIMIT 1', [$id])) {
            json_error('Ujian sudah memiliki hasil peserta. Ubah status menjadi "Closed" alih-alih menghapus.', 409);
        }
        q('DELETE FROM exams WHERE id = ?', [$id]);
        json_out(['ok' => true, 'message' => 'Ujian dihapus.']);

    default:
        json_error('Aksi tidak dikenal.');
}
