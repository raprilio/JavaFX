<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class Csrf
{
    public static function token(): string
    {
        if (empty($_SESSION['_csrf'])) {
            $_SESSION['_csrf'] = random_key(32);
        }
        return $_SESSION['_csrf'];
    }

    public static function verify(): void
    {
        $sent = (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['_csrf'] ?? ''));
        $expected = (string) ($_SESSION['_csrf'] ?? '');
        if ($expected === '' || $sent === '' || !hash_equals($expected, $sent)) {
            throw new HttpException('Your session has expired. Please reload the page.', 419);
        }
    }
}
