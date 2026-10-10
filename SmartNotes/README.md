# SmartNotes

Aplikasi catatan all-in-one untuk produktivitas pribadi maupun perusahaan: **Notes, Checklist, Task (List/Board/Calendar), Calendar, Meeting, Mind Map, Flowchart, Audio Recorder, Image Notes, Drive (penyimpanan berkas + viewer PDF/gambar), Catatan berbagi, Email Reminder, Global Search, Trash, Settings, dan Admin Panel** — dibangun khusus agar berjalan di **shared hosting** (PHP + MySQL), tanpa VPS, Docker, Redis, Node.js di production, WebSocket, maupun background worker.

> Panduan instalasi lengkap (cPanel / Hostinger hPanel / FTP): **[docs/INSTALL.md](docs/INSTALL.md)**

---

## Teknologi

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Backend | PHP 8.1+ murni (tanpa framework), REST-style JSON API | Tersedia di semua shared hosting, tidak perlu Composer di server |
| Database | MySQL 5.7+/8.x atau MariaDB 10.3+ (InnoDB, utf8mb4) | Semua data aplikasi tersimpan persisten di MySQL |
| Frontend | Vanilla JavaScript (ES modules), CSS custom (tanpa framework) | Ringan, tanpa build step wajib, code-splitting per halaman |
| Ikon | Lucide (subset ±216 ikon, di-bundle lokal) | Tidak bergantung CDN |
| Library pihak ketiga (lokal, lazy-load) | FullCalendar 6, Chart.js 4, jsPDF 3, DOMPurify 3, pdf.js 4, PHPMailer 7 | Hanya dimuat saat halaman yang membutuhkan dibuka |
| Font | Inter (self-hosted) | Tidak ada request ke Google Fonts |

Production **tidak** membutuhkan Node.js: hasil build (`public_html/assets/dist`) sudah ikut di repository. Node.js hanya dipakai saat development untuk minify ulang.

---

## Fitur

- **Autentikasi**: login, logout, remember me (token selector/validator yang dirotasi), forgot & reset password via e-mail, rate limiting login, session timeout, ganti password, avatar, profil.
- **Role & permission**: Admin dan User. Setiap user punya login sendiri dan hanya mengakses datanya sendiri (plus catatan yang dibagikan kepadanya). Admin dapat memberi permission khusus ke user (kelola user, branding, setting, e-mail, kategori, statistik, backup), tetapi **hapus user dan restore backup hanya untuk role Admin penuh**.
- **Kontrol akun oleh admin (v1.1)**: user yang dibuat/di-reset admin **wajib mengganti password** saat login pertama (API terkunci 403 sampai diganti); tombol **Sign out everywhere** per user; suspend atau reset password otomatis mengeluarkan semua sesi & cookie remember-me user tersebut (`users.session_version`).
- **Dashboard**: total notes, notes hari ini, task aktif/selesai, meeting & jadwal mendatang, audio, mind map, flowchart; widget *Today*, *Recent Notes*, *Upcoming*, *Task Progress*, *Quick Create*.
- **Notes**: rich text (bold, italic, underline, strikethrough, heading, ukuran font, perataan, bullet/number list, checklist, quote, code block, link, tabel, divider, highlight, warna teks), gambar inline, audio, lampiran file, kategori, tag `#tag`, warna & background catatan, pin, favorit, arsip, trash, auto-save + Ctrl+S, pencarian, sort, filter, bulk action, drag & drop gambar untuk membuat image note, shortcut markdown (`# `, `- `, `1. `, `[] `, `> `), export HTML/TXT/print-PDF.
- **Image note**: upload, drag & drop, paste dari clipboard, galeri, preview fullscreen, zoom (wheel/pinch/tombol), rotate (tersimpan di server), hapus; validasi ukuran & MIME; kompresi & resize otomatis (GD) yang juga membuang metadata EXIF.
- **Audio recorder**: MediaRecorder + Web Audio API (waveform live), start/pause/resume/stop, preview, rename, upload file audio, playback dengan waveform & seek (HTTP Range), lampirkan ke note.
- **Task**: judul, deskripsi, due date/time, prioritas (Low–Urgent), status (Todo, In Progress, Completed, Cancelled), kategori, tag, reminder, lampiran, relasi ke note & meeting. Tampilan **List** (dikelompokkan Overdue/Today/Upcoming/…), **Board** (drag & drop antar status, mendukung touch), **Calendar**. Progres otomatis.
- **Calendar**: Month/Week/Day/Agenda, menampilkan event, schedule, reminder, meeting, dan task; buat event dengan klik tanggal atau drag rentang waktu; drag untuk memindah, resize untuk mengubah durasi; repeat None/Daily/Weekly/Monthly/Yearly (tanggal 31 otomatis menyesuaikan akhir bulan).
- **Meeting**: judul, deskripsi/agenda, tanggal, jam, lokasi, URL meeting (tombol Join), peserta, reminder, catatan meeting (rich text, auto-save), action items (task), lampiran, note terkait.
- **Mind Map**: root/child/sibling/parent node, edit, hapus, duplikat subtree, connect node bebas (dengan label), collapse/expand, drag node (drop ke node lain = pindah parent), zoom/pan/pinch, auto layout, warna & ikon node, catatan per node, undo/redo, export PNG/SVG/PDF. **Disimpan relasional** di `mindmaps`, `mindmap_nodes`, `mindmap_edges`.
- **Flowchart**: Start, End, Process, Decision, Input, Output, Database, Document, Connector; drag & drop dari palet, sambungkan lewat port, edit teks, resize, move, multi-select, duplikat, copy/paste, grid, snap-to-grid, undo/redo, label & garis putus-putus pada connector, export PNG/SVG/PDF. **Disimpan relasional** di `flowcharts`, `flowchart_nodes`, `flowchart_edges`.
- **Email reminder (SMTP/PHPMailer)**: reminder task, meeting, jadwal, daily agenda, weekly agenda. Contoh: *“Reminder: Meeting Project Dukcapil akan dimulai 30 menit lagi.”* Semua e-mail tercatat di `email_notifications` (pending/sent/failed/cancelled + error) dan `email_logs`; retry otomatis 3×.
- **Search global**: notes, task, meeting, kalender, mind map (termasuk isi node), flowchart, audio, file — realtime dengan debounce; filter tipe, kategori, tag, tanggal, favorit, arsip. Command palette **Ctrl+K**.
- **Drive (v1.1)**: penyimpanan berkas penting ala Google Drive — folder bertingkat (breadcrumb, pindah via drag & drop atau dialog), tampilan My Drive / Starred / Recent / All files, grid/list, filter tipe (gambar, PDF, audio, dokumen, …), deskripsi, bintang. **Viewer bawaan**: gambar (zoom/rotate), **PDF dirender dengan pdf.js** (navigasi halaman, zoom, fit — juga jalan di Android/iOS), audio, teks. Format: image, audio, PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, ZIP.
- **Mail admin (v1.2, Hostinger Mail API)**: khusus role **Admin** — baca kotak masuk perusahaan (folder, unread, kuota, pencarian `from:` / `subject:`, bintang, pindah folder, Trash → hapus permanen), balas / balas semua / teruskan (dengan lampiran asli, file dari komputer, atau file Drive), preview lampiran gambar/PDF, **simpan lampiran ke Drive** dengan tag. HTML email ditampilkan di iframe sandbox tanpa script; gambar remote (tracking pixel) diblokir sampai admin klik *Show images*. Token API disimpan terenkripsi dan tidak pernah dikirim ke browser; semua kirim/pindah/hapus tercatat di activity log.
- **Beberapa API Email — tambah & hapus (v1.7)**: *Mail settings & APIs* (di Mail dan di Admin → Email & reminders) menampilkan daftar API Hostinger Mail: nama, token tersamar (••••1234), mailbox per API, status (merah bila token dicabut). **Add API** (diverifikasi ke Hostinger dulu, token yang sama/order yang sama ditolak), **hapus** per API, ganti nama, *Delete all APIs*. Satu token per domain/order email, jadi beberapa domain bisa dibuka sekaligus; pemilih mailbox dikelompokkan per API dan setiap mailbox otomatis memakai token miliknya.
- **Tulisan tangan dengan pena (v1.4)**: tombol **Write** di toolbar catatan atau menu *Create → Handwriting* membuka halaman kertas (garis / kotak / titik / polos) untuk menulis dengan S Pen, Apple Pencil, stylus lain, jari atau mouse. Tebal tinta mengikuti tekanan pena; pena, stabilo, penghapus, 7 warna, 3–4 ukuran, undo/redo. **Mode pena saja** (aktif otomatis saat pena terdeteksi): jari menggulir halaman, telapak tangan diabaikan. Ujung penghapus stylus atau **tombol samping S Pen** = penghapus. Tulisan disimpan sebagai file vektor (bisa diedit lagi) + PNG di `uploads/`, tampil di dalam catatan, di sampul kartu catatan, ikut terkunci PIN dan ikut terbagi ke penerima share (hanya lihat). Tidak ada pengenalan tulisan → teks (OCR); itu butuh layanan eksternal.
- **Berbagi semua fitur (v1.5)**: selain catatan, sekarang **rekaman audio, mind map, flowchart, file Drive dan folder Drive** bisa dibagikan ke user tertentu lewat tombol/menu **Share…**. Penerima melihatnya di filter **Shared with me** (Audio, Mind Maps, Flowcharts, Drive) dengan lencana nama pemilik, mendapat notifikasi + e-mail, dan bisa *Remove from my list*. Hak akses: audio, file & folder = **lihat/putar/unduh**; mind map & flowchart = **View** (lihat + *Make a copy*) atau **Edit** (ikut mengubah). Folder yang dibagikan otomatis mencakup sub-folder dan file yang ditambahkan kemudian. Hanya pemilik yang bisa rename, pindah, hapus atau membagikan ulang. Jika dua editor diagram menyimpan bersamaan, yang kedua mendapat peringatan konflik (nomor revisi) dan diminta reload — tidak ada penimpaan diam-diam. Saklar admin *Sharing* (General) mematikan semua berbagi.
- **Tag user di Meeting & Calendar (v1.5)**: form event/jadwal/reminder dan form meeting punya kolom **Tag users** (ketik nama → pilih). User yang ditandai langsung melihat item itu di **Calendar** mereka (ikon 👥, keterangan *Tagged by …*, hanya-baca), di daftar **Meeting**, dashboard & pencarian; mendapat notifikasi (klik → langsung membuka detailnya) dan **reminder e-mail yang sama** dengan pemilik sesuai preferensi masing-masing. Menghapus tag mencabut akses. Kolom *Other participants* tetap untuk tamu tanpa akun.
- **Kunci catatan dengan PIN (v1.3)**: satu PIN 4–8 digit per user (di-hash, tidak pernah disimpan polos). Catatan yang dikunci menyembunyikan isi, cuplikan, gambar, lampiran dan audio-nya di daftar, dashboard, pencarian global, Drive dan API sampai PIN dimasukkan; buka-kunci berlaku per perangkat/sesi selama 10 menit tanpa aktivitas, ada tombol *Lock now*. 5× PIN salah → diblokir 15 menit. Lupa PIN → reset dengan password akun. Catatan terkunci tidak bisa dibagikan. Isi tidak dienkripsi: PIN melindungi dari orang lain yang memakai akun/perangkat yang sama, bukan dari admin database.
- **Meeting berbagi (v1.3)**: pemilik membagikan meeting ke user tertentu, atau **ke semua user** (khusus Admin; termasuk user yang dibuat belakangan). Penerima melihatnya di daftar Meeting (filter *Shared with me*), kalender, dashboard, pencarian dan agenda e-mail — hanya-baca (agenda, peserta, catatan meeting, lampiran). Reminder meeting dikirim ke semua penerima sesuai preferensi masing-masing; jadwal ulang/pembatalan memberi notifikasi.
- **Video (v1.3)**: MP4, WebM, MOV, M4V bisa diunggah ke Drive dan lampiran catatan/meeting, diputar langsung (streaming HTTP Range, bisa di-seek), batas ukuran sendiri (*Max video size*, default 100 MB).
- **Tanpa batas upload (v1.7)**: tidak ada batas ukuran file secara default (gambar, audio, video, dokumen, ZIP, juga **restore backup**), tidak ada batas resolusi gambar (gambar yang terlalu besar untuk memori PHP disimpan apa adanya tanpa kompresi). Satu-satunya batas: kapasitas disk hosting.
- **Kontrol upload & storage tanpa kuota (v1.6)**: menu **Admin → Uploads & storage** — batas ukuran opsional per jenis file (gambar, audio, video, dokumen; **0 = tanpa batas**, default), nyalakan/matikan jenis file yang boleh diunggah, cadangan ruang kosong server, ringkasan pemakaian (folder `uploads/`, database, sisa disk, per jenis file, user terbesar, bar pemakaian vs paket hosting). **Tidak ada kuota per user**: semua file masuk ke storage hosting yang ada. **File besar dikirim bertahap (chunked upload)** dengan retry otomatis, sehingga batas PHP `upload_max_filesize` (mis. 32 MB di Hostinger) tidak lagi membatasi — video berukuran GB bisa diunggah.
- **Penyimpanan file**: semua gambar, audio, video dan dokumen disimpan sebagai file di folder `uploads/` hosting (terlihat di hPanel → File Manager). MySQL hanya menyimpan metadata (nama, ukuran, path) — tidak ada kolom BLOB, dan gambar base64 di catatan otomatis dibuang. Admin → Overview menampilkan ukuran folder uploads vs ukuran database.
- **Dashboard yang bisa diatur (v1.3)**: sembunyikan bagian atau kartu statistik lewat ikon mata di tiap widget atau tombol *Customize*; tersimpan per user di server, ada *Show all*.
- **Tag Drive ↔ Notes**: tag yang sama dipakai untuk catatan dan berkas (`file_tag_relations`). Di editor catatan, panel *Linked Drive files* menampilkan berkas yang berbagi tag; di detail berkas tampil *Related notes*. Pencarian global & filter `#tag` mencakup berkas.
- **Catatan berbagi (v1.1)**: pemilik membagikan catatan ke user tertentu dengan izin **View** atau **Edit**; penerima melihatnya di filter *Shared with me* dan widget dashboard, bisa **pin** di sisi mereka sendiri, atau keluar dari share. Penerima Edit hanya mengubah judul & isi (bukan tag/kategori/lampiran). Simpan bersamaan dilindungi deteksi konflik (409) — tidak ada penimpaan diam-diam. Notifikasi + e-mail saat dibagikan. Admin bisa mematikan fitur ini (General → *Sharing*).
- **Trash**: semua tipe data (note, task, event, meeting, mind map, flowchart, audio, file) bisa di-restore atau dihapus permanen (file fisik ikut dihapus); auto-delete setelah N hari (setting admin).
- **Settings**: Profile, Appearance (Light/Dark/System, accent color, sidebar collapse, background image + opacity, compact mode), Notifications (termasuk desktop notification), Email, Security (ganti password, perangkat yang login), Storage, Categories (drag untuk urutkan), Tags, Import/Export data.
- **Admin panel**: statistik + grafik (notes per hari, penyelesaian task, aktivitas user, penggunaan storage), kesehatan sistem, kelola user & permission, branding (logo, favicon, background, nama aplikasi, **tata letak logo**: tampil logo saja / logo + nama / nama saja, tinggi & lebar maksimum logo sidebar, tinggi logo halaman login, preset Compact/Balanced/Large, live preview), default theme/accent, registrasi, kontrol upload & storage, auto-delete trash, SMTP + test e-mail + log e-mail, scheduler, kategori default, backup/restore database & uploads, export data user, activity log.
- **UI/UX**: responsive (sidebar desktop, collapsible di tablet, bottom navigation di mobile), dark/light/system, toast, modal, confirmation dialog, dropdown, context menu (klik kanan), tooltip, skeleton loading, empty state, loading/disabled state tombol, animasi halus (menghormati `prefers-reduced-motion`).
- **Keyboard shortcuts**: `Ctrl+N` / `Alt+N` note baru, `Ctrl+K` search, `Ctrl+S` simpan, `Ctrl+Shift+T` / `Alt+T` task baru, `Alt+M` meeting, `Alt+E` event, `?` daftar shortcut.

---

## Keamanan

- Password di-hash dengan `password_hash()` (bcrypt/argon sesuai PHP), tidak pernah disimpan plain text; rehash otomatis.
- Semua query memakai **prepared statements** (PDO, emulated prepares dimatikan).
- **CSRF token** wajib untuk semua request POST; cookie sesi `HttpOnly`, `SameSite=Lax`, `Secure` saat HTTPS; `session.use_strict_mode`; regenerasi ID sesi saat login.
- **Isolasi data**: setiap query difilter dengan `user_id` dari sesi server — bukan dari ID yang dikirim browser. Relasi silang (mis. task → note) juga diverifikasi kepemilikannya.
- **XSS**: konten rich text disanitasi server-side dengan whitelist DOM (tag, atribut, style, URL); output API JSON; template frontend meng-escape semua nilai; CSP ketat (`script-src 'self'`, tanpa inline script).
- **Upload**: whitelist ekstensi + validasi MIME asli (`finfo`) + batas ukuran per jenis + decode ulang gambar via GD; nama file acak; folder `uploads/` **tidak bisa diakses langsung** — file dilayani lewat API setelah cek kepemilikan (atau hak share catatan). PDF dirender pdf.js dengan `isEvalSupported: false`; file non-PDF dilayani dengan CSP `sandbox`.
- Rate limiting login & forgot password per e-mail dan per IP.
- Secure headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS (saat HTTPS), CSP.
- Kredensial SMTP tidak di-hardcode: disimpan di `app/config.php` **atau** di database dalam keadaan **terenkripsi** (libsodium/AES-GCM dengan `app.key`).
- Folder `app/`, `storage/`, `uploads/` diblokir lewat `.htaccess`; installer terkunci setelah instalasi.

---

## Struktur folder

```
SmartNotes/
├── README.md                 ← dokumen ini
├── docs/INSTALL.md           ← panduan deploy shared hosting
├── build/                    ← tooling development saja (TIDAK diupload)
│   ├── package.json
│   ├── build.mjs             ← bundle + minify (esbuild) → public_html/assets/dist
│   └── icons.mjs             ← generate subset ikon Lucide
└── public_html/              ← UPLOAD ISI FOLDER INI ke public_html hosting
    ├── index.php             ← shell SPA
    ├── cron.php              ← scheduler (cron job / URL bertoken)
    ├── .htaccess, .user.ini  ← konfigurasi Apache/LiteSpeed & PHP
    ├── api/index.php         ← REST API (api/index.php?route=...)
    ├── install/              ← web installer + database.sql (hapus setelah instalasi)
    ├── app/                  ← kode PHP (diblokir dari web)
    │   ├── bootstrap.php, routes.php, config.example.php
    │   ├── lib/              ← DB, Auth, Csrf, Sanitizer, Uploader, Mailer, Scheduler, Backup, ...
    │   ├── controllers/      ← Notes, Tasks, Events, Meetings, Mindmaps, Flowcharts, Files, Audio, Admin, ...
    │   └── vendor/PHPMailer/
    ├── assets/
    │   ├── css/app.css, js/  ← source (dipakai saat app.debug = true)
    │   ├── dist/             ← hasil build production (default)
    │   ├── vendor/           ← FullCalendar, Chart.js, jsPDF, DOMPurify
    │   └── fonts/            ← Inter
    ├── uploads/              ← file user (diblokir; dilayani via API). uploads/branding/ publik (gambar saja)
    └── storage/              ← backups, logs, sessions, cache (diblokir)
```

> Struktur `/admin` dan `/user` terpisah tidak diperlukan: aplikasi berupa SPA dengan routing hash (`#/admin`, `#/notes`, …) dan semua otorisasi dilakukan di API.

---

## Database

Skema ada di **`public_html/install/database.sql`** (38 tabel, InnoDB, utf8mb4, PK/FK/index/unique, timestamps, soft delete). Tabel utama:

`users`, `user_profiles`, `user_settings`, `password_resets`, `remember_tokens`, `login_attempts`, `note_categories`, `task_categories`, `note_tags`, `notes`, `note_tag_relations`, `task_tag_relations`, `note_attachments`, `drive_folders`, `file_tag_relations`, `note_shares`, `item_shares`, `note_pins`, `note_drawings`, `audio_notes`, `tasks`, `calendar_events`, `event_participants`, `meetings`, `meeting_participants`, `meeting_shares`, `mindmaps`, `mindmap_nodes`, `mindmap_edges`, `flowcharts`, `flowchart_nodes`, `flowchart_edges`, `reminders`, `email_notifications`, `email_logs`, `settings`, `notifications`, `activity_logs`.

**Migrasi otomatis**: `app/lib/Migrator.php` mencocokkan skema dengan `settings.schema_version` pada setiap request API dan menambahkan kolom/tabel yang belum ada (idempotent, dikunci `GET_LOCK`). Upgrade dari v1.0 cukup dengan upload file baru — tanpa menjalankan SQL manual.

Tidak ada data aplikasi yang disimpan di localStorage/IndexedDB/file JSON. Browser storage hanya dipakai untuk satu hal kecil: mengingat halaman tujuan sebelum login (sessionStorage).

---

## Development

```bash
# 1. Database lokal + PHP built-in server
mysql -e "CREATE DATABASE smartnotes CHARACTER SET utf8mb4"
php -S 127.0.0.1:8080 -t public_html      # lalu buka http://127.0.0.1:8080/install/

# 2. Edit source di public_html/assets/js & css.
#    Set 'debug' => true di app/config.php agar source (bukan dist) yang dimuat.

# 3. Build production (minify + code splitting) sebelum deploy:
cd build && npm install && npm run build
```

`npm run build` menjalankan `icons.mjs` (subset ikon) lalu `build.mjs` (esbuild) dan menulis ulang `public_html/assets/dist/`.

---

## Catatan & batasan yang perlu diketahui

- **"Storage tidak dibatasi" tetap dibatasi disk hosting.** Aplikasi tidak memberi kuota, tetapi paket Hostinger punya kapasitas disk (dan batas jumlah file/inode). Angka *Free disk* yang dilaporkan PHP bisa berupa disk fisik server, bukan sisa kuota akun Anda — pantau juga hPanel → Disk usage. Jika disk penuh, upload gagal dengan pesan jelas, tidak ada file setengah jadi.
- Backup *Uploads (.zip)* dari folder `uploads/` yang sangat besar (puluhan GB) bisa melebihi batas waktu PHP; untuk storage sebesar itu gunakan backup bawaan Hostinger (hPanel → Backups).
- Gambar dikompres ulang (maks. 2560 px) bila memori PHP cukup; gambar raksasa (puluhan megapiksel) disimpan apa adanya tanpa thumbnail.
- Batas yang **tidak bisa** dihapus dari aplikasi: ukuran email yang diterima Hostinger saat mengirim lampiran lewat Mail, dan lampiran email di atas 30 MB tidak bisa dibuka/disimpan ke Drive lewat aplikasi.
- **Reminder tepat waktu butuh cron job.** Shared hosting tidak punya proses background. Tanpa cron, scheduler berjalan “menumpang” trafik user (maksimal tiap ±2 menit selama ada user yang membuka aplikasi) — artinya reminder bisa terlambat jika tidak ada yang online. Pasang cron 5 menit (lihat INSTALL.md).
- **Perekaman audio butuh HTTPS** (aturan browser untuk akses mikrofon). Aktifkan SSL (gratis di Hostinger/cPanel AutoSSL) dan redirect HTTPS di `.htaccess`.
- `Ctrl+N` dan `Ctrl+Shift+T` dicadangkan oleh beberapa browser (Chrome) untuk jendela/tab baru dan tidak bisa diambil alih oleh halaman web; gunakan alternatif `Alt+N` / `Alt+T`.
- Export data user (JSON) berisi metadata file, bukan isi binary file; gunakan backup “Uploads (.zip)” di Admin untuk file fisik.
- **Preview Office (DOCX/XLSX/PPTX) tidak tersedia di dalam aplikasi** — berkas tersebut hanya bisa diunduh. Viewer online (Google/Microsoft) sengaja tidak dipakai karena berkas harus dibuat publik.
- Catatan, mind map dan flowchart berbagi bukan kolaborasi real-time (tanpa WebSocket): jika dua orang menyimpan bersamaan, yang kedua mendapat peringatan konflik dan diminta reload.
- Audio dan file Drive yang dibagikan hanya bisa **dilihat/diunduh** penerima; edit tetap oleh pemilik. Jika penerima perlu mengubah, mereka mengunduh atau (untuk diagram) memakai *Make a copy*.
- Saklar admin *Sharing* (General) mematikan berbagi catatan, audio, diagram dan Drive, tetapi **tidak** mematikan tag user di event/meeting (itu fitur penjadwalan).
- Setelah upgrade ke v1.1 semua user **ter-logout satu kali** (versi sesi baru).
- Format audio mengikuti browser (Chrome/Edge/Firefox: WebM/Opus, Safari: MP4/AAC); semua bisa diputar ulang di browser modern.
