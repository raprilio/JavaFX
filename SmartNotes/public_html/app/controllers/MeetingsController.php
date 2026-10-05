<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class MeetingsController
{
    public static function index(): void
    {
        $u = Auth::require();
        $where = ['m.user_id = ?', 'm.deleted_at IS NULL'];
        $params = [$u['id']];
        $order = 'm.meeting_date ASC, m.start_time ASC';
        switch (Http::query('scope', 'upcoming')) {
            case 'upcoming':
                $where[] = "(m.meeting_date > CURDATE() OR (m.meeting_date = CURDATE() AND m.end_time >= CURTIME())) AND m.status <> 'cancelled'";
                break;
            case 'today':
                $where[] = 'm.meeting_date = CURDATE()';
                break;
            case 'past':
                $where[] = '(m.meeting_date < CURDATE() OR (m.meeting_date = CURDATE() AND m.end_time < CURTIME()))';
                $order = 'm.meeting_date DESC, m.start_time DESC';
                break;
            default:
                $order = 'm.meeting_date DESC, m.start_time DESC';
        }
        if ($q = V::str(Http::query('q'), 100)) {
            $where[] = '(m.title LIKE ? OR m.description LIKE ? OR m.location LIKE ?)';
            $like = '%' . addcslashes($q, '%_\\') . '%';
            array_push($params, $like, $like, $like);
        }
        $w = implode(' AND ', $where);
        $rows = DB::all(
            "SELECT m.id, m.title, m.description, m.meeting_date, m.start_time, m.end_time, m.location, m.meeting_url,
                    m.status, m.color, m.reminder_minutes, m.note_id, (m.minutes IS NOT NULL AND m.minutes <> '') AS has_minutes,
                    (SELECT COUNT(*) FROM meeting_participants p WHERE p.meeting_id = m.id) AS participant_count,
                    (SELECT COUNT(*) FROM tasks t WHERE t.meeting_id = m.id AND t.deleted_at IS NULL) AS task_count
             FROM meetings m WHERE $w ORDER BY $order LIMIT 300",
            $params
        );
        $ids = array_column($rows, 'id');
        $people = [];
        if ($ids) {
            foreach (DB::all('SELECT meeting_id, name FROM meeting_participants WHERE meeting_id IN (' . DB::in($ids) . ') ORDER BY id', $ids) as $p) {
                $people[(int) $p['meeting_id']][] = $p['name'];
            }
        }
        foreach ($rows as &$r) {
            $r = self::cast($r);
            $r['participant_names'] = array_slice($people[$r['id']] ?? [], 0, 5);
        }
        Http::ok($rows);
    }

    private static function cast(array $r): array
    {
        foreach (['id', 'note_id', 'reminder_minutes', 'participant_count', 'task_count'] as $k) {
            if (array_key_exists($k, $r) && $r[$k] !== null) {
                $r[$k] = (int) $r[$k];
            }
        }
        if (array_key_exists('has_minutes', $r)) {
            $r['has_minutes'] = (bool) $r['has_minutes'];
        }
        foreach (['start_time', 'end_time'] as $k) {
            if (isset($r[$k])) {
                $r[$k] = substr($r[$k], 0, 5);
            }
        }
        unset($r['user_id']);
        return $r;
    }

    private static function find(int $id, int $userId): array
    {
        $m = DB::one('SELECT * FROM meetings WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [$id, $userId]);
        if (!$m) {
            throw new HttpException('Meeting not found.', 404);
        }
        return $m;
    }

    public static function payload(int $id, int $userId): array
    {
        $m = self::cast(self::find($id, $userId));
        $m['participants'] = DB::all('SELECT id, name, email, status FROM meeting_participants WHERE meeting_id = ? ORDER BY id', [$id]);
        $m['tasks'] = array_map([TasksController::class, 'present'], DB::all(
            'SELECT id, title, status, priority, due_date, due_time FROM tasks WHERE meeting_id = ? AND user_id = ? AND deleted_at IS NULL ORDER BY sort_order, id',
            [$id, $userId]
        ));
        $m['attachments'] = FilesController::forParent('meeting', $id, $userId);
        $m['note'] = $m['note_id'] ? DB::one('SELECT id, title, LEFT(content_text, 200) AS excerpt FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [$m['note_id'], $userId]) : null;
        return $m;
    }

    public static function show(int $id): void
    {
        $u = Auth::require();
        Http::ok(self::payload($id, $u['id']));
    }

    public static function store(): void
    {
        $u = Auth::require();
        $data = self::validate($u['id'], Http::body(), true);
        $data['user_id'] = $u['id'];
        $id = DB::tx(static function () use ($data) {
            $id = DB::insert('meetings', $data);
            self::syncParticipants($id, Http::input('participants'));
            return $id;
        });
        Scheduler::sync('meeting', $id);
        Activity::log('meeting.create', 'meeting', $id, $data['title']);
        Http::ok(self::payload($id, $u['id']));
    }

    public static function update(int $id): void
    {
        $u = Auth::require();
        self::find($id, $u['id']);
        $data = self::validate($u['id'], Http::body(), false);
        DB::tx(static function () use ($id, $data) {
            DB::update('meetings', $data, 'id = ?', [$id]);
            if (Http::has('participants')) {
                self::syncParticipants($id, Http::input('participants'));
            }
        });
        Scheduler::sync('meeting', $id);
        Http::ok(self::payload($id, $u['id']));
    }

    private static function validate(int $userId, array $in, bool $creating): array
    {
        $d = [];
        if ($creating || array_key_exists('title', $in)) {
            $d['title'] = V::str($in['title'] ?? null, 255, true, 'title');
        }
        if (array_key_exists('description', $in)) {
            $d['description'] = V::str($in['description'], 10000);
        }
        if ($creating || array_key_exists('meeting_date', $in)) {
            $d['meeting_date'] = V::date($in['meeting_date'] ?? null, true, 'date');
        }
        if ($creating || array_key_exists('start_time', $in)) {
            $d['start_time'] = V::time($in['start_time'] ?? null, true, 'start time');
        }
        if ($creating || array_key_exists('end_time', $in)) {
            $d['end_time'] = V::time($in['end_time'] ?? null) ?? date('H:i:s', strtotime(($d['start_time'] ?? '09:00:00')) + 3600);
        }
        if (isset($d['start_time'], $d['end_time']) && $d['end_time'] <= $d['start_time']) {
            throw new HttpException('End time must be after the start time.', 422, ['end_time' => 'invalid']);
        }
        if (array_key_exists('location', $in)) {
            $d['location'] = V::str($in['location'], 255);
        }
        if (array_key_exists('meeting_url', $in)) {
            $d['meeting_url'] = V::url($in['meeting_url']);
        }
        if (array_key_exists('status', $in)) {
            $d['status'] = V::enum($in['status'], ['scheduled', 'completed', 'cancelled'], 'scheduled');
        }
        if (array_key_exists('reminder_minutes', $in)) {
            $d['reminder_minutes'] = V::int($in['reminder_minutes'], 0, 10080);
        }
        if (array_key_exists('color', $in)) {
            $d['color'] = V::color($in['color']);
        }
        if (array_key_exists('note_id', $in)) {
            $nid = V::id($in['note_id']);
            if ($nid && !DB::val('SELECT id FROM notes WHERE id = ? AND user_id = ?', [$nid, $userId])) {
                throw new HttpException('Note not found.', 404);
            }
            $d['note_id'] = $nid;
        }
        return $d;
    }

    private static function syncParticipants(int $id, mixed $list): void
    {
        DB::run('DELETE FROM meeting_participants WHERE meeting_id = ?', [$id]);
        foreach (EventsController::participantsFrom($list) as $p) {
            DB::insert('meeting_participants', ['meeting_id' => $id] + $p);
        }
    }

    /** Save meeting notes (minutes) — typically after the meeting. */
    public static function minutes(int $id): void
    {
        $u = Auth::require();
        self::find($id, $u['id']);
        $html = Sanitizer::html((string) Http::input('minutes', ''));
        $data = ['minutes' => $html, 'minutes_text' => Sanitizer::text($html)];
        if (V::bool(Http::input('mark_completed'))) {
            $data['status'] = 'completed';
        }
        DB::update('meetings', $data, 'id = ?', [$id]);
        Scheduler::sync('meeting', $id);
        Http::ok(self::payload($id, $u['id']));
    }

    public static function move(int $id): void
    {
        $u = Auth::require();
        $m = self::find($id, $u['id']);
        $start = V::datetime(Http::input('start'), true, 'start');
        $end = V::datetime(Http::input('end'));
        $dur = strtotime($m['meeting_date'] . ' ' . $m['end_time']) - strtotime($m['meeting_date'] . ' ' . $m['start_time']);
        $endTs = $end ? strtotime($end) : strtotime($start) + $dur;
        if (date('Y-m-d', $endTs) !== substr($start, 0, 10)) {
            $endTs = strtotime(substr($start, 0, 10) . ' 23:59:00');
        }
        DB::update('meetings', [
            'meeting_date' => substr($start, 0, 10),
            'start_time' => substr($start, 11, 8),
            'end_time' => date('H:i:s', $endTs),
        ], 'id = ?', [$id]);
        Scheduler::sync('meeting', $id);
        Http::ok(self::payload($id, $u['id']));
    }
}
