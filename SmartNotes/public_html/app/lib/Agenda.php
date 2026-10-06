<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Unified agenda: calendar events (with recurrence expanded), meetings and tasks with due dates.
 * Used by the calendar feed, dashboard and e-mail agendas.
 */
final class Agenda
{
    /**
     * @return array list of items: type, id, title, start, end, all_day, color, ...
     */
    public static function range(int $userId, string $from, string $to, array $types = ['event', 'meeting', 'task']): array
    {
        $fromTs = strtotime($from);
        $toTs = strtotime($to);
        $items = [];

        if (in_array('event', $types, true)) {
            $rows = DB::all(
                "SELECT id, title, description, event_type, start_at, end_at, all_day, location, meeting_url, color,
                        repeat_rule, repeat_until, reminder_minutes, status, note_id, task_id
                 FROM calendar_events
                 WHERE user_id = ? AND deleted_at IS NULL
                   AND ((repeat_rule = 'none' AND start_at <= ? AND end_at >= ?)
                     OR (repeat_rule <> 'none' AND start_at <= ? AND (repeat_until IS NULL OR repeat_until >= ?)))",
                [$userId, date('Y-m-d H:i:s', $toTs), date('Y-m-d H:i:s', $fromTs), date('Y-m-d H:i:s', $toTs), date('Y-m-d', $fromTs)]
            );
            foreach ($rows as $r) {
                foreach (Recurrence::between($r['start_at'], $r['end_at'], $r['repeat_rule'], $r['repeat_until'], $fromTs, $toTs) as [$s, $e]) {
                    $items[] = [
                        'type' => 'event',
                        'id' => (int) $r['id'],
                        'uid' => 'event-' . $r['id'] . '-' . $s,
                        'title' => $r['title'],
                        'description' => $r['description'],
                        'event_type' => $r['event_type'],
                        'start' => date('Y-m-d H:i:s', $s),
                        'end' => date('Y-m-d H:i:s', $e),
                        'all_day' => (bool) $r['all_day'],
                        'location' => $r['location'],
                        'meeting_url' => $r['meeting_url'],
                        'color' => $r['color'],
                        'repeat_rule' => $r['repeat_rule'],
                        'status' => $r['status'],
                        'is_recurring_instance' => $r['repeat_rule'] !== 'none' && $s !== strtotime($r['start_at']),
                    ];
                }
            }
        }

        if (in_array('meeting', $types, true)) {
            // Own meetings + meetings shared with this user (read-only for them).
            $rows = DB::all(
                "SELECT m.id, m.user_id, m.title, m.description, m.meeting_date, m.start_time, m.end_time, m.location, m.meeting_url, m.status, m.color, o.name AS owner_name
                 FROM meetings m JOIN users o ON o.id = m.user_id
                 WHERE " . MeetingsController::visibleSql('m') . " AND m.deleted_at IS NULL AND m.meeting_date BETWEEN ? AND ?",
                [$userId, $userId, date('Y-m-d', $fromTs), date('Y-m-d', $toTs)]
            );
            foreach ($rows as $r) {
                $items[] = [
                    'type' => 'meeting',
                    'id' => (int) $r['id'],
                    'uid' => 'meeting-' . $r['id'],
                    'title' => $r['title'],
                    'description' => $r['description'],
                    'start' => $r['meeting_date'] . ' ' . $r['start_time'],
                    'end' => $r['meeting_date'] . ' ' . $r['end_time'],
                    'all_day' => false,
                    'location' => $r['location'],
                    'meeting_url' => $r['meeting_url'],
                    'color' => $r['color'],
                    'status' => $r['status'],
                    'shared' => (int) $r['user_id'] !== $userId,
                    'owner_name' => (int) $r['user_id'] !== $userId ? $r['owner_name'] : null,
                ];
            }
        }

        if (in_array('task', $types, true)) {
            $rows = DB::all(
                "SELECT id, title, description, due_date, due_time, priority, status
                 FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND due_date BETWEEN ? AND ? AND status <> 'cancelled'",
                [$userId, date('Y-m-d', $fromTs), date('Y-m-d', $toTs)]
            );
            foreach ($rows as $r) {
                $start = $r['due_date'] . ' ' . ($r['due_time'] ?: '00:00:00');
                $items[] = [
                    'type' => 'task',
                    'id' => (int) $r['id'],
                    'uid' => 'task-' . $r['id'],
                    'title' => $r['title'],
                    'description' => $r['description'],
                    'start' => $start,
                    'end' => $r['due_time'] ? date('Y-m-d H:i:s', strtotime($start) + 1800) : $start,
                    'all_day' => !$r['due_time'],
                    'priority' => $r['priority'],
                    'status' => $r['status'],
                ];
            }
        }

        usort($items, static fn($a, $b) => strcmp($a['start'], $b['start']));
        return $items;
    }

    /** Simple HTML list for agenda e-mails. */
    public static function emailHtml(array $items): string
    {
        if (!$items) {
            return '<p style="color:#6b7280">Tidak ada agenda terjadwal. Selamat beraktivitas!</p>';
        }
        $labels = ['event' => 'Jadwal', 'meeting' => 'Meeting', 'task' => 'Task'];
        $html = '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">';
        $lastDay = '';
        foreach ($items as $it) {
            $day = date('Y-m-d', strtotime($it['start']));
            if ($day !== $lastDay) {
                $html .= '<tr><td colspan="2" style="padding:14px 0 6px;font-weight:700;color:#111827">' . e(self::dayLabel($day)) . '</td></tr>';
                $lastDay = $day;
            }
            $time = $it['all_day'] ? 'Sepanjang hari' : date('H:i', strtotime($it['start'])) . ($it['type'] !== 'task' ? ' – ' . date('H:i', strtotime($it['end'])) : '');
            $html .= '<tr><td style="padding:6px 10px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top;font-size:13px">' . e($time) . '</td>'
                . '<td style="padding:6px 0;border-bottom:1px solid #f1f2f4"><span style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#9ca3af">'
                . e($labels[$it['type']] ?? '') . '</span><br><strong>' . e($it['title']) . '</strong>'
                . (!empty($it['location']) ? '<br><span style="color:#6b7280;font-size:13px">' . e($it['location']) . '</span>' : '')
                . '</td></tr>';
        }
        return $html . '</table>';
    }

    public static function dayLabel(string $date): string
    {
        $days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        $months = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        $ts = strtotime($date);
        return $days[(int) date('w', $ts)] . ', ' . date('j', $ts) . ' ' . $months[(int) date('n', $ts)] . ' ' . date('Y', $ts);
    }
}
