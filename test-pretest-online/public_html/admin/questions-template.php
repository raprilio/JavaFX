<?php
/** Template CSV import soal. Admin only. */
declare(strict_types=1);
require_once dirname(__DIR__) . '/includes/admin_auth.php';
require_once dirname(__DIR__) . '/includes/xlsx.php';

csv_download('template-import-soal.csv',
    ['question_type', 'category', 'difficulty', 'points', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'correct', 'explanation'],
    [
        ['mc', 'Regulasi Adminduk', 'mudah', '2', 'NIK terdiri dari berapa digit?', '12', '14', '16', '18', '', 'C', 'NIK terdiri dari 16 digit.'],
        ['ma', 'Dokumen Kependudukan', 'sedang', '3', 'Manakah yang termasuk dokumen kependudukan? (pilih semua)', 'Kartu Keluarga', 'KTP-el', 'SIM', 'Akta Kelahiran', '', 'A,B,D', 'SIM diterbitkan Kepolisian, bukan dokumen kependudukan.'],
        ['tf', 'Regulasi Adminduk', 'mudah', '1', 'KTP-el berlaku seumur hidup.', '', '', '', '', '', 'Benar', ''],
        ['short', 'Digitalisasi', 'sedang', '2', 'Kepanjangan dari SIAK adalah...', '', '', '', '', '', 'Sistem Informasi Administrasi Kependudukan', ''],
        ['essay', 'Pelayanan Publik', 'sulit', '5', 'Jelaskan langkah pelayanan penerbitan akta kelahiran.', '', '', '', '', '', '', 'Dinilai manual oleh admin.'],
    ]
);
