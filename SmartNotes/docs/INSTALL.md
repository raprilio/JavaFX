# Panduan Instalasi SmartNotes di Shared Hosting

Berlaku untuk Hostinger (hPanel), cPanel (Niagahoster, Rumahweb, DomaiNesia, dll.), dan hosting lain yang menyediakan **PHP 8.1+** dan **MySQL/MariaDB**. Tidak butuh VPS, SSH, Composer, maupun Node.js.

---

## 1. Persyaratan

| Kebutuhan | Minimal | Keterangan |
|---|---|---|
| PHP | 8.1 (disarankan 8.2/8.3) | Ekstensi: `pdo_mysql`, `mbstring`, `fileinfo`, `openssl` atau `sodium` |
| Ekstensi opsional | `gd`, `zip` | GD untuk resize/rotate gambar; Zip untuk backup folder uploads |
| Database | MySQL 5.7+/8.x atau MariaDB 10.3+ | |
| Web server | Apache atau LiteSpeed (`.htaccess` aktif) | Nginx: lihat bagian 9 |
| SSL/HTTPS | Sangat disarankan | **Wajib** untuk fitur rekam audio (aturan browser) |

Atur versi PHP di **hPanel → Advanced → PHP Configuration** atau **cPanel → Select PHP Version / MultiPHP Manager**.

---

## 2. Upload file

1. Download/clone repository ini.
2. Upload **isi** folder `SmartNotes/public_html/` (bukan foldernya) ke `public_html/` hosting Anda
   - lewat **File Manager** → Upload ZIP → Extract, atau
   - lewat **FTP** (FileZilla) dengan mode transfer *binary*.
   - Pastikan file tersembunyi `.htaccess` dan `.user.ini` ikut terupload.
3. Ingin dipasang di subfolder (mis. `domain.com/notes/`)? Upload ke `public_html/notes/` — aplikasi otomatis mendeteksi path.
4. Folder `build/` dan `docs/` **tidak perlu** diupload.

Struktur hasil di hosting:

```
public_html/
├── .htaccess  .user.ini  index.php  cron.php
├── api/  app/  assets/  install/  storage/  uploads/
```

Pastikan folder berikut **writable** (permission 755, atau 775 jika perlu): `app/` (hanya saat instalasi), `uploads/`, `storage/` beserta subfoldernya.

---

## 3. Buat database

**Hostinger hPanel:** Databases → *Management* → isi nama database, user, password → *Create*.
**cPanel:** *MySQL® Databases* → Create New Database → Add New User → *Add User To Database* → centang **ALL PRIVILEGES**.

Catat: nama database (mis. `u123456789_smartnotes`), user, password. Host biasanya `localhost`.

---

## 4. Jalankan installer

1. Buka `https://domain-anda.com/install/`
2. Periksa tabel **Server requirements** — semua yang *required* harus **OK**.
3. Isi data database, URL aplikasi, timezone (default `Asia/Jakarta`), dan akun administrator.
4. (Opsional) centang *Add example content* agar dashboard langsung berisi contoh note, task, meeting, mind map, flowchart.
5. Klik **Install SmartNotes**.

Installer akan: membuat 31 tabel dari `install/database.sql`, membuat admin, mengisi kategori default, membuat `app/config.php` berisi **APP key acak** dan **cron token acak**.

> Jika folder `app/` tidak writable, installer menampilkan isi `config.php` — buat file `app/config.php` secara manual lewat File Manager dan tempel isinya.

6. **Hapus folder `install/`** setelah selesai (installer juga otomatis menolak berjalan lagi selama `app/config.php` ada).

### Instalasi manual (tanpa installer)

1. phpMyAdmin → pilih database → **Import** → `install/database.sql`.
2. Salin `app/config.example.php` menjadi `app/config.php`, isi semua nilai (`app.key` dengan string acak panjang: `php -r "echo bin2hex(random_bytes(32));"`).
3. Buat admin pertama: buka `install/` sekali **sebelum** membuat `config.php`, atau insert manual:
   ```sql
   -- ganti hash dengan hasil: php -r "echo password_hash('PasswordAnda123', PASSWORD_DEFAULT);"
   INSERT INTO users (email, password_hash, name, role) VALUES ('admin@domain.com', '$2y$10$...', 'Administrator', 'admin');
   INSERT INTO user_profiles (user_id) VALUES (LAST_INSERT_ID());
   ```

---

## 5. Aktifkan HTTPS

1. Aktifkan SSL (Hostinger: *Security → SSL*; cPanel: *SSL/TLS Status → Run AutoSSL*).
2. Buka `.htaccess`, hapus tanda `#` pada blok **Force HTTPS**:
   ```apache
   RewriteCond %{HTTPS} !=on
   RewriteCond %{HTTP:X-Forwarded-Proto} !https
   RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
   ```
3. Jika memakai Cloudflare/proxy, set `'trust_proxy' => true` di `app/config.php`.

---

## 6. Cron job untuk reminder & e-mail (penting)

Shared hosting tidak menjalankan proses di background, jadi reminder diproses oleh `cron.php`.

**cPanel → Cron Jobs** (atau **hPanel → Advanced → Cron Jobs**):

- Interval: *Once Per Five Minutes* (`*/5 * * * *`)
- Command:
  ```
  /usr/local/bin/php /home/USERNAME/public_html/cron.php >/dev/null 2>&1
  ```
  Path PHP dan home directory bisa berbeda; path lengkap ditampilkan di **Admin → Email & reminders**. Di Hostinger formatnya biasanya `/usr/bin/php /home/u123456789/domains/domain.com/public_html/cron.php`.

**Tidak bisa membuat cron?** Gunakan layanan cron eksternal gratis (cron-job.org, EasyCron) untuk memanggil:
```
https://domain-anda.com/cron.php?token=TOKEN_DARI_app/config.php
```

**Fallback otomatis:** jika cron belum dipasang, scheduler juga berjalan “menumpang” saat user membuka aplikasi (maksimal tiap ±2 menit). Ini cukup untuk uji coba, tetapi reminder bisa terlambat jika tidak ada yang online. Status run terakhir terlihat di **Admin → Overview → System health**.

Scheduler mengerjakan: reminder task/meeting/jadwal → notifikasi in-app + e-mail, daily & weekly agenda, antrian e-mail (retry 3×), auto-delete trash, dan pembersihan token kedaluwarsa.

---

## 7. Konfigurasi SMTP (e-mail)

Login sebagai admin → **Admin → Email & reminders** → isi → **Save SMTP** → **Send test e-mail**.

| Provider | Host | Port / Encryption | Username / Password |
|---|---|---|---|
| Hostinger Email | `smtp.hostinger.com` | 465 SSL (atau 587 TLS) | alamat e-mail lengkap + password mailbox |
| cPanel Email | `mail.domain-anda.com` | 465 SSL | alamat e-mail lengkap + password mailbox |
| Gmail / Google Workspace | `smtp.gmail.com` | 587 TLS | alamat Gmail + **App Password** (wajib 2-Step Verification) |
| Microsoft 365 / Outlook | `smtp.office365.com` | 587 TLS | alamat e-mail + password; *Authenticated SMTP* harus diaktifkan di admin M365 |

- **Sender e-mail** sebaiknya sama dengan username SMTP (atau domain yang sama) agar tidak ditolak/spam.
- Password SMTP yang disimpan lewat panel admin **dienkripsi** di database memakai `app.key`. Jangan mengganti `app.key` setelah instalasi.
- Alternatif yang lebih ketat: isi blok `'smtp'` di `app/config.php`; jika `host` terisi, nilai di config.php dipakai dan form admin menjadi read-only.
- Semua e-mail beserta status (pending/sent/failed) dan pesan error terlihat di **E-mail log**, dan bisa di-*Retry*.

---

## 7b. Mail admin (Hostinger Mail API) — opsional

1. hPanel → **Emails** → pilih domain → bagian *email provisioning / Mail API* → buat **API token**. Token berlaku untuk semua mailbox di order email tersebut — rahasiakan.
2. Login SmartNotes sebagai **Admin** → menu **Mail** → tempel token → **Connect**. Token diverifikasi ke Hostinger sebelum disimpan (terenkripsi dengan `app.key`).
3. Alternatif: taruh di `app/config.php`: `'hostinger_mail' => ['token' => '...']`.
4. Server butuh akses keluar ke `https://api.mail.hostinger.com` (ekstensi PHP **curl** disarankan).

## 8. Batas upload

Aplikasi punya batas per jenis file (Admin → General): gambar 8 MB, audio 25 MB, file lain 20 MB (bisa diubah). PHP juga punya batas sendiri:

- `.user.ini` (sudah disertakan) → untuk PHP-FPM / LiteSpeed: `upload_max_filesize = 32M`, `post_max_size = 40M`.
- `.htaccess` → untuk Apache mod_php.
- Hostinger: bisa juga lewat *PHP Configuration → PHP options*.

Nilai efektif terlihat di **Admin → Overview → System health**.

---

## 9. Nginx (jika bukan Apache/LiteSpeed)

`.htaccess` tidak dibaca Nginx. Tambahkan:

```nginx
location ~ ^/(app|storage)/ { deny all; }
location ~ ^/uploads/(?!branding/) { deny all; }
location ~ ^/uploads/branding/.*\.php$ { deny all; }
location ~* \.(sql|gz|log|md|lock|ini|json)$ { deny all; }
location / { try_files $uri $uri/ /index.php; }
```

---

## 10. Backup & restore

**Admin → Backup & data**:
- *Database backup (.sql.gz)* — dump penuh lewat PHP (tidak butuh `mysqldump`/SSH).
- *Uploads archive (.zip)* — semua file user & branding.
- Download, hapus, atau **Restore** (ketik `RESTORE` untuk konfirmasi). Sebelum restore database, aplikasi otomatis membuat *safety backup*.
- *Restore from file* — upload `.sql`, `.sql.gz` (termasuk dump dari phpMyAdmin) atau `.zip` uploads.
- *Export user data* (JSON) per user. User juga bisa export/import datanya sendiri di **Settings → Import / export**.

File backup disimpan di `storage/backups/` (tidak bisa diakses publik). Simpan salinan di luar server secara berkala.

---

## 11. Update aplikasi

1. Backup database & uploads dari Admin.
2. Upload ulang semua file **kecuali** `app/config.php`, `uploads/`, dan `storage/`.
3. Buka aplikasi. Perubahan skema dijalankan **otomatis** oleh migrator saat request pertama (tidak perlu phpMyAdmin). Versi skema tersimpan di tabel `settings` (`schema_version`).

**Upgrade v1.0 → v1.1** (Drive, catatan berbagi, kontrol akun, tata letak logo):
- Pastikan folder `assets/vendor/pdfjs/` ikut ter-upload (viewer PDF).
- Semua user akan diminta login ulang satu kali.
- User lama **tidak** dipaksa ganti password; paksaan hanya berlaku untuk akun yang dibuat/di-reset admin setelah upgrade (bisa dimatikan per user lewat checkbox di form user).
- Atur ukuran logo di **Admin → Branding → Logo layout**.

---

## 12. Troubleshooting

| Gejala | Solusi |
|---|---|
| Halaman putih / error 500 | Cek versi PHP ≥ 8.1. Lihat `storage/logs/php-error.log`. Sementara set `'debug' => true` di `app/config.php`. |
| Error 500 setelah upload `.htaccess` | Host tidak mengizinkan sebagian direktif. Hapus blok `<IfModule mod_php.c>` atau baris `Options`. |
| “Your session has expired” | Reload halaman. Pastikan cookie tidak diblokir dan jam server benar. |
| Upload gagal untuk file besar | Naikkan `upload_max_filesize` & `post_max_size` (bagian 8) dan limit di Admin → General. |
| Gambar tidak bisa di-rotate/di-resize | Aktifkan ekstensi PHP **GD**. |
| Rekam audio tidak tersedia | Akses lewat **HTTPS** dan izinkan mikrofon di browser. |
| Reminder tidak terkirim | Cek SMTP (Send test e-mail), pasang cron (bagian 6), cek E-mail log & “Last run” scheduler. Pastikan user mengaktifkan reminder di Settings → Notifications/Email dan task punya due date + reminder. |
| Gmail menolak login | Gunakan **App Password**, bukan password akun. |
| PDF tidak tampil di Drive | Pastikan `assets/vendor/pdfjs/` ter-upload lengkap dan server mengirim `.mjs` sebagai JavaScript (`AddType application/javascript .mjs` — sudah ada di `.htaccess`). |
| User terus diminta ganti password | Akun dibuat admin dengan opsi *Require password change*. User harus memasukkan password sementara lalu password baru yang berbeda. |
| Lupa password admin | Gunakan *Forgot password* (butuh SMTP) atau set ulang hash di phpMyAdmin (lihat bagian 4, instalasi manual). |
