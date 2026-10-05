<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class AuthController
{
    public static function login(): void
    {
        $email = V::email(Http::input('email'));
        $password = (string) Http::input('password', '');
        if ($password === '') {
            throw new HttpException('Password is required.', 422, ['password' => 'required']);
        }
        Auth::attempt($email, $password, (bool) V::bool(Http::input('remember')));
        AppController::bootstrap();
    }

    public static function logout(): void
    {
        Auth::logout();
        Http::ok(['csrf' => Csrf::token()]);
    }

    public static function register(): void
    {
        if (!(int) Settings::get('allow_registration', '0')) {
            throw new HttpException('Registration is disabled. Ask an administrator for an account.', 403);
        }
        $name = V::str(Http::input('name'), 120, true, 'name');
        $email = V::email(Http::input('email'));
        $password = V::password(Http::input('password'));
        $id = Auth::createUser($name, $email, $password);
        Activity::log('auth.register', 'user', $id, 'Self registration', $id);
        Auth::loginUser($id);
        AppController::bootstrap();
    }

    public static function forgot(): void
    {
        $email = V::email(Http::input('email'));
        Auth::sendPasswordReset($email);
        Http::ok(null, 'If an account exists for that e-mail, a reset link has been sent.');
    }

    public static function reset(): void
    {
        $token = (string) Http::input('token', '');
        if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
            throw new HttpException('This reset link is invalid or has expired.', 422);
        }
        Auth::resetPassword($token, V::password(Http::input('password')));
        Http::ok(null, 'Your password has been reset. You can sign in now.');
    }
}
