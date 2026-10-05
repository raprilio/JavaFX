<?php
declare(strict_types=1);

defined('SN_APP') || exit;

require_once SN_APP_DIR . '/vendor/PHPMailer/Exception.php';
require_once SN_APP_DIR . '/vendor/PHPMailer/PHPMailer.php';
require_once SN_APP_DIR . '/vendor/PHPMailer/SMTP.php';

use PHPMailer\PHPMailer\PHPMailer;

/**
 * SMTP e-mail via PHPMailer. Every message is recorded in `email_notifications`,
 * every delivery attempt in `email_logs`.
 */
final class Mailer
{
    public static function isConfigured(): bool
    {
        $s = Settings::smtp();
        return $s['host'] !== '' && $s['from_email'] !== '';
    }

    /** Send immediately (no queue). Returns [ok, error]. */
    public static function send(string $to, string $subject, string $html, ?array $smtp = null): array
    {
        $s = $smtp ?? Settings::smtp();
        if ($s['host'] === '' || $s['from_email'] === '') {
            return [false, 'SMTP is not configured.'];
        }
        $mail = new PHPMailer(true);
        try {
            $mail->isSMTP();
            $mail->Host = $s['host'];
            $mail->Port = (int) $s['port'];
            $mail->SMTPAuth = $s['username'] !== '';
            $mail->Username = $s['username'];
            $mail->Password = $s['password'];
            $enc = strtolower((string) $s['encryption']);
            if ($enc === 'ssl') {
                $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
            } elseif ($enc === 'tls') {
                $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
            } else {
                $mail->SMTPSecure = '';
                $mail->SMTPAutoTLS = false;
            }
            $mail->Timeout = 15;
            $mail->CharSet = PHPMailer::CHARSET_UTF8;
            $mail->setFrom($s['from_email'], $s['from_name'] ?: 'SmartNotes');
            $mail->addAddress($to);
            $mail->isHTML(true);
            $mail->Subject = $subject;
            $mail->Body = $html;
            $mail->AltBody = Sanitizer::text($html);
            $mail->send();
            return [true, null];
        } catch (Throwable $e) {
            $err = $mail->ErrorInfo ?: $e->getMessage();
            return [false, mb_substr((string) $err, 0, 1000)];
        }
    }

    /** Insert an e-mail into the queue; returns the email_notifications id. */
    public static function queue(?int $userId, string $type, string $to, string $subject, string $html, array $refs = [], ?string $scheduledAt = null): int
    {
        return DB::insert('email_notifications', [
            'user_id' => $userId,
            'reminder_id' => $refs['reminder_id'] ?? null,
            'event_id' => $refs['event_id'] ?? null,
            'task_id' => $refs['task_id'] ?? null,
            'meeting_id' => $refs['meeting_id'] ?? null,
            'notification_type' => $type,
            'recipient_email' => $to,
            'subject' => mb_substr($subject, 0, 255),
            'message' => $html,
            'scheduled_at' => $scheduledAt ?? now(),
            'status' => 'pending',
        ]);
    }

    /** Deliver one queued e-mail and record the outcome. */
    public static function deliver(int $id): bool
    {
        $row = DB::one('SELECT * FROM email_notifications WHERE id = ?', [$id]);
        if (!$row || $row['status'] !== 'pending') {
            return false;
        }
        if (!self::isConfigured()) {
            DB::update('email_notifications', ['status' => 'failed', 'error_message' => 'SMTP is not configured.', 'attempts' => $row['attempts'] + 1], 'id = ?', [$id]);
            DB::insert('email_logs', ['email_notification_id' => $id, 'recipient_email' => $row['recipient_email'], 'subject' => $row['subject'], 'status' => 'failed', 'error_message' => 'SMTP is not configured.']);
            return false;
        }
        [$ok, $err] = self::send($row['recipient_email'], $row['subject'], $row['message']);
        $attempts = (int) $row['attempts'] + 1;
        if ($ok) {
            DB::update('email_notifications', ['status' => 'sent', 'sent_at' => now(), 'attempts' => $attempts, 'error_message' => null], 'id = ?', [$id]);
        } else {
            // Retry up to 3 times (5 minutes apart) before marking the message as failed.
            DB::update('email_notifications', [
                'status' => $attempts >= 3 ? 'failed' : 'pending',
                'attempts' => $attempts,
                'error_message' => $err,
                'scheduled_at' => date('Y-m-d H:i:s', time() + 300),
            ], 'id = ?', [$id]);
        }
        DB::insert('email_logs', [
            'email_notification_id' => $id,
            'recipient_email' => $row['recipient_email'],
            'subject' => $row['subject'],
            'status' => $ok ? 'sent' : 'failed',
            'error_message' => $err,
        ]);
        return $ok;
    }

    /** Branded HTML e-mail layout. */
    public static function template(string $heading, string $bodyHtml): string
    {
        $app = e((string) Settings::get('app_name', 'SmartNotes'));
        $accent = V::color(Settings::get('default_accent', '#6366f1')) ?? '#6366f1';
        $logo = Settings::get('logo_path');
        $logoHtml = $logo
            ? '<img src="' . e(app_url() . 'uploads/' . $logo) . '" alt="' . $app . '" style="max-height:36px">'
            : '<span style="font-size:20px;font-weight:700;color:' . $accent . '">' . $app . '</span>';
        $year = date('Y');
        $heading = e($heading);
        $url = e(app_url());
        return <<<HTML
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>.btn{display:inline-block;background:$accent;color:#fff!important;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600}</style></head>
<body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2330">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,.06)">
<tr><td style="padding:24px 28px;border-bottom:1px solid #eef0f3">$logoHtml</td></tr>
<tr><td style="padding:28px">
<h1 style="font-size:20px;margin:0 0 16px">{$heading}</h1>
<div style="font-size:15px;line-height:1.6;color:#374151">$bodyHtml</div>
</td></tr>
<tr><td style="padding:18px 28px;background:#fafbfc;color:#8a90a0;font-size:12px">
&copy; $year $app &middot; <a href="$url" style="color:#8a90a0">$url</a><br>
Atur preferensi notifikasi di Settings &rarr; Notifications.
</td></tr></table></td></tr></table></body></html>
HTML;
    }
}
