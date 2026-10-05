<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/functions.php';

app_session_start();
if (current_user()) {
    redirect(is_admin() ? 'admin/index.php' : 'dashboard.php');
}

$error = '';
$login = '';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    verify_csrf();
    $login = trim((string) ($_POST['login'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');
    $ip = client_ip();
    $since = date('Y-m-d H:i:s', time() - LOGIN_LOCK_MINUTES * 60);

    $fails = (int) q_val('SELECT COUNT(*) FROM login_attempts WHERE ip_address = ? AND attempted_at > ?', [$ip, $since]);
    if ($fails >= LOGIN_MAX_ATTEMPTS) {
        $error = 'Terlalu banyak percobaan login. Coba lagi dalam ' . LOGIN_LOCK_MINUTES . ' menit.';
    } elseif ($login === '' || $password === '') {
        $error = 'Username/email dan password wajib diisi.';
    } else {
        $user = q_row('SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1', [$login, $login]);
        if ($user && password_verify($password, $user['password'])) {
            if ($user['status'] !== 'active') {
                $error = 'Akun Anda dinonaktifkan. Hubungi administrator.';
            } else {
                if (password_needs_rehash($user['password'], PASSWORD_DEFAULT)) {
                    q('UPDATE users SET password = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $user['id']]);
                }
                q('DELETE FROM login_attempts WHERE ip_address = ?', [$ip]);
                login_user($user);
                log_activity('login', 'Login berhasil (' . ($user['role'] === 'admin' ? 'administrator' : 'peserta') . ')', (int) $user['id']);
                redirect($user['role'] === 'admin' ? 'admin/index.php' : 'dashboard.php');
            }
        } else {
            q('INSERT INTO login_attempts (ip_address, username, attempted_at) VALUES (?, ?, ?)', [$ip, mb_substr($login, 0, 150), now()]);
            log_activity('login_failed', 'Login gagal untuk "' . mb_substr($login, 0, 60) . '"', $user ? (int) $user['id'] : null);
            // Bersihkan log lama sesekali
            if (random_int(1, 50) === 1) {
                q('DELETE FROM login_attempts WHERE attempted_at < ?', [date('Y-m-d H:i:s', time() - 86400)]);
            }
            $error = 'Username/email atau password salah.';
        }
    }
}

$pageTitle = 'Login';
$layout = 'auth';
$logoUrl = app_logo_url();
require __DIR__ . '/includes/header.php';
?>
<div class="auth-wrap">
    <section class="auth-side">
        <div class="brand">
            <img src="<?= e($logoUrl) ?>" width="48" height="48" alt="" class="brand-logo">
            <span><?= e(app_name()) ?><small class="d-block"><?= e(institution_full()) ?></small></span>
        </div>
        <div>
            <span class="badge rounded-pill mb-3" style="background:rgba(255,255,255,.1);color:var(--gold);font-weight:600;padding:.5rem .9rem"><i class="bi bi-patch-check me-1"></i><?= e(app_tagline()) ?></span>
            <h1>Uji pengetahuan.<br><span>Tingkatkan pelayanan.</span></h1>
            <p class="mb-4" style="color:#c7d0e6;max-width:460px"><?= e(setting('login_message')) ?></p>
            <div class="feature"><i class="bi bi-cloud-check"></i><div><strong class="text-white d-block">Jawaban tersimpan otomatis</strong>Setiap jawaban langsung disimpan ke server — aman dari putus koneksi.</div></div>
            <div class="feature"><i class="bi bi-shield-lock"></i><div><strong class="text-white d-block">Aman & terawasi</strong>Timer diverifikasi server, hasil Test resmi hanya untuk administrator.</div></div>
            <div class="feature"><i class="bi bi-graph-up-arrow"></i><div><strong class="text-white d-block">Analitik kompetensi</strong>Statistik per bidang, ranking, serta laporan Excel & PDF.</div></div>
        </div>
        <small style="color:#6f80aa">© <?= date('Y') ?> <?= e(institution_full()) ?></small>
    </section>
    <section class="auth-form">
        <button class="btn btn-icon btn-light auth-theme" data-theme-toggle aria-label="Ganti tema"><i class="bi bi-moon-stars"></i></button>
        <div class="inner fade-in">
            <div class="text-center mb-4">
                <img src="<?= e($logoUrl) ?>" class="auth-logo mb-3" alt="Logo">
                <div class="small-caps"><?= e(setting('institution_name')) ?></div>
                <?php if (setting('institution_region') !== ''): ?><div class="small text-muted"><?= e(setting('institution_region')) ?></div><?php endif; ?>
            </div>
            <h2 class="fw-800 mb-1 text-center">Masuk ke <?= e(app_name()) ?></h2>
            <p class="text-muted mb-4 text-center">Gunakan akun yang diberikan administrator.</p>

            <?php foreach (take_flash() as $f): ?>
                <div class="alert alert-<?= e($f['type']) ?> soft-alert py-2"><?= e($f['message']) ?></div>
            <?php endforeach; ?>
            <?php if ($error): ?>
                <div class="alert alert-danger soft-alert py-2"><i class="bi bi-exclamation-circle me-1"></i><?= e($error) ?></div>
            <?php endif; ?>

            <form method="post" autocomplete="on" novalidate id="loginForm">
                <?= csrf_field() ?>
                <div class="mb-3">
                    <label class="form-label" for="login">Username atau Email</label>
                    <div class="input-icon">
                        <i class="bi bi-person"></i>
                        <input type="text" class="form-control form-control-lg" id="login" name="login" value="<?= e($login) ?>" required autofocus autocapitalize="none">
                    </div>
                </div>
                <div class="mb-4">
                    <label class="form-label" for="password">Password</label>
                    <div class="input-icon position-relative">
                        <i class="bi bi-lock"></i>
                        <input type="password" class="form-control form-control-lg pe-5" id="password" name="password" required>
                        <button type="button" class="btn btn-sm position-absolute top-50 end-0 translate-middle-y me-1 text-muted border-0" data-toggle-password="#password" aria-label="Tampilkan password"><i class="bi bi-eye"></i></button>
                    </div>
                    <div class="small text-warning mt-2 d-none" id="capsWarn"><i class="bi bi-capslock"></i> Caps Lock aktif</div>
                </div>
                <button class="btn btn-primary btn-lg w-100" type="submit" id="btnLogin">Masuk <i class="bi bi-arrow-right ms-1"></i></button>
            </form>
            <p class="text-muted small text-center mt-4 mb-0"><i class="bi bi-info-circle"></i> Lupa password? Hubungi administrator untuk reset.</p>
        </div>
    </section>
</div>
<script>
document.getElementById('password').addEventListener('keyup', function (e) {
    document.getElementById('capsWarn').classList.toggle('d-none', !(e.getModifierState && e.getModifierState('CapsLock')));
});
document.getElementById('loginForm').addEventListener('submit', function () {
    var b = document.getElementById('btnLogin');
    b.disabled = true;
    b.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Memproses...';
});
</script>
<?php require __DIR__ . '/includes/footer.php'; ?>
