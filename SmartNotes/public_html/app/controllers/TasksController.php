<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class TasksController
{
    private const STATUSES = ['todo', 'in_progress', 'completed', 'cancelled'];
    private const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
    /** Fields only the person who assigned a task may change (the assignee keeps status, category, tags, links, reminder). */
    private const ASSIGNER_FIELDS = ['title', 'description', 'due_date', 'due_time', 'priority'];

    public static function present(array $r): array
    {
        foreach (['id', 'category_id', 'note_id', 'meeting_id', 'sort_order', 'reminder_minutes', 'attachment_count', 'assigned_by'] as $k) {
            if (array_key_exists($k, $r) && $r[$k] !== null) {
                $r[$k] = (int) $r[$k];
            }
        }
        if (isset($r['due_time']) && $r['due_time'] !== null) {
            $r['due_time'] = substr($r['due_time'], 0, 5);
        }
        $r['assigned'] = !empty($r['assigned_by']);
        unset($r['user_id']);
        return $r;
    }

    /**
     * A task is visible to its owner (the assignee) and, when it was assigned by an admin, to that admin.
     * Returns [row, role] with role 'owner' | 'assigner'.
     */
    private static function access(int $id, array $u): array
    {
        $t = DB::one('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL', [$id]);
        if ($t && (int) $t['user_id'] === (int) $u['id']) {
            return [$t, 'owner'];
        }
        if ($t && (int) ($t['assigned_by'] ?? 0) === (int) $u['id']) {
            return [$t, 'assigner'];
        }
        throw new HttpException('Task not found.', 404);
    }

    /** Active user an admin may assign tasks to (anyone but the admin is fine; null = keep it for myself). */
    private static function assignee(mixed $v, array $u): ?int
    {
        $to = V::id($v);
        if (!$to || $to === (int) $u['id']) {
            return null;
        }
        if (!Auth::isAdmin()) {
            throw new HttpException('Only administrators can create tasks for other users.', 403);
        }
        if (!DB::val("SELECT id FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL", [$to])) {
            throw new HttpException('That user cannot receive tasks.', 422);
        }
        return $to;
    }

    private static function announce(int $taskId, int $to, array $by, string $title, bool $reassigned = false): void
    {
        $msg = $by['name'] . ' ' . ($reassigned ? 'mengalihkan tugas kepada Anda' : 'memberi Anda tugas') . ': "' . $title . '"';
        $t = DB::one('SELECT due_date, due_time, priority FROM tasks WHERE id = ?', [$taskId]);
        $due = $t['due_date'] ? 'Tenggat ' . date('d M Y', strtotime($t['due_date'])) . ($t['due_time'] ? ' ' . substr($t['due_time'], 0, 5) : '') : 'Tanpa tenggat';
        Notify::create($to, 'task', $msg, $due . ' · prioritas ' . $t['priority'], '#/tasks/mine?open=' . $taskId);
        if (!Mailer::isConfigured()) {
            return;
        }
        $r = DB::one('SELECT u.name, u.email, COALESCE(s.email_notifications, 1) AS email_on, COALESCE(s.notify_task, 1) AS n_task FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?', [$to]);
        if ($r && (int) $r['email_on'] && (int) $r['n_task']) {
            $html = Mailer::template('Tugas baru', '<p>Halo ' . e($r['name']) . ',</p><p>' . e($msg) . '.</p><p>' . e($due) . '.</p><p style="margin:24px 0"><a class="btn" href="' . e(app_url() . '#/tasks/mine?open=' . $taskId) . '">Buka tugas</a></p>');
            Mailer::queue($to, 'task', $r['email'], $msg, $html, ['task_id' => $taskId]);
        }
    }

    public static function index(): void
    {
        $u = Auth::require();
        // scope=assigned: tasks I (an admin) gave to other users, with their progress.
        $assignedView = Http::query('scope') === 'assigned';
        $where = $assignedView ? ['t.assigned_by = ?', 't.user_id <> t.assigned_by', 't.deleted_at IS NULL'] : ['t.user_id = ?', 't.deleted_at IS NULL'];
        $params = [$u['id']];
        if (in_array(Http::query('status'), self::STATUSES, true)) {
            $where[] = 't.status = ?';
            $params[] = Http::query('status');
        } elseif (Http::query('status') === 'open') {
            $where[] = "t.status IN ('todo','in_progress')";
        }
        if (in_array(Http::query('priority'), self::PRIORITIES, true)) {
            $where[] = 't.priority = ?';
            $params[] = Http::query('priority');
        }
        if ($c = V::id(Http::query('category'))) {
            $where[] = 't.category_id = ?';
            $params[] = $c;
        }
        if ($n = V::id(Http::query('note_id'))) {
            $where[] = 't.note_id = ?';
            $params[] = $n;
        }
        if ($m = V::id(Http::query('meeting_id'))) {
            $where[] = 't.meeting_id = ?';
            $params[] = $m;
        }
        if ($tag = TagsController::normalize(Http::query('tag'))) {
            $where[] = 'EXISTS (SELECT 1 FROM task_tag_relations r JOIN note_tags g ON g.id = r.tag_id WHERE r.task_id = t.id AND g.name = ? AND g.user_id = ?)';
            $params[] = $tag;
            $params[] = $u['id'];
        }
        switch (Http::query('due')) {
            case 'today':
                $where[] = 't.due_date = CURDATE()';
                break;
            case 'overdue':
                $where[] = "t.due_date < CURDATE() AND t.status IN ('todo','in_progress')";
                break;
            case 'week':
                $where[] = 't.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)';
                break;
            case 'none':
                $where[] = 't.due_date IS NULL';
                break;
        }
        if (($from = V::date(Http::query('from'))) && ($to = V::date(Http::query('to')))) {
            $where[] = 't.due_date BETWEEN ? AND ?';
            $params[] = $from;
            $params[] = $to;
        }
        if ($q = V::str(Http::query('q'), 100)) {
            $where[] = '(t.title LIKE ? OR t.description LIKE ?)';
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $params[] = $like;
            $params[] = $like;
        }
        $sort = match (Http::query('sort')) {
            'due' => 't.due_date IS NULL, t.due_date ASC, t.due_time ASC',
            'priority' => "FIELD(t.priority,'urgent','high','medium','low')",
            'created' => 't.created_at DESC',
            'title' => 't.title ASC',
            default => 't.sort_order ASC, t.id DESC',
        };
        $w = implode(' AND ', $where);
        $rows = DB::all(
            "SELECT t.*, c.name AS category_name, c.color AS category_color, n.title AS note_title, m.title AS meeting_title,
                    (SELECT COUNT(*) FROM note_attachments a WHERE a.task_id = t.id AND a.deleted_at IS NULL) AS attachment_count,
                    ab.name AS assigned_by_name, ow.name AS assignee_name, ow.id AS assignee_id
             FROM tasks t
             LEFT JOIN task_categories c ON c.id = t.category_id
             LEFT JOIN notes n ON n.id = t.note_id
             LEFT JOIN meetings m ON m.id = t.meeting_id
             LEFT JOIN users ab ON ab.id = t.assigned_by
             LEFT JOIN users ow ON ow.id = t.user_id
             WHERE $w ORDER BY $sort LIMIT 1000",
            $params
        );
        if ($assignedView) {
            // The assignee's own categories/notes/meetings are private to them.
            foreach ($rows as &$r) {
                $r['category_name'] = $r['category_color'] = $r['note_title'] = $r['meeting_title'] = null;
                $r['category_id'] = $r['note_id'] = $r['meeting_id'] = null;
            }
            unset($r);
        }
        $tags = $assignedView ? [] : TagsController::forItems('task', array_column($rows, 'id'));
        $rows = array_map(static function ($r) use ($tags) {
            $r = self::present($r);
            $r['assignee_id'] = (int) $r['assignee_id'];
            $r['tags'] = $tags[$r['id']] ?? [];
            return $r;
        }, $rows);
        $stats = DB::one(
            "SELECT COUNT(*) total, SUM(status = 'completed') completed, SUM(status = 'in_progress') in_progress,
                    SUM(status = 'todo') todo, SUM(status = 'cancelled') cancelled,
                    SUM(due_date < CURDATE() AND status IN ('todo','in_progress')) overdue
             FROM tasks t WHERE " . ($assignedView ? 't.assigned_by = ? AND t.user_id <> t.assigned_by' : 't.user_id = ?') . ' AND t.deleted_at IS NULL',
            [$u['id']]
        );
        Http::ok(['items' => $rows, 'stats' => array_map('intval', $stats)]);
    }

    public static function payload(int $id, int $userId): array
    {
        $t = DB::one(
            'SELECT t.*, c.name AS category_name, c.color AS category_color, n.title AS note_title, m.title AS meeting_title,
                    ab.name AS assigned_by_name, ow.name AS assignee_name
             FROM tasks t LEFT JOIN task_categories c ON c.id = t.category_id LEFT JOIN notes n ON n.id = t.note_id
             LEFT JOIN meetings m ON m.id = t.meeting_id LEFT JOIN users ab ON ab.id = t.assigned_by LEFT JOIN users ow ON ow.id = t.user_id
             WHERE t.id = ?',
            [$id]
        );
        $ownerId = (int) $t['user_id'];
        $isOwner = $ownerId === $userId;
        $t = self::present($t);
        $t['assignee_id'] = $ownerId;
        $t['access'] = $isOwner ? 'owner' : 'assigner';
        // What the current viewer may change (assignees cannot rewrite what they were asked to do).
        $t['locked_fields'] = $isOwner && $t['assigned'] && $t['assigned_by'] !== $userId ? self::ASSIGNER_FIELDS : [];
        if (!$isOwner) {
            $t['category_id'] = $t['note_id'] = $t['meeting_id'] = null;
            $t['category_name'] = $t['category_color'] = $t['note_title'] = $t['meeting_title'] = null;
        }
        $t['tags'] = $isOwner ? (TagsController::forItems('task', [$id])[$id] ?? []) : [];
        $t['attachments'] = FilesController::forParent('task', $id, $ownerId);
        return $t;
    }

    public static function show(int $id): void
    {
        $u = Auth::require();
        self::access($id, $u);
        Http::ok(self::payload($id, $u['id']));
    }

    public static function store(): void
    {
        $u = Auth::require();
        $title = V::str(Http::input('title'), 255, true, 'title');
        $status = V::enum(Http::input('status'), self::STATUSES, 'todo');
        $to = self::assignee(Http::input('assign_to'), $u);
        $owner = $to ?? (int) $u['id'];
        $order = (int) DB::val('SELECT COALESCE(MIN(sort_order), 0) - 1 FROM tasks WHERE user_id = ? AND status = ?', [$owner, $status]);
        $id = DB::insert('tasks', ['user_id' => $owner, 'title' => $title, 'status' => $status, 'sort_order' => $order, 'assigned_by' => $to ? $u['id'] : null]);
        // Categories, tags and linked notes/meetings belong to the assignee: an admin assigning a task does not set them.
        $in = Http::body();
        if ($to) {
            $in = array_diff_key($in, array_flip(['category_id', 'tags', 'note_id', 'meeting_id']));
        }
        self::apply($id, $owner, $in);
        Activity::log('task.create', 'task', $id, $to ? $title . ' (assigned to user #' . $to . ')' : $title);
        if ($to) {
            self::announce($id, $to, $u, $title);
        }
        Http::ok(self::payload($id, $u['id']));
    }

    public static function update(int $id): void
    {
        $u = Auth::require();
        [$t, $role] = self::access($id, $u);
        $in = Http::body();
        $owner = (int) $t['user_id'];
        $ownTaskOfAdmin = $role === 'owner' && Auth::isAdmin() && empty($t['assigned_by']);
        if ($role === 'assigner' || ($ownTaskOfAdmin && V::id($in['assign_to'] ?? null) && V::id($in['assign_to']) !== $owner)) {
            // The admin who assigned it edits the assignment itself; (re)assigning moves it to another user.
            $in = array_diff_key($in, array_flip(['category_id', 'tags', 'note_id', 'meeting_id']));
            if (array_key_exists('assign_to', $in) && V::id($in['assign_to']) && V::id($in['assign_to']) !== $owner) {
                $to = self::assignee($in['assign_to'], $u);
                $new = $to ?? (int) $u['id'];
                DB::update('tasks', ['user_id' => $new, 'category_id' => null, 'note_id' => null, 'meeting_id' => null, 'assigned_by' => $to ? $u['id'] : null], 'id = ?', [$id]);
                DB::run('DELETE FROM task_tag_relations WHERE task_id = ?', [$id]);
                $owner = $new;
                if ($to) {
                    self::announce($id, $to, $u, (string) $t['title'], true);
                }
            }
        } elseif (!empty($t['assigned_by']) && (int) $t['assigned_by'] !== $owner) {
            self::guardLocked($t, $in);
        }
        self::apply($id, $owner, $in);
        Http::ok(self::payload($id, $u['id']));
    }

    /** Assignees may not change what they were asked to do (title, description, due date, priority). */
    private static function guardLocked(array $t, array $in): void
    {
        foreach (self::ASSIGNER_FIELDS as $f) {
            if (!array_key_exists($f, $in)) {
                continue;
            }
            $cur = $t[$f] === null ? '' : (string) $t[$f];
            $new = $in[$f] === null ? '' : trim((string) $in[$f]);
            if ($f === 'due_time') {
                [$cur, $new] = [substr($cur, 0, 5), substr($new, 0, 5)];
            }
            if ($cur !== $new) {
                throw new HttpException('This task was assigned to you — only the person who assigned it can change the title, description, due date or priority.', 403);
            }
        }
    }

    private static function apply(int $id, int $userId, array $in): void
    {
        $data = [];
        if (array_key_exists('title', $in)) {
            $data['title'] = V::str($in['title'], 255, true, 'title');
        }
        if (array_key_exists('description', $in)) {
            $data['description'] = V::str($in['description'], 10000);
        }
        if (array_key_exists('due_date', $in)) {
            $data['due_date'] = V::date($in['due_date']);
        }
        if (array_key_exists('due_time', $in)) {
            $data['due_time'] = V::time($in['due_time']);
        }
        if (array_key_exists('priority', $in)) {
            $data['priority'] = V::enum($in['priority'], self::PRIORITIES, 'medium');
        }
        if (array_key_exists('status', $in)) {
            $data['status'] = V::enum($in['status'], self::STATUSES, 'todo');
            $data['completed_at'] = $data['status'] === 'completed' ? now() : null;
        }
        if (array_key_exists('reminder_minutes', $in)) {
            $data['reminder_minutes'] = V::int($in['reminder_minutes'], 0, 10080);
        }
        if (array_key_exists('category_id', $in)) {
            $data['category_id'] = CategoriesController::ownedId('task', $in['category_id'], $userId);
        }
        foreach (['note_id' => 'notes', 'meeting_id' => 'meetings'] as $k => $t) {
            if (array_key_exists($k, $in)) {
                $rid = V::id($in[$k]);
                if ($rid && !DB::val("SELECT id FROM `$t` WHERE id = ? AND user_id = ?", [$rid, $userId])) {
                    throw new HttpException('Related item not found.', 404);
                }
                $data[$k] = $rid;
            }
        }
        if ($data) {
            DB::update('tasks', $data, 'id = ? AND user_id = ?', [$id, $userId]);
        }
        if (array_key_exists('tags', $in)) {
            TagsController::sync('task', $id, $userId, $in['tags']);
        }
        Scheduler::sync('task', $id);
    }

    public static function status(int $id): void
    {
        $u = Auth::require();
        [$t] = self::access($id, $u);
        $status = V::enum(Http::input('status'), self::STATUSES, $t['status']);
        $data = ['status' => $status, 'completed_at' => $status === 'completed' ? ($t['completed_at'] ?: now()) : null];
        DB::update('tasks', $data, 'id = ?', [$id]);
        Scheduler::sync('task', $id);
        if ($status === 'completed' && $t['status'] !== 'completed') {
            Activity::log('task.complete', 'task', $id, $t['title']);
            self::reportBack($t, $u, 'menyelesaikan');
        }
        Http::ok(self::payload($id, $u['id']));
    }

    /** Persist board ordering (and status when a card moves column). */
    public static function reorder(): void
    {
        $u = Auth::require();
        $status = V::enum(Http::input('status'), self::STATUSES, 'todo');
        $ids = array_slice(V::ids(Http::input('ids')), 0, 1000);
        DB::tx(static function () use ($ids, $status, $u) {
            foreach ($ids as $i => $id) {
                $cur = DB::one('SELECT id, title, status, completed_at, user_id, assigned_by FROM tasks WHERE id = ? AND user_id = ?', [$id, $u['id']]);
                if (!$cur) {
                    continue;
                }
                if ($cur['status'] !== 'completed' && $status === 'completed') {
                    self::reportBack($cur, $u, 'menyelesaikan');
                }
                $data = ['sort_order' => $i, 'status' => $status];
                if ($cur['status'] !== $status) {
                    $data['completed_at'] = $status === 'completed' ? now() : null;
                }
                DB::update('tasks', $data, 'id = ?', [$id]);
            }
        });
        foreach ($ids as $id) {
            Scheduler::sync('task', $id);
        }
        Http::ok();
    }

    /** Drag on the calendar: change due date / time. */
    public static function move(int $id): void
    {
        $u = Auth::require();
        [$t, $role] = self::access($id, $u);
        if ($role === 'owner' && !empty($t['assigned_by']) && (int) $t['assigned_by'] !== (int) $u['id']) {
            throw new HttpException('This task was assigned to you — only the person who assigned it can change the due date.', 403);
        }
        $start = V::datetime(Http::input('start'), true, 'start');
        $allDay = V::bool(Http::input('all_day'));
        DB::update('tasks', [
            'due_date' => substr($start, 0, 10),
            'due_time' => $allDay ? null : substr($start, 11, 8),
        ], 'id = ?', [$id]);
        Scheduler::sync('task', $id);
        Http::ok(self::payload($id, $u['id']));
    }

    /** Tell the admin who assigned a task that the assignee finished it. */
    private static function reportBack(array $t, array $u, string $verb): void
    {
        $by = (int) ($t['assigned_by'] ?? 0);
        if ($by && $by !== (int) $u['id'] && (int) $t['user_id'] === (int) $u['id']) {
            Notify::create($by, 'task', $u['name'] . ' ' . $verb . ' tugas "' . $t['title'] . '"', null, '#/tasks/mine?scope=assigned&open=' . $t['id']);
        }
    }

    /** Remove a task: the assignee cannot delete work assigned by an admin; the admin removes it for good. */
    public static function guardTrash(int $id, array $u): ?bool
    {
        $t = DB::one('SELECT user_id, assigned_by FROM tasks WHERE id = ?', [$id]);
        if (!$t || empty($t['assigned_by']) || (int) $t['assigned_by'] === (int) $t['user_id']) {
            return null; // ordinary task: normal trash
        }
        if ((int) $t['assigned_by'] === (int) $u['id']) {
            Trash::destroy('task', $id, (int) $t['user_id']);
            return true;
        }
        if ((int) $t['user_id'] === (int) $u['id']) {
            throw new HttpException('This task was assigned to you by an administrator, so you cannot delete it. Mark it completed or cancelled instead.', 403);
        }
        return null;
    }
}
