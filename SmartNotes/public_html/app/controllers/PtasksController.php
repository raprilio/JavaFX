<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Progress tasks (v1.22) — for management or for yourself, e.g. "Event preparation". A task is split into parts;
 * every part has its own bar and one person who fills it (nobody else can). A part can require a hand-in ("setor"):
 * its person hands in a message, files and notes, and the task's owner approves it (or sends it back). The task's
 * percentage is the weighted average of its parts; at 100 % it is completed. Only the owner and the people working
 * on a task can see it.
 */
final class PtasksController
{
    private const MAX_PARTS = 40;

    /** The owner or someone with a part (the task is not deleted). */
    public static function involved(int $id, int $uid): bool
    {
        return (bool) DB::val(
            'SELECT 1 FROM ptasks t WHERE t.id = ? AND t.deleted_at IS NULL
               AND (t.user_id = ? OR EXISTS (SELECT 1 FROM ptask_parts p WHERE p.ptask_id = t.id AND p.assignee_id = ?))',
            [$id, $uid, $uid]
        );
    }

    private static function task(int $id, int $uid, bool $withDeleted = false): array
    {
        $t = DB::one('SELECT * FROM ptasks WHERE id = ?' . ($withDeleted ? '' : ' AND deleted_at IS NULL'), [$id]);
        $mine = $t && ((int) $t['user_id'] === $uid || DB::val('SELECT 1 FROM ptask_parts WHERE ptask_id = ? AND assignee_id = ?', [$id, $uid]));
        if (!$t || !$mine || ($t['deleted_at'] && (int) $t['user_id'] !== $uid)) {
            throw new HttpException('This task does not exist (anymore).', 404);
        }
        return $t;
    }

    private static function part(int $taskId, int $partId): array
    {
        $p = DB::one('SELECT * FROM ptask_parts WHERE id = ? AND ptask_id = ?', [$partId, $taskId]);
        if (!$p) {
            throw new HttpException('This part does not exist (anymore).', 404);
        }
        return $p;
    }

    /** What a part counts for: a part that must be handed in reaches 100 % only once it is approved. */
    private static function effective(array $p): int
    {
        $pct = (int) $p['percent'];
        if ((int) $p['needs_submission']) {
            return $p['submission'] === 'approved' ? 100 : min($pct, 99);
        }
        return $pct;
    }

    private static function people(array $ids): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
        if (!$ids) {
            return [];
        }
        $out = [];
        foreach (DB::all('SELECT u.id, u.name, p.avatar_path FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id IN (' . DB::in($ids) . ')', $ids) as $r) {
            $out[(int) $r['id']] = [
                'id' => (int) $r['id'], 'name' => $r['name'],
                'avatar_url' => $r['avatar_path'] ? 'api/index.php?route=profile/avatar/' . $r['id'] . '&v=' . substr(md5($r['avatar_path']), 0, 8) : null,
            ];
        }
        return $out;
    }

    /** Recalculate the task's percentage; announce it when it reaches 100 %. */
    private static function recompute(int $id, ?array $actor = null): void
    {
        $parts = DB::all('SELECT * FROM ptask_parts WHERE ptask_id = ?', [$id]);
        $w = 0;
        $sum = 0;
        foreach ($parts as $p) {
            $w += max(1, (int) $p['weight']);
            $sum += max(1, (int) $p['weight']) * self::effective($p);
        }
        $pct = $w ? (int) floor($sum / $w + 0.5) : 0;
        if ($pct === 100 && $sum < 100 * $w) {
            $pct = 99; // never round up to "complete"
        }
        $t = DB::one('SELECT * FROM ptasks WHERE id = ?', [$id]);
        $done = $parts && $pct === 100;
        DB::run('UPDATE ptasks SET percent = ?, status = ?, completed_at = ? WHERE id = ?', [
            $pct, $done ? 'done' : 'open', $done ? ($t['completed_at'] ?: now()) : null, $id,
        ]);
        if ($done && $t['status'] !== 'done') {
            $who = array_unique(array_merge([(int) $t['user_id']], array_map('intval', array_filter(array_column($parts, 'assignee_id')))));
            foreach ($who as $to) {
                if (!$actor || $to !== (int) $actor['id']) {
                    Notify::create($to, 'ptask', '🎉 "' . $t['title'] . '" selesai 100%', null, '#/tasks/progress/' . $id);
                }
            }
            Activity::log('ptask.complete', 'ptask', $id, 'Completed (100%)');
        }
    }

    // ------------------------------------------------------------------ read
    public static function index(): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $scope = V::enum(Http::query('scope'), ['all', 'todo', 'created', 'done', 'deleted'], 'all');
        $where = $scope === 'deleted'
            ? ['t.deleted_at IS NOT NULL', 't.user_id = ?']
            : ['t.deleted_at IS NULL', '(t.user_id = ? OR EXISTS (SELECT 1 FROM ptask_parts x WHERE x.ptask_id = t.id AND x.assignee_id = ?))'];
        $params = $scope === 'deleted' ? [$uid] : [$uid, $uid];
        if ($scope === 'todo') {
            $where[] = "EXISTS (SELECT 1 FROM ptask_parts x WHERE x.ptask_id = t.id AND x.assignee_id = ? AND NOT (x.submission = 'approved' OR (x.needs_submission = 0 AND x.percent = 100)))";
            $params[] = $uid;
        } elseif ($scope === 'created') {
            $where[] = 't.user_id = ?';
            $params[] = $uid;
        } elseif ($scope === 'done') {
            $where[] = "t.status = 'done'";
        }
        if ($q = V::str(Http::query('q'), 100)) {
            $where[] = '(t.title LIKE ? OR t.description LIKE ?)';
            $like = '%' . addcslashes($q, '%_\\') . '%';
            array_push($params, $like, $like);
        }
        $rows = DB::all(
            'SELECT t.*, o.name AS owner_name FROM ptasks t LEFT JOIN users o ON o.id = t.user_id WHERE ' . implode(' AND ', $where) . "
             ORDER BY t.status = 'done', t.due_date IS NULL, t.due_date, t.updated_at DESC LIMIT 300",
            $params
        );
        $ids = array_map(static fn($r) => (int) $r['id'], $rows);
        $parts = [];
        if ($ids) {
            foreach (DB::all('SELECT * FROM ptask_parts WHERE ptask_id IN (' . DB::in($ids) . ') ORDER BY position, id', $ids) as $p) {
                $parts[(int) $p['ptask_id']][] = $p;
            }
        }
        $people = self::people(array_merge(...array_map(static fn($l) => array_column($l, 'assignee_id'), array_values($parts ?: [[]]))));
        $items = array_map(static function ($t) use ($parts, $uid, $people) {
            $ps = $parts[(int) $t['id']] ?? [];
            $mine = array_values(array_filter($ps, static fn($p) => (int) $p['assignee_id'] === $uid));
            return [
                'id' => (int) $t['id'], 'title' => $t['title'], 'description' => $t['description'], 'color' => $t['color'], 'due_date' => $t['due_date'],
                'percent' => (int) $t['percent'], 'status' => $t['status'], 'completed_at' => $t['completed_at'], 'updated_at' => $t['updated_at'], 'deleted_at' => $t['deleted_at'],
                'owner' => ['id' => (int) $t['user_id'], 'name' => $t['owner_name']], 'is_owner' => (int) $t['user_id'] === $uid,
                'parts_total' => count($ps), 'parts_done' => count(array_filter($ps, static fn($p) => self::effective($p) === 100)),
                'waiting_review' => (int) $t['user_id'] === $uid ? count(array_filter($ps, static fn($p) => $p['submission'] === 'submitted')) : 0,
                'my_parts' => array_map(static fn($p) => ['id' => (int) $p['id'], 'title' => $p['title'], 'percent' => (int) $p['percent'], 'effective' => self::effective($p), 'needs_submission' => (bool) (int) $p['needs_submission'], 'submission' => $p['submission']], $mine),
                'people' => array_values(array_filter(array_map(static fn($id) => $people[$id] ?? null, array_values(array_unique(array_map('intval', array_filter(array_column($ps, 'assignee_id')))))))),
            ];
        }, $rows);
        $todo = (int) DB::val(
            "SELECT COUNT(*) FROM ptask_parts x JOIN ptasks t ON t.id = x.ptask_id AND t.deleted_at IS NULL
             WHERE x.assignee_id = ? AND NOT (x.submission = 'approved' OR (x.needs_submission = 0 AND x.percent = 100)) AND x.submission <> 'submitted'",
            [$uid]
        );
        $review = (int) DB::val("SELECT COUNT(*) FROM ptask_parts x JOIN ptasks t ON t.id = x.ptask_id AND t.deleted_at IS NULL WHERE t.user_id = ? AND x.submission = 'submitted'", [$uid]);
        Http::ok(['items' => $items, 'summary' => ['my_open_parts' => $todo, 'waiting_review' => $review]]);
    }

    public static function show(int $id): void
    {
        $u = Auth::require();
        Http::ok(self::payload($id, (int) $u['id']));
    }

    public static function payload(int $id, int $uid): array
    {
        $t = self::task($id, $uid, true);
        $isOwner = (int) $t['user_id'] === $uid;
        $parts = DB::all('SELECT * FROM ptask_parts WHERE ptask_id = ? ORDER BY position, id', [$id]);
        $people = self::people(array_merge([(int) $t['user_id']], array_column($parts, 'assignee_id')));
        $files = [];
        foreach (FilesController::forItem('ptask_id', $id) as $f) {
            $files[$f['id']] = $f;
        }
        $updates = DB::all(
            'SELECT u.*, us.name AS user_name, p.title AS part_title FROM ptask_updates u LEFT JOIN users us ON us.id = u.user_id
             LEFT JOIN ptask_parts p ON p.id = u.part_id WHERE u.ptask_id = ? ORDER BY u.id DESC LIMIT 300',
            [$id]
        );
        $noteIds = array_values(array_unique(array_merge(...array_map(static fn($r) => array_map('intval', json_decode_array($r['notes'])), $updates ?: [['notes' => null]]))));
        $noteTitles = $noteIds ? array_column(DB::all('SELECT id, title FROM notes WHERE deleted_at IS NULL AND id IN (' . DB::in($noteIds) . ')', $noteIds), 'title', 'id') : [];
        return [
            'id' => (int) $t['id'], 'title' => $t['title'], 'description' => $t['description'], 'color' => $t['color'], 'due_date' => $t['due_date'],
            'percent' => (int) $t['percent'], 'status' => $t['status'], 'completed_at' => $t['completed_at'],
            'created_at' => $t['created_at'], 'updated_at' => $t['updated_at'], 'deleted_at' => $t['deleted_at'],
            'owner' => $people[(int) $t['user_id']] ?? ['id' => (int) $t['user_id'], 'name' => '—', 'avatar_url' => null],
            'can_manage' => $isOwner && !$t['deleted_at'],
            'parts' => array_map(static function ($p) use ($uid, $isOwner, $people, $t) {
                $mine = (int) $p['assignee_id'] === $uid && !$t['deleted_at'];
                $locked = in_array($p['submission'], ['submitted', 'approved'], true);
                return [
                    'id' => (int) $p['id'], 'title' => $p['title'], 'weight' => (int) $p['weight'], 'percent' => (int) $p['percent'], 'effective' => self::effective($p),
                    'needs_submission' => (bool) (int) $p['needs_submission'], 'submission' => $p['submission'], 'due_date' => $p['due_date'], 'done_at' => $p['done_at'],
                    'assignee' => $p['assignee_id'] !== null ? ($people[(int) $p['assignee_id']] ?? null) : null,
                    'mine' => $mine,
                    'can_update' => $mine && !$locked,
                    'can_submit' => $mine && (int) $p['needs_submission'] && !$locked,
                    'can_review' => $isOwner && !$t['deleted_at'] && $p['submission'] === 'submitted',
                ];
            }, $parts),
            'updates' => array_map(static fn($r) => [
                'id' => (int) $r['id'], 'part_id' => $r['part_id'] !== null ? (int) $r['part_id'] : null, 'part_title' => $r['part_title'],
                'kind' => $r['kind'], 'percent_from' => $r['percent_from'] !== null ? (int) $r['percent_from'] : null, 'percent' => $r['percent'] !== null ? (int) $r['percent'] : null,
                'message' => $r['message'], 'created_at' => $r['created_at'],
                'user' => $r['user_id'] !== null ? ['id' => (int) $r['user_id'], 'name' => $r['user_name']] : null,
                'files' => array_values(array_filter(array_map(static fn($fid) => $files[(int) $fid] ?? null, json_decode_array($r['files'])))),
                'notes' => array_values(array_filter(array_map(static fn($nid) => isset($noteTitles[(int) $nid]) ? ['id' => (int) $nid, 'title' => $noteTitles[(int) $nid] ?: 'Untitled'] : null, json_decode_array($r['notes'])))),
            ], $updates),
            'notes' => $t['deleted_at'] ? [] : ItemNotesController::listFor('ptask', $id, $uid),
            'files' => array_values($files),
        ];
    }

    // ------------------------------------------------------------------ write
    /** Validate the parts sent by the owner. */
    private static function partsFrom(mixed $in, int $ownerId): array
    {
        $out = [];
        foreach (array_slice(is_array($in) ? $in : [], 0, self::MAX_PARTS) as $i => $p) {
            if (!is_array($p) || !($title = V::str($p['title'] ?? null, 255))) {
                continue;
            }
            $assignee = V::id($p['assignee_id'] ?? null) ?: $ownerId;
            if (!DB::val("SELECT 1 FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL", [$assignee])) {
                throw new HttpException('One of the chosen people cannot be assigned.', 422, ['parts' => 'Unknown user.']);
            }
            $out[] = [
                'id' => V::id($p['id'] ?? null), 'title' => $title, 'assignee_id' => $assignee,
                'weight' => max(1, min(10, (int) ($p['weight'] ?? 1))), 'needs_submission' => V::bool($p['needs_submission'] ?? false) ? 1 : 0,
                'due_date' => V::date($p['due_date'] ?? null), 'position' => $i,
            ];
        }
        return $out;
    }

    private static function meta(array $in): array
    {
        $out = [];
        if (array_key_exists('title', $in)) {
            $title = V::str($in['title'], 255);
            if (!$title) {
                throw new HttpException('Give the task a title.', 422, ['title' => 'Required.']);
            }
            $out['title'] = $title;
        }
        if (array_key_exists('description', $in)) {
            $out['description'] = V::str($in['description'], 5000);
        }
        if (array_key_exists('color', $in)) {
            $out['color'] = V::color($in['color']);
        }
        if (array_key_exists('due_date', $in)) {
            $out['due_date'] = V::date($in['due_date']);
        }
        return $out;
    }

    private static function notifyAssigned(array $t, array $parts, array $actor, array $before = []): void
    {
        foreach ($parts as $p) {
            $to = (int) $p['assignee_id'];
            if ($to !== (int) $actor['id'] && !in_array($to, $before[$p['title']] ?? [], true)) {
                Notify::create($to, 'ptask', "📋 {$actor['name']} memberi Anda bagian \"{$p['title']}\" di \"{$t['title']}\"", 'Isi bar bagian Anda sampai 100%.', '#/tasks/progress/' . $t['id']);
            }
        }
    }

    public static function store(): void
    {
        $u = Auth::require();
        $in = Http::body();
        $meta = self::meta($in + ['title' => $in['title'] ?? '']);
        $parts = self::partsFrom($in['parts'] ?? [], (int) $u['id']);
        if (!$parts) {
            $parts = [['id' => null, 'title' => $meta['title'], 'assignee_id' => (int) $u['id'], 'weight' => 1, 'needs_submission' => 0, 'due_date' => null, 'position' => 0]];
        }
        $id = DB::tx(static function () use ($u, $meta, $parts) {
            $id = DB::insert('ptasks', $meta + ['user_id' => $u['id']]);
            foreach ($parts as $p) {
                unset($p['id']);
                DB::insert('ptask_parts', $p + ['ptask_id' => $id]);
            }
            return $id;
        });
        self::notifyAssigned(['id' => $id, 'title' => $meta['title']], $parts, $u);
        Activity::log('ptask.create', 'ptask', $id, $meta['title']);
        Http::ok(self::payload($id, (int) $u['id']));
    }

    /** Owner: title, description, colour, date and the parts (add / change / remove / reorder). */
    public static function update(int $id): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $t = self::task($id, $uid);
        if ((int) $t['user_id'] !== $uid) {
            throw new HttpException('Only the owner of this task can change it.', 403);
        }
        $in = Http::body();
        $meta = self::meta($in);
        $parts = array_key_exists('parts', $in) ? self::partsFrom($in['parts'], $uid) : null;
        if ($parts === []) {
            throw new HttpException('A task needs at least one part.', 422, ['parts' => 'Add a part.']);
        }
        $old = DB::all('SELECT * FROM ptask_parts WHERE ptask_id = ?', [$id]);
        $before = [];
        foreach ($old as $o) {
            $before[$o['title']][] = (int) $o['assignee_id'];
        }
        DB::tx(static function () use ($id, $meta, $parts, $old) {
            if ($meta) {
                DB::update('ptasks', $meta, 'id = ?', [$id]);
            }
            if ($parts === null) {
                return;
            }
            $keep = [];
            foreach ($parts as $p) {
                $pid = $p['id'];
                unset($p['id']);
                $cur = $pid ? array_values(array_filter($old, static fn($o) => (int) $o['id'] === $pid))[0] ?? null : null;
                if ($cur) {
                    if (!$p['needs_submission'] && $cur['submission'] !== 'none') {
                        $p['submission'] = 'none'; // no hand-in needed any more
                    } elseif ((int) $cur['assignee_id'] !== $p['assignee_id'] && $cur['submission'] !== 'approved') {
                        $p['submission'] = 'none'; // a new person starts the hand-in again
                    }
                    DB::update('ptask_parts', $p, 'id = ?', [$pid]);
                    $keep[] = $pid;
                } else {
                    $keep[] = DB::insert('ptask_parts', $p + ['ptask_id' => $id]);
                }
            }
            DB::run('DELETE FROM ptask_parts WHERE ptask_id = ? AND id NOT IN (' . DB::in($keep) . ')', [$id, ...$keep]);
        });
        if ($parts !== null) {
            self::notifyAssigned(['id' => $id, 'title' => $meta['title'] ?? $t['title']], $parts, $u, $before);
        }
        self::recompute($id, $u);
        Http::ok(self::payload($id, $uid));
    }

    /** The part's own person moves its bar (0–100 %) with an optional note. */
    public static function progress(int $id, int $partId): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $t = self::task($id, $uid);
        $p = self::part($id, $partId);
        if ((int) $p['assignee_id'] !== $uid) {
            throw new HttpException('Only ' . (DB::val('SELECT name FROM users WHERE id = ?', [$p['assignee_id']]) ?: 'its person') . ' can fill this bar.', 403);
        }
        if ($p['submission'] === 'submitted') {
            throw new HttpException('This part is handed in and waiting for approval.', 409);
        }
        if ($p['submission'] === 'approved') {
            throw new HttpException('This part is already approved.', 409);
        }
        $raw = Http::input('percent');
        if (!is_numeric($raw) || (int) $raw < 0 || (int) $raw > 100 || (float) $raw != (int) $raw) {
            throw new HttpException('Choose a percentage from 0 to 100.', 422, ['percent' => 'Choose a percentage from 0 to 100.']);
        }
        $pct = (int) $raw;
        $msg = V::str(Http::input('message'), 2000);
        DB::update('ptask_parts', ['percent' => $pct, 'done_at' => !(int) $p['needs_submission'] && $pct === 100 ? ($p['done_at'] ?: now()) : null], 'id = ?', [$partId]);
        DB::insert('ptask_updates', ['ptask_id' => $id, 'part_id' => $partId, 'user_id' => $uid, 'kind' => 'progress', 'percent_from' => (int) $p['percent'], 'percent' => $pct, 'message' => $msg]);
        if ((int) $t['user_id'] !== $uid) {
            Notify::create((int) $t['user_id'], 'ptask', "{$u['name']}: \"{$p['title']}\" {$p['percent']}% → {$pct}%", $msg ? mb_substr($msg, 0, 180) : null, '#/tasks/progress/' . $id);
        }
        self::recompute($id, $u);
        Http::ok(self::payload($id, $uid));
    }

    /** Hand in a part (setor): a message, files uploaded for this task and/or notes. Waits for the owner's approval. */
    public static function submit(int $id, int $partId): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $t = self::task($id, $uid);
        $p = self::part($id, $partId);
        if ((int) $p['assignee_id'] !== $uid) {
            throw new HttpException('Only the person of this part can hand it in.', 403);
        }
        if (!(int) $p['needs_submission']) {
            throw new HttpException('This part does not need a hand-in — move its bar to 100%.', 422);
        }
        if (in_array($p['submission'], ['submitted', 'approved'], true)) {
            throw new HttpException($p['submission'] === 'approved' ? 'This part is already approved.' : 'Already handed in — waiting for approval.', 409);
        }
        $msg = V::str(Http::input('message'), 4000);
        $fileIds = array_values(array_unique(array_filter(array_map('intval', (array) Http::input('files', [])))));
        $noteIds = array_values(array_unique(array_filter(array_map('intval', (array) Http::input('notes', [])))));
        if ($fileIds) {
            $ok = array_map('intval', DB::col('SELECT id FROM note_attachments WHERE ptask_id = ? AND user_id = ? AND deleted_at IS NULL AND id IN (' . DB::in($fileIds) . ')', [$id, $uid, ...$fileIds]));
            $fileIds = array_values(array_intersect($fileIds, $ok));
        }
        if (!$msg && !$fileIds && !$noteIds) {
            throw new HttpException('Add a message, a file or a note to hand in.', 422, ['message' => 'Add a message, a file or a note.']);
        }
        foreach ($noteIds as $nid) {
            ItemNotesController::link('ptask', $id, $nid, $uid);
        }
        DB::update('ptask_parts', ['percent' => 100, 'submission' => 'submitted'], 'id = ?', [$partId]);
        DB::insert('ptask_updates', ['ptask_id' => $id, 'part_id' => $partId, 'user_id' => $uid, 'kind' => 'submit', 'percent_from' => (int) $p['percent'], 'percent' => 100,
            'message' => $msg, 'files' => $fileIds ? json_encode($fileIds) : null, 'notes' => $noteIds ? json_encode($noteIds) : null]);
        if ((int) $t['user_id'] !== $uid) {
            Notify::create((int) $t['user_id'], 'ptask', "📤 {$u['name']} menyetor \"{$p['title']}\" — perlu persetujuan", $msg ? mb_substr($msg, 0, 180) : null, '#/tasks/progress/' . $id);
        } else {
            // Handing in my own part of my own task: nobody else to approve it.
            DB::update('ptask_parts', ['submission' => 'approved', 'done_at' => now()], 'id = ?', [$partId]);
        }
        self::recompute($id, $u);
        Http::ok(self::payload($id, $uid));
    }

    /** Owner: approve a hand-in (the part counts as 100 %) or send it back with a reason. */
    public static function review(int $id, int $partId): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $t = self::task($id, $uid);
        if ((int) $t['user_id'] !== $uid) {
            throw new HttpException('Only the owner of this task approves hand-ins.', 403);
        }
        $p = self::part($id, $partId);
        if ($p['submission'] !== 'submitted') {
            throw new HttpException('There is nothing handed in to review.', 409);
        }
        $ok = Http::input('decision') === 'approve';
        $msg = V::str(Http::input('message'), 2000);
        if (!$ok && (!$msg || mb_strlen($msg) < 3)) {
            throw new HttpException('Tell them what to change.', 422, ['message' => 'Tell them what to change.']);
        }
        DB::update('ptask_parts', $ok ? ['submission' => 'approved', 'done_at' => now()] : ['submission' => 'rejected', 'done_at' => null], 'id = ?', [$partId]);
        DB::insert('ptask_updates', ['ptask_id' => $id, 'part_id' => $partId, 'user_id' => $uid, 'kind' => $ok ? 'approve' : 'reject', 'message' => $msg]);
        if ((int) $p['assignee_id'] && (int) $p['assignee_id'] !== $uid) {
            Notify::create((int) $p['assignee_id'], 'ptask', $ok ? "✅ Setoran \"{$p['title']}\" disetujui" : "↩️ Setoran \"{$p['title']}\" dikembalikan", $msg, '#/tasks/progress/' . $id);
        }
        self::recompute($id, $u);
        Http::ok(self::payload($id, $uid));
    }

    public static function destroy(int $id): void
    {
        $u = Auth::require();
        $t = self::task($id, (int) $u['id']);
        if ((int) $t['user_id'] !== (int) $u['id']) {
            throw new HttpException('Only the owner can delete this task.', 403);
        }
        DB::run('UPDATE ptasks SET deleted_at = NOW() WHERE id = ?', [$id]);
        Http::ok(['id' => $id]);
    }

    public static function restore(int $id): void
    {
        $u = Auth::require();
        $t = self::task($id, (int) $u['id'], true);
        if ((int) $t['user_id'] !== (int) $u['id']) {
            throw new HttpException('Only the owner can restore this task.', 403);
        }
        DB::run('UPDATE ptasks SET deleted_at = NULL WHERE id = ?', [$id]);
        Http::ok(self::payload($id, (int) $u['id']));
    }
}
