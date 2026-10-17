/* Tab 3 — Monitoring Satker: ringkasan per satker (TW I–IV) -> riwayat detail */
(function () {
  'use strict';
  var U = window.IkpaUI, C = U.C, esc = U.esc, S = C.S, PAGE = 40, page = 0;

  function groupBySatker(L) {
    var g = {};
    L.filter(function (p) { return !p.dibatalkan; }).forEach(function (p) {
      var key = p.kdsatker || ('ES|' + S(p.submitter) + '|' + S(p.satkerRingkasan)), o = g[key] || (g[key] = { key: key, kd: p.kdsatker, ring: p.satkerRingkasan, nama: p.namaSatker, kppn: p.kdkppn, kl: p.namaKL || p.kl, list: [] });
      if (!o.nama && p.namaSatker) o.nama = p.namaSatker; o.list.push(p);
    });
    return Object.keys(g).map(function (k) { return g[k]; });
  }
  function cell(b) {
    if (!b.n) return '<span class="z">—</span>';
    var out = '<div class="c">'; ['Disetujui', 'Pending', 'Ditolak'].forEach(function (s) { if (b.status[s]) out += '<span class="badge ' + (s === 'Disetujui' ? 'b-ok' : s === 'Pending' ? 'b-pend' : 'b-no') + '" title="' + s + '">' + b.status[s] + (s === 'Disetujui' ? ' ✓' : s === 'Pending' ? ' …' : ' ✕') + '</span>'; });
    var other = b.n - (b.status.Disetujui || 0) - (b.status.Pending || 0) - (b.status.Ditolak || 0); if (other) out += '<span class="badge b-gray">' + other + ' lain</span>';
    if (b.pooling) out += '<span class="badge b-pool">Pooling ' + b.pooling + '</span>';
    return out + '</div>';
  }

  function render(pane) {
    var L = U.filtered('sat'), groups = groupBySatker(L), q = S(U.state.f.sat.q).toLowerCase();
    groups.sort(function (a, b) { return (a.kd ? '0' : '1') + (a.kd || a.ring) < (b.kd ? '0' : '1') + (b.kd || b.ring) ? -1 : 1; });
    var pages = Math.max(1, Math.ceil(groups.length / PAGE)); if (page >= pages) page = pages - 1;
    var rows = groups.slice(page * PAGE, page * PAGE + PAGE);
    pane.innerHTML = U.filterBar('sat', { search: true }) +
      '<div class="alert i small">Ringkasan per satker. Kolom triwulan memakai TW yang <b>diisi pengguna</b> pada pengajuan; pengajuan tanpa TW masuk kolom “Belum ditentukan”. Klik satker untuk melihat riwayat lengkap.</div>' +
      '<div class="tw"><table><thead><tr><th>Satker</th><th>KPPN</th><th>K/L</th><th>TW I</th><th>TW II</th><th>TW III</th><th>TW IV</th><th>Belum ditentukan</th><th class="num">Total</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (g) {
        var s = C.twSummaryForSatker(g.list);
        return '<tr class="cl" data-k="' + esc(g.key) + '"><td>' + (g.kd ? '<b>' + esc(g.kd) + '</b><br><span class="small muted">' + esc(g.nama) + '</span>' : '<span class="badge b-gray">Tingkat Eselon I</span><br><span class="small muted">' + esc(S(g.ring).slice(0, 70)) + '</span>') + '</td><td>' + esc(g.kppn) + '</td><td class="small">' + esc(g.kl) + '</td>' +
          [1, 2, 3, 4, 0].map(function (t) { return '<td class="twc">' + cell(s[t]) + '</td>'; }).join('') + '<td class="num"><b>' + g.list.length + '</b></td></tr>';
      }).join('') : '<tr><td colspan="9" class="empty">' + (U.state.loaded ? 'Tidak ada data pada filter ini.' : 'Memuat…') + '</td></tr>') + '</tbody></table></div>' +
      '<div class="pg"><button class="btn sm" id="sP" ' + (page ? '' : 'disabled') + '>‹</button><span>Hal. ' + (page + 1) + ' / ' + pages + ' · ' + groups.length + ' satker/kelompok</span><button class="btn sm" id="sN" ' + (page < pages - 1 ? '' : 'disabled') + '>›</button></div>';
    U.bindFilters(pane, 'sat', function (o) { page = 0; render(pane); if (o && o.keepFocus) { var el = U.$('[data-f="' + o.keepFocus + '"]', pane); if (el) { el.focus(); var v = el.value; el.value = ''; el.value = v; } } });
    U.$('#sP', pane).onclick = function () { page--; render(pane); }; U.$('#sN', pane).onclick = function () { page++; render(pane); };
    U.$$('tr.cl', pane).forEach(function (tr) { tr.onclick = function () { var g = groups.filter(function (x) { return x.key === tr.dataset.k; })[0]; openSatker(g); }; });
  }
  U.registerTab('sat', 'Monitoring Satker', render);

  function openSatker(g) {
    var st = U.state.store, title = g.kd ? 'Satker ' + g.kd + ' — ' + (g.nama || '') : 'Pengajuan tingkat Eselon I (satker belum dirinci)';
    var m = U.modal({ title: title, wide: true, body: '<div class="empty"><span class="spin"></span> Memuat riwayat…</div>', footer: '<button class="btn" data-x="close">Tutup</button>' });
    var histP = g.kd ? st.satkerHistory(g.kd) : Promise.all(g.list.map(function (p) { return Promise.all([st.getPengajuan(p.id), st.listDetails(p.id)]).then(function (r) { return r[0] ? Object.assign(r[0], { details: r[1] }) : null; }); })).then(function (l) { return l.filter(Boolean); });
    histP.then(function (h) {
      var years = U.uniq(h.map(function (p) { return p.ta; })), pairs = g.kd ? years.map(function (y) { return [y, g.kd]; }) : [];
      return (pairs.length ? st.loadExceptionsFor(pairs) : Promise.resolve([])).then(function (excs) { return { h: h, excs: excs }; });
    }).then(function (r) {
      var h = r.h, excs = r.excs, byTW = C.twSummaryForSatker(h.map(C.compactOf));
      m.body().innerHTML =
        (g.kd ? '<div class="row" style="margin-bottom:10px"><span class="badge b-gray">KPPN ' + esc(g.kppn) + '</span><span class="badge b-gray">' + esc(g.kl) + '</span></div>' : '') +
        '<div class="card"><h3>Ringkasan triwulan</h3><div class="row">' + [1, 2, 3, 4, 0].map(function (t) { return '<div style="min-width:130px"><div class="small muted"><b>' + U.twLabel(t) + '</b></div>' + cell(byTW[t]) + '</div>'; }).join('') + '</div></div>' +
        '<div class="card"><h3>Riwayat pengajuan <small>(' + h.length + ', urut waktu; pengajuan yang identik tetap tampil terpisah)</small></h3><div class="tw" style="max-height:340px"><table><thead><tr><th>TA</th><th>TW</th><th>Tgl input</th><th>Indikator</th><th>Jalur</th><th>Pengaju</th><th>ND</th><th>Status</th><th>Mekanisme penyesuaian</th><th></th></tr></thead><tbody>' +
        h.map(function (p) { return '<tr' + (p.dibatalkan ? ' style="opacity:.55"' : '') + '><td>' + esc(p.ta) + '</td><td>' + (p.tw ? 'TW' + p.tw : '—') + '</td><td>' + esc(U.fmtDate(p.tanggalInput)) + '</td><td>' + esc(p.indikator) + '</td><td>' + U.jalurBadge(p.jalur) + '</td><td class="small">' + esc(p.submitter) + '</td><td class="small">' + esc(p.nomorND) + '</td><td>' + U.statusBadge(p) + '</td><td class="small">' + esc(U.mekText(p) || p.details.map(function (d) { return d.jenis; }).join(', ')) + '</td><td><button class="btn sm" data-p="' + esc(p.id) + '">Buka</button></td></tr>'; }).join('') + '</tbody></table></div></div>' +
        (g.kd ? '<div class="card"><h3>Exception teknis <small>(' + excs.length + ')</small></h3>' + (excs.length ? '<div class="tw" style="max-height:300px"><table><thead><tr><th>Jenis</th><th>Identitas</th><th>Status</th><th>Pengajuan sumber</th><th></th></tr></thead><tbody>' + excs.map(function (e) { return '<tr><td>' + esc(e.jenis) + '</td><td class="mono">' + esc(e.slotKey.split(C.SEP).slice(1).join(' | ')) + '</td><td>' + U.excBadge(e) + '</td><td>' + Object.keys(e.refs || {}).length + '</td><td><button class="btn sm" data-e="' + esc(e.thang + '|' + e.kdsatker + '|' + e.id) + '">Buka</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">Belum ada exception teknis untuk satker ini.</div>') + '</div>' : '');
      U.$$('[data-p]', m.el).forEach(function (b) { b.onclick = function () { U.openPengajuan(b.dataset.p); }; });
      U.$$('[data-e]', m.el).forEach(function (b) { b.onclick = function () { var a = b.dataset.e.split('|'); U.openException(a[0], a[1], a[2]); }; });
    }).catch(function (e) { m.body().innerHTML = '<div class="alert e">' + esc(U.errMsg(e)) + '</div>'; });
  }
})();
