/*!
 * TORING — Monitoring Penyesuaian IKPA
 * sheets-adapter.js : adapter penyimpanan ke Google Sheets (melalui web app Google Apps Script, lihat apps-script/Code.gs).
 *
 * Antarmuka sama dengan MemoryAdapter (get / update(multi-path) / newKey / now / getLastKeys), sehingga store.js tidak berubah.
 * Pemetaan jalur virtual:
 *   pengajuan/*, detail/*, pengajuan_idx/*, by_satker/*  -> BARIS spreadsheet (Sheet1 / sheet Eselon I). Indeks diturunkan di sini.
 *   exception/*, exc_*, dedup_*, config/*                -> sheet _DATA (dimuat saat refresh)
 *   audit/*, audit_global, export, import_log            -> sheet _AUDIT / _DATA (dibaca sesuai kebutuhan)
 *   users/{email}                                        -> sheet _Pengguna (hanya admin)
 * Tidak ada rahasia di sini: setiap permintaan membawa token Firebase milik pengguna; server memverifikasinya.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IkpaSheets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clone(o) { return o === undefined || o === null ? null : JSON.parse(JSON.stringify(o)); }
  function seg(p) { return String(p).split('/').filter(Boolean); }
  function setDeep(tree, s, val) {
    if (s.length === 1) { if (val === null) delete tree[s[0]]; else tree[s[0]] = val; return; }
    if (tree[s[0]] === null || typeof tree[s[0]] !== 'object') { if (val === null) return; tree[s[0]] = {}; }
    setDeep(tree[s[0]], s.slice(1), val);
    if (tree[s[0]] && typeof tree[s[0]] === 'object' && !Object.keys(tree[s[0]]).length) delete tree[s[0]];
  }
  function getDeep(tree, s) { var n = tree; for (var i = 0; i < s.length; i++) { if (n === null || typeof n !== 'object' || !(s[i] in n)) return null; n = n[s[i]]; } return n; }
  function clean(v) {
    if (v === undefined) return null;
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { var x = clean(v[k]); if (x !== null) o[k] = x; }); return o; }
    return v;
  }

  /** opts: {url, getToken():Promise<string>, C:core, fetch?, satkerLookup?(kode)} */
  function SheetsAdapter(opts) {
    var C = opts.C, fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(typeof self !== 'undefined' ? self : globalThis) : null);
    var P = {}, D = {}, KV = {}, unreadable = [], sheetNames = [], seq = 0, info = null, loadedAt = null;
    var DERIVED_FIELDS = { detailCount: 1, detailLengkap: 1 };

    function call(action, body) {
      if (!opts.url) return Promise.reject(Object.assign(new Error('WEBAPP_URL belum diisi (ikpa-adj/config.js).'), { code: 'NO_URL' }));
      return Promise.resolve(opts.getToken()).then(function (token) {
        return fetchFn(opts.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action: action, token: token }, body || {})), redirect: 'follow' });
      }, function (e) { throw Object.assign(new Error('Belum masuk: ' + (e && e.message || e)), { code: 'UNAUTHENTICATED' }); })
        .then(function (r) { if (!r.ok) throw Object.assign(new Error('Web app menjawab HTTP ' + r.status), { code: 'HTTP' }); return r.text(); }, function (e) { throw Object.assign(new Error('Tidak dapat terhubung ke web app: ' + (e && e.message || e)), { code: 'NETWORK' }); })
        .then(function (t) {
          var j; try { j = JSON.parse(t); } catch (e) { throw Object.assign(new Error('Jawaban web app bukan JSON — periksa deployment (Who has access: Anyone) dan WEBAPP_URL.'), { code: 'BAD_RESPONSE' }); }
          if (!j.ok) throw Object.assign(new Error(j.message || 'Permintaan ditolak'), { code: j.code || 'ERROR' });
          return j;
        });
    }

    function lookup(kd) { return opts.satkerLookup ? opts.satkerLookup(kd) : null; }
    function applySnapshot(j) {
      P = {}; D = {}; KV = {}; unreadable = []; sheetNames = [];
      j.sheets.forEach(function (sh) {
        sheetNames.push(sh.name);
        sh.rows.forEach(function (line) {
          var r = C.recordFromRow(sh.name, line[0], line.slice(1), sh.headers, { satkerLookup: lookup });
          if (!r) return;
          if (r.error) { unreadable.push(r); return; }
          var rec = r.record;
          if (P[rec.id]) { unreadable.push({ error: 'ID pengajuan ganda: ' + rec.id + ' (juga pada sheet ' + P[rec.id].sheet + ' baris ' + P[rec.id].row + ')', row: line[0], sheet: sh.name }); return; }
          P[rec.id] = rec; var dd = {};
          r.details.forEach(function (d) { var x = clone(d); var id = x.id; delete x.id; dd[id] = x; });
          if (Object.keys(dd).length) D[rec.id] = dd;
        });
      });
      (j.kv || []).forEach(function (e) { try { setDeep(KV, seg(e[0]), JSON.parse(e[1])); } catch (x) { /* dokumen rusak diabaikan */ } });
      info = { email: j.email, name: j.name, role: j.role, version: j.version }; loadedAt = j.serverTime;
    }
    function detailsOf(pid, src) { var o = (src || D)[pid] || {}; return Object.keys(o).map(function (id) { return Object.assign({ id: id }, o[id]); }); }

    var api = {
      kind: 'sheets',
      whoami: function () { return call('whoami'); },
      refresh: function (rescan) { return call('snapshot', { rescan: !!rescan }).then(function (j) { applySnapshot(j); return { pengajuan: Object.keys(P).length, sheets: sheetNames.slice(), unreadable: unreadable.length }; }); },
      info: function () { return info; },
      unreadable: function () { return unreadable.slice(); },
      sheetNames: function () { return sheetNames.slice(); },
      loadedAt: function () { return loadedAt; },
      /** pengajuan yang sudah ada (id & contentId) — untuk impor idempoten */
      existingIds: function () { var o = {}; Object.keys(P).forEach(function (id) { o[id] = 1; if (P[id].contentId) o[P[id].contentId] = 1; }); return o; },

      get: function (path) {
        var s = seg(path), root = s[0];
        switch (root) {
          case 'pengajuan': { if (s.length === 1) return Promise.resolve(null); var r = P[s[1]]; if (!r) return Promise.resolve(null); r = clone(r); return Promise.resolve(s.length > 2 ? (r[s[2]] === undefined ? null : r[s[2]]) : r); }
          case 'pengajuan_idx': {
            var ta = s[1], o = {}; Object.keys(P).forEach(function (id) { if (P[id].ta === ta) { var c = C.compactOf(P[id]); c.contentId = P[id].contentId || ''; o[id] = c; } });
            return Promise.resolve(s.length > 2 ? (o[s[2]] || null) : (Object.keys(o).length ? o : null));
          }
          case 'by_satker': {
            var kd = s[1], m = {}; Object.keys(P).forEach(function (id) { if (P[id].kdsatker === kd) m[id] = P[id].ta; });
            return Promise.resolve(Object.keys(m).length ? m : null);
          }
          case 'detail': { var dd = D[s[1]]; if (!dd) return Promise.resolve(null); return Promise.resolve(s.length > 2 ? clone(dd[s[2]]) : clone(dd)); }
          case 'users': return call('users.list').then(function (j) { var o = {}; j.users.forEach(function (u) { o[u.email] = { role: u.role, name: u.name, email: u.email, note: u.note, fixed: !!u.fixed }; }); return s.length > 1 ? (o[s[1]] || null) : o; });
          case 'export': case 'import_log': return call('last', { path: s.join('/'), n: 500 }).then(function (j) { var o = {}; j.items.forEach(function (e) { o[e[0]] = e[1]; }); return s.length > 1 ? (o[s[1]] || null) : (Object.keys(o).length ? o : null); });
          case 'audit': case 'audit_global': return call('last', { path: s.join('/'), n: 500 }).then(function (j) { var o = {}; j.items.forEach(function (e) { o[e[0]] = e[1]; }); return Object.keys(o).length ? o : null; });
          default: return Promise.resolve(clone(getDeep(KV, s)));
        }
      },

      update: function (multi) {
        var stagedP = {}, stagedD = {}, touched = {}, kvOps = [], userOps = [];
        try {
          Object.keys(multi).forEach(function (path) {
            var v = multi[path] === undefined ? null : clean(multi[path]), s = seg(path), pid;
            switch (s[0]) {
              case 'pengajuan_idx': case 'by_satker': return; // diturunkan dari baris
              case 'pengajuan': {
                pid = s[1]; var rec = stagedP[pid] || (stagedP[pid] = P[pid] ? clone(P[pid]) : null);
                if (s.length === 2) {
                  if (v === null) throw new Error('Penghapusan pengajuan tidak didukung (gunakan pembatalan).');
                  var old = rec; rec = clone(v); if (old) { rec.sheet = old.sheet; rec.row = old.row; rec.version = old.version; rec.contentId = rec.contentId || old.contentId; } stagedP[pid] = rec; touched[pid] = 1;
                } else if (s.length === 3) {
                  if (DERIVED_FIELDS[s[2]]) return; // jumlah detail dihitung ulang dari baris
                  if (!rec) throw new Error('Pengajuan tidak ada: ' + pid);
                  if (v === null) delete rec[s[2]]; else rec[s[2]] = v; touched[pid] = 1;
                } else throw new Error('Path tidak didukung pada penyimpanan sheet: ' + path);
                return;
              }
              case 'detail': {
                pid = s[1]; var det = stagedD[pid] || (stagedD[pid] = clone(D[pid]) || {});
                if (s.length === 3) { if (v === null) delete det[s[2]]; else det[s[2]] = v; }
                else if (s.length === 2 && v === null) stagedD[pid] = {};
                else throw new Error('Path tidak didukung pada penyimpanan sheet: ' + path);
                touched[pid] = 1; return;
              }
              case 'users': userOps.push({ email: s[1], value: v }); return;
              default: kvOps.push({ path: path, value: v });
            }
          });
        } catch (e) { return Promise.reject(e); }
        var rows = [];
        try {
          Object.keys(touched).forEach(function (pid) {
            var rec = stagedP[pid] || P[pid]; if (!rec) throw new Error('Pengajuan tidak ada: ' + pid);
            var det = detailsOf(pid, stagedD[pid] !== undefined ? (function () { var o = {}; o[pid] = stagedD[pid]; return o; })() : null);
            rows.push({ sheet: C.targetSheetOf(rec), id: pid, cells: C.recordToCells(rec, det), prevVersion: P[pid] ? P[pid].version : null, isNew: !P[pid] });
          });
        } catch (e2) { return Promise.reject(e2); }
        var body = { rows: rows, kv: kvOps };
        var pWrite = rows.length || kvOps.length ? call('write', body) : Promise.resolve({ rows: [] });
        return pWrite.then(function (res) {
          (res.rows || []).forEach(function (r) {
            var pid = r.id, rec = stagedP[pid] || clone(P[pid]);
            rec.sheet = r.sheet; rec.row = r.row; rec.version = r.version; rec.updatedAt = r.updatedAt; rec.updatedBy = r.updatedBy;
            var dets = stagedD[pid] !== undefined ? stagedD[pid] : (D[pid] || {});
            var arr = Object.keys(dets).map(function (id) { return Object.assign({ id: id }, dets[id]); }), dc = C.deriveCounts(rec, arr);
            rec.detailCount = dc.detailCount; rec.detailLengkap = dc.detailLengkap; P[pid] = rec;
            if (Object.keys(dets).length) D[pid] = dets; else delete D[pid];
          });
          kvOps.forEach(function (op) { var s = seg(op.path); if (s[0] === 'audit' || s[0] === 'audit_global' || s[0] === 'export' || s[0] === 'import_log') return; setDeep(KV, s, op.value); });
          return userOps.reduce(function (p, u) { return p.then(function () { var v = u.value; return call('users.set', { email: u.email, role: v ? v.role : 'hapus', name: v ? v.name : '', note: v ? v.note || '' : '' }); }); }, Promise.resolve());
        }, function (e) {
          if (e && (e.code === 'CONFLICT' || e.code === 'NOTFOUND')) return api.refresh().then(function () { throw e; }, function () { throw e; });
          throw e;
        });
      },

      newKey: function () { seq++; return '-M' + Date.now().toString(36) + ('0000' + seq.toString(36)).slice(-4) + Math.random().toString(36).slice(2, 6); },
      now: function () { return new Date().toISOString(); },
      getLastKeys: function (path, n) { return call('last', { path: path, n: n || 50 }).then(function (j) { return j.items; }); }
    };
    return api;
  }

  return { SheetsAdapter: SheetsAdapter };
});
