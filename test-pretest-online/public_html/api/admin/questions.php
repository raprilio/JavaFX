<?php
/**
 * Question bank.
 * GET  action=list|get|categories
 * POST action=save|delete|category_save|category_delete
 */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

function question_is_used(int $id): bool
{
    return (bool) q_val('SELECT 1 FROM attempt_questions WHERE question_id = ? LIMIT 1', [$id]);
}

function handle_image_upload(): ?string
{
    if (empty($_FILES['image']['tmp_name']) || ($_FILES['image']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return null;
    }
    $f = $_FILES['image'];
    if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) {
        json_error('Upload gambar gagal.', 422);
    }
    if ($f['size'] > UPLOAD_MAX_BYTES) {
        json_error('Ukuran gambar maksimal ' . (UPLOAD_MAX_BYTES / 1048576) . ' MB.', 422);
    }
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
    $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'][$mime] ?? null;
    if (!$ext || @getimagesize($f['tmp_name']) === false) {
        json_error('Format gambar harus JPG, PNG, WEBP, atau GIF.', 422);
    }
    $dir = APP_ROOT . '/uploads/questions';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $name = bin2hex(random_bytes(16)) . '.' . $ext;
    if (!move_uploaded_file($f['tmp_name'], "$dir/$name")) {
        json_error('Gagal menyimpan gambar.', 500);
    }
    return $name;
}

function delete_image(?string $name): void
{
    if ($name && preg_match('/^[a-f0-9]{32}\.(jpg|png|webp|gif)$/', $name)) {
        @unlink(APP_ROOT . '/uploads/questions/' . $name);
    }
}

$action = admin_action() ?: 'list';

/* ------------------------------- GET ------------------------------- */
if ($action === 'categories') {
    json_out(['ok' => true, 'data' => q_all(
        'SELECT c.id, c.name, c.description, COUNT(q.id) AS questions
           FROM categories c LEFT JOIN questions q ON q.category_id = c.id
          GROUP BY c.id, c.name, c.description ORDER BY c.name'
    )]);
}

if ($action === 'get') {
    $q = q_row('SELECT * FROM questions WHERE id = ?', [get_int('id')]);
    if (!$q) {
        json_error('Soal tidak ditemukan.', 404);
    }
    $q['options'] = q_all('SELECT id, option_text, is_correct FROM question_options WHERE question_id = ? ORDER BY sort_order, id', [$q['id']]);
    $q['used'] = question_is_used((int) $q['id']);
    $q['image_url'] = $q['image'] ? url('uploads/questions/' . $q['image']) : null;
    json_out(['ok' => true, 'data' => $q]);
}

if ($action === 'list') {
    $w = ['1=1'];
    $p = [];
    if (($s = get_str('q')) !== '') { $w[] = 'q.question LIKE ?'; $p[] = "%$s%"; }
    if (get_int('category_id') > 0) { $w[] = 'q.category_id = ?'; $p[] = get_int('category_id'); }
    if (get_str('category_id') === 'none') { $w[] = 'q.category_id IS NULL'; }
    if (in_array(get_str('type'), QUESTION_TYPES, true)) { $w[] = 'q.question_type = ?'; $p[] = get_str('type'); }
    if (in_array(get_str('difficulty'), ['easy', 'medium', 'hard'], true)) { $w[] = 'q.difficulty = ?'; $p[] = get_str('difficulty'); }
    $where = implode(' AND ', $w);
    $all = get_str('all') === '1';
    $per = 20;
    $page = max(1, get_int('page', 1));
    $total = (int) q_val("SELECT COUNT(*) FROM questions q WHERE $where", $p);
    $sql = "SELECT q.id, q.question, q.question_type, q.difficulty, q.points, q.category_id, c.name AS category,
                   (SELECT COUNT(*) FROM question_options o WHERE o.question_id = q.id) AS options,
                   EXISTS(SELECT 1 FROM attempt_questions aq WHERE aq.question_id = q.id) AS used
              FROM questions q LEFT JOIN categories c ON c.id = q.category_id
             WHERE $where ORDER BY q.id DESC";
    if (!$all) {
        $sql .= " LIMIT $per OFFSET " . (($page - 1) * $per);
    }
    json_out(['ok' => true, 'data' => q_all($sql, $p), 'total' => $total, 'page' => $page, 'pages' => $all ? 1 : (int) ceil($total / $per)]);
}

/* ------------------------------- POST ------------------------------ */
require_method('POST');
verify_csrf();

switch ($action) {
    case 'save':
        $id = in_int('id');
        $existing = $id ? q_row('SELECT * FROM questions WHERE id = ?', [$id]) : null;
        if ($id && !$existing) {
            json_error('Soal tidak ditemukan.', 404);
        }
        $used = $existing ? question_is_used($id) : false;

        $text = in_str('question');
        $type = in_str('question_type');
        $difficulty = in_str('difficulty', 'medium');
        $points = (float) str_replace(',', '.', in_str('points', '1'));
        $categoryId = in_int('category_id') ?: null;
        $explanation = in_str('explanation');
        $options = json_decode(in_str('options', '[]'), true);
        $options = is_array($options) ? $options : [];

        if ($text === '') {
            json_error('Teks pertanyaan wajib diisi.', 422);
        }
        if (!in_array($type, QUESTION_TYPES, true)) {
            json_error('Tipe soal tidak valid.', 422);
        }
        if (!in_array($difficulty, ['easy', 'medium', 'hard'], true)) {
            $difficulty = 'medium';
        }
        if ($points <= 0 || $points > 1000) {
            json_error('Point harus lebih dari 0.', 422);
        }
        if ($categoryId && !q_val('SELECT id FROM categories WHERE id = ?', [$categoryId])) {
            $categoryId = null;
        }

        // Normalisasi opsi
        $clean = [];
        foreach ($options as $o) {
            $t = trim((string) ($o['text'] ?? ''));
            if ($t === '') {
                continue;
            }
            $clean[] = ['id' => (int) ($o['id'] ?? 0), 'text' => mb_substr($t, 0, 5000), 'is_correct' => !empty($o['is_correct']) ? 1 : 0];
        }
        if ($used) {
            // Soal sudah dipakai: struktur jawaban dikunci demi integritas hasil
            $type = $existing['question_type'];
            $points = (float) $existing['points'];
        } else {
            $correctCount = count(array_filter($clean, fn ($o) => $o['is_correct']));
            if ($type === 'true_false') {
                if (count($clean) !== 2 || $correctCount !== 1) {
                    json_error('True/False harus memiliki tepat 1 jawaban benar.', 422);
                }
            } elseif ($type === 'multiple_choice') {
                if (count($clean) < 2 || $correctCount !== 1) {
                    json_error('Multiple Choice minimal 2 opsi dengan tepat 1 jawaban benar.', 422);
                }
            } elseif ($type === 'multiple_answer') {
                if (count($clean) < 2 || $correctCount < 1) {
                    json_error('Multiple Answer minimal 2 opsi dan 1 jawaban benar.', 422);
                }
            } elseif ($type === 'short_answer') {
                $clean = array_map(fn ($o) => ['is_correct' => 1] + $o, $clean);
                if (!$clean) {
                    json_error('Short Answer membutuhkan minimal 1 jawaban yang diterima.', 422);
                }
            } else {
                $clean = [];
            }
        }

        $pdo = db();
        $pdo->beginTransaction();
        $newImage = handle_image_upload();
        $image = $existing['image'] ?? null;
        if ($newImage || in_str('remove_image') === '1') {
            $oldImage = $image;
            $image = $newImage;
        }

        if ($existing) {
            q('UPDATE questions SET category_id = ?, question = ?, question_type = ?, difficulty = ?, points = ?, explanation = ?, image = ? WHERE id = ?',
                [$categoryId, $text, $type, $difficulty, $points, $explanation ?: null, $image, $id]);
        } else {
            q('INSERT INTO questions (category_id, question, question_type, difficulty, points, explanation, image, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$categoryId, $text, $type, $difficulty, $points, $explanation ?: null, $image, current_user()['id'], now()]);
            $id = (int) $pdo->lastInsertId();
        }

        $currentIds = array_map('intval', array_column(q_all('SELECT id FROM question_options WHERE question_id = ?', [$id]), 'id'));
        if ($used) {
            foreach ($clean as $o) {
                if (in_array($o['id'], $currentIds, true)) {
                    q('UPDATE question_options SET option_text = ? WHERE id = ? AND question_id = ?', [$o['text'], $o['id'], $id]);
                }
            }
        } else {
            $keep = [];
            foreach (array_values($clean) as $i => $o) {
                if ($o['id'] && in_array($o['id'], $currentIds, true)) {
                    q('UPDATE question_options SET option_text = ?, is_correct = ?, sort_order = ? WHERE id = ?', [$o['text'], $o['is_correct'], $i, $o['id']]);
                    $keep[] = $o['id'];
                } else {
                    q('INSERT INTO question_options (question_id, option_text, is_correct, sort_order, created_at) VALUES (?, ?, ?, ?, ?)', [$id, $o['text'], $o['is_correct'], $i, now()]);
                }
            }
            $remove = array_diff($currentIds, $keep);
            if ($remove) {
                q('DELETE FROM question_options WHERE id IN (' . in_placeholders($remove) . ')', array_values($remove));
            }
        }
        $pdo->commit();
        if (!empty($oldImage)) {
            delete_image($oldImage);
        }
        log_activity('question', ($existing ? 'Memperbarui' : 'Membuat') . ' soal #' . $id);
        json_out(['ok' => true, 'id' => $id, 'message' => $used
            ? 'Soal diperbarui. Tipe, point, dan kunci jawaban dikunci karena soal sudah dipakai dalam ujian.'
            : 'Soal berhasil disimpan.']);

    case 'delete':
        $id = in_int('id');
        if (question_is_used($id)) {
            json_error('Soal sudah digunakan dalam hasil ujian sehingga tidak dapat dihapus (dibutuhkan untuk rekonstruksi hasil).', 409);
        }
        $img = q_val('SELECT image FROM questions WHERE id = ?', [$id]);
        q('DELETE FROM questions WHERE id = ?', [$id]);
        delete_image($img ?: null);
        log_activity('question', 'Menghapus soal #' . $id);
        json_out(['ok' => true, 'message' => 'Soal dihapus.']);

    case 'import':
        if (empty($_FILES['file']['tmp_name']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
            json_error('File CSV belum dipilih.', 422);
        }
        if ($_FILES['file']['size'] > 5 * 1024 * 1024) {
            json_error('Ukuran file maksimal 5 MB.', 422);
        }
        $fh = fopen($_FILES['file']['tmp_name'], 'r');
        $first = (string) fgets($fh);
        $delim = substr_count($first, ';') > substr_count($first, ',') ? ';' : ',';
        rewind($fh);
        $header = fgetcsv($fh, 0, $delim);
        if (!$header) {
            json_error('File CSV kosong.', 422);
        }
        $header = array_map(fn ($h) => strtolower(trim(preg_replace('/^\xEF\xBB\xBF/', '', (string) $h))), $header);
        foreach (['question_type', 'question', 'correct'] as $req) {
            if (!in_array($req, $header, true)) {
                json_error("Kolom wajib '$req' tidak ditemukan. Gunakan template CSV.", 422);
            }
        }
        $typeMap = ['mc' => 'multiple_choice', 'pg' => 'multiple_choice', 'multiple_choice' => 'multiple_choice', 'pilihan_ganda' => 'multiple_choice',
                    'ma' => 'multiple_answer', 'multiple_answer' => 'multiple_answer', 'pilihan_ganda_kompleks' => 'multiple_answer',
                    'tf' => 'true_false', 'true_false' => 'true_false', 'benar_salah' => 'true_false',
                    'short' => 'short_answer', 'short_answer' => 'short_answer', 'isian' => 'short_answer',
                    'essay' => 'essay', 'esai' => 'essay', 'uraian' => 'essay'];
        $diffMap = ['easy' => 'easy', 'mudah' => 'easy', 'medium' => 'medium', 'sedang' => 'medium', 'hard' => 'hard', 'sulit' => 'hard'];
        $catCache = [];
        foreach (q_all('SELECT id, name FROM categories') as $c) {
            $catCache[mb_strtolower($c['name'])] = (int) $c['id'];
        }
        $created = 0;
        $errors = [];
        $line = 1;
        $pdo = db();
        $pdo->beginTransaction();
        while (($row = fgetcsv($fh, 0, $delim)) !== false) {
            $line++;
            if (count(array_filter($row, fn ($v) => trim((string) $v) !== '')) === 0) {
                continue;
            }
            $r = array_combine($header, array_pad(array_slice($row, 0, count($header)), count($header), ''));
            $r = array_map(fn ($v) => trim((string) $v), $r);
            $type = $typeMap[strtolower(str_replace([' ', '-'], '_', $r['question_type']))] ?? null;
            if (!$type) {
                $errors[] = "Baris $line: question_type tidak dikenal";
                continue;
            }
            if ($r['question'] === '') {
                $errors[] = "Baris $line: pertanyaan kosong";
                continue;
            }
            $opts = [];
            foreach (['option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'option_f'] as $i => $col) {
                if (($r[$col] ?? '') !== '') {
                    $opts[chr(65 + $i)] = $r[$col];
                }
            }
            $correctRaw = strtoupper($r['correct']);
            $options = [];
            if ($type === 'multiple_choice' || $type === 'multiple_answer') {
                $letters = array_values(array_unique(array_filter(preg_split('/[\s,;|]+|(?<=[A-F])(?=[A-F])/', $correctRaw) ?: [])));
                if (count($opts) < 2) {
                    $errors[] = "Baris $line: minimal 2 opsi (option_a, option_b, ...)";
                    continue;
                }
                $bad = array_diff($letters, array_keys($opts));
                if (!$letters || $bad || ($type === 'multiple_choice' && count($letters) !== 1)) {
                    $errors[] = "Baris $line: kolom correct tidak valid ('" . $r['correct'] . "')";
                    continue;
                }
                foreach ($opts as $L => $text) {
                    $options[] = [$text, in_array($L, $letters, true) ? 1 : 0];
                }
            } elseif ($type === 'true_false') {
                $v = strtolower($r['correct']);
                if (in_array($v, ['benar', 'true', 'ya', '1'], true)) {
                    $isTrue = true;
                } elseif (in_array($v, ['salah', 'false', 'tidak', '0'], true)) {
                    $isTrue = false;
                } else {
                    $errors[] = "Baris $line: correct untuk True/False harus 'Benar' atau 'Salah'";
                    continue;
                }
                $options = [['Benar', $isTrue ? 1 : 0], ['Salah', $isTrue ? 0 : 1]];
            } elseif ($type === 'short_answer') {
                $answers = array_values(array_filter(array_map('trim', explode('|', $r['correct']))));
                if (!$answers) {
                    $errors[] = "Baris $line: jawaban short answer kosong (pisahkan beberapa jawaban dengan |)";
                    continue;
                }
                foreach ($answers as $a) {
                    $options[] = [$a, 1];
                }
            }
            $catId = null;
            if (($cat = $r['category'] ?? '') !== '') {
                $key = mb_strtolower($cat);
                if (!isset($catCache[$key])) {
                    q('INSERT INTO categories (name, created_at) VALUES (?, ?)', [mb_substr($cat, 0, 100), now()]);
                    $catCache[$key] = (int) $pdo->lastInsertId();
                }
                $catId = $catCache[$key];
            }
            $points = is_numeric(str_replace(',', '.', $r['points'] ?? '')) ? max(0.25, (float) str_replace(',', '.', $r['points'])) : 1.0;
            q('INSERT INTO questions (category_id, question, question_type, difficulty, points, explanation, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [$catId, $r['question'], $type, $diffMap[strtolower($r['difficulty'] ?? '')] ?? 'medium', $points, ($r['explanation'] ?? '') ?: null, current_user()['id'], now()]);
            $qid = (int) $pdo->lastInsertId();
            foreach ($options as $i => [$text, $ok]) {
                q('INSERT INTO question_options (question_id, option_text, is_correct, sort_order, created_at) VALUES (?, ?, ?, ?, ?)', [$qid, mb_substr($text, 0, 5000), $ok, $i, now()]);
            }
            $created++;
        }
        fclose($fh);
        $pdo->commit();
        log_activity('question', "Import CSV: $created soal dibuat");
        json_out(['ok' => true, 'created' => $created, 'skipped' => array_slice($errors, 0, 50), 'message' => "$created soal berhasil diimport."]);

    case 'category_save':
        $id = in_int('id');
        $name = mb_substr(in_str('name'), 0, 100);
        if ($name === '') {
            json_error('Nama kategori wajib diisi.', 422);
        }
        if (q_val('SELECT id FROM categories WHERE name = ? AND id <> ?', [$name, $id])) {
            json_error('Nama kategori sudah ada.', 422);
        }
        if ($id) {
            q('UPDATE categories SET name = ?, description = ? WHERE id = ?', [$name, in_str('description') ?: null, $id]);
        } else {
            q('INSERT INTO categories (name, description, created_at) VALUES (?, ?, ?)', [$name, in_str('description') ?: null, now()]);
        }
        json_out(['ok' => true, 'message' => 'Kategori disimpan.']);

    case 'category_delete':
        q('DELETE FROM categories WHERE id = ?', [in_int('id')]);
        json_out(['ok' => true, 'message' => 'Kategori dihapus. Soal di dalamnya menjadi tanpa kategori.']);

    default:
        json_error('Aksi tidak dikenal.');
}
