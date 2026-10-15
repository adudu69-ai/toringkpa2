/* Tab 4 — Master Exception & Export (kandidat, deduplikasi, pratinjau, ekspor final, rekonsiliasi) */
(function () {
  'use strict';
  var U = window.IkpaUI, C = U.C, esc = U.esc, S = C.S;
  var me = { plan: null, open: null, cases: null, exports: null, jenis: '', cat: '', tw: '', sql: false, busy: false, preview: null, recon: null };

  var CAT_BADGE = { 'Valid': 'b-ok', 'Perlu dilengkapi': 'b-pend', 'Duplikat': 'b-dup', 'Mapping belum tersedia': 'b-gray', 'Tidak memenuhi kriteria ekspor': 'b-gray', 'Sudah diekspor': 'b-info' };
  function todayStamp() { var d = new Date(); return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  function fileName(prefix) { return (prefix || '') + 'Master_Exception_' + (me.tw ? 'TW' + me.tw + '_' : '') + U.state.ta + '_' + todayStamp() + '.xlsx'; }
  function scopeIds() { return U.filtered('me').filter(function (p) { return !p.dibatalkan; }).map(function (p) { return p.id; }); }
  function refsOf(e) { return Object.keys(e.refs || {}).map(function (k) { return e.refs[k]; }); }
  function jalurLabel(j) { return j === 'SATKER' ? 'Satker' : j === 'ESELON_I' ? 'Eselon I' : 'Belum diverifikasi'; }

  function loadAll() {
    var st = U.state.store; me.busy = true;
    return Promise.all([st.loadOpenExceptions(U.state.ta), st.loadCases(), st.listExports(15), st.getSettings()]).then(function (r) {
      me.open = r[0]; me.cases = r[1]; me.exports = r[2]; me.cfg = r[3]; me.busy = false;
    }, function (e) { me.busy = false; U.toast(U.errMsg(e), 'e'); });
  }
  var loadedFor = null;
  function render(pane) {
    if (loadedFor !== U.state.ta + '|' + U.state.loaded || !me.open) { loadedFor = U.state.ta + '|' + U.state.loaded; loadAll().then(function () { if (U.state.tab === 'me') draw(pane); }); }
    draw(pane);
  }
  function draw(pane) {
    var w = U.can('bangunKandidat'), open = me.open || [], cfg = me.cfg || C.DEFAULT_CONFIG;
    var shown = open.filter(function (e) { return (!me.jenis || e.jenis === me.jenis) && (!me.cat || C.exportCategory(e) === me.cat); });
    var sm = C.summarize(open, cfg), openCases = (me.cases || []).filter(function (c) { return c.status === 'MENUNGGU' || c.status === 'PERLU_PEMERIKSAAN'; });
    var perSheet = {}; open.forEach(function (e) { perSheet[e.jenis] = (perSheet[e.jenis] || 0) + 1; });
    pane.innerHTML =
      U.filterBar('me') +
      '<div class="alert i small"><b>Kriteria kelayakan saat ini</b> (Pengaturan): status pengajuan ∈ {' + esc(cfg.eligibleStatus.join(', ')) + '}; keterangan “selesai” ' + (cfg.excludeKeteranganSelesai ? 'dikecualikan' : 'tidak dikecualikan') + '; Pooling ' + (cfg.poolingPolicy === 'EXCLUDE' ? '<b>tidak</b> diekspor' : '<b>ikut</b> diekspor') + '; ekspor final ' + (cfg.blockOnPotensi ? 'diblokir' : 'tidak diblokir') + ' bila ada potensi duplikat. Filter di atas membatasi pengajuan yang diproses pada langkah 1.</div>' +

      /* langkah 1 */
      '<div class="card"><h3>1 · Bangun kandidat dari pengajuan <small>pratinjau tidak menulis apa pun</small></h3><div class="row"><button class="btn" id="mePlan" ' + (me.busy ? 'disabled' : '') + '>Pratinjau kandidat</button>' + (w ? '<button class="btn p" id="meApply" ' + (me.plan ? '' : 'disabled') + '>Terapkan ke database</button>' : '') + '<span class="small muted">Memproses ' + scopeIds().length + ' pengajuan (TA ' + esc(U.state.ta) + ', sesuai filter).</span></div><div id="planOut">' + (me.plan ? planHtml(me.plan) : '') + '</div></div>' +

      /* ringkasan */
      '<div class="kpis"><div class="kpi i"><div class="n">' + sm.sumberPengajuan + '</div><div class="l">Pengajuan sumber</div></div><div class="kpi"><div class="n">' + sm.unik + '</div><div class="l">Exception unik (baris ekspor)</div></div><div class="kpi g"><div class="n">' + sm.duplikatIdentik + '</div><div class="l">Duplikat identik (ditautkan, tidak diekspor)</div></div><div class="kpi w"><div class="n">' + sm.perluVerifikasi + '</div><div class="l">Perlu verifikasi (potensi duplikat)</div></div><div class="kpi w"><div class="n">' + sm.perluDilengkapi + '</div><div class="l">Perlu dilengkapi</div></div><div class="kpi g"><div class="n">' + sm.siap + '</div><div class="l">Valid, siap ekspor</div></div></div>' +

      /* langkah 2 duplikasi */
      '<div class="card"><h3>2 · Duplikasi yang perlu keputusan <small>(' + openCases.length + ')</small></h3>' + (openCases.length ? '<div id="caseList"></div>' : '<div class="empty">Tidak ada potensi duplikat yang menunggu keputusan.</div>') + '</div>' +

      /* langkah 3 kandidat */
      '<div class="card"><h3>3 · Kandidat Master Exception <small>(belum diekspor)</small></h3><div class="fbar"><label>Jenis (sheet)<select id="meJenis"><option value="">Semua</option>' + C.SHEET_ORDER.map(function (j) { return '<option' + (me.jenis === j ? ' selected' : '') + '>' + esc(j) + '</option>'; }).join('') + '</select></label>' +
      '<label>Kategori validasi<select id="meCat"><option value="">Semua</option>' + ['Valid', 'Perlu dilengkapi', 'Duplikat'].map(function (j) { return '<option' + (me.cat === j ? ' selected' : '') + '>' + esc(j) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="row small" style="margin-bottom:6px">' + Object.keys(perSheet).map(function (k) { return '<span class="badge b-info">' + esc(k) + ': ' + perSheet[k] + '</span>'; }).join('') + '</div>' +
      '<div class="tw" style="max-height:340px"><table><thead><tr><th>Jenis</th><th>Identitas</th><th>Kategori</th><th>Sumber</th><th>Catatan</th><th></th></tr></thead><tbody>' +
      (shown.length ? shown.slice(0, 300).map(function (e) {
        var cat = C.exportCategory(e), refs = refsOf(e);
        return '<tr><td>' + esc(e.jenis) + '</td><td class="mono">' + esc(e.slotKey.split(C.SEP).slice(1).join(' | ')) + '</td><td><span class="badge ' + CAT_BADGE[cat] + '">' + cat + '</span></td><td>' + refs.map(function (r) { return '<span class="badge b-info" title="' + esc(r.nomorND) + '">' + jalurLabel(r.jalur) + ' ' + esc(U.fmtDate(r.tanggalInput)) + '</span>'; }).join(' ') + '</td><td class="small">' + esc((e.errors || []).map(function (x) { return x.msg; }).slice(0, 2).join('; ')) + '</td><td><button class="btn sm" data-ex="' + esc(e.thang + '|' + e.kdsatker + '|' + e.id) + '">Buka</button></td></tr>';
      }).join('') : '<tr><td colspan="6" class="empty">' + (me.open ? 'Belum ada kandidat. Jalankan langkah 1.' : 'Memuat…') + '</td></tr>') + '</tbody></table></div>' + (shown.length > 300 ? '<p class="small muted">Menampilkan 300 pertama dari ' + shown.length + '.</p>' : '') + '</div>' +

      /* langkah 4 ekspor */
      '<div class="card"><h3>4 · Pratinjau &amp; ekspor</h3><div class="fbar"><label>Periode proses (untuk nama berkas)<select id="meTw"><option value="">— tanpa TW pada nama —</option>' + [1, 2, 3, 4].map(function (t) { return '<option value="' + t + '"' + (me.tw === String(t) ? ' selected' : '') + '>TW ' + t + '</option>'; }).join('') + '</select></label>' +
      '<label class="cb"><input type="checkbox" id="meSql"' + (me.sql ? ' checked' : '') + '> Sertakan kolom SQL INSERT (rumus Excel)</label></div>' +
      '<div class="row"><button class="btn" id="mePrev">Pratinjau ekspor</button><button class="btn" id="mePrevDl" ' + (me.preview ? '' : 'disabled') + '>Unduh pratinjau</button>' + (U.can('ekspor') ? '<button class="btn g" id="meFinal">Ekspor final…</button>' : '') + '</div><p class="small muted" style="margin-top:6px">Pratinjau tidak mengubah status apa pun. Ekspor final mencatat berkas pada riwayat ekspor dan menandai exception sebagai <i>sudah diekspor</i> sehingga tidak muncul pada periode berikutnya.</p><div id="prevOut">' + (me.preview ? previewHtml(me.preview) : '') + '</div></div>' +

      /* langkah 5 rekonsiliasi */
      '<div class="card"><h3>5 · Rekonsiliasi file Master Exception historis</h3><p class="small muted" style="margin-bottom:8px">Muat berkas Master Exception periode lalu agar tidak diekspor ulang. Isi berkas <b>tidak diasumsikan</b> sudah ada di database; sistem membandingkan dulu, baru mencatat.</p>' + (U.can('impor') ? '<div class="fbar"><label>Berkas .xlsx<input type="file" id="rcFile" accept=".xlsx,.xlsm"></label><label>Label periode<input id="rcPer" placeholder="mis. Sept 2026" value=""></label></div><div id="rcOut">' + (me.recon ? reconHtml(me.recon) : '') + '</div>' : '<div class="small muted">Memerlukan peran pengelola/admin.</div>') + '</div>' +

      /* riwayat ekspor */
      '<div class="card"><h3>Riwayat ekspor <small>(15 terakhir)</small></h3>' + exportsHtml() + '</div>';
    bindAll(pane);
  }

  function planHtml(pl) {
    var st = pl.stats, skip = {}; pl.skipped.forEach(function (s) { if (s.already) return; (skip[s.why] = skip[s.why] || []).push(s); });
    var already = pl.skipped.filter(function (s) { return s.already; }).length;
    return '<div class="kpis" style="margin-top:10px"><div class="kpi i"><div class="n">' + pl.pengajuanCount + '</div><div class="l">Pengajuan diperiksa</div></div><div class="kpi"><div class="n">' + st.sumber + '</div><div class="l">Baris sumber baru</div></div><div class="kpi g"><div class="n">' + pl.creates.filter(function (e) { return e.st === 'KANDIDAT'; }).length + '</div><div class="l">Exception baru</div></div><div class="kpi g"><div class="n">' + st.identik + '</div><div class="l">Identik → ditautkan</div></div><div class="kpi w"><div class="n">' + st.potensi + '</div><div class="l">Potensi duplikat</div></div><div class="kpi w"><div class="n">' + st.lengkapi + '</div><div class="l">Perlu dilengkapi</div></div><div class="kpi"><div class="n">' + already + '</div><div class="l">Sudah diproses sebelumnya</div></div></div>' +
      (Object.keys(skip).length ? '<div class="alert w"><b>Tidak memenuhi kriteria ekspor / belum dapat diproses:</b><ul>' + Object.keys(skip).map(function (w) { return '<li>' + esc(w) + ' — ' + skip[w].length + ' detail/pengajuan</li>'; }).join('') + '</ul></div>' : '') +
      ((pl.tanpaDetail || []).length ? '<div class="alert w"><b>' + pl.tanpaDetail.length + ' pengajuan memenuhi kriteria status tetapi belum memiliki detail exception</b> sehingga belum dapat menjadi baris Master Exception. Lengkapi detailnya di tab Database Pengajuan (buka pengajuan → Ubah → bagian 4).</div>' : '') +
      (pl.mappingMissing.length ? '<div class="alert w"><b>Mapping belum tersedia:</b> ' + pl.mappingMissing.length + ' detail (jenis exception belum ditentukan atau tanpa template). Contoh: ' + esc(pl.mappingMissing.slice(0, 3).map(function (x) { return x.why; }).join('; ')) + '</div>' : '') +
      '<p class="small muted">Pratinjau ini belum disimpan. Tekan “Terapkan ke database” untuk menyimpan kandidat.</p>';
  }
  function previewHtml(pv) {
    return '<div style="margin-top:10px">' + (pv.blockers.length ? '<div class="alert e"><b>Ekspor final akan diblokir:</b><ul>' + pv.blockers.map(function (b) { return '<li>' + esc(b.msg) + '</li>'; }).join('') + '</ul></div>' : '<div class="alert s">Tidak ada pemblokir. Ekspor final dapat dilakukan.</div>') +
      '<div class="kpis"><div class="kpi i"><div class="n">' + pv.sum.sumberPengajuan + '</div><div class="l">Pengajuan sumber</div></div><div class="kpi"><div class="n">' + pv.sum.unik + '</div><div class="l">Exception unik</div></div><div class="kpi g"><div class="n">' + pv.sum.duplikatIdentik + '</div><div class="l">Duplikat identik</div></div><div class="kpi w"><div class="n">' + pv.sum.perluVerifikasi + '</div><div class="l">Perlu verifikasi</div></div></div>' +
      (pv.out.sheets.length ? pv.out.sheets.map(function (sh) {
        return '<div class="small" style="margin:8px 0 3px"><b>' + esc(sh.name) + '</b> — ' + sh.count + ' baris</div><div class="tw" style="max-height:200px"><table><thead><tr>' + sh.header.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + (sh.sqlCol ? '<th></th><th>SQL INSERT</th>' : '') + '</tr></thead><tbody>' + sh.cells.slice(0, 8).map(function (l) { return '<tr>' + l.map(function (c) { return c.t === 'z' ? '<td></td>' : '<td class="' + (c.f ? 'mono' : '') + '">' + esc(c.v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
      }).join('') : '<div class="empty">Tidak ada baris valid untuk diekspor.</div>') + '</div>';
  }
  function reconHtml(r) {
    return '<div class="kpis" style="margin-top:8px"><div class="kpi"><div class="n">' + r.rows.length + '</div><div class="l">Baris terbaca</div></div><div class="kpi g"><div class="n">' + r.fresh + '</div><div class="l">Belum ada di database</div></div><div class="kpi i"><div class="n">' + r.known + '</div><div class="l">Sudah ada (hanya jejak sumber ditambah)</div></div><div class="kpi w"><div class="n">' + r.dupInFile + '</div><div class="l">Kembar dalam berkas</div></div></div>' +
      Object.keys(r.perSheet).map(function (k) { return '<span class="badge b-info">' + esc(k) + ': ' + r.perSheet[k] + '</span> '; }).join('') +
      (r.errors.length ? '<div class="alert e">' + r.errors.map(function (x) { return esc(x.sheet + ': ' + x.why); }).join('<br>') + '</div>' : '') +
      (r.ignored.length ? '<div class="alert w small"><b>Sheet tidak diproses:</b> ' + r.ignored.map(function (x) { return esc(x.sheet + ' (' + x.why + ')'); }).join('; ') + '</div>' : '') +
      '<div class="row" style="margin-top:8px"><label class="small"><input type="checkbox" id="rcExp" checked> Tandai sebagai <b>sudah diekspor/dimasukkan ke MyIntress</b> (tidak akan muncul pada ekspor berikutnya)</label></div><button class="btn p" id="rcGo" style="margin-top:6px" ' + (r.rows.length ? '' : 'disabled') + '>Catat ke database</button>';
  }
  function exportsHtml() {
    var l = me.exports || []; if (!l.length) return '<div class="empty">Belum ada ekspor final.</div>';
    return '<div class="tw" style="max-height:240px"><table><thead><tr><th>Waktu</th><th>Oleh</th><th>Berkas</th><th>Unik</th><th>Sumber</th><th>Checksum</th></tr></thead><tbody>' + l.map(function (x) { return '<tr><td class="small">' + esc(U.fmtTs(x.ts)) + '</td><td>' + esc(x.by) + '</td><td class="small">' + esc(x.fileName) + (x.reexport ? ' <span class="badge b-pend">ekspor ulang</span>' : '') + '</td><td>' + esc(x.counts && x.counts.unik) + '</td><td>' + esc(x.counts && x.counts.sumberPengajuan) + '</td><td class="mono">' + esc(x.checksum) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }

  function bindAll(pane) {
    var st = U.state.store;
    U.bindFilters(pane, 'me', function () { me.plan = null; draw(pane); });
    var sel = function (id, key) { var el = U.$('#' + id, pane); if (el) el.onchange = function () { me[key] = el.value; draw(pane); }; };
    sel('meJenis', 'jenis'); sel('meCat', 'cat');
    U.$('#meTw', pane).onchange = function () { me.tw = this.value; };
    U.$('#meSql', pane).onchange = function () { me.sql = this.checked; me.preview = null; draw(pane); };
    U.$$('[data-ex]', pane).forEach(function (b) { b.onclick = function () { var a = b.dataset.ex.split('|'); U.openException(a[0], a[1], a[2]); }; });

    U.$('#mePlan', pane).onclick = function () {
      this.disabled = true; U.run(st.planCandidates(U.state.ta, { pengajuanIds: scopeIds() })).then(function (pl) { me.plan = pl; draw(pane); }, function () { draw(pane); });
    };
    var ap = U.$('#meApply', pane); if (ap) ap.onclick = function () {
      var pl = me.plan; if (!pl) return;
      if (!pl.creates.length && !pl.links.length) { U.toast('Tidak ada perubahan untuk disimpan.'); return; }
      U.ask({ title: 'Simpan kandidat', msg: 'Akan menyimpan <b>' + pl.creates.length + '</b> exception (termasuk potensi duplikat &amp; yang perlu dilengkapi) dan <b>' + pl.links.length + '</b> tautan ke exception yang sudah ada. Tidak ada data yang dihapus atau digabung otomatis.', reason: 'Catatan (opsional diisi alasan/periode)', confirm: 'Simpan' }).then(function (r) {
        if (!r) return; U.run(st.applyPlan(pl, r.reason), 'Kandidat disimpan').then(function () { me.plan = null; return loadAll(); }).then(function () { draw(pane); });
      });
    };
    renderCases(pane);

    function collect() { return (me.open || []).filter(function (e) { return !me.jenis || e.jenis === me.jenis; }); }
    function buildOut(rows) { var by = {}; rows.forEach(function (e) { (by[e.jenis] = by[e.jenis] || []).push(e.row); }); return C.buildExportSheets(by, { sql: me.sql }); }
    U.$('#mePrev', pane).onclick = function () {
      var all = collect(), valid = all.filter(function (e) { return C.exportCategory(e) === 'Valid'; });
      me.preview = { out: buildOut(valid), sum: C.summarize(all, me.cfg), blockers: st.exportBlockers(all, me.cfg), valid: valid }; draw(pane);
    };
    var pd = U.$('#mePrevDl', pane); if (pd) pd.onclick = function () {
      if (!me.preview || !me.preview.out.sheets.length) { U.toast('Tidak ada baris valid.', 'e'); return; }
      XLSX.writeFile(C.buildWorkbook(XLSX, me.preview.out), fileName('PRATINJAU_')); U.toast('Pratinjau diunduh (bukan ekspor final; tidak dicatat).');
    };
    var fn = U.$('#meFinal', pane); if (fn) fn.onclick = function () {
      var all = collect(); if (!all.length) { U.toast('Tidak ada kandidat untuk diekspor.', 'e'); return; }
      var bl = st.exportBlockers(all, me.cfg);
      if (bl.length) { U.modal({ title: 'Ekspor final diblokir', body: '<div class="alert e"><ul>' + bl.map(function (b) { return '<li>' + esc(b.msg) + '</li>'; }).join('') + '</ul></div><p class="small muted">Selesaikan keputusan duplikasi (langkah 2) dan lengkapi detail pada pengajuan terkait, lalu coba lagi.</p>', footer: '<button class="btn" data-x="close">Tutup</button>' }); return; }
      var out = buildOut(all), name = fileName(''), perSheet = out.sheets.map(function (s) { return s.name + ': ' + s.count; }).join(', ');
      U.ask({ title: 'Ekspor final', msg: 'Berkas <b>' + esc(name) + '</b><br>' + esc(perSheet) + '<br>Total ' + all.length + ' exception unik dari ' + C.summarize(all, me.cfg).sumberPengajuan + ' pengajuan. Exception ini akan ditandai <b>sudah diekspor</b>.', reason: 'Catatan ekspor (mis. periode / tujuan)', confirm: 'Ekspor final' }).then(function (r) {
        if (!r) return;
        var wb = C.buildWorkbook(XLSX, out);
        U.run(st.finalizeExport(all, { fileName: name, periodeProses: me.tw ? 'TW' + me.tw : '', ta: U.state.ta, sql: me.sql, reexportReason: '', filters: Object.assign({}, U.state.f.me), note: r.reason })).then(function (res) {
          XLSX.writeFile(wb, name); U.toast('Ekspor final tercatat (' + res.summary.unik + ' exception). Berkas diunduh.', 's'); me.preview = null; return loadAll();
        }).then(function () { draw(pane); }, function () { });
      });
    };

    var rf = U.$('#rcFile', pane); if (rf) rf.onchange = function () {
      var f = rf.files[0]; if (!f) return; var rd = new FileReader();
      rd.onload = function () {
        try {
          var wb = C.readWorkbookAoa(XLSX, new Uint8Array(rd.result), 'array'), pm = C.parseMasterExceptionSheets(wb.sheets);
          var pairs = pm.rows.map(function (r) { return [S(r.row.THANG), S(r.row[C.TYPES[r.jenis].satkerKey || 'KDSATKER'])]; }).filter(function (p) { return p[0] && /^\d{6}$/.test(p[1]); });
          st.loadExceptionsFor(pairs).then(function (ex) {
            var have = {}; ex.forEach(function (e) { have[e.id] = 1; }); var seen = {}, fresh = 0, known = 0, dup = 0;
            pm.rows.forEach(function (r) { var id = C.keysOf(r.jenis, r.row).excId; if (have[id]) known++; else if (seen[id]) dup++; else { fresh++; seen[id] = 1; } });
            me.recon = { rows: pm.rows, perSheet: pm.perSheet, errors: pm.errors, ignored: pm.ignored, fresh: fresh, known: known, dupInFile: dup, file: f.name, size: f.size }; draw(pane);
          });
        } catch (e) { U.toast('Gagal membaca berkas: ' + e.message, 'e'); }
      }; rd.readAsArrayBuffer(f);
    };
    var rg = U.$('#rcGo', pane); if (rg) rg.onclick = function () {
      var r = me.recon, per = S(U.$('#rcPer', pane).value).trim(); rg.disabled = true;
      U.run(st.importHistoricalME(r.rows, { file: r.file, periode: per, markExported: U.$('#rcExp', pane).checked }), 'Rekonsiliasi dicatat').then(function (res) { me.recon = null; U.toast(res.created + ' dibuat, ' + res.merged + ' sudah ada.', 's'); return loadAll(); }).then(function () { draw(pane); }, function () { rg.disabled = false; });
    };
  }

  /* ---------- panel perbandingan duplikasi ---------- */
  function renderCases(pane) {
    var box = U.$('#caseList', pane); if (!box) return; var st = U.state.store;
    var open = (me.cases || []).filter(function (c) { return c.status === 'MENUNGGU' || c.status === 'PERLU_PEMERIKSAAN'; });
    box.innerHTML = '<div class="empty small"><span class="spin"></span></div>';
    Promise.all(open.slice(0, 20).map(function (c) { return Promise.all([st.getException(c.thang, c.kd, c.kandidatExcId), Promise.all(c.matches.map(function (id) { return st.getException(c.thang, c.kd, id); }))]); })).then(function (rs) {
      box.innerHTML = open.slice(0, 20).map(function (c, i) {
        var cand = rs[i][0], matches = rs[i][1].filter(Boolean); if (!cand) return '';
        var T = C.TYPES[c.jenis], keys = T.keys.filter(function (k) { return k !== 'ID'; }), diffKeys = {}; (c.diff || []).forEach(function (d) { diffKeys[d.field] = 1; });
        var colsHtml = function (e, label) { return '<th>' + label + '</th>'; };
        return '<div class="dt" data-case="' + esc(c.id) + '"><div class="dt-h"><b>' + esc(c.jenis) + '</b> <span class="badge b-dup">' + (c.reason === 'DATA_BELUM_LENGKAP' ? 'Data belum lengkap — kecocokan sebagian' : 'Slot sama, atribut berbeda') + '</span>' + (c.status === 'PERLU_PEMERIKSAAN' ? ' <span class="badge b-pend">Perlu pemeriksaan lebih lanjut</span>' : '') + '</div>' +
          '<div class="tw" style="max-height:260px"><table class="cmp"><thead><tr><th>Atribut teknis</th><th>Pengajuan baru</th>' + matches.map(function (mm, j) { return '<th>Existing ' + (j + 1) + ' (' + esc(mm.st) + ')</th>'; }).join('') + '</tr></thead><tbody>' +
          '<tr><td class="k">Jalur · tanggal · ND</td><td>' + refsOf(cand).map(function (r) { return esc(jalurLabel(r.jalur) + ' · ' + U.fmtDate(r.tanggalInput) + ' · ' + r.nomorND); }).join('<br>') + '</td>' + matches.map(function (mm) { return '<td>' + refsOf(mm).map(function (r) { return esc(jalurLabel(r.jalur) + ' · ' + U.fmtDate(r.tanggalInput) + ' · ' + r.nomorND); }).join('<br>') + (mm.sumber === 'ME_HISTORIS' ? '<span class="badge b-gray">dari berkas ME historis</span>' : '') + '</td>'; }).join('') + '</tr>' +
          keys.map(function (k) { var df = diffKeys[k] ? 'df' : ''; return '<tr class="' + df + '"><td class="k">' + esc(k) + '</td><td>' + esc(cand.row[k]) + '</td>' + matches.map(function (mm) { return '<td>' + esc(mm.row[k]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
          (U.can('selesaikanDuplikat') ? '<div class="row" style="margin-top:8px">' + (matches.length > 1 ? '<select data-tg>' + matches.map(function (mm, j) { return '<option value="' + esc(mm.id) + '">Existing ' + (j + 1) + '</option>'; }).join('') + '</select>' : '') + '<button class="btn sm" data-a="HUBUNGKAN">Hubungkan ke exception existing</button><button class="btn sm" data-a="BARU">Tandai sebagai exception baru</button><button class="btn sm" data-a="PERLU_PEMERIKSAAN">Perlu pemeriksaan lebih lanjut</button></div>' : '') + '</div>';
      }).join('') + (open.length > 20 ? '<p class="small muted">Menampilkan 20 pertama dari ' + open.length + '.</p>' : '');
      U.$$('[data-case]', box).forEach(function (el) {
        U.$$('[data-a]', el).forEach(function (b) {
          b.onclick = function () {
            var act = b.dataset.a, tg = U.$('[data-tg]', el), msg = { HUBUNGKAN: 'Pengajuan baru akan <b>mengacu pada exception existing</b>. Tidak ada baris ekspor tambahan; kedua pengajuan tetap tercatat.', BARU: 'Kandidat dinyatakan <b>exception baru</b> dan akan ikut diekspor sebagai baris terpisah.', PERLU_PEMERIKSAAN: 'Kasus ditandai untuk diperiksa. Ekspor final tetap diblokir sampai diputuskan.' }[act];
            U.ask({ title: b.textContent, msg: msg, reason: 'Alasan keputusan', confirm: 'Simpan keputusan' }).then(function (r) {
              if (!r) return; U.run(st.resolveCase(el.dataset.case, act, { reason: r.reason, targetExcId: tg ? tg.value : null }), 'Keputusan dicatat').then(loadAll).then(function () { draw(pane); });
            });
          };
        });
      });
    }, function (e) { box.innerHTML = '<div class="alert e">' + esc(U.errMsg(e)) + '</div>'; });
  }

  /* ---------- detail exception ---------- */
  U.openException = function (thang, kd, id) {
    var st = U.state.store, m = U.modal({ title: 'Detail exception', wide: true, body: '<div class="empty"><span class="spin"></span></div>', footer: '<button class="btn" data-x="close">Tutup</button>' });
    Promise.all([st.getException(thang, kd, id), st.listAudit('exception', id, 30)]).then(function (r) {
      var e = r[0]; if (!e) { m.body().innerHTML = '<div class="alert e">Exception tidak ditemukan (mungkin sudah digabung/dibatalkan).</div>'; return; }
      var T = C.TYPES[e.jenis], refs = Object.keys(e.refs || {}).map(function (k) { return Object.assign({ k: k }, e.refs[k]); });
      m.body().innerHTML = '<div class="row" style="margin-bottom:8px">' + U.excBadge(e) + ' <span class="badge b-gray">' + esc(e.jenis) + '</span> <span class="badge b-gray">sumber: ' + esc(e.sumber) + '</span> <span class="small muted">ID ' + esc(e.id) + '</span></div>' +
        '<div class="card"><h3>Baris Master Exception</h3><div class="tw" style="max-height:none"><table><thead><tr>' + T.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody><tr>' + T.keys.map(function (k) { return '<td>' + esc(e.row[k]) + '</td>'; }).join('') + '</tr></tbody></table></div>' +
        ((e.errors || []).length ? '<div class="alert w"><b>Perlu dilengkapi:</b><ul>' + e.errors.map(function (x) { return '<li>' + esc(x.msg) + '</li>'; }).join('') + '</ul></div>' : '') + ((e.warnings || []).length ? '<div class="alert w small"><ul>' + e.warnings.map(function (x) { return '<li>' + esc(x.msg) + '</li>'; }).join('') + '</ul></div>' : '') +
        '<p class="small muted mono">Kunci identitas: ' + esc(e.idKey.split(C.SEP).join(' | ')) + '</p></div>' +
        '<div class="card"><h3>Pengajuan sumber <small>(' + refs.length + ' — satu exception, ' + refs.length + ' pengajuan administratif)</small></h3>' + (refs.length ? '<table><thead><tr><th>Jalur</th><th>Tanggal input</th><th>Nomor ND</th><th>Pengaju</th><th>Hubungan</th><th></th></tr></thead><tbody>' + refs.map(function (x) { return '<tr><td>' + U.jalurBadge(x.jalur) + '</td><td>' + esc(U.fmtDate(x.tanggalInput)) + '</td><td>' + esc(x.nomorND) + '</td><td class="small">' + esc(x.submitter) + '</td><td>' + esc({ ASAL: 'Asal', IDENTIK: 'Identik (ditautkan)', DIHUBUNGKAN: 'Dihubungkan oleh pengguna' }[x.linkType] || x.linkType) + '</td><td><button class="btn sm" data-p="' + esc(x.pengajuanId) + '">Buka</button></td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty small">Tidak ada pengajuan sumber (exception dari berkas historis).</div>') + '</div>' +
        '<div class="card"><h3>Status ekspor</h3>' + (e.exportedIn && Object.keys(e.exportedIn).length ? '<ul style="margin-left:18px">' + Object.keys(e.exportedIn).map(function (k) { return '<li>ID ekspor/rekonsiliasi <span class="mono">' + esc(k) + '</span> · ' + esc(U.fmtTs(e.exportedIn[k])) + '</li>'; }).join('') + '</ul>' : '<p class="small muted">Belum diekspor.</p>') + (e.meSumber ? '<p class="small muted">Berkas historis: ' + esc(e.meSumber.file) + ' · sheet ' + esc(e.meSumber.sheet) + ' · baris ' + esc(e.meSumber.baris) + (e.meSumber.periode ? ' · ' + esc(e.meSumber.periode) : '') + '</p>' : '') + '</div>' +
        '<div class="card"><h3>Riwayat</h3>' + U.auditTable(r[1]) + '</div>';
      U.$$('[data-p]', m.el).forEach(function (b) { b.onclick = function () { U.openPengajuan(b.dataset.p); }; });
    }).catch(function (e) { m.body().innerHTML = '<div class="alert e">' + esc(U.errMsg(e)) + '</div>'; });
  };

  U.registerTab('me', 'Master Exception & Export', render);
})();
