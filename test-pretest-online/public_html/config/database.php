<?php
/**
 * Konfigurasi aplikasi & database.
 * Sesuaikan nilai di bawah ini dengan data dari cPanel → MySQL Databases.
 */

// ---- Database -------------------------------------------------------
define('DB_HOST', 'localhost');
define('DB_PORT', 3306);
define('DB_NAME', 'nama_database');
define('DB_USER', 'user_database');
define('DB_PASS', 'password_database');

// ---- Aplikasi -------------------------------------------------------
define('APP_NAME', 'ExamPro');
define('APP_TAGLINE', 'Test & Pre-Test Online');
define('APP_TIMEZONE', 'Asia/Jakarta');
define('APP_DEBUG', false);          // true hanya saat development

// Kosongkan untuk deteksi otomatis. Isi jika aplikasi berada di subfolder
// dan deteksi otomatis gagal, contoh: '/ujian'
define('BASE_URL', '');

define('SESSION_NAME', 'EXAMPROSESSID');
define('SESSION_IDLE_TIMEOUT', 7200); // detik (2 jam)

// Toleransi jaringan (detik) setelah waktu ujian habis
define('EXAM_GRACE_SECONDS', 15);

// Proteksi brute-force login
define('LOGIN_MAX_ATTEMPTS', 5);
define('LOGIN_LOCK_MINUTES', 15);

// Upload gambar soal
define('UPLOAD_MAX_BYTES', 2 * 1024 * 1024);
