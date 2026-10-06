(function () {
  "use strict";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

  function wildcardToRegex(pattern) {
    const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp("^" + esc + "$", "i");
  }

  async function loadConfig() {
    const saved = await browser.storage.local.get("config");
    return Object.assign({}, AUTOFILL_DEFAULTS, saved.config || {});
  }

  async function waitFor(fn, timeout = 10000, interval = 150) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  // Cari elemen label yang teksnya sama dengan nama field.
  function findLabel(labelText) {
    const target = norm(labelText);
    const candidates = document.querySelectorAll("label, legend, [id$='-label'], [data-testid*='label']");
    for (const el of candidates) {
      if (norm(el.textContent) === target && isVisible(el)) return el;
    }
    return null;
  }

  // Dari label, temukan input/select/textarea yang terkait.
  function findControl(labelEl) {
    const forId = labelEl.getAttribute("for");
    if (forId) {
      const el = document.getElementById(forId);
      if (el) return el;
    }
    if (labelEl.id) {
      const el = document.querySelector(`[aria-labelledby~="${CSS.escape(labelEl.id)}"]`);
      if (el) {
        if (el.matches("input, select, textarea")) return el;
        const inner = el.querySelector("input, select, textarea");
        if (inner) return inner;
      }
    }
    const inner = labelEl.querySelector("input, select, textarea");
    if (inner) return inner;
    // Naik ke container terdekat yang punya kontrol input.
    let node = labelEl.parentElement;
    for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
      const el = node.querySelector("input:not([type=hidden]), select, textarea");
      if (el) return el;
    }
    return null;
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function fireMouse(el, type) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
  }

  function isSearchDropdown(input) {
    return (
      input.getAttribute("role") === "combobox" ||
      input.hasAttribute("aria-autocomplete") ||
      /react-select|select__input/i.test(input.id + " " + input.className)
    );
  }

  // Cari wadah dropdown (react-select / Atlaskit) untuk input ini.
  function dropdownContainer(input) {
    let node = input.parentElement;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      if (/(^|[\s_-])(container|select)([\s_-]|$)|SelectContainer/i.test(node.className || "")) {
        if (node.querySelector("[class*='control'], [class*='Control']")) return node;
      }
    }
    return input.closest("[class*='container']") || input.parentElement;
  }

  function currentDropdownValue(input) {
    const box = dropdownContainer(input);
    const sv = box && box.querySelector("[class*='single-value'], [class*='singleValue'], [class*='SingleValue']");
    return sv ? sv.textContent.trim() : "";
  }

  function visibleOptions(input) {
    let opts = [];
    const listId = input.getAttribute("aria-controls") || input.getAttribute("aria-owns");
    if (listId) {
      const list = document.getElementById(listId);
      if (list) opts = [...list.querySelectorAll("[role='option'], [id*='-option-']")];
    }
    if (!opts.length) opts = [...document.querySelectorAll("[role='option'], [id*='-option-'], [class*='option']")];
    return opts.filter((o) => isVisible(o) && o.textContent.trim() && !/no options|loading|tidak ada/i.test(o.textContent));
  }

  function pickOption(opts, value) {
    const v = norm(value);
    return (
      opts.find((o) => norm(o.textContent) === v) ||
      opts.find((o) => norm(o.textContent).startsWith(v)) ||
      opts.find((o) => norm(o.textContent).includes(v)) ||
      null
    );
  }

  async function fillSearchDropdown(input, value) {
    const current = currentDropdownValue(input);
    if (current && norm(current).includes(norm(value))) return "sudah terisi";

    const box = dropdownContainer(input);
    const control = (box && box.querySelector("[class*='control'], [class*='Control']")) || input;
    input.focus();
    fireMouse(control, "mousedown");
    await sleep(100);

    setNativeValue(input, value);

    // Tunggu opsi muncul (bisa async dari server).
    const option = await waitFor(() => pickOption(visibleOptions(input), value), 8000);
    if (!option) {
      // Jangan tinggalkan teks pencarian menggantung.
      setNativeValue(input, "");
      input.blur();
      throw new Error(`opsi "${value}" tidak ditemukan`);
    }
    option.scrollIntoView({ block: "nearest" });
    fireMouse(option, "mouseover");
    fireMouse(option, "mousemove");
    fireMouse(option, "mousedown");
    fireMouse(option, "mouseup");
    fireMouse(option, "click");
    await sleep(250);

    // Fallback: kalau klik tidak terdaftar, tekan Enter pada opsi yang sedang fokus.
    if (!currentDropdownValue(input)) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
      await sleep(250);
    }
    input.blur();
    return "diisi";
  }

  function fillNativeSelect(select, value) {
    const v = norm(value);
    const opt =
      [...select.options].find((o) => norm(o.text) === v || norm(o.value) === v) ||
      [...select.options].find((o) => norm(o.text).includes(v));
    if (!opt) throw new Error(`opsi "${value}" tidak ditemukan`);
    select.value = opt.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return "diisi";
  }

  function fillText(el, value) {
    if (el.value === value) return "sudah terisi";
    el.focus();
    setNativeValue(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
    return "diisi";
  }

  async function fillField(field) {
    // Field bisa muncul belakangan (mis. Subcategory baru tampil setelah Category dipilih).
    const label = await waitFor(() => findLabel(field.label), 8000);
    if (!label) throw new Error("label tidak ditemukan");
    const control = await waitFor(() => findControl(label), 3000);
    if (!control) throw new Error("input tidak ditemukan");

    if (control.tagName === "SELECT") return fillNativeSelect(control, field.value);
    if (control.tagName === "INPUT" && isSearchDropdown(control)) return fillSearchDropdown(control, field.value);
    return fillText(control, field.value);
  }

  let running = false;

  async function runAutofill() {
    if (running) return { ok: false, log: ["Sedang berjalan..."] };
    running = true;
    const config = await loadConfig();
    const log = [];
    try {
      for (const field of config.fields) {
        if (!field.label || !field.value) continue;
        try {
          const res = await fillField(field);
          log.push(`✔ ${field.label}: ${res}`);
        } catch (e) {
          log.push(`✘ ${field.label}: ${e.message}`);
        }
        await sleep(400);
      }
    } finally {
      running = false;
    }
    console.info("[Form Auto Fill]\n" + log.join("\n"));
    return { ok: !log.some((l) => l.startsWith("✘")), log };
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "autofill-run") return runAutofill();
    if (msg && msg.type === "autofill-match") {
      return loadConfig().then((c) => ({ match: wildcardToRegex(c.urlPattern).test(location.href) }));
    }
  });

  // Auto-run: halaman SPA bisa ganti URL tanpa reload, jadi pantau perubahan URL.
  let lastUrl = null;
  async function maybeAutoRun() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const config = await loadConfig();
    if (!config.autoRun || !wildcardToRegex(config.urlPattern).test(location.href)) return;
    const first = config.fields.find((f) => f.label && f.value);
    if (!first) return;
    if (await waitFor(() => findLabel(first.label), 15000)) runAutofill();
  }

  if (window.top === window) {
    maybeAutoRun();
    setInterval(maybeAutoRun, 1000);
  }
})();
