<?php
/**
 * SmartNotes scheduler — processes reminders, agenda e-mails, the e-mail queue and housekeeping.
 *
 * cPanel → Cron Jobs (every 5 minutes):
 *   /usr/local/bin/php /home/USER/public_html/cron.php >/dev/null 2>&1
 *
 * Or via an external cron service (URL):
 *   https://your-domain.com/cron.php?token=YOUR_CRON_TOKEN   (token is in app/config.php)
 */
declare(strict_types=1);

require __DIR__ . '/app/bootstrap.php';

if (!Config::isInstalled()) {
    http_response_code(503);
    exit("SmartNotes is not installed.\n");
}

if (PHP_SAPI !== 'cli') {
    $expected = (string) Config::get('cron.token', '');
    $given = (string) ($_GET['token'] ?? '');
    if ($expected === '' || !hash_equals($expected, $given)) {
        http_response_code(403);
        exit('Forbidden');
    }
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    ignore_user_abort(true);
}

@set_time_limit(300);

try {
    $stats = Scheduler::run(200, 50, PHP_SAPI === 'cli' ? 'cron' : 'cron-url');
    echo json_encode(['ok' => true, 'time' => now(), 'stats' => $stats], JSON_UNESCAPED_SLASHES), "\n";
} catch (Throwable $e) {
    error_log('[SmartNotes cron] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]), "\n";
    exit(1);
}
