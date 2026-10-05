# SmartNotes

Aplikasi catatan all-in-one untuk produktivitas pribadi maupun perusahaan: **Notes, Checklist, Task (List/Board/Calendar), Calendar, Meeting, Mind Map, Flowchart, Audio Recorder, Image Notes, File Manager, Email Reminder, Global Search, Trash, Settings, dan Admin Panel** — dibangun khusus agar berjalan di **shared hosting** (PHP + MySQL), tanpa VPS, Docker, Redis, Node.js di production, WebSocket, maupun background worker.

> Panduan instalasi lengkap (cPanel / Hostinger hPanel / FTP): **[docs/INSTALL.md](docs/INSTALL.md)**

---

## Teknologi

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Backend | PHP 8.1+ murni (tanpa framework), REST-style JSON API | Tersedia di semua shared hosting, tidak perlu Composer di server |
| Database | MySQL 5.7+/8.x atau MariaDB 10.3+ (InnoDB, utf8mb4) | Semua data aplikasi tersimpan persisten di MySQL |
| Frontend | Vanilla JavaScript (ES modules), CSS custom (tanpa framework) | Ringan, tanpa build step wajib, code-splitting per halaman |
| Ikon | Lucide (subset ±210 ikon, di-bundle lokal) | Tidak bergantung CDN |
| Library pihak ketiga (lokal, lazy-load) | FullCalendar 6, Chart.js 4, jsPDF 3, DOMPurify 3, PHPMailer 7 | Hanya dimuat saat halaman yang membutuhkan dibuka |
| Font | Inter (self-hosted) | Tidak ada request ke Google Fonts |

Production **tidak** membutuhkan Node.js: hasil build (`public_html/assets/dist`) sudah ikut di repository. Node.js hanya dipakai saat development untuk minify ulang.

---

## Fitur

- **Autentikasi**: login, logout, remember me (token selector/validator yang dirotasi), forgot & reset password via e-mail, rate limiting login, session timeout, ganti password, avatar, profil.
- **Role & permission**: Admin dan User. User hanya mengakses datanya sendiri; admin dapat memberi permission khusus ke user (kelola user, branding, setting, e-mail, kategori, statistik, backup).
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
- **File management**: image, audio, PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, ZIP — nama, tipe, ukuran, tanggal, preview, download, rename, hapus.
- **Trash**: semua tipe data (note, task, event, meeting, mind map, flowchart, audio, file) bisa di-restore atau dihapus permanen (file fisik ikut dihapus); auto-delete setelah N hari (setting admin).
- **Settings**: Profile, Appearance (Light/Dark/System, accent color, sidebar collapse, background image + opacity, compact mode), Notifications (termasuk desktop notification), Email, Security (ganti password, perangkat yang login), Storage, Categories (drag untuk urutkan), Tags, Import/Export data.
- **Admin panel**: statistik + grafik (notes per hari, penyelesaian task, aktivitas user, penggunaan storage), kesehatan sistem, kelola user & permission, branding (logo, favicon, background, nama aplikasi), default theme/accent, registrasi, limit upload, auto-delete trash, SMTP + test e-mail + log e-mail, scheduler, kategori default, backup/restore database & uploads, export data user, activity log.
- **UI/UX**: responsive (sidebar desktop, collapsible di tablet, bottom navigation di mobile), dark/light/system, toast, modal, confirmation dialog, dropdown, context menu (klik kanan), tooltip, skeleton loading, empty state, loading/disabled state tombol, animasi halus (menghormati `prefers-reduced-motion`).
- **Keyboard shortcuts**: `Ctrl+N` / `Alt+N` note baru, `Ctrl+K` search, `Ctrl+S` simpan, `Ctrl+Shift+T` / `Alt+T` task baru, `Alt+M` meeting, `Alt+E` event, `?` daftar shortcut.

---

## Keamanan

- Password di-hash dengan `password_hash()` (bcrypt/argon sesuai PHP), tidak pernah disimpan plain text; rehash otomatis.
- Semua query memakai **prepared statements** (PDO, emulated prepares dimatikan).
- **CSRF token** wajib untuk semua request POST; cookie sesi `HttpOnly`, `SameSite=Lax`, `Secure` saat HTTPS; `session.use_strict_mode`; regenerasi ID sesi saat login.
- **Isolasi data**: setiap query difilter dengan `user_id` dari sesi server — bukan dari ID yang dikirim browser. Relasi silang (mis. task → note) juga diverifikasi kepemilikannya.
- **XSS**: konten rich text disanitasi server-side dengan whitelist DOM (tag, atribut, style, URL); output API JSON; template frontend meng-escape semua nilai; CSP ketat (`script-src 'self'`, tanpa inline script).
- **Upload**: whitelist ekstensi + validasi MIME asli (`finfo`) + batas ukuran per jenis + decode ulang gambar via GD; nama file acak; folder `uploads/` **tidak bisa diakses langsung** — file dilayani lewat API setelah cek kepemilikan.
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

Skema ada di **`public_html/install/database.sql`** (31 tabel, InnoDB, utf8mb4, PK/FK/index/unique, timestamps, soft delete). Tabel utama:

`users`, `user_profiles`, `user_settings`, `password_resets`, `remember_tokens`, `login_attempts`, `note_categories`, `task_categories`, `note_tags`, `notes`, `note_tag_relations`, `task_tag_relations`, `note_attachments`, `audio_notes`, `tasks`, `calendar_events`, `event_participants`, `meetings`, `meeting_participants`, `mindmaps`, `mindmap_nodes`, `mindmap_edges`, `flowcharts`, `flowchart_nodes`, `flowchart_edges`, `reminders`, `email_notifications`, `email_logs`, `settings`, `notifications`, `activity_logs`.

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

- **Reminder tepat waktu butuh cron job.** Shared hosting tidak punya proses background. Tanpa cron, scheduler berjalan “menumpang” trafik user (maksimal tiap ±2 menit selama ada user yang membuka aplikasi) — artinya reminder bisa terlambat jika tidak ada yang online. Pasang cron 5 menit (lihat INSTALL.md).
- **Perekaman audio butuh HTTPS** (aturan browser untuk akses mikrofon). Aktifkan SSL (gratis di Hostinger/cPanel AutoSSL) dan redirect HTTPS di `.htaccess`.
- `Ctrl+N` dan `Ctrl+Shift+T` dicadangkan oleh beberapa browser (Chrome) untuk jendela/tab baru dan tidak bisa diambil alih oleh halaman web; gunakan alternatif `Alt+N` / `Alt+T`.
- Export data user (JSON) berisi metadata file, bukan isi binary file; gunakan backup “Uploads (.zip)” di Admin untuk file fisik.
- Format audio mengikuti browser (Chrome/Edge/Firefox: WebM/Opus, Safari: MP4/AAC); semua bisa diputar ulang di browser modern.
