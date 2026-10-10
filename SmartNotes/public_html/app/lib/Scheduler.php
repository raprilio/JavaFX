<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Reminder scheduling and background-job processing without a daemon.
 *
 * Jobs run from either:
 *  - cron.php via a cPanel Cron Job (recommended, every 5 minutes), or
 *  - a throttled "web cron" piggy-backed on authenticated API traffic.
 */
final class Scheduler
{
    private const WEB_CRON_INTERVAL = 120; // seconds

    // ------------------------------------------------------------ reminders

    /** Re-compute the pending reminder of a task / event / meeting. */
    public static function sync(string $type, int $id): void
    {
        DB::run("DELETE FROM reminders WHERE remindable_type = ? AND remindable_id = ? AND status = 'pending'", [$type, $id]);

        $after = time();
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $plan = self::plan($type, $id, $after);
            if (!$plan) {
                return;
            }
            [$userId, $occTs, $minutes] = $plan;
            $occ = date('Y-m-d H:i:s', $occTs);
            $already = DB::val('SELECT id FROM reminders WHERE remindable_type = ? AND remindable_id = ? AND occurrence_at = ?', [$type, $id, $occ]);
            if ($already) {
                // That occurrence was already reminded; look at the next one (recurring events).
                $after = $occTs + 1;
                if ($type !== 'event') {
                    return;
                }
                continue;
            }
            DB::insert('reminders', [
                'user_id' => $userId,
                'remindable_type' => $type,
                'remindable_id' => $id,
                'occurrence_at' => $occ,
                'remind_at' => date('Y-m-d H:i:s', max(time(), $occTs - $minutes * 60)),
                'minutes_before' => $minutes,
                'status' => 'pending',
            ]);
            return;
        }
    }

    /** @return array{0:int,1:int,2:int}|null [userId, occurrenceTs, minutesBefore] */
    private static function plan(string $type, int $id, int $after): ?array
    {
        if ($type === 'task') {
            $r = DB::one('SELECT user_id, due_date, due_time, reminder_minutes, status, deleted_at FROM tasks WHERE id = ?', [$id]);
            if (!$r || $r['deleted_at'] || $r['reminder_minutes'] === null || !$r['due_date'] || in_array($r['status'], ['completed', 'cancelled'], true)) {
                return null;
            }
            $occ = strtotime($r['due_date'] . ' ' . ($r['due_time'] ?: '09:00:00'));
        } elseif ($type === 'meeting') {
            $r = DB::one('SELECT user_id, meeting_date, start_time, reminder_minutes, status, deleted_at FROM meetings WHERE id = ?', [$id]);
            if (!$r || $r['deleted_at'] || $r['reminder_minutes'] === null || $r['status'] !== 'scheduled') {
                return null;
            }
            $occ = strtotime($r['meeting_date'] . ' ' . $r['start_time']);
        } elseif ($type === 'event') {
            $r = DB::one('SELECT user_id, start_at, repeat_rule, repeat_until, reminder_minutes, status, deleted_at FROM calendar_events WHERE id = ?', [$id]);
            if (!$r || $r['deleted_at'] || $r['reminder_minutes'] === null || $r['status'] !== 'scheduled') {
                return null;
            }
            $occ = Recurrence::next($r['start_at'], $r['repeat_rule'], $r['repeat_until'], $after);
            if ($occ === null) {
                return null;
            }
        } else {
            return null;
        }
        if ($occ < $after) {
            return null;
        }
        return [(int) $r['user_id'], $occ, (int) $r['reminder_minutes']];
    }

    // ------------------------------------------------------------ job runner

    /** Run from web traffic, at most every WEB_CRON_INTERVAL seconds. */
    public static function maybeRunFromWeb(): void
    {
        if (!(int) Settings::get('web_cron_enabled', '1')) {
            return;
        }
        $last = (int) Settings::get('last_cron_run', '0');
        if (time() - $last < self::WEB_CRON_INTERVAL) {
            return;
        }
        // Finish the HTTP response first when the SAPI supports it, so the user never waits.
        register_shutdown_function(static function (): void {
            // Release the session lock so the user's next requests are never blocked by SMTP.
            if (session_status() === PHP_SESSION_ACTIVE) {
                session_write_close();
            }
            if (function_exists('fastcgi_finish_request')) {
                fastcgi_finish_request();
            } elseif (function_exists('litespeed_finish_request')) {
                litespeed_finish_request();
            }
            try {
                ignore_user_abort(true);
                @set_time_limit(60);
                self::run(20, 5, 'web');
            } catch (Throwable $e) {
                error_log('Web cron failed: ' . $e->getMessage());
            }
        });
    }

    /** Process due reminders, agenda e-mails, the e-mail queue and housekeeping. */
    public static function run(int $reminderLimit = 100, int $emailLimit = 30, string $source = 'cron'): array
    {
        $got = (int) DB::val("SELECT GET_LOCK('smartnotes_scheduler', 0)");
        if ($got !== 1) {
            return ['skipped' => 'locked'];
        }
        $stats = ['reminders' => 0, 'agendas' => 0, 'emails_sent' => 0, 'emails_failed' => 0, 'trash_purged' => 0];
        try {
            Settings::set('last_cron_run', (string) time());
            Settings::set('last_cron_source', $source);
            $stats['reminders'] = self::processReminders($reminderLimit);
            $stats['agendas'] = self::processAgendas();
            [$stats['emails_sent'], $stats['emails_failed']] = self::processEmailQueue($emailLimit);
            $stats['trash_purged'] = self::housekeeping();
        } finally {
            DB::val("SELECT RELEASE_LOCK('smartnotes_scheduler')");
        }
        return $stats;
    }

    private static function processReminders(int $limit): int
    {
        $rows = DB::all(
            "SELECT r.*, u.email, u.name, u.status AS user_status,
                    COALESCE(s.email_notifications, 1) AS email_on,
                    COALESCE(s.notify_task, 1) AS n_task, COALESCE(s.notify_meeting, 1) AS n_meeting, COALESCE(s.notify_schedule, 1) AS n_schedule
             FROM reminders r
             JOIN users u ON u.id = r.user_id
             LEFT JOIN user_settings s ON s.user_id = r.user_id
             WHERE r.status = 'pending' AND r.remind_at <= NOW()
             ORDER BY r.remind_at LIMIT " . (int) $limit
        );
        $count = 0;
        $smtpReady = Mailer::isConfigured();
        foreach ($rows as $r) {
            $rid = (int) $r['id'];
            $type = $r['remindable_type'];
            $id = (int) $r['remindable_id'];
            $info = self::describe($type, $id);
            if (!$info || $r['user_status'] !== 'active') {
                DB::update('reminders', ['status' => 'cancelled'], 'id = ?', [$rid]);
                continue;
            }
            $when = self::relative(strtotime($r['occurrence_at']));
            $label = ['task' => 'Task', 'meeting' => 'Meeting', 'event' => $info['event_label'] ?? 'Jadwal'][$type];
            $verb = $type === 'task' ? 'jatuh tempo' : 'akan dimulai';
            // Avoid "Meeting Meeting Project X" when the title already starts with the label.
            $subject = stripos((string) $info['title'], $label) === 0 ? $info['title'] : "{$label} {$info['title']}";
            $title = "Reminder: {$subject} {$verb} {$when}.";
            Notify::create((int) $r['user_id'], 'reminder', $title, $info['detail_text'], $info['link']);

            $pref = ['task' => 'n_task', 'meeting' => 'n_meeting', 'event' => 'n_schedule'][$type];
            if ($smtpReady && (int) $r['email_on'] && (int) $r[$pref]) {
                $html = Mailer::template(
                    "Reminder: {$label}",
                    '<p>Halo ' . e($r['name']) . ',</p><p style="font-size:16px"><strong>' . e($title) . '</strong></p>'
                    . $info['detail_html']
                    . '<p style="margin:24px 0 0"><a class="btn" href="' . e(app_url() . $info['link']) . '">Buka di ' . e((string) Settings::get('app_name', 'SmartNotes')) . '</a></p>'
                );
                $refs = ['reminder_id' => $rid, $type === 'event' ? 'event_id' : $type . '_id' => $id];
                Mailer::queue((int) $r['user_id'], $type === 'event' ? 'schedule' : $type, $r['email'], $title, $html, $refs);
            }
            if ($type === 'event') {
                // Users tagged in the event get the same reminder, following their own preferences.
                foreach (Shares::recipients('event', $id) as $p) {
                    Notify::create((int) $p['id'], 'reminder', $title, $info['detail_text'], $info['link']);
                    if ($smtpReady && (int) $p['email_on'] && (int) $p['n_schedule']) {
                        $html = Mailer::template(
                            "Reminder: {$label}",
                            '<p>Halo ' . e($p['name']) . ',</p><p style="font-size:16px"><strong>' . e($title) . '</strong></p>'
                            . $info['detail_html']
                            . '<p style="margin:24px 0 0"><a class="btn" href="' . e(app_url() . $info['link']) . '">Buka di ' . e((string) Settings::get('app_name', 'SmartNotes')) . '</a></p>'
                        );
                        Mailer::queue((int) $p['id'], 'schedule', $p['email'], $title, $html, ['reminder_id' => $rid, 'event_id' => $id]);
                    }
                }
            }
            if ($type === 'meeting') {
                // Everyone the meeting is shared with gets the same reminder, following their own preferences.
                foreach (MeetingsController::recipients($id) as $p) {
                    Notify::create((int) $p['id'], 'reminder', $title, $info['detail_text'], $info['link']);
                    if ($smtpReady && (int) $p['email_on'] && (int) $p['n_meeting']) {
                        $html = Mailer::template(
                            "Reminder: {$label}",
                            '<p>Halo ' . e($p['name']) . ',</p><p style="font-size:16px"><strong>' . e($title) . '</strong></p>'
                            . $info['detail_html']
                            . '<p style="margin:24px 0 0"><a class="btn" href="' . e(app_url() . $info['link']) . '">Buka di ' . e((string) Settings::get('app_name', 'SmartNotes')) . '</a></p>'
                        );
                        Mailer::queue((int) $p['id'], 'meeting', $p['email'], $title, $html, ['reminder_id' => $rid, 'meeting_id' => $id]);
                    }
                }
            }
            DB::update('reminders', ['status' => 'sent', 'sent_at' => now()], 'id = ?', [$rid]);
            if ($type === 'event') {
                self::sync('event', $id); // schedule the next occurrence of a repeating event
            }
            $count++;
        }
        return $count;
    }

    private static function describe(string $type, int $id): ?array
    {
        $rows = [];
        if ($type === 'task') {
            $t = DB::one('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL', [$id]);
            if (!$t || in_array($t['status'], ['completed', 'cancelled'], true)) {
                return null;
            }
            $rows = ['Jatuh tempo' => Agenda::dayLabel($t['due_date']) . ($t['due_time'] ? ' ' . substr($t['due_time'], 0, 5) : ''), 'Prioritas' => ucfirst($t['priority'])];
            $text = $t['description'];
            $link = '#/tasks?open=' . $id;
        } elseif ($type === 'meeting') {
            $t = DB::one('SELECT * FROM meetings WHERE id = ? AND deleted_at IS NULL', [$id]);
            if (!$t || $t['status'] !== 'scheduled') {
                return null;
            }
            $rows = [
                'Tanggal' => Agenda::dayLabel($t['meeting_date']),
                'Waktu' => substr($t['start_time'], 0, 5) . ' – ' . substr($t['end_time'], 0, 5),
                'Lokasi' => $t['location'],
                'Link meeting' => $t['meeting_url'],
            ];
            $text = $t['description'];
            $link = '#/meetings/' . $id;
        } else {
            $t = DB::one('SELECT * FROM calendar_events WHERE id = ? AND deleted_at IS NULL', [$id]);
            if (!$t || $t['status'] !== 'scheduled') {
                return null;
            }
            $rows = [
                'Mulai' => date('d M Y H:i', strtotime($t['start_at'])),
                'Lokasi' => $t['location'],
                'Link meeting' => $t['meeting_url'],
            ];
            $text = $t['description'];
            $link = '#/calendar?event=' . $id;
            $label = ['event' => 'Event', 'schedule' => 'Jadwal', 'reminder' => 'Pengingat'][$t['event_type']] ?? 'Jadwal';
        }
        $html = '<table cellpadding="0" cellspacing="0" style="margin:12px 0;font-size:14px">';
        foreach ($rows as $k => $v) {
            if ($v) {
                $val = str_starts_with((string) $v, 'http') ? '<a href="' . e($v) . '">' . e($v) . '</a>' : e($v);
                $html .= '<tr><td style="padding:3px 16px 3px 0;color:#6b7280">' . e($k) . '</td><td style="padding:3px 0">' . $val . '</td></tr>';
            }
        }
        $html .= '</table>';
        if ($text) {
            $html .= '<p style="color:#4b5563">' . nl2br(e(mb_substr($text, 0, 600))) . '</p>';
        }
        return [
            'title' => $t['title'],
            'link' => $link,
            'detail_html' => $html,
            'detail_text' => $text ? mb_substr($text, 0, 200) : null,
            'event_label' => $label ?? null,
        ];
    }

    /** "30 menit lagi", "2 jam lagi", "besok", ... */
    public static function relative(int $ts): string
    {
        $diff = $ts - time();
        if ($diff <= 60) {
            return $diff < -60 ? 'sudah lewat' : 'sekarang';
        }
        $min = (int) round($diff / 60);
        if ($min < 60) {
            return "$min menit lagi";
        }
        $h = intdiv($min, 60);
        $m = $min % 60;
        if ($h < 24) {
            return $m >= 5 ? "$h jam $m menit lagi" : "$h jam lagi";
        }
        $d = (int) round($h / 24);
        return $d === 1 ? 'besok' : "$d hari lagi";
    }

    private static function processAgendas(): int
    {
        if (!Mailer::isConfigured()) {
            return 0;
        }
        $count = 0;
        $today = today();
        $rows = DB::all(
            "SELECT u.id, u.name, u.email, s.notify_daily_agenda, s.notify_weekly_agenda, s.daily_agenda_time,
                    s.last_daily_agenda_at, s.last_weekly_agenda_at
             FROM users u JOIN user_settings s ON s.user_id = u.id
             WHERE u.status = 'active' AND u.deleted_at IS NULL AND s.email_notifications = 1
               AND (s.notify_daily_agenda = 1 OR s.notify_weekly_agenda = 1)
               AND s.daily_agenda_time <= CURTIME()
             LIMIT 200"
        );
        $app = (string) Settings::get('app_name', 'SmartNotes');
        foreach ($rows as $u) {
            $uid = (int) $u['id'];
            if ((int) $u['notify_daily_agenda'] && ($u['last_daily_agenda_at'] === null || $u['last_daily_agenda_at'] < $today)) {
                $items = Agenda::range($uid, $today . ' 00:00:00', $today . ' 23:59:59');
                $items = array_values(array_filter($items, static fn($i) => !in_array($i['status'] ?? '', ['completed', 'cancelled'], true)));
                $html = Mailer::template('Agenda hari ini', '<p>Halo ' . e($u['name']) . ', berikut agenda Anda untuk <strong>' . e(Agenda::dayLabel($today)) . '</strong>:</p>' . Agenda::emailHtml($items));
                Mailer::queue($uid, 'daily_agenda', $u['email'], "[$app] Agenda hari ini — " . count($items) . ' item', $html);
                DB::update('user_settings', ['last_daily_agenda_at' => $today], 'user_id = ?', [$uid]);
                $count++;
            }
            $monday = date('Y-m-d', strtotime('monday this week'));
            if ((int) $u['notify_weekly_agenda'] && ($u['last_weekly_agenda_at'] === null || $u['last_weekly_agenda_at'] < $monday)) {
                $sunday = date('Y-m-d', strtotime($monday . ' +6 days'));
                $items = Agenda::range($uid, $monday . ' 00:00:00', $sunday . ' 23:59:59');
                $items = array_values(array_filter($items, static fn($i) => !in_array($i['status'] ?? '', ['completed', 'cancelled'], true)));
                $html = Mailer::template('Agenda minggu ini', '<p>Halo ' . e($u['name']) . ', berikut agenda Anda minggu ini (' . e(date('d M', strtotime($monday))) . ' – ' . e(date('d M Y', strtotime($sunday))) . '):</p>' . Agenda::emailHtml($items));
                Mailer::queue($uid, 'weekly_agenda', $u['email'], "[$app] Agenda minggu ini — " . count($items) . ' item', $html);
                DB::update('user_settings', ['last_weekly_agenda_at' => $monday], 'user_id = ?', [$uid]);
                $count++;
            }
        }
        return $count;
    }

    private static function processEmailQueue(int $limit): array
    {
        $sent = $failed = 0;
        if (!Mailer::isConfigured()) {
            return [0, 0];
        }
        $ids = DB::col("SELECT id FROM email_notifications WHERE status = 'pending' AND scheduled_at <= NOW() ORDER BY scheduled_at LIMIT " . (int) $limit);
        foreach ($ids as $id) {
            Mailer::deliver((int) $id) ? $sent++ : $failed++;
        }
        return [$sent, $failed];
    }

    /** Once a day: trash auto-delete and pruning of expired security records. */
    private static function housekeeping(): int
    {
        $last = (string) Settings::get('last_housekeeping', '');
        if ($last === today()) {
            return 0;
        }
        Settings::set('last_housekeeping', today());
        $purged = Trash::purgeOlderThan(Settings::int('trash_auto_delete_days', 0));
        DrawingsController::purgeRemoved();
        ChunkUpload::purgeStale(); // unfinished large uploads older than a day
        DB::run('DELETE FROM login_attempts WHERE created_at < ?', [date('Y-m-d H:i:s', time() - 7 * 86400)]);
        DB::run('DELETE FROM remember_tokens WHERE expires_at < NOW()');
        DB::run('DELETE FROM password_resets WHERE expires_at < ?', [date('Y-m-d H:i:s', time() - 7 * 86400)]);
        DB::run('DELETE FROM notifications WHERE is_read = 1 AND created_at < ?', [date('Y-m-d H:i:s', time() - 90 * 86400)]);
        if ($purged) {
            Activity::log('system.trash_purge', null, null, "Auto-deleted $purged trashed item(s)", null);
        }
        return $purged;
    }
}
