/*
 * Inti logika antrian — dipakai bersama oleh browser (mode lokal) dan
 * server.js (mode server), supaya aturan kuota, nomor, jadwal, dan
 * pencegahan antrian ganda hanya ditulis sekali.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QueueCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // SHA-256 ringkas (input ASCII). Dipakai karena crypto.subtle tidak
  // tersedia saat kiosk dibuka lewat http:// ke IP lokal (bukan secure context).
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var maxWord = Math.pow(2, 32), i, j, result = '', words = [];
    var bitLength = ascii.length * 8;
    var hash = sha256.h = sha256.h || [];
    var k = sha256.k = sha256.k || [];
    var primeCounter = k.length, isComposite = {};
    for (var cand = 2; primeCounter < 64; cand++) {
      if (!isComposite[cand]) {
        for (i = 0; i < 313; i += cand) isComposite[i] = cand;
        hash[primeCounter] = (Math.pow(cand, .5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(cand, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return null;
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((bitLength / maxWord) | 0);
    words[words.length] = bitLength;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash);
        hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? 0 : '') + b.toString(16);
      }
    }
    return result;
  }

  function pad(n, len) { return String(n).padStart(len || 2, '0'); }
  function toMin(hhmm) { var p = hhmm.split(':'); return (+p[0]) * 60 + (+p[1]); }

  var DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  var fmtCache = {};
  // Waktu "sekarang" di zona kantor, terlepas dari zona waktu OS kiosk.
  function nowIn(timeZone, date) {
    var f = fmtCache[timeZone] || (fmtCache[timeZone] = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
    }));
    var p = {};
    f.formatToParts(date || new Date()).forEach(function (x) { p[x.type] = x.value; });
    var h = (+p.hour) % 24, m = +p.minute;
    return {
      date: p.year + '-' + p.month + '-' + p.day, h: h, m: m, s: +p.second,
      dow: DOW[p.weekday], min: h * 60 + m, hhmm: pad(h) + ':' + pad(m),
    };
  }

  function addDays(dateStr, n) {
    var p = dateStr.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay() };
  }

  function dayPlan(cfg, date, dow) {
    if ((cfg.libur || []).indexOf(date) >= 0) return null;
    return cfg.jadwal[dow] || null;
  }

  // Status pengambilan tiket berdasarkan jadwal & hari libur.
  function schedule(cfg, n, bypass) {
    var today = dayPlan(cfg, n.date, n.dow);
    var open = false, reason = '', next = null;
    if (!today) {
      reason = (cfg.libur || []).indexOf(n.date) >= 0 ? 'Hari ini libur — kantor tidak melayani' : 'Hari ini kantor tidak melayani';
    } else if (n.min < toMin(today.buka)) {
      reason = 'Pengambilan tiket belum dibuka';
      next = { date: n.date, dow: n.dow, plan: today, inDays: 0 };
    } else if (n.min >= toMin(today.tutupTiket)) {
      reason = 'Pengambilan tiket hari ini sudah ditutup';
    } else {
      open = true;
    }
    if (!open && !next) {
      for (var i = 1; i <= 21; i++) {
        var d = addDays(n.date, i), plan = dayPlan(cfg, d.date, d.dow);
        if (plan) { next = { date: d.date, dow: d.dow, plan: plan, inDays: i }; break; }
      }
    }
    return { open: open || !!bypass, realOpen: open, bypass: !!bypass && !open, today: today, reason: reason, next: next };
  }

  function randomSecret() {
    var out = '', vals;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) vals = crypto.getRandomValues(new Uint32Array(4));
    else vals = [0, 0, 0, 0].map(function () { return (Math.random() * 4294967296) >>> 0; });
    for (var i = 0; i < vals.length; i++) out += vals[i].toString(36);
    return out;
  }

  function emptyState(date) {
    return { v: 1, date: date, secret: randomSecret(), svc: {}, nik: {}, log: [], help: [] };
  }

  function ensureDay(st, date) {
    if (!st || st.v !== 1 || st.date !== date) return emptyState(date);
    st.svc = st.svc || {}; st.nik = st.nik || {}; st.log = st.log || []; st.help = st.help || [];
    return st;
  }

  // n = tiket umum terbit, p = tiket prioritas terbit, cn/cp = sudah dipanggil
  function counter(st, id) { return st.svc[id] || (st.svc[id] = { n: 0, p: 0, cn: 0, cp: 0 }); }
  function waiting(c) { return Math.max(0, c.n - c.cn) + Math.max(0, c.p - c.cp); }
  function ticketNo(svc, seq, priority) { return (priority ? 'P' : '') + svc.prefix + '-' + pad(seq, 3); }

  /*
   * Terbitkan tiket. req = { serviceId, priority, kategori, nikHash, kioskId }
   * Mengubah `st` bila berhasil. Hasil: { ok:true, ticket } atau { ok:false, reason }.
   */
  function issue(st, services, settings, req, time) {
    var svc = null;
    for (var i = 0; i < services.length; i++) if (services[i].id === req.serviceId) svc = services[i];
    if (!svc) return { ok: false, reason: 'unknown' };
    if (settings && settings.disabled && settings.disabled[svc.id]) return { ok: false, reason: 'disabled' };
    var c = counter(st, svc.id);
    if (c.n + c.p >= svc.kuota) return { ok: false, reason: 'quota' };
    if (req.nikHash) {
      var prev = st.nik[req.nikHash] && st.nik[req.nikHash][svc.id];
      if (prev) return { ok: false, reason: 'duplicate', no: prev };
    }
    var priority = !!req.priority;
    var ahead = priority ? Math.max(0, c.p - c.cp) : waiting(c);
    var seq = priority ? ++c.p : ++c.n;
    var no = ticketNo(svc, seq, priority);
    var code = sha256(st.secret + '|' + st.date + '|' + no).slice(0, 4).toUpperCase();
    if (req.nikHash) (st.nik[req.nikHash] = st.nik[req.nikHash] || {})[svc.id] = no;
    var ticket = {
      no: no, seq: seq, priority: priority, kategori: priority ? (req.kategori || null) : null,
      serviceId: svc.id, date: st.date, time: time, ahead: ahead, code: code, kiosk: req.kioskId || null,
    };
    st.log.push({ no: no, serviceId: svc.id, priority: priority, kategori: ticket.kategori, time: time, kiosk: ticket.kiosk });
    return { ok: true, ticket: ticket };
  }

  // Dipanggil oleh sistem loket: majukan antrian satu nomor.
  function call(st, services, serviceId, priority) {
    var svc = services.filter(function (s) { return s.id === serviceId; })[0];
    if (!svc) return null;
    var c = counter(st, svc.id);
    if (priority) { if (c.cp >= c.p) return null; c.cp++; return ticketNo(svc, c.cp, true); }
    if (c.cn >= c.n) return null;
    c.cn++;
    return ticketNo(svc, c.cn, false);
  }

  function addHelp(st, info) {
    st.help.push({ time: info.time, kiosk: info.kioskId || null, screen: info.screen || null });
    if (st.help.length > 50) st.help.shift();
  }

  // Data yang aman dikirim ke kiosk (tanpa hash NIK & kunci harian).
  function publicState(st) {
    return { date: st.date, svc: st.svc, log: st.log, help: st.help };
  }

  return {
    sha256: sha256, pad: pad, toMin: toMin, nowIn: nowIn, addDays: addDays, schedule: schedule,
    emptyState: emptyState, ensureDay: ensureDay, counter: counter, waiting: waiting,
    ticketNo: ticketNo, issue: issue, call: call, addHelp: addHelp, publicState: publicState,
  };
}));
