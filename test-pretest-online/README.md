# SiTes Dukcapil — Test & Pre-Test Online

Aplikasi uji pengetahuan Administrasi Kependudukan & Pencatatan Sipil untuk aparatur **Dinas Dukcapil** (Pre-Test & Test resmi), berbasis **PHP 8 + MySQL/MariaDB + Bootstrap 5**, siap dijalankan di **shared hosting** (cPanel / `public_html`) tanpa Node.js, Composer, Redis, cron, atau WebSocket.

## Fitur utama

| Area | Fitur |
|---|---|
| Peserta | Dashboard, daftar ujian, instruksi, pengerjaan soal (auto-save AJAX, timer server-side, navigasi & tandai soal), riwayat, pembahasan Pre-Test, ganti password |
| Pre-Test | Score, benar/salah/kosong, passing grade & status LULUS langsung tampil setelah submit |
| Test resmi | Setelah submit hanya tampil **"TEST BERHASIL DIKIRIM"**, tanpa score/benar/salah/persentase/ranking (ditegakkan di backend) |
| Admin | Dashboard statistik + 6 grafik Chart.js, Test Results (search, filter ujian/user/department/tanggal/score/hasil, sort), detail jawaban per soal + ranking, penilaian essay, hitung ulang, export **Excel (.xlsx)** & **PDF** |
| Question Bank | Multiple Choice, Multiple Answer, True/False, Short Answer, Essay · kategori · level · point · pembahasan · gambar |
| Exam | Pool soal, jumlah soal per peserta, Random Question / Random Answer, durasi, passing grade, jadwal, maks. percobaan, assignment per user / department |
| User Management | CRUD, reset password, aktif/nonaktif, import CSV, export Excel, assign exam |
| Keamanan | Password bcrypt, PDO prepared statements, CSRF token, session hardening, rate-limit login, RBAC middleware, proteksi upload, `.htaccess` |
| **Aktivasi modul (v2)** | Saklar global **Pre-Test / Test** + saklar aktif per ujian — hanya admin; modul nonaktif disembunyikan & ditolak server |
| **Branding (v2)** | Upload **logo**, nama aplikasi, nama instansi & wilayah, warna tema, teks login & footer — menu *Pengaturan* |
| **Fitur modern (v2)** | Dark mode, tampilan mobile (bottom nav, tabel → kartu, bar ujian mobile), PWA (bisa di-install), deteksi pindah tab, pengumuman peserta, sertifikat Pre-Test + verifikasi publik (QR-ready URL), import soal CSV, duplikat ujian, log aktivitas (audit trail) |

## Instalasi di shared hosting (cPanel)

1. **Buat database** — cPanel → *MySQL® Databases*: buat database + user, lalu beri user tersebut *ALL PRIVILEGES*.
2. **Import tabel** — cPanel → *phpMyAdmin* → pilih database → tab *Import*:
   1. `database/schema.sql` (wajib — membuat tabel + akun admin)
   2. `database/sample_data.sql` (opsional — 3 peserta demo, 15 soal, 1 Pre-Test, 1 Test)
3. **Upload aplikasi** — upload **isi** folder `public_html/` ke `public_html/` hosting (atau ke subfolder, mis. `public_html/ujian/`). Folder `database/` dan file ini **tidak perlu** diupload.
4. **Konfigurasi** — edit `config/database.php`: `DB_NAME`, `DB_USER`, `DB_PASS` (dan `DB_HOST` jika bukan `localhost`).
5. **Login** — buka domain Anda → login `admin` / `Admin@123` → **segera ganti password** (menu akun → Ganti Password).
6. **Pengaturan** — Admin → *Pengaturan*: upload logo Dinas, isi nama instansi & wilayah, nama penandatangan sertifikat.
7. (Disarankan) Aktifkan HTTPS lalu buka komentar aturan *force HTTPS* di `.htaccess`.

**Kebutuhan:** PHP ≥ 8.0 dengan ekstensi `pdo_mysql`, `mbstring`, `fileinfo` (standar di cPanel). Ekstensi `zip` dipakai untuk file .xlsx — jika tidak ada, export otomatis menjadi CSV. MySQL ≥ 5.7 atau MariaDB ≥ 10.3.

Akun demo (jika `sample_data.sql` diimport): `raka`, `andi`, `sinta`, `dewi` — password `User@123`.
Data contoh berisi **31 soal pengetahuan Dukcapil** (Regulasi Adminduk, Pencatatan Sipil, Pendaftaran Penduduk, Digitalisasi & Data, Pelayanan Publik & Etika), 1 Pre-Test, dan 1 Test resmi. Periksa dan sesuaikan soal dengan regulasi terbaru sebelum dipakai resmi.

### Upgrade dari versi sebelumnya

Tidak perlu import ulang. Saat halaman pertama dibuka, aplikasi otomatis menambahkan tabel `settings`, `activity_logs`, dan kolom `exam_attempts.tab_switches` (migrasi idempoten, data lama tetap utuh). Cukup timpa file aplikasi — **kecuali** `config/database.php` milik Anda.

### Import soal dari Excel

Admin → *Question Bank* → **Import CSV**. Unduh template, isi di Excel, simpan sebagai CSV. Kolom `correct`: `C` (mc), `A,B,D` (ma), `Benar`/`Salah` (tf), `jawaban1|jawaban2` (short), kosong (essay).

## Alur ujian

```
PRE-TEST : Submit → hitung score → simpan MySQL → tampilkan score ke peserta
TEST     : Submit → hitung score → simpan MySQL → sembunyikan dari peserta → hanya admin yang melihat
```

## Bagaimana score Test dilindungi (backend, bukan sekadar HTML)

1. **Satu sumber kebijakan** — `exam_user_can_view_score()` di `includes/exam_engine.php` hanya bernilai `true` jika `type = 'pretest'` **dan** `show_result = 1`. Untuk `type = 'test'` selalu `false`, bahkan jika kolom `show_result` diubah manual di database.
2. **Saat menyimpan exam** — `exam_enforce_policy()` memaksa `show_result = 0` dan `show_correct_answer = 0` untuk Test.
3. **API peserta** (`api/user/*`):
   - `submit.php` hanya mengembalikan `status`, `message`, `redirect` — tidak pernah angka.
   - `result.php?id=…` untuk Test hanya mengembalikan `{"status":"submitted","message":"Test berhasil dikirim."}`.
   - `history.php` — score Test di-`NULL`-kan langsung di query SQL (`user_history()`), lalu dibuang.
   - Semua endpoint memverifikasi `attempt.user_id = user yang login` (404 untuk attempt milik orang lain).
4. **Halaman peserta** — `test-submitted.php` tidak meng-`SELECT` kolom score sama sekali; `pretest-result.php` dan `user/review.php` me-redirect jika kebijakan tidak mengizinkan.
5. **Payload soal** ke peserta tidak pernah berisi `is_correct` atau pembahasan.
6. **Admin** — seluruh `admin/*` dan `api/admin/*` melewati `includes/admin_auth.php` (`role = admin`, 403 JSON untuk API). `includes/admin_lib.php` (query score) juga menolak dieksekusi jika bukan admin.

## Timer & auto-submit (server-side)

- Saat ujian dimulai, server menyimpan `started_at` dan `deadline_at` (= mulai + durasi, dibatasi `end_date` ujian).
- Setiap auto-save divalidasi terhadap `deadline_at` (toleransi jaringan `EXAM_GRACE_SECONDS`). Lewat batas → attempt difinalisasi otomatis (`auto_submitted`) dan jawaban berikutnya ditolak.
- Timer JavaScript hanya tampilan; disinkronkan ke server tiap 60 detik dan saat tab kembali aktif.
- Pengganti cron: attempt yang kedaluwarsa difinalisasi saat peserta membuka dashboard/ujian dan saat admin membuka dashboard/hasil.

## Rekonstruksi hasil (random question)

`exam_questions` menyimpan **pool soal** sebuah ujian (diatur admin). Soal yang **benar-benar diberikan** ke tiap peserta — termasuk urutan soal, urutan opsi hasil acak, dan bobot point saat itu — disimpan per attempt di `attempt_questions`. Dengan begitu setiap hasil tetap bisa direkonstruksi persis walau pool atau soal diubah kemudian. Soal yang sudah dipakai tidak dapat dihapus, dan tipe/point/kunci jawabannya dikunci.

## Penilaian

- Multiple Choice / True-False: benar jika opsi terpilih adalah kunci.
- Multiple Answer: benar jika kombinasi yang dipilih **persis** sama dengan kunci.
- Short Answer: dicocokkan dengan daftar jawaban yang diterima (tidak peka huruf besar/kecil & spasi).
- Essay: menunggu penilaian admin (halaman Detail Result); score diperbarui otomatis setelah dinilai.
- `score` = total point diperoleh ÷ total point maksimum × 100. `percentage` = jumlah benar ÷ jumlah soal × 100.

## Struktur folder

```
public_html/
├── admin/            Dashboard, Test Results, detail, Exams, Question Bank, Users, Pengaturan, Log Aktivitas, export
├── user/             Riwayat, pembahasan, profil
├── api/
│   ├── user/         save-answer, submit, state (timer), event (pindah tab), result, history   (tanpa score Test)
│   └── admin/        stats, results, attempts, users, questions, exams, settings, activity      (role = admin)
├── assets/           css, js, images
├── config/           database.php
├── includes/         auth.php, admin_auth.php, functions.php, settings.php, exam_engine.php, admin_lib.php, xlsx.php, header.php, footer.php
├── uploads/          gambar soal & logo (eksekusi script diblokir)
├── index.php  login.php  logout.php  dashboard.php  exam.php  verify.php
├── pretest-result.php  test-submitted.php
└── manifest.php  sw.js   (PWA — hanya cache aset statis, halaman/API selalu dari server)
database/
├── schema.sql        struktur tabel + admin default
└── sample_data.sql   data contoh (opsional)
```

## Catatan keamanan v2

- **Saklar modul** ditegakkan di `user_exam_list()` dan `start_attempt()` — ujian dari modul nonaktif tidak dikirim ke peserta dan permintaan memulai ditolak, walau URL dibuka langsung. Peserta yang sedang mengerjakan tetap bisa menyelesaikan (tidak kehilangan jawaban).
- **Logo** hanya PNG/JPG/WEBP (≥ 64×64, ≤ 1 MB). SVG ditolak karena dapat memuat script.
- **Warna tema** divalidasi sebagai hex `#rrggbb` sebelum disisipkan ke CSS.
- **Sertifikat** hanya untuk Pre-Test yang lulus (Test resmi tidak pernah menerbitkan sertifikat ke peserta). Kode verifikasi = HMAC-SHA256 dengan secret acak per instalasi, sehingga tidak dapat dipalsukan.
- **Deteksi pindah tab** bersifat indikator, bukan bukti kecurangan — browser tidak bisa membedakan notifikasi sistem dari membuka tab lain.
