<?php
/**
 * Middleware: wajib role = admin.
 * Seluruh halaman /admin dan endpoint /api/admin WAJIB me-require file ini.
 * Inilah satu-satunya pintu akses ke data score Test.
 */
declare(strict_types=1);

require_once __DIR__ . '/auth.php';

if (!is_admin()) {
    if (is_api_request()) {
        json_error('Forbidden: akses khusus administrator.', 403);
    }
    http_response_code(403);
    flash('danger', 'Anda tidak memiliki akses ke halaman administrator.');
    redirect('dashboard.php');
}
