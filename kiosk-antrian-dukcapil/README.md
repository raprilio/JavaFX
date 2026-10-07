# Kiosk Antrian Dukcapil

Aplikasi web kiosk layar sentuh untuk mengambil nomor antrian layanan administrasi kependudukan.
Tanpa framework dan tanpa `npm install`: cukup browser (dan Node.js 18+ bila memakai server).

```
Beranda → Pilih layanan → Cek persyaratan → Konfirmasi → Tiket tercetak otomatis → kembali ke Beranda
```

## Fitur

| Kebutuhan | Yang dikerjakan aplikasi |
|---|---|
| Tampilan modern & mudah dipahami | Kartu layanan besar ber-ikon, stepper 4 langkah, tombol minimal 56 px untuk jari, layout landscape **dan** potret |
| Syarat sebelum cetak | Checklist dokumen wajib (tombol lanjut terkunci sampai dicentang), syarat kondisional ditandai "Bila berlaku", ketentuan penting (GRATIS, anti-calo, dokumen asli, masa berlaku tiket) |
| Cetak otomatis + tampil + timeout | `window.print()` otomatis, panjang kertas thermal diukur sesuai isi tiket, animasi tiket keluar dari printer, hitung mundur 15 detik lalu kembali ke beranda, cetak ulang maksimal 1× (bertanda "CETAK ULANG") |

### Hal yang biasanya terlewat (sudah ditangani)

- **Jam layanan & hari libur** — tombol ambil tiket otomatis nonaktif di luar jam, menampilkan kapan buka lagi; batas ambil tiket terpisah dari jam tutup layanan; jadwal Jumat berbeda.
- **Kuota harian per layanan** — kartu layanan menampilkan sisa kuota, otomatis nonaktif saat habis.
- **Peringatan antrian melewati jam tutup** — warga diberi tahu *sebelum* mencetak bila perkiraan gilirannya melewati jam layanan.
- **Estimasi waktu panggil** — jumlah orang di depan × rata-rata menit layanan ÷ jumlah loket aktif.
- **Antrian prioritas** — lansia, disabilitas, ibu hamil, membawa balita; nomor terpisah (mis. `PD-001`).
- **Cegah antrian ganda** — NIK opsional; satu NIK hanya satu tiket per layanan per hari.
- **Privasi NIK (UU PDP)** — NIK tidak pernah disimpan utuh: hanya hash SHA-256 bergaram tanggal, dicetak tersamar `3201 •••• •••• 0001`, dan dihapus dari memori setelah tiket terbit.
- **Validasi format NIK** — kode provinsi, tanggal & bulan lahir (termasuk +40 untuk perempuan).
- **Belum lengkap? Bawa pulang daftarnya** — QR berisi daftar syarat (teks, bisa dibaca tanpa internet), atau langsung arahkan ke antrian Konsultasi.
- **Anti-pemalsuan tiket** — kode verifikasi 4 karakter dari kunci acak harian; QR di tiket.
- **Huruf prefix tanpa I dan O** — agar tidak tertukar dengan angka 1 dan 0 saat dipanggil.
- **Tombol "Panggil petugas"** — tercatat di panel admin / log server (dibatasi 1× per menit).
- **Aksesibilitas** — teks besar, kontras tinggi, *bacakan layar* (suara Bahasa Indonesia), nomor tiket dibacakan otomatis untuk tunanetra. Semua pengaturan **di-reset** untuk pengunjung berikutnya.
- **Timeout idle 45 detik** — peringatan "Masih di sana?" 10 detik, lalu kembali ke beranda (data pengunjung sebelumnya hilang).
- **Anti dobel-ketuk** — tombol cetak terkunci selama memproses, tidak ada dua tiket dari satu ketukan.
- **Penguncian kiosk** — klik kanan, seleksi teks, seret, dan pinch-zoom dinonaktifkan.
- **Pemeliharaan otomatis** — muat ulang tiap ganti hari (nomor kembali ke 001), muat ulang otomatis bila terjadi error.
- **Zona waktu tetap WIB** — jam & tanggal tiket benar walau jam OS kiosk salah zona.
- **Mode uji** — `?test=1` memakai antrian terpisah, mengabaikan jadwal, dan mencetak "TIKET UJI — TIDAK BERLAKU".
- **Panel petugas tersembunyi** — ketuk logo 5× dalam 3 detik → PIN (terkunci 1 menit setelah salah 3×): buka/tutup layanan, abaikan jadwal, lebar kertas 58/80 mm, cetak uji, unduh rekap CSV, reset antrian.

## Menjalankan

### A. Satu kiosk (mode lokal)

Buka `index.html` langsung di Chrome. Nomor antrian disimpan di browser kiosk itu.

> ⚠️ Mode lokal **hanya untuk satu kiosk**. Dua kiosk mode lokal akan mencetak nomor yang sama.

### B. Lebih dari satu kiosk (mode server) — disarankan

Jalankan di satu PC/server di jaringan kantor:

```bash
cd kiosk-antrian-dukcapil
ADMIN_PIN=ganti-pin-ini node server.js        # http://<ip-server>:8080
```

Semua kiosk membuka `http://<ip-server>:8080`. Mode terdeteksi otomatis (`mode: 'auto'` di config).
Data harian tersimpan di `data/antrian-YYYY-MM-DD.json` (ditulis atomik, aman saat listrik padam).
Bila server tidak terjangkau, kiosk **menolak mencetak** dan menampilkan "Sistem antrian terputus" — kiosk tidak diam-diam beralih ke nomor lokal yang bisa bentrok.

### Mengaktifkan cetak tanpa dialog (WAJIB untuk kiosk)

Browser tidak mengizinkan halaman web mencetak diam-diam. Jalankan Chrome dengan `--kiosk-printing`
dan jadikan printer thermal sebagai **printer default** OS:

```bat
:: Windows (taruh di Startup)
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --kiosk-printing ^
  --noerrdialogs --disable-session-crashed-bubble --disable-pinch ^
  --overscroll-history-navigation=0 --autoplay-policy=no-user-gesture-required ^
  "http://192.168.1.10:8080"
```

```bash
# Linux
chromium --kiosk --kiosk-printing --noerrdialogs --disable-pinch \
  --overscroll-history-navigation=0 --autoplay-policy=no-user-gesture-required \
  "http://192.168.1.10:8080"
```

Tanpa flag tersebut aplikasi tetap berjalan, tetapi dialog cetak akan muncul.

**Printer thermal:** atur lebar kertas di panel admin (58/80 mm). Di driver printer, set margin 0 dan
"cut at end of document" bila tersedia. Panjang halaman dihitung otomatis dari tinggi isi tiket.

## Konfigurasi

Semua ada di [`js/config.js`](js/config.js): nama instansi, jadwal & libur, kuota, loket, durasi rata-rata,
persyaratan, pengumuman berjalan, dan PIN admin.

> Persyaratan di config adalah **contoh umum**. Sesuaikan dengan SOP/Perbup/Perwali daerah Anda.

## Integrasi dengan aplikasi loket

Agar angka "menunggu" dan estimasi akurat, aplikasi pemanggil di loket memberi tahu server tiap memanggil nomor:

```bash
curl -X POST http://<ip-server>:8080/api/call \
  -H 'Content-Type: application/json' \
  -d '{"pin":"<ADMIN_PIN>","serviceId":"kk","priority":false}'
# → {"ok":true,"no":"C-001"}
```

Tanpa integrasi ini, "menunggu" = jumlah tiket terbit, sehingga estimasi waktu makin terlalu panjang menjelang siang.

## Batasan yang perlu diketahui

- **Status printer (kertas habis/macet) tidak bisa dideteksi dari browser.** Untuk itu perlu agen cetak lokal (mis. QZ Tray / ESC/POS langsung). Tombol "Cetak ulang" & "Panggil petugas" adalah mitigasinya.
- **PIN admin di `config.js` terbaca siapa pun yang membuka source halaman.** Di mode server, set `ADMIN_PIN` sebagai environment variable — server memakai PIN itu untuk reset/pengaturan, bukan PIN di config.
- **Validasi NIK hanya format**, bukan pengecekan ke database kependudukan.
- **Suara "bacakan layar"** bergantung pada suara Bahasa Indonesia yang terpasang di OS kiosk.

## Struktur

```
index.html            kerangka halaman
css/kiosk.css         tampilan + gaya cetak thermal
js/config.js          ← ubah di sini
js/queue-core.js      aturan antrian (dipakai browser & server)
js/app.js             alur layar, cetak, timeout, aksesibilitas, panel admin
js/vendor/qrcode.js   generator QR (MIT, Kazuhiko Arase)
server.js             server opsional tanpa dependensi
```
