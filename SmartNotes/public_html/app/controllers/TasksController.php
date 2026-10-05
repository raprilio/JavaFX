<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class TasksController
{
    private const STATUSES = ['todo', 'in_progress', 'completed', 'cancelled'];
    private const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

    public static function present(array $r): array
    {
        foreach (['id', 'category_id', 'note_id', 'meeting_id', 'sort_order', 'reminder_minutes', 'attachment_count'] as $k) {
            if (array_key_exists($k, $r) && $r[$k] !== null) {
                $r[$k] = (int) $r[$k];
            }
        }
        if (isset($r['due_time']) && $r['due_time'] !== null) {
            $r['due_time'] = substr($r['due_time'], 0, 5);
        }
        unset($r['user_id']);
        return $r;
    }

    public static function index(): void
    {
        $u = Auth::require();
        $where = ['t.user_id = ?', 't.deleted_at IS NULL'];
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
                    (SELECT COUNT(*) FROM note_attachments a WHERE a.task_id = t.id AND a.deleted_at IS NULL) AS attachment_count
             FROM tasks t
             LEFT JOIN task_categories c ON c.id = t.category_id
             LEFT JOIN notes n ON n.id = t.note_id
             LEFT JOIN meetings m ON m.id = t.meeting_id
             WHERE $w ORDER BY $sort LIMIT 1000",
            $params
        );
        $tags = TagsController::forItems('task', array_column($rows, 'id'));
        $rows = array_map(static function ($r) use ($tags) {
            $r = self::present($r);
            $r['tags'] = $tags[$r['id']] ?? [];
            return $r;
        }, $rows);
        $stats = DB::one(
            "SELECT COUNT(*) total, SUM(status = 'completed') completed, SUM(status = 'in_progress') in_progress,
                    SUM(status = 'todo') todo, SUM(status = 'cancelled') cancelled,
                    SUM(due_date < CURDATE() AND status IN ('todo','in_progress')) overdue
             FROM tasks WHERE user_id = ? AND deleted_at IS NULL",
            [$u['id']]
        );
        Http::ok(['items' => $rows, 'stats' => array_map('intval', $stats)]);
    }

    private static function find(int $id, int $userId): array
    {
        $t = DB::one('SELECT * FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [$id, $userId]);
        if (!$t) {
            throw new HttpException('Task not found.', 404);
        }
        return $t;
    }

    public static function payload(int $id, int $userId): array
    {
        $t = DB::one(
            'SELECT t.*, c.name AS category_name, c.color AS category_color, n.title AS note_title, m.title AS meeting_title
             FROM tasks t LEFT JOIN task_categories c ON c.id = t.category_id LEFT JOIN notes n ON n.id = t.note_id
             LEFT JOIN meetings m ON m.id = t.meeting_id WHERE t.id = ? AND t.user_id = ?',
            [$id, $userId]
        );
        $t = self::present($t);
        $t['tags'] = TagsController::forItems('task', [$id])[$id] ?? [];
        $t['attachments'] = FilesController::forParent('task', $id, $userId);
        return $t;
    }

    public static function show(int $id): void
    {
        $u = Auth::require();
        self::find($id, $u['id']);
        Http::ok(self::payload($id, $u['id']));
    }

    public static function store(): void
    {
        $u = Auth::require();
        $title = V::str(Http::input('title'), 255, true, 'title');
        $status = V::enum(Http::input('status'), self::STATUSES, 'todo');
        $order = (int) DB::val('SELECT COALESCE(MIN(sort_order), 0) - 1 FROM tasks WHERE user_id = ? AND status = ?', [$u['id'], $status]);
        $id = DB::insert('tasks', ['user_id' => $u['id'], 'title' => $title, 'status' => $status, 'sort_order' => $order]);
        self::apply($id, $u['id'], Http::body());
        Activity::log('task.create', 'task', $id, $title);
        Http::ok(self::payload($id, $u['id']));
    }

    public static function update(int $id): void
    {
        $u = Auth::require();
        self::find($id, $u['id']);
        self::apply($id, $u['id'], Http::body());
        Http::ok(self::payload($id, $u['id']));
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
        $t = self::find($id, $u['id']);
        $status = V::enum(Http::input('status'), self::STATUSES, $t['status']);
        $data = ['status' => $status, 'completed_at' => $status === 'completed' ? ($t['completed_at'] ?: now()) : null];
        DB::update('tasks', $data, 'id = ?', [$id]);
        Scheduler::sync('task', $id);
        if ($status === 'completed' && $t['status'] !== 'completed') {
            Activity::log('task.complete', 'task', $id, $t['title']);
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
                $cur = DB::one('SELECT status, completed_at FROM tasks WHERE id = ? AND user_id = ?', [$id, $u['id']]);
                if (!$cur) {
                    continue;
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
        self::find($id, $u['id']);
        $start = V::datetime(Http::input('start'), true, 'start');
        $allDay = V::bool(Http::input('all_day'));
        DB::update('tasks', [
            'due_date' => substr($start, 0, 10),
            'due_time' => $allDay ? null : substr($start, 11, 8),
        ], 'id = ?', [$id]);
        Scheduler::sync('task', $id);
        Http::ok(self::payload($id, $u['id']));
    }
}
