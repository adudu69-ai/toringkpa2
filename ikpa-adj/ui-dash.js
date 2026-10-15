/* Tab 1 — Dashboard (semua angka dihitung dari database; tidak ada angka bawaan) */
(function () {
  'use strict';
  var U = window.IkpaUI, C = U.C, esc = U.esc;

  function bars(rows, opt) { // rows: [{label, seg:[{k,n}], total}]
    opt = opt || {}; var max = Math.max.apply(null, rows.map(function (r) { return r.total; }).concat([1]));
    if (!rows.length) return '<div class="empty">Tidak ada data.</div>';
    return '<div class="bars">' + rows.map(function (r) {
      return '<div class="br"><div class="lb" title="' + esc(r.label) + '">' + esc(r.label) + '</div><div class="bt">' +
        r.seg.map(function (s) { return s.n ? '<i class="' + s.k + '" style="width:' + (s.n / max * 100).toFixed(2) + '%" title="' + esc(s.t || '') + ': ' + s.n + '"></i>' : ''; }).join('') +
        '</div><div class="num"><b>' + r.total + '</b></div></div>';
    }).join('') + '</div>';
  }
  function segs(list) {
    var a = list.filter(function (p) { return p.status === 'Disetujui'; }).length, b = list.filter(function (p) { return p.status === 'Pending'; }).length, c = list.filter(function (p) { return p.status === 'Ditolak'; }).length;
    return [{ k: 'sg-ok', n: a, t: 'Disetujui' }, { k: 'sg-pend', n: b, t: 'Pending' }, { k: 'sg-no', n: c, t: 'Ditolak' }, { k: 'sg-x', n: list.length - a - b - c, t: 'Status lain' }];
  }
  var LEG = '<div class="legend"><span><i class="sg-ok"></i>Disetujui</span><span><i class="sg-pend"></i>Pending</span><span><i class="sg-no"></i>Ditolak</span><span><i class="sg-x"></i>Lainnya</span></div>';

  function render(pane, o) {
    var L = U.filtered('dash').filter(function (p) { return !p.dibatalkan; }), k = C.kpi(L), all = U.state.list.length;
    var inc = L.filter(function (p) { return p.status === 'Disetujui' && p.detailCount === 0; }).length;
    var jalurBelum = L.filter(function (p) { return p.jalur === 'BELUM_DIVERIFIKASI'; }).length;
    var twRows = [1, 2, 3, 4, 0].map(function (tw) { var l = L.filter(function (p) { return (p.tw || 0) === tw; }); return { label: U.twLabel(tw), seg: segs(l), total: l.length }; });
    var byInd = {}; L.forEach(function (p) { (byInd[p.indikator || '(kosong)'] = byInd[p.indikator || '(kosong)'] || []).push(p); });
    var indRows = Object.keys(byInd).map(function (i) { return { label: i, seg: segs(byInd[i]), total: byInd[i].length }; }).sort(function (a, b) { return b.total - a.total; });
    var byJalur = [['SATKER', 'Satker'], ['ESELON_I', 'Eselon I'], ['BELUM_DIVERIFIKASI', 'Belum diverifikasi']].map(function (j) { var l = L.filter(function (p) { return p.jalur === j[0]; }); return { label: j[1], seg: segs(l), total: l.length }; });
    var byKanwil = {}; L.forEach(function (p) { var kk = p.submitter || '(kosong)'; (byKanwil[kk] = byKanwil[kk] || []).push(p); });
    var kRows = Object.keys(byKanwil).map(function (i) { return { label: i, seg: segs(byKanwil[i]), total: byKanwil[i].length }; }).sort(function (a, b) { return b.total - a.total; }).slice(0, 12);

    pane.innerHTML = U.filterBar('dash') +
      (all === 0 && U.state.loaded ? '<div class="alert i">Belum ada pengajuan untuk TA ' + esc(U.state.ta) + '. Gunakan tab <b>Database Pengajuan</b> untuk menambah atau mengimpor DB Penyesuaian IKPA.</div>' : '') +
      '<div class="kpis" id="kpis">' +
      kp(k.totalPengajuan, 'Total pengajuan', '') + kp(k.satkerUnik, 'Satker unik (kode 6 digit)', 'i') + kp(k.disetujui, 'Disetujui', 'g') + kp(k.diproses, 'Pending / diproses', 'w') + kp(k.ditolak, 'Ditolak', 'r') +
      kp(k.pooling, 'Pooling', 'i') + kp(k.satkerBelumDirinci, 'Pengajuan Eselon I (satker belum dirinci)', 'w') + kp(inc, 'Disetujui tanpa detail exception', 'w') + kp(jalurBelum, 'Jalur belum diverifikasi', 'w') + '</div>' +
      '<div class="grid2"><div class="card"><h3>Pengajuan per triwulan <small>TW diisi pengguna; tidak diturunkan dari tanggal input</small></h3>' + bars(twRows) + LEG + '</div>' +
      '<div class="card"><h3>Pengajuan per indikator</h3>' + bars(indRows) + LEG + '</div>' +
      '<div class="card"><h3>Pengajuan per jalur pengajuan</h3>' + bars(byJalur) + LEG + '</div>' +
      '<div class="card"><h3>Pengaju terbanyak <small>maks. 12</small></h3>' + bars(kRows) + LEG + '</div></div>' +
      '<p class="small muted">Angka dihitung dari ' + L.length + ' pengajuan aktif pada filter ini (pengajuan dibatalkan tidak dihitung). Sumber: database aplikasi (Firebase Realtime Database).</p>';
    U.bindFilters(pane, 'dash', function () { render(pane); });
    function kp(n, l, c) { return '<div class="kpi ' + c + '"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }
  }
  U.registerTab('dash', 'Dashboard', render);
})();
