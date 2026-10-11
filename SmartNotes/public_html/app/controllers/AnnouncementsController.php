<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Announcements (v1.9): an administrator writes a message for everyone or for chosen users; it pops up
 * until each user confirms it, is listed in the notification bell and can also be e-mailed.
 */
final class AnnouncementsController
{
    private static function admin(): array
    {
        $u = Auth::require();
        if (!Auth::isAdmin()) {
            throw new HttpException('Only administrators can manage announcements.', 403);
        }
        return $u;
    }

    public static function index(): void
    {
        self::admin();
        $active = (int) DB::val("SELECT COUNT(*) FROM users WHERE status = 'active' AND deleted_at IS NULL");
        $rows = DB::all(
            "SELECT a.*, u.name AS author,
                    (SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_id = a.id) AS read_count,
                    (SELECT COUNT(*) FROM announcement_targets t WHERE t.announcement_id = a.id) AS target_count
             FROM announcements a LEFT JOIN users u ON u.id = a.created_by
             WHERE a.deleted_at IS NULL ORDER BY a.created_at DESC LIMIT 200"
        );
        Http::ok(array_map(static function ($a) use ($active) {
            $audience = $a['audience'] === 'all' ? max(0, $active - 1) : (int) $a['target_count'];
            return [
                'id' => (int) $a['id'], 'title' => $a['title'], 'body' => $a['body'], 'level' => $a['level'], 'audience' => $a['audience'],
                'starts_at' => $a['starts_at'], 'ends_at' => $a['ends_at'], 'author' => $a['author'], 'created_at' => $a['created_at'],
                'read_count' => (int) $a['read_count'], 'audience_count' => $audience,
                'active' => strtotime((string) $a['starts_at']) <= time() && (!$a['ends_at'] || strtotime((string) $a['ends_at']) > time()),
            ];
        }, $rows));
    }

    public static function store(): void
    {
        $u = self::admin();
        $in = Http::body();
        $title = V::str($in['title'] ?? null, 160, true, 'title');
        $body = V::str($in['body'] ?? null, 5000) ?? '';
        $level = V::enum($in['level'] ?? 'info', ['info', 'important'], 'info');
        $audience = V::enum($in['audience'] ?? 'all', ['all', 'users'], 'all');
        $targets = $audience === 'users' ? array_values(array_diff(V::ids($in['user_ids'] ?? []), [(int) $u['id']])) : [];
        if ($audience === 'users' && !$targets) {
            throw new HttpException('Choose at least one user.', 422, ['user_ids' => true]);
        }
        $ends = V::datetime($in['ends_at'] ?? null);
        if ($ends && strtotime($ends) <= time()) {
            throw new HttpException('The end date must be in the future.', 422, ['ends_at' => true]);
        }
        $id = DB::insert('announcements', [
            'created_by' => $u['id'], 'title' => $title, 'body' => $body, 'level' => $level, 'audience' => $audience,
            'starts_at' => now(), 'ends_at' => $ends,
        ]);
        foreach ($targets as $t) {
            DB::run('INSERT IGNORE INTO announcement_targets (announcement_id, user_id) SELECT ?, id FROM users WHERE id = ? AND deleted_at IS NULL', [$id, $t]);
        }
        $recipients = DB::all(
            "SELECT u.id, u.name, u.email, COALESCE(s.email_notifications, 1) AS email_on FROM users u LEFT JOIN user_settings s ON s.user_id = u.id
             WHERE u.status = 'active' AND u.deleted_at IS NULL AND u.id <> ?" . ($audience === 'users' ? ' AND u.id IN (SELECT user_id FROM announcement_targets WHERE announcement_id = ?)' : ''),
            $audience === 'users' ? [$u['id'], $id] : [$u['id']]
        );
        $mail = V::bool($in['send_email'] ?? false) && Mailer::isConfigured();
        foreach ($recipients as $r) {
            Notify::create((int) $r['id'], 'announcement', '📢 ' . $title, mb_substr($body, 0, 240), '#/');
            if ($mail && (int) $r['email_on']) {
                $html = Mailer::template('Pengumuman', '<p>Halo ' . e($r['name']) . ',</p><h2 style="margin:16px 0 8px">' . e($title) . '</h2><p style="white-space:pre-line">' . e($body) . '</p><p style="color:#6b7280;font-size:13px">— ' . e($u['name']) . '</p>');
                Mailer::queue((int) $r['id'], 'system', $r['email'], 'Pengumuman: ' . $title, $html);
            }
        }
        Activity::log('announcement.create', null, $id, $title . ' (' . count($recipients) . ' user(s))');
        Http::ok(['id' => $id, 'recipients' => count($recipients)], 'Announcement published.');
    }

    /** End an announcement early / remove it: it no longer pops up. */
    public static function destroy(int $id): void
    {
        self::admin();
        if (!DB::update('announcements', ['deleted_at' => now()], 'id = ? AND deleted_at IS NULL', [$id])) {
            throw new HttpException('Announcement not found.', 404);
        }
        Activity::log('announcement.delete', null, $id, 'Removed announcement');
        Http::ok();
    }

    /** Who has (not yet) confirmed it. */
    public static function readers(int $id): void
    {
        self::admin();
        $a = DB::one('SELECT * FROM announcements WHERE id = ?', [$id]) ?? throw new HttpException('Announcement not found.', 404);
        $rows = DB::all(
            "SELECT u.id, u.name, u.email, r.read_at FROM users u
             LEFT JOIN announcement_reads r ON r.announcement_id = ? AND r.user_id = u.id
             WHERE u.status = 'active' AND u.deleted_at IS NULL AND u.id <> ?" . ($a['audience'] === 'users' ? ' AND u.id IN (SELECT user_id FROM announcement_targets WHERE announcement_id = ?)' : '') . '
             ORDER BY r.read_at IS NULL, u.name',
            $a['audience'] === 'users' ? [$id, (int) $a['created_by'], $id] : [$id, (int) $a['created_by']]
        );
        Http::ok(array_map(static fn($r) => ['id' => (int) $r['id'], 'name' => $r['name'], 'email' => $r['email'], 'read_at' => $r['read_at']], $rows));
    }

    // ------------------------------------------------------------ every user

    public static function ack(): void
    {
        $u = Auth::require();
        Popups::ack($u['id'], (string) Http::input('kind'), (int) Http::input('id'));
        Http::ok();
    }
}
