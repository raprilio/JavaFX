<?php
/**
 * SmartNotes bootstrap — loaded by every PHP entry point.
 */
declare(strict_types=1);

if (defined('SN_APP')) {
    return;
}
define('SN_APP', true);
define('SN_VERSION', '1.2.0');
define('SN_APP_DIR', __DIR__);
define('SN_ROOT', dirname(__DIR__));

spl_autoload_register(static function (string $class): void {
    if (!preg_match('/^[A-Za-z]+$/', $class)) {
        return;
    }
    foreach (['/lib/', '/controllers/'] as $dir) {
        $file = __DIR__ . $dir . $class . '.php';
        if (is_file($file)) {
            require $file;
            return;
        }
    }
});
require __DIR__ . '/lib/helpers.php';

$configFile = __DIR__ . '/config.php';
if (is_file($configFile)) {
    Config::load(require $configFile);
}

define('SN_STORAGE', rtrim((string) Config::get('paths.storage', SN_ROOT . '/storage'), '/'));
define('SN_UPLOADS', rtrim((string) Config::get('paths.uploads', SN_ROOT . '/uploads'), '/'));

date_default_timezone_set((string) Config::get('app.timezone', 'Asia/Jakarta'));
mb_internal_encoding('UTF-8');

$debug = (bool) Config::get('app.debug', false);
error_reporting(E_ALL);
ini_set('display_errors', $debug ? '1' : '0');
ini_set('log_errors', '1');
if (is_dir(SN_STORAGE . '/logs') && is_writable(SN_STORAGE . '/logs')) {
    ini_set('error_log', SN_STORAGE . '/logs/php-error.log');
}
