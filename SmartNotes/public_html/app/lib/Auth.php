<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Session-based authentication with "remember me", login rate limiting and password reset.
 */
final class Auth
{
    public const PERMISSIONS = [
        'manage_users' => 'Manage users',
        'manage_branding' => 'Change logo, favicon & background',
        'manage_settings' => 'Change application settings',
        'manage_email' => 'Configure SMTP & reminders',
        'manage_categories' => 'Manage default categories',
        'view_stats' => 'View statistics & activity log',
        'manage_backup' => 'Backup, restore & export',
    ];

    private const REMEMBER_COOKIE = 'sn_remember';
    private const REMEMBER_DAYS = 30;
    private const IDLE_TIMEOUT = 7200; // seconds without activity before a non-remembered session ends
    private const MAX_ATTEMPTS_EMAIL = 5;
    private const MAX_ATTEMPTS_IP = 20;
    private const LOCK_MINUTES = 15;

    private static ?array $user = null;
    private static bool $resolved = false;

    public static function startSession(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        $dir = SN_STORAGE . '/sessions';
        if (is_dir($dir) && is_writable($dir)) {
            session_save_path($dir);
        }
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.gc_maxlifetime', (string) max(self::IDLE_TIMEOUT, 3600));
        session_name('SNSESSID');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => base_path(),
            'secure' => is_https(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_start();

        $nowTs = time();
        if (!empty($_SESSION['uid']) && empty($_SESSION['remember'])
            && isset($_SESSION['last_seen']) && $nowTs - (int) $_SESSION['last_seen'] > self::IDLE_TIMEOUT) {
            $_SESSION = [];
            session_regenerate_id(true);
        }
        $_SESSION['last_seen'] = $nowTs;
    }

    public static function user(): ?array
    {
        if (self::$resolved) {
            return self::$user;
        }
        self::$resolved = true;
        $uid = (int) ($_SESSION['uid'] ?? 0);
        if ($uid > 0) {
            self::$user = self::loadUser($uid);
            if (!self::$user) {
                unset($_SESSION['uid']);
            }
        }
        if (!self::$user) {
            self::$user = self::loginFromRememberCookie();
        }
        return self::$user;
    }

    /** Forget the cached user so the next call reloads it from the database. */
    public static function refresh(): void
    {
        self::$resolved = false;
        self::$user = null;
    }

    public static function id(): ?int
    {
        $u = self::user();
        return $u ? (int) $u['id'] : null;
    }

    public static function require(): array
    {
        $u = self::user();
        if (!$u) {
            throw new HttpException('Please sign in to continue.', 401);
        }
        return $u;
    }

    public static function isAdmin(): bool
    {
        return (self::user()['role'] ?? '') === 'admin';
    }

    public static function can(string $perm): bool
    {
        $u = self::user();
        if (!$u) {
            return false;
        }
        if ($u['role'] === 'admin') {
            return true;
        }
        return in_array($perm, $u['permissions'], true);
    }

    public static function requirePermission(string $perm): array
    {
        $u = self::require();
        if (!self::can($perm)) {
            throw new HttpException('You do not have permission to do this.', 403);
        }
        return $u;
    }

    public static function hasAnyAdminPermission(): bool
    {
        foreach (array_keys(self::PERMISSIONS) as $p) {
            if (self::can($p)) {
                return true;
            }
        }
        return false;
    }

    private static function loadUser(int $id): ?array
    {
        $u = DB::one(
            "SELECT u.id, u.email, u.name, u.role, u.permissions, u.status, u.created_at, u.last_login_at,
                    p.avatar_path, p.job_title, p.phone, p.bio
             FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
             WHERE u.id = ? AND u.deleted_at IS NULL",
            [$id]
        );
        if (!$u || $u['status'] !== 'active') {
            return null;
        }
        $u['id'] = (int) $u['id'];
        $perms = json_decode_array($u['permissions']);
        $u['permissions'] = array_values(array_intersect($perms, array_keys(self::PERMISSIONS)));
        return $u;
    }

    /** Public representation of the user sent to the browser. */
    public static function publicUser(array $u): array
    {
        $perms = $u['role'] === 'admin' ? array_keys(self::PERMISSIONS) : $u['permissions'];
        return [
            'id' => $u['id'],
            'email' => $u['email'],
            'name' => $u['name'],
            'role' => $u['role'],
            'permissions' => $perms,
            'avatar_url' => $u['avatar_path'] ? 'api/index.php?route=profile/avatar/' . $u['id'] . '&v=' . substr(md5($u['avatar_path']), 0, 8) : null,
            'job_title' => $u['job_title'],
            'phone' => $u['phone'],
            'bio' => $u['bio'],
            'created_at' => $u['created_at'],
        ];
    }

    // ------------------------------------------------------------------ login

    public static function attempt(string $email, string $password, bool $remember): array
    {
        $ip = client_ip();
        if (self::isRateLimited('login', $email, $ip)) {
            throw new HttpException('Too many failed attempts. Please try again in ' . self::LOCK_MINUTES . ' minutes.', 429);
        }
        $row = DB::one('SELECT id, password_hash, status FROM users WHERE email = ? AND deleted_at IS NULL', [$email]);
        // Verify against a dummy hash when the user does not exist to keep timing similar.
        $hash = $row['password_hash'] ?? '$2y$10$ZKVfa.LaKyuVxK5ES.1qReXM43R2Ctm28eeJGBkXu6GTeYj8jf97K';
        $valid = password_verify($password, $hash) && $row;
        self::recordAttempt('login', $email, $ip, (bool) $valid);
        if (!$valid) {
            throw new HttpException('Incorrect e-mail or password.', 422);
        }
        if ($row['status'] !== 'active') {
            throw new HttpException('This account has been suspended. Contact your administrator.', 403);
        }
        if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
            DB::update('users', ['password_hash' => password_hash($password, PASSWORD_DEFAULT)], 'id = ?', [$row['id']]);
        }
        self::loginUser((int) $row['id'], $remember);
        Activity::log('auth.login', 'user', (int) $row['id'], 'Signed in');
        return self::user();
    }

    public static function loginUser(int $userId, bool $remember = false): void
    {
        session_regenerate_id(true);
        $_SESSION['uid'] = $userId;
        $_SESSION['remember'] = $remember ? 1 : 0;
        $_SESSION['_csrf'] = random_key(32);
        DB::update('users', ['last_login_at' => now(), 'last_login_ip' => client_ip()], 'id = ?', [$userId]);
        if ($remember) {
            self::issueRememberToken($userId);
        }
        self::$resolved = false;
        self::$user = null;
    }

    public static function logout(): void
    {
        $uid = self::id();
        if (!empty($_COOKIE[self::REMEMBER_COOKIE])) {
            [$selector] = array_pad(explode(':', (string) $_COOKIE[self::REMEMBER_COOKIE], 2), 2, '');
            DB::run('DELETE FROM remember_tokens WHERE selector = ?', [$selector]);
            self::setRememberCookie('', time() - 3600);
        }
        if ($uid) {
            Activity::log('auth.logout', 'user', $uid, 'Signed out');
        }
        $_SESSION = [];
        session_regenerate_id(true);
        self::$user = null;
    }

    private static function isRateLimited(string $type, string $email, string $ip): bool
    {
        $since = date('Y-m-d H:i:s', time() - self::LOCK_MINUTES * 60);
        $byEmail = (int) DB::val(
            'SELECT COUNT(*) FROM login_attempts WHERE attempt_type = ? AND email = ? AND success = 0 AND created_at > ?',
            [$type, $email, $since]
        );
        $byIp = (int) DB::val(
            'SELECT COUNT(*) FROM login_attempts WHERE attempt_type = ? AND ip_address = ? AND success = 0 AND created_at > ?',
            [$type, $ip, $since]
        );
        return $byEmail >= self::MAX_ATTEMPTS_EMAIL || $byIp >= self::MAX_ATTEMPTS_IP;
    }

    private static function recordAttempt(string $type, string $email, string $ip, bool $success): void
    {
        DB::insert('login_attempts', ['attempt_type' => $type, 'email' => $email, 'ip_address' => $ip, 'success' => $success ? 1 : 0]);
        if ($success && $type === 'login') {
            DB::run('DELETE FROM login_attempts WHERE attempt_type = ? AND email = ? AND success = 0', [$type, $email]);
        }
    }

    // ---------------------------------------------------------- remember me

    private static function issueRememberToken(int $userId): void
    {
        $selector = bin2hex(random_bytes(12));
        $validator = random_key(32);
        $expires = time() + self::REMEMBER_DAYS * 86400;
        DB::insert('remember_tokens', [
            'user_id' => $userId,
            'selector' => $selector,
            'validator_hash' => hash('sha256', $validator),
            'user_agent' => user_agent(),
            'ip_address' => client_ip(),
            'expires_at' => date('Y-m-d H:i:s', $expires),
        ]);
        self::setRememberCookie($selector . ':' . $validator, $expires);
    }

    private static function setRememberCookie(string $value, int $expires): void
    {
        if (headers_sent()) {
            return;
        }
        setcookie(self::REMEMBER_COOKIE, $value, [
            'expires' => $expires,
            'path' => base_path(),
            'secure' => is_https(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    private static function loginFromRememberCookie(): ?array
    {
        $cookie = (string) ($_COOKIE[self::REMEMBER_COOKIE] ?? '');
        if ($cookie === '' || !str_contains($cookie, ':')) {
            return null;
        }
        [$selector, $validator] = explode(':', $cookie, 2);
        if (!preg_match('/^[a-f0-9]{24}$/', $selector)) {
            return null;
        }
        $row = DB::one('SELECT * FROM remember_tokens WHERE selector = ?', [$selector]);
        if (!$row || strtotime($row['expires_at']) < time() || !hash_equals($row['validator_hash'], hash('sha256', $validator))) {
            if ($row) {
                DB::run('DELETE FROM remember_tokens WHERE id = ?', [$row['id']]);
            }
            self::setRememberCookie('', time() - 3600);
            return null;
        }
        $user = self::loadUser((int) $row['user_id']);
        if (!$user) {
            return null;
        }
        // Rotate the validator on every use to limit replay of a stolen cookie.
        $newValidator = random_key(32);
        DB::update('remember_tokens', [
            'validator_hash' => hash('sha256', $newValidator),
            'last_used_at' => now(),
            'ip_address' => client_ip(),
        ], 'id = ?', [$row['id']]);
        self::setRememberCookie($selector . ':' . $newValidator, strtotime($row['expires_at']));
        session_regenerate_id(true);
        $_SESSION['uid'] = $user['id'];
        $_SESSION['remember'] = 1;
        return $user;
    }

    public static function currentRememberSelector(): ?string
    {
        $cookie = (string) ($_COOKIE[self::REMEMBER_COOKIE] ?? '');
        return str_contains($cookie, ':') ? explode(':', $cookie, 2)[0] : null;
    }

    // ------------------------------------------------------- password reset

    public static function sendPasswordReset(string $email): void
    {
        $ip = client_ip();
        if (self::isRateLimited('forgot', $email, $ip)) {
            throw new HttpException('Too many requests. Please try again later.', 429);
        }
        self::recordAttempt('forgot', $email, $ip, false);
        $user = DB::one("SELECT id, name, email FROM users WHERE email = ? AND status = 'active' AND deleted_at IS NULL", [$email]);
        if (!$user) {
            return; // Do not reveal whether the account exists.
        }
        $token = random_key(32);
        DB::run('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [$user['id']]);
        DB::insert('password_resets', [
            'user_id' => $user['id'],
            'token_hash' => hash('sha256', $token),
            'expires_at' => date('Y-m-d H:i:s', time() + 3600),
        ]);
        $link = app_url() . '#/reset-password?token=' . $token;
        $html = Mailer::template(
            'Reset password',
            '<p>Halo ' . e($user['name']) . ',</p>
             <p>Kami menerima permintaan untuk mengatur ulang password akun SmartNotes Anda.</p>
             <p style="margin:24px 0"><a href="' . e($link) . '" class="btn">Atur ulang password</a></p>
             <p>Link ini berlaku selama 60 menit. Abaikan email ini jika Anda tidak meminta reset password.</p>'
        );
        $id = Mailer::queue((int) $user['id'], 'password_reset', $user['email'], 'Reset password ' . Settings::get('app_name', 'SmartNotes'), $html);
        Mailer::deliver($id);
        Activity::log('auth.forgot', 'user', (int) $user['id'], 'Requested password reset', (int) $user['id']);
    }

    public static function resetPassword(string $token, string $password): void
    {
        $row = DB::one(
            'SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()',
            [hash('sha256', $token)]
        );
        if (!$row) {
            throw new HttpException('This reset link is invalid or has expired.', 422);
        }
        DB::tx(static function () use ($row, $password) {
            DB::update('users', ['password_hash' => password_hash($password, PASSWORD_DEFAULT)], 'id = ?', [$row['user_id']]);
            DB::update('password_resets', ['used_at' => now()], 'id = ?', [$row['id']]);
            DB::run('DELETE FROM remember_tokens WHERE user_id = ?', [$row['user_id']]);
        });
        Activity::log('auth.reset', 'user', (int) $row['user_id'], 'Password reset via e-mail link', (int) $row['user_id']);
    }

    // ------------------------------------------------------------ accounts

    /** Create a user with profile, settings and default categories. */
    public static function createUser(string $name, string $email, string $password, string $role = 'user', array $permissions = []): int
    {
        if (DB::val('SELECT id FROM users WHERE email = ?', [$email])) {
            throw new HttpException('This e-mail address is already registered.', 422, ['email' => 'taken']);
        }
        return DB::tx(static function () use ($name, $email, $password, $role, $permissions) {
            $id = DB::insert('users', [
                'name' => $name,
                'email' => $email,
                'password_hash' => password_hash($password, PASSWORD_DEFAULT),
                'role' => $role,
                'permissions' => json_encode(array_values($permissions)),
            ]);
            DB::insert('user_profiles', ['user_id' => $id]);
            DB::insert('user_settings', [
                'user_id' => $id,
                'theme' => Settings::get('default_theme', 'system'),
                'default_reminder' => Settings::int('default_reminder_minutes', 30),
            ]);
            $palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
            foreach (['note_categories' => 'default_note_categories', 'task_categories' => 'default_task_categories'] as $table => $key) {
                $names = json_decode_array((string) Settings::get($key, '[]'));
                foreach (array_values($names) as $i => $n) {
                    $n = trim((string) $n);
                    if ($n !== '') {
                        DB::run("INSERT IGNORE INTO `$table` (user_id, name, color, sort_order) VALUES (?, ?, ?, ?)", [$id, mb_substr($n, 0, 80), $palette[$i % count($palette)], $i]);
                    }
                }
            }
            return $id;
        });
    }
}
