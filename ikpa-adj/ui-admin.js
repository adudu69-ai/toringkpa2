/* Tab 5 — Admin & Audit (hanya admin): pengguna, pengaturan kelayakan ekspor, audit global */
(function () {
  'use strict';
  var U = window.IkpaUI, C = U.C, esc = U.esc, S = C.S;
  var cache = { users: null, audit: null, cfg: null };

  function render(pane) {
    var st = U.state.store;
    pane.innerHTML = '<div class="empty"><span class="spin"></span> Memuat…</div>';
    Promise.all([st.listUsers(), st.getSettings(), st.listAuditGlobal(100)]).then(function (r) {
      var users = r[0], cfg = r[1], audit = r[2];
      pane.innerHTML =
        '<div class="grid2"><div class="card"><h3>Pengguna &amp; peran</h3><div class="tw" style="max-height:300px"><table><thead><tr><th>Nama</th><th>Email</th><th>UID</th><th>Peran</th></tr></thead><tbody>' + users.map(function (u) { return '<tr><td>' + esc(u.name) + '</td><td class="small">' + esc(u.email) + '</td><td class="mono small">' + esc(u.uid) + '</td><td><select data-uid="' + esc(u.uid) + '">' + ['admin', 'pengelola', 'pembaca'].map(function (x) { return '<option' + (u.role === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></td></tr>'; }).join('') + '</tbody></table></div>' +
        '<h3 style="margin-top:14px">Tambah pengguna</h3><div class="fg"><div class="fld"><label class="req">UID (ditampilkan pada layar “Akun belum terdaftar”)</label><input id="uUid"></div><div class="fld"><label>Nama</label><input id="uNm"></div><div class="fld"><label>Email</label><input id="uEm"></div><div class="fld"><label class="req">Peran</label><select id="uRole"><option>pembaca</option><option>pengelola</option><option>admin</option></select></div></div><button class="btn p" id="uAdd" style="margin-top:8px">Tambahkan</button>' +
        '<p class="small muted" style="margin-top:8px"><b>admin</b>: semua, termasuk pengguna, pengaturan, ekspor ulang. <b>pengelola</b>: input/ubah/batalkan, impor, bangun kandidat, putuskan duplikasi, ekspor. <b>pembaca</b>: hanya melihat.</p></div>' +
        '<div class="card"><h3>Pengaturan kelayakan ekspor</h3><div class="fg">' +
        '<div class="fld full"><label>Status pengajuan yang menjadi kandidat</label><div class="row">' + ['Disetujui', 'Pending', 'Ditolak'].map(function (s) { return '<label class="small"><input type="checkbox" data-es="' + s + '"' + (cfg.eligibleStatus.indexOf(s) > -1 ? ' checked' : '') + '> ' + s + '</label>'; }).join('') + '</div><span class="hint">Spesifikasi: hanya “Disetujui”. Ubah hanya bila kebijakan berubah.</span></div>' +
        '<div class="fld"><label>Pengajuan berstatus Pooling</label><select id="cPool"><option value="INCLUDE"' + (cfg.poolingPolicy === 'INCLUDE' ? ' selected' : '') + '>Ikut diekspor</option><option value="EXCLUDE"' + (cfg.poolingPolicy === 'EXCLUDE' ? ' selected' : '') + '>Tidak diekspor</option></select><span class="hint">[PERLU KONFIRMASI] kebijakan pooling belum tertulis pada berkas rujukan.</span></div>' +
        '<div class="fld"><label>Keterangan “selesai”</label><select id="cSel"><option value="1"' + (cfg.excludeKeteranganSelesai ? ' selected' : '') + '>Dikecualikan (sudah diproses)</option><option value="0"' + (!cfg.excludeKeteranganSelesai ? ' selected' : '') + '>Tidak dikecualikan</option></select></div>' +
        '<div class="fld"><label>Potensi duplikat belum diputuskan</label><select id="cBlk"><option value="1"' + (cfg.blockOnPotensi ? ' selected' : '') + '>Blokir ekspor final</option><option value="0"' + (!cfg.blockOnPotensi ? ' selected' : '') + '>Tidak memblokir</option></select></div>' +
        '<div class="fld"><label>Peringatan validasi (warning)</label><select id="cWrn"><option value="0"' + (!cfg.blockOnWarnings ? ' selected' : '') + '>Tidak memblokir</option><option value="1"' + (cfg.blockOnWarnings ? ' selected' : '') + '>Blokir ekspor final</option></select></div>' +
        '<div class="fld full"><label class="req">Alasan perubahan</label><input id="cRes"></div></div><button class="btn p" id="cSave" style="margin-top:8px">Simpan pengaturan</button></div></div>' +
        '<div class="card"><h3>Audit global <small>(100 terakhir, seluruh modul)</small></h3><div class="tw" style="max-height:420px"><table><thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Objek</th><th>Alasan</th></tr></thead><tbody>' + (audit.length ? audit.map(function (a) { return '<tr><td class="small">' + esc(U.fmtTs(a.ts)) + '</td><td>' + esc(a.name) + '</td><td>' + esc(a.action) + '</td><td class="mono small">' + esc(a.refType) + ' / ' + esc(a.refId) + '</td><td class="small">' + esc(a.reason) + '</td></tr>'; }).join('') : '<tr><td colspan="5" class="empty">Belum ada aktivitas.</td></tr>') + '</tbody></table></div></div>';
      U.$$('[data-uid]', pane).forEach(function (sel) {
        sel.onchange = function () {
          var u = users.filter(function (x) { return x.uid === sel.dataset.uid; })[0], prev = u.role;
          U.ask({ title: 'Ubah peran', msg: esc(u.name || u.email || u.uid) + ': <b>' + esc(prev) + '</b> → <b>' + esc(sel.value) + '</b>', reason: 'Alasan', confirm: 'Ubah' }).then(function (r) {
            if (!r) { sel.value = prev; return; }
            U.run(st.setUserRole(u.uid, { role: sel.value, name: u.name || '', email: u.email || '' }, r.reason), 'Peran diubah').then(function () { render(pane); }, function () { sel.value = prev; });
          });
        };
      });
      U.$('#uAdd', pane).onclick = function () {
        var uid = S(U.$('#uUid', pane).value).trim(); if (!uid) { U.toast('UID wajib', 'e'); return; }
        U.ask({ title: 'Tambah pengguna', msg: 'UID <span class="mono">' + esc(uid) + '</span> sebagai <b>' + esc(U.$('#uRole', pane).value) + '</b>.', reason: 'Alasan', confirm: 'Tambahkan' }).then(function (r) {
          if (!r) return; U.run(st.setUserRole(uid, { role: U.$('#uRole', pane).value, name: S(U.$('#uNm', pane).value).trim(), email: S(U.$('#uEm', pane).value).trim() }, r.reason), 'Pengguna ditambahkan').then(function () { render(pane); });
        });
      };
      U.$('#cSave', pane).onclick = function () {
        var reason = S(U.$('#cRes', pane).value).trim(); if (!reason) { U.toast('Alasan perubahan wajib', 'e'); return; }
        var es = U.$$('[data-es]', pane).filter(function (c) { return c.checked; }).map(function (c) { return c.dataset.es; }); if (!es.length) { U.toast('Pilih minimal satu status', 'e'); return; }
        var n = Object.assign({}, cfg, { eligibleStatus: es, poolingPolicy: U.$('#cPool', pane).value, excludeKeteranganSelesai: U.$('#cSel', pane).value === '1', blockOnPotensi: U.$('#cBlk', pane).value === '1', blockOnWarnings: U.$('#cWrn', pane).value === '1' });
        U.run(st.saveSettings(n, reason), 'Pengaturan disimpan').then(function () { render(pane); });
      };
    }, function (e) { pane.innerHTML = '<div class="alert e">' + esc(U.errMsg(e)) + '</div>'; });
  }
  U.registerTab('admin', 'Admin & Audit', render); U.tabs.admin.admin = true;
})();
