<?php
/**
 * Layout header.
 * Variabel opsional sebelum include:
 *   $pageTitle  string
 *   $layout     'admin' | 'user' | 'auth' | 'exam' | 'plain'
 *   $activeMenu string  (key menu aktif)
 *   $extraHead  string  (HTML tambahan di <head>)
 */
$pageTitle  = $pageTitle ?? app_name();
$layout     = $layout ?? 'user';
$activeMenu = $activeMenu ?? '';
$me         = current_user();
$logoUrl    = app_logo_url();

$adminMenu = [
    'Utama' => [
        'dashboard' => ['admin/index.php', 'bi-grid-1x2', 'Dashboard'],
        'results'   => ['admin/results.php', 'bi-clipboard2-data', 'Test Results'],
    ],
    'Kelola Ujian' => [
        'exams'     => ['admin/exams.php', 'bi-journal-check', 'Exams'],
        'questions' => ['admin/questions.php', 'bi-collection', 'Question Bank'],
        'users'     => ['admin/users.php', 'bi-people', 'Users'],
    ],
    'Sistem' => [
        'activity'  => ['admin/activity.php', 'bi-activity', 'Log Aktivitas'],
        'settings'  => ['admin/settings.php', 'bi-gear', 'Pengaturan'],
    ],
];
$userMenu = [
    'dashboard' => ['dashboard.php', 'bi-house-door', 'Dashboard'],
    'history'   => ['user/history.php', 'bi-clock-history', 'Riwayat'],
    'profile'   => ['user/profile.php', 'bi-person-circle', 'Profil'],
];
?>
<!doctype html>
<html lang="id" data-bs-theme="light">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="csrf-token" content="<?= e(csrf_token()) ?>">
    <meta name="base-url" content="<?= e(base_path()) ?>">
    <meta name="theme-color" content="#0b1b3f">
    <title><?= e($pageTitle) ?> · <?= e(app_name()) ?></title>
    <script>
        /* Terapkan tema sebelum render agar tidak berkedip */
        (function () {
            try {
                var t = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
                document.documentElement.setAttribute('data-bs-theme', t);
            } catch (e) {}
        })();
    </script>
    <link rel="icon" href="<?= e($logoUrl) ?>">
    <link rel="apple-touch-icon" href="<?= e($logoUrl) ?>">
    <link rel="manifest" href="<?= e(url('manifest.php')) ?>">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
    <link href="<?= e(asset('css/app.css')) ?>" rel="stylesheet">
    <style><?= theme_css() ?></style>
    <?= $extraHead ?? '' ?>
</head>
<body class="layout-<?= e($layout) ?>">
<div id="toast-stack" class="toast-stack" aria-live="polite"></div>

<?php if ($layout === 'admin' && $me): ?>
<div class="app-shell">
    <aside class="sidebar" id="sidebar">
        <a class="brand" href="<?= e(url('admin/index.php')) ?>">
            <img src="<?= e($logoUrl) ?>" alt="" width="40" height="40" class="brand-logo">
            <span class="min-w-0"><span class="d-block text-truncate"><?= e(app_name()) ?></span><small class="text-truncate d-block"><?= e(setting('institution_name')) ?></small></span>
        </a>
        <nav class="side-nav">
            <?php foreach ($adminMenu as $group => $items): ?>
                <div class="side-label"><?= e($group) ?></div>
                <?php foreach ($items as $key => [$href, $icon, $label]): ?>
                    <a href="<?= e(url($href)) ?>" class="<?= $activeMenu === $key ? 'active' : '' ?>">
                        <i class="bi <?= e($icon) ?>"></i><span><?= e($label) ?></span>
                    </a>
                <?php endforeach; ?>
            <?php endforeach; ?>
        </nav>
        <div class="side-footer">
            <div class="module-pills">
                <span class="<?= exam_type_enabled('pretest') ? 'on' : 'off' ?>"><i class="bi bi-circle-fill"></i> Pre-Test</span>
                <span class="<?= exam_type_enabled('test') ? 'on' : 'off' ?>"><i class="bi bi-circle-fill"></i> Test</span>
            </div>
            <div class="side-user">
                <div class="avatar"><?= e(initials($me['name'])) ?></div>
                <div class="min-w-0">
                    <div class="fw-semibold text-truncate"><?= e($me['name']) ?></div>
                    <small class="text-truncate d-block">Administrator</small>
                </div>
            </div>
        </div>
    </aside>
    <div class="sidebar-backdrop" data-sidebar-close></div>
    <main class="main">
        <header class="topbar">
            <button class="btn btn-icon d-lg-none" data-sidebar-toggle aria-label="Menu"><i class="bi bi-list"></i></button>
            <h1 class="page-title text-truncate"><?= e($pageTitle) ?></h1>
            <div class="ms-auto d-flex align-items-center gap-2">
                <span class="date-chip d-none d-md-inline-flex"><i class="bi bi-calendar3"></i><?= e(tanggal_id(null, false)) ?></span>
                <button class="btn btn-icon btn-light" data-theme-toggle title="Mode gelap/terang" aria-label="Ganti tema"><i class="bi bi-moon-stars"></i></button>
                <div class="dropdown">
                    <button class="btn btn-icon btn-light" data-bs-toggle="dropdown" aria-label="Akun"><i class="bi bi-person"></i></button>
                    <ul class="dropdown-menu dropdown-menu-end shadow border-0">
                        <li><h6 class="dropdown-header"><?= e($me['name']) ?></h6></li>
                        <li><a class="dropdown-item" href="<?= e(url('user/profile.php')) ?>"><i class="bi bi-key me-2"></i>Ganti Password</a></li>
                        <li><a class="dropdown-item" href="<?= e(url('admin/settings.php')) ?>"><i class="bi bi-gear me-2"></i>Pengaturan</a></li>
                        <li><hr class="dropdown-divider"></li>
                        <li><a class="dropdown-item text-danger" href="<?= e(url('logout.php')) ?>"><i class="bi bi-box-arrow-right me-2"></i>Logout</a></li>
                    </ul>
                </div>
            </div>
        </header>
        <div class="content">
<?php elseif ($layout === 'user' && $me): ?>
<nav class="user-nav sticky-top">
    <div class="container-xl d-flex align-items-center gap-2">
        <a class="brand me-auto min-w-0" href="<?= e(url('dashboard.php')) ?>">
            <img src="<?= e($logoUrl) ?>" alt="" width="38" height="38" class="brand-logo">
            <span class="min-w-0"><span class="d-block text-truncate"><?= e(app_name()) ?></span><small class="text-truncate d-block"><?= e(setting('institution_name')) ?></small></span>
        </a>
        <div class="d-none d-lg-flex align-items-center gap-1 me-2">
            <?php foreach ($userMenu as $key => [$href, $icon, $label]): ?>
                <a class="nav-pill <?= $activeMenu === $key ? 'active' : '' ?>" href="<?= e(url($href)) ?>"><i class="bi <?= e($icon) ?>"></i><?= e($label) ?></a>
            <?php endforeach; ?>
        </div>
        <button class="btn btn-icon btn-ghost-light" data-theme-toggle title="Mode gelap/terang" aria-label="Ganti tema"><i class="bi bi-moon-stars"></i></button>
        <a class="btn btn-gold btn-sm px-3 d-none d-lg-inline-flex align-items-center" href="<?= e(url('logout.php')) ?>"><i class="bi bi-box-arrow-right me-1"></i>Logout</a>
        <a class="btn btn-icon btn-ghost-light d-lg-none" href="<?= e(url('logout.php')) ?>" aria-label="Logout"><i class="bi bi-box-arrow-right"></i></a>
    </div>
</nav>
<nav class="bottom-nav d-lg-none">
    <?php foreach ($userMenu as $key => [$href, $icon, $label]): ?>
        <a class="<?= $activeMenu === $key ? 'active' : '' ?>" href="<?= e(url($href)) ?>"><i class="bi <?= e($icon) ?>"></i><span><?= e($label) ?></span></a>
    <?php endforeach; ?>
</nav>
<main class="container-xl py-4 user-main">
<?php else: ?>
<main>
<?php endif; ?>

<?php if (!in_array($layout, ['auth', 'plain'], true)): foreach (take_flash() as $f): ?>
    <div class="alert alert-<?= e($f['type']) ?> alert-dismissible fade show soft-alert" role="alert">
        <?= e($f['message']) ?>
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    </div>
<?php endforeach; endif; ?>
