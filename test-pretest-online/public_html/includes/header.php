<?php
/**
 * Layout header.
 * Variabel opsional sebelum include:
 *   $pageTitle  string
 *   $layout     'admin' | 'user' | 'auth' | 'exam'
 *   $activeMenu string  (key menu aktif)
 *   $extraHead  string  (HTML tambahan di <head>)
 */
$pageTitle  = $pageTitle ?? APP_NAME;
$layout     = $layout ?? 'user';
$activeMenu = $activeMenu ?? '';
$me         = current_user();

$adminMenu = [
    'dashboard' => ['admin/index.php', 'bi-grid-1x2', 'Dashboard'],
    'results'   => ['admin/results.php', 'bi-clipboard2-data', 'Test Results'],
    'exams'     => ['admin/exams.php', 'bi-journal-check', 'Exams'],
    'questions' => ['admin/questions.php', 'bi-collection', 'Question Bank'],
    'users'     => ['admin/users.php', 'bi-people', 'Users'],
];
$userMenu = [
    'dashboard' => ['dashboard.php', 'bi-house-door', 'Dashboard'],
    'history'   => ['user/history.php', 'bi-clock-history', 'Riwayat Ujian'],
    'profile'   => ['user/profile.php', 'bi-person-circle', 'Profil'],
];
?>
<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="<?= e(csrf_token()) ?>">
    <meta name="base-url" content="<?= e(base_path()) ?>">
    <title><?= e($pageTitle) ?> · <?= e(APP_NAME) ?></title>
    <link rel="icon" href="<?= e(url('assets/images/logo.svg')) ?>" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
    <link href="<?= e(asset('css/app.css')) ?>" rel="stylesheet">
    <?= $extraHead ?? '' ?>
</head>
<body class="layout-<?= e($layout) ?>">
<div id="toast-stack" class="toast-stack" aria-live="polite"></div>

<?php if ($layout === 'admin' && $me): ?>
<div class="app-shell">
    <aside class="sidebar" id="sidebar">
        <a class="brand" href="<?= e(url('admin/index.php')) ?>">
            <img src="<?= e(url('assets/images/logo.svg')) ?>" alt="" width="34" height="34">
            <span><?= e(APP_NAME) ?><small>Admin Console</small></span>
        </a>
        <nav class="side-nav">
            <div class="side-label">Menu</div>
            <?php foreach ($adminMenu as $key => [$href, $icon, $label]): ?>
                <a href="<?= e(url($href)) ?>" class="<?= $activeMenu === $key ? 'active' : '' ?>">
                    <i class="bi <?= e($icon) ?>"></i><span><?= e($label) ?></span>
                </a>
            <?php endforeach; ?>
        </nav>
        <div class="side-footer">
            <div class="side-user">
                <div class="avatar"><?= e(initials($me['name'])) ?></div>
                <div class="min-w-0">
                    <div class="fw-semibold text-truncate"><?= e($me['name']) ?></div>
                    <small class="text-truncate d-block">Administrator</small>
                </div>
            </div>
            <a href="<?= e(url('logout.php')) ?>" class="btn btn-sm btn-outline-light w-100 mt-3"><i class="bi bi-box-arrow-right me-1"></i>Logout</a>
        </div>
    </aside>
    <div class="sidebar-backdrop" data-sidebar-close></div>
    <main class="main">
        <header class="topbar">
            <button class="btn btn-icon d-lg-none" data-sidebar-toggle aria-label="Menu"><i class="bi bi-list"></i></button>
            <h1 class="page-title"><?= e($pageTitle) ?></h1>
            <div class="ms-auto d-flex align-items-center gap-2">
                <span class="badge rounded-pill text-bg-light d-none d-md-inline"><i class="bi bi-calendar3 me-1"></i><?= e(tanggal_id(null, false)) ?></span>
            </div>
        </header>
        <div class="content">
<?php elseif ($layout === 'user' && $me): ?>
<nav class="navbar navbar-expand-lg user-nav sticky-top">
    <div class="container-xl">
        <a class="navbar-brand brand" href="<?= e(url('dashboard.php')) ?>">
            <img src="<?= e(url('assets/images/logo.svg')) ?>" alt="" width="32" height="32">
            <span><?= e(APP_NAME) ?><small><?= e(APP_TAGLINE) ?></small></span>
        </a>
        <button class="navbar-toggler border-0" type="button" data-bs-toggle="collapse" data-bs-target="#userNav" aria-label="Menu">
            <i class="bi bi-list text-white fs-3"></i>
        </button>
        <div class="collapse navbar-collapse" id="userNav">
            <ul class="navbar-nav ms-auto align-items-lg-center gap-lg-1">
                <?php foreach ($userMenu as $key => [$href, $icon, $label]): ?>
                    <li class="nav-item">
                        <a class="nav-link <?= $activeMenu === $key ? 'active' : '' ?>" href="<?= e(url($href)) ?>"><i class="bi <?= e($icon) ?> me-1"></i><?= e($label) ?></a>
                    </li>
                <?php endforeach; ?>
                <li class="nav-item ms-lg-2">
                    <a class="btn btn-gold btn-sm px-3" href="<?= e(url('logout.php')) ?>"><i class="bi bi-box-arrow-right me-1"></i>Logout</a>
                </li>
            </ul>
        </div>
    </div>
</nav>
<main class="container-xl py-4 user-main">
<?php else: ?>
<main>
<?php endif; ?>

<?php if ($layout !== 'auth'): foreach (take_flash() as $f): ?>
    <div class="alert alert-<?= e($f['type']) ?> alert-dismissible fade show soft-alert" role="alert">
        <?= e($f['message']) ?>
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    </div>
<?php endforeach; endif; ?>
