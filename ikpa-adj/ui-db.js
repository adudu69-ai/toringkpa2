/* Tab 2 — Database Pengajuan: tabel, detail, form 4 bagian, impor Excel */
(function () {
  'use strict';
  var U = window.IkpaUI, C = U.C, esc = U.esc, S = C.S;
  var PAGE = 50, sort = { key: 'tanggalInput', dir: -1 }, page = 0, sel = {};

  var COLS = [
    ['tanggalInput', 'Tgl input', function (p) { return U.fmtDate(p.tanggalInput); }],
    ['tw', 'TW', function (p) { return p.tw ? 'TW ' + ['I', 'II', 'III', 'IV'][p.tw - 1] : '<span class="muted">—</span>'; }],
    ['submitter', 'Pengaju', function (p) { return esc(p.submitter); }],
    ['jalur', 'Jalur', function (p) { return U.jalurBadge(p.jalur); }],
    ['nomorND', 'Nomor ND', function (p) { return esc(p.nomorND); }],
    ['indikator', 'Indikator', function (p) { return esc(p.indikator); }],
    ['mekanisme', 'Mekanisme penyesuaian', function (p) { var t = U.mekText(p); return t ? '<span class="small">' + esc(t.length > 130 ? t.slice(0, 130) + '…' : t) + '</span>' : '<span class="muted">—</span>'; }],
    ['kdsatker', 'Satker', function (p) { return p.kdsatker ? '<b>' + esc(p.kdsatker) + '</b><br><span class="muted small">' + esc(p.namaSatker) + '</span>' : '<span class="badge b-gray" title="Satker belum dirinci">Eselon I</span><br><span class="small muted">' + esc(S(p.satkerRingkasan).slice(0, 60)) + '</span>'; }],
    ['status', 'Status', function (p) { return U.statusBadge(p); }],
    ['keterangan', 'Keterangan', function (p) { return '<span class="small">' + esc(S(p.keterangan).slice(0, 50)) + '</span>'; }],
    ['detailCount', 'Detail', function (p) { return p.detailCount ? p.detailLengkap + '/' + p.detailCount + (p.detailLengkap < p.detailCount ? ' <span class="badge b-pend">lengkapi</span>' : '') : '<span class="muted">0</span>'; }]
  ];

  function render(pane, o) {
    var L = U.filtered('db').slice(); var cnt = L.length;
    var key = sort.key; L.sort(function (a, b) { var x = a[key], y = b[key]; x = x === null || x === undefined ? '' : x; y = y === null || y === undefined ? '' : y; return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
    var pages = Math.max(1, Math.ceil(cnt / PAGE)); if (page >= pages) page = pages - 1;
    var rows = L.slice(page * PAGE, page * PAGE + PAGE), nSel = Object.keys(sel).length, w = U.can('tulisPengajuan');
    pane.innerHTML = U.filterBar('db', { jalur: true, search: true }) +
      '<div class="row sb" style="margin-bottom:8px"><div class="row">' +
      (w ? '<button class="btn p" id="dbAdd">+ Tambah pengajuan</button>' : '') + (U.can('impor') ? '<button class="btn" id="dbBulk">Impor daftar satker (Excel)</button><button class="btn" id="dbImp">Impor Excel format DB</button>' : '') + '<button class="btn" id="dbExp">Unduh tabel (.xlsx)</button></div>' +
      '<div class="row">' + (w ? '<span class="small muted">Terpilih: <b id="nSel">' + nSel + '</b></span><button class="btn sm" id="bkTw" ' + (nSel ? '' : 'disabled') + '>Set TW…</button><button class="btn sm" id="bkJal" ' + (nSel ? '' : 'disabled') + '>Set jalur…</button><button class="btn sm" id="bkSaran" ' + (nSel ? '' : 'disabled') + '>Terapkan saran jalur</button>' : '') + '</div></div>' +
      '<div class="tw"><table><thead><tr>' + (w ? '<th><input type="checkbox" id="selAll" aria-label="Pilih semua di halaman"></th>' : '') +
      COLS.map(function (c) { return '<th class="s" data-sort="' + c[0] + '">' + c[1] + (sort.key === c[0] ? (sort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('') + '<th></th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (p) {
        return '<tr class="cl" data-id="' + esc(p.id) + '">' + (w ? '<td><input type="checkbox" data-sel="' + esc(p.id) + '"' + (sel[p.id] ? ' checked' : '') + '></td>' : '') +
          COLS.map(function (c) { return '<td>' + c[2](p) + '</td>'; }).join('') + '<td><button class="btn sm" data-open="' + esc(p.id) + '">Buka</button></td></tr>';
      }).join('') : '<tr><td colspan="14" class="empty">' + (U.state.loaded ? (U.state.list.length ? 'Tidak ada pengajuan yang cocok dengan filter.' : 'Belum ada pengajuan untuk TA ' + esc(U.state.ta) + '.') : 'Memuat…') + '</td></tr>') +
      '</tbody></table></div><div class="pg"><button class="btn sm" id="pgP" ' + (page ? '' : 'disabled') + '>‹</button><span>Hal. ' + (page + 1) + ' / ' + pages + ' · ' + cnt + ' pengajuan</span><button class="btn sm" id="pgN" ' + (page < pages - 1 ? '' : 'disabled') + '>›</button></div>';
    U.bindFilters(pane, 'db', function (o2) { page = 0; render(pane); if (o2 && o2.keepFocus) { var el = U.$('[data-f="' + o2.keepFocus + '"]', pane); if (el) { el.focus(); var v = el.value; el.value = ''; el.value = v; } } });
    U.$$('[data-sort]', pane).forEach(function (th) { th.onclick = function () { var k = th.dataset.sort; sort = { key: k, dir: sort.key === k ? -sort.dir : 1 }; render(pane); }; });
    U.$$('tr.cl', pane).forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('input')) return; openDetail(tr.dataset.id); }; });
    U.$$('[data-sel]', pane).forEach(function (cb) { cb.onchange = function () { if (cb.checked) sel[cb.dataset.sel] = 1; else delete sel[cb.dataset.sel]; U.$('#nSel', pane).textContent = Object.keys(sel).length; ['bkTw', 'bkJal', 'bkSaran'].forEach(function (i) { U.$('#' + i, pane).disabled = !Object.keys(sel).length; }); }; });
    var sa = U.$('#selAll', pane); if (sa) sa.onchange = function () { rows.forEach(function (p) { if (sa.checked) sel[p.id] = 1; else delete sel[p.id]; }); render(pane); };
    U.$('#pgP', pane).onclick = function () { page--; render(pane); }; U.$('#pgN', pane).onclick = function () { page++; render(pane); };
    var a = U.$('#dbAdd', pane); if (a) a.onclick = function () { openForm(null); };
    var im = U.$('#dbImp', pane); if (im) im.onclick = openImport;
    var bk = U.$('#dbBulk', pane); if (bk) bk.onclick = function () { U.openBulk(); };
    U.$('#dbExp', pane).onclick = function () {
      var head = COLS.map(function (c) { return c[1]; }).concat(['Nama satker', 'Kode KPPN', 'K/L', 'Nomor dokumen', 'Sheet']);
      var aoa = [head].concat(L.map(function (p) { return [U.fmtDate(p.tanggalInput), p.tw ? 'TW' + p.tw : '', p.submitter, p.jalur, p.nomorND, p.indikator, U.mekText(p), p.kdsatker || p.satkerRingkasan, p.status + (p.pooling ? ' (Pooling)' : ''), p.keterangan, p.detailLengkap + '/' + p.detailCount, p.namaSatker, p.kdkppn, p.namaKL, '', p.sheet || '']; }));
      U.downloadAoa('Database_Pengajuan_IKPA_' + U.state.ta + '_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.xlsx', [{ name: 'Pengajuan', aoa: aoa }]); U.toast('Tabel diunduh (' + L.length + ' baris).', 's');
    };
    var ids = function () { return Object.keys(sel); };
    var bulk = function (title, fieldHtml, getPatch) {
      U.modal({ title: title + ' (' + ids().length + ' pengajuan)', sticky: true, body: '<div class="fg">' + fieldHtml + '<div class="fld full"><label class="req">Alasan / dasar</label><textarea id="bkR" rows="2"></textarea></div></div><p class="small muted">Setiap perubahan tercatat pada riwayat audit masing-masing pengajuan.</p><div id="bkE" class="alert e hide"></div>', footer: '<button class="btn" data-x="close">Batal</button><button class="btn p" id="bkOk">Terapkan</button>', onMount: function (m) {
        U.$('#bkOk', m.el).onclick = function () {
          var r = S(U.$('#bkR', m.el).value).trim(), pt = getPatch(m.el); if (!r) { var e = U.$('#bkE', m.el); e.textContent = 'Alasan wajib diisi'; e.classList.remove('hide'); return; }
          if (!pt) return; U.$('#bkOk', m.el).disabled = true;
          U.run(U.state.store.bulkUpdate(ids(), pt, r)).then(function (res) { m.close(); sel = {}; U.toast(res.done + ' diperbarui' + (res.failed.length ? ', ' + res.failed.length + ' gagal' : ''), res.failed.length ? 'e' : 's'); U.reload(); }, function () { U.$('#bkOk', m.el).disabled = false; });
        };
      } });
    };
    var b1 = U.$('#bkTw', pane); if (b1) b1.onclick = function () { bulk('Set triwulan', '<div class="fld"><label class="req">Triwulan</label><select id="bkV"><option value="">— pilih —</option><option value="1">TW I</option><option value="2">TW II</option><option value="3">TW III</option><option value="4">TW IV</option><option value="0">Kosongkan (belum ditentukan)</option></select></div>', function (el) { var v = U.$('#bkV', el).value; if (v === '') { U.toast('Pilih triwulan', 'e'); return null; } return { tw: v === '0' ? null : +v, twSumber: v === '0' ? 'BELUM' : 'MANUAL' }; }); };
    var b2 = U.$('#bkJal', pane); if (b2) b2.onclick = function () { bulk('Set jalur pengajuan', '<div class="fld"><label class="req">Jalur</label><select id="bkV"><option value="">— pilih —</option><option value="SATKER">Satker</option><option value="ESELON_I">Eselon I</option><option value="BELUM_DIVERIFIKASI">Belum diverifikasi</option></select></div>', function (el) { var v = U.$('#bkV', el).value; if (!v) { U.toast('Pilih jalur', 'e'); return null; } return { jalur: v }; }); };
    var b3 = U.$('#bkSaran', pane); if (b3) b3.onclick = function () {
      U.ask({ title: 'Terapkan saran jalur', msg: 'Saran jalur hanya berdasarkan nama pengaju ("Kanwil DJPb…" → Satker; selain itu → Eselon I). Ini <b>bukan fakta</b>; terapkan hanya bila Anda sudah memeriksanya. Pengajuan terpilih yang jalurnya sudah diverifikasi tidak diubah.', reason: 'Dasar verifikasi jalur', confirm: 'Terapkan' }).then(function (r) {
        if (!r) return; var by = { SATKER: [], ESELON_I: [] }; ids().forEach(function (id) { var p = U.state.list.filter(function (x) { return x.id === id; })[0]; if (!p || p.jalur !== 'BELUM_DIVERIFIKASI') return; var j = C.suggestJalur(p.submitter); if (j) by[j].push(id); });
        var st = U.state.store; Promise.all(['SATKER', 'ESELON_I'].map(function (j) { return by[j].length ? st.bulkUpdate(by[j], { jalur: j }, r.reason) : { done: 0, failed: [] }; })).then(function (rs) { sel = {}; U.toast((rs[0].done + rs[1].done) + ' pengajuan diperbarui.', 's'); U.reload(); }, function (e) { U.toast(U.errMsg(e), 'e'); });
      });
    };
  }
  U.registerTab('db', 'Database Pengajuan', render);

  /* ------------------------------------------------------- detail pengajuan */
  function kv(label, val) { return '<dt>' + esc(label) + '</dt><dd>' + (val === '' || val === null || val === undefined ? '<span class="muted">—</span>' : val) + '</dd>'; }
  function openDetail(id) {
    var st = U.state.store;
    var m = U.modal({ title: 'Detail pengajuan', wide: true, body: '<div class="empty"><span class="spin"></span> Memuat…</div>', footer: '' });
    Promise.all([st.getPengajuan(id), st.listDetails(id), st.linkedExceptions(id), st.listAudit('pengajuan', id, 40)]).then(function (r) {
      var p = r[0]; if (!p) { m.body().innerHTML = '<div class="alert e">Pengajuan tidak ditemukan.</div>'; return; }
      var details = r[1], excs = r[2], audit = r[3];
      m.el.querySelector('h2').textContent = 'Pengajuan ' + S(p.nomorND) + ' — ' + (p.kdsatker || 'Eselon I');
      m.body().innerHTML =
        '<div class="row" style="margin-bottom:8px">' + U.statusBadge(p) + ' ' + U.jalurBadge(p.jalur) + ' <span class="badge b-gray">' + U.twLabel(p.tw) + '</span> <span class="small muted">versi ' + esc(p.version) + ' · diperbarui ' + esc(U.fmtTs(p.updatedAt)) + ' oleh ' + esc(p.updatedBy) + '</span></div>' +
        '<div class="grid2"><div class="card"><h3>Pengajuan</h3><dl class="kv">' +
        kv('TA / Triwulan', esc(p.ta) + ' / ' + U.twLabel(p.tw) + (p.twSumber === 'SARAN' ? ' <span class="badge b-gray">dari saran teks</span>' : '')) + kv('Tanggal input', esc(U.fmtDate(p.tanggalInput))) + kv('Pengaju', esc(p.submitter)) + kv('Nomor / tanggal ND', esc(p.nomorND) + ' · ' + esc(U.fmtDate(p.tanggalND))) +
        kv('Nomor dokumen', esc(p.nomorDokumen)) + kv('Disimpan di', p.sheet ? 'Sheet “' + esc(p.sheet) + '”, baris ' + esc(p.row) : '') + kv('Uraian mekanisme', esc(p.mekanismeUraian)) + kv('Indikator', esc(p.indikator)) + kv('Satker', p.kdsatker ? esc(p.kdsatker + ' — ' + p.namaSatker) : 'Belum dirinci: ' + esc(p.satkerRingkasan)) + kv('KPPN / K/L', esc(p.kdkppn) + ' · ' + esc(p.namaKL || p.kl)) +
        kv('Keterangan', esc(p.keterangan)) + kv('Alasan penolakan', esc(p.alasanPenolakan)) + kv('Komponen', esc(p.komponen)) + kv('Exception (sumber)', esc(p.exceptionRaw) + (p.jenis ? ' → <span class="badge b-info">' + esc(p.jenis) + '</span>' : '')) + '</dl></div>' +
        '<div class="card"><h3>Kronologis &amp; catatan</h3><p style="white-space:pre-wrap">' + esc(p.kronologis) + '</p><hr style="border:0;border-top:1px solid var(--b);margin:10px 0"><p style="white-space:pre-wrap">' + esc(p.perbaikan) + '</p>' + (p.sumber && p.sumber.type === 'IMPOR' ? '<p class="small muted" style="margin-top:8px">Sumber impor: ' + esc(p.sumber.file) + ' baris ' + esc(p.sumber.baris) + '</p>' : '') + '</div></div>' +
        (p.warnings && p.warnings.length ? '<div class="alert w"><b>Catatan saat impor:</b><ul>' + p.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '') +
        '<div class="card"><h3>Mekanisme penyesuaian <small>(' + details.length + ')</small></h3>' + (details.length ? '<table><thead><tr><th>Mekanisme</th><th>Parameter teknis</th><th>Baris dihasilkan</th><th>Status</th></tr></thead><tbody>' + details.map(function (d) {
          var ex = C.expandDetail(d, p), bad = ex.errors.length || ex.rows.some(function (x) { return x.errors.length; });
          return '<tr><td><b>' + esc(C.describeDetail(d)) + '</b></td><td class="small">' + esc(Object.keys(d.params || {}).map(function (k) { return k + '=' + d.params[k]; }).join('; ')) + (d.satkerList && d.satkerList.length ? '<br>Satker: ' + esc(d.satkerList.join(', ')) : '') + '</td><td>' + ex.rows.length + '</td><td>' + (bad ? '<span class="badge b-pend">Perlu dilengkapi</span>' : '<span class="badge b-ok">Lengkap</span>') + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div class="empty">Belum ada mekanisme terstruktur. ' + (p.jenis ? 'Jenis pada sumber: <b>' + esc(C.JENIS_LABEL[p.jenis] || p.jenis) + '</b>. ' : '') + (p.status === 'Disetujui' ? '<b>Tanpa mekanisme terstruktur, pengajuan ini belum dapat menjadi kandidat Master Exception.</b>' : '') + '</div>') + '</div>' +
        '<div class="card"><h3>Exception teknis terkait <small>(' + excs.length + ')</small></h3>' + (excs.length ? '<table><thead><tr><th>Jenis</th><th>Identitas</th><th>Status</th><th>Pengajuan sumber</th><th></th></tr></thead><tbody>' + excs.map(function (e) {
          var refs = Object.keys(e.refs || {}).map(function (k) { return e.refs[k]; });
          return '<tr><td>' + esc(e.jenis) + '</td><td class="mono">' + esc(e.slotKey.split(C.SEP).slice(1).join(' | ')) + '</td><td>' + excBadge(e) + '</td><td>' + refs.map(function (r) { return '<span class="badge b-info" title="' + esc(r.nomorND) + '">' + esc(r.jalur === 'SATKER' ? 'Satker' : r.jalur === 'ESELON_I' ? 'Eselon I' : 'Belum diverifikasi') + ' · ' + esc(U.fmtDate(r.tanggalInput)) + '</span>'; }).join(' ') + '</td><td><button class="btn sm" data-exc="' + esc(e.thang + '|' + e.kdsatker + '|' + e.id) + '">Buka</button></td></tr>';
        }).join('') + '</tbody></table>' : '<div class="empty">Belum ada exception teknis yang dibangun dari pengajuan ini.</div>') + '</div>' +
        '<div class="card"><h3>Riwayat perubahan <small>(40 terakhir)</small></h3>' + auditTable(audit) + '</div>';
      var f = m.foot(); if (f) f.innerHTML = '<button class="btn" data-x="close">Tutup</button>' +
        (U.can('tulisPengajuan') ? '<button class="btn" id="dEdit">Ubah</button>' : '') + (U.can('batalkanPengajuan') && !p.dibatalkan ? '<button class="btn d" id="dCancel">Batalkan pengajuan</button>' : '') + (U.can('pulihkan') && p.dibatalkan ? '<button class="btn" id="dRestore">Pulihkan</button>' : '');
      if (!f.innerHTML) f.remove();
      U.$$('[data-exc]', m.el).forEach(function (b) { b.onclick = function () { var a = b.dataset.exc.split('|'); if (U.openException) U.openException(a[0], a[1], a[2]); }; });
      var e1 = U.$('#dEdit', m.el); if (e1) e1.onclick = function () { m.close(); openForm(id); };
      var e2 = U.$('#dCancel', m.el); if (e2) e2.onclick = function () { U.ask({ title: 'Batalkan pengajuan', msg: 'Pengajuan tidak dihapus; ia ditandai dibatalkan dan tidak dihitung. Kandidat exception yang belum diekspor akan dilepas.', reason: 'Alasan pembatalan', confirm: 'Batalkan', danger: true }).then(function (r) { if (r) U.run(st.cancelPengajuan(id, r.reason), 'Pengajuan dibatalkan').then(function () { m.close(); U.reload(); }); }); };
      var e3 = U.$('#dRestore', m.el); if (e3) e3.onclick = function () { U.run(st.restorePengajuan(id, 'Dipulihkan'), 'Dipulihkan').then(function () { m.close(); U.reload(); }); };
    }).catch(function (e) { m.body().innerHTML = '<div class="alert e">' + esc(U.errMsg(e)) + '</div>'; });
  }
  U.openPengajuan = openDetail;
  function excBadge(e) {
    if (e.exportedIn && Object.keys(e.exportedIn).length) return '<span class="badge b-ok">Sudah diekspor</span>';
    return { KANDIDAT: '<span class="badge b-info">Kandidat</span>', PERLU_VERIFIKASI: '<span class="badge b-dup">Potensi duplikat</span>', PERLU_DILENGKAPI: '<span class="badge b-pend">Perlu dilengkapi</span>' }[e.st] || '<span class="badge b-gray">' + esc(e.st) + '</span>';
  }
  U.excBadge = excBadge;
  function auditTable(a) {
    if (!a.length) return '<div class="empty">Belum ada riwayat.</div>';
    return '<div class="tw" style="max-height:260px"><table><thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Perubahan</th><th>Alasan</th></tr></thead><tbody>' + a.map(function (x) {
      var ch = ''; if (x.before && x.after && typeof x.after === 'object') ch = Object.keys(x.after).slice(0, 6).map(function (k) { return '<b>' + esc(k) + '</b>: ' + esc(JSON.stringify(x.before[k] === undefined ? null : x.before[k]).slice(0, 60)) + ' → ' + esc(JSON.stringify(x.after[k]).slice(0, 60)); }).join('<br>');
      return '<tr><td class="small">' + esc(U.fmtTs(x.ts)) + '</td><td>' + esc(x.name) + ' <span class="muted small">(' + esc(x.role) + ')</span></td><td>' + esc(x.action) + '</td><td class="small">' + ch + '</td><td class="small">' + esc(x.reason) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  U.auditTable = auditTable;

  /* ---------------------------------------------------------------- form */
  var JENIS_ORDER = C.SHEET_ORDER;
  function fieldHtml(f, v, prefix) {
    var id = prefix + '_' + f.key, val = v === undefined || v === null ? (f.def || '') : v, req = f.required ? ' req' : '', h = f.hint ? '<span class="hint">' + esc(f.hint) + '</span>' : '';
    var inp;
    if (f.type === 'select') inp = '<select id="' + id + '" data-k="' + f.key + '"><option value="">— pilih —</option>' + f.options.map(function (o) { return '<option value="' + esc(o.v) + '"' + (S(val) === S(o.v) ? ' selected' : '') + '>' + esc(o.l) + '</option>'; }).join('') + '</select>';
    else if (f.type === 'yn') inp = '<select id="' + id + '" data-k="' + f.key + '"><option value="N"' + (val === 'N' ? ' selected' : '') + '>N</option><option value="Y"' + (val === 'Y' ? ' selected' : '') + '>Y</option></select>';
    else if (f.type === 'textarea') inp = '<textarea id="' + id + '" data-k="' + f.key + '" rows="2">' + esc(val) + '</textarea>';
    else if (f.type === 'date') inp = '<input id="' + id + '" data-k="' + f.key + '" type="text" placeholder="dd-mm-yyyy" value="' + esc(val) + '">';
    else inp = '<input id="' + id + '" data-k="' + f.key + '" type="text" value="' + esc(val) + '">';
    return '<div class="fld' + (f.type === 'textarea' ? ' full' : '') + '"><label class="' + req.trim() + '" for="' + id + '">' + esc(f.label) + '</label>' + inp + h + '</div>';
  }
  var dseq = 0;

  function openForm(id) {
    var st = U.state.store, isEdit = !!id, fs = { p: null, details: [], removed: [], orig: {} };
    var m = U.modal({ title: isEdit ? 'Ubah pengajuan' : 'Tambah pengajuan', wide: true, sticky: true, body: '<div class="empty"><span class="spin"></span></div>', footer: '<button class="btn" data-x="close">Batal</button><button class="btn p" id="fSave">Simpan</button>' });
    (isEdit ? Promise.all([st.getPengajuan(id), st.listDetails(id)]) : Promise.resolve([null, []])).then(function (r) {
      fs.p = r[0] || { ta: U.state.ta, tw: null, jalur: 'BELUM_DIVERIFIKASI', status: 'Disetujui', tanggalInput: new Date().toISOString().slice(0, 10) };
      fs.details = r[1].map(function (d) { fs.orig[d.id] = JSON.stringify({ j: d.jenis, p: d.params, s: d.satkerList || [] }); return { _k: ++dseq, id: d.id, jenis: d.jenis, params: Object.assign({}, d.params), satkerList: (d.satkerList || []).slice() }; });
      draw();
    }, function (e) { m.body().innerHTML = '<div class="alert e">' + esc(U.errMsg(e)) + '</div>'; });

    function inp(idn, label, val, o) { o = o || {}; return '<div class="fld' + (o.full ? ' full' : '') + '" id="w_' + idn + '"><label class="' + (o.req ? 'req' : '') + '" for="f_' + idn + '">' + label + '</label>' + (o.tag === 'select' ? '<select id="f_' + idn + '">' + o.options.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (S(val) === S(x[0]) ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select>' : o.tag === 'textarea' ? '<textarea id="f_' + idn + '" rows="' + (o.rows || 2) + '">' + esc(val) + '</textarea>' : '<input id="f_' + idn + '" type="' + (o.type || 'text') + '" value="' + esc(val) + '"' + (o.list ? ' list="' + o.list + '"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + '>') + (o.hint ? '<span class="hint">' + o.hint + '</span>' : '') + '<span class="em" id="e_' + idn + '"></span></div>'; }

    function draw() {
      var p = fs.p, subs = U.uniq(U.state.list.map(function (x) { return x.submitter; }));
      m.body().innerHTML =
        '<datalist id="dlSub">' + subs.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' +
        '<div class="sec"><h4>1 · Identitas pengajuan</h4><div class="fg">' +
        inp('ta', 'Tahun anggaran', p.ta, { req: 1, tag: 'select', options: [2024, 2025, 2026, 2027].map(function (y) { return [String(y), String(y)]; }) }) +
        inp('tw', 'Triwulan', p.tw || '', { tag: 'select', options: [['', '— belum ditentukan —'], ['1', 'TW I'], ['2', 'TW II'], ['3', 'TW III'], ['4', 'TW IV']], hint: 'Diisi manual; tidak diturunkan dari tanggal input.' }) +
        inp('tanggalInput', 'Tanggal input', p.tanggalInput, { req: 1, type: 'date' }) +
        inp('jalur', 'Jalur pengajuan', p.jalur, { req: 1, tag: 'select', options: [['SATKER', 'Satker'], ['ESELON_I', 'Eselon I / K/L'], ['BELUM_DIVERIFIKASI', 'Belum diverifikasi']] }) +
        inp('submitter', 'Nama Kanwil DJPb / Eselon I K/L', p.submitter, { req: 1, list: 'dlSub' }) +
        inp('nomorND', 'Nomor ND', p.nomorND, { req: 1 }) + inp('tanggalND', 'Tanggal ND', p.tanggalND, { type: 'date' }) + inp('nomorDokumen', 'Nomor dokumen (mis. DIPA Revisi ke-5)', p.nomorDokumen) + '</div><div class="alert i small" id="sheetHint" style="margin-top:8px"></div></div>' +
        '<div class="sec"><h4>2 · Satker &amp; indikator</h4><div class="fg">' +
        '<div class="fld ac full" id="w_satker"><label for="f_satkerQ">Cari satker (kode 6 digit atau nama)</label><input id="f_satkerQ" autocomplete="off" value="' + esc(p.kdsatker ? p.kdsatker + ' — ' + (p.namaSatker || '') : '') + '" placeholder="mis. 691455 atau nama satker"><div class="ac-l hide" id="acl"></div><span class="hint">Sumber daftar: satker_db.js. Kosongkan bila pengajuan tingkat Eselon I belum merinci satker.</span><span class="em" id="e_satker"></span></div>' +
        inp('kdsatker', 'Kode satker', p.kdsatker || '', { hint: 'Harus 6 digit.' }) + inp('namaSatker', 'Nama satker', p.namaSatker || '') + inp('kdkppn', 'Kode KPPN', p.kdkppn || '') + inp('namaKL', 'Nama K/L', p.namaKL || '') + inp('kl', 'Kode K/L', p.kl || '') +
        inp('satkerRingkasan', 'Keterangan satker (bila belum dirinci)', p.satkerRingkasan || '', { full: 1 }) +
        inp('indikator', 'Indikator', p.indikator || '', { req: 1, tag: 'select', options: [['', '— pilih —']].concat(C.INDIKATOR.concat(p.indikator && C.INDIKATOR.indexOf(p.indikator) < 0 ? [p.indikator] : []).map(function (i) { return [i, i]; })) }) + inp('komponen', 'Komponen', p.komponen || '') + '</div>' +
        '<div style="margin-top:10px"><div class="small muted" style="margin-bottom:4px"><b>Riwayat pengajuan satker ini</b> (lintas triwulan &amp; tahun)</div><div class="hist" id="hist"><div class="empty small">Pilih satker untuk melihat riwayat.</div></div></div></div>' +
        '<div class="sec"><h4>3 · Status &amp; keterangan</h4><div class="fg">' +
        inp('status', 'Status', p.status, { req: 1, tag: 'select', options: [['Disetujui', 'Disetujui'], ['Pending', 'Pending'], ['Ditolak', 'Ditolak']] }) +
        inp('keterangan', 'Keterangan', p.keterangan || '', { hint: 'Mis. "Pooling (baru)" atau "selesai". Kata "pooling" menandai pengajuan sebagai Pooling.' }) +
        inp('alasanPenolakan', 'Alasan penolakan', p.alasanPenolakan || '', { full: 1 }) +
        inp('kronologis', 'Kronologis', p.kronologis || '', { tag: 'textarea', rows: 4, full: 1 }) + inp('perbaikan', 'Perbaikan / catatan', p.perbaikan || '', { tag: 'textarea', rows: 3, full: 1 }) +
        (isEdit ? inp('alasanUbah', 'Alasan perubahan (untuk riwayat audit)', '', { req: 1, full: 1 }) : '') + '</div></div>' +
        '<div class="sec"><h4>4 · Mekanisme penyesuaian <small class="muted" style="text-transform:none">(boleh lebih dari satu; mis. Deviasi Kegiatan — Kegiatan 7717, jenis belanja 52, TW II)</small></h4><div class="fg">' +
        inp('mekanismeUraian', 'Uraian mekanisme (teks bebas, opsional)', p.mekanismeUraian || '', { tag: 'textarea', rows: 2, full: 1, hint: 'Penjelasan singkat cara penyesuaian. Mekanisme terstruktur di bawah-lah yang dipakai untuk membangun Master Exception.' }) + '</div><div id="dets"></div>' +
        '<div class="row"><select id="newJenis"><option value="">+ Tambah mekanisme: pilih jenis…</option>' + JENIS_ORDER.map(function (j) { return '<option value="' + esc(j) + '">' + esc(C.JENIS_LABEL[j] || j) + (C.JENIS_LABEL[j] && C.JENIS_LABEL[j] !== j ? ' (' + esc(j) + ')' : '') + '</option>'; }).join('') + '<option value="" disabled>Deviasi PPR Terpusat — mapping belum tersedia</option></select><button class="btn" id="addDet">Tambah</button></div>' +
        '<div id="dupOut"></div></div><div id="formErr" class="alert e hide"></div>';
      bind(); drawDetails(); toggleReject(); updateSheetHint(); if (p.kdsatker) loadHist(p.kdsatker);
    }
    function g(idn) { var e = U.$('#f_' + idn, m.el); return e ? e.value : ''; }
    function updateSheetHint() {
      var h = U.$('#sheetHint', m.el); if (!h) return; var j = g('jalur'), nm = C.eselonSheetName(g('submitter'));
      h.innerHTML = j === 'ESELON_I' ? (nm ? 'Jalur Eselon I: pengajuan ini disimpan di sheet bernama <b>' + esc(nm) + '</b> (dibuat otomatis bila belum ada).' : 'Jalur Eselon I: isi nama Eselon I pada “Nama Kanwil DJPb / Eselon I K/L” — nama itu menjadi nama sheet.') : 'Pengajuan ini disimpan di sheet <b>Sheet1</b>' + (j === 'BELUM_DIVERIFIKASI' ? ' (jalur belum diverifikasi)' : ' (jalur Satker)') + '.';
    }
    function toggleReject() { var w = U.$('#w_alasanPenolakan', m.el); if (w) w.classList.toggle('hide', g('status') !== 'Ditolak'); }
    var histCache = {};
    function loadHist(kd) {
      var box = U.$('#hist', m.el); if (!/^\d{6}$/.test(kd)) { box.innerHTML = '<div class="empty small">Pilih satker untuk melihat riwayat.</div>'; return; }
      box.innerHTML = '<div class="empty small"><span class="spin"></span></div>';
      st.satkerHistory(kd).then(function (h) {
        histCache[kd] = h; if (g('kdsatker') !== kd) return; var cur = isEdit ? fs.p.id : null; h = h.filter(function (x) { return x.id !== cur; });
        box.innerHTML = h.length ? '<table><thead><tr><th>TA</th><th>TW</th><th>Tgl input</th><th>Indikator</th><th>Jalur</th><th>Status</th><th>ND</th><th>Mekanisme penyesuaian</th></tr></thead><tbody>' + h.map(function (x) { return '<tr' + (x.dibatalkan ? ' style="opacity:.5"' : '') + '><td>' + esc(x.ta) + '</td><td>' + (x.tw ? 'TW' + x.tw : '—') + '</td><td>' + esc(U.fmtDate(x.tanggalInput)) + '</td><td>' + esc(x.indikator) + '</td><td>' + U.jalurBadge(x.jalur) + '</td><td>' + U.statusBadge(x) + '</td><td class="small">' + esc(x.nomorND) + '</td><td class="small">' + (x.details.length ? x.details.map(function (d) { return esc(C.describeDetail(d)); }).join('<br>') : esc(U.mekText(x))) + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty small">Belum ada pengajuan tercatat untuk satker ' + esc(kd) + '.</div>';
      }, function (e) { box.innerHTML = '<div class="alert e">' + esc(U.errMsg(e)) + '</div>'; });
    }
    function setSatker(r) {
      U.$('#f_kdsatker', m.el).value = r.kode; U.$('#f_namaSatker', m.el).value = r.nama; U.$('#f_kdkppn', m.el).value = r.kdkppn; U.$('#f_namaKL', m.el).value = r.kl; U.$('#f_kl', m.el).value = r.klKode;
      U.$('#f_satkerQ', m.el).value = r.kode + ' — ' + r.nama; U.$('#acl', m.el).classList.add('hide'); loadHist(r.kode);
    }
    function bind() {
      var q = U.$('#f_satkerQ', m.el), acl = U.$('#acl', m.el);
      q.addEventListener('input', U.debounce(function () {
        var t = q.value.trim().toLowerCase(); if (t.length < 2) { acl.classList.add('hide'); return; }
        var out = []; (window.SATKER_DB || []).some(function (r) { if (r[0].indexOf(t) === 0 || r[1].toLowerCase().indexOf(t) > -1 || r[2].toLowerCase().indexOf(t) > -1) out.push(r); return out.length >= 12; });
        acl.innerHTML = out.length ? out.map(function (r) { return '<div data-k="' + r[0] + '"><b>' + esc(r[0]) + '</b> ' + esc(r[1]) + ' <span class="muted small">· ' + esc(r[2]) + '</span></div>'; }).join('') : '<div class="muted">Tidak ditemukan di satker_db.js</div>';
        acl.classList.remove('hide');
      }, 150));
      acl.addEventListener('mousedown', function (e) { var d = e.target.closest('[data-k]'); if (d) setSatker(U.satkerInfo(d.dataset.k)); });
      U.$('#f_kdsatker', m.el).addEventListener('input', function () { var v = this.value.trim(); if (/^\d{6}$/.test(v)) { var r = U.satkerInfo(v); if (r) setSatker(r); else loadHist(v); } });
      U.$('#f_status', m.el).addEventListener('change', toggleReject);
      ['f_jalur', 'f_submitter'].forEach(function (i) { var e = U.$('#' + i, m.el); if (e) { e.addEventListener('input', updateSheetHint); e.addEventListener('change', updateSheetHint); } });
      U.$('#addDet', m.el).onclick = function () { var j = U.$('#newJenis', m.el).value; if (!j) return; var d = { _k: ++dseq, jenis: j, params: {}, satkerList: [] }; (C.DETAIL_FIELDS[j] || []).forEach(function (f) { if (f.def) d.params[f.key] = f.def; }); fs.details.push(d); U.$('#newJenis', m.el).value = ''; drawDetails(); };
    }
    function readDetails() { // sinkronkan DOM -> fs.details
      fs.details.forEach(function (d) {
        var box = U.$('[data-dk="' + d._k + '"]', m.el); if (!box) return;
        U.$$('[data-k]', box).forEach(function (el) { d.params[el.dataset.k] = el.value; });
        var sl = U.$('[data-sl]', box); if (sl) d.satkerList = sl.value.split(/[\s,;]+/).filter(Boolean);
      });
    }
    function drawDetails() {
      var box = U.$('#dets', m.el), noSatker = !g('kdsatker').trim();
      box.innerHTML = fs.details.length ? fs.details.map(function (d) {
        var fields = C.DETAIL_FIELDS[d.jenis] || [];
        return '<div class="dt" data-dk="' + d._k + '"><div class="dt-h"><b>' + esc(C.JENIS_LABEL[d.jenis] || d.jenis) + '</b><span class="row"><span class="small muted" data-info></span><button class="btn sm d" data-del="' + d._k + '">Hapus mekanisme</button></span></div><div class="small mekline" data-mek style="margin:2px 0 8px"></div><div class="fg">' + fields.map(function (f) { return fieldHtml(f, d.params[f.key], 'd' + d._k); }).join('') +
          (noSatker ? '<div class="fld full"><label class="req">Daftar kode satker untuk mekanisme ini (satu per baris)</label><textarea data-sl rows="3">' + esc((d.satkerList || []).join('\n')) + '</textarea><span class="hint">Pengajuan tanpa kode satker harus merinci satker pada tiap detail.</span></div>' : '') + '</div></div>';
      }).join('') : '<div class="empty small">Belum ada mekanisme. Pengajuan boleh disimpan tanpa mekanisme, tetapi baru dapat menjadi kandidat Master Exception setelah mekanismenya dilengkapi.</div>';
      U.$$('[data-del]', box).forEach(function (b) { b.onclick = function () { readDetails(); var k = +b.dataset.del, d = fs.details.filter(function (x) { return x._k === k; })[0]; if (d.id) fs.removed.push(d.id); fs.details = fs.details.filter(function (x) { return x._k !== k; }); drawDetails(); }; });
      U.$$('[data-dk]', box).forEach(function (b) { b.addEventListener('input', refreshInfo); b.addEventListener('change', refreshInfo); });
      refreshInfo();
    }
    function pseudoP() {
      var o = {}; ['ta', 'tw', 'tanggalInput', 'jalur', 'mekanismeUraian', 'submitter', 'nomorND', 'tanggalND', 'nomorDokumen', 'kdsatker', 'namaSatker', 'kdkppn', 'namaKL', 'kl', 'satkerRingkasan', 'indikator', 'komponen', 'status', 'keterangan', 'alasanPenolakan', 'kronologis', 'perbaikan'].forEach(function (k) { o[k] = S(g(k)).trim(); });
      o.tw = o.tw ? +o.tw : null; o.pooling = C.isPooling(o.keterangan); o.kdsatker = o.kdsatker || null; return o;
    }
    function refreshInfo() {
      readDetails(); var p = Object.assign({ id: fs.p.id || 'NEW' }, pseudoP());
      fs.details.forEach(function (d) {
        var box = U.$('[data-dk="' + d._k + '"] [data-info]', m.el); if (!box) return; var ex = C.expandDetail({ id: d.id || 'x' + d._k, jenis: d.jenis, params: d.params, satkerList: d.satkerList }, p);
        var bad = ex.errors.length + ex.rows.filter(function (r) { return r.errors.length; }).length;
        var mk = U.$('[data-dk="' + d._k + '"] [data-mek]', m.el); if (mk) mk.innerHTML = '<b>Ringkasan:</b> ' + esc(C.describeDetail({ jenis: d.jenis, params: d.params, satkerList: d.satkerList }));
        box.innerHTML = ex.rows.length + ' baris Master Exception · ' + (bad ? '<span style="color:var(--w);font-weight:600">' + bad + ' perlu dilengkapi</span>' : '<span style="color:var(--g);font-weight:600">lengkap</span>');
      });
    }
    function checkDup(p) { // -> Promise<[{detail, preview}]>
      readDetails(); var kds = {}; fs.details.forEach(function (d) { var ex = C.expandDetail({ id: d.id || 'x', jenis: d.jenis, params: d.params, satkerList: d.satkerList }, p); ex.rows.forEach(function (r) { var sk = S(r.row[C.TYPES[d.jenis].satkerKey || 'KDSATKER']); if (/^\d{6}$/.test(sk)) kds[sk + '|' + S(r.row.THANG)] = [S(r.row.THANG), sk]; }); });
      var pairs = Object.keys(kds).slice(0, 30).map(function (k) { return kds[k]; });
      return Promise.all(pairs.map(function (pr) { return histCache[pr[1]] ? histCache[pr[1]] : st.satkerHistory(pr[1]); })).then(function (hs) {
        var others = [].concat.apply([], hs).map(function (x) { return { pengajuan: x, details: x.details }; });
        return st.loadExceptionsFor(pairs).then(function (excs) {
          return fs.details.map(function (d) { return { d: d, rows: C.previewAgainst({ pengajuan: p, detail: { id: d.id || 'x' + d._k, jenis: d.jenis, params: d.params, satkerList: d.satkerList } }, others, excs) }; });
        });
      });
    }
    function dupHtml(res) {
      var any = false, h = res.map(function (r) {
        var hits = r.rows.filter(function (x) { return x.hits.length; }); if (!hits.length) return ''; any = true;
        return '<div class="card"><h3>' + esc(r.d.jenis) + ' <small>' + hits.length + ' baris dengan kecocokan</small></h3>' + hits.slice(0, 6).map(function (x) {
          return x.hits.map(function (ht) {
            var who = ht.kind === 'EXCEPTION' ? 'Exception ' + (ht.exc.st === 'TEREKSPOR' || (ht.exc.exportedIn && Object.keys(ht.exc.exportedIn).length) ? '(sudah diekspor)' : '(' + ht.exc.st + ')') : 'Pengajuan ' + esc(ht.pengajuan.nomorND) + ' · ' + esc(U.jalurLabel(ht.pengajuan.jalur)) + ' · ' + esc(U.fmtDate(ht.pengajuan.tanggalInput));
            return '<div style="margin:6px 0"><span class="badge ' + (ht.outcome === 'IDENTIK' ? 'b-ok' : 'b-dup') + '">' + (ht.outcome === 'IDENTIK' ? 'IDENTIK' : 'POTENSI DUPLIKAT') + '</span> <span class="small">dengan ' + who + '</span>' + (ht.diff.length ? '<table class="cmp"><thead><tr><th>Atribut</th><th>Baru</th><th>Existing</th></tr></thead><tbody>' + ht.diff.map(function (df) { return '<tr class="' + (df.substantif ? 'df' : '') + '"><td class="k">' + esc(df.field) + '</td><td>' + esc(df.a) + '</td><td>' + esc(df.b) + '</td></tr>'; }).join('') + '</tbody></table>' : '') + '</div>';
          }).join('');
        }).join('') + '</div>';
      }).join('');
      return { any: any, html: h };
    }
    U.jalurLabel = function (j) { return j === 'SATKER' ? 'Satker' : j === 'ESELON_I' ? 'Eselon I' : 'Belum diverifikasi'; };

    function validate() {
      var errs = {}, p = pseudoP();
      U.$$('.fld.err', m.el).forEach(function (e) { e.classList.remove('err'); }); U.$$('.em', m.el).forEach(function (e) { e.textContent = ''; });
      var list = st.validatePengajuan(Object.assign({}, p, { kdsatker: p.kdsatker }));
      var map = { 'Tahun anggaran': 'ta', 'Tanggal input': 'tanggalInput', 'Kanwil': 'submitter', 'Nomor ND': 'nomorND', 'Indikator': 'indikator', 'Kode satker': 'kdsatker', 'Alasan penolakan': 'alasanPenolakan', 'Status': 'status', 'Jalur': 'jalur' };
      list.forEach(function (msg) { var k = Object.keys(map).filter(function (m0) { return msg.indexOf(m0) === 0; })[0]; var idn = map[k] || 'ta'; var w = U.$('#w_' + idn, m.el); if (w) { w.classList.add('err'); U.$('#e_' + idn, m.el).textContent = msg; } });
      if (isEdit && !S(g('alasanUbah')).trim()) { list.push('Alasan perubahan wajib'); var w2 = U.$('#w_alasanUbah', m.el); w2.classList.add('err'); U.$('#e_alasanUbah', m.el).textContent = 'Wajib diisi'; }
      var noSat = !p.kdsatker, noRing = !p.satkerRingkasan; if (noSat && noRing) { U.$('#e_satker', m.el).textContent = 'Pilih satker, atau isi keterangan satker bila pengajuan tingkat Eselon I.'; }
      fs.details.forEach(function (d) { if (!d.jenis) list.push('Detail tanpa jenis'); });
      return { list: list, p: p };
    }
    function doSave(p) {
      var btn = U.$('#fSave', m.el); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Menyimpan…'; readDetails();
      var base = Object.assign({}, fs.p, p, { twSumber: p.tw ? (fs.p.tw === p.tw ? (fs.p.twSumber || 'MANUAL') : 'MANUAL') : 'BELUM' });
      var reason = isEdit ? S(g('alasanUbah')).trim() : 'Pengajuan baru';
      var dets = fs.details.map(function (d) { return { id: d.id, jenis: d.jenis, params: d.params, satkerList: d.satkerList || [] }; });
      U.run(st.saveBundle(base, dets, fs.removed, { expectVersion: fs.p.version, reason: reason })).then(function () { m.close(); U.toast('Pengajuan disimpan' + (U.state.mode === 'sheets' ? ' ke spreadsheet.' : '.'), 's'); U.reload(); })
        .catch(function (e) { btn.disabled = false; btn.textContent = 'Simpan'; var er = U.$('#formErr', m.el); er.textContent = U.errMsg(e); er.classList.remove('hide'); });
    }
    U.$('#fSave', m.el).onclick = function () {
      var v = validate(); var er = U.$('#formErr', m.el);
      if (v.list.length) { er.classList.remove('hide'); er.innerHTML = '<b>Lengkapi isian:</b><ul>' + v.list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; return; }
      er.classList.add('hide');
      U.$('#fSave', m.el).disabled = true;
      checkDup(Object.assign({ id: fs.p.id || 'NEW' }, v.p)).then(function (res) {
        U.$('#fSave', m.el).disabled = false; var d = dupHtml(res); var out = U.$('#dupOut', m.el);
        if (!d.any || out.dataset.ack === '1') { doSave(v.p); return; }
        out.innerHTML = '<div class="alert w"><b>Pemeriksaan duplikasi:</b> ditemukan kecocokan dengan pengajuan/exception yang sudah ada. Pengajuan tetap dapat disimpan (riwayat administratif tidak dihapus); keputusan penggabungan dilakukan saat membangun kandidat Master Exception.</div>' + d.html + '<button class="btn p" id="dupOk">Simpan tetap</button>';
        U.$('#dupOk', m.el).onclick = function () { out.dataset.ack = '1'; doSave(v.p); }; out.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, function (e) { U.$('#fSave', m.el).disabled = false; U.toast(U.errMsg(e), 'e'); });
    };
  }

  /* ----------------------------------------------------------- impor Excel */
  var FIELD_LABEL = { noSumber: 'No', tanggalInput: 'Tanggal Input *', submitter: 'Nama Kanwil/Eselon I', nomorND: 'Nomor ND *', tanggalND: 'Tanggal ND', indikator: 'Indikator *', kodeSatker: 'Kode Satker *', kdkppn: 'Kode KPPN', nomorDokumen: 'Nomor Dokumen', status: 'Status *', keterangan: 'Keterangan', alasanPenolakan: 'Alasan Penolakan', komponen: 'Komponen', exceptionRaw: 'Exception', kronologis: 'Kronologis', perbaikan: 'Perbaikan/Catatan', kl: 'K/L', namaKL: 'Nama K/L', satkerAlt: 'Satker (alt)', namaSatker: 'Nama Satker' };
  function openImport() {
    var wbk = null, st = U.state.store, aoa = null, parsed = null, fileName = '', fileHash = '';
    var m = U.modal({ title: 'Impor DB Penyesuaian IKPA (Excel)', wide: true, sticky: true, body:
      '<div class="alert i">Impor bersifat <b>idempoten</b>: baris yang sama tidak dibuat dua kali. Nilai asal dipertahankan; <b>triwulan, revisi, dan jalur pengajuan tidak ditebak</b> (jalur diset <i>Belum diverifikasi</i>). Data hanya dikirim ke database aplikasi Anda.</div>' +
      '<div class="fg"><div class="fld"><label class="req">Berkas .xlsx</label><input type="file" id="iFile" accept=".xlsx,.xls,.xlsm"></div><div class="fld"><label class="req">Tahun anggaran</label><select id="iTa">' + [2024, 2025, 2026, 2027].map(function (y) { return '<option' + (String(y) === U.state.ta ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select></div>' +
      '<div class="fld"><label>Sheet</label><select id="iSheet"></select></div><div class="fld"><label>Triwulan untuk semua baris (opsional)</label><select id="iTw"><option value="">Biarkan belum ditentukan</option><option value="1">TW I</option><option value="2">TW II</option><option value="3">TW III</option><option value="4">TW IV</option></select><span class="hint">Hanya bila seluruh isi berkas memang satu triwulan.</span></div>' +
      '<div class="fld full"><label><input type="checkbox" id="iSug"> Isi TW dari <i>saran</i> teks bila terdeteksi tepat satu triwulan (tetap bisa dikoreksi)</label></div></div>' +
      '<div id="iMap"></div><div id="iPrev"></div>', footer: '<button class="btn" data-x="close">Tutup</button><button class="btn p" id="iGo" disabled>Impor ke database</button>' });
    var colMap = null;
    function reparse() {
      if (!aoa) return; var tw = U.$('#iTw', m.el).value;
      parsed = C.parseDbRows(aoa, { ta: U.$('#iTa', m.el).value, tw: tw || null, useTwSuggestion: U.$('#iSug', m.el).checked, fileName: fileName, fileHash: fileHash, colMap: colMap });
      var hdr = aoa[0] || [], map = parsed.map;
      U.$('#iMap', m.el).innerHTML = '<details' + (parsed.missingColumns.length ? ' open' : '') + '><summary><b>Pemetaan kolom</b> ' + (parsed.missingColumns.length ? '<span class="badge b-no">kolom wajib belum terpetakan: ' + parsed.missingColumns.map(function (x) { return esc(FIELD_LABEL[x]); }).join(', ') + '</span>' : '<span class="badge b-ok">otomatis dari judul kolom</span>') + '</summary><div class="fg" style="margin-top:8px">' +
        Object.keys(FIELD_LABEL).map(function (f) { return '<div class="fld"><label>' + esc(FIELD_LABEL[f]) + '</label><select data-map="' + f + '"><option value="">— tidak dipakai —</option>' + hdr.map(function (h, i) { return '<option value="' + i + '"' + (map[f] === i ? ' selected' : '') + '>' + C.colLetter(i) + ' · ' + esc(S(h)) + '</option>'; }).join('') + '</select></div>'; }).join('') + '</div></details>';
      U.$$('[data-map]', m.el).forEach(function (s) { s.onchange = function () { colMap = Object.assign({}, parsed.map); U.$$('[data-map]', m.el).forEach(function (x) { if (x.value === '') delete colMap[x.dataset.map]; else colMap[x.dataset.map] = +x.value; }); reparse(); }; });
      var sm = parsed.summary, rec = parsed.records;
      U.$('#iPrev', m.el).innerHTML = parsed.missingColumns.length ? '' :
        '<div class="kpis" style="margin-top:10px"><div class="kpi"><div class="n">' + sm.total + '</div><div class="l">Baris terbaca</div></div><div class="kpi g"><div class="n">' + sm.valid + '</div><div class="l">Valid</div></div><div class="kpi r"><div class="n">' + sm.invalid + '</div><div class="l">Tidak valid (tidak diimpor)</div></div><div class="kpi w"><div class="n">' + sm.warnings + '</div><div class="l">Dengan catatan</div></div><div class="kpi w"><div class="n">' + sm.eselonRingkasan + '</div><div class="l">Satker berupa ringkasan (Eselon I)</div></div><div class="kpi"><div class="n">' + sm.duplikatDalamFile + '</div><div class="l">Baris identik dalam berkas</div></div></div>' +
        (parsed.rowErrors.length ? '<div class="alert e"><b>Baris tidak valid</b> (maks. 15):<ul>' + parsed.rowErrors.slice(0, 15).map(function (r) { return '<li>Baris ' + r.row + ': ' + esc(r.errors.join('; ')) + '</li>'; }).join('') + '</ul></div>' : '') +
        '<div class="tw" style="max-height:260px"><table><thead><tr><th>Tgl input</th><th>Pengaju</th><th>ND</th><th>Indikator</th><th>Satker</th><th>Status</th><th>Jenis (sumber)</th><th>Catatan</th></tr></thead><tbody>' + rec.slice(0, 12).map(function (r) { return '<tr><td>' + esc(U.fmtDate(r.tanggalInput)) + '</td><td>' + esc(r.submitter) + '</td><td>' + esc(r.nomorND) + '</td><td>' + esc(r.indikator) + '</td><td>' + esc(r.kdsatker || r.satkerRingkasan.slice(0, 30)) + '</td><td>' + esc(r.status) + (r.pooling ? ' · Pooling' : '') + '</td><td>' + esc(r.jenis || r.exceptionRaw) + '</td><td class="small">' + esc(r.warnings.join('; ')) + '</td></tr>'; }).join('') + '</tbody></table></div><p class="small muted">Menampilkan 12 baris pertama dari ' + rec.length + '.</p>';
      U.$('#iGo', m.el).disabled = !(rec.length && !parsed.missingColumns.length);
    }
    U.$('#iFile', m.el).onchange = function () {
      var f = this.files[0]; if (!f) return; fileName = f.name; var rd = new FileReader();
      rd.onload = function () {
        try {
          wbk = C.readWorkbookAoa(XLSX, new Uint8Array(rd.result), 'array');
          var names = wbk.names, pick = names.filter(function (n) { var a = wbk.sheets[n]; return a && a[0] && Object.keys(C.detectColumns(a[0])).length >= 8; })[0] || names[0];
          U.$('#iSheet', m.el).innerHTML = names.map(function (n) { return '<option' + (n === pick ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
          if (wbk.missing.length) U.toast('Sheet tidak terbaca: ' + wbk.missing.join(', '), 'e');
          pickSheet();
        } catch (e) { U.toast('Gagal membaca berkas: ' + e.message, 'e'); }
      }; rd.readAsArrayBuffer(f);
      function pickSheet() { var n = U.$('#iSheet', m.el).value; aoa = wbk.sheets[n] || []; colMap = null; fileHash = C.hash(fileName + '|' + f.size + '|' + n + '|' + JSON.stringify(aoa.slice(0, 3)) + aoa.length); reparse(); }
      U.$('#iSheet', m.el).onchange = pickSheet;
    };
    ['iTa', 'iTw', 'iSug'].forEach(function (i) { U.$('#' + i, m.el).onchange = reparse; });
    U.$('#iGo', m.el).onclick = function () {
      U.$('#iGo', m.el).disabled = true; U.$('#iGo', m.el).innerHTML = '<span class="spin"></span> Mengimpor…';
      U.run(st.importPengajuan(parsed.records, { file: fileName, fileHash: fileHash, ta: U.$('#iTa', m.el).value })).then(function (r) {
        m.body().insertAdjacentHTML('afterbegin', '<div class="alert s"><b>Selesai.</b> ' + r.created + ' pengajuan baru dibuat, ' + r.skipped + ' sudah ada (dilewati).</div>');
        U.$('#iGo', m.el).textContent = 'Selesai'; U.state.ta = U.$('#iTa', m.el).value; U.reload();
      }, function () { U.$('#iGo', m.el).disabled = false; U.$('#iGo', m.el).textContent = 'Impor ke database'; });
    };
  }
  /* ----------------------------------------- impor daftar satker (satu berkas, banyak satker) */
  function openBulk() {
    var st = U.state.store, wbk = null, aoa = null, fileName = '', fileHash = '', batch = null, colMap = null, fileSize = 0;
    var subs = U.uniq(U.state.list.map(function (x) { return x.submitter; }).concat(st.adapter.sheetNames ? st.adapter.sheetNames() : []));
    var sel = function (id, label, opts, val, req) { return '<div class="fld"><label class="' + (req ? 'req' : '') + '" for="' + id + '">' + label + '</label><select id="' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (S(val) === S(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>'; };
    var txt = function (id, label, val, o) { o = o || {}; return '<div class="fld' + (o.full ? ' full' : '') + '"><label class="' + (o.req ? 'req' : '') + '" for="' + id + '">' + label + '</label>' + (o.ta ? '<textarea id="' + id + '" rows="' + (o.rows || 2) + '">' + esc(val) + '</textarea>' : '<input id="' + id + '" type="' + (o.type || 'text') + '" value="' + esc(val) + '"' + (o.list ? ' list="' + o.list + '"' : '') + '>') + (o.hint ? '<span class="hint">' + o.hint + '</span>' : '') + '</div>'; };
    var m = U.modal({ title: 'Impor daftar satker (Excel)', wide: true, sticky: true, body:
      '<div class="alert i">Satu berkas Excel berisi <b>banyak satker</b>. Data pengajuan (ND, indikator, status, …) dan <b>mekanisme penyesuaian</b> diisi sekali di bawah; tiap baris Excel menjadi <b>satu pengajuan per satker</b>. Kolom Excel yang diisi (TW, indikator, status, parameter mekanisme) <b>menimpa</b> nilai default untuk satker itu. Impor idempoten: berkas yang sama tidak menggandakan data. Triwulan tidak ditebak.</div>' +
      '<datalist id="dlSubB">' + subs.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
      '<div class="sec"><h4>1 · Data pengajuan (berlaku untuk semua satker pada berkas)</h4><div class="fg">' +
      sel('b_ta', 'Tahun anggaran', [2024, 2025, 2026, 2027].map(function (y) { return [String(y), String(y)]; }), U.state.ta, 1) +
      sel('b_jalur', 'Jalur pengajuan', [['', '— pilih —'], ['SATKER', 'Satker'], ['ESELON_I', 'Eselon I / K/L'], ['BELUM_DIVERIFIKASI', 'Belum diverifikasi']], '', 1) +
      txt('b_submitter', 'Nama Kanwil DJPb / Eselon I K/L', '', { req: 1, list: 'dlSubB' }) +
      txt('b_nomorND', 'Nomor ND', '', { req: 1 }) + txt('b_tanggalND', 'Tanggal ND', '', { type: 'date' }) + txt('b_tanggalInput', 'Tanggal input', new Date().toISOString().slice(0, 10), { type: 'date', req: 1 }) +
      sel('b_indikator', 'Indikator', [['', '— pilih —']].concat(C.INDIKATOR.map(function (i) { return [i, i]; })), '', 1) +
      sel('b_status', 'Status', [['Disetujui', 'Disetujui'], ['Pending', 'Pending'], ['Ditolak', 'Ditolak']], 'Disetujui', 1) +
      sel('b_tw', 'Triwulan (default)', [['', '— belum ditentukan —'], ['1', 'TW I'], ['2', 'TW II'], ['3', 'TW III'], ['4', 'TW IV']], '') +
      txt('b_nomorDokumen', 'Nomor dokumen', '') + txt('b_keterangan', 'Keterangan', '') + txt('b_alasan', 'Alasan penolakan (bila Ditolak)', '') +
      txt('b_kronologis', 'Kronologis', '', { ta: 1, rows: 3, full: 1 }) +
      '</div><div class="alert i small" id="bHint" style="margin-top:8px"></div></div>' +
      '<div class="sec"><h4>2 · Mekanisme penyesuaian (default untuk semua satker)</h4><div class="fg">' +
      '<div class="fld"><label for="b_jenis">Jenis mekanisme</label><select id="b_jenis"><option value="">— tanpa mekanisme terstruktur —</option>' + JENIS_ORDER.map(function (j) { return '<option value="' + esc(j) + '">' + esc(C.JENIS_LABEL[j] || j) + '</option>'; }).join('') + '</select></div>' +
      txt('b_uraian', 'Uraian mekanisme (teks bebas, opsional)', '', { ta: 1, rows: 2, full: 1 }) + '</div><div id="bMech" class="fg" style="margin-top:8px"></div></div>' +
      '<div class="sec"><h4>3 · Berkas Excel daftar satker</h4><div class="fg"><div class="fld"><label class="req">Berkas .xlsx</label><input type="file" id="b_file" accept=".xlsx,.xls,.xlsm"></div><div class="fld"><label>Sheet</label><select id="b_sheet"></select></div>' +
      '<div class="fld"><label>Belum punya berkas?</label><button class="btn" id="b_tpl" type="button">Unduh templat kosong</button><span class="hint">Berisi judul kolom saja (tanpa data contoh).</span></div></div><div id="bMap"></div><div id="bPrev"></div></div>' +
      '<div id="bErr" class="alert e hide"></div>', footer: '<button class="btn" data-x="close">Tutup</button><button class="btn p" id="b_go" disabled>Impor ke spreadsheet</button>' });
    var $ = function (sel0) { return U.$(sel0, m.el); }, val = function (id) { return S($('#' + id).value).trim(); };

    function drawMech() {
      var j = val('b_jenis'), box = $('#bMech'); box.innerHTML = j ? (C.DETAIL_FIELDS[j] || []).filter(function (f) { return f.key !== 'thang'; }).map(function (f) { return fieldHtml(f, undefined, 'bm'); }).join('') + '<div class="fld full small muted">Isi nilai default; kolom Excel dengan judul yang sama (mis. “Kode kegiatan”) menimpa per satker.</div>' : '';
      U.$$('[data-k]', box).forEach(function (el) { el.addEventListener('input', reparse); el.addEventListener('change', reparse); });
      reparse();
    }
    function hint() {
      var j = val('b_jalur'), nm = C.eselonSheetName(val('b_submitter'));
      $('#bHint').innerHTML = j === 'ESELON_I' ? (nm ? 'Disimpan di sheet <b>' + esc(nm) + '</b> (dibuat otomatis bila belum ada).' : 'Jalur Eselon I: isi nama Eselon I — nama itu menjadi nama sheet.') : (j ? 'Disimpan di sheet <b>Sheet1</b>.' : 'Pilih jalur pengajuan (tidak ditebak).');
    }
    function common() {
      return { ta: val('b_ta'), tw: val('b_tw') || null, tanggalInput: val('b_tanggalInput'), jalur: val('b_jalur'), submitter: val('b_submitter'), nomorND: val('b_nomorND'), tanggalND: val('b_tanggalND'), indikator: val('b_indikator'), status: val('b_status'), keterangan: val('b_keterangan'), nomorDokumen: val('b_nomorDokumen'), alasanPenolakan: val('b_alasan'), kronologis: val('b_kronologis'), mekanismeUraian: val('b_uraian'), komponen: '', perbaikan: '' };
    }
    function mech() { var j = val('b_jenis'); if (!j) return null; var params = {}; U.$$('#bMech [data-k]', m.el).forEach(function (el) { if (S(el.value) !== '') params[el.dataset.k] = el.value; }); return { jenis: j, params: params }; }
    function reparse() {
      hint(); var err = $('#bErr'); err.classList.add('hide');
      if (!aoa) { $('#b_go').disabled = true; return; }
      var com = common(), mc = mech(), existing = st.adapter.existingIds ? st.adapter.existingIds() : {};
      U.state.list.forEach(function (x) { existing[x.id] = 1; });
      batch = C.buildSatkerBatch(aoa, { common: com, mech: mc, colMap: colMap, lookup: U.satkerInfo, existingIds: existing });
      var hdr = aoa[0] || [], fields = C.bulkFields(mc && mc.jenis);
      $('#bMap').innerHTML = '<details' + (batch.missing.length ? ' open' : '') + '><summary><b>Pemetaan kolom</b> ' + (batch.missing.length ? '<span class="badge b-no">kolom Kode Satker belum terpetakan</span>' : '<span class="badge b-ok">otomatis dari judul kolom</span>') + '</summary><div class="fg" style="margin-top:8px">' +
        fields.map(function (f) { return '<div class="fld"><label>' + esc(f.label) + (f.req ? ' *' : '') + '</label><select data-bmap="' + esc(f.key) + '"><option value="">— tidak dipakai —</option>' + hdr.map(function (h, i) { return '<option value="' + i + '"' + (batch.map[f.key] === i ? ' selected' : '') + '>' + C.colLetter(i) + ' · ' + esc(S(h)) + '</option>'; }).join('') + '</select></div>'; }).join('') + '</div></details>';
      U.$$('[data-bmap]', m.el).forEach(function (x) { x.onchange = function () { colMap = Object.assign({}, batch.map); U.$$('[data-bmap]', m.el).forEach(function (y) { if (y.value === '') delete colMap[y.dataset.bmap]; else colMap[y.dataset.bmap] = +y.value; }); reparse(); }; });
      var sm = batch.summary, rows = batch.rows;
      var commonErr = st.validatePengajuan(Object.assign({}, com, { id: 'x', kdsatker: '000000' })).filter(function (e) { return !/^Kode satker/.test(e); });
      $('#bPrev').innerHTML = batch.missing.length ? '' :
        (commonErr.length ? '<div class="alert w"><b>Lengkapi data pengajuan (bagian 1):</b><ul>' + commonErr.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>' : '') +
        '<div class="kpis" style="margin-top:10px"><div class="kpi"><div class="n">' + sm.total + '</div><div class="l">Baris terbaca</div></div><div class="kpi g"><div class="n">' + sm.baru + '</div><div class="l">Akan dibuat</div></div><div class="kpi"><div class="n">' + sm.sudahAda + '</div><div class="l">Sudah ada (dilewati)</div></div><div class="kpi w"><div class="n">' + sm.duplikatBerkas + '</div><div class="l">Ganda dalam berkas</div></div><div class="kpi r"><div class="n">' + sm.tidakValid + '</div><div class="l">Tidak valid</div></div><div class="kpi w"><div class="n">' + sm.mekanismeBelumLengkap + '</div><div class="l">Mekanisme belum lengkap</div></div><div class="kpi w"><div class="n">' + sm.tidakAdaDiDb + '</div><div class="l">Tidak ada di satker_db.js</div></div></div>' +
        '<div class="tw" style="max-height:280px"><table><thead><tr><th>Baris</th><th>Kode satker</th><th>Nama (satker_db.js)</th><th>TW</th><th>Hasil</th><th>Catatan</th></tr></thead><tbody>' + rows.slice(0, 20).map(function (r) {
          var cls = { BARU: 'b-ok', SUDAH_ADA: 'b-gray', DUPLIKAT_BERKAS: 'b-pend', TIDAK_VALID: 'b-no' }[r.status];
          return '<tr><td>' + r.row + '</td><td><b>' + esc(r.kode) + '</b></td><td class="small">' + esc(r.pengajuan.namaSatker) + '</td><td>' + (r.pengajuan.tw ? 'TW' + r.pengajuan.tw : '—') + '</td><td><span class="badge ' + cls + '">' + r.status.replace('_', ' ') + '</span></td><td class="small">' + esc(r.errors.concat(r.warnings).join('; ')) + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="small muted">Menampilkan 20 baris pertama dari ' + rows.length + '.</p>';
      $('#b_go').disabled = !(sm.baru > 0 && !commonErr.length && !batch.missing.length);
    }
    drawMech();
    ['b_ta', 'b_jalur', 'b_submitter', 'b_nomorND', 'b_tanggalND', 'b_tanggalInput', 'b_indikator', 'b_status', 'b_tw', 'b_nomorDokumen', 'b_keterangan', 'b_alasan', 'b_kronologis', 'b_uraian'].forEach(function (id) { $('#' + id).addEventListener('input', reparse); $('#' + id).addEventListener('change', reparse); });
    $('#b_jenis').onchange = function () { colMap = null; drawMech(); };
    $('#b_tpl').onclick = function () { var j = val('b_jenis'); U.downloadAoa('Templat_Impor_Satker' + (j ? '_' + j.replace(/\s+/g, '') : '') + '.xlsx', [{ name: 'Satker', aoa: C.bulkTemplateAoa(j) }, { name: 'Petunjuk', aoa: [['Satu baris per satker. Kolom wajib: Kode Satker (6 digit).'], ['Kolom lain opsional: bila diisi, menimpa nilai default yang diisi pada formulir untuk satker tersebut.'], ['Berkas ini sengaja tidak berisi data contoh.']] }]); };
    $('#b_file').onchange = function () {
      var f = this.files[0]; if (!f) return; fileName = f.name; fileSize = f.size; var rd = new FileReader();
      rd.onload = function () {
        try {
          wbk = C.readWorkbookAoa(XLSX, new Uint8Array(rd.result), 'array');
          var pick = wbk.names.filter(function (n) { var a = wbk.sheets[n]; return a && a[0] && Object.keys(C.detectBulkColumns(a[0], val('b_jenis') || null)).indexOf('kode') > -1; })[0] || wbk.names[0];
          $('#b_sheet').innerHTML = wbk.names.map(function (n) { return '<option' + (n === pick ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join(''); pickSheet();
        } catch (e) { U.toast('Gagal membaca berkas: ' + e.message, 'e'); }
      }; rd.readAsArrayBuffer(f);
    };
    function pickSheet() { var n = val('b_sheet'); aoa = wbk.sheets[n] || []; colMap = null; fileHash = C.hash(fileName + '|' + fileSize + '|' + n + '|' + JSON.stringify(aoa.slice(0, 5)) + aoa.length); reparse(); }
    $('#b_sheet').onchange = pickSheet;
    $('#b_go').onclick = function () {
      var items = batch.rows.filter(function (r) { return r.status === 'BARU'; }).map(function (r) { return { pengajuan: r.pengajuan, detail: r.detail, row: r.row }; });
      var btn = $('#b_go'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Mengirim ' + items.length + ' baris…';
      U.run(st.importSatkerBatch(items, { file: fileName, fileHash: fileHash, ta: val('b_ta'), jenis: val('b_jenis'), reason: 'Impor daftar satker: ' + fileName })).then(function (r) {
        m.body().insertAdjacentHTML('afterbegin', '<div class="alert s"><b>Selesai.</b> ' + r.created + ' pengajuan dibuat, ' + r.skipped + ' sudah ada (dilewati).</div>');
        btn.textContent = 'Selesai'; U.state.ta = val('b_ta'); U.reload();
      }, function (e) { btn.disabled = false; btn.textContent = 'Impor ke spreadsheet'; var er = $('#bErr'); er.textContent = U.errMsg(e); er.classList.remove('hide'); });
    };
  }
  U.openBulk = openBulk;
  U.openImport = openImport; U.openForm = openForm;
})();
