<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Pins for items other than notes (v1.26, flowcharts): pin to the top of my own list (anyone, on anything they can
 * see), pin for everyone (an administrator, on their own item) and pin for chosen people (an administrator, on their
 * own item). An item pinned for everyone or for me can be opened read-only.
 */
final class ItemPins
{
    public const TYPES = [
        'flowchart' => ['table' => 'flowcharts', 'label' => 'flowchart', 'link' => '#/flowcharts/%d'],
    ];

    public static function cfg(string $type): array
    {
        return self::TYPES[$type] ?? throw new HttpException('This item cannot be pinned.', 404);
    }

    /** Read access through a pin (for everyone, or for this user). */
    public static function grants(string $type, int $id, int $userId): bool
    {
        if (!isset(self::TYPES[$type])) {
            return false;
        }
        $t = self::TYPES[$type]['table'];
        return (bool) DB::val(
            "SELECT 1 FROM `$t` i WHERE i.id = ? AND i.deleted_at IS NULL
               AND (i.pinned_global = 1 OR EXISTS (SELECT 1 FROM item_pin_targets t WHERE t.item_type = ? AND t.item_id = i.id AND t.user_id = ?))",
            [$id, $type, $userId]
        );
    }

    /** SQL (with 2 placeholders: type, user) for "pinned for everyone or for me", for list queries on alias $a. */
    public static function visibleSql(string $a): string
    {
        return "($a.pinned_global = 1 OR EXISTS (SELECT 1 FROM item_pin_targets pt WHERE pt.item_type = ? AND pt.item_id = $a.id AND pt.user_id = ?))";
    }

    /** Pin state of each item as this user sees it. */
    public static function forList(string $type, array $ids, int $uid): array
    {
        if (!$ids) {
            return [];
        }
        $t = self::cfg($type)['table'];
        $in = DB::in($ids);
        $out = [];
        foreach (DB::all(
            "SELECT i.id, i.user_id, i.pinned_global, i.pinned_global_at, g.name AS global_by,
                    mp.item_id IS NOT NULL AS mine, mp.created_at AS mine_at,
                    pt.user_id IS NOT NULL AS for_me, pt.created_at AS for_me_at, fb.name AS for_me_by,
                    (SELECT COUNT(*) FROM item_pin_targets c WHERE c.item_type = ? AND c.item_id = i.id) AS targets
             FROM `$t` i LEFT JOIN users g ON g.id = i.pinned_global_by
               LEFT JOIN user_pins mp ON mp.user_id = ? AND mp.kind = ? AND mp.item_id = i.id
               LEFT JOIN item_pin_targets pt ON pt.item_type = ? AND pt.item_id = i.id AND pt.user_id = ?
               LEFT JOIN users fb ON fb.id = pt.pinned_by
             WHERE i.id IN ($in)",
            [$type, $uid, $type, $type, $uid, ...$ids]
        ) as $r) {
            $own = (int) $r['user_id'] === $uid;
            $out[(int) $r['id']] = [
                'pinned' => (bool) $r['mine'], 'pinned_at' => $r['mine_at'],
                'pinned_global' => (bool) (int) $r['pinned_global'], 'pinned_global_at' => $r['pinned_global_at'], 'pinned_global_by' => $r['global_by'],
                'pinned_for_me' => !$own && (bool) $r['for_me'], 'pinned_for_me_at' => $r['for_me_at'], 'pinned_for_me_by' => $r['for_me_by'],
                'pin_target_count' => $own ? (int) $r['targets'] : null,
            ];
        }
        return $out;
    }

    public static function targets(string $type, int $id): array
    {
        return array_map(static fn($r) => ['id' => (int) $r['id'], 'name' => $r['name'], 'email' => $r['email']], DB::all(
            'SELECT u.id, u.name, u.email FROM item_pin_targets t JOIN users u ON u.id = t.user_id WHERE t.item_type = ? AND t.item_id = ? ORDER BY u.name', [$type, $id]
        ));
    }

    /** The pin state of one item for its page (owner also gets the people it is pinned for). */
    public static function state(string $type, int $id, int $uid): array
    {
        $s = self::forList($type, [$id], $uid)[$id] ?? [];
        if (($s['pin_target_count'] ?? null) !== null) {
            $s['pin_targets'] = self::targets($type, $id);
        }
        return $s;
    }

    /** Forget every pin of an item (deleted forever). */
    public static function purge(string $type, int $id): void
    {
        DB::run('DELETE FROM item_pin_targets WHERE item_type = ? AND item_id = ?', [$type, $id]);
        DB::run('DELETE FROM user_pins WHERE kind = ? AND item_id = ?', [$type, $id]);
    }

    // ------------------------------------------------------------------ endpoints

    private static function own(string $type, int $id, int $uid): array
    {
        $t = self::cfg($type)['table'];
        $row = DB::one("SELECT * FROM `$t` WHERE id = ? AND deleted_at IS NULL", [$id]);
        if (!$row || (int) $row['user_id'] !== $uid) {
            throw new HttpException('Only the owner can do this.', 404);
        }
        return $row;
    }

    /** POST pins/{type}/{id} {scope: me|everyone, pinned} */
    public static function pin(string $type, int $id): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $cfg = self::cfg($type);
        $on = V::bool(Http::input('pinned'));
        if (V::enum(Http::input('scope'), ['me', 'everyone'], 'me') === 'me') {
            if (!Shares::role($type, $id, $uid)) {
                throw new HttpException('Not found.', 404);
            }
            if ($on) {
                DB::run('INSERT IGNORE INTO user_pins (user_id, kind, item_id, position) VALUES (?, ?, ?, 0)', [$uid, $type, $id]);
            } else {
                DB::run('DELETE FROM user_pins WHERE user_id = ? AND kind = ? AND item_id = ?', [$uid, $type, $id]);
            }
            Http::ok(self::state($type, $id, $uid));
        }
        if (!Auth::isAdmin()) {
            throw new HttpException('Only administrators can pin for everyone.', 403);
        }
        $row = self::own($type, $id, $uid);
        if ($on && !(int) $row['pinned_global']) {
            DB::run("UPDATE `{$cfg['table']}` SET pinned_global = 1, pinned_global_at = NOW(), pinned_global_by = ?, updated_at = updated_at WHERE id = ?", [$uid, $id]);
            foreach (DB::col("SELECT id FROM users WHERE status = 'active' AND deleted_at IS NULL AND id <> ?", [$uid]) as $to) {
                Notify::create((int) $to, 'share', '📌 ' . $u['name'] . " menyematkan {$cfg['label']} untuk semua: \"{$row['title']}\"", null, sprintf($cfg['link'], $id));
            }
        } elseif (!$on && (int) $row['pinned_global']) {
            DB::run("UPDATE `{$cfg['table']}` SET pinned_global = 0, pinned_global_at = NULL, pinned_global_by = NULL, updated_at = updated_at WHERE id = ?", [$id]);
        }
        Activity::log($on ? "$type.pin_global" : "$type.unpin_global", $type, $id, $row['title']);
        Http::ok(self::state($type, $id, $uid));
    }

    /** POST pins/{type}/{id}/people {user_ids}: the list replaces the previous one, empty = unpin for all of them. */
    public static function people(string $type, int $id): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $cfg = self::cfg($type);
        if (!Auth::isAdmin()) {
            throw new HttpException('Only administrators can pin for other people.', 403);
        }
        $row = self::own($type, $id, $uid);
        $want = array_values(array_filter(array_slice(V::ids(Http::input('user_ids', [])), 0, 500), static fn($v) => $v !== $uid));
        if ($want) {
            $want = array_map('intval', DB::col("SELECT id FROM users WHERE status = 'active' AND deleted_at IS NULL AND id IN (" . DB::in($want) . ')', $want));
        }
        $have = array_map('intval', DB::col('SELECT user_id FROM item_pin_targets WHERE item_type = ? AND item_id = ?', [$type, $id]));
        $gone = array_values(array_diff($have, $want));
        $new = array_values(array_diff($want, $have));
        DB::tx(static function () use ($type, $id, $gone, $new, $uid) {
            if ($gone) {
                DB::run('DELETE FROM item_pin_targets WHERE item_type = ? AND item_id = ? AND user_id IN (' . DB::in($gone) . ')', [$type, $id, ...$gone]);
            }
            foreach ($new as $to) {
                DB::run('INSERT IGNORE INTO item_pin_targets (item_type, item_id, user_id, pinned_by) VALUES (?, ?, ?, ?)', [$type, $id, $to, $uid]);
            }
        });
        foreach ($new as $to) {
            Notify::create($to, 'share', '📌 ' . $u['name'] . " menyematkan {$cfg['label']} untuk Anda: \"{$row['title']}\"", null, sprintf($cfg['link'], $id));
        }
        if ($new || $gone) {
            Activity::log($want ? "$type.pin_people" : "$type.unpin_people", $type, $id, $want ? 'Pinned for ' . count($want) . ' people' : 'Unpinned for people');
        }
        Http::ok(self::state($type, $id, $uid));
    }
}
