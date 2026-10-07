/*
 * KIOSK ANTRIAN DUKCAPIL — aplikasi utama
 * Alur: Beranda → Pilih layanan → Persyaratan → Konfirmasi → Tiket (cetak otomatis) → Beranda
 */
(function () {
  'use strict';

  var CFG = window.KIOSK_CONFIG;
  var Core = window.QueueCore;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var params = new URLSearchParams(location.search);
  var TEST = params.has('test');
  var ZONA = CFG.zonaLabel || '';

  if (window.qrcode && qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  }

  /* ================================================================
     Utilitas
     ================================================================ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function now() { return Core.nowIn(CFG.timezone); }
  function dot(hhmm) { return hhmm.replace(':', '.'); }
  function fmtMin(m) { return Core.pad(Math.floor(m / 60) % 24) + '.' + Core.pad(m % 60); }
  function syaratText(x) { return typeof x === 'string' ? x : x.t; }
  function syaratWajib(x) { return typeof x === 'string' || !x.opsional; }
  function svcById(id) { return CFG.layanan.filter(function (s) { return s.id === id; })[0]; }

  var fmtLongDate = new Intl.DateTimeFormat('id-ID', { timeZone: CFG.timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  function dateLabel(dateStr, opts) {
    var p = dateStr.split('-').map(Number);
    return new Intl.DateTimeFormat('id-ID', Object.assign({ timeZone: 'UTC' }, opts || { day: 'numeric', month: 'long', year: 'numeric' }))
      .format(new Date(Date.UTC(p[0], p[1] - 1, p[2])));
  }

  function terbilang(n) {
    var s = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
    if (n === 0) return 'nol';
    if (n < 12) return s[n];
    if (n < 20) return s[n - 10] + ' belas';
    if (n < 100) return s[Math.floor(n / 10)] + ' puluh' + (n % 10 ? ' ' + s[n % 10] : '');
    if (n < 200) return 'seratus' + (n > 100 ? ' ' + terbilang(n - 100) : '');
    if (n < 1000) return s[Math.floor(n / 100)] + ' ratus' + (n % 100 ? ' ' + terbilang(n % 100) : '');
    return String(n);
  }
  function spokenNo(t) {
    var letters = t.no.split('-')[0];
    return letters.split('').join(' ') + ', ' + terbilang(t.seq);
  }

  /* ---------- Ikon (SVG garis) ---------- */
  var ICONS = {
    idcard: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5.5 16c.6-1.3 1.7-2 3-2s2.4.7 3 2M14 10h4.5M14 13.5h3"/>',
    idcardx: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5.5 16c.6-1.3 1.7-2 3-2s2.4.7 3 2M14.5 9.5l4 4M18.5 9.5l-4 4"/>',
    family: '<circle cx="9" cy="7.5" r="3"/><path d="M3.5 20c0-3.2 2.5-5.8 5.5-5.8s5.5 2.6 5.5 5.8"/><circle cx="17" cy="9" r="2.3"/><path d="M15.6 14.4c.5-.1.9-.2 1.4-.2 2.4 0 4 1.9 4 4.6"/>',
    baby: '<circle cx="12" cy="12.5" r="8.5"/><path d="M9 11h.01M15 11h.01M9.5 15c1.4 1.2 3.6 1.2 5 0M12 4c-1.6 1.2-1.6 2.8 0 4"/>',
    ribbon: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    child: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10.5" r="2.4"/><path d="M5.8 17c.5-1.6 1.7-2.6 3.2-2.6s2.7 1 3.2 2.6M15 9.5h3M15 13h2"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/><rect x="9" y="6" width="6" height="6" rx="1"/>',
    move: '<path d="M4 8h14M14.5 4.5 18 8l-3.5 3.5M20 16H6M9.5 12.5 6 16l3.5 3.5"/>',
    rings: '<circle cx="9" cy="14" r="5"/><circle cx="15" cy="14" r="5"/><path d="M10 4.5 12 7l2-2.5-1-1.5h-2z"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    stamp: '<path d="M9 13V9.5a3 3 0 1 1 6 0V13"/><path d="M5 13h14v4H5zM6 20.5h12"/>',
    chat: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z"/><path d="M10 9.5a2 2 0 1 1 2.7 1.9c-.5.2-.7.6-.7 1.1v.5M12 16h.01"/>',
    gratis: '<path d="M3 12V4h8l9.5 9.5-8 8L3 12Z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
    shield: '<path d="M12 3 5 6v6c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    elder: '<circle cx="11" cy="4.5" r="2"/><path d="M11 8v6l-2 7M11 14l3 3 1 4M8 11l3-3 3 2.5M17 12v9"/>',
    accessible: '<circle cx="12" cy="4.5" r="2"/><path d="M12 8v6h5l2 5M8.5 11a6 6 0 1 0 7 8"/>',
    pregnant: '<circle cx="11" cy="4.5" r="2"/><path d="M10 8c-1 2-1 4 0 5.5M10 8h1.5c1.8 0 3.2 2 3.2 4.3S13.3 16 11 16h-1v5"/>',
    stroller: '<path d="M3 4h2.5l2 9h10.5M12 4a7 7 0 0 1 7 7v2"/><circle cx="9" cy="18.5" r="2"/><circle cx="17" cy="18.5" r="2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    ticket: '<path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4V6Z"/><path d="M14 6v12" stroke-dasharray="2 2.5"/>',
    hand: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.6-2.2L4 15.5a1.5 1.5 0 0 1 2.3-1.9L9 16"/>',
    back: '<path d="M15 5 8 12l7 7"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    printer: '<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7"/>',
    queue: '<circle cx="6" cy="8" r="2.4"/><circle cx="12" cy="8" r="2.4"/><circle cx="18" cy="8" r="2.4"/><path d="M2.5 18c0-2.2 1.6-4 3.5-4s3.5 1.8 3.5 4M8.5 18c0-2.2 1.6-4 3.5-4s3.5 1.8 3.5 4M14.5 18c0-2.2 1.6-4 3.5-4s3.5 1.8 3.5 4"/>',
    pin: '<path d="M12 21s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
    offline: '<path d="m3 3 18 18M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5-2.7M14.8 10.3A10 10 0 0 1 19 12.9M2 9.4a15 15 0 0 1 4.3-2.7M10.7 5.1A15 15 0 0 1 22 9.4M12 20h.01"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    eye: '<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || ICONS.doc) + '</svg>'; }

  /* ---------- QR ---------- */
  function qrSvg(text, ecc) {
    try {
      var q = qrcode(0, ecc || 'M');
      q.addData(text, 'Byte');
      q.make();
      var n = q.getModuleCount(), d = '';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + c + ',' + r + 'h1v1h-1z';
      return '<svg viewBox="-2 -2 ' + (n + 4) + ' ' + (n + 4) + '" shape-rendering="crispEdges" role="img" aria-label="Kode QR">' +
        '<rect x="-2" y="-2" width="' + (n + 4) + '" height="' + (n + 4) + '" fill="#fff" stroke="none"/>' +
        '<path d="' + d + '" fill="#000" stroke="none"/></svg>';
    } catch (e) { return ''; }
  }

  /* ---------- Suara ---------- */
  var audioCtx = null;
  function beep(freq, dur, when) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var t = audioCtx.currentTime + (when || 0);
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* audio tidak tersedia */ }
  }
  function chime() { beep(880, .25); beep(1175, .35, .18); }

  function speak(text) {
    if (!('speechSynthesis' in window)) { toast('Fitur suara tidak tersedia di perangkat ini'); return; }
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'id-ID';
    u.rate = 0.95;
    var v = speechSynthesis.getVoices().filter(function (x) { return /^id/i.test(x.lang); })[0];
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }
  function stopSpeak() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }

  /* ---------- Toast ---------- */
  var toastT = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  /* ================================================================
     Penyimpanan antrian (lokal / server)
     ================================================================ */
  var DEVICE_KEY = 'dukcapil-kiosk.device';
  var device = Object.assign({ paperWidth: CFG.paperWidth || 80 }, readJSON(DEVICE_KEY));
  function saveDevice() { writeJSON(DEVICE_KEY, device); }

  function makeLocalStore(suffix) {
    var QKEY = 'dukcapil-kiosk.queue' + suffix, SKEY = 'dukcapil-kiosk.settings' + suffix;
    function read() { return Core.ensureDay(readJSON(QKEY), now().date); }
    function settings() { return Object.assign({ disabled: {}, ignoreSchedule: false }, readJSON(SKEY)); }
    return {
      name: suffix ? 'uji' : 'lokal',
      state: function () {
        var st = read();
        writeJSON(QKEY, st);
        return Promise.resolve(Object.assign(Core.publicState(st), { settings: settings() }));
      },
      issue: function (req) {
        var st = read(), set = settings(), n = now();
        var sc = Core.schedule(CFG, n, TEST || set.ignoreSchedule);
        if (!sc.open) return Promise.resolve({ ok: false, reason: 'closed' });
        var r = Core.issue(st, CFG.layanan, set, req, n.hhmm);
        if (r.ok && !writeJSON(QKEY, st)) return Promise.reject(new Error('Penyimpanan browser penuh / diblokir'));
        return Promise.resolve(r);
      },
      help: function (info) {
        var st = read();
        Core.addHelp(st, info);
        writeJSON(QKEY, st);
        return Promise.resolve({ ok: true });
      },
      saveSettings: function (pin, patch) {
        writeJSON(SKEY, Object.assign(settings(), patch));
        return Promise.resolve({ ok: true });
      },
      reset: function () {
        try { localStorage.removeItem(QKEY); } catch (e) { /* abaikan */ }
        return Promise.resolve({ ok: true });
      },
    };
  }

  var ServerStore = {
    name: 'server',
    req: function (path, opts) {
      opts = opts || {};
      var ctl = new AbortController();
      var t = setTimeout(function () { ctl.abort(); }, 6000);
      return fetch(CFG.apiBase + path, {
        method: opts.method || 'GET',
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: ctl.signal,
      }).then(function (r) {
        if (r.status >= 500) throw new Error('HTTP ' + r.status);
        return r.json();
      }).finally(function () { clearTimeout(t); });
    },
    state: function () { return this.req('/state'); },
    issue: function (req) { return this.req('/tickets', { method: 'POST', body: Object.assign({ kioskId: CFG.kioskId }, req) }); },
    help: function (info) { return this.req('/help', { method: 'POST', body: info }); },
    saveSettings: function (pin, patch) { return this.req('/admin/settings', { method: 'POST', body: Object.assign({ pin: pin }, patch) }); },
    reset: function (pin) { return this.req('/admin/reset', { method: 'POST', body: { pin: pin } }); },
  };

  var store = null;
  var Q = null;           // salinan status antrian terakhir
  var online = true;

  function detectStore() {
    if (TEST) return Promise.resolve(makeLocalStore('.uji'));
    if (CFG.mode === 'local' || location.protocol === 'file:') return Promise.resolve(makeLocalStore(''));
    return ServerStore.state().then(function (s) {
      if (s && s.date) return ServerStore;
      throw new Error('bukan server antrian');
    }).catch(function () {
      return CFG.mode === 'server' ? ServerStore : makeLocalStore('');
    });
  }

  function refreshState() {
    return store.state().then(function (s) {
      Q = s; online = true; paintStatus();
    }).catch(function () {
      online = false; paintStatus();
    });
  }

  function emptyQ() { return { date: now().date, svc: {}, log: [], help: [], settings: { disabled: {}, ignoreSchedule: false } }; }
  function q() { return Q || emptyQ(); }
  function schedule() { return Core.schedule(CFG, now(), TEST || q().settings.ignoreSchedule); }
  function systemDown() { return store === ServerStore && !online; }

  function svcStats(svc) {
    var c = q().svc[svc.id] || { n: 0, p: 0, cn: 0, cp: 0 };
    var issued = c.n + c.p;
    var waiting = Core.waiting(c);
    return {
      issued: issued, waiting: waiting,
      remaining: Math.max(0, svc.kuota - issued),
      full: issued >= svc.kuota,
      disabled: !!q().settings.disabled[svc.id],
      est: estimate(svc, waiting),
    };
  }

  function estimate(svc, ahead) {
    var mins = Math.ceil((ahead * svc.menit) / Math.max(1, svc.loketAktif || 1));
    var n = now(), sc = schedule();
    var start = sc.today ? Math.max(n.min, Core.toMin(sc.today.buka)) : n.min;
    var at = start + mins;
    var close = sc.today ? Core.toMin(sc.today.tutup) : null;
    return { mins: mins, at: at, atText: fmtMin(at), over: close != null && at > close };
  }

  function durText(mins) {
    if (mins < 1) return 'Segera';
    if (mins < 60) return '± ' + mins + ' menit';
    return '± ' + Math.floor(mins / 60) + ' jam ' + (mins % 60 ? (mins % 60) + ' mnt' : '');
  }

  /* ================================================================
     Status aplikasi & navigasi
     ================================================================ */
  var S = {
    screen: 'home', svc: null, checked: {}, prioritas: false, kategori: null,
    nik: '', ticket: null, reprints: 0, busy: false, speech: '',
  };
  var screenEl = $('#screen');

  var SCREENS = {};
  var AFTER = {};

  function render(anim) {
    var keep = screenEl.scrollTop;
    var html = SCREENS[S.screen]();
    if (anim !== false) {
      screenEl.classList.remove('enter');
      void screenEl.offsetWidth;
      screenEl.classList.add('enter');
    }
    screenEl.innerHTML = html;
    if (anim === false) screenEl.scrollTop = keep;
    renderStepper();
    if (AFTER[S.screen]) AFTER[S.screen]();
  }
  function update() { render(false); }

  function go(screen) {
    stopSpeak();
    S.screen = screen;
    render(true);
    screenEl.scrollTop = 0;
    resetIdle();
  }

  function goHome() {
    clearInterval(ticketTimer);
    closeModal();
    stopSpeak();
    S.svc = null; S.checked = {}; S.prioritas = false; S.kategori = null;
    S.nik = ''; S.ticket = null; S.reprints = 0; S.busy = false;
    // Pengaturan aksesibilitas tidak terbawa ke pengunjung berikutnya.
    setA11y('large', false);
    setA11y('contrast', false);
    go('home');
    refreshState().then(function () { if (S.screen === 'home') update(); });
  }

  var STEPS = [['services', 'Pilih layanan'], ['req', 'Persyaratan'], ['confirm', 'Konfirmasi'], ['ticket', 'Cetak tiket']];
  function renderStepper() {
    var el = $('#stepper');
    var idx = -1;
    STEPS.forEach(function (s, i) { if (s[0] === S.screen) idx = i; });
    el.hidden = idx < 0;
    if (idx < 0) return;
    el.innerHTML = STEPS.map(function (s, i) {
      var cls = i < idx ? 'done' : i === idx ? 'active' : '';
      return (i ? '<span class="step-line ' + (i <= idx ? 'done' : '') + '"></span>' : '') +
        '<span class="step ' + cls + '"' + (i === idx ? ' aria-current="step"' : '') + '>' +
        '<span class="step-dot">' + (i < idx ? icon('check') : i + 1) + '</span><span class="lbl">' + s[1] + '</span></span>';
    }).join('');
  }

  /* ================================================================
     Layar 0 — Beranda
     ================================================================ */
  SCREENS.home = function () {
    var sc = schedule(), down = systemDown();
    var tot = { issued: 0, waiting: 0, remaining: 0 };
    var rows = CFG.layanan.map(function (svc) {
      var st = svcStats(svc);
      tot.issued += st.issued; tot.waiting += st.waiting; tot.remaining += st.disabled ? 0 : st.remaining;
      var pct = Math.min(100, Math.round(st.issued / svc.kuota * 100));
      var cls = st.full ? 'full' : pct >= 80 ? 'hot' : '';
      return '<div class="quota-row"><span>' + esc(svc.nama) + '</span><em>' +
        (st.disabled ? 'Tutup' : st.full ? 'Habis' : 'Sisa ' + st.remaining) + '</em>' +
        '<div class="bar"><i class="' + cls + '" style="width:' + (st.disabled ? 0 : pct) + '%"></i></div></div>';
    }).join('');

    var cta;
    if (down) {
      cta = '<button class="hero-cta" disabled>' + '<span class="cta-icon">' + icon('offline') + '</span>Sistem antrian terputus — hubungi petugas</button>';
    } else if (sc.open) {
      cta = '<button class="hero-cta" data-action="start"><span class="cta-icon">' + icon('hand') + '</span>Sentuh untuk ambil antrian</button>';
    } else {
      cta = '<button class="hero-cta" disabled><span class="cta-icon">' + icon('moon') + '</span>' + esc(sc.reason) + '</button>';
    }

    var chips = '<span class="chip chip-gold">' + icon('gratis') + 'Semua layanan GRATIS</span>';
    if (sc.today) chips += '<span class="chip">' + icon('clock') + 'Layanan ' + dot(sc.today.buka) + '–' + dot(sc.today.tutup) + ' ' + ZONA + '</span>';
    if (sc.realOpen) chips += '<span class="chip">' + icon('ticket') + 'Tiket ditutup ' + dot(sc.today.tutupTiket) + ' ' + ZONA + '</span>';
    else if (sc.next) chips += '<span class="chip">' + icon('calendar') + 'Buka: ' + nextLabel(sc.next) + ', ' + dot(sc.next.plan.buka) + ' ' + ZONA + '</span>';
    if (sc.today && sc.today.catatan) chips += '<span class="chip">' + icon('info') + esc(sc.today.catatan) + '</span>';

    var news = (CFG.pengumuman || []).map(esc).join(' &nbsp;•&nbsp; ');

    S.speech = 'Selamat datang di ' + CFG.instansi.nama + ' ' + CFG.instansi.wilayah + '. ' +
      (sc.open && !down ? 'Sentuh tombol putih besar untuk mengambil nomor antrian. ' : sc.reason + '. ') +
      'Semua layanan administrasi kependudukan gratis.';

    return '<div class="home">' +
      '<section class="hero">' +
        '<span class="hero-kicker">Layanan Administrasi Kependudukan</span>' +
        '<h1>Selamat datang 👋<br>Ambil nomor antrian di sini</h1>' +
        '<p>Tiga langkah mudah: pilih layanan, cek kelengkapan dokumen, lalu tiket tercetak otomatis.</p>' +
        cta +
        '<div class="hero-chips">' + chips + '</div>' +
      '</section>' +
      '<aside class="side">' +
        '<div class="card"><h2>' + icon('queue') + 'Antrian hari ini<small>' + esc(dateLabel(q().date)) + '</small></h2>' +
          '<div class="stats">' +
            '<div class="stat"><b>' + tot.issued + '</b><span>Tiket terbit</span></div>' +
            '<div class="stat"><b>' + tot.waiting + '</b><span>Menunggu</span></div>' +
            '<div class="stat"><b>' + tot.remaining + '</b><span>Sisa kuota</span></div>' +
          '</div></div>' +
        '<div class="card"><h2>' + icon('ticket') + 'Sisa kuota per layanan</h2><div class="quota-list">' + rows + '</div></div>' +
        (news ? '<div class="ticker"><span class="ticker-label">INFO</span><div class="ticker-track"><div class="ticker-move"><span>' + news + '</span><span aria-hidden="true">' + news + '</span></div></div></div>' : '') +
      '</aside>' +
    '</div>';
  };

  function nextLabel(nx) {
    if (nx.inDays === 0) return 'Hari ini';
    if (nx.inDays === 1) return 'Besok';
    return dateLabel(nx.date, { weekday: 'long', day: 'numeric', month: 'long' });
  }

  /* ================================================================
     Layar 1 — Pilih layanan
     ================================================================ */
  SCREENS.services = function () {
    var cards = CFG.layanan.map(function (svc) {
      var st = svcStats(svc);
      var unavailable = st.disabled || st.full;
      var meta;
      if (st.disabled) meta = '<span class="tag tag-danger">' + icon('lock') + 'Tidak tersedia hari ini</span>';
      else if (st.full) meta = '<span class="tag tag-danger">' + icon('alert') + 'Kuota hari ini habis</span>';
      else {
        meta = '<span class="tag">' + icon('queue') + st.waiting + ' menunggu</span>' +
          '<span class="tag">' + icon('clock') + durText(st.est.mins) + '</span>' +
          '<span class="tag ' + (st.remaining <= 10 ? 'tag-warn' : 'tag-ok') + '">Sisa ' + st.remaining + '</span>';
        if (st.est.over) meta += '<span class="tag tag-warn">' + icon('alert') + 'Mungkin melewati jam layanan</span>';
      }
      return '<button class="svc" data-action="pick" data-id="' + esc(svc.id) + '"' + (unavailable ? ' disabled' : '') + ' style="--c:' + esc(svc.warna) + '">' +
        '<span class="svc-letter">' + esc(svc.prefix) + '</span>' +
        '<span class="svc-icon">' + icon(svc.icon) + '</span>' +
        '<span class="svc-name">' + esc(svc.nama) + '</span>' +
        '<span class="svc-desc">' + esc(svc.desc) + '</span>' +
        '<span class="svc-meta">' + meta + '</span>' +
      '</button>';
    }).join('');

    S.speech = 'Pilih layanan yang Anda butuhkan. Pilihan: ' + CFG.layanan.map(function (s) { return s.nama; }).join(', ') + '.';

    return '<div>' +
      '<div class="screen-head">' +
        '<button class="back-btn" data-action="home" aria-label="Kembali ke beranda">' + icon('back') + '</button>' +
        '<div class="grow"><h1>Pilih Layanan</h1><p>Sentuh layanan yang ingin Anda urus hari ini.</p></div>' +
      '</div>' +
      '<div class="svc-grid">' + cards + '</div>' +
    '</div>';
  };

  /* ================================================================
     Layar 2 — Persyaratan & ketentuan
     ================================================================ */
  function requiredIdx(svc) {
    var out = [];
    svc.syarat.forEach(function (x, i) { if (syaratWajib(x)) out.push(i); });
    return out;
  }

  SCREENS.req = function () {
    var svc = S.svc, st = svcStats(svc);
    var req = requiredIdx(svc);
    var done = req.filter(function (i) { return S.checked[i]; }).length;
    var all = done === req.length;

    var list = svc.syarat.map(function (x, i) {
      var on = !!S.checked[i];
      return '<button class="check" role="checkbox" aria-checked="' + on + '" data-action="check" data-i="' + i + '">' +
        '<span class="check-box">' + icon('check') + '</span>' +
        '<span>' + esc(syaratText(x)) + (syaratWajib(x) ? '' : ' <span class="tag">Bila berlaku</span>') + '</span>' +
      '</button>';
    }).join('');

    var rules = (CFG.ketentuanUmum || []).map(function (r, i) {
      return '<div class="rule' + (i === 0 ? ' gold' : '') + '"><span class="rule-ic">' + icon(r.icon) + '</span><div><b>' + esc(r.judul) + '</b><span>' + esc(r.isi) + '</span></div></div>';
    }).join('');

    S.speech = 'Persyaratan ' + svc.nama + '. Dokumen yang perlu dibawa: ' +
      svc.syarat.map(syaratText).join('. ') + '. Sentuh setiap dokumen yang sudah Anda bawa, lalu tekan Lanjut.';

    return '<div>' +
      '<div class="screen-head">' +
        '<button class="back-btn" data-action="back" data-to="services" aria-label="Kembali">' + icon('back') + '</button>' +
        '<div class="grow"><h1>Cek Persyaratan</h1><p>Pastikan dokumen lengkap agar layanan tidak tertunda.</p></div>' +
      '</div>' +
      '<div class="req-layout">' +
        '<div style="display:grid;gap:1rem">' +
          '<div class="card">' +
            '<div class="svc-summary" style="--c:' + esc(svc.warna) + '"><span class="svc-icon">' + icon(svc.icon) + '</span>' +
              '<div><h2>' + esc(svc.nama) + '</h2><p>' + esc(svc.desc) + '</p></div></div>' +
            '<div class="facts">' +
              '<div class="fact"><span>Tujuan</span><b>' + esc(svc.loket) + '</b></div>' +
              '<div class="fact"><span>Lama layanan</span><b>± ' + svc.menit + ' menit</b></div>' +
              '<div class="fact"><span>Sedang menunggu</span><b>' + st.waiting + ' orang</b></div>' +
              '<div class="fact"><span>Perkiraan tunggu</span><b>' + durText(st.est.mins) + '</b></div>' +
            '</div>' +
            (svc.catatan ? '<div class="note info">' + icon('info') + '<span>' + esc(svc.catatan) + '</span></div>' : '') +
            (st.est.over ? '<div class="note">' + icon('alert') + '<span>Antrian sudah panjang. Perkiraan giliran Anda (± ' + st.est.atText + ' ' + ZONA + ') melewati jam layanan — ada kemungkinan tidak terlayani hari ini.</span></div>' : '') +
          '</div>' +
          '<div class="card"><h2>' + icon('shield') + 'Ketentuan penting</h2><div class="rules">' + rules + '</div></div>' +
        '</div>' +
        '<div class="card">' +
          '<h2>' + icon('doc') + 'Centang dokumen yang Anda bawa</h2>' +
          '<div class="progress-line"><span>' + done + ' dari ' + req.length + ' wajib</span><div class="bar"><i style="width:' + (req.length ? done / req.length * 100 : 100) + '%"></i></div></div>' +
          '<div class="checklist">' + list + '</div>' +
          '<div class="note info">' + icon('qr') + '<span>Dokumen belum lengkap? Tekan <b>“Belum lengkap”</b> untuk menyimpan daftar syarat ke ponsel Anda lewat kode QR.</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="action-bar">' +
        '<button class="btn btn-ghost" data-action="incomplete">' + icon('alert') + 'Belum lengkap</button>' +
        '<button class="btn btn-primary" data-action="to-confirm"' + (all ? '' : ' disabled') + '>' + (all ? 'Dokumen lengkap, lanjut' : 'Centang semua dokumen wajib') + icon('arrow') + '</button>' +
      '</div>' +
    '</div>';
  };

  function showIncomplete() {
    var svc = S.svc;
    var text = 'SYARAT ' + svc.nama.toUpperCase() + '\n' + CFG.instansi.nama + ' ' + CFG.instansi.wilayah + '\n\n' +
      svc.syarat.map(function (x, i) { return (i + 1) + '. ' + syaratText(x); }).join('\n') +
      (svc.catatan ? '\n\nCatatan: ' + svc.catatan : '') +
      '\n\nTujuan: ' + svc.loket + '\nSemua layanan GRATIS.';
    var konsul = CFG.layanan.filter(function (s) { return s.id === 'konsultasi'; })[0];
    openModal(
      '<div class="modal-icon warn">' + icon('doc') + '</div>' +
      '<h2>Lengkapi dokumen dulu, ya</h2>' +
      '<p>Supaya waktu Anda tidak terbuang di loket, siapkan dokumen berikut. Pindai QR dengan kamera ponsel untuk menyimpan daftarnya.</p>' +
      '<div class="qr-box">' + qrSvg(text, 'L') + '<ul>' + svc.syarat.map(function (x) { return '<li>' + esc(syaratText(x)) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="modal-actions">' +
        (konsul && svc.id !== konsul.id && !svcStats(konsul).full ? '<button class="btn btn-ghost" data-action="to-konsultasi">' + icon('chat') + 'Tanya petugas dulu</button>' : '') +
        '<button class="btn btn-primary" data-action="home">' + icon('home') + 'Selesai</button>' +
      '</div>'
    );
    S.speech = 'Silakan lengkapi dokumen terlebih dahulu. Pindai kode QR untuk menyimpan daftar syarat.';
  }

  /* ================================================================
     Layar 3 — Konfirmasi (kategori, NIK opsional)
     ================================================================ */
  var PROV = (function () {
    var set = {};
    [[11, 19], [21, 21], [31, 36], [51, 53], [61, 65], [71, 76], [81, 82], [91, 97]].forEach(function (r) {
      for (var i = r[0]; i <= r[1]; i++) set[i] = true;
    });
    return set;
  }());

  function checkNik(n) {
    if (!n) return { state: 'empty', msg: 'Boleh dilewati. Isi untuk mencegah antrian ganda.' };
    if (n.length < 16) return { state: 'partial', msg: 'Kurang ' + (16 - n.length) + ' digit lagi, atau hapus untuk melewati.' };
    var prov = +n.slice(0, 2), dd = +n.slice(6, 8), mm = +n.slice(8, 10);
    var day = dd > 40 ? dd - 40 : dd;
    if (!PROV[prov]) return { state: 'error', msg: 'Kode provinsi (2 digit awal) tidak dikenal. Periksa kembali.' };
    if (day < 1 || day > 31) return { state: 'error', msg: 'Digit ke-7–8 (tanggal lahir) tidak valid. Periksa kembali.' };
    if (mm < 1 || mm > 12) return { state: 'error', msg: 'Digit ke-9–10 (bulan lahir) tidak valid. Periksa kembali.' };
    if (n.slice(12) === '0000') return { state: 'error', msg: 'Nomor urut NIK tidak valid. Periksa kembali.' };
    return { state: 'valid', msg: 'Format NIK sesuai.' };
  }
  function groupNik(n) { return n.replace(/(\d{4})(?=\d)/g, '$1 '); }
  function maskNik(n) { return n.slice(0, 4) + ' •••• •••• ' + n.slice(12); }

  function confirmState() {
    var nk = S.svc.mintaNik ? checkNik(S.nik) : { state: 'empty' };
    var nikOk = nk.state === 'empty' || nk.state === 'valid';
    var catOk = !S.prioritas || !!S.kategori;
    return { nk: nk, ok: nikOk && catOk, catOk: catOk, nikOk: nikOk };
  }

  SCREENS.confirm = function () {
    var svc = S.svc, st = svcStats(svc), cs = confirmState();
    var c = q().svc[svc.id] || { n: 0, p: 0, cn: 0, cp: 0 };
    var ahead = S.prioritas ? Math.max(0, c.p - c.cp) : st.waiting;
    var est = estimate(svc, ahead);
    var kat = CFG.kategoriPrioritas.filter(function (k) { return k.id === S.kategori; })[0];

    var prio = CFG.kategoriPrioritas.map(function (k) {
      return '<button class="opt" data-action="kategori" data-id="' + k.id + '" aria-pressed="' + (S.kategori === k.id) + '">' + icon(k.icon) + esc(k.label) + '</button>';
    }).join('');

    var nikCard = '';
    if (svc.mintaNik) {
      var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clr', '0', 'del'].map(function (k) {
        if (k === 'clr') return '<button class="fn" data-action="key" data-k="clr">Hapus semua</button>';
        if (k === 'del') return '<button class="fn" data-action="key" data-k="del" aria-label="Hapus satu digit">⌫</button>';
        return '<button data-action="key" data-k="' + k + '">' + k + '</button>';
      }).join('');
      var cls = cs.nk.state === 'error' ? ' error' : cs.nk.state === 'valid' ? ' valid' : '';
      nikCard = '<div class="card"><h2>' + icon('idcard') + 'NIK <small>Opsional</small></h2>' +
        '<div class="nik-display' + cls + '">' + (S.nik ? '<span>' + groupNik(S.nik) + '</span>' : '<span class="ph">Ketik 16 digit NIK Anda</span>') +
          '<span class="nik-count">' + S.nik.length + '/16</span></div>' +
        '<div class="nik-msg' + (cs.nk.state === 'error' ? ' error' : cs.nk.state === 'valid' ? ' ok' : '') + '">' + esc(cs.nk.msg) + '</div>' +
        '<div class="numpad">' + keys + '</div>' +
        '<div class="privacy">' + icon('lock') + '<span>NIK hanya dipakai untuk mencegah satu orang mengambil antrian ganda pada layanan yang sama hari ini. NIK disimpan dalam bentuk sandi (hash) dan dicetak tersamar di tiket.</span></div>' +
      '</div>';
    }

    S.speech = 'Konfirmasi. Layanan ' + svc.nama + ', tujuan ' + svc.loket + '. Pilih kategori Umum atau Prioritas. ' +
      (svc.mintaNik ? 'Anda boleh mengisi NIK atau melewatinya. ' : '') + 'Tekan Cetak Tiket untuk mencetak nomor antrian.';

    return '<div>' +
      '<div class="screen-head">' +
        '<button class="back-btn" data-action="back" data-to="req" aria-label="Kembali">' + icon('back') + '</button>' +
        '<div class="grow"><h1>Konfirmasi &amp; Cetak</h1><p>Periksa kembali sebelum tiket dicetak.</p></div>' +
      '</div>' +
      '<div class="confirm-layout">' +
        '<div style="display:grid;gap:1rem">' +
          '<div class="card"><h2>' + icon('user') + 'Kategori pengunjung</h2>' +
            '<div class="seg">' +
              '<button class="opt" data-action="cat" data-v="umum" aria-pressed="' + !S.prioritas + '">' + icon('user') + 'Umum</button>' +
              '<button class="opt" data-action="cat" data-v="prioritas" aria-pressed="' + S.prioritas + '">' + icon('accessible') + 'Prioritas</button>' +
            '</div>' +
            '<div class="prio-grid"' + (S.prioritas ? '' : ' hidden') + '>' + prio + '</div>' +
            (S.prioritas ? '<div class="note info">' + icon('info') + '<span>Antrian prioritas didahulukan. Petugas dapat meminta bukti (mis. KTP-el untuk lansia).</span></div>' : '') +
          '</div>' +
          nikCard +
        '</div>' +
        '<div class="card"><h2>' + icon('ticket') + 'Ringkasan tiket</h2>' +
          '<div class="summary-list">' +
            '<div class="summary-row"><span>Layanan</span><b>' + esc(svc.nama) + '</b></div>' +
            '<div class="summary-row"><span>Tujuan</span><b>' + esc(svc.loket) + '</b></div>' +
            '<div class="summary-row"><span>Kategori</span><b>' + (S.prioritas ? 'Prioritas' + (kat ? ' · ' + esc(kat.label) : ' (pilih jenis)') : 'Umum') + '</b></div>' +
            (svc.mintaNik ? '<div class="summary-row"><span>NIK</span><b>' + (cs.nk.state === 'valid' ? maskNik(S.nik) : 'Tidak diisi') + '</b></div>' : '') +
            '<div class="summary-row"><span>Antrian di depan Anda</span><b>' + ahead + ' orang</b></div>' +
            '<div class="summary-row"><span>Perkiraan dipanggil</span><b>± ' + est.atText + ' ' + ZONA + '</b></div>' +
          '</div>' +
          (est.over ? '<div class="note">' + icon('alert') + '<span>Perkiraan giliran Anda melewati jam layanan hari ini. Anda tetap boleh mengambil tiket, namun ada kemungkinan tidak terlayani hari ini.</span></div>' : '') +
          '<div class="note info">' + icon('printer') + '<span>Tiket akan tercetak otomatis. Ambil tiket di slot printer di bawah layar.</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="action-bar">' +
        '<span class="hint">' + (!cs.catOk ? 'Pilih jenis prioritas terlebih dahulu' : !cs.nikOk ? 'Lengkapi NIK atau hapus untuk melewati' : '') + '</span>' +
        '<button class="btn btn-ghost" data-action="back" data-to="services">' + icon('edit') + 'Ganti layanan</button>' +
        '<button class="btn btn-primary" data-action="print"' + (cs.ok && !S.busy ? '' : ' disabled') + '>' +
          (S.busy ? '<span class="spinner"></span>Memproses…' : icon('printer') + 'Cetak tiket') + '</button>' +
      '</div>' +
    '</div>';
  };

  function doIssue() {
    if (S.busy) return;
    var cs = confirmState();
    if (!cs.ok) return;
    S.busy = true;
    update();
    var svc = S.svc;
    var nikHash = cs.nk.state === 'valid' ? Core.sha256('dukcapil|' + now().date + '|' + S.nik) : null;
    var nikMasked = cs.nk.state === 'valid' ? maskNik(S.nik) : null;

    store.issue({ serviceId: svc.id, priority: S.prioritas, kategori: S.kategori, nikHash: nikHash })
      .then(function (r) {
        S.busy = false;
        if (r && r.ok) {
          var kat = CFG.kategoriPrioritas.filter(function (k) { return k.id === r.ticket.kategori; })[0];
          S.ticket = Object.assign({}, r.ticket, {
            svc: svc, nikMasked: nikMasked, kategoriLabel: kat ? kat.label : null,
            est: estimate(svc, r.ticket.ahead), test: TEST,
          });
          S.nik = '';           // jangan simpan NIK lebih lama dari perlu
          S.reprints = 0;
          go('ticket');
          refreshState();
          return;
        }
        update();
        issueError(r || {});
      })
      .catch(function () {
        S.busy = false;
        online = store !== ServerStore;
        paintStatus();
        update();
        openModal(
          '<div class="modal-icon danger">' + icon('offline') + '</div><h2>Tiket gagal dicetak</h2>' +
          '<p>Kiosk tidak dapat terhubung ke sistem antrian. Tidak ada nomor yang terpakai. Silakan coba lagi atau hubungi petugas.</p>' +
          '<div class="modal-actions"><button class="btn btn-ghost" data-action="help">' + icon('bell') + 'Panggil petugas</button>' +
          '<button class="btn btn-primary" data-action="modal-close">Coba lagi</button></div>');
      });
  }

  function issueError(r) {
    var map = {
      quota: ['Kuota habis', 'Mohon maaf, kuota layanan ini untuk hari ini baru saja habis. Silakan kembali pada hari kerja berikutnya.', 'alert'],
      duplicate: ['Anda sudah punya antrian', 'NIK ini sudah mengambil nomor <b>' + esc(r.no) + '</b> untuk layanan yang sama hari ini. Satu NIK hanya dapat mengambil satu antrian per layanan per hari. Bila tiket hilang, hubungi petugas informasi.', 'idcard'],
      disabled: ['Layanan tidak tersedia', 'Layanan ini sedang tidak dibuka hari ini. Silakan tanyakan ke petugas informasi.', 'lock'],
      closed: ['Pengambilan tiket ditutup', 'Waktu pengambilan tiket untuk hari ini sudah berakhir.', 'moon'],
    };
    var m = map[r.reason] || ['Tiket gagal dicetak', 'Terjadi kendala. Silakan coba lagi atau hubungi petugas.', 'alert'];
    var homeOnly = r.reason === 'quota' || r.reason === 'closed' || r.reason === 'disabled';
    openModal(
      '<div class="modal-icon warn">' + icon(m[2]) + '</div><h2>' + m[0] + '</h2><p>' + m[1] + '</p>' +
      '<div class="modal-actions">' +
        (homeOnly ? '' : '<button class="btn btn-ghost" data-action="modal-close">Tutup</button>') +
        '<button class="btn btn-primary" data-action="home">' + icon('home') + 'Ke beranda</button></div>');
    S.speech = m[0] + '. ' + m[1].replace(/<[^>]+>/g, '');
    if (homeOnly) refreshState();
  }

  /* ================================================================
     Layar 4 — Tiket
     ================================================================ */
  function ticketHTML(t, reprint) {
    var svc = t.svc;
    var qrText = CFG.instansi.statusUrl
      ? CFG.instansi.statusUrl + (CFG.instansi.statusUrl.indexOf('?') >= 0 ? '&' : '?') + 'no=' + encodeURIComponent(t.no) + '&d=' + t.date + '&v=' + t.code
      : 'DUKCAPIL|' + t.no + '|' + t.date + '|' + t.time + '|' + t.code;
    return '<div class="t">' +
      (t.test ? '<div class="t-test">TIKET UJI — TIDAK BERLAKU</div>' : '') +
      '<div class="t-head">' + esc(CFG.instansi.nama.toUpperCase()) + '</div>' +
      '<div class="t-sub">' + esc(CFG.instansi.wilayah) + '</div>' +
      '<hr class="t-rule">' +
      '<div class="t-label">NOMOR ANTRIAN</div>' +
      '<div class="t-no">' + esc(t.no) + '</div>' +
      '<div class="t-svc">' + esc(svc.nama) + '</div>' +
      '<div class="t-loket">Menuju: ' + esc(svc.loket) + '</div>' +
      (t.priority ? '<div class="t-prio">PRIORITAS' + (t.kategoriLabel ? ' · ' + esc(t.kategoriLabel.toUpperCase()) : '') + '</div>' : '') +
      '<hr class="t-rule">' +
      '<div class="t-grid">' +
        '<span>Tanggal</span><b>' + esc(dateLabel(t.date, { day: 'numeric', month: 'short', year: 'numeric' })) + '</b>' +
        '<span>Jam ambil</span><b>' + dot(t.time) + ' ' + ZONA + '</b>' +
        '<span>Antrian di depan</span><b>' + t.ahead + ' orang</b>' +
        '<span>Perkiraan dipanggil</span><b>± ' + t.est.atText + ' ' + ZONA + '</b>' +
        (t.nikMasked ? '<span>NIK</span><b>' + esc(t.nikMasked) + '</b>' : '') +
        '<span>Kode verifikasi</span><b>' + esc(t.code) + '</b>' +
      '</div>' +
      '<hr class="t-rule">' +
      '<div class="t-qr">' + qrSvg(qrText, 'M') + '<p>' +
        (CFG.instansi.statusUrl ? 'Pindai untuk memantau antrian dari ponsel. ' : 'Tunjukkan tiket ini kepada petugas loket. ') +
        'Tiket hanya berlaku pada tanggal tercetak. Bila nomor terlewat 3× panggilan, ambil tiket baru.</p></div>' +
      '<hr class="t-rule">' +
      '<div class="t-foot">LAYANAN GRATIS — TIDAK DIPUNGUT BIAYA<br>Tolak &amp; laporkan pungli / calo kepada petugas.</div>' +
      '<div class="t-sub" style="margin-top:.4rem">' + esc(t.kiosk || CFG.kioskId) + (reprint ? ' · CETAK ULANG' : '') + '</div>' +
    '</div>';
  }

  SCREENS.ticket = function () {
    var t = S.ticket, svc = t.svc;
    var left = CFG.maxReprint - S.reprints;
    S.speech = 'Nomor antrian Anda: ' + spokenNo(t) + '. Layanan ' + svc.nama + '. Silakan menunggu panggilan menuju ' + svc.loket +
      '. Perkiraan dipanggil pukul ' + t.est.atText.replace('.', ' lewat ') + '.';
    return '<div class="ticket-layout">' +
      '<div class="ticket-stage">' +
        '<div class="printer-slot"></div>' +
        '<div class="ticket-wrap"><div class="ticket-paper">' + ticketHTML(t) + '</div></div>' +
      '</div>' +
      '<div class="ticket-info">' +
        '<span class="pill">Tiket berhasil dibuat</span>' +
        '<h1>Silakan ambil tiket Anda</h1>' +
        '<p>Nomor <b>' + esc(t.no) + '</b> sedang dicetak di slot printer bawah layar.</p>' +
        '<ol class="steps-next">' +
          '<li>Simpan tiket dan duduk di ruang tunggu</li>' +
          '<li>Perhatikan layar & suara panggilan nomor ' + esc(t.no) + '</li>' +
          '<li>Saat dipanggil, menuju ' + esc(svc.loket) + ' dengan dokumen asli</li>' +
        '</ol>' +
        '<div class="countdown">' +
          '<div class="ring"><svg viewBox="0 0 40 40"><circle class="track" cx="20" cy="20" r="17"/><circle class="val" id="ring-val" cx="20" cy="20" r="17" stroke-dasharray="106.8" stroke-dashoffset="0"/></svg><b id="ring-num">' + CFG.timeouts.ticketSeconds + '</b></div>' +
          '<p>Layar kembali ke beranda secara otomatis.<br>Tiket tidak keluar? Tekan <b>Cetak ulang</b>.</p>' +
        '</div>' +
        '<div class="ticket-actions">' +
          '<button class="btn btn-ghost" data-action="reprint"' + (left > 0 ? '' : ' disabled') + '>' + icon('printer') + 'Cetak ulang' + (left > 0 ? ' (' + left + '×)' : '') + '</button>' +
          '<button class="btn btn-primary" data-action="home">' + icon('check') + 'Selesai</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  };

  AFTER.ticket = function () {
    chime();
    setTimeout(function () {
      if (S.screen !== 'ticket') return;
      printTicket(S.ticket, false);
      startTicketCountdown();
      if (CFG.autoSpeakTicket) speak(S.speech);
    }, 450);
  };

  // Ukur tinggi tiket agar panjang kertas thermal pas (tanpa kertas kosong panjang).
  function printTicket(t, reprint) {
    var pa = $('#print-area');
    var w = device.paperWidth || 80;
    pa.innerHTML = ticketHTML(t, reprint);
    document.documentElement.style.setProperty('--paper', w + 'mm');
    pa.style.cssText = 'display:block;position:fixed;left:-9999px;top:0;width:' + w + 'mm;padding:3mm 4mm 8mm;box-sizing:border-box';
    var hmm = Math.ceil(pa.getBoundingClientRect().height / 3.7795) + 4;
    pa.style.cssText = '';
    $('#page-size').textContent = '@page { size: ' + w + 'mm ' + hmm + 'mm; margin: 0; }';
    try { window.print(); } catch (e) { /* printer tidak tersedia */ }
  }

  var ticketTimer = null;
  function startTicketCountdown() {
    clearInterval(ticketTimer);
    var total = CFG.timeouts.ticketSeconds, left = total;
    function paint() {
      var n = $('#ring-num'), v = $('#ring-val');
      if (n) n.textContent = left;
      if (v) v.style.strokeDashoffset = String(106.8 * (1 - left / total));
    }
    paint();
    ticketTimer = setInterval(function () {
      left--;
      if (left <= 0) { clearInterval(ticketTimer); goHome(); return; }
      paint();
    }, 1000);
  }

  /* ================================================================
     Modal
     ================================================================ */
  var modalTimer = null;
  function openModal(html, opts) {
    opts = opts || {};
    clearInterval(modalTimer);
    $('#modal-root').innerHTML = '<div class="modal-back" data-backdrop="' + (opts.sticky ? '0' : '1') + '">' +
      '<div class="modal' + (opts.wide ? ' modal-wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div></div>';
    resetIdle();
  }
  function closeModal() {
    clearInterval(modalTimer);
    $('#modal-root').innerHTML = '';
    resetIdle();
  }
  function modalOpen() { return !!$('#modal-root').firstChild; }

  /* ================================================================
     Timeout tidak aktif
     ================================================================ */
  var idleT = null, idleWarnOpen = false;
  function resetIdle() {
    clearTimeout(idleT);
    if (idleWarnOpen) return;
    if (S.screen === 'ticket') return;
    if (S.screen === 'home' && !modalOpen()) return;
    idleT = setTimeout(onIdle, CFG.timeouts.idleSeconds * 1000);
  }
  function onIdle() {
    if (S.screen === 'home') { closeModal(); update(); return; }
    idleWarnOpen = true;
    var left = CFG.timeouts.idleWarnSeconds;
    openModal(
      '<div class="modal-icon warn">' + icon('clock') + '</div>' +
      '<h2>Apakah Anda masih di sana?</h2>' +
      '<p>Demi keamanan data, layar akan kembali ke beranda bila tidak ada aktivitas.</p>' +
      '<div class="big-count" id="idle-count">' + left + '</div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" data-action="home">' + icon('home') + 'Ke beranda</button>' +
      '<button class="btn btn-primary" data-action="still-here">Ya, lanjutkan</button></div>', { sticky: true });
    beep(660, .2);
    modalTimer = setInterval(function () {
      left--;
      var el = $('#idle-count');
      if (el) el.textContent = left;
      if (left <= 0) { idleWarnOpen = false; goHome(); }
    }, 1000);
  }

  /* ================================================================
     Aksesibilitas & bantuan
     ================================================================ */
  function setA11y(kind, on) {
    document.documentElement.classList.toggle(kind, on);
    var btn = document.querySelector('[data-action="toggle-' + kind + '"]');
    if (btn) btn.setAttribute('aria-pressed', String(on));
  }

  var lastHelp = 0;
  function requestHelp() {
    var t = Date.now();
    if (t - lastHelp < 60000) {
      openModal('<div class="modal-icon ok">' + icon('bell') + '</div><h2>Petugas sudah dipanggil</h2>' +
        '<p>Permintaan bantuan Anda sudah terkirim. Mohon tunggu sebentar di depan kiosk.</p>' +
        '<div class="modal-actions"><button class="btn btn-primary" data-action="modal-close">Baik</button></div>');
      return;
    }
    lastHelp = t;
    chime();
    store.help({ time: now().hhmm, kioskId: CFG.kioskId, screen: S.screen }).catch(function () { /* tetap tampilkan */ });
    openModal('<div class="modal-icon ok">' + icon('bell') + '</div><h2>Petugas sedang menuju ke sini</h2>' +
      '<p>Mohon tunggu di depan kiosk <b>' + esc(CFG.kioskId) + '</b>. Petugas akan segera membantu Anda.</p>' +
      '<div class="modal-actions"><button class="btn btn-primary" data-action="modal-close">Baik</button></div>');
    speak('Petugas sedang menuju ke sini. Mohon tunggu sebentar.');
  }

  /* ================================================================
     Panel admin (ketuk logo 5x)
     ================================================================ */
  var adminPin = null, pinBuf = '', pinFails = 0, pinLockUntil = 0;
  function openPin() {
    pinBuf = '';
    if (Date.now() < pinLockUntil) { toast('Terlalu banyak percobaan. Coba lagi nanti.'); return; }
    renderPin();
  }
  function renderPin(shake) {
    var len = String(CFG.adminPin).length, dots = '';
    for (var i = 0; i < len; i++) dots += '<i class="' + (i < pinBuf.length ? 'on' : '') + '"></i>';
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'x', '0', 'del'].map(function (k) {
      if (k === 'x') return '<button class="fn" data-action="modal-close">Batal</button>';
      if (k === 'del') return '<button class="fn" data-action="pin-key" data-k="del">⌫</button>';
      return '<button data-action="pin-key" data-k="' + k + '">' + k + '</button>';
    }).join('');
    openModal('<div class="modal-icon">' + icon('lock') + '</div><h2>Panel petugas</h2><p>Masukkan PIN admin.</p>' +
      '<div class="pin-dots' + (shake ? ' shake' : '') + '">' + dots + '</div><div class="numpad">' + keys + '</div>');
  }
  function pinKey(k) {
    if (k === 'del') pinBuf = pinBuf.slice(0, -1);
    else pinBuf += k;
    var len = String(CFG.adminPin).length;
    if (pinBuf.length < len) { renderPin(); return; }
    if (pinBuf === String(CFG.adminPin)) {
      adminPin = pinBuf; pinFails = 0; pinBuf = '';
      refreshState().then(renderAdmin);
    } else {
      pinFails++; pinBuf = '';
      if (pinFails >= 3) { pinLockUntil = Date.now() + 60000; pinFails = 0; closeModal(); toast('PIN salah 3×. Panel terkunci 1 menit.'); return; }
      renderPin(true);
    }
  }

  function renderAdmin() {
    var st = q();
    var rows = CFG.layanan.map(function (svc) {
      var s = svcStats(svc);
      return '<tr><td><b>' + esc(svc.prefix) + '</b> · ' + esc(svc.nama) + '</td><td class="num">' + s.issued + '/' + svc.kuota + '</td><td class="num">' + s.waiting + '</td>' +
        '<td><button class="switch" role="switch" aria-label="Aktifkan ' + esc(svc.nama) + '" aria-checked="' + !s.disabled + '" data-action="adm-svc" data-id="' + esc(svc.id) + '"></button></td></tr>';
    }).join('');
    var helps = (st.help || []).slice(-8).reverse().map(function (h) {
      return '<li>' + esc(dot(h.time || '')) + ' — ' + esc(h.kiosk || '-') + ' (' + esc(h.screen || '-') + ')</li>';
    }).join('') || '<li>Belum ada</li>';
    var modeText = store.name === 'server' ? (online ? 'Server (terhubung)' : 'Server (TERPUTUS)') : store.name === 'uji' ? 'Mode uji (terpisah)' : 'Lokal — 1 kiosk saja';
    openModal(
      '<h2>Panel petugas</h2><p>' + esc(CFG.kioskId) + ' · ' + esc(dateLabel(st.date)) + ' · ' + modeText + '</p>' +
      '<div class="admin-grid">' +
        '<div class="card"><table class="admin-table"><thead><tr><th>Layanan</th><th>Terbit</th><th>Tunggu</th><th>Buka</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="card">' +
          '<div class="admin-row"><span>Abaikan jadwal (buka di luar jam)</span><button class="switch" role="switch" aria-label="Abaikan jadwal" aria-checked="' + !!st.settings.ignoreSchedule + '" data-action="adm-ignore"></button></div>' +
          '<div class="admin-row"><span>Lebar kertas</span><span style="display:flex;gap:.4rem">' +
            [58, 80].map(function (w) { return '<button class="opt" style="min-height:2.6rem" data-action="adm-paper" data-w="' + w + '" aria-pressed="' + (device.paperWidth === w) + '">' + w + ' mm</button>'; }).join('') +
          '</span></div>' +
          '<div class="admin-row" style="display:block"><span>Permintaan bantuan</span><ul class="help-log">' + helps + '</ul></div>' +
          '<div class="admin-btns">' +
            '<button class="btn btn-ghost" data-action="adm-test">' + icon('printer') + 'Cetak tiket uji</button>' +
            '<button class="btn btn-ghost" data-action="adm-csv">' + icon('download') + 'Unduh rekap hari ini (CSV)</button>' +
            '<button class="btn btn-ghost" data-action="adm-reload">' + icon('refresh') + 'Muat ulang aplikasi</button>' +
            '<button class="btn btn-danger" data-action="adm-reset">' + icon('trash') + 'Reset antrian hari ini</button>' +
            '<button class="btn btn-primary" data-action="modal-close">Tutup panel</button>' +
          '</div>' +
        '</div>' +
      '</div>', { wide: true });
  }

  function adminSave(patch) {
    return store.saveSettings(adminPin, patch).then(function (r) {
      if (r && r.ok === false) toast('Gagal menyimpan: ' + (r.reason || 'ditolak server'));
      return refreshState();
    }).then(renderAdmin).catch(function () { toast('Gagal terhubung ke server'); });
  }

  function exportCsv() {
    var st = q();
    var lines = [['No', 'Layanan', 'Prioritas', 'Kategori', 'Jam', 'Kiosk']].concat((st.log || []).map(function (l) {
      var svc = svcById(l.serviceId);
      return [l.no, svc ? svc.nama : l.serviceId, l.priority ? 'Ya' : 'Tidak', l.kategori || '', l.time, l.kiosk || ''];
    }));
    var csv = lines.map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'antrian-' + st.date + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Rekap diunduh: ' + a.download);
  }

  /* ================================================================
     Aksi (event delegation)
     ================================================================ */
  var ACTIONS = {
    start: function () {
      if (systemDown() || !schedule().open) { update(); return; }
      refreshState().then(function () { go('services'); });
    },
    home: function () { idleWarnOpen = false; goHome(); },
    back: function (el) { go(el.dataset.to); },
    pick: function (el) {
      S.svc = svcById(el.dataset.id);
      S.checked = {};
      go('req');
    },
    check: function (el) {
      var i = +el.dataset.i;
      S.checked[i] = !S.checked[i];
      update();
    },
    incomplete: function () { showIncomplete(); },
    'to-konsultasi': function () {
      closeModal();
      S.svc = svcById('konsultasi'); S.checked = {};
      go('req');
    },
    'to-confirm': function () { go('confirm'); },
    cat: function (el) {
      S.prioritas = el.dataset.v === 'prioritas';
      if (!S.prioritas) S.kategori = null;
      update();
    },
    kategori: function (el) { S.kategori = el.dataset.id; update(); },
    key: function (el) {
      var k = el.dataset.k;
      if (k === 'del') S.nik = S.nik.slice(0, -1);
      else if (k === 'clr') S.nik = '';
      else if (S.nik.length < 16) S.nik += k;
      update();
    },
    print: function () { doIssue(); },
    reprint: function () {
      if (S.reprints >= CFG.maxReprint) return;
      S.reprints++;
      update();
      printTicket(S.ticket, true);
      startTicketCountdown();
    },
    'still-here': function () { idleWarnOpen = false; closeModal(); },
    'modal-close': function () { idleWarnOpen = false; closeModal(); },
    'toggle-large': function () { setA11y('large', !document.documentElement.classList.contains('large')); },
    'toggle-contrast': function () { setA11y('contrast', !document.documentElement.classList.contains('contrast')); },
    speak: function () { speak(S.speech || 'Selamat datang.'); },
    help: function () { requestHelp(); },
    'pin-key': function (el) { pinKey(el.dataset.k); },
    'adm-svc': function (el) {
      var d = Object.assign({}, q().settings.disabled);
      if (d[el.dataset.id]) delete d[el.dataset.id]; else d[el.dataset.id] = true;
      adminSave({ disabled: d });
    },
    'adm-ignore': function () { adminSave({ ignoreSchedule: !q().settings.ignoreSchedule }); },
    'adm-paper': function (el) { device.paperWidth = +el.dataset.w; saveDevice(); renderAdmin(); },
    'adm-test': function () {
      var svc = CFG.layanan[0], n = now();
      printTicket({ no: svc.prefix + '-000', seq: 0, priority: false, svc: svc, date: n.date, time: n.hhmm, ahead: 0,
        est: { atText: fmtMin(n.min) }, code: 'UJI0', test: true, kiosk: CFG.kioskId, nikMasked: '3201 •••• •••• 0001' }, false);
    },
    'adm-csv': function () { exportCsv(); },
    'adm-reload': function () { location.reload(); },
    'adm-reset': function () {
      openModal('<div class="modal-icon danger">' + icon('trash') + '</div><h2>Reset antrian hari ini?</h2>' +
        '<p>Semua nomor kembali ke 001 dan rekap hari ini dihapus. Tiket yang sudah tercetak bisa bentrok dengan nomor baru. Tindakan ini tidak bisa dibatalkan.</p>' +
        '<div class="modal-actions"><button class="btn btn-ghost" data-action="adm-back">Batal</button>' +
        '<button class="btn btn-danger" data-action="adm-reset-yes">Ya, reset</button></div>');
    },
    'adm-back': function () { renderAdmin(); },
    'adm-reset-yes': function () {
      store.reset(adminPin).then(function (r) {
        if (r && r.ok === false) { toast('Reset ditolak: ' + (r.reason || '')); return; }
        toast('Antrian hari ini sudah direset');
        return refreshState().then(renderAdmin);
      }).catch(function () { toast('Gagal terhubung ke server'); });
    },
  };

  document.addEventListener('click', function (e) {
    var back = e.target.classList && e.target.classList.contains('modal-back');
    if (back && e.target.dataset.backdrop === '1') { closeModal(); return; }
    var el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    var fn = ACTIONS[el.dataset.action];
    if (fn) fn(el, e);
  });

  document.addEventListener('pointerdown', function (e) {
    resetIdle();
    if (e.target.closest && e.target.closest('button:not(:disabled)')) beep(1200, .04);
  }, true);
  document.addEventListener('keydown', function (e) {
    resetIdle();
    if (S.screen === 'confirm' && S.svc && S.svc.mintaNik && !modalOpen()) {
      if (/^\d$/.test(e.key)) ACTIONS.key({ dataset: { k: e.key } });
      else if (e.key === 'Backspace') ACTIONS.key({ dataset: { k: 'del' } });
    }
    if (e.key === 'Escape' && modalOpen() && !idleWarnOpen) closeModal();
  });

  var brandTaps = [];
  $('#brand').addEventListener('click', function () {
    var t = Date.now();
    brandTaps = brandTaps.filter(function (x) { return t - x < 3000; });
    brandTaps.push(t);
    if (brandTaps.length >= 5) { brandTaps = []; openPin(); }
  });

  // Kunci perilaku browser yang tidak diinginkan di kiosk.
  ['contextmenu', 'dragstart', 'selectstart', 'gesturestart'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false });
  });
  document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });

  /* ================================================================
     Jam, status koneksi, pemeliharaan harian
     ================================================================ */
  function paintClock() {
    var n = now();
    $('#clock-time').textContent = Core.pad(n.h) + '.' + Core.pad(n.m);
    $('#clock-date').textContent = fmtLongDate.format(new Date()) + (ZONA ? ' · ' + ZONA : '');
  }
  function paintStatus() {
    var pill = $('#mode-pill');
    if (store === ServerStore) {
      pill.hidden = false;
      pill.className = 'pill' + (online ? '' : ' pill-danger');
      pill.textContent = online ? 'Terhubung' : 'Terputus';
    } else {
      pill.hidden = true;
    }
  }

  var bootDate = null;
  function maintenance() {
    var n = now();
    // Ganti hari → muat ulang saat kiosk sedang menganggur di beranda (membersihkan memori & reset nomor).
    if (n.date !== bootDate && S.screen === 'home' && !modalOpen()) { location.reload(); return; }
    refreshState().then(function () {
      if (S.screen === 'home' && !modalOpen()) update();
    });
  }

  // Penjaga: bila terjadi error tak terduga, tampilkan pesan lalu muat ulang.
  var crashed = false;
  window.addEventListener('error', function () {
    if (crashed) return;
    crashed = true;
    try {
      openModal('<div class="modal-icon danger">' + icon('alert') + '</div><h2>Terjadi gangguan</h2>' +
        '<p>Kiosk akan dimuat ulang otomatis dalam 10 detik. Bila berulang, hubungi petugas.</p>', { sticky: true });
    } catch (e) { /* abaikan */ }
    setTimeout(function () { location.reload(); }, 10000);
  });

  /* ================================================================
     Mulai
     ================================================================ */
  function boot() {
    document.title = 'Kiosk Antrian ' + CFG.instansi.singkatan;
    $('#brand-name').textContent = CFG.instansi.singkatan;
    $('#brand-region').textContent = CFG.instansi.nama + ' ' + CFG.instansi.wilayah;
    $('#test-pill').hidden = !TEST;
    bootDate = now().date;
    paintClock();
    setInterval(paintClock, 1000);
    if ('speechSynthesis' in window) speechSynthesis.getVoices();

    detectStore().then(function (s) {
      store = s;
      return refreshState();
    }).then(function () {
      go('home');
      setInterval(maintenance, 30000);
    });
  }

  boot();
}());
