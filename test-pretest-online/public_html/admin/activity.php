<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/admin_auth.php';

$pageTitle = 'Log Aktivitas';
$layout = 'admin';
$activeMenu = 'activity';
require dirname(__DIR__) . '/includes/header.php';
?>
<div class="card-x">
    <div class="card-x-header filter-bar">
        <div class="input-icon flex-fill" style="max-width:320px"><i class="bi bi-search"></i><input class="form-control" id="fQ" placeholder="Cari deskripsi, nama, IP..."></div>
        <select class="form-select w-auto" id="fAction"><option value="">Semua aktivitas</option></select>
        <input type="date" class="form-control w-auto" id="fDate">
        <span class="small text-muted ms-auto" id="logInfo"></span>
    </div>
    <div class="card-x-body pt-2" id="logList"></div>
    <div class="d-flex p-3 border-top"><div class="ms-auto" id="logPager"></div></div>
</div>
<?php
$extraScripts = ['js/admin-activity.js'];
require dirname(__DIR__) . '/includes/footer.php';
