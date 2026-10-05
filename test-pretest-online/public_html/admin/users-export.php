<?php
/** Export data user ke Excel, atau template CSV import (?template=1). Admin only. */
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/admin_auth.php';
require_once dirname(__DIR__) . '/includes/xlsx.php';

if (get_str('template') === '1') {
    csv_download('template-import-user.csv', ['name', 'username', 'email', 'password', 'department', 'position', 'role'], [
        ['Raka Aprilio', 'raka', 'raka@example.com', 'Rahasia123', 'IT', 'IT Support', 'user'],
    ]);
}

$rows = q_all(
    "SELECT u.name, u.username, u.email, u.department, u.position, u.role, u.status, u.last_login_at, u.created_at,
            (SELECT COUNT(*) FROM exam_attempts a WHERE a.user_id = u.id AND a.status <> 'in_progress') AS attempts
       FROM users u ORDER BY u.role DESC, u.name"
);
$data = array_map(fn ($r) => [
    $r['name'], $r['username'], $r['email'] ?? '', $r['department'] ?? '', $r['position'] ?? '',
    ucfirst($r['role']), $r['status'] === 'active' ? 'Aktif' : 'Nonaktif', (int) $r['attempts'],
    fmt_date($r['last_login_at'], 'd-m-Y H:i'), fmt_date($r['created_at'], 'd-m-Y H:i'),
], $rows);

xlsx_download('data-user-' . date('Ymd-His') . '.xlsx', 'Users',
    ['Nama', 'Username', 'Email', 'Department', 'Position', 'Role', 'Status', 'Jumlah Ujian', 'Login Terakhir', 'Dibuat'],
    $data, APP_NAME . ' — Data User · ' . date('d-m-Y H:i'));
