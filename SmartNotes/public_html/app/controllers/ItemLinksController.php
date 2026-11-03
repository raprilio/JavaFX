<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Links on a meeting or a calendar event (v1.31): files already in Drive (no new upload), Product progress items and
 * Team progress tasks — so the documents, notes, progress and discussion of a meeting stay together. Everyone who can
 * see the meeting / event can add links and open them; a linked file stays in its owner's Drive (it is not moved),
 * and a Team progress task only opens for the people working on it (the others see its title and percentage).
 */
final class ItemLinksController
{
    public const ITEMS = ['meeting', 'event'];
    public const TARGETS = ['file', 'progress', 'ptask'];

    private static function check(string $type, string $what = 'item'): string
    {
        if (!in_array($type, $what === 'item' ? self::ITEMS : self::TARGETS, true)) {
            throw new HttpException('Not found.', 404);
        }
        return $type;
    }

    /** The owner id of the meeting / event when this user can see it, else null. */
    public static function ownerIfVisible(string $type, int $id, int $uid): ?int
    {
        if ($type === 'meeting') {
            $o = DB::val('SELECT m.user_id FROM meetings m WHERE m.id = ? AND m.deleted_at IS NULL AND ' . MeetingsController::visibleSql('m'), [$id, $uid, $uid]);
            return $o !== null && $o !== false ? (int) $o : null;
        }
        $e = DB::one('SELECT user_id, share_all FROM calendar_events WHERE id = ? AND deleted_at IS NULL', [$id]);
        if (!$e) {
            return null;
        }
        return (int) $e['user_id'] === $uid || (int) $e['share_all'] || Shares::role('event', $id, $uid) ? (int) $e['user_id'] : null;
    }

    /** Can this user open the file because it is linked to a meeting / event they can see? */
    public static function grantsFile(int $fileId, int $uid): bool
    {
        foreach (DB::all("SELECT item_type, item_id FROM item_links WHERE target_type = 'file' AND target_id = ?", [$fileId]) as $l) {
            if (self::ownerIfVisible((string) $l['item_type'], (int) $l['item_id'], $uid) !== null) {
                return true;
            }
        }
        return false;
    }

    /** The links of a meeting / event as this user sees them. */
    public static function listFor(string $type, int $id, int $uid): array
    {
        $owner = self::ownerIfVisible($type, $id, $uid);
        $rows = DB::all(
            'SELECT l.target_type, l.target_id, l.added_by, l.created_at, u.name AS adder FROM item_links l LEFT JOIN users u ON u.id = l.added_by
             WHERE l.item_type = ? AND l.item_id = ? ORDER BY l.created_at, l.target_id',
            [$type, $id]
        );
        $out = [];
        foreach ($rows as $r) {
            $tid = (int) $r['target_id'];
            $base = ['type' => $r['target_type'], 'id' => $tid, 'added_by' => $r['added_by'] !== null ? ['id' => (int) $r['added_by'], 'name' => $r['adder']] : null,
                'added_at' => $r['created_at'], 'can_remove' => (int) $r['added_by'] === $uid || $owner === $uid];
            if ($r['target_type'] === 'file') {
                $f = DB::one('SELECT * FROM note_attachments WHERE id = ? AND deleted_at IS NULL', [$tid]);
                if ($f) {
                    $out[] = $base + ['file' => FilesController::present($f), 'title' => $f['original_name']];
                }
            } elseif ($r['target_type'] === 'progress') {
                $p = DB::one('SELECT id, title, percent, status, color, stage FROM progress_items WHERE id = ? AND deleted_at IS NULL', [$tid]);
                if ($p) {
                    $out[] = $base + ['title' => $p['title'], 'percent' => (int) $p['percent'], 'status' => $p['status'], 'stage' => $p['stage'], 'color' => $p['color'], 'link' => '#/progress/' . $tid, 'can_open' => true];
                }
            } else {
                $t = DB::one('SELECT id, title, percent, status, color FROM ptasks WHERE id = ? AND deleted_at IS NULL', [$tid]);
                if ($t) {
                    $out[] = $base + ['title' => $t['title'], 'percent' => (int) $t['percent'], 'status' => $t['status'], 'color' => $t['color'], 'link' => '#/tasks/progress/' . $tid, 'can_open' => PtasksController::involved($tid, $uid)];
                }
            }
        }
        return $out;
    }

    /** What this user may link: own Drive files and files shared with them, Product progress, Team progress they are on. */
    private static function allowed(string $kind, int $tid, int $uid): bool
    {
        return match ($kind) {
            'file' => (bool) DB::val('SELECT 1 FROM note_attachments WHERE id = ? AND deleted_at IS NULL AND (user_id = ? OR id IN (SELECT item_id FROM item_shares WHERE item_type = \'file\' AND user_id = ?))', [$tid, $uid, $uid])
                || (DB::val('SELECT 1 FROM note_attachments WHERE id = ? AND deleted_at IS NULL', [$tid]) && Shares::role('file', $tid, $uid)),
            'progress' => (bool) DB::val('SELECT 1 FROM progress_items WHERE id = ? AND deleted_at IS NULL', [$tid]),
            'ptask' => PtasksController::involved($tid, $uid),
            default => false,
        };
    }

    // ------------------------------------------------------------------ endpoints

    /** GET item-links/{type}/{id} */
    public static function index(string $type, int $id): void
    {
        $u = Auth::require();
        $type = self::check($type);
        if (self::ownerIfVisible($type, $id, (int) $u['id']) === null) {
            throw new HttpException('Not found.', 404);
        }
        Http::ok(self::listFor($type, $id, (int) $u['id']));
    }

    /** GET item-links/{type}/{id}/candidates?kind=file|progress|ptask&q= — what can be picked. */
    public static function candidates(string $type, int $id): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $type = self::check($type);
        if (self::ownerIfVisible($type, $id, $uid) === null) {
            throw new HttpException('Not found.', 404);
        }
        $kind = self::check((string) Http::query('kind', 'file'), 'target');
        $q = V::str(Http::query('q'), 100);
        $like = $q !== null ? '%' . addcslashes($q, '%_\\') . '%' : null;
        $have = array_flip(array_map('intval', DB::col('SELECT target_id FROM item_links WHERE item_type = ? AND item_id = ? AND target_type = ?', [$type, $id, $kind])));
        if ($kind === 'file') {
            $rows = DB::all(
                "SELECT a.* FROM note_attachments a WHERE a.deleted_at IS NULL
                   AND (a.user_id = ? OR a.id IN (SELECT item_id FROM item_shares WHERE item_type = 'file' AND user_id = ?))"
                . ($like ? ' AND a.original_name LIKE ?' : '') . ' ORDER BY a.created_at DESC LIMIT 60',
                $like ? [$uid, $uid, $like] : [$uid, $uid]
            );
            $list = array_map(static fn($r) => ['id' => (int) $r['id'], 'title' => $r['original_name'], 'file' => FilesController::present($r), 'mine' => (int) $r['user_id'] === $uid], $rows);
        } elseif ($kind === 'progress') {
            $rows = DB::all('SELECT id, title, percent, status, color FROM progress_items WHERE deleted_at IS NULL' . ($like ? ' AND title LIKE ?' : '') . ' ORDER BY COALESCE(last_update_at, created_at) DESC LIMIT 60', $like ? [$like] : []);
            $list = array_map(static fn($r) => ['id' => (int) $r['id'], 'title' => $r['title'], 'percent' => (int) $r['percent'], 'status' => $r['status'], 'color' => $r['color']], $rows);
        } else {
            $rows = DB::all(
                'SELECT t.id, t.title, t.percent, t.status, t.color FROM ptasks t WHERE t.deleted_at IS NULL
                   AND (t.user_id = ? OR EXISTS (SELECT 1 FROM ptask_parts p WHERE p.ptask_id = t.id AND p.assignee_id = ?))'
                . ($like ? ' AND t.title LIKE ?' : '') . ' ORDER BY t.updated_at DESC LIMIT 60',
                $like ? [$uid, $uid, $like] : [$uid, $uid]
            );
            $list = array_map(static fn($r) => ['id' => (int) $r['id'], 'title' => $r['title'], 'percent' => (int) $r['percent'], 'status' => $r['status'], 'color' => $r['color']], $rows);
        }
        Http::ok(array_values(array_map(static fn($x) => $x + ['linked' => isset($have[$x['id']])], $list)));
    }

    /** POST item-links/{type}/{id} {target_type, target_id} */
    public static function add(string $type, int $id): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $type = self::check($type);
        if (self::ownerIfVisible($type, $id, $uid) === null) {
            throw new HttpException('Not found.', 404);
        }
        $kind = self::check((string) Http::input('target_type'), 'target');
        $tid = V::id(Http::input('target_id'));
        if (!$tid || !self::allowed($kind, $tid, $uid)) {
            throw new HttpException($kind === 'ptask' ? 'You can only link Team progress tasks you work on.' : ($kind === 'file' ? 'You can only link files you can open.' : 'Not found.'), $kind === 'progress' ? 404 : 403);
        }
        DB::run('INSERT IGNORE INTO item_links (item_type, item_id, target_type, target_id, added_by) VALUES (?, ?, ?, ?, ?)', [$type, $id, $kind, $tid, $uid]);
        Activity::log("$type.link", $type, $id, "Linked $kind #$tid");
        Http::ok(self::listFor($type, $id, $uid));
    }

    /** POST item-links/{type}/{id}/{type}/{id}/remove — the person who added it or the owner of the meeting / event. */
    public static function remove(string $type, int $id, string $kind, int $tid): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $type = self::check($type);
        $kind = self::check($kind, 'target');
        $owner = self::ownerIfVisible($type, $id, $uid);
        if ($owner === null) {
            throw new HttpException('Not found.', 404);
        }
        $by = DB::val('SELECT added_by FROM item_links WHERE item_type = ? AND item_id = ? AND target_type = ? AND target_id = ?', [$type, $id, $kind, $tid]);
        if ($by === false || ($by === null && $owner !== $uid)) {
            throw new HttpException('This link does not exist.', 404);
        }
        if ((int) $by !== $uid && $owner !== $uid) {
            throw new HttpException('Only the person who added it or the owner can remove it.', 403);
        }
        DB::run('DELETE FROM item_links WHERE item_type = ? AND item_id = ? AND target_type = ? AND target_id = ?', [$type, $id, $kind, $tid]);
        Http::ok(self::listFor($type, $id, $uid));
    }
}
