<?php
/**
 * Bootstrap endpoint API admin: wajib login + role = admin (403 jika bukan).
 */
declare(strict_types=1);
define('API_REQUEST', true);
require_once dirname(__DIR__, 2) . '/includes/admin_auth.php';
require_once dirname(__DIR__, 2) . '/includes/admin_lib.php';

function admin_action(): string
{
    return in_str('action', get_str('action'));
}
