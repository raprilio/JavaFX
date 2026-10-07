<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class EventsController
{
    private const REPEAT = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

    public static function feed(): void
    {
        $u = Auth::require();
        $start = V::datetime(Http::query('start'), true, 'start');
        $end = V::datetime(Http::query('end'), true, 'end');
        if (strtotime($end) - strtotime($start) > 400 * 86400) {
            throw new HttpException('Date range is too large.', 422);
        }
        $types = array_intersect(explode(',', (string) Http::query('types', 'event,meeting,task')), ['event', 'meeting', 'task']);
        Http::ok(Agenda::range($u['id'], $start, $end, $types ?: ['event', 'meeting', 'task']));
    }

    private static function find(int $id, int $userId): array
    {
        $e = DB::one('SELECT * FROM calendar_events WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [$id, $userId]);
        if (!$e) {
            throw new HttpException('Event not found.', 404);
        }
        return $e;
    }

    /** Calendar events the user owns or is tagged in. */
    public const VISIBLE_SQL = "(e.user_id = ? OR EXISTS (SELECT 1 FROM item_shares ts WHERE ts.item_type = 'event' AND ts.item_id = e.id AND ts.user_id = ?))";

    public static function payload(int $id, int $userId): array
    {
        [, $role] = Shares::require('event', $id, $userId);
        $e = DB::one('SELECT * FROM calendar_events WHERE id = ?', [$id]);
        $ownerId = (int) $e['user_id'];
        unset($e['user_id']);
        $e['access'] = $role;
        $e['owner'] = DB::one('SELECT id, name FROM users WHERE id = ?', [$ownerId]);
        $e['tagged'] = array_map(static fn($t) => ['id' => $t['user_id'], 'name' => $t['name'], 'email' => $t['email']], Shares::list('event', $id));
        foreach (['id', 'note_id', 'task_id', 'reminder_minutes'] as $k) {
            if ($e[$k] !== null) {
                $e[$k] = (int) $e[$k];
            }
        }
        $e['all_day'] = (bool) $e['all_day'];
        $e['participants'] = DB::all('SELECT id, name, email FROM event_participants WHERE event_id = ? ORDER BY id', [$id]);
        // The owner's linked note/task stay private to the owner.
        $e['note_title'] = $role === 'owner' && $e['note_id'] ? DB::val('SELECT title FROM notes WHERE id = ?', [$e['note_id']]) : null;
        $e['task_title'] = $role === 'owner' && $e['task_id'] ? DB::val('SELECT title FROM tasks WHERE id = ?', [$e['task_id']]) : null;
        if ($role !== 'owner') {
            $e['note_id'] = null;
            $e['task_id'] = null;
        }
        return $e;
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
            $id = DB::insert('calendar_events', $data);
            self::syncParticipants($id, Http::input('participants'));
            return $id;
        });
        if (Http::has('tag_user_ids')) {
            Shares::sync('event', $id, $u, V::ids(Http::input('tag_user_ids')));
        }
        Scheduler::sync('event', $id);
        Activity::log('event.create', 'event', $id, $data['title']);
        Http::ok(self::payload($id, $u['id']));
    }

    public static function update(int $id): void
    {
        $u = Auth::require();
        self::find($id, $u['id']);
        $data = self::validate($u['id'], Http::body(), false);
        DB::tx(static function () use ($id, $data) {
            DB::update('calendar_events', $data, 'id = ?', [$id]);
            if (Http::has('participants')) {
                self::syncParticipants($id, Http::input('participants'));
            }
        });
        if (Http::has('tag_user_ids')) {
            Shares::sync('event', $id, $u, V::ids(Http::input('tag_user_ids')));
        }
        Scheduler::sync('event', $id);
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
        if ($creating || array_key_exists('event_type', $in)) {
            $d['event_type'] = V::enum($in['event_type'] ?? 'event', ['event', 'schedule', 'reminder'], 'event');
        }
        if ($creating || array_key_exists('start_at', $in)) {
            $d['start_at'] = V::datetime($in['start_at'] ?? null, true, 'start');
            $end = V::datetime($in['end_at'] ?? null) ?? date('Y-m-d H:i:s', strtotime($d['start_at']) + 3600);
            if (strtotime($end) < strtotime($d['start_at'])) {
                throw new HttpException('End time must be after the start time.', 422, ['end_at' => 'invalid']);
            }
            $d['end_at'] = $end;
        }
        if (array_key_exists('all_day', $in)) {
            $d['all_day'] = V::bool($in['all_day']);
        }
        foreach (['location' => 255] as $k => $max) {
            if (array_key_exists($k, $in)) {
                $d[$k] = V::str($in[$k], $max);
            }
        }
        if (array_key_exists('meeting_url', $in)) {
            $d['meeting_url'] = V::url($in['meeting_url']);
        }
        if (array_key_exists('color', $in)) {
            $d['color'] = V::color($in['color']);
        }
        if (array_key_exists('repeat_rule', $in)) {
            $d['repeat_rule'] = V::enum($in['repeat_rule'], self::REPEAT, 'none');
        }
        if (array_key_exists('repeat_until', $in)) {
            $d['repeat_until'] = V::date($in['repeat_until']);
        }
        if (array_key_exists('reminder_minutes', $in)) {
            $d['reminder_minutes'] = V::int($in['reminder_minutes'], 0, 10080);
        }
        if (array_key_exists('status', $in)) {
            $d['status'] = V::enum($in['status'], ['scheduled', 'completed', 'cancelled'], 'scheduled');
        }
        foreach (['note_id' => 'notes', 'task_id' => 'tasks'] as $k => $t) {
            if (array_key_exists($k, $in)) {
                $rid = V::id($in[$k]);
                if ($rid && !DB::val("SELECT id FROM `$t` WHERE id = ? AND user_id = ?", [$rid, $userId])) {
                    throw new HttpException('Related item not found.', 404);
                }
                $d[$k] = $rid;
            }
        }
        return $d;
    }

    public static function participantsFrom(mixed $list): array
    {
        $out = [];
        foreach (is_array($list) ? array_slice($list, 0, 200) : [] as $p) {
            if (is_string($p)) {
                $p = ['name' => $p];
            }
            if (!is_array($p)) {
                continue;
            }
            $name = V::str($p['name'] ?? null, 120);
            $email = null;
            if (!empty($p['email']) && filter_var($p['email'], FILTER_VALIDATE_EMAIL)) {
                $email = mb_strtolower(mb_substr((string) $p['email'], 0, 190));
            }
            if (!$name && $email) {
                $name = $email;
            }
            if ($name) {
                $out[] = ['name' => $name, 'email' => $email, 'status' => V::enum($p['status'] ?? 'invited', ['invited', 'accepted', 'declined', 'tentative'], 'invited')];
            }
        }
        return $out;
    }

    private static function syncParticipants(int $eventId, mixed $list): void
    {
        DB::run('DELETE FROM event_participants WHERE event_id = ?', [$eventId]);
        foreach (self::participantsFrom($list) as $p) {
            DB::insert('event_participants', ['event_id' => $eventId, 'name' => $p['name'], 'email' => $p['email']]);
        }
    }

    /**
     * Drag / resize on the calendar. For repeating events the whole series is shifted
     * by the same delta as the dragged occurrence.
     */
    public static function move(int $id): void
    {
        $u = Auth::require();
        $e = self::find($id, $u['id']);
        $origStart = V::datetime(Http::input('original_start')) ?? $e['start_at'];
        $newStart = V::datetime(Http::input('start'), true, 'start');
        $newEnd = V::datetime(Http::input('end')) ?? date('Y-m-d H:i:s', strtotime($newStart) + (strtotime($e['end_at']) - strtotime($e['start_at'])));
        $delta = strtotime($newStart) - strtotime($origStart);
        $duration = max(0, strtotime($newEnd) - strtotime($newStart));
        $start = date('Y-m-d H:i:s', strtotime($e['start_at']) + $delta);
        $data = ['start_at' => $start, 'end_at' => date('Y-m-d H:i:s', strtotime($start) + $duration)];
        if (Http::has('all_day')) {
            $data['all_day'] = V::bool(Http::input('all_day'));
        }
        DB::update('calendar_events', $data, 'id = ?', [$id]);
        Scheduler::sync('event', $id);
        Http::ok(self::payload($id, $u['id']));
    }
}
