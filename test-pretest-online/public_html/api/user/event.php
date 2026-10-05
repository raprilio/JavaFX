<?php
/** POST {attempt_id, event=tab_switch} — catat peserta meninggalkan halaman ujian. */
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

require_method('POST');
verify_csrf();

['attempt' => $attempt] = api_user_attempt(in_int('attempt_id'));

if ($attempt['status'] !== 'in_progress' || in_str('event') !== 'tab_switch' || !setting_on('anti_cheat')) {
    json_out(['ok' => true, 'tab_switches' => (int) $attempt['tab_switches']]);
}

q('UPDATE exam_attempts SET tab_switches = tab_switches + 1 WHERE id = ? AND status = \'in_progress\'', [$attempt['id']]);
json_out(['ok' => true, 'tab_switches' => (int) $attempt['tab_switches'] + 1]);
