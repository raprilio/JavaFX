const tbody = document.getElementById("fields");
const msg = document.getElementById("msg");

function addRow(field = { label: "", value: "" }) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td class="label-col"><input type="text" class="f-label" placeholder="mis. Category"></td>
    <td><input type="text" class="f-value" placeholder="nilai"></td>
    <td class="act">
      <button class="icon up" title="Naik">↑</button>
      <button class="icon down" title="Turun">↓</button>
      <button class="icon del" title="Hapus">✕</button>
    </td>`;
  tr.querySelector(".f-label").value = field.label;
  tr.querySelector(".f-value").value = field.value;
  tr.querySelector(".up").onclick = () => tr.previousElementSibling && tbody.insertBefore(tr, tr.previousElementSibling);
  tr.querySelector(".down").onclick = () => tr.nextElementSibling && tbody.insertBefore(tr.nextElementSibling, tr);
  tr.querySelector(".del").onclick = () => tr.remove();
  tbody.appendChild(tr);
}

function render(config) {
  document.getElementById("url").value = config.urlPattern;
  document.getElementById("autorun").checked = config.autoRun;
  tbody.innerHTML = "";
  config.fields.forEach(addRow);
}

async function load() {
  const saved = await browser.storage.local.get("config");
  render(Object.assign({}, AUTOFILL_DEFAULTS, saved.config || {}));
}

function flash(text) {
  msg.textContent = text;
  setTimeout(() => (msg.textContent = ""), 2500);
}

document.getElementById("add").onclick = () => addRow();

document.getElementById("save").onclick = async () => {
  const fields = [...tbody.querySelectorAll("tr")]
    .map((tr) => ({ label: tr.querySelector(".f-label").value.trim(), value: tr.querySelector(".f-value").value.trim() }))
    .filter((f) => f.label);
  const config = {
    urlPattern: document.getElementById("url").value.trim() || AUTOFILL_DEFAULTS.urlPattern,
    autoRun: document.getElementById("autorun").checked,
    fields
  };
  await browser.storage.local.set({ config });
  flash("Tersimpan ✔");
};

document.getElementById("reset").onclick = async () => {
  await browser.storage.local.remove("config");
  await load();
  flash("Dikembalikan ke bawaan");
};

load();
