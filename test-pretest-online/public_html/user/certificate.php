<?php
/**
 * Sertifikat Pre-Test (A4 landscape, siap cetak / simpan PDF).
 * Syarat: Pre-Test, show_result = 1, LULUS, tidak ada essay tertunda, fitur aktif.
 * Test resmi TIDAK pernah menerbitkan sertifikat dari sisi peserta.
 */
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/auth.php';

$me = current_user();
$id = get_int('attempt');
$row = q_row(
    'SELECT a.*, u.name, u.department, u.position, e.title, e.type, e.show_result, e.passing_grade
       FROM exam_attempts a JOIN users u ON u.id = a.user_id JOIN exams e ON e.id = a.exam_id
      WHERE a.id = ?' . (is_admin() ? '' : ' AND a.user_id = ?'),
    is_admin() ? [$id] : [$id, $me['id']]
);
$eligible = $row
    && setting_on('certificate_enabled')
    && exam_user_can_view_score($row)
    && $row['status'] !== 'in_progress'
    && (int) $row['passed'] === 1
    && (int) $row['pending_review'] === 0;
if (!$eligible) {
    flash('warning', 'Sertifikat tidak tersedia untuk ujian ini.');
    redirect(is_admin() ? 'admin/results.php' : 'user/history.php');
}
$code = certificate_code((int) $row['id']);
$verifyUrl = (isset($_SERVER['HTTP_HOST']) ? ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https://' : 'http://') . $_SERVER['HTTP_HOST'] : '') . url('verify.php?code=' . $code);
?>
<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sertifikat · <?= e($row['name']) ?></title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Playfair+Display:ital,wght@0,700;1,600&display=swap" rel="stylesheet">
<style><?= theme_css() ?>
    * { box-sizing: border-box; }
    body { margin: 0; background: #e9edf5; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #0f1a33; }
    .bar { position: sticky; top: 0; background: #0b1b3f; padding: 12px 20px; display: flex; gap: 8px; color: #fff; align-items: center; z-index: 5; }
    .bar button, .bar a { border: 0; border-radius: 9px; padding: 9px 16px; font-weight: 700; cursor: pointer; font-family: inherit; text-decoration: none; font-size: 14px; }
    .bar .print { background: var(--gold); color: #061029; }
    .bar .back { background: #fff; color: #0b1b3f; }
    .wrap { padding: 24px; display: flex; justify-content: center; }
    .cert { width: 297mm; min-height: 210mm; background: #fff; position: relative; padding: 18mm 22mm; box-shadow: 0 20px 60px rgba(11,27,63,.18); overflow: hidden; }
    .cert::before { content: ''; position: absolute; inset: 8mm; border: 2px solid var(--gold); border-radius: 6px; pointer-events: none; }
    .cert::after { content: ''; position: absolute; inset: 10mm; border: 1px solid rgba(11,27,63,.25); border-radius: 4px; pointer-events: none; }
    .corner { position: absolute; width: 180px; height: 180px; background: radial-gradient(circle at 0 0, rgba(var(--accent-rgb), .25), transparent 70%); }
    .corner.tl { top: 0; left: 0; } .corner.br { bottom: 0; right: 0; transform: rotate(180deg); }
    .head { display: flex; align-items: center; justify-content: center; gap: 16px; text-align: left; position: relative; }
    .head img { width: 74px; height: 74px; object-fit: contain; }
    .inst { font-weight: 800; font-size: 17px; text-transform: uppercase; letter-spacing: .04em; color: #0b1b3f; }
    .region { font-size: 13px; color: #55617c; }
    h1 { font-family: 'Playfair Display', serif; font-size: 52px; margin: 26px 0 0; text-align: center; color: #0b1b3f; letter-spacing: .02em; }
    .sub { text-align: center; letter-spacing: .35em; font-size: 12px; font-weight: 700; color: var(--gold); margin-top: 4px; }
    .given { text-align: center; margin-top: 26px; color: #55617c; font-size: 15px; }
    .name { text-align: center; font-family: 'Playfair Display', serif; font-style: italic; font-size: 44px; margin: 8px auto 0; color: #0f1a33; border-bottom: 2px solid rgba(var(--accent-rgb), .6); display: table; padding: 0 30px 6px; }
    .dept { text-align: center; color: #55617c; margin-top: 8px; font-size: 14px; }
    .desc { text-align: center; max-width: 190mm; margin: 22px auto 0; font-size: 15px; line-height: 1.7; }
    .desc b { color: #0b1b3f; }
    .score { display: flex; justify-content: center; gap: 14px; margin-top: 18px; }
    .score div { border: 1px solid #e3e7f0; border-radius: 12px; padding: 8px 18px; text-align: center; min-width: 120px; }
    .score small { display: block; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #8590a8; font-weight: 700; }
    .score strong { font-size: 20px; color: #0b1b3f; }
    .foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 26px; position: relative; }
    .verify { font-size: 11px; color: #55617c; max-width: 95mm; }
    .verify code { display: inline-block; margin-top: 4px; font-size: 13px; font-weight: 700; color: #0b1b3f; letter-spacing: .05em; }
    .sign { text-align: center; min-width: 75mm; font-size: 14px; }
    .sign .line { margin-top: 62px; border-top: 1px solid #0f1a33; padding-top: 6px; font-weight: 800; }
    .seal { position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); width: 92px; height: 92px; border-radius: 50%; background: radial-gradient(circle, var(--gold), color-mix(in srgb, var(--gold) 70%, #000)); color: #fff; display: grid; place-items: center; text-align: center; font-weight: 800; font-size: 11px; letter-spacing: .08em; box-shadow: 0 6px 18px rgba(var(--accent-rgb), .45); border: 4px double rgba(255,255,255,.7); }
    @media print {
        body { background: #fff; }
        .bar { display: none; }
        .wrap { padding: 0; }
        .cert { box-shadow: none; width: 100%; min-height: 0; height: 100vh; }
        @page { size: A4 landscape; margin: 0; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    @media (max-width: 1100px) { .wrap { overflow-x: auto; justify-content: flex-start; } }
</style>
</head>
<body>
<div class="bar">
    <strong style="margin-right:auto">Sertifikat Pre-Test</strong>
    <button class="print" onclick="window.print()">🖨 Cetak / Simpan PDF</button>
    <a class="back" href="<?= e(url(is_admin() ? 'admin/result-detail.php?id=' . (int) $row['id'] : 'pretest-result.php?attempt=' . (int) $row['id'])) ?>">Kembali</a>
</div>
<div class="wrap">
    <div class="cert">
        <span class="corner tl"></span><span class="corner br"></span>
        <div class="head">
            <img src="<?= e(app_logo_url()) ?>" alt="">
            <div><div class="inst"><?= e(setting('institution_name')) ?></div><div class="region"><?= e(setting('institution_region')) ?></div></div>
        </div>
        <h1>SERTIFIKAT</h1>
        <div class="sub">PENGETAHUAN &amp; KOMPETENSI</div>
        <div class="given">Diberikan kepada</div>
        <div class="name"><?= e($row['name']) ?></div>
        <div class="dept"><?= e(trim(($row['position'] ?: '') . ($row['department'] ? ' · ' . $row['department'] : ''), ' ·')) ?></div>
        <div class="desc">Atas keberhasilannya menyelesaikan dan <b>LULUS</b> <b><?= e($row['title']) ?></b>
            yang diselenggarakan melalui <?= e(app_name()) ?> pada <?= e(tanggal_id(strtotime((string) $row['submitted_at']), false)) ?>.</div>
        <div class="score">
            <div><small>Score</small><strong><?= e(fmt_num($row['score'], 1)) ?></strong></div>
            <div><small>Passing Grade</small><strong><?= e(fmt_num($row['passing_grade'], 1)) ?></strong></div>
            <div><small>Jawaban Benar</small><strong><?= (int) $row['correct_answers'] ?>/<?= (int) $row['total_questions'] ?></strong></div>
        </div>
        <div class="foot">
            <div class="verify">Keaslian sertifikat dapat diverifikasi di:<br><span style="word-break:break-all"><?= e($verifyUrl) ?></span><br>Kode verifikasi: <code><?= e($code) ?></code></div>
            <div class="seal">LULUS<br><?= date('Y', strtotime((string) $row['submitted_at'])) ?></div>
            <div class="sign">
                <?= e(setting('institution_region') ?: '') ?><?= setting('institution_region') ? ', ' : '' ?><?= e(tanggal_id(strtotime((string) $row['submitted_at']), false)) ?><br>
                <?= e(setting('certificate_signer_title') ?: 'Kepala Dinas') ?>
                <div class="line"><?= e(setting('certificate_signer_name') ?: '(.................................)') ?></div>
            </div>
        </div>
    </div>
</div>
</body>
</html>
