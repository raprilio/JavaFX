<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Sharing notes with specific users (view / edit) and per-recipient pinning.
 */
final class SharesController
{
    private static function enabled(): void
    {
        if (!(int) Settings::get('allow_note_sharing', '1')) {
            throw new HttpException('Note sharing has been disabled by the administrator.', 403);
        }
    }

    public static function listFor(int $noteId): array
    {
        return array_map(static fn($r) => [
            'user_id' => (int) $r['user_id'],
            'name' => $r['name'],
            'email' => $r['email'],
            'permission' => $r['permission'],
            'avatar_url' => $r['avatar_path'] ? 'api/index.php?route=profile/avatar/' . $r['user_id'] . '&v=' . substr(md5($r['avatar_path']), 0, 8) : null,
            'last_opened_at' => $r['last_opened_at'],
            'created_at' => $r['created_at'],
        ], DB::all(
            'SELECT s.user_id, s.permission, s.last_opened_at, s.created_at, u.name, u.email, p.avatar_path
             FROM note_shares s JOIN users u ON u.id = s.user_id LEFT JOIN user_profiles p ON p.user_id = u.id
             WHERE s.note_id = ? ORDER BY u.name',
            [$noteId]
        ));
    }

    /** Active users a note can be shared with. */
    public static function directory(): void
    {
        $u = Auth::require();
        self::enabled();
        $params = [$u['id']];
        $where = "u.id <> ? AND u.status = 'active' AND u.deleted_at IS NULL";
        if ($q = V::str(Http::query('q'), 100)) {
            $where .= ' AND (u.name LIKE ? OR u.email LIKE ?)';
            $like = '%' . addcslashes($q, '%_\\') . '%';
            array_push($params, $like, $like);
        }
        $rows = DB::all("SELECT u.id, u.name, u.email, p.job_title, p.avatar_path FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE $where ORDER BY u.name LIMIT 200", $params);
        Http::ok(array_map(static fn($r) => [
            'id' => (int) $r['id'], 'name' => $r['name'], 'email' => $r['email'], 'job_title' => $r['job_title'],
            'avatar_url' => $r['avatar_path'] ? 'api/index.php?route=profile/avatar/' . $r['id'] . '&v=' . substr(md5($r['avatar_path']), 0, 8) : null,
        ], $rows));
    }

    private static function ownNote(int $noteId, int $uid): array
    {
        $n = DB::one('SELECT id, title, user_id FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [$noteId, $uid]);
        if (!$n) {
            throw new HttpException('Only the owner can manage sharing for this note.', 404);
        }
        return $n;
    }

    public static function index(int $noteId): void
    {
        $u = Auth::require();
        self::ownNote($noteId, $u['id']);
        Http::ok(self::listFor($noteId));
    }

    public static function store(int $noteId): void
    {
        $u = Auth::require();
        self::enabled();
        $note = self::ownNote($noteId, $u['id']);
        $userIds = V::ids(Http::input('user_ids', [Http::input('user_id')]));
        $perm = V::enum(Http::input('permission'), ['view', 'edit'], 'view');
        if (!$userIds) {
            throw new HttpException('Choose at least one person.', 422);
        }
        $added = 0;
        foreach ($userIds as $rid) {
            if ($rid === $u['id']) {
                continue;
            }
            $r = DB::one("SELECT id, name, email FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL", [$rid]);
            if (!$r) {
                continue;
            }
            $exists = DB::val('SELECT id FROM note_shares WHERE note_id = ? AND user_id = ?', [$noteId, $rid]);
            DB::run(
                'INSERT INTO note_shares (note_id, owner_id, user_id, permission) VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE permission = VALUES(permission)',
                [$noteId, $u['id'], $rid, $perm]
            );
            if (!$exists) {
                $added++;
                $title = $note['title'] !== '' ? $note['title'] : 'Untitled note';
                Notify::create($rid, 'share', "{$u['name']} membagikan catatan \"{$title}\" dengan Anda", $perm === 'edit' ? 'Anda dapat melihat dan mengedit.' : 'Anda dapat melihat.', '#/notes/' . $noteId);
                $wantsMail = (int) (DB::val('SELECT email_notifications FROM user_settings WHERE user_id = ?', [$rid]) ?? 1);
                if ($wantsMail && Mailer::isConfigured()) {
                    $html = Mailer::template('Catatan dibagikan', '<p>Halo ' . e($r['name']) . ',</p><p><strong>' . e($u['name']) . '</strong> membagikan catatan <strong>' . e($title) . '</strong> dengan Anda (' . ($perm === 'edit' ? 'dapat mengedit' : 'hanya melihat') . ').</p><p style="margin:24px 0"><a class="btn" href="' . e(app_url() . '#/notes/' . $noteId) . '">Buka catatan</a></p>');
                    Mailer::queue($rid, 'system', $r['email'], $u['name'] . ' membagikan catatan: ' . $title, $html);
                }
            }
        }
        Activity::log('note.share', 'note', $noteId, "Shared with " . count($userIds) . " user(s) ($perm)");
        Http::ok(['shares' => self::listFor($noteId), 'added' => $added]);
    }

    public static function remove(int $noteId, int $userId): void
    {
        $u = Auth::require();
        self::ownNote($noteId, $u['id']);
        DB::run('DELETE FROM note_shares WHERE note_id = ? AND user_id = ?', [$noteId, $userId]);
        Activity::log('note.unshare', 'note', $noteId, "Stopped sharing with user #$userId");
        Http::ok(['shares' => self::listFor($noteId)]);
    }

    /** Recipient pins/unpins a shared note for themselves. */
    public static function pin(int $noteId): void
    {
        $u = Auth::require();
        $n = DB::update('note_shares', ['is_pinned' => V::bool(Http::input('pinned'))], 'note_id = ? AND user_id = ?', [$noteId, $u['id']]);
        if (!$n && !DB::val('SELECT id FROM note_shares WHERE note_id = ? AND user_id = ?', [$noteId, $u['id']])) {
            throw new HttpException('Note not found.', 404);
        }
        Http::ok(['pinned' => (bool) V::bool(Http::input('pinned'))]);
    }

    /** Recipient removes a shared note from their list. */
    public static function leave(int $noteId): void
    {
        $u = Auth::require();
        DB::run('DELETE FROM note_shares WHERE note_id = ? AND user_id = ?', [$noteId, $u['id']]);
        Http::ok();
    }
}
