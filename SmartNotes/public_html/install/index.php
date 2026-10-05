<?php
/**
 * SmartNotes web installer.
 * Creates the database tables, the first administrator and app/config.php.
 * After a successful installation this page refuses to run again. Delete the /install folder afterwards.
 */
declare(strict_types=1);

require dirname(__DIR__) . '/app/bootstrap.php';

header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'none'; form-action 'self'");

session_name('SNINSTALL');
session_start();
if (empty($_SESSION['install_csrf'])) {
    $_SESSION['install_csrf'] = bin2hex(random_bytes(16));
}

$configFile = SN_APP_DIR . '/config.php';
$installed = Config::isInstalled();
$errors = [];
$done = null;

// ------------------------------------------------------------------ requirements
$req = [
    ['PHP 8.1 or newer', version_compare(PHP_VERSION, '8.1.0', '>='), PHP_VERSION, true],
    ['PDO MySQL extension', extension_loaded('pdo_mysql'), '', true],
    ['mbstring extension', extension_loaded('mbstring'), '', true],
    ['fileinfo extension (MIME validation)', extension_loaded('fileinfo'), '', true],
    ['JSON extension', function_exists('json_encode'), '', true],
    ['OpenSSL or Sodium (encryption)', function_exists('sodium_crypto_secretbox') || function_exists('openssl_encrypt'), '', true],
    ['GD extension (image resize / rotate)', function_exists('imagecreatetruecolor'), 'recommended', false],
    ['Zip extension (uploads backup)', class_exists('ZipArchive'), 'recommended', false],
    ['app/ folder writable (to create config.php)', is_writable(SN_APP_DIR), '', false],
    ['uploads/ folder writable', is_writable(SN_UPLOADS), '', true],
    ['storage/ folder writable', is_writable(SN_STORAGE), '', true],
];
$reqOk = !in_array(false, array_map(static fn($r) => $r[1] || !$r[3], $req), true);

$scheme = is_https() ? 'https://' : 'http://';
$defaultUrl = $scheme . ($_SERVER['HTTP_HOST'] ?? 'localhost') . base_path();
$in = static fn(string $k, string $d = '') => trim((string) ($_POST[$k] ?? $d));

// ------------------------------------------------------------------ install
if (!$installed && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($_SESSION['install_csrf'], (string) ($_POST['csrf'] ?? ''))) {
        $errors[] = 'Session expired. Please submit the form again.';
    }
    $db = [
        'host' => $in('db_host', 'localhost'),
        'port' => (int) $in('db_port', '3306'),
        'name' => $in('db_name'),
        'user' => $in('db_user'),
        'pass' => (string) ($_POST['db_pass'] ?? ''),
    ];
    $appUrl = rtrim($in('app_url', $defaultUrl), '/') . '/';
    $tz = $in('timezone', 'Asia/Jakarta');
    $adminName = $in('admin_name');
    $adminEmail = strtolower($in('admin_email'));
    $adminPass = (string) ($_POST['admin_password'] ?? '');

    if (!$reqOk) $errors[] = 'Please fix the server requirements first.';
    if ($db['name'] === '' || $db['user'] === '') $errors[] = 'Database name and user are required.';
    if (!in_array($tz, timezone_identifiers_list(), true)) $errors[] = 'Invalid timezone.';
    if (!filter_var($appUrl, FILTER_VALIDATE_URL)) $errors[] = 'Invalid application URL.';
    if ($adminName === '') $errors[] = 'Administrator name is required.';
    if (!filter_var($adminEmail, FILTER_VALIDATE_EMAIL)) $errors[] = 'Administrator e-mail is invalid.';
    if (strlen($adminPass) < 8 || !preg_match('/[A-Za-z]/', $adminPass) || !preg_match('/\d/', $adminPass)) $errors[] = 'Administrator password must be at least 8 characters with letters and numbers.';

    if (!$errors) {
        try {
            date_default_timezone_set($tz);
            $pdo = DB::connect($db);
            $exists = (bool) $pdo->query("SHOW TABLES LIKE 'users'")->fetchColumn();
            if ($exists && empty($_POST['overwrite'])) {
                throw new RuntimeException('The database already contains SmartNotes tables. Tick “Replace existing tables” to reinstall (all data will be lost), or choose an empty database.');
            }
            $config = [
                'app' => ['url' => $appUrl, 'key' => bin2hex(random_bytes(32)), 'debug' => false, 'timezone' => $tz, 'trust_proxy' => false],
                'db' => $db,
                'smtp' => ['host' => '', 'port' => 465, 'username' => '', 'password' => '', 'encryption' => 'ssl', 'from_email' => '', 'from_name' => 'SmartNotes'],
                'cron' => ['token' => bin2hex(random_bytes(20))],
            ];
            Config::load($config);

            if ($exists) {
                $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
                foreach ($pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $t) {
                    $pdo->exec('DROP TABLE IF EXISTS `' . str_replace('`', '', (string) $t) . '`');
                }
                $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
            }
            Backup::restoreDatabase(__DIR__ . '/database.sql');
            Settings::set('app_url', $appUrl);
            $adminId = Auth::createUser($adminName, $adminEmail, $adminPass, 'admin');
            if (!empty($_POST['demo'])) {
                seed_demo($adminId);
            }
            Activity::log('system.install', 'user', $adminId, 'SmartNotes installed', $adminId);

            $php = "<?php\n/** SmartNotes configuration — generated by the installer on " . date('Y-m-d H:i') . " */\nreturn " . var_export($config, true) . ";\n";
            $written = @file_put_contents($configFile, $php, LOCK_EX) !== false;
            if ($written) {
                @chmod($configFile, 0640);
            }
            $done = ['written' => $written, 'php' => $php, 'url' => $appUrl, 'cron' => $config['cron']['token']];
        } catch (Throwable $e) {
            $errors[] = 'Installation failed: ' . $e->getMessage();
        }
    }
}

/** Example content so the dashboard is not empty on first login. */
function seed_demo(int $uid): void
{
    $cat = (int) DB::val("SELECT id FROM note_categories WHERE user_id = ? AND name = 'Work'", [$uid]);
    $tcat = (int) DB::val("SELECT id FROM task_categories WHERE user_id = ? AND name = 'Project'", [$uid]);
    $html = '<h2>Welcome to SmartNotes</h2><p>This is a <b>rich text</b> note. Try the toolbar above: headings, <mark>highlights</mark>, lists, tables, links and more.</p>'
        . '<ul class="checklist"><li data-checked="true">Sign in for the first time</li><li data-checked="false">Configure SMTP in Admin → Email</li><li data-checked="false">Add the cron job for reminders</li><li data-checked="false">Upload your logo in Admin → Branding</li></ul>'
        . '<blockquote>Tip: press Ctrl+K anywhere to search or run a command.</blockquote>';
    $n = DB::insert('notes', ['user_id' => $uid, 'category_id' => $cat ?: null, 'title' => 'Getting started', 'content' => Sanitizer::html($html), 'content_text' => Sanitizer::text($html), 'note_type' => 'mixed', 'color' => 'yellow', 'is_pinned' => 1, 'checklist_total' => 4, 'checklist_done' => 1, 'last_opened_at' => now()]);
    TagsController::sync('note', $n, $uid, ['ideas', 'project']);
    $meetDate = date('Y-m-d', strtotime('+1 day'));
    $m = DB::insert('meetings', ['user_id' => $uid, 'note_id' => $n, 'title' => 'Meeting Project Dukcapil', 'description' => "1. Progress review\n2. Data migration plan\n3. Next steps", 'meeting_date' => $meetDate, 'start_time' => '09:00:00', 'end_time' => '10:30:00', 'location' => 'Meeting Room A', 'reminder_minutes' => 30]);
    DB::insert('meeting_participants', ['meeting_id' => $m, 'name' => 'Project Team']);
    Scheduler::sync('meeting', $m);
    foreach ([['Prepare project report', 'high', 0, 'in_progress'], ['Review meeting minutes', 'medium', 1, 'todo'], ['Send weekly update', 'low', 3, 'todo'], ['Set up SmartNotes', 'urgent', 0, 'completed']] as $i => [$t, $p, $d, $s]) {
        $tid = DB::insert('tasks', ['user_id' => $uid, 'category_id' => $tcat ?: null, 'meeting_id' => $i === 1 ? $m : null, 'title' => $t, 'priority' => $p, 'status' => $s, 'due_date' => date('Y-m-d', strtotime("+$d day")), 'due_time' => '15:00:00', 'reminder_minutes' => 60, 'sort_order' => $i, 'completed_at' => $s === 'completed' ? now() : null]);
        Scheduler::sync('task', $tid);
    }
    $ev = DB::insert('calendar_events', ['user_id' => $uid, 'title' => 'Weekly planning', 'event_type' => 'schedule', 'start_at' => date('Y-m-d 08:30:00', strtotime('monday next week')), 'end_at' => date('Y-m-d 09:00:00', strtotime('monday next week')), 'repeat_rule' => 'weekly', 'reminder_minutes' => 15, 'color' => '#8b5cf6']);
    Scheduler::sync('event', $ev);
    $mm = DB::insert('mindmaps', ['user_id' => $uid, 'title' => 'Product ideas']);
    MindmapsController::saveGraph($mm, [
        ['key' => 'root', 'label' => 'Product ideas', 'x' => 0, 'y' => 0],
        ['key' => 'a', 'parent' => 'root', 'label' => 'Mobile app', 'x' => 0, 'y' => 0, 'icon' => 'rocket'],
        ['key' => 'b', 'parent' => 'root', 'label' => 'Integrations', 'x' => 0, 'y' => 0],
        ['key' => 'c', 'parent' => 'root', 'label' => 'Analytics', 'x' => 0, 'y' => 0, 'icon' => 'target'],
        ['key' => 'a1', 'parent' => 'a', 'label' => 'Offline mode', 'x' => 0, 'y' => 0],
        ['key' => 'a2', 'parent' => 'a', 'label' => 'Widgets', 'x' => 0, 'y' => 0],
        ['key' => 'b1', 'parent' => 'b', 'label' => 'Google Calendar', 'x' => 0, 'y' => 0],
    ], []);
    $fc = DB::insert('flowcharts', ['user_id' => $uid, 'title' => 'Leave approval process', 'settings_json' => json_encode(['grid' => true, 'snap' => true])]);
    FlowchartsController::saveGraph($fc, [
        ['key' => 's', 'type' => 'start', 'label' => 'Start', 'x' => 0, 'y' => 0, 'w' => 140, 'h' => 56],
        ['key' => 'i', 'type' => 'input', 'label' => 'Submit leave request', 'x' => -15, 'y' => 110, 'w' => 170, 'h' => 64],
        ['key' => 'd', 'type' => 'decision', 'label' => 'Approved?', 'x' => -10, 'y' => 230, 'w' => 160, 'h' => 96],
        ['key' => 'p', 'type' => 'process', 'label' => 'Update schedule', 'x' => -10, 'y' => 390, 'w' => 160, 'h' => 64],
        ['key' => 'r', 'type' => 'document', 'label' => 'Rejection notice', 'x' => 240, 'y' => 240, 'w' => 160, 'h' => 78],
        ['key' => 'e', 'type' => 'end', 'label' => 'End', 'x' => 0, 'y' => 510, 'w' => 140, 'h' => 56],
    ], [
        ['key' => 'e1', 'source' => 's', 'target' => 'i', 'sourcePort' => 'bottom', 'targetPort' => 'top'],
        ['key' => 'e2', 'source' => 'i', 'target' => 'd', 'sourcePort' => 'bottom', 'targetPort' => 'top'],
        ['key' => 'e3', 'source' => 'd', 'target' => 'p', 'sourcePort' => 'bottom', 'targetPort' => 'top', 'label' => 'Yes'],
        ['key' => 'e4', 'source' => 'd', 'target' => 'r', 'sourcePort' => 'right', 'targetPort' => 'left', 'label' => 'No'],
        ['key' => 'e5', 'source' => 'p', 'target' => 'e', 'sourcePort' => 'bottom', 'targetPort' => 'top'],
    ]);
}

$h = static fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
?><!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Install SmartNotes</title>
<style>
:root{--a:#6366f1;--b:#e5e7ec;--t:#161a22;--m:#586071;color-scheme:light}
*{box-sizing:border-box}body{margin:0;font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f6f8;color:var(--t)}
.wrap{max-width:820px;margin:0 auto;padding:40px 18px 80px}
.brand{display:flex;align-items:center;gap:12px;font-weight:750;font-size:22px;margin-bottom:6px}
.mark{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--a),#ec4899)}
.card{background:#fff;border:1px solid var(--b);border-radius:18px;padding:22px;margin:18px 0;box-shadow:0 1px 3px rgba(16,24,40,.05)}
h2{font-size:17px;margin:0 0 14px}label{display:block;font-size:13px;font-weight:620;color:var(--m);margin-bottom:5px}
input,select{width:100%;height:42px;border:1px solid var(--b);border-radius:10px;padding:0 12px;font:inherit;background:#fff}
input:focus{outline:2px solid var(--a);border-color:transparent}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.full{grid-column:1/-1}
.btn{display:inline-flex;align-items:center;gap:8px;height:46px;padding:0 22px;border:0;border-radius:12px;background:var(--a);color:#fff;font-weight:650;font-size:15px;cursor:pointer;text-decoration:none}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:8px 4px;border-bottom:1px solid var(--b)}
.ok{color:#12a26a;font-weight:700}.no{color:#e5484d;font-weight:700}.warn{color:#e08a00;font-weight:700}
.err{background:#fde8e8;border:1px solid #f5b5b5;color:#9b1c1c;border-radius:12px;padding:12px 16px;margin:10px 0}
.success{background:#e6f7ef;border:1px solid #9fdcbf;border-radius:12px;padding:16px}
code,pre{background:#f0f1f4;border-radius:8px;padding:2px 6px;font-size:13px}pre{padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-all}
.check{display:flex;align-items:center;gap:8px;font-weight:500;color:var(--t)}.check input{width:auto;height:auto}
.hint{font-size:12.5px;color:var(--m);margin-top:4px}
@media(max-width:640px){.grid{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<div class="brand"><span class="mark"></span> SmartNotes installer</div>
<p style="color:var(--m);margin:0">Notes · Tasks · Calendar · Meetings · Mind maps · Flowcharts · Audio — for PHP + MySQL shared hosting.</p>

<?php if ($done): ?>
  <div class="card success">
    <h2>Installation complete</h2>
    <?php if ($done['written']): ?>
      <p>The configuration was saved to <code>app/config.php</code>.</p>
    <?php else: ?>
      <p><b>Could not write <code>app/config.php</code>.</b> Create that file manually (File Manager) with this content:</p>
      <pre><?= $h($done['php']) ?></pre>
    <?php endif; ?>
    <p><b>Next steps</b></p>
    <ol>
      <li><b>Delete the <code>install</code> folder</b> from your hosting for security.</li>
      <li>Add a cron job (cPanel → Cron Jobs → every 5 minutes):<br><code>/usr/local/bin/php <?= $h(SN_ROOT) ?>/cron.php &gt;/dev/null 2&gt;&amp;1</code><br>
        <span class="hint">No cron available? Use an external cron service to open <code><?= $h($done['url']) ?>cron.php?token=<?= $h($done['cron']) ?></code></span></li>
      <li>Sign in and configure SMTP in <b>Admin → Email &amp; reminders</b>.</li>
    </ol>
    <p><a class="btn" href="../">Open SmartNotes →</a></p>
  </div>
<?php elseif ($installed): ?>
  <div class="card"><h2>SmartNotes is already installed</h2><p>For security this installer is disabled. Delete the <code>install</code> folder from your server.</p><a class="btn" href="../">Open SmartNotes →</a></div>
<?php else: ?>
  <?php foreach ($errors as $err): ?><div class="err"><?= $h($err) ?></div><?php endforeach; ?>
  <div class="card"><h2>1. Server requirements</h2><table>
    <?php foreach ($req as [$label, $ok, $info, $required]): ?>
      <tr><td><?= $h($label) ?> <?= $info ? '<span class="hint">(' . $h($info) . ')</span>' : '' ?></td><td style="text-align:right" class="<?= $ok ? 'ok' : ($required ? 'no' : 'warn') ?>"><?= $ok ? 'OK' : ($required ? 'Missing' : 'Optional') ?></td></tr>
    <?php endforeach; ?>
  </table>
  <p class="hint">PHP upload limit: <?= $h(ini_get('upload_max_filesize')) ?> · post_max_size: <?= $h(ini_get('post_max_size')) ?> · memory_limit: <?= $h(ini_get('memory_limit')) ?></p></div>

  <form method="post" autocomplete="off">
    <input type="hidden" name="csrf" value="<?= $h($_SESSION['install_csrf']) ?>">
    <div class="card"><h2>2. MySQL database</h2>
      <p class="hint" style="margin-top:-6px">Create the database &amp; user first in cPanel → MySQL Databases (or hPanel → Databases) and give the user ALL PRIVILEGES.</p>
      <div class="grid">
        <div><label>Host</label><input name="db_host" value="<?= $h($in('db_host', 'localhost')) ?>" required></div>
        <div><label>Port</label><input name="db_port" value="<?= $h($in('db_port', '3306')) ?>" required></div>
        <div><label>Database name</label><input name="db_name" value="<?= $h($in('db_name')) ?>" required></div>
        <div><label>Database user</label><input name="db_user" value="<?= $h($in('db_user')) ?>" required></div>
        <div class="full"><label>Database password</label><input type="password" name="db_pass" value=""></div>
        <div class="full"><label class="check"><input type="checkbox" name="overwrite" value="1"> Replace existing tables in this database (deletes all their data)</label></div>
      </div></div>
    <div class="card"><h2>3. Application</h2><div class="grid">
      <div class="full"><label>Application URL</label><input name="app_url" value="<?= $h($in('app_url', $defaultUrl)) ?>" required><div class="hint">Used in e-mail links. Must end with “/”.</div></div>
      <div class="full"><label>Timezone</label><select name="timezone"><?php foreach (timezone_identifiers_list() as $tz): ?><option <?= $tz === $in('timezone', 'Asia/Jakarta') ? 'selected' : '' ?>><?= $h($tz) ?></option><?php endforeach; ?></select></div>
    </div></div>
    <div class="card"><h2>4. Administrator account</h2><div class="grid">
      <div><label>Full name</label><input name="admin_name" value="<?= $h($in('admin_name')) ?>" required></div>
      <div><label>E-mail</label><input type="email" name="admin_email" value="<?= $h($in('admin_email')) ?>" required></div>
      <div class="full"><label>Password</label><input type="password" name="admin_password" required minlength="8"><div class="hint">At least 8 characters with letters and numbers.</div></div>
      <div class="full"><label class="check"><input type="checkbox" name="demo" value="1" checked> Add example content (a note, tasks, a meeting, a mind map and a flowchart)</label></div>
    </div></div>
    <button class="btn" type="submit" <?= $reqOk ? '' : 'disabled' ?>>Install SmartNotes</button>
  </form>
<?php endif; ?>
</div></body></html>
