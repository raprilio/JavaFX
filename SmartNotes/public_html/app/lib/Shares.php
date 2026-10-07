<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Sharing for everything except notes (notes keep note_shares) and meetings (meeting_shares):
 * audio recordings, mind maps, flowcharts, Drive files & folders, and calendar events (tagged users).
 *
 * Roles: 'owner' | 'edit' | 'view' | null. A Drive file is also visible when any folder above it is shared.
 */
final class Shares
{
    public const TYPES = [
        'audio' => ['table' => 'audio_notes', 'title' => 'title', 'perms' => ['view'], 'label' => 'rekaman audio', 'link' => '#/audio?view=shared&play=%d'],
        'mindmap' => ['table' => 'mindmaps', 'title' => 'title', 'perms' => ['view', 'edit'], 'label' => 'mind map', 'link' => '#/mindmaps/%d'],
        'flowchart' => ['table' => 'flowcharts', 'title' => 'title', 'perms' => ['view', 'edit'], 'label' => 'flowchart', 'link' => '#/flowcharts/%d'],
        'file' => ['table' => 'note_attachments', 'title' => 'original_name', 'perms' => ['view'], 'label' => 'file', 'link' => '#/drive?view=shared&open=%d'],
        'folder' => ['table' => 'drive_folders', 'title' => 'name', 'perms' => ['view'], 'label' => 'folder', 'link' => '#/drive?view=shared&folder=%d'],
        'event' => ['table' => 'calendar_events', 'title' => 'title', 'perms' => ['view'], 'label' => 'jadwal', 'link' => '#/calendar?event=%d'],
    ];

    public static function cfg(string $type): array
    {
        return self::TYPES[$type] ?? throw new HttpException('This item cannot be shared.', 404);
    }

    public static function item(string $type, int $id): ?array
    {
        $c = self::cfg($type);
        $deleted = $type === 'folder' ? 'NULL AS deleted_at' : 'deleted_at';
        $folder = $type === 'file' ? ', folder_id' : ($type === 'folder' ? ', parent_id' : '');
        return DB::one("SELECT id, user_id, `{$c['title']}` AS title, $deleted$folder FROM `{$c['table']}` WHERE id = ?", [$id]);
    }

    /** The user's role on an item, or null when they cannot see it. */
    public static function role(string $type, int $id, int $userId, ?array $row = null): ?string
    {
        $row ??= self::item($type, $id);
        if (!$row || $row['deleted_at']) {
            return null;
        }
        if ((int) $row['user_id'] === $userId) {
            return 'owner';
        }
        $perm = DB::val('SELECT permission FROM item_shares WHERE item_type = ? AND item_id = ? AND user_id = ?', [$type, $id, $userId]);
        if ($perm) {
            return (string) $perm;
        }
        if ($type === 'file' && $row['folder_id'] && self::folderShared((int) $row['folder_id'], $userId)) {
            return 'view';
        }
        if ($type === 'folder' && $row['parent_id'] && self::folderShared((int) $row['parent_id'], $userId)) {
            return 'view';
        }
        return null;
    }

    /** Is this folder, or any folder above it, shared with the user? */
    public static function folderShared(int $folderId, int $userId): bool
    {
        for ($i = 0, $f = $folderId; $f && $i < 40; $i++) {
            if (DB::val("SELECT 1 FROM item_shares WHERE item_type = 'folder' AND item_id = ? AND user_id = ?", [$f, $userId])) {
                return true;
            }
            $f = (int) DB::val('SELECT parent_id FROM drive_folders WHERE id = ?', [$f]);
        }
        return false;
    }

    /** Throws unless the user has at least $need ('view' or 'edit'). Returns [row, role]. */
    public static function require(string $type, int $id, int $userId, string $need = 'view'): array
    {
        $row = self::item($type, $id);
        $role = $row ? self::role($type, $id, $userId, $row) : null;
        if (!$role) {
            throw new HttpException('Not found.', 404);
        }
        if ($need === 'edit' && $role === 'view') {
            throw new HttpException('You can only view this item.', 403);
        }
        if ($need === 'owner' && $role !== 'owner') {
            throw new HttpException('Only the owner can do this.', 403);
        }
        return [$row, $role];
    }

    /** Ids of items of a type shared directly with the user. */
    public static function sharedIds(string $type, int $userId): array
    {
        return array_map('intval', array_column(DB::all('SELECT item_id FROM item_shares WHERE item_type = ? AND user_id = ?', [$type, $userId]), 'item_id'));
    }

    public static function list(string $type, int $id): array
    {
        $rows = DB::all(
            'SELECT s.user_id, s.permission, s.created_at, u.name, u.email, p.avatar_path
             FROM item_shares s JOIN users u ON u.id = s.user_id LEFT JOIN user_profiles p ON p.user_id = u.id
             WHERE s.item_type = ? AND s.item_id = ? ORDER BY u.name',
            [$type, $id]
        );
        return array_map(static fn($r) => [
            'user_id' => (int) $r['user_id'], 'name' => $r['name'], 'email' => $r['email'], 'permission' => $r['permission'], 'created_at' => $r['created_at'],
            'avatar_url' => $r['avatar_path'] ? 'api/index.php?route=profile/avatar/' . $r['user_id'] . '&v=' . substr(md5($r['avatar_path']), 0, 8) : null,
        ], $rows);
    }

    /** Share with users (adds or changes permission). Returns the ids that were newly added. */
    public static function add(string $type, int $id, array $owner, array $userIds, string $perm = 'view', bool $notify = true): array
    {
        $c = self::cfg($type);
        $perm = in_array($perm, $c['perms'], true) ? $perm : 'view';
        $row = self::item($type, $id);
        $added = [];
        foreach (array_unique($userIds) as $rid) {
            $rid = (int) $rid;
            if ($rid === (int) $owner['id'] || !DB::val("SELECT 1 FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL", [$rid])) {
                continue;
            }
            $exists = DB::val('SELECT id FROM item_shares WHERE item_type = ? AND item_id = ? AND user_id = ?', [$type, $id, $rid]);
            DB::run(
                'INSERT INTO item_shares (item_type, item_id, owner_id, user_id, permission) VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE permission = VALUES(permission)',
                [$type, $id, (int) $owner['id'], $rid, $perm]
            );
            if (!$exists) {
                $added[] = $rid;
            }
        }
        if ($notify && $added) {
            self::announce($type, $id, (string) $row['title'], $owner['name'], $added, $perm);
        }
        return $added;
    }

    /** Make the share list exactly $userIds (used for "tag users" fields). Returns newly added ids. */
    public static function sync(string $type, int $id, array $owner, array $userIds): array
    {
        $userIds = array_values(array_unique(array_map('intval', $userIds)));
        if ($userIds) {
            DB::run('DELETE FROM item_shares WHERE item_type = ? AND item_id = ? AND user_id NOT IN (' . DB::in($userIds) . ')', array_merge([$type, $id], $userIds));
        } else {
            DB::run('DELETE FROM item_shares WHERE item_type = ? AND item_id = ?', [$type, $id]);
        }
        return self::add($type, $id, $owner, $userIds);
    }

    public static function remove(string $type, int $id, int $userId): void
    {
        DB::run('DELETE FROM item_shares WHERE item_type = ? AND item_id = ? AND user_id = ?', [$type, $id, $userId]);
    }

    public static function purge(string $type, int $id): void
    {
        DB::run('DELETE FROM item_shares WHERE item_type = ? AND item_id = ?', [$type, $id]);
    }

    /** Recipients with notification preferences (for reminders). */
    public static function recipients(string $type, int $id): array
    {
        return DB::all(
            "SELECT u.id, u.name, u.email, COALESCE(st.email_notifications, 1) AS email_on, COALESCE(st.notify_schedule, 1) AS n_schedule
             FROM item_shares s JOIN users u ON u.id = s.user_id LEFT JOIN user_settings st ON st.user_id = u.id
             WHERE s.item_type = ? AND s.item_id = ? AND u.status = 'active' AND u.deleted_at IS NULL",
            [$type, $id]
        );
    }

    private static function announce(string $type, int $id, string $title, string $actor, array $userIds, string $perm): void
    {
        $c = self::cfg($type);
        $link = sprintf($c['link'], $id);
        $verb = $type === 'event' ? 'menandai Anda di' : 'membagikan';
        $msg = "$actor $verb {$c['label']} \"" . ($title !== '' ? $title : 'Tanpa judul') . '"';
        $mail = Mailer::isConfigured();
        foreach ($userIds as $rid) {
            Notify::create($rid, 'share', $msg, $perm === 'edit' ? 'Anda dapat melihat dan mengedit.' : 'Anda dapat melihat.', $link);
            if (!$mail) {
                continue;
            }
            $r = DB::one('SELECT u.name, u.email, COALESCE(s.email_notifications, 1) AS email_on FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?', [$rid]);
            if ($r && (int) $r['email_on']) {
                $html = Mailer::template(ucfirst($c['label']) . ' dibagikan', '<p>Halo ' . e($r['name']) . ',</p><p>' . e($msg) . '.</p><p style="margin:24px 0"><a class="btn" href="' . e(app_url() . $link) . '">Buka</a></p>');
                Mailer::queue($rid, 'system', $r['email'], $msg, $html);
            }
        }
    }
}
