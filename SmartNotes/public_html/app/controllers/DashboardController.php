<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class DashboardController
{
    public static function index(): void
    {
        $u = Auth::require();
        $uid = $u['id'];
        $notes = DB::one(
            'SELECT COUNT(*) total, SUM(DATE(created_at) = CURDATE()) today, SUM(is_pinned) pinned, SUM(is_favorite) favorite
             FROM notes WHERE user_id = ? AND deleted_at IS NULL AND is_archived = 0',
            [$uid]
        );
        $tasks = DB::one(
            "SELECT COUNT(*) total, SUM(status IN ('todo','in_progress')) active, SUM(status = 'completed') completed,
                    SUM(status = 'in_progress') in_progress,
                    SUM(due_date < CURDATE() AND status IN ('todo','in_progress')) overdue
             FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status <> 'cancelled'",
            [$uid]
        );
        $counts = [
            'notes' => (int) $notes['total'],
            'notes_today' => (int) $notes['today'],
            'tasks_active' => (int) $tasks['active'],
            'tasks_completed' => (int) $tasks['completed'],
            'tasks_overdue' => (int) $tasks['overdue'],
            'meetings_upcoming' => (int) DB::val("SELECT COUNT(*) FROM meetings WHERE user_id = ? AND deleted_at IS NULL AND status = 'scheduled' AND (meeting_date > CURDATE() OR (meeting_date = CURDATE() AND end_time >= CURTIME()))", [$uid]),
            'events_upcoming' => count(array_filter(
                Agenda::range($uid, now(), date('Y-m-d 23:59:59', strtotime('+30 days')), ['event']),
                static fn($e) => $e['status'] === 'scheduled'
            )),
            'audio' => (int) DB::val('SELECT COUNT(*) FROM audio_notes WHERE user_id = ? AND deleted_at IS NULL', [$uid]),
            'mindmaps' => (int) DB::val('SELECT COUNT(*) FROM mindmaps WHERE user_id = ? AND deleted_at IS NULL', [$uid]),
            'flowcharts' => (int) DB::val('SELECT COUNT(*) FROM flowcharts WHERE user_id = ? AND deleted_at IS NULL', [$uid]),
        ];
        $totalTasks = (int) $tasks['total'];
        $progress = [
            'total' => $totalTasks,
            'completed' => (int) $tasks['completed'],
            'in_progress' => (int) $tasks['in_progress'],
            'percent' => $totalTasks ? (int) round(((int) $tasks['completed'] / $totalTasks) * 100) : 0,
        ];
        $today = Agenda::range($uid, today() . ' 00:00:00', today() . ' 23:59:59');
        $upcoming = array_values(array_filter(
            Agenda::range($uid, date('Y-m-d 00:00:00', strtotime('+1 day')), date('Y-m-d 23:59:59', strtotime('+14 days')), ['event', 'meeting']),
            static fn($i) => ($i['status'] ?? '') !== 'cancelled'
        ));
        $recent = DB::all(
            "SELECT id, title, LEFT(content_text, 140) AS excerpt, note_type, color, is_pinned, updated_at, last_opened_at
             FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY COALESCE(last_opened_at, updated_at) DESC LIMIT 6",
            [$uid]
        );
        $todayTasks = array_map([TasksController::class, 'present'], DB::all(
            "SELECT id, title, status, priority, due_date, due_time FROM tasks
             WHERE user_id = ? AND deleted_at IS NULL AND status IN ('todo','in_progress') AND due_date <= CURDATE()
             ORDER BY due_date, due_time IS NULL, due_time, FIELD(priority,'urgent','high','medium','low') LIMIT 12",
            [$uid]
        ));
        // Notes created per day for the last 7 days (sparkline)
        $series = [];
        $rows = DB::all('SELECT DATE(created_at) d, COUNT(*) c FROM notes WHERE user_id = ? AND created_at >= ? GROUP BY DATE(created_at)', [$uid, date('Y-m-d', strtotime('-6 days'))]);
        $map = array_column($rows, 'c', 'd');
        for ($i = 6; $i >= 0; $i--) {
            $d = date('Y-m-d', strtotime("-$i days"));
            $series[] = ['date' => $d, 'count' => (int) ($map[$d] ?? 0)];
        }
        $shared = DB::all(
            "SELECT n.id, n.title, LEFT(n.content_text, 140) AS excerpt, n.color, n.updated_at, s.is_pinned, s.permission, o.name AS owner_name
             FROM note_shares s JOIN notes n ON n.id = s.note_id AND n.deleted_at IS NULL JOIN users o ON o.id = n.user_id
             WHERE s.user_id = ? ORDER BY s.is_pinned DESC, n.updated_at DESC LIMIT 6",
            [$uid]
        );
        foreach ($shared as &$sh) {
            $sh['id'] = (int) $sh['id'];
            $sh['is_pinned'] = (bool) $sh['is_pinned'];
        }
        unset($sh);
        $counts['drive_files'] = (int) DB::val('SELECT COUNT(*) FROM note_attachments WHERE user_id = ? AND deleted_at IS NULL AND note_id IS NULL AND task_id IS NULL AND meeting_id IS NULL', [$uid]);
        $counts['shared_with_me'] = (int) DB::val('SELECT COUNT(*) FROM note_shares s JOIN notes n ON n.id = s.note_id AND n.deleted_at IS NULL WHERE s.user_id = ?', [$uid]);
        Http::ok([
            'shared_notes' => $shared,
            'counts' => $counts,
            'progress' => $progress,
            'today' => $today,
            'today_tasks' => $todayTasks,
            'upcoming' => array_slice($upcoming, 0, 8),
            'recent_notes' => $recent,
            'notes_series' => $series,
        ]);
    }
}
