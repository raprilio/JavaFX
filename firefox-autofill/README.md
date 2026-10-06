# Form Auto Fill (Firefox)

Add-on Firefox untuk mengisi otomatis form di **satu website** (mis. portal Jira Service Management) dengan nilai yang kamu tetapkan — termasuk dropdown pencarian seperti *Country, Location, Category, Subcategory*.

## Pasang (sementara, untuk uji coba)
1. Buka `about:debugging#/runtime/this-firefox` di Firefox.
2. Klik **Load Temporary Add-on…** → pilih file `manifest.json` di folder ini.
3. Add-on aktif sampai Firefox ditutup.

## Pasang permanen
Firefox rilis biasa hanya menerima add-on yang **ditandatangani Mozilla**:
1. Zip isi folder ini (file-filenya, bukan foldernya): `cd firefox-autofill && zip -r ../form-autofill.zip *`
2. Upload di https://addons.mozilla.org/developers/ → pilih **"On your own" (unlisted)** → gratis, tidak dipublikasikan.
3. Download file `.xpi` yang sudah ditandatangani → seret ke jendela Firefox.

(Alternatif: Firefox Developer Edition / Nightly dengan `xpinstall.signatures.required = false` di `about:config`.)

## Atur
Klik ikon add-on → **Pengaturan**:
- **Pola URL** — website target, `*` = wildcard. Contoh: `https://perusahaan.atlassian.net/servicedesk/customer/portal/12/*`
- **Isi otomatis** — jalan sendiri saat halaman dibuka; kalau mati, pakai tombol **Isi Form Sekarang**.
- **Field** — Label persis seperti di form (tanpa `*`) + nilainya. Diisi berurutan dari atas, jadi field induk (Category) harus di atas field turunannya (Subcategory).

Untuk dropdown pencarian, nilai diketik lalu opsi yang cocok dipilih (cocok persis → diawali → mengandung). Gunakan teks yang cukup unik agar opsi yang benar yang terpilih.

## Kalau ada field yang gagal
Popup menampilkan log per field (`✔`/`✘`). Penyebab umum:
- `label tidak ditemukan` → teks label di Pengaturan tidak sama dengan di form.
- `opsi "..." tidak ditemukan` → nilai tidak ada di daftar opsi dropdown; cek ejaan.
