/*!
 * TORING — Monitoring Penyesuaian IKPA & Master Exception
 * store.js : lapisan data. Adapter Firebase Realtime Database (produksi) dan adapter memori (HANYA untuk uji).
 * Tidak ada secret/service account di sini; autentikasi memakai Firebase Auth milik pengguna, otorisasi ditegakkan
 * oleh aturan database (lihat database.rules.ikpa_adj.json). Pemeriksaan role di sini hanya lapisan tambahan.
 *
 * Tata letak (semua di bawah node `ikpa_adj/`):
 *   users/{uid}                          {role,name,email}
 *   config/bootstrapped, config/settings
 *   pengajuan/{pid}                      rekam administratif lengkap
 *   pengajuan_idx/{ta}/{pid}             proyeksi ringkas (daftar/dashboard)
 *   by_satker/{kd}/{pid} = ta            indeks riwayat satker
 *   detail/{pid}/{did}                   detail exception (banyak per pengajuan)
 *   exception/{thang}/{kd}/{excId}       exception teknis (1 baris Master Exception) + refs ke pengajuan
 *   exc_open/{thang}/{kd}/{excId}        {st,jenis} selama belum diekspor
 *   exc_by_pengajuan/{pid}/{excId}       {thang,kd}
 *   dedup_case/{caseId}, dedup_open/{caseId}
 *   export/{exportId}                    ledger ekspor
 *   import_log/{id}
 *   audit/{refType}/{refId}/{key}, audit_global/{key}
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IkpaStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- util */
  function clean(v) { // buang undefined; Date -> ISO ; RTDB tidak menerima undefined
    if (v === undefined) return null;
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { var x = clean(v[k]); if (x !== null) o[k] = x; }); return o; }
    return v;
  }
  function pmap(list, n, fn) { // concurrency terbatas
    var out = new Array(list.length), i = 0;
    function worker() { if (i >= list.length) return Promise.resolve(); var k = i++; return Promise.resolve(fn(list[k], k)).then(function (r) { out[k] = r; return worker(); }); }
    var ws = []; for (var j = 0; j < Math.min(n, list.length); j++) ws.push(worker());
    return Promise.all(ws).then(function () { return out; });
  }
  function toArr(o) { return o ? Object.keys(o).map(function (k) { return o[k]; }) : []; }
  function entries(o) { return o ? Object.keys(o).map(function (k) { return [k, o[k]]; }) : []; }

  /* ----------------------------------------------------- adapter: memori */
  function MemoryAdapter(opts) {
    opts = opts || {};
    var tree = {}, seq = 0, writes = 0;
    function seg(p) { return String(p).split('/').filter(Boolean); }
    function getRaw(p) { var n = tree; var s = seg(p); for (var i = 0; i < s.length; i++) { if (n === null || typeof n !== 'object' || !(s[i] in n)) return null; n = n[s[i]]; } return n; }
    function setRaw(p, v) {
      var s = seg(p); if (!s.length) throw new Error('path kosong');
      if (v === null) {
        var stack = [], n = tree;
        for (var i = 0; i < s.length - 1; i++) { if (!n || typeof n !== 'object' || !(s[i] in n)) return; stack.push([n, s[i]]); n = n[s[i]]; }
        if (n && typeof n === 'object') delete n[s[s.length - 1]];
        for (var j = stack.length - 1; j >= 0; j--) { var c = stack[j][0][stack[j][1]]; if (c && typeof c === 'object' && !Object.keys(c).length) delete stack[j][0][stack[j][1]]; else break; }
        return;
      }
      var n2 = tree;
      for (var k = 0; k < s.length - 1; k++) { if (n2[s[k]] === null || typeof n2[s[k]] !== 'object') n2[s[k]] = {}; n2 = n2[s[k]]; }
      n2[s[s.length - 1]] = JSON.parse(JSON.stringify(v));
    }
    var a = {
      kind: 'memory',
      get: function (p) { return Promise.resolve(JSON.parse(JSON.stringify(getRaw(p)))); },
      update: function (multi) {
        var keys = Object.keys(multi);
        if (opts.guard) { try { opts.guard(multi); } catch (e) { return Promise.reject(e); } }
        keys.forEach(function (k) { var v = multi[k]; setRaw(k, v === undefined ? null : clean(v)); }); writes++;
        return Promise.resolve();
      },
      newKey: function () { seq++; return '-M' + Date.now().toString(36) + ('0000' + seq.toString(36)).slice(-4); },
      now: function () { return new Date(Date.now() + seq).toISOString(); },
      getLastKeys: function (p, n) { var o = getRaw(p) || {}; var ks = Object.keys(o).sort(); return Promise.resolve(ks.slice(-n).map(function (k) { return [k, JSON.parse(JSON.stringify(o[k]))]; })); },
      _dump: function () { return JSON.parse(JSON.stringify(tree)); }, _writes: function () { return writes; }
    };
    return a;
  }

  /* ----------------------------------------------- adapter: Firebase RTDB */
  function RtdbAdapter(firebase, rootName) {
    rootName = rootName || 'ikpa_adj';
    var db = firebase.database();
    var ref = function (p) { return db.ref(rootName + '/' + p); };
    return {
      kind: 'rtdb',
      get: function (p) { return ref(p).once('value').then(function (s) { return s.val(); }); },
      update: function (multi) {
        var o = {}; Object.keys(multi).forEach(function (k) { var v = multi[k]; o[rootName + '/' + k] = v === undefined ? null : clean(v); });
        return db.ref().update(o);
      },
      newKey: function () { return db.ref(rootName + '/_k').push().key; },
      now: function () { return new Date().toISOString(); },
      getLastKeys: function (p, n) { return ref(p).orderByKey().limitToLast(n).once('value').then(function (s) { var out = []; s.forEach(function (c) { out.push([c.key, c.val()]); }); return out; }); }
    };
  }

  /* ------------------------------------------------------------- store */
  function createStore(adapter, user, C) {
    user = user || {}; var role = user.role || 'pembaca';
    var CHUNK = 250;

    function need(action) { if (!C.can(role, action)) { var e = new Error('Hak akses tidak mencukupi untuk: ' + action + ' (role: ' + role + ')'); e.code = 'FORBIDDEN'; throw e; } }
    function commit(multi) { // pecah jika terlalu besar; urutan terjaga
      var ks = Object.keys(multi), parts = [];
      for (var i = 0; i < ks.length; i += CHUNK) { var o = {}; ks.slice(i, i + CHUNK).forEach(function (k) { o[k] = multi[k]; }); parts.push(o); }
      return parts.reduce(function (p, o) { return p.then(function () { return adapter.update(o); }); }, Promise.resolve()).then(function () { return { chunks: parts.length, paths: ks.length }; });
    }
    function audit(multi, refType, refId, action, before, after, reason, extra) {
      var key = adapter.newKey(), ts = adapter.now();
      multi['audit/' + refType + '/' + refId + '/' + key] = clean({ ts: ts, uid: user.uid || '', name: user.name || user.email || '', role: role, action: action, before: before, after: after, reason: reason || '', extra: extra });
      multi['audit_global/' + key] = clean({ ts: ts, uid: user.uid || '', name: user.name || user.email || '', action: action, refType: refType, refId: refId, reason: reason || '' });
    }
    function stamp(rec, isNew) {
      var ts = adapter.now(), who = user.name || user.email || user.uid || '';
      if (isNew) { rec.createdAt = ts; rec.createdBy = who; rec.version = 1; } else { rec.version = (rec.version || 0) + 1; }
      rec.updatedAt = ts; rec.updatedBy = who; return rec;
    }
    function diff(a, b) { var d = { before: {}, after: {} }, ks = {}; Object.keys(a || {}).concat(Object.keys(b || {})).forEach(function (k) { ks[k] = 1; }); Object.keys(ks).forEach(function (k) { if (k === 'updatedAt' || k === 'updatedBy' || k === 'version') return; if (JSON.stringify((a || {})[k]) !== JSON.stringify((b || {})[k])) { d.before[k] = (a || {})[k]; d.after[k] = (b || {})[k]; } }); return d; }

    /* ---------------- pengguna & role ---------------- */
    var s = {
      adapter: adapter, user: user, role: role,

      getUserRecord: function (uid) { return adapter.get('users/' + uid); },
      bootstrapped: function () { return adapter.get('config/bootstrapped').then(function (v) { return !!v; }); },
      claimFirstAdmin: function () { // hanya berhasil bila aturan database mengizinkan (belum ada admin)
        var m = {}; m['users/' + user.uid] = { role: 'admin', name: user.name || '', email: user.email || '', createdAt: adapter.now() }; m['config/bootstrapped'] = true;
        return commit(m).then(function () { // audit ditulis SETELAH peran ada (aturan audit memeriksa peran yang sudah tersimpan)
          var a = {}; audit(a, 'user', user.uid, 'bootstrap_admin', null, { role: 'admin' }, 'Pengguna pertama menjadi admin'); return commit(a);
        });
      },
      setUserRole: function (uid, rec, reason) {
        need('kelolaPengguna'); var m = {}; m['users/' + uid] = clean(rec);
        audit(m, 'user', uid, 'ubah_role', null, rec, reason); return commit(m);
      },
      listUsers: function () { need('kelolaPengguna'); return adapter.get('users').then(function (o) { return entries(o).map(function (e) { return Object.assign({ uid: e[0] }, e[1]); }); }); },
      getSettings: function () { return adapter.get('config/settings').then(function (v) { return Object.assign({}, C.DEFAULT_CONFIG, v || {}); }); },
      saveSettings: function (st, reason) { need('ubahKonfigurasi'); var m = {}; m['config/settings'] = clean(st); audit(m, 'config', 'settings', 'ubah_konfigurasi', null, st, reason); return commit(m); },

      /* ---------------- pengajuan ---------------- */
      listIndex: function (ta) { return adapter.get('pengajuan_idx/' + ta).then(function (o) { return toArr(o); }); },
      getPengajuan: function (id) { return adapter.get('pengajuan/' + id); },
      listDetails: function (pid) { return adapter.get('detail/' + pid).then(function (o) { return entries(o).map(function (e) { return Object.assign({ id: e[0] }, e[1]); }); }); },
      listAudit: function (refType, refId, n) { return adapter.getLastKeys('audit/' + refType + '/' + refId, n || 50).then(function (a) { return a.map(function (e) { return Object.assign({ key: e[0] }, e[1]); }).reverse(); }); },
      listAuditGlobal: function (n) { return adapter.getLastKeys('audit_global', n || 100).then(function (a) { return a.map(function (e) { return Object.assign({ key: e[0] }, e[1]); }).reverse(); }); },

      /** Riwayat satker lintas triwulan/tahun: pengajuan + detail (dari database, bukan hardcode) */
      satkerHistory: function (kd) {
        return adapter.get('by_satker/' + kd).then(function (m) {
          var ids = Object.keys(m || {}); if (!ids.length) return [];
          return pmap(ids, 10, function (id) {
            return Promise.all([adapter.get('pengajuan/' + id), adapter.get('detail/' + id)]).then(function (r) {
              if (!r[0]) return null; var p = r[0]; p.id = p.id || id; p.details = entries(r[1]).map(function (e) { return Object.assign({ id: e[0] }, e[1]); }); return p;
            });
          }).then(function (l) { return l.filter(Boolean).sort(function (a, b) { return (a.ta + (a.tw || 0) + a.tanggalInput) < (b.ta + (b.tw || 0) + b.tanggalInput) ? -1 : 1; }); });
        });
      },

      validatePengajuan: function (p) {
        var E = [];
        if (!/^20\d{2}$/.test(C.S(p.ta))) E.push('Tahun anggaran wajib (20xx)');
        if (p.tw !== null && p.tw !== undefined && !(p.tw >= 1 && p.tw <= 4)) E.push('Triwulan harus 1-4');
        if (!p.tanggalInput || !/^\d{4}-\d{2}-\d{2}$/.test(p.tanggalInput)) E.push('Tanggal input wajib');
        if (!C.S(p.submitter)) E.push('Kanwil DJPb / Eselon I K/L wajib');
        if (!C.S(p.nomorND)) E.push('Nomor ND wajib');
        if (!C.S(p.indikator)) E.push('Indikator wajib');
        if (!(p.kdsatker && /^\d{6}$/.test(p.kdsatker)) && !C.S(p.satkerRingkasan)) E.push('Kode satker (6 digit) atau keterangan ringkasan Eselon I wajib');
        if ([C.STATUS.DISETUJUI, C.STATUS.PENDING, C.STATUS.DITOLAK].indexOf(p.status) < 0) E.push('Status harus Disetujui / Pending / Ditolak');
        if ([C.JALUR.SATKER, C.JALUR.ESELON_I, C.JALUR.BELUM].indexOf(p.jalur) < 0) E.push('Jalur pengajuan tidak valid');
        if (p.status === C.STATUS.DITOLAK && !C.S(p.alasanPenolakan)) E.push('Alasan penolakan wajib untuk status Ditolak');
        return E;
      },

      /** Tambah/ubah pengajuan. expectVersion = versi yang dibaca pengguna (deteksi konflik). */
      savePengajuan: function (p, o) {
        o = o || {}; need('tulisPengajuan');
        var isNew = !p.id; if (isNew) p.id = 'P' + adapter.newKey().replace(/[^A-Za-z0-9]/g, '');
        var errs = s.validatePengajuan(p); if (errs.length) { var e = new Error(errs.join('; ')); e.code = 'INVALID'; e.errors = errs; return Promise.reject(e); }
        return adapter.get('pengajuan/' + p.id).then(function (cur) {
          if (isNew && cur) { var e1 = new Error('ID sudah ada'); e1.code = 'EXISTS'; throw e1; }
          if (!isNew && !cur) { var e2 = new Error('Pengajuan tidak ditemukan'); e2.code = 'NOTFOUND'; throw e2; }
          if (!isNew && o.expectVersion && cur.version !== o.expectVersion) { var e3 = new Error('Data telah diubah oleh pengguna lain (versi ' + cur.version + '). Muat ulang.'); e3.code = 'CONFLICT'; throw e3; }
          var rec = Object.assign({}, cur || {}, p); rec.detailCount = rec.detailCount || 0; rec.detailLengkap = rec.detailLengkap || 0;
          stamp(rec, isNew); var m = {};
          m['pengajuan/' + rec.id] = clean(rec); m['pengajuan_idx/' + rec.ta + '/' + rec.id] = clean(C.compactOf(rec));
          if (rec.kdsatker) m['by_satker/' + rec.kdsatker + '/' + rec.id] = rec.ta;
          if (!isNew && cur.kdsatker && cur.kdsatker !== rec.kdsatker) m['by_satker/' + cur.kdsatker + '/' + rec.id] = null;
          if (!isNew && cur.ta !== rec.ta) m['pengajuan_idx/' + cur.ta + '/' + rec.id] = null;
          var d = isNew ? { before: null, after: rec } : diff(cur, rec);
          audit(m, 'pengajuan', rec.id, isNew ? 'tambah' : 'ubah', d.before, d.after, o.reason);
          var needInvalidate = !isNew && (cur.status !== rec.status || cur.dibatalkan !== rec.dibatalkan || cur.keterangan !== rec.keterangan || cur.kdsatker !== rec.kdsatker);
          return commit(m).then(function () { return needInvalidate ? s._invalidateDerived(rec.id, null, 'Perubahan status/keterangan pengajuan') : null; }).then(function () { return rec; });
        });
      },
      cancelPengajuan: function (id, reason) {
        need('batalkanPengajuan'); if (!C.S(reason)) return Promise.reject(Object.assign(new Error('Alasan pembatalan wajib'), { code: 'INVALID' }));
        return s.getPengajuan(id).then(function (cur) { if (!cur) throw new Error('Tidak ditemukan'); return s.savePengajuan(Object.assign({}, cur, { dibatalkan: true, alasanBatal: reason }), { reason: reason }); });
      },
      restorePengajuan: function (id, reason) {
        need('pulihkan'); return s.getPengajuan(id).then(function (cur) { return s.savePengajuan(Object.assign({}, cur, { dibatalkan: false, alasanBatal: '' }), { reason: reason || 'Dipulihkan' }); });
      },

      /** Ubah massal bidang administratif (TW / jalur / periodeProses). Hanya nilai yang DIPILIH pengguna; alasan wajib. */
      bulkUpdate: function (ids, patch, reason) {
        need('tulisPengajuan'); if (!C.S(reason)) return Promise.reject(Object.assign(new Error('Alasan wajib'), { code: 'INVALID' }));
        var allowed = ['tw', 'twSumber', 'jalur', 'periodeProses', 'status', 'keterangan'], bad = Object.keys(patch).filter(function (k) { return allowed.indexOf(k) < 0; });
        if (bad.length) return Promise.reject(new Error('Bidang tidak boleh diubah massal: ' + bad.join(',')));
        var done = 0, failed = [];
        return pmap(ids, 5, function (id) {
          return s.getPengajuan(id).then(function (cur) { if (!cur) throw new Error('tidak ada'); return s.savePengajuan(Object.assign({}, cur, patch), { reason: reason }); })
            .then(function () { done++; }, function (e) { failed.push({ id: id, why: e.message }); });
        }).then(function () { return { done: done, failed: failed }; });
      },

      getException: function (thang, kd, id) { return adapter.get('exception/' + thang + '/' + kd + '/' + id); },
      linkedExceptions: function (pid) {
        return adapter.get('exc_by_pengajuan/' + pid).then(function (map) {
          return pmap(entries(map), 8, function (e) { return adapter.get('exception/' + e[1].thang + '/' + e[1].kd + '/' + e[0]); });
        }).then(function (l) { return l.filter(Boolean); });
      },
      /* ---------------- detail ---------------- */
      _recount: function (pid) {
        return Promise.all([s.listDetails(pid), s.getPengajuan(pid)]).then(function (r) {
          var p = r[1]; if (!p) return null;
          var lengkap = r[0].filter(function (d) { var ex = C.expandDetail(d, p); return ex.rows.length && !ex.errors.length && ex.rows.every(function (x) { return !x.errors.length; }); }).length;
          return { detailCount: r[0].length, detailLengkap: lengkap, p: p };
        });
      },
      saveDetail: function (pid, d, o) {
        o = o || {}; need('tulisPengajuan');
        var isNew = !d.id; if (isNew) d.id = 'D' + adapter.newKey().replace(/[^A-Za-z0-9]/g, '');
        return Promise.all([s.getPengajuan(pid), adapter.get('detail/' + pid + '/' + d.id)]).then(function (r) {
          var p = r[0], cur = r[1]; if (!p) throw new Error('Pengajuan tidak ditemukan');
          if (!C.TYPES[d.jenis]) { var e = new Error('Jenis exception belum memiliki template'); e.code = 'NO_TEMPLATE'; throw e; }
          var rec = Object.assign({}, cur || {}, d); delete rec.id; stamp(rec, !cur);
          var m = {}; m['detail/' + pid + '/' + d.id] = clean(rec);
          var dd = cur ? diff(cur, rec) : { before: null, after: rec };
          audit(m, 'pengajuan', pid, cur ? 'ubah_detail' : 'tambah_detail', dd.before, dd.after, o.reason, { detailId: d.id });
          return commit(m).then(function () { return s._invalidateDerived(pid, d.id, 'Detail diubah'); }).then(function () { return s._refreshCounts(pid); }).then(function () { return Object.assign({ id: d.id }, rec); });
        });
      },
      deleteDetail: function (pid, did, reason) {
        need('tulisPengajuan'); if (!C.S(reason)) return Promise.reject(Object.assign(new Error('Alasan wajib'), { code: 'INVALID' }));
        return adapter.get('detail/' + pid + '/' + did).then(function (cur) {
          if (!cur) return null; var m = {}; m['detail/' + pid + '/' + did] = null; audit(m, 'pengajuan', pid, 'hapus_detail', cur, null, reason, { detailId: did });
          return commit(m).then(function () { return s._invalidateDerived(pid, did, 'Detail dihapus'); }).then(function () { return s._refreshCounts(pid); });
        });
      },
      _refreshCounts: function (pid) {
        return s._recount(pid).then(function (c) {
          if (!c) return null; var p = c.p; if (p.detailCount === c.detailCount && p.detailLengkap === c.detailLengkap) return p;
          p.detailCount = c.detailCount; p.detailLengkap = c.detailLengkap; var m = {};
          m['pengajuan/' + pid + '/detailCount'] = c.detailCount; m['pengajuan/' + pid + '/detailLengkap'] = c.detailLengkap;
          m['pengajuan_idx/' + p.ta + '/' + pid + '/detailCount'] = c.detailCount; m['pengajuan_idx/' + p.ta + '/' + pid + '/detailLengkap'] = c.detailLengkap;
          return commit(m).then(function () { return p; });
        });
      },

      /** Hapus turunan (exception yang BELUM diekspor) milik pengajuan/detail agar dibangun ulang. Riwayat tetap pada audit. */
      _invalidateDerived: function (pid, did, why) {
        return adapter.get('exc_by_pengajuan/' + pid).then(function (map) {
          var ids = entries(map); if (!ids.length) return null;
          return pmap(ids, 10, function (e) { return adapter.get('exception/' + e[1].thang + '/' + e[1].kd + '/' + e[0]).then(function (x) { return x ? { exc: x, thang: e[1].thang, kd: e[1].kd } : null; }); }).then(function (list) {
            var m = {}, removed = 0, kept = 0;
            list.filter(Boolean).forEach(function (it) {
              var x = it.exc, base = 'exception/' + it.thang + '/' + it.kd + '/' + x.id;
              var mine = Object.keys(x.refs || {}).filter(function (rk) { var r = x.refs[rk]; return r.pengajuanId === pid && (!did || r.detailId === did); });
              if (!mine.length) return;
              var exported = x.exportedIn && Object.keys(x.exportedIn).length;
              if (exported) { kept++; return; } // sudah diekspor: tidak diubah, perubahan di sumber dicatat saja
              mine.forEach(function (rk) { m[base + '/refs/' + rk] = null; });
              m['exc_by_pengajuan/' + pid + '/' + x.id] = null;
              var left = Object.keys(x.refs).filter(function (rk) { return mine.indexOf(rk) < 0; });
              if (!left.length && x.sumber === 'PENGAJUAN') {
                m[base] = null; m['exc_open/' + it.thang + '/' + it.kd + '/' + x.id] = null; removed++;
                if (x.caseId) { m['dedup_case/' + x.caseId] = null; m['dedup_open/' + x.caseId] = null; }
                audit(m, 'exception', x.id, 'hapus_turunan', { idKey: x.idKey, row: x.row, refs: x.refs }, null, why || 'Sumber berubah');
              } else if (x.caseId && mine.some(function (rk) { return rk === (x.caseRefKey || ''); })) { /* kandidat sengketa tetap */ }
            });
            return Object.keys(m).length ? commit(m).then(function () { return { removed: removed, kept: kept }; }) : { removed: 0, kept: kept };
          });
        });
      },

      /* ---------------- impor DB historis ---------------- */
      /** records: hasil C.parseDbRows(). Idempoten: ID stabil; record yang sudah ada TIDAK ditimpa. */
      importPengajuan: function (records, meta) {
        need('impor'); meta = meta || {};
        var byTa = {}; records.forEach(function (r) { (byTa[r.ta] = byTa[r.ta] || []).push(r); });
        return Promise.all(Object.keys(byTa).map(function (ta) { return s.listIndex(ta).then(function (l) { return [ta, l]; }); })).then(function (all) {
          var exist = {}; all.forEach(function (x) { x[1].forEach(function (c) { exist[c.id] = c; }); });
          var m = {}, created = 0, skipped = 0, ts = adapter.now(), who = user.name || user.email || '';
          records.forEach(function (r) {
            if (exist[r.id]) { skipped++; return; }
            var rec = Object.assign({}, r, { detailCount: 0, detailLengkap: 0, createdAt: ts, createdBy: who, updatedAt: ts, updatedBy: who, version: 1 });
            delete rec.warnings; rec.warnings = r.warnings;
            m['pengajuan/' + r.id] = clean(rec); m['pengajuan_idx/' + r.ta + '/' + r.id] = clean(C.compactOf(rec));
            if (r.kdsatker) m['by_satker/' + r.kdsatker + '/' + r.id] = r.ta;
            created++;
          });
          var logId = C.hash([meta.fileHash || meta.file || '', records.map(function (r) { return r.id; }).join(',')].join('|'));
          m['import_log/' + logId + '_' + ts.replace(/[^0-9]/g, '')] = clean({ ts: ts, by: who, file: meta.file || '', fileHash: meta.fileHash || '', ta: meta.ta || '', total: records.length, created: created, skipped: skipped });
          audit(m, 'import', logId, 'impor_pengajuan', null, { file: meta.file, created: created, skipped: skipped }, meta.reason || 'Impor DB Penyesuaian IKPA');
          return commit(m).then(function (c) { return { created: created, skipped: skipped, chunks: c.chunks }; });
        });
      },

      /* ---------------- kandidat Master Exception & dedup ---------------- */
      _loadItems: function (ta, pids) {
        return (pids ? Promise.resolve(pids) : s.listIndex(ta).then(function (l) { return l.filter(function (c) { return !c.dibatalkan; }).map(function (c) { return c.id; }); })).then(function (ids) {
          return pmap(ids, 12, function (id) { return Promise.all([s.getPengajuan(id), s.listDetails(id)]).then(function (r) { return r[0] ? { p: r[0], d: r[1] } : null; }); });
        }).then(function (l) { return l.filter(Boolean); });
      },
      loadExceptionsFor: function (pairs) { // pairs: [[thang,kd]]
        var uniq = {}; pairs.forEach(function (p) { uniq[p[0] + '/' + p[1]] = p; });
        return pmap(Object.keys(uniq), 15, function (k) { return adapter.get('exception/' + k).then(function (o) { return toArr(o); }); }).then(function (a) { return [].concat.apply([], a); });
      },
      loadCases: function () { return adapter.get('dedup_case').then(function (o) { return entries(o).map(function (e) { return Object.assign({ id: e[0] }, e[1]); }); }); },
      listOpenCases: function () { return adapter.get('dedup_open').then(function (o) { return entries(o).map(function (e) { return Object.assign({ id: e[0] }, e[1]); }); }); },

      /** Pratinjau: kembalikan rencana TANPA menulis. */
      planCandidates: function (ta, o) {
        o = o || {};
        return Promise.all([s._loadItems(ta, o.pengajuanIds), s.getSettings(), s.loadCases()]).then(function (r) {
          var items = [], cfg = r[1], cases = r[2];
          r[0].forEach(function (x) { x.d.forEach(function (d) { items.push({ pengajuan: x.p, detail: d }); }); });
          var pairs = []; items.forEach(function (it) { if (!C.TYPES[it.detail.jenis]) return; C.expandDetail(it.detail, it.pengajuan).rows.forEach(function (rw) { pairs.push([C.S(rw.row.THANG), C.S(rw.row[C.TYPES[it.detail.jenis].satkerKey || 'KDSATKER'])]); }); });
          return s.loadExceptionsFor(pairs.filter(function (p) { return p[0] && /^\d{6}$/.test(p[1]); })).then(function (existing) {
            var decisions = {}; cases.forEach(function (c) { decisions[c.id] = c; });
            var plan = C.buildPlan(items, existing, cfg, decisions);
            plan.itemCount = items.length; plan.pengajuanCount = r[0].length;
            plan.tanpaDetail = r[0].filter(function (x) { return !x.d.length && C.eligibility(x.p, cfg).ok; }).map(function (x) { return x.p.id; });
            return plan;
          });
        });
      },
      applyPlan: function (plan, reason) {
        need('bangunKandidat'); var m = {}, ts = adapter.now();
        plan.creates.forEach(function (e) {
          e.createdAt = ts; e.createdBy = user.name || user.email || '';
          var base = 'exception/' + e.thang + '/' + e.kdsatker + '/' + e.id;
          m[base] = clean(e); m['exc_open/' + e.thang + '/' + e.kdsatker + '/' + e.id] = { st: e.st, jenis: e.jenis };
          Object.keys(e.refs).forEach(function (rk) { m['exc_by_pengajuan/' + e.refs[rk].pengajuanId + '/' + e.id] = { thang: e.thang, kd: e.kdsatker }; });
          audit(m, 'exception', e.id, 'buat_kandidat', null, { jenis: e.jenis, row: e.row, st: e.st }, reason);
        });
        plan.links.forEach(function (l) {
          var base = 'exception/' + l.thang + '/' + l.kdsatker + '/' + l.excId;
          m[base + '/refs/' + l.refKey] = clean(l.ref); m['exc_by_pengajuan/' + l.ref.pengajuanId + '/' + l.excId] = { thang: l.thang, kd: l.kdsatker };
          audit(m, 'exception', l.excId, 'hubungkan_pengajuan', null, { refKey: l.refKey, ref: l.ref }, reason || 'Substansi identik dengan exception existing');
        });
        plan.cases.forEach(function (c) {
          var exc = plan.creates.filter(function (e) { return e.id === c.kandidatExcId; })[0];
          var rec = Object.assign({}, c, { createdAt: ts, thang: exc.thang, kd: exc.kdsatker });
          m['dedup_case/' + c.id] = clean(rec);
          if (c.status === 'MENUNGGU' || c.status === 'PERLU_PEMERIKSAAN') m['dedup_open/' + c.id] = clean({ thang: exc.thang, kd: exc.kdsatker, jenis: c.jenis, status: c.status });
          audit(m, 'dedup', c.id, 'deteksi_potensi_duplikat', null, { matches: c.matches, diff: c.diff }, reason);
        });
        audit(m, 'build', 'candidates', 'bangun_kandidat', null, plan.stats, reason);
        return commit(m).then(function (c) { return { applied: true, stats: plan.stats, chunks: c.chunks }; });
      },

      /** Keputusan pengguna atas kasus POTENSI_DUPLIKAT. action: HUBUNGKAN | BARU | PERLU_PEMERIKSAAN. alasan WAJIB. */
      resolveCase: function (caseId, action, o) {
        need('selesaikanDuplikat'); o = o || {};
        if (!C.S(o.reason)) return Promise.reject(Object.assign(new Error('Alasan keputusan wajib diisi'), { code: 'INVALID' }));
        if (['HUBUNGKAN', 'BARU', 'PERLU_PEMERIKSAAN'].indexOf(action) < 0) return Promise.reject(new Error('Aksi tidak dikenal'));
        return adapter.get('dedup_case/' + caseId).then(function (cs) {
          if (!cs) throw new Error('Kasus tidak ditemukan');
          var candPath = 'exception/' + cs.thang + '/' + cs.kd + '/' + cs.kandidatExcId;
          return adapter.get(candPath).then(function (cand) {
            if (!cand) throw new Error('Exception kandidat sudah tidak ada');
            var m = {}, ts = adapter.now(), who = user.name || user.email || '';
            var dec = { by: who, uid: user.uid || '', at: ts, reason: o.reason, action: action };
            if (action === 'HUBUNGKAN') {
              var tid = o.targetExcId || cs.matches[0];
              if (cs.matches.indexOf(tid) < 0) throw new Error('Target harus salah satu exception yang cocok');
              var tpath = 'exception/' + cs.thang + '/' + cs.kd + '/' + tid;
              // target bisa berada pada partisi (thang,kd) yang sama karena slot mencakup THANG & KDSATKER
              return adapter.get(tpath).then(function (target) {
                if (!target) throw new Error('Target tidak ditemukan');
                Object.keys(cand.refs || {}).forEach(function (rk) {
                  var ref = Object.assign({}, cand.refs[rk], { linkType: 'DIHUBUNGKAN' });
                  m[tpath + '/refs/' + rk] = clean(ref); m['exc_by_pengajuan/' + ref.pengajuanId + '/' + tid] = { thang: cs.thang, kd: cs.kd }; m['exc_by_pengajuan/' + ref.pengajuanId + '/' + cand.id] = null;
                });
                m[candPath] = null; m['exc_open/' + cs.thang + '/' + cs.kd + '/' + cand.id] = null;
                m['dedup_case/' + caseId + '/status'] = 'HUBUNGKAN'; m['dedup_case/' + caseId + '/target'] = tid; m['dedup_case/' + caseId + '/targetThang'] = cs.thang; m['dedup_case/' + caseId + '/targetKd'] = cs.kd; m['dedup_case/' + caseId + '/keputusan'] = dec; m['dedup_open/' + caseId] = null;
                audit(m, 'dedup', caseId, 'putuskan_hubungkan', { kandidat: cand }, { target: tid }, o.reason);
                audit(m, 'exception', tid, 'terima_hubungan', null, { dariKandidat: cand.id, refs: cand.refs }, o.reason);
                return commit(m).then(function () { return { action: action, target: tid }; });
              });
            }
            if (action === 'BARU') {
              m[candPath + '/st'] = 'KANDIDAT'; m[candPath + '/verifiedNew'] = true; m['exc_open/' + cs.thang + '/' + cs.kd + '/' + cand.id] = { st: 'KANDIDAT', jenis: cand.jenis };
              m['dedup_case/' + caseId + '/status'] = 'BARU'; m['dedup_case/' + caseId + '/keputusan'] = dec; m['dedup_open/' + caseId] = null;
              audit(m, 'dedup', caseId, 'putuskan_baru', { st: cand.st }, { st: 'KANDIDAT' }, o.reason);
              return commit(m).then(function () { return { action: action }; });
            }
            m['dedup_case/' + caseId + '/status'] = 'PERLU_PEMERIKSAAN'; m['dedup_case/' + caseId + '/keputusan'] = dec; m['dedup_open/' + caseId] = { thang: cs.thang, kd: cs.kd, jenis: cs.jenis, status: 'PERLU_PEMERIKSAAN' };
            audit(m, 'dedup', caseId, 'tandai_perlu_pemeriksaan', null, null, o.reason);
            return commit(m).then(function () { return { action: action }; });
          });
        });
      },

      /* ---------------- ekspor ---------------- */
      listOpenIndex: function (thang) { return adapter.get('exc_open/' + thang).then(function (o) { var out = []; entries(o).forEach(function (k) { entries(k[1]).forEach(function (e) { out.push({ thang: thang, kd: k[0], id: e[0], st: e[1].st, jenis: e[1].jenis }); }); }); return out; }); },
      loadOpenExceptions: function (thang, f) {
        f = f || {};
        return s.listOpenIndex(thang).then(function (ix) {
          ix = ix.filter(function (x) { return (!f.jenis || x.jenis === f.jenis) && (!f.kd || x.kd === f.kd); });
          var kds = {}; ix.forEach(function (x) { kds[x.kd] = 1; });
          return pmap(Object.keys(kds), 15, function (kd) { return adapter.get('exception/' + thang + '/' + kd).then(function (o) { return toArr(o); }); }).then(function (a) {
            var want = {}; ix.forEach(function (x) { want[x.id] = 1; });
            return [].concat.apply([], a).filter(function (e) { return want[e.id]; });
          });
        });
      },
      exportBlockers: function (excs, cfg) {
        cfg = cfg || C.DEFAULT_CONFIG; var b = [];
        var k = function (fn) { return excs.filter(fn).map(function (e) { return e.id; }); };
        var pot = k(function (e) { return e.st === 'PERLU_VERIFIKASI'; }); if (pot.length && cfg.blockOnPotensi) b.push({ code: 'POTENSI_DUPLIKAT', msg: pot.length + ' exception berstatus potensi duplikat belum diverifikasi', ids: pot });
        var inc = k(function (e) { return e.st === 'PERLU_DILENGKAPI' || (e.errors && e.errors.length); }); if (inc.length) b.push({ code: 'PERLU_DILENGKAPI', msg: inc.length + ' exception belum lengkap / tidak valid', ids: inc });
        if (cfg.blockOnWarnings) { var w = k(function (e) { return e.warnings && e.warnings.length; }); if (w.length) b.push({ code: 'PERINGATAN', msg: w.length + ' exception memiliki peringatan', ids: w }); }
        return b;
      },
      /** Ekspor final: catat ledger + tandai exception sebagai TEREKSPOR (tidak muncul lagi pada ekspor periode berikutnya). */
      finalizeExport: function (excs, params) {
        need('ekspor'); params = params || {};
        return s.getSettings().then(function (cfg) {
          var again = excs.filter(function (e) { return e.exportedIn && Object.keys(e.exportedIn).length; });
          if (again.length) { if (!params.reexport) throw Object.assign(new Error(again.length + ' exception sudah pernah diekspor. Gunakan ekspor ulang (admin) dengan alasan.'), { code: 'ALREADY_EXPORTED' }); need('eksporUlang'); if (!C.S(params.reexportReason)) throw Object.assign(new Error('Alasan ekspor ulang wajib'), { code: 'INVALID' }); }
          var bl = s.exportBlockers(excs, cfg); if (bl.length) throw Object.assign(new Error('Ekspor final diblokir: ' + bl.map(function (x) { return x.msg; }).join('; ')), { code: 'BLOCKED', blockers: bl });
          var id = 'X' + adapter.newKey().replace(/[^A-Za-z0-9]/g, ''), ts = adapter.now(), m = {};
          var perSheet = {}; excs.forEach(function (e) { perSheet[e.jenis] = (perSheet[e.jenis] || 0) + 1; });
          var sm = C.summarize(excs, cfg);
          var checksum = C.hash(excs.map(function (e) { return e.idKey; }).sort().join('\n'));
          m['export/' + id] = clean({ ts: ts, by: user.name || user.email || '', uid: user.uid || '', fileName: params.fileName || '', periodeProses: params.periodeProses || '', ta: params.ta || '', filters: params.filters || {}, sql: !!params.sql, note: params.note || '', counts: { perSheet: perSheet, sumberPengajuan: sm.sumberPengajuan, unik: sm.unik, duplikatIdentik: sm.duplikatIdentik }, checksum: checksum, ids: excs.map(function (e) { return e.id; }), reexport: params.reexport ? { reason: params.reexportReason } : null });
          excs.forEach(function (e) {
            var base = 'exception/' + e.thang + '/' + e.kdsatker + '/' + e.id;
            m[base + '/exportedIn/' + id] = ts; m[base + '/st'] = 'TEREKSPOR'; m['exc_open/' + e.thang + '/' + e.kdsatker + '/' + e.id] = null;
          });
          audit(m, 'export', id, params.reexport ? 'ekspor_ulang' : 'ekspor_final', null, { unik: sm.unik, perSheet: perSheet, checksum: checksum }, params.reexportReason || params.fileName);
          return commit(m).then(function () { return { exportId: id, checksum: checksum, counts: perSheet, summary: sm }; });
        });
      },
      listExports: function (n) { return adapter.getLastKeys('export', n || 30).then(function (a) { return a.map(function (e) { return Object.assign({ id: e[0] }, e[1]); }).reverse(); }); },

      /* ---------------- rekonsiliasi file Master Exception historis ---------------- */
      /** rows: hasil C.parseMasterExceptionSheets().rows. markExported: dianggap sudah dimasukkan ke MyIntress. */
      importHistoricalME: function (rows, meta) {
        need('impor'); meta = meta || {};
        var pairs = rows.map(function (r) { return [C.S(r.row.THANG), C.S(r.row[C.TYPES[r.jenis].satkerKey || 'KDSATKER'])]; }).filter(function (p) { return p[0] && /^\d{6}$/.test(p[1]); });
        return s.loadExceptionsFor(pairs).then(function (existing) {
          var have = {}; existing.forEach(function (e) { have[e.id] = e; });
          var m = {}, created = 0, merged = 0, ts = adapter.now(), fid = 'ME' + C.hash((meta.file || '') + '|' + rows.length), seen = {};
          rows.forEach(function (r) {
            var e = C.excFromMeRow(r, meta), base = 'exception/' + e.thang + '/' + e.kdsatker + '/' + e.id;
            if (!/^\d{6}$/.test(e.kdsatker)) return;
            if (have[e.id] || seen[e.id]) { // sudah tercatat: hanya tambah jejak sumber, tidak menggandakan record
              m[base + '/meSumber_' + fid] = clean({ file: meta.file, sheet: r.sheet, baris: r.baris }); merged++; if (meta.markExported && have[e.id] && !(have[e.id].exportedIn && have[e.id].exportedIn[fid])) { m[base + '/exportedIn/' + fid] = ts; m[base + '/st'] = 'TEREKSPOR'; m['exc_open/' + e.thang + '/' + e.kdsatker + '/' + e.id] = null; } return;
            }
            seen[e.id] = 1; e.createdAt = ts; e.createdBy = user.name || user.email || '';
            if (meta.markExported) { e.exportedIn = {}; e.exportedIn[fid] = ts; e.st = 'TEREKSPOR'; }
            m[base] = clean(e); if (!meta.markExported) m['exc_open/' + e.thang + '/' + e.kdsatker + '/' + e.id] = { st: e.st, jenis: e.jenis };
            created++;
          });
          audit(m, 'import', fid, 'impor_me_historis', null, { file: meta.file, created: created, merged: merged, markExported: !!meta.markExported }, meta.reason || 'Rekonsiliasi file Master Exception historis');
          return commit(m).then(function () { return { created: created, merged: merged }; });
        });
      }
    };
    // seluruh method async-konsisten: kesalahan sinkron (mis. hak akses) menjadi promise yang ditolak
    Object.keys(s).forEach(function (k) {
      var fn = s[k]; if (typeof fn !== 'function' || k === 'exportBlockers' || k === 'validatePengajuan') return;
      s[k] = function () { try { return Promise.resolve(fn.apply(s, arguments)); } catch (e) { return Promise.reject(e); } };
    });
    return s;
  }

  return { createStore: createStore, MemoryAdapter: MemoryAdapter, RtdbAdapter: RtdbAdapter, pmap: pmap, clean: clean };
});
