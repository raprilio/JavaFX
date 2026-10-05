<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Per-user data export (JSON) and import. Binary files are not embedded; their metadata is.
 */
final class DataPort
{
    public static function export(int $userId): array
    {
        $u = DB::one('SELECT id, name, email, role, created_at FROM users WHERE id = ?', [$userId]);
        $noteCats = DB::all('SELECT id, name, color, icon, sort_order FROM note_categories WHERE user_id = ?', [$userId]);
        $taskCats = DB::all('SELECT id, name, color, icon, sort_order FROM task_categories WHERE user_id = ?', [$userId]);
        $ncMap = array_column($noteCats, 'name', 'id');
        $tcMap = array_column($taskCats, 'name', 'id');

        $notes = DB::all('SELECT * FROM notes WHERE user_id = ? AND deleted_at IS NULL', [$userId]);
        $noteTags = TagsController::forItems('note', array_column($notes, 'id'));
        foreach ($notes as &$n) {
            $n['category'] = $n['category_id'] ? ($ncMap[$n['category_id']] ?? null) : null;
            $n['tags'] = $noteTags[$n['id']] ?? [];
            unset($n['user_id'], $n['category_id']);
        }
        unset($n);
        $tasks = DB::all('SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL', [$userId]);
        $taskTags = TagsController::forItems('task', array_column($tasks, 'id'));
        foreach ($tasks as &$t) {
            $t['category'] = $t['category_id'] ? ($tcMap[$t['category_id']] ?? null) : null;
            $t['tags'] = $taskTags[$t['id']] ?? [];
            unset($t['user_id'], $t['category_id']);
        }
        unset($t);
        $events = DB::all('SELECT * FROM calendar_events WHERE user_id = ? AND deleted_at IS NULL', [$userId]);
        foreach ($events as &$e) {
            $e['participants'] = DB::all('SELECT name, email FROM event_participants WHERE event_id = ?', [$e['id']]);
            unset($e['user_id']);
        }
        unset($e);
        $meetings = DB::all('SELECT * FROM meetings WHERE user_id = ? AND deleted_at IS NULL', [$userId]);
        foreach ($meetings as &$m) {
            $m['participants'] = DB::all('SELECT name, email, status FROM meeting_participants WHERE meeting_id = ?', [$m['id']]);
            unset($m['user_id']);
        }
        unset($m);
        $mindmaps = [];
        foreach (DB::col('SELECT id FROM mindmaps WHERE user_id = ? AND deleted_at IS NULL', [$userId]) as $id) {
            $mindmaps[] = MindmapsController::payload((int) $id, $userId);
        }
        $flowcharts = [];
        foreach (DB::col('SELECT id FROM flowcharts WHERE user_id = ? AND deleted_at IS NULL', [$userId]) as $id) {
            $flowcharts[] = FlowchartsController::payload((int) $id, $userId);
        }
        return [
            'format' => 'smartnotes-export',
            'version' => 1,
            'app_version' => SN_VERSION,
            'exported_at' => now(),
            'user' => $u,
            'profile' => DB::one('SELECT job_title, phone, bio FROM user_profiles WHERE user_id = ?', [$userId]),
            'settings' => DB::one('SELECT theme, accent_color, sidebar_style, background_opacity, compact_mode, notes_view, notify_task, notify_meeting, notify_schedule, notify_daily_agenda, notify_weekly_agenda, email_notifications, daily_agenda_time, default_reminder FROM user_settings WHERE user_id = ?', [$userId]),
            'note_categories' => $noteCats,
            'task_categories' => $taskCats,
            'tags' => DB::all('SELECT name, color FROM note_tags WHERE user_id = ?', [$userId]),
            'notes' => $notes,
            'tasks' => $tasks,
            'events' => $events,
            'meetings' => $meetings,
            'mindmaps' => $mindmaps,
            'flowcharts' => $flowcharts,
            'files' => DB::all('SELECT id, note_id, task_id, meeting_id, original_name, mime_type, file_kind, file_size, file_hash, created_at FROM note_attachments WHERE user_id = ? AND deleted_at IS NULL', [$userId]),
            'audio' => DB::all('SELECT id, note_id, title, mime_type, file_size, duration, created_at FROM audio_notes WHERE user_id = ? AND deleted_at IS NULL', [$userId]),
        ];
    }

    /** Import an export into the given account (always creates new records). */
    public static function import(int $userId, array $d): array
    {
        $counts = ['notes' => 0, 'tasks' => 0, 'events' => 0, 'meetings' => 0, 'mindmaps' => 0, 'flowcharts' => 0];
        @set_time_limit(0);
        return DB::tx(static function () use ($userId, $d, &$counts) {
            $catId = static function (string $table, ?string $name) use ($userId): ?int {
                $name = V::str($name, 80);
                if (!$name) {
                    return null;
                }
                DB::run("INSERT IGNORE INTO `$table` (user_id, name) VALUES (?, ?)", [$userId, $name]);
                return (int) DB::val("SELECT id FROM `$table` WHERE user_id = ? AND name = ?", [$userId, $name]);
            };
            foreach ((array) ($d['note_categories'] ?? []) as $c) {
                if (is_array($c) && ($name = V::str($c['name'] ?? null, 80))) {
                    DB::run('INSERT IGNORE INTO note_categories (user_id, name, color) VALUES (?, ?, ?)', [$userId, $name, V::color($c['color'] ?? null) ?? '#6366f1']);
                }
            }
            foreach ((array) ($d['task_categories'] ?? []) as $c) {
                if (is_array($c) && ($name = V::str($c['name'] ?? null, 80))) {
                    DB::run('INSERT IGNORE INTO task_categories (user_id, name, color) VALUES (?, ?, ?)', [$userId, $name, V::color($c['color'] ?? null) ?? '#6366f1']);
                }
            }
            $noteMap = [];
            foreach ((array) ($d['notes'] ?? []) as $n) {
                if (!is_array($n)) {
                    continue;
                }
                $html = Sanitizer::html((string) ($n['content'] ?? ''));
                [$tot, $done] = Sanitizer::checklistStats($html);
                $id = DB::insert('notes', [
                    'user_id' => $userId,
                    'category_id' => $catId('note_categories', $n['category'] ?? null),
                    'title' => V::str($n['title'] ?? '', 255) ?? '',
                    'content' => $html,
                    'content_text' => Sanitizer::text($html),
                    'note_type' => V::enum($n['note_type'] ?? 'text', ['text', 'checklist', 'image', 'audio', 'rich', 'mixed'], 'text'),
                    'color' => V::str($n['color'] ?? null, 20),
                    'background' => V::str($n['background'] ?? null, 40),
                    'is_pinned' => V::bool($n['is_pinned'] ?? 0),
                    'is_favorite' => V::bool($n['is_favorite'] ?? 0),
                    'is_archived' => V::bool($n['is_archived'] ?? 0),
                    'checklist_total' => $tot,
                    'checklist_done' => $done,
                    'created_at' => V::datetime($n['created_at'] ?? null) ?? now(),
                ]);
                TagsController::sync('note', $id, $userId, $n['tags'] ?? []);
                $noteMap[(int) ($n['id'] ?? 0)] = $id;
                $counts['notes']++;
            }
            $meetingMap = [];
            foreach ((array) ($d['meetings'] ?? []) as $m) {
                if (!is_array($m) || !V::date($m['meeting_date'] ?? null)) {
                    continue;
                }
                $html = Sanitizer::html((string) ($m['minutes'] ?? ''));
                $id = DB::insert('meetings', [
                    'user_id' => $userId,
                    'note_id' => $noteMap[(int) ($m['note_id'] ?? 0)] ?? null,
                    'title' => V::str($m['title'] ?? 'Meeting', 255) ?? 'Meeting',
                    'description' => V::str($m['description'] ?? null, 10000),
                    'meeting_date' => V::date($m['meeting_date']),
                    'start_time' => V::time($m['start_time'] ?? '09:00') ?? '09:00:00',
                    'end_time' => V::time($m['end_time'] ?? '10:00') ?? '10:00:00',
                    'location' => V::str($m['location'] ?? null, 255),
                    'meeting_url' => V::str($m['meeting_url'] ?? null, 500),
                    'minutes' => $html,
                    'minutes_text' => Sanitizer::text($html),
                    'status' => V::enum($m['status'] ?? 'scheduled', ['scheduled', 'completed', 'cancelled'], 'scheduled'),
                    'reminder_minutes' => V::int($m['reminder_minutes'] ?? null, 0, 10080),
                    'color' => V::color($m['color'] ?? null),
                ]);
                foreach (EventsController::participantsFrom($m['participants'] ?? []) as $p) {
                    DB::insert('meeting_participants', ['meeting_id' => $id] + $p);
                }
                $meetingMap[(int) ($m['id'] ?? 0)] = $id;
                Scheduler::sync('meeting', $id);
                $counts['meetings']++;
            }
            $taskMap = [];
            foreach ((array) ($d['tasks'] ?? []) as $t) {
                if (!is_array($t) || !($title = V::str($t['title'] ?? null, 255))) {
                    continue;
                }
                $id = DB::insert('tasks', [
                    'user_id' => $userId,
                    'category_id' => $catId('task_categories', $t['category'] ?? null),
                    'note_id' => $noteMap[(int) ($t['note_id'] ?? 0)] ?? null,
                    'meeting_id' => $meetingMap[(int) ($t['meeting_id'] ?? 0)] ?? null,
                    'title' => $title,
                    'description' => V::str($t['description'] ?? null, 10000),
                    'due_date' => V::date($t['due_date'] ?? null),
                    'due_time' => V::time($t['due_time'] ?? null),
                    'priority' => V::enum($t['priority'] ?? 'medium', ['low', 'medium', 'high', 'urgent'], 'medium'),
                    'status' => V::enum($t['status'] ?? 'todo', ['todo', 'in_progress', 'completed', 'cancelled'], 'todo'),
                    'reminder_minutes' => V::int($t['reminder_minutes'] ?? null, 0, 10080),
                    'sort_order' => V::int($t['sort_order'] ?? 0) ?? 0,
                    'completed_at' => V::datetime($t['completed_at'] ?? null),
                ]);
                TagsController::sync('task', $id, $userId, $t['tags'] ?? []);
                $taskMap[(int) ($t['id'] ?? 0)] = $id;
                Scheduler::sync('task', $id);
                $counts['tasks']++;
            }
            foreach ((array) ($d['events'] ?? []) as $e) {
                if (!is_array($e) || !($start = V::datetime($e['start_at'] ?? null))) {
                    continue;
                }
                $id = DB::insert('calendar_events', [
                    'user_id' => $userId,
                    'note_id' => $noteMap[(int) ($e['note_id'] ?? 0)] ?? null,
                    'task_id' => $taskMap[(int) ($e['task_id'] ?? 0)] ?? null,
                    'event_type' => V::enum($e['event_type'] ?? 'event', ['event', 'schedule', 'reminder'], 'event'),
                    'title' => V::str($e['title'] ?? 'Event', 255) ?? 'Event',
                    'description' => V::str($e['description'] ?? null, 10000),
                    'start_at' => $start,
                    'end_at' => V::datetime($e['end_at'] ?? null) ?? $start,
                    'all_day' => V::bool($e['all_day'] ?? 0),
                    'location' => V::str($e['location'] ?? null, 255),
                    'meeting_url' => V::str($e['meeting_url'] ?? null, 500),
                    'color' => V::color($e['color'] ?? null),
                    'repeat_rule' => V::enum($e['repeat_rule'] ?? 'none', ['none', 'daily', 'weekly', 'monthly', 'yearly'], 'none'),
                    'repeat_until' => V::date($e['repeat_until'] ?? null),
                    'reminder_minutes' => V::int($e['reminder_minutes'] ?? null, 0, 10080),
                    'status' => V::enum($e['status'] ?? 'scheduled', ['scheduled', 'completed', 'cancelled'], 'scheduled'),
                ]);
                foreach (EventsController::participantsFrom($e['participants'] ?? []) as $p) {
                    DB::insert('event_participants', ['event_id' => $id, 'name' => $p['name'], 'email' => $p['email']]);
                }
                Scheduler::sync('event', $id);
                $counts['events']++;
            }
            foreach ((array) ($d['mindmaps'] ?? []) as $m) {
                if (!is_array($m)) {
                    continue;
                }
                $id = DB::insert('mindmaps', ['user_id' => $userId, 'title' => V::str($m['title'] ?? 'Mind map', 255) ?? 'Mind map', 'description' => V::str($m['description'] ?? null, 2000)]);
                MindmapsController::saveGraph($id, (array) ($m['nodes'] ?? []), (array) ($m['edges'] ?? []));
                $counts['mindmaps']++;
            }
            foreach ((array) ($d['flowcharts'] ?? []) as $f) {
                if (!is_array($f)) {
                    continue;
                }
                $id = DB::insert('flowcharts', ['user_id' => $userId, 'title' => V::str($f['title'] ?? 'Flowchart', 255) ?? 'Flowchart', 'description' => V::str($f['description'] ?? null, 2000), 'settings_json' => json_encode(['grid' => true, 'snap' => true])]);
                FlowchartsController::saveGraph($id, (array) ($f['nodes'] ?? []), (array) ($f['edges'] ?? []));
                $counts['flowcharts']++;
            }
            return $counts;
        });
    }
}
