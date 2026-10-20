<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Team progress (v1.19): work items such as a programmer's feature, from planning to "published".
 * Everyone can see every item and its history. Only the people chosen as updaters post progress
 * (percentage, stage, status and a required reason). The creator — or an administrator — manages
 * the item itself: title, stages, custom fields and who may update.
 *
 * v1.25: an item can be split into parts worked on in parallel (e.g. Back-end by one person, Front-end by another,
 * started in any order). Each part has its own people, bar, stage and status; the item percentage is the weighted
 * average of its parts and the item's updaters are everyone working on a part.
 */
final class ProgressController
{
    private const STATUSES = ['on_track', 'at_risk', 'blocked', 'done'];
    private const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
    private const MAX_STAGES = 12;
    private const MAX_FIELDS = 12;
    private const MAX_UPDATERS = 40;
    private const MAX_PARTS = 12;
    public const DEFAULT_STAGES = [
        ['name' => 'Planning', 'percent' => 10], ['name' => 'Design', 'percent' => 25], ['name' => 'Development', 'percent' => 60],
        ['name' => 'Testing', 'percent' => 80], ['name' => 'Review', 'percent' => 90], ['name' => 'Published', 'percent' => 100],
    ];

    // ------------------------------------------------------------------ rules
    private static function item(int $id, bool $withDeleted = false): array
    {
        $it = DB::one('SELECT * FROM progress_items WHERE id = ?' . ($withDeleted ? '' : ' AND deleted_at IS NULL'), [$id]);
        if (!$it) {
            throw new HttpException('This progress item does not exist (anymore).', 404);
        }
        return $it;
    }

    private static function canManage(array $it, int $uid): bool
    {
        return (int) $it['user_id'] === $uid || Auth::isAdmin();
    }

    private static function isUpdater(int $itemId, int $uid): bool
    {
        return (bool) DB::val('SELECT 1 FROM progress_updaters WHERE item_id = ? AND user_id = ?', [$itemId, $uid]);
    }

    /** Stages from start to publish: names, rising percentages, the last one at 100%. */
    public static function stages(mixed $in): array
    {
        if (!is_array($in) || !$in) {
            return self::DEFAULT_STAGES;
        }
        $out = [];
        foreach (array_slice($in, 0, self::MAX_STAGES) as $s) {
            if (!is_array($s)) {
                continue;
            }
            $name = trim(strip_tags((string) ($s['name'] ?? '')));
            if ($name === '') {
                continue;
            }
            $out[] = ['name' => mb_substr($name, 0, 60), 'percent' => max(0, min(100, (int) ($s['percent'] ?? 0)))];
        }
        if (!$out) {
            return self::DEFAULT_STAGES;
        }
        usort($out, static fn($a, $b) => $a['percent'] <=> $b['percent']);
        // One stage per percentage; the final stage is always "done" (100%).
        $uniq = [];
        foreach ($out as $s) {
            $uniq[$s['percent']] = $s;
        }
        $out = array_values($uniq);
        $out[count($out) - 1]['percent'] = 100;
        return $out;
    }

    public static function fields(mixed $in): array
    {
        $out = [];
        foreach (array_slice(is_array($in) ? $in : [], 0, self::MAX_FIELDS) as $f) {
            if (!is_array($f)) {
                continue;
            }
            $label = trim(strip_tags((string) ($f['label'] ?? '')));
            if ($label === '') {
                continue;
            }
            $out[] = ['label' => mb_substr($label, 0, 60), 'value' => mb_substr(trim(strip_tags((string) ($f['value'] ?? ''))), 0, 500)];
        }
        return $out;
    }

    /** The stage a percentage belongs to: the first stage that is not finished yet. */
    public static function stageFor(array $stages, int $percent): string
    {
        foreach ($stages as $s) {
            if ($percent <= $s['percent']) {
                return $s['name'];
            }
        }
        return $stages[count($stages) - 1]['name'];
    }

    // ------------------------------------------------------------------ read
    public static function index(): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $scope = V::enum(Http::query('scope'), ['all', 'pinned', 'mine', 'created', 'published', 'deleted'], 'all');
        $where = [$scope === 'deleted' ? 'p.deleted_at IS NOT NULL' : 'p.deleted_at IS NULL'];
        $params = [];
        if ($scope === 'pinned') {
            $where[] = '(p.pinned_global = 1 OR mp.item_id IS NOT NULL)';
        } elseif ($scope === 'mine') {
            $where[] = 'EXISTS (SELECT 1 FROM progress_updaters x WHERE x.item_id = p.id AND x.user_id = ?)';
            $params[] = $uid;
        } elseif ($scope === 'created') {
            $where[] = 'p.user_id = ?';
            $params[] = $uid;
        } elseif ($scope === 'published') {
            $where[] = 'p.percent = 100';
        } elseif ($scope === 'deleted' && !Auth::isAdmin()) {
            $where[] = 'p.user_id = ?'; // only what I can restore
            $params[] = $uid;
        }
        if (in_array(Http::query('status'), self::STATUSES, true)) {
            $where[] = 'p.status = ?';
            $params[] = Http::query('status');
        }
        if ($q = V::str(Http::query('q'), 100)) {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $where[] = '(p.title LIKE ? OR p.description LIKE ? OR p.fields LIKE ?)';
            array_push($params, $like, $like, $like);
        }
        $rows = DB::all(
            'SELECT p.*, c.name AS creator_name, ' . self::PIN_COLS . ' FROM progress_items p LEFT JOIN users c ON c.id = p.user_id ' . self::pinJoins($uid) . '
             WHERE ' . implode(' AND ', $where) . '
             ORDER BY (p.percent = 100), FIELD(p.status, \'blocked\', \'at_risk\', \'on_track\', \'done\'), COALESCE(p.last_update_at, p.created_at) DESC LIMIT 500',
            $params
        );
        $ids = array_map(static fn($r) => (int) $r['id'], $rows);
        $people = self::updatersFor($ids);
        $parts = self::partsFor($ids);
        $last = [];
        if ($ids) {
            foreach (DB::all(
                'SELECT u.item_id, u.percent, u.percent_from, u.part_title, u.reason, u.created_at, us.name FROM progress_updates u LEFT JOIN users us ON us.id = u.user_id
                 WHERE u.id IN (SELECT MAX(id) FROM progress_updates WHERE item_id IN (' . DB::in($ids) . ') GROUP BY item_id)',
                $ids
            ) as $r) {
                $last[(int) $r['item_id']] = ['percent' => (int) $r['percent'], 'percent_from' => (int) $r['percent_from'], 'part' => $r['part_title'], 'reason' => mb_substr((string) $r['reason'], 0, 160), 'at' => $r['created_at'], 'by' => $r['name']];
            }
        }
        $items = array_map(static fn($r) => self::row($r, $people[(int) $r['id']] ?? [], $uid, $parts[(int) $r['id']] ?? []) + ['last' => $last[(int) $r['id']] ?? null], $rows);
        $summary = DB::one(
            "SELECT COUNT(*) AS total, SUM(percent = 100) AS published, SUM(status = 'blocked' AND percent < 100) AS blocked,
                    SUM(status = 'at_risk' AND percent < 100) AS at_risk, SUM(status = 'on_track' AND percent < 100) AS on_track,
                    SUM(due_date < CURDATE() AND percent < 100) AS overdue, ROUND(AVG(percent)) AS avg_percent
             FROM progress_items WHERE deleted_at IS NULL"
        );
        Http::ok(['items' => $items, 'summary' => array_map(static fn($v) => (int) $v, $summary ?: [])]);
    }

    // ------------------------------------------------------------------ pins & own order (v1.20)
    private const PIN_COLS = 'mp.item_id IS NOT NULL AS my_pin, mp.position AS my_pin_pos, mo.position AS my_order, pb.name AS pinned_by_name';

    private static function pinJoins(int $uid): string
    {
        return "LEFT JOIN user_pins mp ON mp.user_id = $uid AND mp.kind = 'progress' AND mp.item_id = p.id
                LEFT JOIN user_pins mo ON mo.user_id = $uid AND mo.kind = 'progress_order' AND mo.item_id = p.id
                LEFT JOIN users pb ON pb.id = p.pinned_global_by";
    }

    /** Pin for me (anyone) — it shows under "Pinned by me", newest pin on top. */
    public static function pin(int $id): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        self::item($id);
        if (V::bool(Http::input('pinned'))) {
            $top = (int) DB::val("SELECT COALESCE(MIN(position), 0) FROM user_pins WHERE user_id = ? AND kind = 'progress'", [$uid]);
            DB::run("INSERT INTO user_pins (user_id, kind, item_id, position) VALUES (?, 'progress', ?, ?) ON DUPLICATE KEY UPDATE position = position", [$uid, $id, $top - 1]);
        } else {
            DB::run("DELETE FROM user_pins WHERE user_id = ? AND kind = 'progress' AND item_id = ?", [$uid, $id]);
        }
        Http::ok(self::payload($id, $uid));
    }

    /** Pin for everyone (administrators): shown on top for every user with "Pinned by <name>". */
    public static function pinGlobal(int $id): void
    {
        $u = Auth::require();
        if (!Auth::isAdmin()) {
            throw new HttpException('Only administrators can pin an item for everyone.', 403);
        }
        $it = self::item($id);
        $on = V::bool(Http::input('pinned'));
        if ($on && !(int) $it['pinned_global']) {
            $top = (int) DB::val('SELECT COALESCE(MIN(pinned_global_pos), 0) FROM progress_items WHERE pinned_global = 1');
            DB::run('UPDATE progress_items SET pinned_global = 1, pinned_global_at = NOW(), pinned_global_by = ?, pinned_global_pos = ?, updated_at = updated_at WHERE id = ?', [$u['id'], $top - 1, $id]);
        } elseif (!$on) {
            DB::run('UPDATE progress_items SET pinned_global = 0, pinned_global_at = NULL, pinned_global_by = NULL, pinned_global_pos = NULL, updated_at = updated_at WHERE id = ?', [$id]);
        }
        Activity::log($on ? 'progress.pin_global' : 'progress.unpin_global', 'progress', $id, $it['title']);
        Http::ok(self::payload($id, (int) $u['id']));
    }

    /**
     * Save an order after dragging: section "mine" (my pins), "global" (pinned for everyone, administrators)
     * or "all" (my own order of the whole list).
     */
    public static function order(): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $section = V::enum(Http::input('section'), ['mine', 'global', 'all'], 'mine');
        $ids = array_slice(array_values(array_unique(array_filter(array_map('intval', (array) Http::input('ids', [])), static fn($v) => $v > 0))), 0, 500);
        if (!$ids) {
            Http::ok(['ids' => []]);
        }
        $in = DB::in($ids);
        if ($section === 'global') {
            if (!Auth::isAdmin()) {
                throw new HttpException('Only administrators can arrange the items pinned for everyone.', 403);
            }
            $valid = array_map('intval', DB::col("SELECT id FROM progress_items WHERE pinned_global = 1 AND id IN ($in)", $ids));
        } elseif ($section === 'mine') {
            $valid = array_map('intval', DB::col("SELECT item_id FROM user_pins WHERE user_id = ? AND kind = 'progress' AND item_id IN ($in)", [$uid, ...$ids]));
        } else {
            $valid = array_map('intval', DB::col("SELECT id FROM progress_items WHERE deleted_at IS NULL AND id IN ($in)", $ids));
        }
        $ordered = array_values(array_filter($ids, static fn($id) => in_array($id, $valid, true)));
        DB::tx(static function () use ($ordered, $section, $uid) {
            foreach ($ordered as $pos => $id) {
                if ($section === 'global') {
                    DB::run('UPDATE progress_items SET pinned_global_pos = ?, updated_at = updated_at WHERE id = ?', [$pos, $id]);
                } else {
                    DB::run('INSERT INTO user_pins (user_id, kind, item_id, position) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE position = VALUES(position)', [$uid, $section === 'mine' ? 'progress' : 'progress_order', $id, $pos]);
                }
            }
        });
        Http::ok(['ids' => $ordered]);
    }

    private static function updatersFor(array $ids): array
    {
        if (!$ids) {
            return [];
        }
        $out = [];
        foreach (DB::all(
            'SELECT x.item_id, u.id, u.name, p.avatar_path FROM progress_updaters x JOIN users u ON u.id = x.user_id LEFT JOIN user_profiles p ON p.user_id = u.id
             WHERE x.item_id IN (' . DB::in($ids) . ') ORDER BY u.name',
            $ids
        ) as $r) {
            $out[(int) $r['item_id']][] = [
                'id' => (int) $r['id'], 'name' => $r['name'],
                'avatar_url' => $r['avatar_path'] ? 'api/index.php?route=profile/avatar/' . $r['id'] . '&v=' . substr(md5($r['avatar_path']), 0, 8) : null,
            ];
        }
        return $out;
    }

    /** The parts of each item with their people (v1.25), in their order. */
    private static function partsFor(array $ids): array
    {
        if (!$ids) {
            return [];
        }
        $rows = DB::all('SELECT * FROM progress_parts WHERE item_id IN (' . DB::in($ids) . ') ORDER BY item_id, position, id', $ids);
        $people = [];
        if ($rows) {
            $pids = array_map(static fn($r) => (int) $r['id'], $rows);
            foreach (DB::all(
                'SELECT x.part_id, u.id, u.name, pr.avatar_path FROM progress_part_people x JOIN users u ON u.id = x.user_id LEFT JOIN user_profiles pr ON pr.user_id = u.id
                 WHERE x.part_id IN (' . DB::in($pids) . ') ORDER BY u.name',
                $pids
            ) as $r) {
                $people[(int) $r['part_id']][] = [
                    'id' => (int) $r['id'], 'name' => $r['name'],
                    'avatar_url' => $r['avatar_path'] ? 'api/index.php?route=profile/avatar/' . $r['id'] . '&v=' . substr(md5($r['avatar_path']), 0, 8) : null,
                ];
            }
        }
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['item_id']][] = [
                'id' => (int) $r['id'], 'title' => $r['title'], 'weight' => (int) $r['weight'], 'percent' => (int) $r['percent'],
                'stage' => $r['stage'], 'status' => $r['status'], 'last_update_at' => $r['last_update_at'], 'done_at' => $r['done_at'],
                'people' => $people[(int) $r['id']] ?? [],
            ];
        }
        return $out;
    }

    private static function row(array $r, array $updaters, int $uid, array $parts = []): array
    {
        $isAdmin = Auth::isAdmin();
        $mine = array_values(array_map(static fn($p) => $p['id'], array_filter($parts, static fn($p) => in_array($uid, array_column($p['people'], 'id'), true))));
        return [
            'id' => (int) $r['id'], 'title' => $r['title'], 'description' => $r['description'],
            'stages' => self::stages(json_decode_array($r['stages'])), 'fields' => self::fields(json_decode_array($r['fields'])),
            'percent' => (int) $r['percent'], 'stage' => $r['stage'], 'status' => $r['status'], 'priority' => $r['priority'], 'color' => $r['color'],
            'start_date' => $r['start_date'], 'due_date' => $r['due_date'], 'published_at' => $r['published_at'], 'last_update_at' => $r['last_update_at'],
            'created_at' => $r['created_at'], 'updated_at' => $r['updated_at'], 'deleted_at' => $r['deleted_at'],
            'creator' => ['id' => $r['user_id'] !== null ? (int) $r['user_id'] : null, 'name' => $r['creator_name'] ?? null],
            'updaters' => $updaters,
            'parts' => $parts,
            'my_parts' => $mine,
            'can_update' => !$r['deleted_at'] && ($parts ? (bool) $mine : in_array($uid, array_column($updaters, 'id'), true)),
            'can_manage' => (int) $r['user_id'] === $uid || $isAdmin,
            'pinned' => !empty($r['my_pin']),
            'pin_pos' => isset($r['my_pin_pos']) ? (int) $r['my_pin_pos'] : null,
            'order_pos' => isset($r['my_order']) ? (int) $r['my_order'] : null,
            'pinned_global' => !empty($r['pinned_global']),
            'pinned_global_pos' => isset($r['pinned_global_pos']) ? (int) $r['pinned_global_pos'] : null,
            'pinned_by' => !empty($r['pinned_global']) ? ['id' => $r['pinned_global_by'] !== null ? (int) $r['pinned_global_by'] : null, 'name' => $r['pinned_by_name'] ?? null, 'at' => $r['pinned_global_at']] : null,
        ];
    }

    public static function show(int $id): void
    {
        $u = Auth::require();
        Http::ok(self::payload($id, (int) $u['id']));
    }

    public static function payload(int $id, int $uid): array
    {
        $it = self::item($id, true);
        if ($it['deleted_at'] && !self::canManage($it, $uid)) {
            throw new HttpException('This progress item does not exist (anymore).', 404);
        }
        $it += DB::one('SELECT ' . self::PIN_COLS . ' FROM progress_items p ' . self::pinJoins($uid) . ' WHERE p.id = ?', [$id]) ?: [];
        $it['creator_name'] = $it['user_id'] ? DB::val('SELECT name FROM users WHERE id = ?', [$it['user_id']]) : null;
        $out = self::row($it, self::updatersFor([$id])[$id] ?? [], $uid, self::partsFor([$id])[$id] ?? []);
        $out['updates'] = array_map(static fn($r) => [
            'id' => (int) $r['id'], 'percent_from' => (int) $r['percent_from'], 'percent' => (int) $r['percent'], 'stage' => $r['stage'],
            'part' => $r['part_title'] !== null ? ['id' => $r['part_id'] !== null ? (int) $r['part_id'] : null, 'title' => $r['part_title']] : null,
            'item_percent' => $r['item_percent'] !== null ? (int) $r['item_percent'] : (int) $r['percent'],
            'status' => $r['status'], 'reason' => $r['reason'], 'created_at' => $r['created_at'],
            'user' => $r['user_id'] ? ['id' => (int) $r['user_id'], 'name' => $r['name']] : null,
        ], DB::all('SELECT u.*, us.name FROM progress_updates u LEFT JOIN users us ON us.id = u.user_id WHERE u.item_id = ? ORDER BY u.id DESC LIMIT 300', [$id]));
        // v1.22: reference notes of the project (everyone opens them read-only); creator / admin / updaters add them
        $out['notes'] = $it['deleted_at'] ? [] : ItemNotesController::listFor('progress', $id, $uid);
        $out['can_add_notes'] = !$it['deleted_at'] && ($out['can_manage'] || $out['can_update']);
        return $out;
    }

    // ------------------------------------------------------------------ write
    public static function store(): void
    {
        $u = Auth::require();
        $in = Http::body();
        $stages = self::stages($in['stages'] ?? null);
        $id = DB::tx(static function () use ($u, $in, $stages) {
            $id = DB::insert('progress_items', self::fieldsFrom($in, $stages) + [
                'user_id' => $u['id'], 'percent' => 0, 'stage' => $stages[0]['name'],
            ]);
            self::setUpdaters($id, $in['updater_ids'] ?? [$u['id']], $u, (string) $in['title']);
            if (!empty($in['parts']) && is_array($in['parts'])) {
                self::setParts($id, $in['parts'], $u);
            }
            return $id;
        });
        Activity::log('progress.create', 'progress', $id, (string) V::str($in['title'] ?? '', 255));
        Http::ok(self::payload($id, (int) $u['id']));
    }

    private static function fieldsFrom(array $in, array $stages): array
    {
        return [
            'title' => V::str($in['title'] ?? null, 255, true, 'title'),
            'description' => V::str($in['description'] ?? null, 5000),
            'stages' => json_encode($stages, JSON_UNESCAPED_UNICODE),
            'fields' => json_encode(self::fields($in['fields'] ?? []), JSON_UNESCAPED_UNICODE),
            'priority' => V::enum($in['priority'] ?? null, self::PRIORITIES, 'medium'),
            'color' => V::color($in['color'] ?? null),
            'start_date' => V::date($in['start_date'] ?? null),
            'due_date' => V::date($in['due_date'] ?? null),
        ];
    }

    /** Who may post progress. New people are told about it. */
    private static function setUpdaters(int $id, mixed $ids, array $by, string $title): void
    {
        $want = array_slice(V::ids($ids), 0, self::MAX_UPDATERS);
        if ($want) {
            $want = array_map('intval', DB::col("SELECT id FROM users WHERE status = 'active' AND deleted_at IS NULL AND id IN (" . DB::in($want) . ')', $want));
        }
        $have = array_map('intval', DB::col('SELECT user_id FROM progress_updaters WHERE item_id = ?', [$id]));
        $gone = array_values(array_diff($have, $want));
        if ($gone) {
            DB::run('DELETE FROM progress_updaters WHERE item_id = ? AND user_id IN (' . DB::in($gone) . ')', array_merge([$id], $gone));
        }
        foreach (array_diff($want, $have) as $uid) {
            DB::run('INSERT IGNORE INTO progress_updaters (item_id, user_id) VALUES (?, ?)', [$id, $uid]);
            if ($uid !== (int) $by['id']) {
                Notify::create($uid, 'progress', "{$by['name']} menunjuk Anda meng-update progres \"{$title}\"", 'Buka item ini untuk mencatat persentase dan alasannya.', '#/progress/' . $id);
            }
        }
    }

    /**
     * Replace the parts of an item (v1.25): [{id?, title, weight, user_ids}]. Kept parts keep their progress; a new part
     * starts at 0 — except when an item with progress is split for the first time, then every part starts where the
     * item was, so the work already done is not lost. With parts, the item's updaters are everyone on a part.
     */
    private static function setParts(int $id, array $parts, array $by): void
    {
        $it = self::item($id);
        $have = [];
        foreach (DB::all('SELECT id FROM progress_parts WHERE item_id = ?', [$id]) as $r) {
            $have[(int) $r['id']] = true;
        }
        $clean = [];
        foreach (array_slice($parts, 0, self::MAX_PARTS) as $p) {
            if (!is_array($p)) {
                continue;
            }
            $title = mb_substr(trim(strip_tags((string) ($p['title'] ?? ''))), 0, 120);
            if ($title === '') {
                continue;
            }
            $ids = array_slice(V::ids($p['user_ids'] ?? []), 0, self::MAX_UPDATERS);
            if ($ids) {
                $ids = array_map('intval', DB::col("SELECT id FROM users WHERE status = 'active' AND deleted_at IS NULL AND id IN (" . DB::in($ids) . ')', $ids));
            }
            if (!$ids) {
                throw new HttpException("Choose who works on the part \"$title\".", 422, ['parts' => true]);
            }
            $pid = (int) ($p['id'] ?? 0);
            $clean[] = ['id' => isset($have[$pid]) ? $pid : 0, 'title' => $title, 'weight' => max(1, min(5, (int) ($p['weight'] ?? 1))), 'users' => $ids];
        }
        $stages = self::stages(json_decode_array($it['stages']));
        $start = !$have && (int) $it['percent'] > 0 ? min(99, (int) $it['percent']) : 0; // first split of an item that already has progress
        $keep = array_filter(array_column($clean, 'id'));
        $gone = array_values(array_diff(array_keys($have), $keep));
        if ($gone) {
            DB::run('DELETE FROM progress_parts WHERE item_id = ? AND id IN (' . DB::in($gone) . ')', [$id, ...$gone]);
        }
        $title = (string) $it['title'];
        foreach ($clean as $pos => $p) {
            if ($p['id']) {
                DB::run('UPDATE progress_parts SET title = ?, weight = ?, position = ? WHERE id = ?', [$p['title'], $p['weight'], $pos, $p['id']]);
                $pid = $p['id'];
                $old = array_map('intval', DB::col('SELECT user_id FROM progress_part_people WHERE part_id = ?', [$pid]));
            } else {
                $pid = DB::insert('progress_parts', ['item_id' => $id, 'title' => $p['title'], 'weight' => $p['weight'], 'position' => $pos,
                    'percent' => $start, 'stage' => self::stageFor($stages, $start), 'status' => $start ? $it['status'] : 'on_track']);
                $old = [];
            }
            $drop = array_values(array_diff($old, $p['users']));
            if ($drop) {
                DB::run('DELETE FROM progress_part_people WHERE part_id = ? AND user_id IN (' . DB::in($drop) . ')', [$pid, ...$drop]);
            }
            foreach (array_diff($p['users'], $old) as $uid) {
                DB::run('INSERT IGNORE INTO progress_part_people (part_id, user_id) VALUES (?, ?)', [$pid, $uid]);
                if ($uid !== (int) $by['id']) {
                    Notify::create($uid, 'progress', "{$by['name']} menunjuk Anda mengerjakan \"{$p['title']}\" di \"{$title}\"", 'Buka item ini untuk mencatat progres bagian Anda.', '#/progress/' . $id);
                }
            }
        }
        if ($clean) {
            // the updaters of an item with parts = everyone working on a part (lists, "I update", notifications)
            $all = array_map('intval', DB::col('SELECT DISTINCT x.user_id FROM progress_part_people x JOIN progress_parts p ON p.id = x.part_id WHERE p.item_id = ?', [$id]));
            DB::run('DELETE FROM progress_updaters WHERE item_id = ?' . ($all ? ' AND user_id NOT IN (' . DB::in($all) . ')' : ''), [$id, ...$all]);
            foreach ($all as $uid) {
                DB::run('INSERT IGNORE INTO progress_updaters (item_id, user_id) VALUES (?, ?)', [$id, $uid]);
            }
        }
        self::recompute($id);
    }

    /**
     * Item percentage, stage and status from its parts: weighted average (100% only when every part is done),
     * the most serious status of the unfinished parts. Returns the new percentage (unchanged without parts).
     */
    private static function recompute(int $id): int
    {
        $it = self::item($id, true);
        $parts = DB::all('SELECT id, weight, percent, status FROM progress_parts WHERE item_id = ?', [$id]);
        if (!$parts) {
            return (int) $it['percent'];
        }
        $stages = self::stages(json_decode_array($it['stages']));
        $w = 0;
        $sum = 0;
        $done = true;
        $open = [];
        foreach ($parts as $p) {
            $w += (int) $p['weight'];
            $sum += (int) $p['weight'] * (int) $p['percent'];
            if ((int) $p['percent'] < 100) {
                $done = false;
                $open[] = $p['status'];
            }
            DB::run('UPDATE progress_parts SET stage = ? WHERE id = ?', [self::stageFor($stages, (int) $p['percent']), $p['id']]);
        }
        $percent = $done ? 100 : min(99, (int) round($sum / max(1, $w)));
        $status = $done ? 'done' : (in_array('blocked', $open, true) ? 'blocked' : (in_array('at_risk', $open, true) ? 'at_risk' : 'on_track'));
        $ts = now();
        DB::run('UPDATE progress_items SET percent = ?, stage = ?, status = ?, published_at = ?, updated_at = updated_at WHERE id = ?', [
            $percent, self::stageFor($stages, $percent), $status, $done ? ($it['published_at'] ?: $ts) : null, $id,
        ]);
        return $percent;
    }

    public static function update(int $id): void
    {
        $u = Auth::require();
        $it = self::item($id);
        if (!self::canManage($it, (int) $u['id'])) {
            throw new HttpException('Only the creator or an administrator can change this item.', 403);
        }
        $in = Http::body();
        $stages = array_key_exists('stages', $in) ? self::stages($in['stages']) : self::stages(json_decode_array($it['stages']));
        $data = array_intersect_key(self::fieldsFrom($in + ['title' => $it['title']], $stages), array_flip(array_merge(['stages'], array_keys($in))));
        if (array_key_exists('stages', $in)) {
            $data['stage'] = self::stageFor($stages, (int) $it['percent']);
        }
        DB::tx(static function () use ($id, $data, $in, $u, $it) {
            if ($data) {
                DB::update('progress_items', $data, 'id = ?', [$id]);
            }
            if (array_key_exists('updater_ids', $in)) {
                self::setUpdaters($id, $in['updater_ids'], $u, (string) ($data['title'] ?? $it['title']));
            }
            if (array_key_exists('parts', $in)) {
                self::setParts($id, is_array($in['parts']) ? $in['parts'] : [], $u);
            } elseif (array_key_exists('stages', $data)) {
                self::recompute($id); // the stage names of the parts follow the new stages
            }
        });
        Activity::log('progress.edit', 'progress', $id, 'Edited progress item');
        Http::ok(self::payload($id, (int) $u['id']));
    }

    /** Post progress: only the chosen updaters. A reason is required for every change. */
    public static function addUpdate(int $id): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $it = self::item($id);
        if (!self::isUpdater($id, $uid)) {
            throw new HttpException('Only the people chosen for this item can update its progress.', 403);
        }
        $raw = Http::input('percent');
        $percent = is_numeric($raw) && (float) $raw >= 0 && (float) $raw <= 100 ? (int) round((float) $raw) : null; // never clamp silently
        if ($percent === null) {
            throw new HttpException('Enter a percentage from 0 to 100.', 422, ['percent' => true]);
        }
        $reason = trim((string) V::str(Http::input('reason'), 2000));
        if (mb_strlen($reason) < 3) {
            throw new HttpException('Write the reason for this update (what was done, or why it changed).', 422, ['reason' => true]);
        }
        $stages = self::stages(json_decode_array($it['stages']));
        $names = array_column($stages, 'name');
        $stage = in_array(Http::input('stage'), $names, true) ? (string) Http::input('stage') : self::stageFor($stages, $percent);
        $ts = now();
        // v1.25: an item with parts is updated part by part, each by the people working on it
        $part = null;
        if (DB::val('SELECT 1 FROM progress_parts WHERE item_id = ? LIMIT 1', [$id])) {
            $mine = DB::all('SELECT p.* FROM progress_parts p JOIN progress_part_people x ON x.part_id = p.id AND x.user_id = ? WHERE p.item_id = ? ORDER BY p.position', [$uid, $id]);
            $want = V::id(Http::input('part_id'));
            $part = $want ? (array_values(array_filter($mine, static fn($p) => (int) $p['id'] === $want))[0] ?? null) : (count($mine) === 1 ? $mine[0] : null);
            if (!$part) {
                throw new HttpException($want ? 'Only the people working on this part can update it.' : 'Choose the part you are updating.', $want ? 403 : 422, ['part_id' => true]);
            }
            $status = $percent === 100 ? 'done' : V::enum(Http::input('status'), ['on_track', 'at_risk', 'blocked'], $part['status'] === 'done' ? 'on_track' : $part['status']);
            $itemPercent = DB::tx(static function () use ($id, $uid, $part, $percent, $stage, $status, $reason, $ts, $it) {
                DB::update('progress_parts', ['percent' => $percent, 'stage' => $stage, 'status' => $status, 'last_update_at' => $ts,
                    'done_at' => $percent === 100 ? ($part['done_at'] ?: $ts) : null], 'id = ?', [$part['id']]);
                $now = self::recompute($id);
                DB::insert('progress_updates', ['item_id' => $id, 'user_id' => $uid, 'part_id' => $part['id'], 'part_title' => $part['title'], 'item_percent' => $now,
                    'percent_from' => (int) $part['percent'], 'percent' => $percent, 'stage' => $stage, 'status' => $status, 'reason' => $reason, 'created_at' => $ts]);
                DB::update('progress_items', ['last_update_at' => $ts, 'start_date' => $it['start_date'] ?: ($percent > 0 ? substr($ts, 0, 10) : null)], 'id = ?', [$id]);
                return $now;
            });
            $tell = array_map('intval', DB::col('SELECT user_id FROM progress_updaters WHERE item_id = ?', [$id]));
            if ($it['user_id']) {
                $tell[] = (int) $it['user_id'];
            }
            $label = $itemPercent === 100 ? '🚀 published (100%)' : "{$part['title']} {$percent}% · total {$itemPercent}%";
            foreach (array_unique($tell) as $to) {
                if ($to !== $uid) {
                    Notify::create($to, 'progress', "{$u['name']} meng-update \"{$it['title']}\": {$label}", mb_substr($reason, 0, 180), '#/progress/' . $id);
                }
            }
            Activity::log('progress.update', 'progress', $id, "{$part['title']}: {$part['percent']}% → {$percent}%");
            Http::ok(self::payload($id, $uid));
        }
        $status = $percent === 100 ? 'done' : V::enum(Http::input('status'), ['on_track', 'at_risk', 'blocked'], $it['status'] === 'done' ? 'on_track' : $it['status']);
        DB::tx(static function () use ($id, $uid, $it, $percent, $stage, $status, $reason, $ts) {
            DB::insert('progress_updates', ['item_id' => $id, 'user_id' => $uid, 'percent_from' => (int) $it['percent'], 'percent' => $percent, 'item_percent' => $percent, 'stage' => $stage, 'status' => $status, 'reason' => $reason, 'created_at' => $ts]);
            DB::update('progress_items', [
                'percent' => $percent, 'stage' => $stage, 'status' => $status, 'last_update_at' => $ts,
                'published_at' => $percent === 100 ? ($it['published_at'] ?: $ts) : null,
                'start_date' => $it['start_date'] ?: ($percent > 0 ? substr($ts, 0, 10) : null),
            ], 'id = ?', [$id]);
        });
        // Tell the creator and the other updaters.
        $tell = array_map('intval', DB::col('SELECT user_id FROM progress_updaters WHERE item_id = ?', [$id]));
        if ($it['user_id']) {
            $tell[] = (int) $it['user_id'];
        }
        $label = $percent === 100 ? '🚀 published (100%)' : "{$percent}% · {$stage}";
        foreach (array_unique($tell) as $to) {
            if ($to !== $uid) {
                Notify::create($to, 'progress', "{$u['name']} meng-update \"{$it['title']}\": {$label}", mb_substr($reason, 0, 180), '#/progress/' . $id);
            }
        }
        Activity::log('progress.update', 'progress', $id, "{$it['percent']}% → {$percent}%");
        Http::ok(self::payload($id, $uid));
    }

    public static function destroy(int $id): void
    {
        $u = Auth::require();
        $it = self::item($id);
        if (!self::canManage($it, (int) $u['id'])) {
            throw new HttpException('Only the creator or an administrator can delete this item.', 403);
        }
        DB::run('UPDATE progress_items SET deleted_at = NOW() WHERE id = ?', [$id]);
        Activity::log('progress.delete', 'progress', $id, 'Deleted progress item');
        Http::ok(['id' => $id]);
    }

    public static function restore(int $id): void
    {
        $u = Auth::require();
        $it = self::item($id, true);
        if (!self::canManage($it, (int) $u['id'])) {
            throw new HttpException('Only the creator or an administrator can restore this item.', 403);
        }
        DB::run('UPDATE progress_items SET deleted_at = NULL WHERE id = ?', [$id]);
        Http::ok(self::payload($id, (int) $u['id']));
    }
}
