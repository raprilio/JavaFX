<?php
/**
 * Laporan hasil ujian siap cetak / PDF. Admin only.
 * Tombol "Download PDF" membuat file PDF di browser (jsPDF + AutoTable),
 * tombol "Cetak" memakai dialog print browser (Save as PDF).
 */
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/admin_auth.php';
require_once dirname(__DIR__) . '/includes/admin_lib.php';

finalize_expired_attempts();
$f = admin_results_filters($_GET);
[$rows, $total] = admin_results_fetch($f);

$scores = array_map(fn ($r) => (float) $r['score'], $rows);
$passedN = count(array_filter($rows, fn ($r) => (int) $r['passed'] === 1));
$sum = [
    'n'    => $total,
    'avg'  => $scores ? round(array_sum($scores) / count($scores), 1) : null,
    'max'  => $scores ? max($scores) : null,
    'min'  => $scores ? min($scores) : null,
    'rate' => $total ? round($passedN / $total * 100, 1) : null,
];
$filterText = admin_filter_summary($f);
$admin = current_user();
?>
<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Laporan Hasil Ujian · <?= e(APP_NAME) ?></title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
    * { box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; color: #0f1a33; margin: 0; background: #eef1f8; font-size: 12px; }
    .toolbar { position: sticky; top: 0; background: #0b1b3f; padding: 12px 20px; display: flex; gap: 8px; align-items: center; color: #fff; z-index: 5; }
    .toolbar button { border: 0; border-radius: 8px; padding: 9px 16px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .btn-gold { background: #d4a72c; color: #071230; }
    .btn-light { background: #fff; color: #0b1b3f; }
    .page { background: #fff; max-width: 1100px; margin: 24px auto; padding: 36px 40px; box-shadow: 0 10px 40px rgba(11,27,63,.12); border-radius: 12px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0b1b3f; padding-bottom: 16px; margin-bottom: 18px; }
    .brand { display: flex; gap: 12px; align-items: center; }
    .brand h1 { margin: 0; font-size: 20px; font-weight: 800; color: #0b1b3f; }
    .brand p { margin: 2px 0 0; color: #6b7690; }
    .meta { text-align: right; color: #6b7690; line-height: 1.6; }
    .title { font-size: 16px; font-weight: 800; margin: 0 0 4px; }
    .filter { color: #6b7690; margin-bottom: 16px; }
    .cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 20px; }
    .card { border: 1px solid #e6e9f2; border-radius: 10px; padding: 10px 12px; border-top: 3px solid #d4a72c; }
    .card b { display: block; font-size: 18px; font-weight: 800; }
    .card span { color: #6b7690; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #13265a; color: #fff; text-align: left; padding: 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    td { padding: 7px 8px; border-bottom: 1px solid #e6e9f2; }
    tr:nth-child(even) td { background: #f8f9fc; }
    .r { text-align: right; }
    .pass { color: #16a36a; font-weight: 700; }
    .fail { color: #e04848; font-weight: 700; }
    .sign { display: flex; justify-content: flex-end; margin-top: 40px; }
    .sign div { text-align: center; width: 220px; }
    .sign .line { border-top: 1px solid #0f1a33; margin-top: 60px; padding-top: 4px; font-weight: 700; }
    .foot { margin-top: 24px; color: #94a0bb; font-size: 10px; text-align: center; }
    @media print {
        body { background: #fff; }
        .toolbar { display: none; }
        .page { box-shadow: none; margin: 0; max-width: none; padding: 0; border-radius: 0; }
        @page { size: A4 landscape; margin: 12mm; }
        tr { page-break-inside: avoid; }
    }
</style>
</head>
<body>
<div class="toolbar">
    <strong style="margin-right:auto">Laporan Hasil Ujian</strong>
    <button class="btn-gold" id="btnPdf">⬇ Download PDF</button>
    <button class="btn-light" onclick="window.print()">🖨 Cetak</button>
    <button class="btn-light" onclick="window.close()">Tutup</button>
</div>
<div class="page">
    <div class="head">
        <div class="brand">
            <img src="<?= e(url('assets/images/logo.svg')) ?>" width="46" height="46" alt="">
            <div><h1><?= e(APP_NAME) ?></h1><p><?= e(APP_TAGLINE) ?></p></div>
        </div>
        <div class="meta">Dicetak: <?= e(tanggal_id()) ?>, <?= date('H:i') ?><br>Oleh: <?= e($admin['name']) ?><br><strong style="color:#e04848">RAHASIA — Khusus Administrator</strong></div>
    </div>
    <p class="title">Laporan Hasil Ujian</p>
    <div class="filter">Filter: <?= e($filterText) ?></div>
    <div class="cards">
        <div class="card"><span>Submission</span><b><?= e(fmt_num($sum['n'])) ?></b></div>
        <div class="card"><span>Rata-rata</span><b><?= e(fmt_num($sum['avg'], 1)) ?></b></div>
        <div class="card"><span>Tertinggi</span><b><?= e(fmt_num($sum['max'], 1)) ?></b></div>
        <div class="card"><span>Terendah</span><b><?= e(fmt_num($sum['min'], 1)) ?></b></div>
        <div class="card"><span>Kelulusan</span><b><?= $sum['rate'] !== null ? e(fmt_num($sum['rate'], 1)) . '%' : '—' ?></b></div>
    </div>
    <table id="tbl">
        <thead><tr><th>#</th><th>Nama</th><th>Department</th><th>Ujian</th><th>Jenis</th><th class="r">Benar</th><th class="r">Salah</th><th class="r">Kosong</th><th class="r">Score</th><th>Status</th><th>Durasi</th><th>Submit</th></tr></thead>
        <tbody>
        <?php if (!$rows): ?>
            <tr><td colspan="12" style="text-align:center;padding:30px;color:#6b7690">Tidak ada data.</td></tr>
        <?php endif; ?>
        <?php foreach ($rows as $i => $r): ?>
            <tr>
                <td><?= $i + 1 ?></td>
                <td><strong><?= e($r['name']) ?></strong><br><span style="color:#6b7690">@<?= e($r['username']) ?></span></td>
                <td><?= e($r['department'] ?: '—') ?></td>
                <td><?= e($r['exam_title']) ?></td>
                <td><?= e(type_label($r['exam_type'])) ?></td>
                <td class="r"><?= (int) $r['correct_answers'] ?></td>
                <td class="r"><?= (int) $r['wrong_answers'] ?></td>
                <td class="r"><?= (int) $r['unanswered'] ?></td>
                <td class="r"><strong><?= e(fmt_num($r['score'], 1)) ?></strong></td>
                <td class="<?= (int) $r['passed'] ? 'pass' : 'fail' ?>"><?= (int) $r['pending_review'] > 0 ? 'Perlu penilaian' : ((int) $r['passed'] ? 'Lulus' : 'Tidak Lulus') ?></td>
                <td><?= e(fmt_duration($r['duration'] !== null ? (int) $r['duration'] : null)) ?></td>
                <td><?= e(fmt_date($r['submitted_at'])) ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    <div class="sign"><div>Mengetahui,<div class="line"><?= e($admin['name']) ?></div>Administrator</div></div>
    <div class="foot">Dokumen ini dihasilkan otomatis oleh <?= e(APP_NAME) ?> · <?= e(date('d-m-Y H:i:s')) ?></div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
<script>
document.getElementById('btnPdf').addEventListener('click', function () {
    if (!window.jspdf) { window.print(); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(11, 27, 63); doc.rect(0, 0, W, 24, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(<?= js_json(APP_NAME . ' — Laporan Hasil Ujian') ?>, 12, 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(<?= js_json('Filter: ' . $filterText) ?>, 12, 18, { maxWidth: W - 90 });
    doc.text(<?= js_json('Dicetak ' . date('d-m-Y H:i') . ' · RAHASIA') ?>, W - 12, 11, { align: 'right' });
    const s = <?= js_json($sum) ?>;
    doc.setTextColor(15, 26, 51); doc.setFontSize(10);
    doc.text(`Submission: ${s.n}    Rata-rata: ${s.avg ?? '-'}    Tertinggi: ${s.max ?? '-'}    Terendah: ${s.min ?? '-'}    Kelulusan: ${s.rate !== null ? s.rate + '%' : '-'}`, 12, 32);
    doc.autoTable({
        html: '#tbl', startY: 37, theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2, lineColor: [230, 233, 242] },
        headStyles: { fillColor: [19, 38, 90], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 249, 252] },
        didDrawPage: (d) => {
            doc.setFontSize(8); doc.setTextColor(148, 160, 187);
            doc.text('Halaman ' + doc.internal.getNumberOfPages(), W - 12, doc.internal.pageSize.getHeight() - 6, { align: 'right' });
        },
    });
    doc.save('laporan-hasil-ujian-<?= date('Ymd-His') ?>.pdf');
});
</script>
</body>
</html>
