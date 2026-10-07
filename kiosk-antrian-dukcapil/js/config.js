/*
 * KONFIGURASI KIOSK ANTRIAN DUKCAPIL
 * -----------------------------------------------------------------
 * File ini satu-satunya yang perlu diubah untuk menyesuaikan kiosk
 * dengan kantor Anda: nama instansi, jam layanan, kuota, loket, dan
 * persyaratan. Persyaratan di bawah adalah CONTOH UMUM — sesuaikan
 * dengan SOP / Perbup / Perwali di daerah Anda sebelum dipakai.
 */
window.KIOSK_CONFIG = {
  instansi: {
    singkatan: 'DISDUKCAPIL',
    nama: 'Dinas Kependudukan dan Pencatatan Sipil',
    wilayah: 'Kabupaten Contoh',
    alamat: 'Jl. Merdeka No. 1, Kabupaten Contoh',
    // Tautan opsional yang dicetak sebagai QR di tiket (mis. halaman cek antrian).
    // Kosongkan ('') bila belum ada; QR tiket lalu berisi kode verifikasi saja.
    statusUrl: '',
  },

  kioskId: 'KIOSK-01',

  // 'auto'  : pakai server (server.js) bila tersedia, selain itu mode lokal.
  // 'local' : nomor disimpan di browser kiosk ini saja (hanya untuk 1 kiosk!).
  // 'server': wajib server; kiosk menolak mencetak bila server tidak terjangkau.
  mode: 'auto',
  apiBase: '/api',

  timezone: 'Asia/Jakarta',
  zonaLabel: 'WIB',

  // PIN panel admin (ketuk logo 5x dalam 3 detik). WAJIB diganti.
  adminPin: '246810',

  // Lebar kertas printer thermal: 58 atau 80 (mm).
  paperWidth: 80,

  timeouts: {
    idleSeconds: 45,        // diam selama ini → muncul peringatan
    idleWarnSeconds: 10,    // hitung mundur peringatan sebelum kembali ke beranda
    ticketSeconds: 15,      // tampilan tiket sebelum kembali ke beranda
  },

  maxReprint: 1,            // cetak ulang per tiket (kertas macet, dll.)
  autoSpeakTicket: true,    // bacakan nomor tiket dengan suara (tunanetra)

  // Jam pengambilan tiket. 0 = Minggu ... 6 = Sabtu. null = tutup.
  // 'tutupTiket' = batas akhir mengambil tiket (biasanya < jam tutup layanan).
  jadwal: {
    0: null,
    1: { buka: '08:00', tutupTiket: '14:30', tutup: '15:00' },
    2: { buka: '08:00', tutupTiket: '14:30', tutup: '15:00' },
    3: { buka: '08:00', tutupTiket: '14:30', tutup: '15:00' },
    4: { buka: '08:00', tutupTiket: '14:30', tutup: '15:00' },
    5: { buka: '08:00', tutupTiket: '11:00', tutup: '11:30', catatan: 'Istirahat Jumat 11.30–13.00' },
    6: null,
  },
  // Tanggal libur nasional / cuti bersama (YYYY-MM-DD).
  libur: ['2026-12-25', '2026-12-26', '2027-01-01'],

  pengumuman: [
    'Seluruh layanan administrasi kependudukan GRATIS — tidak dipungut biaya apa pun.',
    'Waspada calo! Petugas resmi selalu memakai seragam dan tanda pengenal.',
    'Aktivasi Identitas Kependudukan Digital (IKD) kini bisa dilayani di Loket 5.',
    'Bawa dokumen ASLI. Fotokopi tidak diperlukan untuk dokumen yang sudah terdata online.',
  ],

  kategoriPrioritas: [
    { id: 'lansia', label: 'Lansia (60+ tahun)', icon: 'elder' },
    { id: 'disabilitas', label: 'Penyandang disabilitas', icon: 'accessible' },
    { id: 'hamil', label: 'Ibu hamil', icon: 'pregnant' },
    { id: 'balita', label: 'Membawa balita', icon: 'stroller' },
  ],

  ketentuanUmum: [
    { icon: 'gratis', judul: 'Layanan GRATIS', isi: 'Tidak ada biaya untuk dokumen kependudukan (UU No. 24 Tahun 2013, Pasal 79A).' },
    { icon: 'shield', judul: 'Waspada calo', isi: 'Jangan serahkan dokumen kepada orang yang bukan petugas.' },
    { icon: 'doc', judul: 'Bawa dokumen asli', isi: 'Petugas akan memeriksa keaslian dokumen yang Anda bawa.' },
    { icon: 'clock', judul: 'Tiket berlaku hari ini', isi: 'Bila nomor terlewat 3 kali panggilan, silakan ambil tiket baru.' },
  ],

  /*
   * Daftar layanan. Syarat berupa teks = wajib dicentang; { t, opsional: true }
   * = ditampilkan tetapi tidak wajib (mis. hanya berlaku pada kondisi tertentu).
   * Huruf I dan O sengaja tidak dipakai sebagai prefix
   * karena mudah tertukar dengan angka 1 dan 0 saat dipanggil.
   *  - kuota        : jumlah tiket maksimal per hari
   *  - menit        : rata-rata lama layanan per orang
   *  - loketAktif   : jumlah loket yang melayani (untuk estimasi waktu)
   *  - mintaNik     : tampilkan isian NIK (opsional, untuk cegah antrian ganda)
   */
  layanan: [
    {
      id: 'ktp-baru', prefix: 'A', nama: 'KTP-el Baru / Rekam', desc: 'Perekaman & pencetakan KTP elektronik pertama',
      icon: 'idcard', warna: '#1e40af', loket: 'Loket 1–2', loketAktif: 2, menit: 8, kuota: 120, mintaNik: true,
      syarat: [
        'Berusia 17 tahun / sudah atau pernah kawin',
        'Kartu Keluarga (KK) asli',
        'Hadir langsung untuk foto, sidik jari & iris mata',
      ],
      catatan: 'Gunakan pakaian berkerah, tidak berwarna merah (latar foto).',
    },
    {
      id: 'ktp-ganti', prefix: 'B', nama: 'KTP-el Hilang / Rusak', desc: 'Cetak ulang karena hilang, rusak, atau perubahan',
      icon: 'idcardx', warna: '#4338ca', loket: 'Loket 1–2', loketAktif: 2, menit: 6, kuota: 100, mintaNik: true,
      syarat: [
        'Kartu Keluarga (KK) asli',
        { t: 'Surat keterangan hilang dari Kepolisian (bila hilang)', opsional: true },
        { t: 'KTP-el yang rusak (bila rusak)', opsional: true },
      ],
    },
    {
      id: 'kk', prefix: 'C', nama: 'Kartu Keluarga', desc: 'KK baru, tambah/kurang anggota, pisah KK',
      icon: 'family', warna: '#0369a1', loket: 'Loket 3', loketAktif: 1, menit: 10, kuota: 80, mintaNik: true,
      syarat: [
        'Kartu Keluarga lama (asli)',
        { t: 'Buku nikah / akta perkawinan (untuk KK baru)', opsional: true },
        { t: 'Surat keterangan pindah (bila pindah alamat)', opsional: true },
        'Formulir F-1.01 yang sudah diisi (tersedia di meja informasi)',
      ],
    },
    {
      id: 'akta-lahir', prefix: 'D', nama: 'Akta Kelahiran', desc: 'Pencatatan kelahiran anak & penerbitan akta',
      icon: 'baby', warna: '#7c3aed', loket: 'Loket 4', loketAktif: 1, menit: 10, kuota: 70, mintaNik: true,
      syarat: [
        'Surat keterangan lahir dari RS / bidan / desa',
        'Kartu Keluarga orang tua (asli)',
        'Buku nikah / akta perkawinan orang tua',
        { t: 'KTP-el 2 orang saksi (bila diperlukan)', opsional: true },
      ],
      catatan: 'Bila buku nikah tidak ada, dapat diganti SPTJM kebenaran pasangan suami-istri.',
    },
    {
      id: 'akta-mati', prefix: 'E', nama: 'Akta Kematian', desc: 'Pencatatan kematian & pemutakhiran KK',
      icon: 'ribbon', warna: '#475569', loket: 'Loket 4', loketAktif: 1, menit: 8, kuota: 40, mintaNik: true,
      syarat: [
        'Surat keterangan kematian dari RS / desa / kelurahan',
        'KK & KTP-el almarhum/almarhumah',
        'KTP-el pelapor',
      ],
    },
    {
      id: 'kia', prefix: 'F', nama: 'Kartu Identitas Anak', desc: 'KIA untuk anak usia 0–17 tahun',
      icon: 'child', warna: '#db2777', loket: 'Loket 3', loketAktif: 1, menit: 5, kuota: 80, mintaNik: true,
      syarat: [
        'Akta kelahiran anak (asli)',
        'Kartu Keluarga orang tua (asli)',
        { t: 'Pas foto anak berwarna 2×3 (usia 5 tahun ke atas)', opsional: true },
      ],
    },
    {
      id: 'ikd', prefix: 'G', nama: 'Aktivasi IKD', desc: 'Identitas Kependudukan Digital di ponsel',
      icon: 'phone', warna: '#0f766e', loket: 'Loket 5', loketAktif: 1, menit: 5, kuota: 100, mintaNik: true,
      syarat: [
        'KTP-el asli',
        'Ponsel Android/iOS dengan aplikasi IKD terpasang',
        'Nomor HP & email aktif milik sendiri',
      ],
      catatan: 'Pastikan baterai ponsel cukup dan pulsa/kuota data tersedia.',
    },
    {
      id: 'pindah', prefix: 'H', nama: 'Pindah Datang', desc: 'Surat pindah keluar / pindah masuk daerah',
      icon: 'move', warna: '#b45309', loket: 'Loket 6', loketAktif: 1, menit: 10, kuota: 50, mintaNik: true,
      syarat: [
        'Kartu Keluarga (asli)',
        'KTP-el seluruh anggota yang pindah',
        { t: 'SKPWNI dari daerah asal (untuk pindah datang)', opsional: true },
      ],
    },
    {
      id: 'kawin', prefix: 'J', nama: 'Perkawinan & Perceraian', desc: 'Akta perkawinan (non-muslim) & perceraian',
      icon: 'rings', warna: '#c2410c', loket: 'Loket 6', loketAktif: 1, menit: 15, kuota: 30, mintaNik: true,
      syarat: [
        'Surat keterangan perkawinan dari pemuka agama / putusan pengadilan',
        'KK & KTP-el kedua pihak',
        { t: 'Pas foto berdampingan 4×6 (khusus perkawinan)', opsional: true },
        'KTP-el 2 orang saksi',
      ],
    },
    {
      id: 'ubah-data', prefix: 'K', nama: 'Perubahan Data', desc: 'Pembetulan nama, pendidikan, pekerjaan, agama',
      icon: 'edit', warna: '#059669', loket: 'Loket 7', loketAktif: 1, menit: 8, kuota: 60, mintaNik: true,
      syarat: [
        'Kartu Keluarga (asli)',
        'Dokumen pendukung perubahan (ijazah, akta, SK, dll.)',
      ],
    },
    {
      id: 'legalisir', prefix: 'L', nama: 'Legalisir Dokumen', desc: 'Pengesahan fotokopi akta & dokumen',
      icon: 'stamp', warna: '#0d9488', loket: 'Loket 7', loketAktif: 1, menit: 3, kuota: 150, mintaNik: false,
      syarat: [
        'Dokumen asli yang akan dilegalisir',
        'Fotokopi dokumen yang akan dilegalisir',
      ],
    },
    {
      id: 'konsultasi', prefix: 'M', nama: 'Konsultasi & Pengaduan', desc: 'Tanya syarat, kendala data, atau pengaduan',
      icon: 'chat', warna: '#dc2626', loket: 'Meja Informasi', loketAktif: 1, menit: 7, kuota: 80, mintaNik: false,
      syarat: [
        { t: 'Dokumen terkait masalah Anda (bila ada)', opsional: true },
      ],
    },
  ],
};
