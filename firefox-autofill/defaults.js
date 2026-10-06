// Konfigurasi bawaan. Bisa diubah lewat halaman Pengaturan add-on.
var AUTOFILL_DEFAULTS = {
  // Pola URL website target. "*" = wildcard. Contoh: "https://namaperusahaan.atlassian.net/servicedesk/customer/portal/*"
  urlPattern: "*://*/servicedesk/customer/portal/*",
  // Jalankan otomatis saat halaman dibuka (kalau false, pakai tombol di popup).
  autoRun: true,
  // Field diisi berurutan dari atas ke bawah. "label" = teks label persis seperti di form (tanpa tanda *).
  fields: [
    { label: "Country", value: "Indonesia" },
    { label: "Location", value: "Multivision Tower" },
    { label: "Category", value: "" },
    { label: "Subcategory", value: "" }
  ]
};
