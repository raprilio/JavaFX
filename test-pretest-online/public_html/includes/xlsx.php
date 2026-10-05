<?php
/**
 * Penulis file .xlsx minimalis (tanpa Composer) memakai ZipArchive.
 * Fallback ke CSV jika ekstensi zip tidak tersedia di hosting.
 */
declare(strict_types=1);

function xlsx_col(int $i): string
{
    $s = '';
    for ($i++; $i > 0; $i = intdiv($i - 1, 26)) {
        $s = chr(65 + ($i - 1) % 26) . $s;
    }
    return $s;
}

function xlsx_xml(string $s): string
{
    $s = preg_replace('/[^\x{9}\x{A}\x{D}\x{20}-\x{D7FF}\x{E000}-\x{FFFD}]/u', '', $s) ?? '';
    return htmlspecialchars($s, ENT_QUOTES | ENT_XML1, 'UTF-8');
}

/**
 * Kirim spreadsheet ke browser lalu exit.
 * @param string[] $headers
 * @param array[]  $rows     nilai numerik ditulis sebagai angka
 */
function xlsx_download(string $filename, string $sheetName, array $headers, array $rows, string $title = ''): void
{
    if (!class_exists('ZipArchive')) {
        csv_download(preg_replace('/\.xlsx$/', '.csv', $filename), $headers, $rows);
    }
    $sheetRows = [];
    $r = 1;
    if ($title !== '') {
        $sheetRows[] = '<row r="1"><c r="A1" t="inlineStr" s="2"><is><t>' . xlsx_xml($title) . '</t></is></c></row>';
        $r = 3;
    }
    $cells = '';
    foreach ($headers as $i => $h) {
        $cells .= '<c r="' . xlsx_col($i) . $r . '" t="inlineStr" s="1"><is><t>' . xlsx_xml((string) $h) . '</t></is></c>';
    }
    $sheetRows[] = '<row r="' . $r . '">' . $cells . '</row>';
    $headerRow = $r;
    foreach ($rows as $row) {
        $r++;
        $cells = '';
        foreach (array_values($row) as $i => $v) {
            $ref = xlsx_col($i) . $r;
            if (is_int($v) || is_float($v)) {
                $cells .= '<c r="' . $ref . '"><v>' . $v . '</v></c>';
            } elseif ($v !== null && $v !== '') {
                $cells .= '<c r="' . $ref . '" t="inlineStr"><is><t xml:space="preserve">' . xlsx_xml((string) $v) . '</t></is></c>';
            }
        }
        $sheetRows[] = '<row r="' . $r . '">' . $cells . '</row>';
    }
    $cols = '';
    foreach ($headers as $i => $h) {
        $w = max(10, min(45, mb_strlen((string) $h) + 6));
        foreach (array_slice($rows, 0, 200) as $row) {
            $vals = array_values($row);
            $w = max($w, min(45, mb_strlen((string) ($vals[$i] ?? '')) + 2));
        }
        $cols .= '<col min="' . ($i + 1) . '" max="' . ($i + 1) . '" width="' . $w . '" customWidth="1"/>';
    }
    $lastCol = xlsx_col(max(0, count($headers) - 1));
    $sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        . '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' . $headerRow . '" topLeftCell="A' . ($headerRow + 1) . '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        . '<cols>' . $cols . '</cols><sheetData>' . implode('', $sheetRows) . '</sheetData>'
        . '<autoFilter ref="A' . $headerRow . ':' . $lastCol . max($headerRow, $r) . '"/></worksheet>';

    $sheetName = xlsx_xml(mb_substr(preg_replace('/[\\\\\/\?\*\[\]:]/', '', $sheetName) ?: 'Sheet1', 0, 31));
    $files = [
        '[Content_Types].xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        '_rels/.rels' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' . $sheetName . '" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' . $sheetName . '\'!$A$' . $headerRow . ':$' . $lastCol . '$' . max($headerRow, $r) . '</definedName></definedNames></workbook>',
        'xl/_rels/workbook.xml.rels' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        'xl/styles.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF0B1B3F"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF13265A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>',
        'xl/worksheets/sheet1.xml' => $sheet,
    ];

    $tmp = tempnam(sys_get_temp_dir(), 'xlsx');
    $zip = new ZipArchive();
    $zip->open($tmp, ZipArchive::OVERWRITE);
    foreach ($files as $name => $content) {
        $zip->addFromString($name, $content);
    }
    $zip->close();

    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . basename($filename) . '"');
    header('Content-Length: ' . filesize($tmp));
    header('Cache-Control: no-store');
    readfile($tmp);
    @unlink($tmp);
    exit;
}

function csv_download(string $filename, array $headers, array $rows): void
{
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . basename($filename) . '"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, $headers);
    foreach ($rows as $row) {
        // Cegah CSV/formula injection
        fputcsv($out, array_map(fn ($v) => is_string($v) && preg_match('/^[=+\-@]/', $v) ? "'" . $v : $v, array_values($row)));
    }
    fclose($out);
    exit;
}
