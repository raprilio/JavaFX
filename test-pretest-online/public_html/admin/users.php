<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/admin_auth.php';

$depts = departments();
$exams = q_all('SELECT id, title, type, status FROM exams ORDER BY type, title');

$pageTitle = 'Users';
$layout = 'admin';
$activeMenu = 'users';
require dirname(__DIR__) . '/includes/header.php';
?>
<div class="card-x">
    <div class="card-x-header filter-bar">
        <div class="input-icon flex-fill" style="max-width:280px"><i class="bi bi-search"></i><input class="form-control" id="fQ" placeholder="Cari nama, username, email..."></div>
        <select class="form-select w-auto" id="fRole"><option value="">Semua role</option><option value="user">User</option><option value="admin">Admin</option></select>
        <select class="form-select w-auto" id="fDept"><option value="">Semua department</option><?php foreach ($depts as $d): ?><option><?= e($d) ?></option><?php endforeach; ?></select>
        <select class="form-select w-auto" id="fStatus"><option value="">Semua status</option><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select>
        <div class="ms-auto d-flex gap-2 flex-wrap">
            <button class="btn btn-light" data-bs-toggle="modal" data-bs-target="#importModal"><i class="bi bi-upload"></i> Import CSV</button>
            <a class="btn btn-soft" href="<?= e(url('admin/users-export.php')) ?>"><i class="bi bi-file-earmark-excel"></i> Export</a>
            <button class="btn btn-primary" id="btnNew"><i class="bi bi-person-plus me-1"></i>User Baru</button>
        </div>
    </div>
    <div class="table-responsive">
        <table class="table table-x table-stack">
            <thead><tr><th>User</th><th>Department</th><th>Role</th><th>Status</th><th class="text-end">Ujian</th><th>Login terakhir</th><th class="text-end">Aksi</th></tr></thead>
            <tbody id="uBody"></tbody>
        </table>
    </div>
    <div class="d-flex align-items-center p-3 border-top"><small class="text-muted" id="uInfo"></small><div class="ms-auto" id="uPager"></div></div>
</div>

<!-- Modal user -->
<div class="modal fade" id="uModal" tabindex="-1">
    <div class="modal-dialog modal-lg">
        <form class="modal-content" id="uForm" autocomplete="off">
            <div class="modal-header"><h5 class="modal-title" id="uTitle">User Baru</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body">
                <input type="hidden" name="id">
                <div class="row g-3">
                    <div class="col-md-6"><label class="form-label">Nama lengkap *</label><input class="form-control" name="name" required maxlength="120"></div>
                    <div class="col-md-6"><label class="form-label">Username *</label><input class="form-control" name="username" required pattern="[a-zA-Z0-9._\-]{3,60}" maxlength="60"></div>
                    <div class="col-md-6"><label class="form-label">Email</label><input type="email" class="form-control" name="email" maxlength="150"></div>
                    <div class="col-md-6"><label class="form-label">Password <span id="pwHint" class="text-muted fw-normal">(min. 8 karakter)</span></label><input type="password" class="form-control" name="password" minlength="8" autocomplete="new-password"></div>
                    <div class="col-md-6"><label class="form-label">Department</label><input class="form-control" name="department" list="deptList" maxlength="100">
                        <datalist id="deptList"><?php foreach ($depts as $d): ?><option value="<?= e($d) ?>"><?php endforeach; ?></datalist></div>
                    <div class="col-md-6"><label class="form-label">Jabatan / Position</label><input class="form-control" name="position" maxlength="100"></div>
                    <div class="col-md-6"><label class="form-label">Role</label><select class="form-select" name="role"><option value="user">User (Peserta)</option><option value="admin">Admin</option></select></div>
                    <div class="col-md-6"><label class="form-label">Status</label><select class="form-select" name="status"><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></div>
                    <div class="col-12" id="assignWrap">
                        <label class="form-label">Assign Exam <small class="text-muted fw-normal">— ujian tanpa assignment terbuka untuk semua user</small></label>
                        <div class="pool-list" style="max-height:200px">
                            <?php foreach ($exams as $x): ?>
                                <label><input type="checkbox" class="form-check-input mt-1 exam-chk" value="<?= (int) $x['id'] ?>">
                                    <span><span class="badge-type <?= $x['type'] === 'test' ? 'badge-test' : 'badge-pretest' ?> me-1"><?= e(type_label($x['type'])) ?></span><?= e($x['title']) ?> <small class="text-muted">(<?= e($x['status']) ?>)</small></span></label>
                            <?php endforeach; ?>
                            <?php if (!$exams): ?><div class="p-3 small text-muted">Belum ada ujian.</div><?php endif; ?>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Batal</button><button class="btn btn-primary px-4">Simpan</button></div>
        </form>
    </div>
</div>

<!-- Modal import -->
<div class="modal fade" id="importModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <form class="modal-content" id="importForm">
            <div class="modal-header"><h5 class="modal-title">Import User dari CSV</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body">
                <p class="small text-muted">Baris pertama wajib berisi header. Pemisah koma (,) atau titik koma (;).</p>
                <pre class="instruction-box small mb-3">name,username,email,password,department,position,role
Raka Aprilio,raka,raka@mail.com,Rahasia123,IT,Support,user</pre>
                <a class="small d-inline-block mb-3" href="<?= e(url('admin/users-export.php?template=1')) ?>"><i class="bi bi-download"></i> Download template CSV</a>
                <input type="file" class="form-control" name="file" accept=".csv,text/csv" required>
                <div id="importResult" class="mt-3 small"></div>
            </div>
            <div class="modal-footer"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Tutup</button><button class="btn btn-primary">Import</button></div>
        </form>
    </div>
</div>
<script>window.ME_ID = <?= (int) current_user()['id'] ?>;</script>
<?php
$extraScripts = ['js/admin-users.js'];
require dirname(__DIR__) . '/includes/footer.php';
