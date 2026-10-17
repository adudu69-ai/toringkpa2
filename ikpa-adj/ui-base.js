/* TORING — Monitoring Penyesuaian IKPA : infrastruktur UI, autentikasi, modal, utilitas */
(function () {
  'use strict';
  var C = window.IkpaAdj, ST = window.IkpaStore;
  var U = window.IkpaUI = { C: C, ST: ST, tabs: {}, state: { ta: String(new Date().getFullYear()), list: [], loaded: false, tab: 'dash', f: { dash: {}, db: {}, sat: {}, me: {} } } };
  var S = C.S;

  /* ------------------------------------------------------------ util */
  U.esc = function (v) { return S(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var esc = U.esc;
  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  U.fmtDate = function (iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(iso)); return m ? m[3] + '/' + m[2] + '/' + m[1] : S(iso); };
  U.fmtTs = function (ts) { if (!ts) return ''; var d = new Date(ts); return isNaN(d) ? S(ts) : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }); };
  U.twLabel = function (tw) { return tw ? 'TW ' + ['I', 'II', 'III', 'IV'][tw - 1] : 'Belum ditentukan'; };
  U.statusBadge = function (p) {
    var st = p.status, cls = st === 'Disetujui' ? 'b-ok' : st === 'Ditolak' ? 'b-no' : st === 'Pending' ? 'b-pend' : 'b-gray';
    return '<span class="badge ' + cls + '">' + esc(st || '—') + '</span>' + (p.pooling ? ' <span class="badge b-pool">Pooling</span>' : '') + (p.dibatalkan ? ' <span class="badge b-gray">Dibatalkan</span>' : '');
  };
  U.jalurBadge = function (j) {
    return j === 'SATKER' ? '<span class="badge b-info">Satker</span>' : j === 'ESELON_I' ? '<span class="badge b-info">Eselon I</span>' : '<span class="badge b-gray" title="Asal pengajuan belum diverifikasi — tidak ditebak">Belum diverifikasi</span>';
  };
  U.can = function (a) { return C.can(U.state.role, a); };
  U.uniq = function (arr) { var o = {}; arr.forEach(function (x) { if (x !== '' && x !== null && x !== undefined) o[x] = 1; }); return Object.keys(o).sort(); };
  U.debounce = function (fn, ms) { var t; return function () { var a = arguments, th = this; clearTimeout(t); t = setTimeout(function () { fn.apply(th, a); }, ms); }; };
  U.satkerInfo = function (kd) {
    if (!U._sm) { U._sm = {}; (window.SATKER_DB || []).forEach(function (r) { U._sm[r[0]] = r; }); }
    var r = U._sm[kd]; return r ? { kode: r[0], nama: r[1], kl: r[2], kdkppn: r[3], kppn: r[4], provinsi: r[5], kanwil: r[6], klKode: r[7] } : null;
  };
  U.toast = function (msg, kind) {
    var box = U.$('#toast') || (function () { var d = document.createElement('div'); d.id = 'toast'; d.className = 'toast'; document.body.appendChild(d); return d; })();
    var el = document.createElement('div'); if (kind) el.className = kind; el.textContent = msg; box.appendChild(el); setTimeout(function () { el.remove(); }, kind === 'e' ? 9000 : 4500);
  };
  U.errMsg = function (e) {
    if (!e) return 'Terjadi kesalahan';
    if (e.code === 'FORBIDDEN') return e.message || 'Hak akses tidak mencukupi.';
    if (e.code === 'UNAUTHENTICATED') return 'Sesi masuk berakhir atau token tidak valid. Muat ulang halaman dan masuk kembali.';
    if (e.code === 'CONFLICT') return (e.message || 'Data telah diubah pengguna lain.') + ' Data sudah dimuat ulang; periksa lalu ulangi.';
    return e.message || String(e);
  };
  /** teks mekanisme penyesuaian suatu pengajuan (ringkas atau dari uraian bebas) */
  U.mekText = function (p) { return S(p && p.mekanisme).trim(); };
  U.run = function (promise, okMsg) { return promise.then(function (r) { if (okMsg) U.toast(okMsg, 's'); return r; }, function (e) { U.toast(U.errMsg(e), 'e'); throw e; }); };

  /* ----------------------------------------------------------- modal */
  var modalSeq = 0;
  U.modal = function (opt) { // {title, body(html), footer(html), wide, onMount(el), onClose}
    var id = 'mo' + (++modalSeq), el = document.createElement('div'); el.className = 'mo on'; el.id = id;
    el.innerHTML = '<div class="md' + (opt.wide ? ' w' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(opt.title) + '"><div class="md-h"><h2>' + esc(opt.title) + '</h2><button class="btn sm" data-x="close" aria-label="Tutup">✕</button></div><div class="md-b">' + (opt.body || '') + '</div>' + (opt.footer !== undefined ? '<div class="md-f">' + opt.footer + '</div>' : '') + '</div>';
    document.body.appendChild(el);
    var api = { el: el, close: function () { if (opt.onClose) opt.onClose(); el.remove(); }, body: function () { return U.$('.md-b', el); }, foot: function () { return U.$('.md-f', el); } };
    el.addEventListener('mousedown', function (e) { if (e.target === el && !opt.sticky) api.close(); });
    el.addEventListener('click', function (e) { if (e.target.closest('[data-x="close"]')) api.close(); });
    if (opt.onMount) opt.onMount(api);
    return api;
  };
  /** konfirmasi / input alasan (pengganti confirm/prompt bawaan browser) */
  U.ask = function (o) { // {title,msg(html),reason:boolean|label,confirm,danger}
    return new Promise(function (res) {
      var m = U.modal({
        title: o.title, sticky: true,
        body: '<div>' + (o.msg || '') + '</div>' + (o.reason ? '<div class="fld" style="margin-top:10px"><label class="req">' + esc(typeof o.reason === 'string' ? o.reason : 'Alasan') + '</label><textarea id="askR" rows="3"></textarea><span class="em" id="askE"></span></div>' : ''),
        footer: '<button class="btn" data-x="close">Batal</button><button class="btn ' + (o.danger ? 'd' : 'p') + '" id="askOk">' + esc(o.confirm || 'Lanjut') + '</button>',
        onClose: function () { if (!done) { done = true; res(null); } }
      }); var done = false;
      U.$('#askOk', m.el).addEventListener('click', function () {
        var r = o.reason ? S(U.$('#askR', m.el).value).trim() : '';
        if (o.reason && !r) { U.$('#askE', m.el).textContent = 'Wajib diisi'; return; }
        done = true; m.el.remove(); res({ reason: r });
      });
    });
  };

  /* ---------------------------------------------------- tab registry */
  U.registerTab = function (id, label, render) { U.tabs[id] = { id: id, label: label, render: render }; };
  U.render = function () { var t = U.tabs[U.state.tab]; if (t) { var pane = U.$('#pane-' + t.id); if (pane) t.render(pane); } };
  U.setTab = function (id) {
    U.state.tab = id; U.$$('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === id); });
    U.$$('.pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + id); });
    U.render();
  };
  U.reload = function (rescan) {
    U.state.loaded = false; var ad = U.state.store.adapter;
    var pre = ad.refresh ? ad.refresh(rescan).then(function (r) {
      U.state.sheetInfo = r; var b = U.$('#dbBanner');
      if (b) b.innerHTML = r.unreadable ? '<div class="banner warn">' + r.unreadable + ' baris spreadsheet tidak terbaca sebagai pengajuan (mis. ID ganda atau kolom wajib kosong). Baris itu tidak diubah dan tidak dihitung. <a href="#" id="lnkUnread">Lihat</a></div>' : '';
      var l = U.$('#lnkUnread'); if (l) l.onclick = function (ev) { ev.preventDefault(); U.showUnreadable(); };
      return r;
    }) : Promise.resolve();
    return pre.then(function () { return U.state.store.listIndex(U.state.ta); }).then(function (l) {
      U.state.list = l; U.state.loaded = true; U.render(); return l;
    }, function (e) { U.state.loaded = true; U.toast(U.errMsg(e), 'e'); throw e; });
  };
  U.showUnreadable = function () {
    var ad = U.state.store.adapter, list = ad.unreadable ? ad.unreadable() : [];
    U.modal({ title: 'Baris yang tidak terbaca', wide: true, body: '<div class="alert i small">Baris ini dibiarkan apa adanya di spreadsheet. Perbaiki di spreadsheet lalu tekan “Muat ulang dari spreadsheet”.</div><div class="tw"><table><thead><tr><th>Sheet</th><th>Baris</th><th>Masalah</th></tr></thead><tbody>' + list.map(function (r) { return '<tr><td>' + esc(r.sheet) + '</td><td>' + esc(r.row) + '</td><td class="small">' + esc(r.error) + '</td></tr>'; }).join('') + '</tbody></table></div>', footer: '<button class="btn" data-x="close">Tutup</button>' });
  };

  /* ------------------------------------------------- filter bar bersama */
  U.filterBar = function (scope, opts) {
    opts = opts || {}; var L = U.state.list, f = U.state.f[scope];
    var kanwil = U.uniq(L.filter(function (p) { return /^kanwil/i.test(p.submitter); }).map(function (p) { return p.submitter; }));
    var es1 = U.uniq(L.filter(function (p) { return p.submitter && !/^kanwil/i.test(p.submitter); }).map(function (p) { return p.submitter; }).concat(L.map(function (p) { return p.namaKL; })));
    var sel = function (key, label, vals, fmt) { return '<label>' + label + '<select data-f="' + scope + '.' + key + '"><option value="">Semua</option>' + vals.map(function (v) { var val = typeof v === 'object' ? v.v : v, lb = typeof v === 'object' ? v.l : (fmt ? fmt(v) : v); return '<option value="' + esc(val) + '"' + (S(f[key]) === S(val) ? ' selected' : '') + '>' + esc(lb) + '</option>'; }).join('') + '</select></label>'; };
    return '<div class="fbar" data-scope="' + scope + '">' +
      '<label>Tahun anggaran<select data-ta="1">' + [2024, 2025, 2026, 2027].map(function (y) { return '<option' + (String(y) === U.state.ta ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select></label>' +
      sel('tw', 'Triwulan', [{ v: '1', l: 'TW I' }, { v: '2', l: 'TW II' }, { v: '3', l: 'TW III' }, { v: '4', l: 'TW IV' }, { v: '0', l: 'Belum ditentukan' }]) +
      sel('kanwil', 'Kanwil DJPb', kanwil) + sel('kl', 'Eselon I / K/L', es1) +
      sel('kppn', 'KPPN', U.uniq(L.map(function (p) { return p.kdkppn; }))) +
      sel('indikator', 'Indikator', U.uniq(C.INDIKATOR.concat(L.map(function (p) { return p.indikator; })))) +
      sel('status', 'Status', ['Disetujui', 'Pending', 'Ditolak', 'Pooling']) +
      (opts.jalur ? sel('jalur', 'Jalur', [{ v: 'SATKER', l: 'Satker' }, { v: 'ESELON_I', l: 'Eselon I' }, { v: 'BELUM_DIVERIFIKASI', l: 'Belum diverifikasi' }]) : '') +
      (opts.search ? '<label>Cari<input type="search" data-f="' + scope + '.q" value="' + esc(f.q || '') + '" placeholder="satker, ND, nama…"></label>' : '') +
      '<button class="btn sm" data-reset="' + scope + '">Atur ulang</button></div>';
  };
  U.bindFilters = function (root, scope, rerender) {
    U.$$('[data-f^="' + scope + '."]', root).forEach(function (el) {
      var key = el.dataset.f.split('.')[1], ev = el.tagName === 'INPUT' ? 'input' : 'change';
      el.addEventListener(ev, U.debounce(function () { U.state.f[scope][key] = el.value; rerender(el.tagName === 'INPUT' ? { keepFocus: el.dataset.f } : null); }, el.tagName === 'INPUT' ? 250 : 0));
    });
    var ta = U.$('[data-ta]', root); if (ta) ta.addEventListener('change', function () { U.state.ta = ta.value; U.reload(); });
    var rs = U.$('[data-reset]', root); if (rs) rs.addEventListener('click', function () { U.state.f[scope] = {}; rerender(); });
  };
  U.filtered = function (scope) { return C.applyFilters(U.state.list, Object.assign({ ta: U.state.ta }, U.state.f[scope])); };

  /* ----------------------------------------------------- unduh Excel */
  U.downloadAoa = function (name, sheets) { // sheets: [{name, aoa}]
    var wb = XLSX.utils.book_new(); sheets.forEach(function (sh) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.aoa), sh.name.slice(0, 31)); });
    XLSX.writeFile(wb, name); return name;
  };

  /* ---------------------------------------------------------- shell */
  function shell() {
    document.getElementById('app').innerHTML =
      '<div class="hd"><div><h1>Monitoring Penyesuaian IKPA &amp; Master Exception</h1><div class="sub">TORING · Direktorat Pelaksanaan Anggaran</div></div><span class="sp"></span><span id="who"></span></div>' +
      '<div id="banner"></div><div id="dbBanner"></div><div class="tabs" role="tablist" id="tabs"></div><main id="main"></main>';
  }
  function showTabs() {
    var t = U.$('#tabs'), main = U.$('#main'); t.innerHTML = ''; main.innerHTML = '';
    Object.keys(U.tabs).forEach(function (id) {
      var tab = U.tabs[id]; if (tab.admin && !U.can('kelolaPengguna')) return;
      var b = document.createElement('button'); b.className = 'tab'; b.dataset.tab = id; b.setAttribute('role', 'tab'); b.textContent = tab.label; t.appendChild(b);
      var p = document.createElement('section'); p.className = 'pane'; p.id = 'pane-' + id; main.appendChild(p);
    });
    t.addEventListener('click', function (e) { var b = e.target.closest('.tab'); if (b) U.setTab(b.dataset.tab); });
  }
  function whoChip() {
    var s = U.state, el = U.$('#who'); if (!s.user) { el.innerHTML = ''; return; }
    var cfg = window.IKPA_CONFIG || {};
    el.innerHTML = (s.store && s.store.adapter.refresh ? '<button class="btn sm" id="btnSync" title="Baca ulang seluruh sheet (termasuk perubahan manual di spreadsheet)">↻ Muat ulang dari spreadsheet</button> ' : '') +
      (cfg.SHEET_URL && s.store ? '<a class="btn sm" id="btnSheet" target="_blank" rel="noopener" href="' + esc(cfg.SHEET_URL) + '">Buka spreadsheet</a> ' : '') +
      '<span class="chip ' + esc(s.role || '') + '">' + esc(s.user.name || s.user.email) + ' · ' + esc(s.role || 'belum terdaftar') + '</span> ' + (s.mode === 'firebase' ? '<button class="btn sm" id="btnOut">Keluar</button>' : '');
    var o = U.$('#btnOut'); if (o) o.onclick = function () { firebase.auth().signOut(); };
    var y = U.$('#btnSync'); if (y) y.onclick = function () { y.disabled = true; U.reload(true).then(function () { U.toast('Data dimuat ulang dari spreadsheet', 's'); }, function () { }).then(function () { y.disabled = false; }); };
  }
  function gate(html) { U.$('#main').innerHTML = '<div class="gate card">' + html + '</div>'; U.$('#tabs').innerHTML = ''; }

  function start(store, user, role, mode) {
    var s = U.state; s.store = store; s.user = user; s.role = role; s.mode = mode;
    whoChip(); showTabs(); U.setTab(s.tab);
    U.$('#main').insertAdjacentHTML('afterbegin', '<div class="empty" id="loading"><span class="spin"></span> Memuat data…</div>');
    U.reload().then(function () { var l = U.$('#loading'); if (l) l.remove(); }, function () { var l = U.$('#loading'); if (l) l.remove(); });
  }

  function setupGate() {
    gate('<h2>Penyimpanan belum disambungkan</h2><p class="muted" style="margin:6px 0 10px">Data modul ini disimpan di Google Spreadsheet melalui Google Apps Script. Alamat web app (<span class="mono">WEBAPP_URL</span>) belum diisi pada <span class="mono">ikpa-adj/config.js</span>, sehingga modul tidak menampilkan atau menyimpan data apa pun.</p><p class="small muted">Langkah pemasangan: <span class="mono">apps-script/README.md</span>.</p>');
  }

  function openSession(adapter, who, mode) {
    // who: {email, name}; peran ditentukan SERVER (sheet _Pengguna / ADMIN_EMAILS), bukan klien.
    return adapter.whoami().then(function (w) {
      var user = { uid: w.email, email: w.email, name: w.name || who.name || w.email };
      if (!w.role || w.role === 'nonaktif') {
        U.state.user = user; U.state.role = null; whoChip();
        gate('<h2>Akun belum terdaftar</h2><p class="muted" style="margin:6px 0 10px">Akun <b>' + esc(w.email) + '</b> ' + (w.role === 'nonaktif' ? 'dinonaktifkan' : 'belum memiliki akses') + '. Minta admin mendaftarkan email ini (sheet <span class="mono">_Pengguna</span> atau menu Admin).</p>');
        return;
      }
      user.role = w.role; start(ST.createStore(adapter, user, C), user, w.role, mode);
    });
  }

  function bootFirebase() {
    var cfgW = window.IKPA_CONFIG || {}; if (!cfgW.WEBAPP_URL) { setupGate(); return; }
    // Konfigurasi web Firebase bersifat publik (sama dengan index.html); hanya dipakai untuk login Google & token. Tidak ada rahasia.
    var cfg = { apiKey: 'AIzaSyC_ZKnUwPv40f_GytMTHb1MTaPO_p5lPHY', authDomain: 'toring-ikpa-apps.firebaseapp.com', projectId: 'toring-ikpa-apps', appId: '1:59538058227:web:97d6ace98673d232bf0086' };
    if (typeof firebase === 'undefined' || !firebase.auth) { gate('<h2>Firebase tidak termuat</h2><p class="muted">Periksa koneksi internet / pemblokir skrip, lalu muat ulang.</p>'); return; }
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    var provider = new firebase.auth.GoogleAuthProvider(), started = false;
    firebase.auth().onAuthStateChanged(function (fu) {
      if (!fu) {
        started = false; U.state.user = null; whoChip();
        gate('<h2>Masuk diperlukan</h2><p class="muted" style="margin:6px 0 14px">Data pengajuan penyesuaian IKPA hanya dapat diakses oleh pengguna terdaftar. Masuk dengan akun Google Anda.</p><button class="btn p" id="btnIn">Masuk dengan Google</button><div id="gerr" class="alert e hide"></div>');
        U.$('#btnIn').onclick = function () { firebase.auth().signInWithPopup(provider).catch(function (e) { var g = U.$('#gerr'); g.classList.remove('hide'); g.textContent = 'Gagal masuk: ' + (e.code || '') + ' ' + (e.message || '') + (e.code === 'auth/operation-not-allowed' ? ' — penyedia Google belum diaktifkan di Firebase Authentication.' : ''); }); };
        return;
      }
      if (started) return; started = true;
      var adapter = new window.IkpaSheets.SheetsAdapter({ url: cfgW.WEBAPP_URL, getToken: function () { return fu.getIdToken(); }, C: C, satkerLookup: U.satkerInfo });
      openSession(adapter, { name: fu.displayName || '', email: fu.email || '' }, 'firebase').catch(function (e) { started = false; gate('<h2>Gagal menghubungi penyimpanan</h2><p class="muted">' + esc(U.errMsg(e)) + '</p><button class="btn" id="btnRetry">Coba lagi</button>'); U.$('#btnRetry').onclick = function () { started = true; openSession(adapter, { name: fu.displayName || '' }, 'firebase').catch(function (e2) { started = false; U.toast(U.errMsg(e2), 'e'); }); }; });
    });
  }

  U.boot = function () {
    shell();
    var q = new URLSearchParams(location.search), local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (local && q.get('adapter') === 'memory') { // HANYA untuk pengujian lokal; tidak aktif di domain produksi
      var ad = new ST.MemoryAdapter(), role = q.get('role') || 'admin', user = { uid: 'uji-' + role, name: 'Pengguna Uji (' + role + ')', email: 'uji@localhost', role: role };
      window.__ikpaTest = { adapter: ad };
      U.$('#banner').innerHTML = '<div class="banner test">MODE UJI LOKAL — data disimpan di memori peramban dan hilang saat halaman ditutup. Bukan data resmi.</div>';
      start(ST.createStore(ad, user, C), user, role, 'memory'); return;
    }
    if (local && q.get('webapp') && q.get('testtoken')) { // HANYA localhost: menguji ke web app tiruan tanpa login Google
      U.$('#banner').innerHTML = '<div class="banner test">MODE UJI LOKAL — terhubung ke web app uji, bukan spreadsheet produksi.</div>';
      var tk = q.get('testtoken'), ad2 = new window.IkpaSheets.SheetsAdapter({ url: q.get('webapp'), getToken: function () { return tk; }, C: C, satkerLookup: U.satkerInfo });
      window.__ikpaTest = { adapter: ad2 };
      openSession(ad2, {}, 'sheets-test').catch(function (e) { gate('<h2>Gagal</h2><p>' + esc(U.errMsg(e)) + '</p>'); }); return;
    }
    bootFirebase();
  };
})();
