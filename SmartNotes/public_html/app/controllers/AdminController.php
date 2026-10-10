<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class AdminController
{
    // ------------------------------------------------------------ statistics

    public static function stats(): void
    {
        $since = date('Y-m-d', strtotime('-29 days'));
        $c = [
            'users' => (int) DB::val('SELECT COUNT(*) FROM users WHERE deleted_at IS NULL'),
            'active_users_7d' => (int) DB::val('SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND last_login_at >= ?', [date('Y-m-d H:i:s', strtotime('-7 days'))]),
            'notes' => (int) DB::val('SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL'),
            'tasks' => (int) DB::val('SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL'),
            'tasks_completed' => (int) DB::val("SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND status = 'completed'"),
            'meetings_upcoming' => (int) DB::val("SELECT COUNT(*) FROM meetings WHERE deleted_at IS NULL AND status = 'scheduled' AND meeting_date >= CURDATE()"),
            'audio' => (int) DB::val('SELECT COUNT(*) FROM audio_notes WHERE deleted_at IS NULL'),
            'mindmaps' => (int) DB::val('SELECT COUNT(*) FROM mindmaps WHERE deleted_at IS NULL'),
            'flowcharts' => (int) DB::val('SELECT COUNT(*) FROM flowcharts WHERE deleted_at IS NULL'),
            'events' => (int) DB::val('SELECT COUNT(*) FROM calendar_events WHERE deleted_at IS NULL'),
        ];
        $files = DB::all('SELECT file_kind, COUNT(*) c, COALESCE(SUM(file_size),0) s FROM note_attachments GROUP BY file_kind');
        $audio = DB::one('SELECT COUNT(*) c, COALESCE(SUM(file_size),0) s FROM audio_notes');
        $storage = ['recordings' => (int) $audio['s']];
        foreach ($files as $f) {
            $storage[$f['file_kind']] = (int) $f['s'];
        }
        $c['storage_bytes'] = array_sum($storage);
        $c['upload_dir_bytes'] = dir_size(SN_UPLOADS);
        $c['db_bytes'] = (int) DB::val('SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.TABLES WHERE table_schema = DATABASE()');

        $days = [];
        for ($i = 29; $i >= 0; $i--) {
            $days[] = date('Y-m-d', strtotime("-$i days"));
        }
        $series = static function (string $sql) use ($since, $days): array {
            $map = array_column(DB::all($sql, [$since]), 'c', 'd');
            return array_map(static fn($d) => (int) ($map[$d] ?? 0), $days);
        };
        $charts = [
            'labels' => $days,
            'notes_per_day' => $series('SELECT DATE(created_at) d, COUNT(*) c FROM notes WHERE created_at >= ? GROUP BY DATE(created_at)'),
            'tasks_created' => $series('SELECT DATE(created_at) d, COUNT(*) c FROM tasks WHERE created_at >= ? GROUP BY DATE(created_at)'),
            'tasks_completed' => $series('SELECT DATE(completed_at) d, COUNT(*) c FROM tasks WHERE completed_at >= ? GROUP BY DATE(completed_at)'),
            'active_users' => $series('SELECT DATE(created_at) d, COUNT(DISTINCT user_id) c FROM activity_logs WHERE created_at >= ? AND user_id IS NOT NULL GROUP BY DATE(created_at)'),
            'storage' => $storage,
            'task_status' => array_column(DB::all("SELECT status, COUNT(*) c FROM tasks WHERE deleted_at IS NULL GROUP BY status"), 'c', 'status'),
        ];
        $system = [
            'php' => PHP_VERSION,
            'mysql' => (string) DB::val('SELECT VERSION()'),
            'app_version' => SN_VERSION,
            'upload_max' => ini_get('upload_max_filesize'),
            'post_max' => ini_get('post_max_size'),
            'gd' => function_exists('imagecreatetruecolor'),
            'zip' => class_exists('ZipArchive'),
            'smtp_configured' => Mailer::isConfigured(),
            'last_cron_run' => ($t = (int) Settings::get('last_cron_run', '0')) ? date('Y-m-d H:i:s', $t) : null,
            'last_cron_source' => Settings::get('last_cron_source'),
            'pending_reminders' => (int) DB::val("SELECT COUNT(*) FROM reminders WHERE status = 'pending'"),
            'pending_emails' => (int) DB::val("SELECT COUNT(*) FROM email_notifications WHERE status = 'pending'"),
            'failed_emails_7d' => (int) DB::val("SELECT COUNT(*) FROM email_notifications WHERE status = 'failed' AND created_at >= ?", [date('Y-m-d', strtotime('-7 days'))]),
        ];
        $topUsers = DB::all(
            'SELECT u.id, u.name, u.email, (SELECT COUNT(*) FROM notes n WHERE n.user_id = u.id AND n.deleted_at IS NULL) notes,
                    (SELECT COUNT(*) FROM tasks t WHERE t.user_id = u.id AND t.deleted_at IS NULL) tasks, u.last_login_at
             FROM users u WHERE u.deleted_at IS NULL ORDER BY notes DESC LIMIT 5'
        );
        Http::ok(['counts' => $c, 'charts' => $charts, 'system' => $system, 'top_users' => $topUsers]);
    }

    public static function activity(): void
    {
        $where = ['1=1'];
        $params = [];
        if ($uid = V::id(Http::query('user_id'))) {
            $where[] = 'a.user_id = ?';
            $params[] = $uid;
        }
        if ($q = V::str(Http::query('q'), 100)) {
            $where[] = '(a.action LIKE ? OR a.description LIKE ? OR u.email LIKE ?)';
            $like = '%' . addcslashes($q, '%_\\') . '%';
            array_push($params, $like, $like, $like);
        }
        $perPage = 50;
        $page = V::int(Http::query('page'), 1) ?? 1;
        $w = implode(' AND ', $where);
        $total = (int) DB::val("SELECT COUNT(*) FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id WHERE $w", $params);
        $rows = DB::all(
            "SELECT a.id, a.action, a.entity_type, a.entity_id, a.description, a.ip_address, a.user_agent, a.created_at, u.name AS user_name, u.email AS user_email
             FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id WHERE $w ORDER BY a.id DESC LIMIT $perPage OFFSET " . (($page - 1) * $perPage),
            $params
        );
        Http::ok(['items' => $rows, 'total' => $total, 'page' => $page, 'per_page' => $perPage]);
    }

    // ------------------------------------------------------------ users

    public static function users(): void
    {
        $where = ['u.deleted_at IS NULL'];
        $params = [];
        if ($q = V::str(Http::query('q'), 100)) {
            $where[] = '(u.name LIKE ? OR u.email LIKE ?)';
            $like = '%' . addcslashes($q, '%_\\') . '%';
            array_push($params, $like, $like);
        }
        $rows = DB::all(
            'SELECT u.id, u.name, u.email, u.role, u.permissions, u.status, u.must_change_password, u.last_login_at, u.created_at, p.job_title,
                    (SELECT COUNT(*) FROM note_shares s WHERE s.owner_id = u.id) AS shares,
                    (SELECT COUNT(*) FROM notes n WHERE n.user_id = u.id AND n.deleted_at IS NULL) AS notes,
                    (SELECT COUNT(*) FROM tasks t WHERE t.user_id = u.id AND t.deleted_at IS NULL) AS tasks,
                    (SELECT COALESCE(SUM(file_size),0) FROM note_attachments a WHERE a.user_id = u.id)
                  + (SELECT COALESCE(SUM(file_size),0) FROM audio_notes au WHERE au.user_id = u.id) AS storage
             FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
             WHERE ' . implode(' AND ', $where) . ' ORDER BY u.created_at DESC LIMIT 500',
            $params
        );
        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
            $r['permissions'] = json_decode_array($r['permissions']);
            $r['notes'] = (int) $r['notes'];
            $r['tasks'] = (int) $r['tasks'];
            $r['storage'] = (int) $r['storage'];
            $r['shares'] = (int) $r['shares'];
            $r['must_change_password'] = (bool) $r['must_change_password'];
        }
        Http::ok(['items' => $rows, 'permissions' => Auth::PERMISSIONS]);
    }

    private static function permissionsFrom(mixed $v): array
    {
        return array_values(array_intersect(is_array($v) ? $v : [], array_keys(Auth::PERMISSIONS)));
    }

    public static function createUser(): void
    {
        $name = V::str(Http::input('name'), 120, true, 'name');
        $email = V::email(Http::input('email'));
        $password = V::password(Http::input('password'));
        $role = V::enum(Http::input('role'), ['admin', 'user'], 'user');
        if ($role === 'admin' && !Auth::isAdmin()) {
            throw new HttpException('Only administrators can create administrators.', 403);
        }
        $perms = Auth::isAdmin() ? self::permissionsFrom(Http::input('permissions')) : [];
        $mustChange = V::bool(Http::input('must_change_password', true)) === 1;
        $id = Auth::createUser($name, $email, $password, $role, $perms, $mustChange);
        if (V::bool(Http::input('send_welcome')) && Mailer::isConfigured()) {
            $html = Mailer::template('Akun Anda telah dibuat', '<p>Halo ' . e($name) . ',</p><p>Akun ' . e((string) Settings::get('app_name', 'SmartNotes')) . ' telah dibuat untuk Anda.</p><p>Email: <strong>' . e($email) . '</strong></p><p style="margin:24px 0"><a class="btn" href="' . e(app_url()) . '">Masuk sekarang</a></p><p>Silakan gunakan password yang diberikan oleh administrator dan segera menggantinya di Settings &rarr; Security.</p>');
            Mailer::deliver(Mailer::queue($id, 'system', $email, 'Selamat datang di ' . Settings::get('app_name', 'SmartNotes'), $html));
        }
        Activity::log('admin.user_create', 'user', $id, "Created user $email");
        Http::ok(['id' => $id]);
    }

    public static function updateUser(int $id): void
    {
        $me = Auth::require();
        $user = DB::one('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [$id]);
        if (!$user) {
            throw new HttpException('User not found.', 404);
        }
        if ($user['role'] === 'admin' && !Auth::isAdmin()) {
            throw new HttpException('Only administrators can modify administrators.', 403);
        }
        $data = [];
        if (Http::has('name')) {
            $data['name'] = V::str(Http::input('name'), 120, true, 'name');
        }
        if (Http::has('email')) {
            $data['email'] = V::email(Http::input('email'));
            if (DB::val('SELECT id FROM users WHERE email = ? AND id <> ?', [$data['email'], $id])) {
                throw new HttpException('This e-mail address is already in use.', 422);
            }
        }
        if (Http::has('role') && Auth::isAdmin()) {
            $data['role'] = V::enum(Http::input('role'), ['admin', 'user'], 'user');
            if ($id === $me['id'] && $data['role'] !== 'admin') {
                throw new HttpException('You cannot remove your own administrator role.', 422);
            }
        }
        if (Http::has('status')) {
            $data['status'] = V::enum(Http::input('status'), ['active', 'suspended'], 'active');
            if ($id === $me['id'] && $data['status'] !== 'active') {
                throw new HttpException('You cannot suspend your own account.', 422);
            }
        }
        if (Http::has('permissions') && Auth::isAdmin()) {
            $data['permissions'] = json_encode(self::permissionsFrom(Http::input('permissions')));
        }
        $pw = (string) Http::input('password', '');
        if ($pw !== '') {
            $data['password_hash'] = password_hash(V::password($pw), PASSWORD_DEFAULT);
            $data['must_change_password'] = V::bool(Http::input('must_change_password', true));
        }
        if (($data['role'] ?? $user['role']) !== 'admin' && $user['role'] === 'admin') {
            $admins = (int) DB::val("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL");
            if ($admins <= 1) {
                throw new HttpException('At least one active administrator is required.', 422);
            }
        }
        DB::update('users', $data, 'id = ?', [$id]);
        if (($data['status'] ?? '') === 'suspended' || isset($data['password_hash'])) {
            // Suspension or a password reset signs the user out of every device immediately.
            Auth::signOutEverywhere($id);
            if ($id === $me['id']) {
                Auth::syncSessionVersion($id);
            }
        }
        Activity::log('admin.user_update', 'user', $id, 'Updated user ' . ($data['email'] ?? $user['email']));
        Http::ok();
    }

    /** Sign a user out of every browser and device. */
    public static function forceLogout(int $id): void
    {
        $me = Auth::require();
        $user = DB::one('SELECT id, email, role FROM users WHERE id = ? AND deleted_at IS NULL', [$id]);
        if (!$user) {
            throw new HttpException('User not found.', 404);
        }
        if ($user['role'] === 'admin' && !Auth::isAdmin()) {
            throw new HttpException('Only administrators can sign out administrators.', 403);
        }
        Auth::signOutEverywhere($id);
        if ($id === $me['id']) {
            Auth::syncSessionVersion($id);
        }
        Activity::log('admin.user_logout', 'user', $id, 'Signed out everywhere: ' . $user['email']);
        Http::ok(null, 'The user has been signed out of all devices.');
    }

    private static function requireFullAdmin(): void
    {
        if (!Auth::isAdmin()) {
            throw new HttpException('Only administrators can do this.', 403);
        }
    }

    public static function deleteUser(int $id): void
    {
        self::requireFullAdmin();
        $me = Auth::require();
        if ($id === $me['id']) {
            throw new HttpException('You cannot delete your own account.', 422);
        }
        $user = DB::one('SELECT * FROM users WHERE id = ?', [$id]);
        if (!$user) {
            throw new HttpException('User not found.', 404);
        }
        if ($user['role'] === 'admin' && !Auth::isAdmin()) {
            throw new HttpException('Only administrators can delete administrators.', 403);
        }
        // Permanently remove the user, their database rows (cascade) and their files.
        DB::run('UPDATE mindmap_nodes n JOIN mindmaps m ON m.id = n.mindmap_id SET n.parent_id = NULL WHERE m.user_id = ?', [$id]);
        DB::run('DELETE FROM users WHERE id = ?', [$id]);
        $dir = SN_UPLOADS . '/u' . $id;
        if (is_dir($dir)) {
            $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
            foreach ($it as $f) {
                $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
            }
            @rmdir($dir);
        }
        Activity::log('admin.user_delete', 'user', null, 'Deleted user ' . $user['email']);
        Http::ok();
    }

    // ------------------------------------------------------------ settings

    private const GENERAL_KEYS = [
        'app_name', 'app_tagline', 'default_theme', 'default_accent', 'allow_registration', 'allow_note_sharing', 'trash_auto_delete_days',
        'max_image_mb', 'max_audio_mb', 'max_video_mb', 'max_file_mb', 'default_reminder_minutes', 'web_cron_enabled',
        'upload_kinds', 'min_free_disk_mb', 'storage_plan_gb',
    ];

    public static function settings(): void
    {
        $out = [];
        foreach (self::GENERAL_KEYS as $k) {
            $out[$k] = Settings::get($k);
        }
        $out['app_url'] = Settings::get('app_url', app_url());
        $out['cron_token'] = Config::get('cron.token') ? true : false;
        $out['branding'] = Settings::publicBranding();
        $out['upload_kinds'] = UploadPolicy::allowedKinds();
        $out['min_free_disk_mb'] = Settings::int('min_free_disk_mb', 200);
        $out['storage_plan_gb'] = Settings::int('storage_plan_gb', 0);
        Http::ok($out);
    }

    public static function saveSettings(): void
    {
        $in = Http::body();
        $v = [];
        if (array_key_exists('app_name', $in)) {
            $v['app_name'] = V::str($in['app_name'], 60, true, 'app name');
        }
        if (array_key_exists('app_tagline', $in)) {
            $v['app_tagline'] = V::str($in['app_tagline'], 120) ?? '';
        }
        if (array_key_exists('default_theme', $in)) {
            $v['default_theme'] = V::enum($in['default_theme'], ['light', 'dark', 'system'], 'system');
        }
        if (array_key_exists('default_accent', $in)) {
            $v['default_accent'] = V::color($in['default_accent']) ?? '#6366f1';
        }
        foreach (['allow_registration', 'web_cron_enabled', 'allow_note_sharing'] as $k) {
            if (array_key_exists($k, $in)) {
                $v[$k] = (string) V::bool($in[$k]);
            }
        }
        // Upload size limits: 0 = no limit (only the hosting space counts).
        $mb = [0, UploadPolicy::MAX_MB];
        $ints = ['trash_auto_delete_days' => [0, 3650], 'max_image_mb' => $mb, 'max_audio_mb' => $mb, 'max_video_mb' => $mb, 'max_file_mb' => $mb,
            'default_reminder_minutes' => [0, 10080], 'min_free_disk_mb' => [0, 1048576], 'storage_plan_gb' => [0, 100000]];
        if (array_key_exists('upload_kinds', $in)) {
            $kinds = is_array($in['upload_kinds']) ? $in['upload_kinds'] : explode(',', (string) $in['upload_kinds']);
            $kinds = array_values(array_intersect(UploadPolicy::KINDS, array_map('strval', $kinds)));
            $v['upload_kinds'] = $kinds ? implode(',', $kinds) : 'none';
        }
        foreach ($ints as $k => [$min, $max]) {
            if (array_key_exists($k, $in) && !(str_starts_with($k, 'max_') && trim((string) $in[$k]) === '')) { // an emptied size field keeps its value instead of becoming "no limit"
                $v[$k] = (string) (V::int($in[$k], $min, $max) ?? $min);
            }
        }
        if (array_key_exists('app_url', $in)) {
            $url = V::str($in['app_url'], 255);
            if ($url && !filter_var($url, FILTER_VALIDATE_URL)) {
                throw new HttpException('Invalid application URL.', 422);
            }
            $v['app_url'] = $url ? rtrim($url, '/') . '/' : '';
        }
        Settings::setMany($v);
        Activity::log('admin.settings', null, null, 'Updated application settings: ' . implode(', ', array_keys($v)));
        self::settings();
    }

    /** Uploads & storage overview: no quota, only the hosting's own space. */
    public static function storage(): void
    {
        $files = DB::all('SELECT file_kind, COUNT(*) c, COALESCE(SUM(file_size),0) s FROM note_attachments GROUP BY file_kind');
        $audio = DB::one('SELECT COUNT(*) c, COALESCE(SUM(file_size),0) s FROM audio_notes');
        $by = ['recordings' => ['count' => (int) $audio['c'], 'size' => (int) $audio['s']]];
        foreach ($files as $f) {
            $by[$f['file_kind']] = ['count' => (int) $f['c'], 'size' => (int) $f['s']];
        }
        $top = DB::all(
            'SELECT u.id, u.name, u.email,
                    (SELECT COALESCE(SUM(file_size),0) FROM note_attachments a WHERE a.user_id = u.id)
                  + (SELECT COALESCE(SUM(file_size),0) FROM audio_notes au WHERE au.user_id = u.id) AS bytes
             FROM users u WHERE u.deleted_at IS NULL ORDER BY bytes DESC LIMIT 10'
        );
        Http::ok([
            'uploads_bytes' => dir_size(SN_UPLOADS),
            'db_bytes' => (int) DB::val('SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.TABLES WHERE table_schema = DATABASE()'),
            'pending_bytes' => ChunkUpload::pendingBytes(),
            'disk_free' => UploadPolicy::diskFree(),
            'disk_total' => UploadPolicy::diskTotal(),
            'reserve_bytes' => UploadPolicy::reserveBytes(),
            'plan_bytes' => Settings::int('storage_plan_gb', 0) * 1024 ** 3 ?: null,
            'by_kind' => $by,
            'top_users' => array_map(static fn($r) => ['id' => (int) $r['id'], 'name' => $r['name'], 'email' => $r['email'], 'bytes' => (int) $r['bytes']], $top),
            'server' => [
                'upload_max_filesize' => ini_get('upload_max_filesize'),
                'post_max_size' => ini_get('post_max_size'),
                'max_execution_time' => (int) ini_get('max_execution_time'),
                'chunk_bytes' => UploadPolicy::chunkBytes(),
            ],
        ]);
    }

    public static function cleanupUploads(): void
    {
        [$count, $bytes] = ChunkUpload::purgeStale(3600);
        Activity::log('admin.uploads_cleanup', null, null, "Removed $count unfinished upload(s)");
        Http::ok(['removed' => $count, 'bytes' => $bytes]);
    }

    public static function saveBrandingText(): void
    {
        $v = [];
        if (Http::has('logo_display')) {
            $v['logo_display'] = V::enum(Http::input('logo_display'), ['logo', 'logo_name', 'name'], 'logo');
        }
        foreach (['logo_height' => [16, 120], 'logo_max_width' => [40, 240], 'login_logo_height' => [20, 160]] as $k => [$min, $max]) {
            if (Http::has($k)) {
                $v[$k] = (string) (V::int(Http::input($k), $min, $max) ?? $min);
            }
        }
        if (Http::has('app_name')) {
            $v['app_name'] = V::str(Http::input('app_name'), 60, true, 'app name');
        }
        if (Http::has('app_tagline')) {
            $v['app_tagline'] = V::str(Http::input('app_tagline'), 120) ?? '';
        }
        Settings::setMany($v);
        Http::ok(Settings::publicBranding());
    }

    public static function uploadBranding(string $type): void
    {
        $key = ['logo' => 'logo_path', 'favicon' => 'favicon_path', 'background' => 'background_path'][$type] ?? null;
        if (!$key) {
            throw new HttpException('Unknown branding asset.', 404);
        }
        if (empty($_FILES['file'])) {
            throw new HttpException('No file uploaded.', 422);
        }
        $meta = Uploader::store($_FILES['file'], ['image'], 'branding', false, policy: false);
        if ($type === 'favicon') {
            Uploader::reencode(Uploader::absolute($meta['file_path']), Uploader::absolute($meta['file_path']), $meta['ext'], 256);
        } elseif ($type === 'logo') {
            Uploader::reencode(Uploader::absolute($meta['file_path']), Uploader::absolute($meta['file_path']), $meta['ext'], 800);
        }
        $old = Settings::get($key);
        Uploader::delete($old ? (string) $old : null);
        Settings::set($key, $meta['file_path']);
        Activity::log('admin.branding', null, null, "Updated $type");
        Http::ok(Settings::publicBranding());
    }

    public static function removeBranding(string $type): void
    {
        $key = ['logo' => 'logo_path', 'favicon' => 'favicon_path', 'background' => 'background_path'][$type] ?? null;
        if (!$key) {
            throw new HttpException('Unknown branding asset.', 404);
        }
        $old = Settings::get($key);
        Uploader::delete($old ? (string) $old : null);
        Settings::set($key, null);
        Activity::log('admin.branding', null, null, "Removed $type");
        Http::ok(Settings::publicBranding());
    }

    // ------------------------------------------------------------ e-mail

    public static function email(): void
    {
        $s = Settings::smtp();
        $s['password_set'] = $s['password'] !== '';
        unset($s['password']);
        $s['configured'] = Mailer::isConfigured();
        $s['cron_url'] = Config::get('cron.token') ? app_url() . 'cron.php?token=••••••' : null;
        $s['cron_command'] = '/usr/local/bin/php ' . SN_ROOT . '/cron.php';
        $s['last_cron_run'] = ($t = (int) Settings::get('last_cron_run', '0')) ? date('Y-m-d H:i:s', $t) : null;
        $s['last_cron_source'] = Settings::get('last_cron_source');
        $s['web_cron_enabled'] = (bool) (int) Settings::get('web_cron_enabled', '1');
        $s['stats'] = array_column(DB::all('SELECT status, COUNT(*) c FROM email_notifications GROUP BY status'), 'c', 'status');
        Http::ok($s);
    }

    public static function saveEmail(): void
    {
        if (Settings::smtp()['source'] === 'config') {
            throw new HttpException('SMTP is defined in app/config.php. Edit that file to change it.', 422);
        }
        $host = V::str(Http::input('host'), 190) ?? '';
        if ($host !== '' && !preg_match('/^[A-Za-z0-9.\-]+$/', $host)) {
            throw new HttpException('Invalid SMTP host.', 422);
        }
        $from = V::str(Http::input('from_email'), 190);
        if ($from && !filter_var($from, FILTER_VALIDATE_EMAIL)) {
            throw new HttpException('Invalid sender e-mail.', 422);
        }
        $vals = [
            'smtp_host' => $host,
            'smtp_port' => (string) (V::int(Http::input('port'), 1, 65535) ?? 587),
            'smtp_username' => V::str(Http::input('username'), 190) ?? '',
            'smtp_encryption' => V::enum(Http::input('encryption'), ['tls', 'ssl', 'none'], 'tls'),
            'smtp_from_name' => V::str(Http::input('from_name'), 120) ?? '',
            'smtp_from_email' => $from ?? '',
        ];
        $pw = Http::input('password');
        if (is_string($pw) && $pw !== '') {
            $vals['smtp_password'] = $pw;
        } elseif (V::bool(Http::input('clear_password'))) {
            $vals['smtp_password'] = '';
        }
        Settings::setMany($vals);
        if (Http::has('web_cron_enabled')) {
            Settings::set('web_cron_enabled', (string) V::bool(Http::input('web_cron_enabled')));
        }
        Activity::log('admin.smtp', null, null, 'Updated SMTP configuration');
        self::email();
    }

    public static function testEmail(): void
    {
        $u = Auth::require();
        $to = V::email(Http::input('to') ?: $u['email']);
        $html = Mailer::template('Tes email SMTP', '<p>Selamat! Konfigurasi SMTP ' . e((string) Settings::get('app_name', 'SmartNotes')) . ' berhasil.</p><p>Dikirim pada ' . e(now()) . '.</p>');
        $id = Mailer::queue($u['id'], 'test', $to, 'Tes email ' . Settings::get('app_name', 'SmartNotes'), $html);
        $ok = Mailer::deliver($id);
        if (!$ok) {
            $err = (string) DB::val('SELECT error_message FROM email_notifications WHERE id = ?', [$id]);
            DB::update('email_notifications', ['status' => 'failed'], 'id = ?', [$id]);
            throw new HttpException('Sending failed: ' . $err, 422);
        }
        Http::ok(null, "Test e-mail sent to $to.");
    }

    public static function emailLogs(): void
    {
        $where = ['1=1'];
        $params = [];
        if (in_array(Http::query('status'), ['pending', 'sent', 'failed', 'cancelled'], true)) {
            $where[] = 'e.status = ?';
            $params[] = Http::query('status');
        }
        $page = V::int(Http::query('page'), 1) ?? 1;
        $w = implode(' AND ', $where);
        $total = (int) DB::val("SELECT COUNT(*) FROM email_notifications e WHERE $w", $params);
        $rows = DB::all(
            "SELECT e.id, e.notification_type, e.recipient_email, e.subject, e.scheduled_at, e.sent_at, e.status, e.attempts, e.error_message, e.created_at, u.name AS user_name
             FROM email_notifications e LEFT JOIN users u ON u.id = e.user_id WHERE $w ORDER BY e.id DESC LIMIT 50 OFFSET " . (($page - 1) * 50),
            $params
        );
        Http::ok(['items' => $rows, 'total' => $total, 'page' => $page, 'per_page' => 50]);
    }

    public static function retryEmail(int $id): void
    {
        DB::update('email_notifications', ['status' => 'pending', 'attempts' => 0, 'scheduled_at' => now()], "id = ? AND status IN ('failed','cancelled')", [$id]);
        $ok = Mailer::deliver($id);
        Http::ok(['sent' => $ok], $ok ? 'E-mail sent.' : 'Sending failed again. Check the error message.');
    }

    public static function runScheduler(): void
    {
        $stats = Scheduler::run(200, 50, 'manual');
        Activity::log('admin.scheduler', null, null, 'Ran scheduler manually: ' . json_encode($stats));
        Http::ok($stats, 'Scheduler finished.');
    }

    // ------------------------------------------------------------ categories

    public static function categories(): void
    {
        Http::ok([
            'note' => json_decode_array((string) Settings::get('default_note_categories', '[]')),
            'task' => json_decode_array((string) Settings::get('default_task_categories', '[]')),
        ]);
    }

    public static function saveCategories(): void
    {
        $clean = static function (mixed $list): array {
            $out = [];
            foreach (is_array($list) ? $list : [] as $n) {
                $n = V::str($n, 80);
                if ($n) {
                    $out[mb_strtolower($n)] = $n;
                }
            }
            return array_slice(array_values($out), 0, 50);
        };
        $note = $clean(Http::input('note'));
        $task = $clean(Http::input('task'));
        Settings::set('default_note_categories', json_encode($note, JSON_UNESCAPED_UNICODE));
        Settings::set('default_task_categories', json_encode($task, JSON_UNESCAPED_UNICODE));
        $applied = 0;
        if (V::bool(Http::input('apply_to_existing'))) {
            foreach (DB::col('SELECT id FROM users WHERE deleted_at IS NULL') as $uid) {
                foreach (['note_categories' => $note, 'task_categories' => $task] as $t => $names) {
                    foreach ($names as $i => $n) {
                        $applied += DB::run("INSERT IGNORE INTO `$t` (user_id, name, sort_order) VALUES (?, ?, ?)", [$uid, $n, 100 + $i])->rowCount();
                    }
                }
            }
        }
        Activity::log('admin.categories', null, null, 'Updated default categories');
        Http::ok(['note' => $note, 'task' => $task, 'applied' => $applied]);
    }

    // ------------------------------------------------------------ backup

    public static function backups(): void
    {
        Http::ok(['items' => Backup::list(), 'zip' => class_exists('ZipArchive'), 'gzip' => function_exists('gzopen')]);
    }

    public static function createBackup(): void
    {
        $type = V::enum(Http::input('type'), ['database', 'uploads', 'both'], 'database');
        $made = [];
        if ($type === 'database' || $type === 'both') {
            $made[] = Backup::dumpDatabase(true);
        }
        if ($type === 'uploads' || $type === 'both') {
            $made[] = Backup::zipUploads();
        }
        Activity::log('admin.backup', null, null, 'Created backup: ' . implode(', ', $made));
        Http::ok(['created' => $made, 'items' => Backup::list()], 'Backup created.');
    }

    public static function downloadBackup(string $name): void
    {
        $path = Backup::path($name);
        Activity::log('admin.backup_download', null, null, "Downloaded $name");
        while (ob_get_level()) {
            ob_end_clean();
        }
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="' . $name . '"');
        header('Content-Length: ' . filesize($path));
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }

    public static function deleteBackup(string $name): void
    {
        $path = Backup::path($name);
        @unlink($path);
        Activity::log('admin.backup_delete', null, null, "Deleted $name");
        Http::ok(['items' => Backup::list()]);
    }

    public static function restoreBackup(string $name): void
    {
        self::requireFullAdmin();
        if (Http::input('confirm') !== 'RESTORE') {
            throw new HttpException('Type RESTORE to confirm.', 422);
        }
        $path = Backup::path($name);
        $me = Auth::require();
        if (str_ends_with($name, '.zip')) {
            $n = Backup::restoreUploads($path);
            Activity::log('admin.restore', null, null, "Restored $n files from $name");
            Http::ok(['files' => $n], "Restored $n files.");
        }
        $safety = Backup::dumpDatabase(true);
        $n = Backup::restoreDatabase($path);
        Activity::log('admin.restore', null, null, "Restored database from $name ($n statements). Safety backup: $safety", DB::val('SELECT id FROM users WHERE id = ?', [$me['id']]) ? $me['id'] : null);
        Http::ok(['statements' => $n, 'safety_backup' => $safety], 'Database restored. A safety backup of the previous state was created.');
    }

    public static function restoreUpload(): void
    {
        self::requireFullAdmin();
        if (Http::input('confirm') !== 'RESTORE') {
            throw new HttpException('Type RESTORE to confirm.', 422);
        }
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) {
            throw new HttpException('Please upload a .sql, .sql.gz or .zip backup file (server limit ' . ini_get('upload_max_filesize') . ').', 422);
        }
        $name = strtolower((string) $f['name']);
        $isZip = str_ends_with($name, '.zip');
        if (!$isZip && !str_ends_with($name, '.sql') && !str_ends_with($name, '.sql.gz') && !str_ends_with($name, '.gz')) {
            throw new HttpException('Unsupported backup format.', 422);
        }
        $me = Auth::require();
        if ($isZip) {
            $n = Backup::restoreUploads($f['tmp_name']);
            Activity::log('admin.restore', null, null, "Restored $n files from uploaded archive");
            Http::ok(['files' => $n], "Restored $n files.");
        }
        $safety = Backup::dumpDatabase(true);
        $n = Backup::restoreDatabase($f['tmp_name']);
        Activity::log('admin.restore', null, null, "Restored database from uploaded file ($n statements). Safety backup: $safety", DB::val('SELECT id FROM users WHERE id = ?', [$me['id']]) ? $me['id'] : null);
        Http::ok(['statements' => $n, 'safety_backup' => $safety], 'Database restored. A safety backup of the previous state was created.');
    }

    public static function exportUser(int $id): void
    {
        if (!DB::val('SELECT id FROM users WHERE id = ?', [$id])) {
            throw new HttpException('User not found.', 404);
        }
        $data = DataPort::export($id);
        Activity::log('admin.user_export', 'user', $id, 'Exported user data');
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="smartnotes-user-' . $id . '-' . date('Ymd-His') . '.json"');
        echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
}
