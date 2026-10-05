<?php
/**
 * GET  action=list&q=&role=&department=&status=&page=
 * GET  action=get&id=
 * POST action=create|update|delete|reset_password|toggle_status|import|assign_exams
 */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

function user_payload(bool $isCreate): array
{
    $d = [
        'name'       => mb_substr(in_str('name'), 0, 120),
        'username'   => mb_strtolower(mb_substr(in_str('username'), 0, 60)),
        'email'      => mb_strtolower(mb_substr(in_str('email'), 0, 150)),
        'role'       => in_str('role') === 'admin' ? 'admin' : 'user',
        'department' => mb_substr(in_str('department'), 0, 100),
        'position'   => mb_substr(in_str('position'), 0, 100),
        'status'     => in_str('status', 'active') === 'inactive' ? 'inactive' : 'active',
    ];
    if ($d['name'] === '' || $d['username'] === '') {
        json_error('Nama dan username wajib diisi.', 422);
    }
    if (!preg_match('/^[a-z0-9._-]{3,60}$/', $d['username'])) {
        json_error('Username 3-60 karakter: huruf kecil, angka, titik, strip, underscore.', 422);
    }
    if ($d['email'] !== '' && !filter_var($d['email'], FILTER_VALIDATE_EMAIL)) {
        json_error('Format email tidak valid.', 422);
    }
    $pw = (string) (input()['password'] ?? '');
    if ($isCreate && strlen($pw) < 8) {
        json_error('Password minimal 8 karakter.', 422);
    }
    if (!$isCreate && $pw !== '' && strlen($pw) < 8) {
        json_error('Password minimal 8 karakter.', 422);
    }
    $d['password'] = $pw;
    foreach (['email', 'department', 'position'] as $k) {
        if ($d[$k] === '') {
            $d[$k] = null;
        }
    }
    return $d;
}

function ensure_unique(array $d, int $exceptId = 0): void
{
    if (q_val('SELECT id FROM users WHERE username = ? AND id <> ?', [$d['username'], $exceptId])) {
        json_error('Username sudah digunakan.', 422);
    }
    if ($d['email'] && q_val('SELECT id FROM users WHERE email = ? AND id <> ?', [$d['email'], $exceptId])) {
        json_error('Email sudah digunakan.', 422);
    }
}

$action = admin_action() ?: 'list';
$me = current_user();

if (in_array($action, ['list', 'get'], true)) {
    if ($action === 'get') {
        $u = q_row('SELECT id, name, username, email, role, department, position, status, last_login_at, created_at FROM users WHERE id = ?', [get_int('id')]);
        if (!$u) {
            json_error('User tidak ditemukan.', 404);
        }
        $u['assigned_exam_ids'] = array_map('intval', array_column(q_all('SELECT exam_id FROM exam_assignments WHERE user_id = ?', [$u['id']]), 'exam_id'));
        json_out(['ok' => true, 'data' => $u]);
    }
    $w = ['1=1'];
    $p = [];
    if (($s = get_str('q')) !== '') {
        $w[] = '(name LIKE ? OR username LIKE ? OR email LIKE ?)';
        array_push($p, "%$s%", "%$s%", "%$s%");
    }
    if (in_array(get_str('role'), ['admin', 'user'], true)) { $w[] = 'role = ?'; $p[] = get_str('role'); }
    if (in_array(get_str('status'), ['active', 'inactive'], true)) { $w[] = 'status = ?'; $p[] = get_str('status'); }
    if (get_str('department') !== '') { $w[] = 'department = ?'; $p[] = get_str('department'); }
    $where = implode(' AND ', $w);
    $per = 20;
    $page = max(1, get_int('page', 1));
    $total = (int) q_val("SELECT COUNT(*) FROM users WHERE $where", $p);
    $rows = q_all(
        "SELECT u.id, u.name, u.username, u.email, u.role, u.department, u.position, u.status, u.last_login_at, u.created_at,
                (SELECT COUNT(*) FROM exam_attempts a WHERE a.user_id = u.id AND a.status <> 'in_progress') AS attempts
           FROM users u WHERE $where ORDER BY u.role = 'admin' DESC, u.name LIMIT $per OFFSET " . (($page - 1) * $per),
        $p
    );
    json_out(['ok' => true, 'data' => $rows, 'total' => $total, 'page' => $page, 'pages' => (int) ceil($total / $per)]);
}

require_method('POST');
verify_csrf();

switch ($action) {
    case 'create':
        $d = user_payload(true);
        ensure_unique($d);
        q('INSERT INTO users (name, username, email, password, role, department, position, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$d['name'], $d['username'], $d['email'], password_hash($d['password'], PASSWORD_DEFAULT), $d['role'], $d['department'], $d['position'], $d['status'], now()]);
        json_out(['ok' => true, 'message' => 'User berhasil dibuat.', 'id' => (int) db()->lastInsertId()]);

    case 'update':
        $id = in_int('id');
        if (!q_val('SELECT id FROM users WHERE id = ?', [$id])) {
            json_error('User tidak ditemukan.', 404);
        }
        $d = user_payload(false);
        ensure_unique($d, $id);
        if ($id === (int) $me['id'] && ($d['role'] !== 'admin' || $d['status'] !== 'active')) {
            json_error('Anda tidak dapat menurunkan role atau menonaktifkan akun sendiri.', 422);
        }
        q('UPDATE users SET name = ?, username = ?, email = ?, role = ?, department = ?, position = ?, status = ? WHERE id = ?',
            [$d['name'], $d['username'], $d['email'], $d['role'], $d['department'], $d['position'], $d['status'], $id]);
        if ($d['password'] !== '') {
            q('UPDATE users SET password = ? WHERE id = ?', [password_hash($d['password'], PASSWORD_DEFAULT), $id]);
        }
        json_out(['ok' => true, 'message' => 'User berhasil diperbarui.']);

    case 'delete':
        $id = in_int('id');
        if ($id === (int) $me['id']) {
            json_error('Anda tidak dapat menghapus akun sendiri.', 422);
        }
        q('DELETE FROM users WHERE id = ?', [$id]);
        json_out(['ok' => true, 'message' => 'User dihapus beserta riwayat ujiannya.']);

    case 'reset_password':
        $id = in_int('id');
        $pw = (string) (input()['password'] ?? '');
        if ($pw === '') {
            $pw = substr(str_replace(['+', '/', '='], '', base64_encode(random_bytes(9))), 0, 10);
        }
        if (strlen($pw) < 8) {
            json_error('Password minimal 8 karakter.', 422);
        }
        if (!q_val('SELECT id FROM users WHERE id = ?', [$id])) {
            json_error('User tidak ditemukan.', 404);
        }
        q('UPDATE users SET password = ? WHERE id = ?', [password_hash($pw, PASSWORD_DEFAULT), $id]);
        json_out(['ok' => true, 'message' => 'Password direset.', 'password' => $pw]);

    case 'toggle_status':
        $id = in_int('id');
        if ($id === (int) $me['id']) {
            json_error('Anda tidak dapat menonaktifkan akun sendiri.', 422);
        }
        q("UPDATE users SET status = IF(status = 'active', 'inactive', 'active') WHERE id = ?", [$id]);
        json_out(['ok' => true, 'status' => q_val('SELECT status FROM users WHERE id = ?', [$id])]);

    case 'assign_exams':
        $id = in_int('user_id');
        $examIds = array_values(array_unique(array_filter(array_map('intval', (array) (input()['exam_ids'] ?? [])))));
        $pdo = db();
        $pdo->beginTransaction();
        q('DELETE FROM exam_assignments WHERE user_id = ?', [$id]);
        foreach ($examIds as $eid) {
            q('INSERT INTO exam_assignments (exam_id, user_id, created_at) SELECT id, ?, ? FROM exams WHERE id = ?', [$id, now(), $eid]);
        }
        $pdo->commit();
        json_out(['ok' => true, 'message' => 'Assignment ujian diperbarui.']);

    case 'import':
        if (empty($_FILES['file']['tmp_name']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
            json_error('File CSV belum dipilih.', 422);
        }
        if ($_FILES['file']['size'] > 5 * 1024 * 1024) {
            json_error('Ukuran file maksimal 5 MB.', 422);
        }
        $fh = fopen($_FILES['file']['tmp_name'], 'r');
        $first = fgets($fh);
        $delim = substr_count((string) $first, ';') > substr_count((string) $first, ',') ? ';' : ',';
        rewind($fh);
        $header = fgetcsv($fh, 0, $delim);
        if (!$header) {
            json_error('File CSV kosong.', 422);
        }
        $header = array_map(fn ($h) => strtolower(trim(preg_replace('/^\xEF\xBB\xBF/', '', (string) $h))), $header);
        foreach (['name', 'username', 'password'] as $req) {
            if (!in_array($req, $header, true)) {
                json_error("Kolom wajib '$req' tidak ditemukan. Header: name,username,email,password,department,position,role", 422);
            }
        }
        $created = 0;
        $skipped = [];
        $line = 1;
        $ins = db()->prepare('INSERT INTO users (name, username, email, password, role, department, position, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, \'active\', ?)');
        while (($row = fgetcsv($fh, 0, $delim)) !== false) {
            $line++;
            if (count(array_filter($row, fn ($v) => trim((string) $v) !== '')) === 0) {
                continue;
            }
            $r = array_combine($header, array_pad(array_slice($row, 0, count($header)), count($header), ''));
            $name = trim((string) $r['name']);
            $username = mb_strtolower(trim((string) $r['username']));
            $email = mb_strtolower(trim((string) ($r['email'] ?? '')));
            $pw = (string) $r['password'];
            if ($name === '' || !preg_match('/^[a-z0-9._-]{3,60}$/', $username) || strlen($pw) < 8) {
                $skipped[] = "Baris $line: data tidak valid (username/password)";
                continue;
            }
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $skipped[] = "Baris $line: email tidak valid";
                continue;
            }
            if (q_val('SELECT id FROM users WHERE username = ? OR (email IS NOT NULL AND email = ?)', [$username, $email ?: '#'])) {
                $skipped[] = "Baris $line: username/email sudah ada";
                continue;
            }
            $ins->execute([
                mb_substr($name, 0, 120), $username, $email ?: null, password_hash($pw, PASSWORD_DEFAULT),
                strtolower(trim((string) ($r['role'] ?? ''))) === 'admin' ? 'admin' : 'user',
                trim((string) ($r['department'] ?? '')) ?: null, trim((string) ($r['position'] ?? '')) ?: null, now(),
            ]);
            $created++;
        }
        fclose($fh);
        json_out(['ok' => true, 'message' => "$created user berhasil diimport.", 'created' => $created, 'skipped' => array_slice($skipped, 0, 50)]);

    default:
        json_error('Aksi tidak dikenal.');
}
