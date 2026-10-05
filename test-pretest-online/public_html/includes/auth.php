<?php
/**
 * Middleware: wajib login (role apa pun).
 * Untuk endpoint API, definisikan API_REQUEST = true sebelum require file ini
 * agar respons berupa JSON 401, bukan redirect.
 */
declare(strict_types=1);

require_once __DIR__ . '/functions.php';

app_session_start();

if (current_user() === null) {
    if (is_api_request()) {
        json_error('Sesi berakhir. Silakan login kembali.', 401);
    }
    flash('warning', 'Silakan login terlebih dahulu.');
    redirect('login.php');
}

if (!headers_sent()) {
    header('Cache-Control: no-store, no-cache, must-revalidate');
}
