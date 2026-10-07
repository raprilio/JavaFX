<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class MeetingsController
{
    /** SQL condition: meetings the user owns or that were shared with them (individually or with everyone). */
    public static function visibleSql(string $a = 'm'): string
    {
        return "($a.user_id = ? OR $a.share_all = 1 OR EXISTS (SELECT 1 FROM meeting_shares ms WHERE ms.meeting_id = $a.id AND ms.user_id = ?))";
    }

    /** @return array{0: array, 1: string} [meeting row, 'owner'|'viewer'] */
    public static function access(int $id, int $userId): array
    {
        $m = DB::one('SELECT * FROM meetings m WHERE m.id = ? AND m.deleted_at IS NULL AND ' . self::visibleSql(), [$id, $userId, $userId]);
        if (!$m) {
            throw new HttpException('Meeting not found.', 404);
        }
        return [$m, (int) $m['user_id'] === $userId ? 'owner' : 'viewer'];
    }

    /** Active users who can see a shared meeting, excluding the owner, with their notification preferences. */
    public static function recipients(int $meetingId): array
    {
        $m = DB::one('SELECT user_id, share_all FROM meetings WHERE id = ?', [$meetingId]);
        if (!$m) {
            return [];
        }
        $cond = (int) $m['share_all'] ? '1=1' : 'EXISTS (SELECT 1 FROM meeting_shares ms WHERE ms.meeting_id = ? AND ms.user_id = u.id)';
        $params = (int) $m['share_all'] ? [(int) $m['user_id']] : [(int) $m['user_id'], $meetingId];
        return DB::all(
            "SELECT u.id, u.name, u.email, COALESCE(s.email_notifications, 1) AS email_on, COALESCE(s.notify_meeting, 1) AS n_meeting
             FROM users u LEFT JOIN user_settings s ON s.user_id = u.id
             WHERE u.id <> ? AND u.status = 'active' AND u.deleted_at IS NULL AND $cond",
            $params
        );
    }

    public static function index(): void
    {
        $u = Auth::require();
        $where = [self::visibleSql(), 'm.deleted_at IS NULL'];
        $params = [$u['id'], $u['id']];
        if (Http::query('owner') === 'me') {
            $where[] = 'm.user_id = ?';
            $params[] = $u['id'];
        } elseif (Http::query('owner') === 'others') {
            $where[] = 'm.user_id <> ?';
            $params[] = $u['id'];
        }
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
            "SELECT m.id, m.user_id, m.title, m.description, m.meeting_date, m.start_time, m.end_time, m.location, m.meeting_url,
                    m.status, m.color, m.reminder_minutes, m.note_id, m.share_all, (m.minutes IS NOT NULL AND m.minutes <> '') AS has_minutes,
                    (SELECT COUNT(*) FROM meeting_participants p WHERE p.meeting_id = m.id) AS participant_count,
                    (SELECT COUNT(*) FROM tasks t WHERE t.meeting_id = m.id AND t.deleted_at IS NULL) AS task_count,
                    (SELECT COUNT(*) FROM meeting_shares ms2 WHERE ms2.meeting_id = m.id) AS share_count,
                    o.name AS owner_name
             FROM meetings m JOIN users o ON o.id = m.user_id WHERE $w ORDER BY $order LIMIT 300",
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
            $r['shared'] = (int) $r['user_id'] !== $u['id'];
            if (!$r['shared']) {
                unset($r['owner_name']);
            } else {
                $r['note_id'] = null;
            }
            $r = self::cast($r);
            $r['participant_names'] = array_slice($people[$r['id']] ?? [], 0, 5);
        }
        Http::ok($rows);
    }

    private static function cast(array $r): array
    {
        foreach (['id', 'note_id', 'reminder_minutes', 'participant_count', 'task_count', 'share_count'] as $k) {
            if (array_key_exists($k, $r) && $r[$k] !== null) {
                $r[$k] = (int) $r[$k];
            }
        }
        foreach (['has_minutes', 'share_all'] as $k) {
            if (array_key_exists($k, $r)) {
                $r[$k] = (bool) $r[$k];
            }
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
        [$row, $role] = self::access($id, $userId);
        $ownerId = (int) $row['user_id'];
        $m = self::cast($row);
        $m['access'] = $role;
        $m['shared'] = $role !== 'owner';
        $m['owner'] = DB::one('SELECT id, name, email FROM users WHERE id = ?', [$ownerId]);
        $m['participants'] = DB::all('SELECT id, name, email, status FROM meeting_participants WHERE meeting_id = ? ORDER BY id', [$id]);
        $m['tagged'] = array_map(static fn($t) => ['id' => (int) $t['id'], 'name' => $t['name'], 'email' => $t['email']], DB::all(
            'SELECT u.id, u.name, u.email FROM meeting_shares s JOIN users u ON u.id = s.user_id WHERE s.meeting_id = ? ORDER BY u.name', [$id]
        ));
        $m['tasks'] = array_map([TasksController::class, 'present'], DB::all(
            'SELECT id, title, status, priority, due_date, due_time FROM tasks WHERE meeting_id = ? AND user_id = ? AND deleted_at IS NULL ORDER BY sort_order, id',
            [$id, $ownerId]
        ));
        $m['attachments'] = FilesController::forParent('meeting', $id, $ownerId);
        if ($role === 'owner') {
            $note = $m['note_id'] ? DB::one('SELECT id, title, LEFT(content_text, 200) AS excerpt, is_locked FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [$m['note_id'], $userId]) : null;
            if ($note && $note['is_locked'] && !NoteLock::unlocked($userId)) {
                $note['excerpt'] = '';
            }
            $m['note'] = $note;
            $m['shares'] = self::shareList($id);
        } else {
            // The owner's private note and reminder settings are not part of the shared view.
            $m['note'] = null;
            $m['note_id'] = null;
        }
        return $m;
    }

    public static function show(int $id): void
    {
        $u = Auth::require();
        Http::ok(self::payload($id, $u['id']));
    }

    // ------------------------------------------------------------ sharing

    private static function shareList(int $id): array
    {
        $all = (bool) DB::val('SELECT share_all FROM meetings WHERE id = ?', [$id]);
        $users = DB::all(
            'SELECT u.id, u.name, u.email, s.created_at FROM meeting_shares s JOIN users u ON u.id = s.user_id WHERE s.meeting_id = ? ORDER BY u.name',
            [$id]
        );
        foreach ($users as &$x) {
            $x['id'] = (int) $x['id'];
        }
        return ['all' => $all, 'users' => $users];
    }

    public static function shares(int $id): void
    {
        $u = Auth::require();
        self::find($id, $u['id']);
        Http::ok(self::shareList($id));
    }

    /** Share with specific users and/or everyone (everyone: administrators only). */
    public static function share(int $id): void
    {
        $u = Auth::require();
        $m = self::find($id, $u['id']);
        $notify = [];
        if (Http::has('all')) {
            $all = V::bool(Http::input('all'));
            if ($all && !Auth::isAdmin()) {
                throw new HttpException('Only administrators can share a meeting with every user.', 403);
            }
            if ($all && !(int) $m['share_all']) {
                DB::run('UPDATE meetings SET share_all = 1, updated_at = updated_at WHERE id = ?', [$id]);
                $notify = array_column(self::recipients($id), null, 'id');
            } elseif (!$all && (int) $m['share_all']) {
                DB::run('UPDATE meetings SET share_all = 0, updated_at = updated_at WHERE id = ?', [$id]);
            }
        }
        foreach (V::ids(Http::input('user_ids', [])) as $rid) {
            if ($rid === $u['id'] || !DB::val("SELECT 1 FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL", [$rid])) {
                continue;
            }
            $added = DB::run('INSERT IGNORE INTO meeting_shares (meeting_id, owner_id, user_id) VALUES (?, ?, ?)', [$id, $u['id'], $rid])->rowCount();
            if ($added && !(int) DB::val('SELECT share_all FROM meetings WHERE id = ?', [$id])) {
                $notify[$rid] = DB::one("SELECT u.id, u.name, u.email, COALESCE(s.email_notifications, 1) AS email_on, COALESCE(s.notify_meeting, 1) AS n_meeting FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?", [$rid]);
            }
        }
        self::announce($id, $u['name'], array_values(array_filter($notify)), 'shared');
        Activity::log('meeting.share', 'meeting', $id, (Http::input('all') ? 'Shared with all users' : 'Shared with ' . count($notify) . ' user(s)'));
        Http::ok(self::shareList($id));
    }

    public static function unshare(int $id, int $userId): void
    {
        $u = Auth::require();
        self::find($id, $u['id']);
        DB::run('DELETE FROM meeting_shares WHERE meeting_id = ? AND user_id = ?', [$id, $userId]);
        Http::ok(self::shareList($id));
    }

    /** In-app notification (+ e-mail when the user allows it) to people who can see the meeting. */
    private static function announce(int $id, string $actor, array $people, string $what): void
    {
        if (!$people) {
            return;
        }
        $m = DB::one('SELECT * FROM meetings WHERE id = ?', [$id]);
        $when = Agenda::dayLabel($m['meeting_date']) . ', ' . substr($m['start_time'], 0, 5) . '–' . substr($m['end_time'], 0, 5);
        [$title, $subject] = match ($what) {
            'shared' => ["$actor membagikan meeting \"{$m['title']}\"", "Undangan meeting: {$m['title']}"],
            'cancelled' => ["Meeting \"{$m['title']}\" dibatalkan", "Dibatalkan: {$m['title']}"],
            default => ["Meeting \"{$m['title']}\" dijadwalkan ulang", "Jadwal baru: {$m['title']}"],
        };
        $mail = Mailer::isConfigured();
        foreach ($people as $p) {
            Notify::create((int) $p['id'], 'meeting', $title, $when . ($m['location'] ? ' · ' . $m['location'] : ''), '#/meetings/' . $id);
            if ($mail && (int) $p['email_on'] && (int) $p['n_meeting']) {
                $rows = '<p style="font-size:15px"><strong>' . e($m['title']) . '</strong><br>' . e($when)
                    . ($m['location'] ? '<br>' . e($m['location']) : '')
                    . ($m['meeting_url'] ? '<br><a href="' . e($m['meeting_url']) . '">' . e($m['meeting_url']) . '</a>' : '') . '</p>';
                $html = Mailer::template($subject, '<p>Halo ' . e($p['name']) . ',</p><p>' . e($title) . '.</p>' . $rows
                    . '<p style="margin:24px 0"><a class="btn" href="' . e(app_url() . '#/meetings/' . $id) . '">Lihat meeting</a></p>');
                Mailer::queue((int) $p['id'], 'meeting', $p['email'], $subject, $html, ['meeting_id' => $id]);
            }
        }
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
        if (Http::has('tag_user_ids')) {
            self::syncTags($id, $u, V::ids(Http::input('tag_user_ids')));
        }
        Scheduler::sync('meeting', $id);
        Activity::log('meeting.create', 'meeting', $id, $data['title']);
        Http::ok(self::payload($id, $u['id']));
    }

    public static function update(int $id): void
    {
        $u = Auth::require();
        $before = self::find($id, $u['id']);
        $data = self::validate($u['id'], Http::body(), false);
        DB::tx(static function () use ($id, $data) {
            DB::update('meetings', $data, 'id = ?', [$id]);
            if (Http::has('participants')) {
                self::syncParticipants($id, Http::input('participants'));
            }
        });
        if (Http::has('tag_user_ids')) {
            self::syncTags($id, $u, V::ids(Http::input('tag_user_ids')));
        }
        Scheduler::sync('meeting', $id);
        self::announceChanges($id, $before, $u['name']);
        Http::ok(self::payload($id, $u['id']));
    }

    /** "Tag users" field of the meeting form: exactly these users can see it (newly tagged users are notified). */
    private static function syncTags(int $id, array $u, array $ids): void
    {
        $ids = array_values(array_filter(array_unique($ids), static fn($x) => $x !== (int) $u['id']));
        if ($ids) {
            DB::run('DELETE FROM meeting_shares WHERE meeting_id = ? AND user_id NOT IN (' . DB::in($ids) . ')', array_merge([$id], $ids));
        } else {
            DB::run('DELETE FROM meeting_shares WHERE meeting_id = ?', [$id]);
        }
        $new = [];
        foreach ($ids as $rid) {
            if (!DB::val("SELECT 1 FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL", [$rid])) {
                continue;
            }
            if (DB::run('INSERT IGNORE INTO meeting_shares (meeting_id, owner_id, user_id) VALUES (?, ?, ?)', [$id, $u['id'], $rid])->rowCount()) {
                $new[] = DB::one('SELECT u.id, u.name, u.email, COALESCE(s.email_notifications, 1) AS email_on, COALESCE(s.notify_meeting, 1) AS n_meeting FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?', [$rid]);
            }
        }
        if ($new && !(int) DB::val('SELECT share_all FROM meetings WHERE id = ?', [$id])) {
            self::announce($id, $u['name'], $new, 'shared');
        }
    }

    /** Tell people a shared meeting was rescheduled or cancelled. */
    private static function announceChanges(int $id, array $before, string $actor): void
    {
        $after = DB::one('SELECT meeting_date, start_time, end_time, status FROM meetings WHERE id = ?', [$id]);
        if ($after['status'] === 'cancelled' && $before['status'] !== 'cancelled') {
            self::announce($id, $actor, self::recipients($id), 'cancelled');
        } elseif ($after['status'] !== 'cancelled' && ($after['meeting_date'] !== $before['meeting_date'] || $after['start_time'] !== $before['start_time'] || $after['end_time'] !== $before['end_time'])) {
            self::announce($id, $actor, self::recipients($id), 'rescheduled');
        }
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
        self::announceChanges($id, $m, $u['name']);
        Http::ok(self::payload($id, $u['id']));
    }
}
