<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Team progress (v1.19): work items such as a programmer's feature, from planning to "published".
 * Everyone can see every item and its history. Only the people chosen as updaters post progress
 * (percentage, stage, status and a required reason). The creator — or an administrator — manages
 * the item itself: title, stages, custom fields and who may update.
 */
final class ProgressController
{
    private const STATUSES = ['on_track', 'at_risk', 'blocked', 'done'];
    private const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
    private const MAX_STAGES = 12;
    private const MAX_FIELDS = 12;
    private const MAX_UPDATERS = 40;
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
        $scope = V::enum(Http::query('scope'), ['all', 'mine', 'created', 'published', 'deleted'], 'all');
        $where = [$scope === 'deleted' ? 'p.deleted_at IS NOT NULL' : 'p.deleted_at IS NULL'];
        $params = [];
        if ($scope === 'mine') {
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
            'SELECT p.*, c.name AS creator_name FROM progress_items p LEFT JOIN users c ON c.id = p.user_id
             WHERE ' . implode(' AND ', $where) . '
             ORDER BY (p.percent = 100), FIELD(p.status, \'blocked\', \'at_risk\', \'on_track\', \'done\'), COALESCE(p.last_update_at, p.created_at) DESC LIMIT 500',
            $params
        );
        $ids = array_map(static fn($r) => (int) $r['id'], $rows);
        $people = self::updatersFor($ids);
        $last = [];
        if ($ids) {
            foreach (DB::all(
                'SELECT u.item_id, u.percent, u.percent_from, u.reason, u.created_at, us.name FROM progress_updates u LEFT JOIN users us ON us.id = u.user_id
                 WHERE u.id IN (SELECT MAX(id) FROM progress_updates WHERE item_id IN (' . DB::in($ids) . ') GROUP BY item_id)',
                $ids
            ) as $r) {
                $last[(int) $r['item_id']] = ['percent' => (int) $r['percent'], 'percent_from' => (int) $r['percent_from'], 'reason' => mb_substr((string) $r['reason'], 0, 160), 'at' => $r['created_at'], 'by' => $r['name']];
            }
        }
        $items = array_map(static fn($r) => self::row($r, $people[(int) $r['id']] ?? [], $uid) + ['last' => $last[(int) $r['id']] ?? null], $rows);
        $summary = DB::one(
            "SELECT COUNT(*) AS total, SUM(percent = 100) AS published, SUM(status = 'blocked' AND percent < 100) AS blocked,
                    SUM(status = 'at_risk' AND percent < 100) AS at_risk, SUM(status = 'on_track' AND percent < 100) AS on_track,
                    SUM(due_date < CURDATE() AND percent < 100) AS overdue, ROUND(AVG(percent)) AS avg_percent
             FROM progress_items WHERE deleted_at IS NULL"
        );
        Http::ok(['items' => $items, 'summary' => array_map(static fn($v) => (int) $v, $summary ?: [])]);
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

    private static function row(array $r, array $updaters, int $uid): array
    {
        $isAdmin = Auth::isAdmin();
        return [
            'id' => (int) $r['id'], 'title' => $r['title'], 'description' => $r['description'],
            'stages' => self::stages(json_decode_array($r['stages'])), 'fields' => self::fields(json_decode_array($r['fields'])),
            'percent' => (int) $r['percent'], 'stage' => $r['stage'], 'status' => $r['status'], 'priority' => $r['priority'], 'color' => $r['color'],
            'start_date' => $r['start_date'], 'due_date' => $r['due_date'], 'published_at' => $r['published_at'], 'last_update_at' => $r['last_update_at'],
            'created_at' => $r['created_at'], 'updated_at' => $r['updated_at'], 'deleted_at' => $r['deleted_at'],
            'creator' => ['id' => $r['user_id'] !== null ? (int) $r['user_id'] : null, 'name' => $r['creator_name'] ?? null],
            'updaters' => $updaters,
            'can_update' => !$r['deleted_at'] && in_array($uid, array_column($updaters, 'id'), true),
            'can_manage' => (int) $r['user_id'] === $uid || $isAdmin,
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
        $it['creator_name'] = $it['user_id'] ? DB::val('SELECT name FROM users WHERE id = ?', [$it['user_id']]) : null;
        $out = self::row($it, self::updatersFor([$id])[$id] ?? [], $uid);
        $out['updates'] = array_map(static fn($r) => [
            'id' => (int) $r['id'], 'percent_from' => (int) $r['percent_from'], 'percent' => (int) $r['percent'], 'stage' => $r['stage'],
            'status' => $r['status'], 'reason' => $r['reason'], 'created_at' => $r['created_at'],
            'user' => $r['user_id'] ? ['id' => (int) $r['user_id'], 'name' => $r['name']] : null,
        ], DB::all('SELECT u.*, us.name FROM progress_updates u LEFT JOIN users us ON us.id = u.user_id WHERE u.item_id = ? ORDER BY u.id DESC LIMIT 300', [$id]));
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
        $status = $percent === 100 ? 'done' : V::enum(Http::input('status'), ['on_track', 'at_risk', 'blocked'], $it['status'] === 'done' ? 'on_track' : $it['status']);
        $ts = now();
        DB::tx(static function () use ($id, $uid, $it, $percent, $stage, $status, $reason, $ts) {
            DB::insert('progress_updates', ['item_id' => $id, 'user_id' => $uid, 'percent_from' => (int) $it['percent'], 'percent' => $percent, 'stage' => $stage, 'status' => $status, 'reason' => $reason, 'created_at' => $ts]);
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
