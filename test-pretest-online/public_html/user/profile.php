<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/auth.php';

$me = current_user();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    verify_csrf();
    $current = (string) ($_POST['current_password'] ?? '');
    $new = (string) ($_POST['new_password'] ?? '');
    $confirm = (string) ($_POST['confirm_password'] ?? '');
    $hash = (string) q_val('SELECT password FROM users WHERE id = ?', [$me['id']]);
    if (!password_verify($current, $hash)) {
        flash('danger', 'Password saat ini salah.');
    } elseif (strlen($new) < 8) {
        flash('danger', 'Password baru minimal 8 karakter.');
    } elseif ($new !== $confirm) {
        flash('danger', 'Konfirmasi password tidak sama.');
    } else {
        q('UPDATE users SET password = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $me['id']]);
        flash('success', 'Password berhasil diperbarui.');
    }
    redirect('user/profile.php');
}

$pageTitle = 'Profil';
$activeMenu = 'profile';
$layout = is_admin() ? 'admin' : 'user';
require dirname(__DIR__) . '/includes/header.php';
?>
<div class="row g-4 justify-content-center">
    <div class="col-lg-5">
        <div class="card-x h-100">
            <div class="card-x-body text-center p-4">
                <div class="avatar mx-auto mb-3" style="width:84px;height:84px;font-size:1.6rem"><?= e(initials($me['name'])) ?></div>
                <h2 class="h5 fw-800 mb-0"><?= e($me['name']) ?></h2>
                <p class="text-muted">@<?= e($me['username']) ?></p>
                <dl class="kv text-start mt-4">
                    <dt>Email</dt><dd><?= e($me['email'] ?: '—') ?></dd>
                    <dt>Department</dt><dd><?= e($me['department'] ?: '—') ?></dd>
                    <dt>Jabatan</dt><dd><?= e($me['position'] ?: '—') ?></dd>
                    <dt>Role</dt><dd><?= e(ucfirst($me['role'])) ?></dd>
                </dl>
            </div>
        </div>
    </div>
    <div class="col-lg-5">
        <div class="card-x h-100">
            <div class="card-x-header"><h3><i class="bi bi-key me-1"></i>Ganti Password</h3></div>
            <form method="post" class="card-x-body">
                <?= csrf_field() ?>
                <div class="mb-3"><label class="form-label">Password saat ini</label><input type="password" name="current_password" class="form-control" required></div>
                <div class="mb-3"><label class="form-label">Password baru</label><input type="password" name="new_password" class="form-control" minlength="8" required></div>
                <div class="mb-4"><label class="form-label">Konfirmasi password baru</label><input type="password" name="confirm_password" class="form-control" minlength="8" required></div>
                <button class="btn btn-primary w-100">Simpan Password</button>
            </form>
        </div>
    </div>
</div>
<?php require dirname(__DIR__) . '/includes/footer.php'; ?>
