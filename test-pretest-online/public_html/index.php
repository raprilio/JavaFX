<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/functions.php';

app_session_start();
$user = current_user();
if ($user === null) {
    redirect('login.php');
}
redirect($user['role'] === 'admin' ? 'admin/index.php' : 'dashboard.php');
