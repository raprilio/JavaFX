<?php
/** GET ?q=&action=&page= — log aktivitas (audit trail). Admin only. */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$w = ['1=1'];
$p = [];
if (($s = get_str('q')) !== '') {
    $w[] = '(l.description LIKE ? OR u.name LIKE ? OR u.username LIKE ? OR l.ip_address LIKE ?)';
    array_push($p, "%$s%", "%$s%", "%$s%", "%$s%");
}
if (($a = get_str('action')) !== '') {
    $w[] = 'l.action = ?';
    $p[] = $a;
}
if (preg_match('/^\d{4}-\d{2}-\d{2}$/', get_str('date'))) {
    $w[] = 'l.created_at BETWEEN ? AND ?';
    array_push($p, get_str('date') . ' 00:00:00', get_str('date') . ' 23:59:59');
}
$where = implode(' AND ', $w);
$per = 30;
$page = max(1, get_int('page', 1));
$from = "FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id WHERE $where";
$total = (int) q_val("SELECT COUNT(*) $from", $p);
$rows = q_all(
    "SELECT l.id, l.action, l.description, l.ip_address, l.created_at, u.name, u.username, u.role
       $from ORDER BY l.id DESC LIMIT $per OFFSET " . (($page - 1) * $per),
    $p
);
$actions = array_column(q_all('SELECT DISTINCT action FROM activity_logs ORDER BY action'), 'action');
json_out(['ok' => true, 'data' => $rows, 'total' => $total, 'page' => $page, 'pages' => (int) ceil($total / $per), 'actions' => $actions]);
