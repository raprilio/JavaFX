<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Share with everyone (v1.29): notes, audio recordings, mind maps, flowcharts, Drive files and folders.
 * Every active user gets an ordinary share row marked via_everyone — so "Shared with me", access checks and
 * "Remove from my list" work as for any share — and users created later get one too. Turning it off removes only
 * those rows: people the owner shared with one by one keep their access.
 */
final class EveryoneShares
{
    public const TYPES = ['note', 'audio', 'mindmap', 'flowchart', 'file', 'folder'];
    private const LABELS = ['note' => 'catatan', 'audio' => 'rekaman audio', 'mindmap' => 'mind map', 'flowchart' => 'flowchart', 'file' => 'file', 'folder' => 'folder'];

    private static function check(string $type): string
    {
        if (!in_array($type, self::TYPES, true)) {
            throw new HttpException('This item cannot be shared with everyone.', 404);
        }
        if (!(int) Settings::get('allow_note_sharing', '1')) {
            throw new HttpException('Sharing has been disabled by the administrator.', 403);
        }
        return $type;
    }

    /** The owner's item: [title, allowed permissions]. */
    private static function own(string $type, int $id, int $uid): array
    {
        if ($type === 'note') {
            $n = DB::one('SELECT title, is_locked FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [$id, $uid]);
            if (!$n) {
                throw new HttpException('Only the owner can share this note.', 404);
            }
            if ((int) $n['is_locked']) {
                throw new HttpException('Locked notes cannot be shared. Remove the lock first.', 422, ['locked' => true]);
            }
            return [(string) $n['title'], ['view', 'edit']];
        }
        [$row] = Shares::require($type, $id, $uid, 'owner');
        return [(string) $row['title'], Shares::cfg($type)['perms']];
    }

    /** Is it shared with everyone, and how (null = no)? */
    public static function state(string $type, int $id): ?array
    {
        $r = DB::one('SELECT permission, created_at FROM everyone_shares WHERE item_type = ? AND item_id = ?', [$type, $id]);
        if (!$r) {
            return null;
        }
        $t = $type === 'note' ? ['note_shares', 'note_id = ?', [$id]] : ['item_shares', 'item_type = ? AND item_id = ?', [$type, $id]];
        return ['permission' => $r['permission'], 'since' => $r['created_at'],
            'people' => (int) DB::val("SELECT COUNT(*) FROM {$t[0]} WHERE {$t[1]} AND via_everyone = 1", $t[2])];
    }

    /** The ids of the items of a type shared with everyone (list badges). */
    public static function ids(string $type, array $ids): array
    {
        if (!$ids) {
            return [];
        }
        return array_flip(array_map('intval', DB::col('SELECT item_id FROM everyone_shares WHERE item_type = ? AND item_id IN (' . DB::in($ids) . ')', [$type, ...$ids])));
    }

    /** Give one user the share rows of everything that is shared with everyone (new accounts). */
    public static function grantTo(int $uid, ?array $only = null): int
    {
        $n = 0;
        foreach (DB::all('SELECT item_type, item_id, permission, shared_by FROM everyone_shares' . ($only ? ' WHERE item_type = ? AND item_id = ?' : ''), $only ?? []) as $e) {
            $id = (int) $e['item_id'];
            if ($e['item_type'] === 'note') {
                $owner = DB::val('SELECT user_id FROM notes WHERE id = ? AND deleted_at IS NULL', [$id]);
                if ($owner && (int) $owner !== $uid) {
                    $n += DB::run('INSERT IGNORE INTO note_shares (note_id, owner_id, user_id, permission, via_everyone) VALUES (?, ?, ?, ?, 1)', [$id, $owner, $uid, $e['permission']])->rowCount();
                }
                continue;
            }
            $row = Shares::item($e['item_type'], $id);
            if ($row && !$row['deleted_at'] && (int) $row['user_id'] !== $uid) {
                $n += DB::run('INSERT IGNORE INTO item_shares (item_type, item_id, owner_id, user_id, permission, via_everyone) VALUES (?, ?, ?, ?, ?, 1)', [$e['item_type'], $id, $row['user_id'], $uid, $e['permission']])->rowCount();
            }
        }
        return $n;
    }

    /** Forget it (the item was deleted forever). */
    public static function purge(string $type, int $id): void
    {
        DB::run('DELETE FROM everyone_shares WHERE item_type = ? AND item_id = ?', [$type, $id]);
    }

    // ------------------------------------------------------------------ endpoints

    /** GET shares-all/{type}/{id} */
    public static function show(string $type, int $id): void
    {
        $u = Auth::require();
        $type = self::check($type);
        [, $perms] = self::own($type, $id, (int) $u['id']);
        Http::ok(['everyone' => self::state($type, $id), 'perms' => $perms, 'users' => (int) DB::val("SELECT COUNT(*) FROM users WHERE status = 'active' AND deleted_at IS NULL AND id <> ?", [$u['id']])]);
    }

    /** POST shares-all/{type}/{id} {on, permission} */
    public static function set(string $type, int $id): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $type = self::check($type);
        [$title, $perms] = self::own($type, $id, $uid);
        $on = V::bool(Http::input('on'));
        $perm = V::enum(Http::input('permission'), $perms, 'view');
        [$table, $where, $args] = $type === 'note' ? ['note_shares', 'note_id = ?', [$id]] : ['item_shares', 'item_type = ? AND item_id = ?', [$type, $id]];
        if (!$on) {
            DB::tx(static function () use ($type, $id, $table, $where, $args) {
                DB::run("DELETE FROM $table WHERE $where AND via_everyone = 1", $args);
                self::purge($type, $id);
            });
            Activity::log("$type.unshare_all", $type, $id, 'Stopped sharing with everyone');
            Http::ok(['everyone' => null]);
        }
        $had = array_flip(array_map('intval', DB::col("SELECT user_id FROM $table WHERE $where", $args)));
        DB::tx(static function () use ($type, $id, $uid, $perm, $table, $where, $args) {
            DB::run('INSERT INTO everyone_shares (item_type, item_id, permission, shared_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE permission = VALUES(permission)', [$type, $id, $perm, $uid]);
            DB::run("UPDATE $table SET permission = ? WHERE $where AND via_everyone = 1", [$perm, ...$args]);
            foreach (DB::col("SELECT id FROM users WHERE status = 'active' AND deleted_at IS NULL AND id <> ?", [$uid]) as $to) {
                self::grantTo((int) $to, [$type, $id]);
            }
        });
        // one quiet notification for the people who did not have it yet (no pop-up: it goes to everybody)
        $label = self::LABELS[$type];
        $link = $type === 'note' ? '#/notes/' . $id : sprintf(Shares::cfg($type)['link'], $id);
        $msg = "{$u['name']} membagikan $label \"" . ($title !== '' ? $title : 'Tanpa judul') . '" dengan semua orang';
        foreach (DB::col("SELECT user_id FROM $table WHERE $where AND via_everyone = 1", $args) as $to) {
            if (!isset($had[(int) $to])) {
                Notify::create((int) $to, 'share_all', $msg, $perm === 'edit' ? 'Semua orang dapat melihat dan mengedit.' : 'Semua orang dapat melihat.', $link);
            }
        }
        Activity::log("$type.share_all", $type, $id, "Shared with everyone ($perm)");
        Http::ok(['everyone' => self::state($type, $id)]);
    }
}
