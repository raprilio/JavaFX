const statusEl = document.getElementById("status");
const runBtn = document.getElementById("run");
const logEl = document.getElementById("log");

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

(async () => {
  try {
    const tab = await activeTab();
    const res = await browser.tabs.sendMessage(tab.id, { type: "autofill-match" });
    statusEl.textContent = res.match
      ? "Halaman ini cocok dengan pola URL."
      : "Halaman ini TIDAK cocok dengan pola URL (tetap bisa diisi manual).";
    runBtn.disabled = false;
  } catch (e) {
    statusEl.textContent = "Add-on tidak bisa berjalan di halaman ini. Coba muat ulang halaman.";
  }
})();

runBtn.addEventListener("click", async () => {
  runBtn.disabled = true;
  runBtn.textContent = "Mengisi...";
  logEl.textContent = "";
  try {
    const tab = await activeTab();
    const res = await browser.tabs.sendMessage(tab.id, { type: "autofill-run" });
    logEl.textContent = res.log.join("\n") || "Tidak ada field yang diisi (nilai kosong?).";
  } catch (e) {
    logEl.textContent = "Gagal: " + e.message;
  }
  runBtn.disabled = false;
  runBtn.textContent = "Isi Form Sekarang";
});

document.getElementById("opts").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});
