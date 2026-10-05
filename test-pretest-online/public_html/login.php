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
                redirect($user['role'] === 'admin' ? 'admin/index.php' : 'dashboard.php');
            }
        } else {
            q('INSERT INTO login_attempts (ip_address, username, attempted_at) VALUES (?, ?, ?)', [$ip, mb_substr($login, 0, 150), now()]);
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
require __DIR__ . '/includes/header.php';
?>
<div class="auth-wrap">
    <section class="auth-side">
        <div class="brand"><img src="<?= e(url('assets/images/logo.svg')) ?>" width="40" height="40" alt=""><span><?= e(APP_NAME) ?><small><?= e(APP_TAGLINE) ?></small></span></div>
        <div>
            <h1>Ukur kemampuan.<br><span>Buktikan kompetensi.</span></h1>
            <p class="mb-4" style="color:#c7d0e6;max-width:440px">Platform ujian online untuk Pre-Test dan Test resmi — cepat, aman, dan tersimpan langsung ke database.</p>
            <div class="feature"><i class="bi bi-lightning-charge"></i><div><strong class="text-white d-block">Auto-save jawaban</strong>Setiap jawaban tersimpan otomatis ke server.</div></div>
            <div class="feature"><i class="bi bi-shield-lock"></i><div><strong class="text-white d-block">Aman & terkontrol</strong>Timer diverifikasi server, hasil Test hanya untuk administrator.</div></div>
            <div class="feature"><i class="bi bi-bar-chart-line"></i><div><strong class="text-white d-block">Analitik lengkap</strong>Statistik, ranking, dan export Excel / PDF.</div></div>
        </div>
        <small style="color:#6f80aa">© <?= date('Y') ?> <?= e(APP_NAME) ?></small>
    </section>
    <section class="auth-form">
        <div class="inner fade-in">
            <div class="d-lg-none text-center mb-4">
                <img src="<?= e(url('assets/images/logo.svg')) ?>" width="56" height="56" alt="">
            </div>
            <h2 class="fw-800 mb-1">Selamat datang 👋</h2>
            <p class="text-muted mb-4">Masuk untuk melanjutkan ke akun Anda.</p>

            <?php foreach (take_flash() as $f): ?>
                <div class="alert alert-<?= e($f['type']) ?> soft-alert py-2"><?= e($f['message']) ?></div>
            <?php endforeach; ?>
            <?php if ($error): ?>
                <div class="alert alert-danger soft-alert py-2"><i class="bi bi-exclamation-circle me-1"></i><?= e($error) ?></div>
            <?php endif; ?>

            <form method="post" autocomplete="on" novalidate>
                <?= csrf_field() ?>
                <div class="mb-3">
                    <label class="form-label" for="login">Username atau Email</label>
                    <div class="input-icon">
                        <i class="bi bi-person"></i>
                        <input type="text" class="form-control form-control-lg" id="login" name="login" value="<?= e($login) ?>" required autofocus>
                    </div>
                </div>
                <div class="mb-4">
                    <label class="form-label" for="password">Password</label>
                    <div class="input-icon position-relative">
                        <i class="bi bi-lock"></i>
                        <input type="password" class="form-control form-control-lg pe-5" id="password" name="password" required>
                        <button type="button" class="btn btn-sm position-absolute top-50 end-0 translate-middle-y me-1 text-muted" data-toggle-password="#password" aria-label="Tampilkan password"><i class="bi bi-eye"></i></button>
                    </div>
                </div>
                <button class="btn btn-primary btn-lg w-100" type="submit">Masuk <i class="bi bi-arrow-right ms-1"></i></button>
            </form>
            <p class="text-muted small text-center mt-4 mb-0">Lupa password? Hubungi administrator untuk reset.</p>
        </div>
    </section>
</div>
<?php require __DIR__ . '/includes/footer.php'; ?>
