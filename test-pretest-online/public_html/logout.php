<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/functions.php';

if (current_user()) {
    log_activity('logout', 'Logout');
}
logout_user();
app_session_start();
flash('success', 'Anda telah logout.');
redirect('login.php');
