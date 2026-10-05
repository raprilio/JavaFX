<?php
/**
 * Bootstrap endpoint API peserta: wajib login, respons JSON.
 * Endpoint di folder ini TIDAK PERNAH mengembalikan score Test.
 */
declare(strict_types=1);
define('API_REQUEST', true);
require_once dirname(__DIR__, 2) . '/includes/auth.php';

/** Ambil attempt milik user yang sedang login, atau 404. */
function api_user_attempt(int $attemptId): array
{
    $me = current_user();
    $data = $attemptId > 0 ? load_user_attempt($attemptId, (int) $me['id']) : null;
    if ($data === null) {
        json_error('Data ujian tidak ditemukan.', 404);
    }
    return $data;
}
