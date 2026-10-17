/**
 * TORING — Monitoring Penyesuaian IKPA : backend Google Sheets (Google Apps Script, terikat ke spreadsheet).
 *
 * Fungsi: satu-satunya jalur tulis dari form TORING ke spreadsheet. Tidak ada rahasia di sisi frontend.
 *  - Autentikasi : token Firebase Auth (Google) milik pengguna diverifikasi ke Google (Identity Toolkit) pada setiap permintaan.
 *  - Otorisasi   : peran dibaca dari sheet "_Pengguna" (+ properti skrip ADMIN_EMAILS). Tanpa peran => ditolak.
 *  - Data        : pengajuan = BARIS pada "Sheet1" (jalur Satker / belum diverifikasi) atau sheet bernama Eselon I (jalur Eselon I).
 *                  Kolom A–S = format DB yang sudah berjalan; kolom T dst ditambahkan skrip (lihat APP_COLS).
 *                  Data teknis (exception, kasus duplikasi, ekspor, konfigurasi) di sheet "_DATA"; audit di "_AUDIT" (hanya ditambah).
 *
 * Salinan LEGACY_COLS/APP_COLS harus identik dengan ikpa-adj/core.js (dijaga oleh tes).
 */
var VERSION = '1.0.0';
var DEFAULT_FIREBASE_API_KEY = 'AIzaSyC_ZKnUwPv40f_GytMTHb1MTaPO_p5lPHY'; // kunci web publik proyek Firebase TORING (bukan rahasia)
var MAIN_SHEET = 'Sheet1';
var USERS_SHEET = '_Pengguna', DATA_SHEET = '_DATA', AUDIT_SHEET = '_AUDIT';
var LEGACY_COLS = ['No', 'Tanggal Input', 'Nama Kanwil DJPb/Eselon I K/L', 'Nomor ND', 'Tanggal ND', 'Indikator', 'Kode Satker', 'Kode KPPN', 'Nomor Dokumen', 'Status', 'Keterangan', 'Alasan Penolakan', 'Komponen', 'Exception', 'Kronologis', 'Perbaikan/Catatan', 'K/L', 'Nama K/L', 'Satker'];
var APP_COLS = ['ID Pengajuan', 'Jalur', 'TA', 'TW', 'Nama Satker', 'Mekanisme Penyesuaian', 'Uraian Mekanisme', 'Detail Mekanisme (JSON)', 'Meta (JSON)', 'Diperbarui Oleh', 'Diperbarui Pada', 'Versi', 'Dipindahkan Ke'];
var ALL_COLS = LEGACY_COLS.concat(APP_COLS);
var DATE_COLS = ['Tanggal Input', 'Tanggal ND'];
var TEXT_COLS = ['Kode Satker', 'Kode KPPN', 'K/L', 'Satker', 'ID Pengajuan', 'TA', 'TW', 'Versi', 'Diperbarui Pada'];
var DERIVED_COLS = ['K/L', 'Nama K/L', 'Satker']; // pada Sheet1 bisa berupa rumus; rumus disalin ke baris baru
var EDIT_ROLES = ['admin', 'pengelola', 'perekam'], MGR_ROLES = ['admin', 'pengelola'], READ_ROLES = ['admin', 'pengelola', 'perekam', 'pembaca'];
var USER_ROLES = ['admin', 'pengelola', 'perekam', 'pembaca', 'nonaktif'];
var KV_DEPTH = { exception: 4, exc_open: 4, exc_by_pengajuan: 3, dedup_case: 2, dedup_open: 2, export: 2, import_log: 2, config: 2 };
var KV_CACHED = ['exception', 'exc_open', 'exc_by_pengajuan', 'dedup_case', 'dedup_open', 'config'];
var KV_DERIVED_ROOTS = ['exception', 'exc_open', 'exc_by_pengajuan', 'dedup_case', 'dedup_open'];
var CELL_LIMIT = 48000;

/* ------------------------------------------------------------------ pintu masuk */
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function AppError(code, msg) { var e = new Error(msg); e.code = code; return e; }
function doGet() { return json_({ ok: true, app: 'toring-ikpa-adj', version: VERSION }); }
function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return json_({ ok: false, code: 'BAD_REQUEST', message: 'Permintaan bukan JSON' }); }
  return json_(handle(req));
}

function handle(req) {
  try {
    if (req.action === 'ping') return { ok: true, version: VERSION };
    var user = authenticate_(req.token), role = roleFor_(user.email);
    if (req.action === 'whoami') return { ok: true, email: user.email, name: user.name, role: role, version: VERSION };
    if (!role || role === 'nonaktif') throw AppError('FORBIDDEN', 'Akun ' + user.email + ' belum terdaftar / dinonaktifkan. Hubungi admin.');
    switch (req.action) {
      case 'snapshot': return snapshot_(req, user, role);
      case 'write': return write_(req, user, role);
      case 'last': return last_(req, role);
      case 'users.list': need_(role, ['admin']); return { ok: true, users: listUsers_() };
      case 'users.set': need_(role, ['admin']); return setUser_(req, user);
      default: throw AppError('BAD_REQUEST', 'Aksi tidak dikenal: ' + req.action);
    }
  } catch (e) { return { ok: false, code: e.code || 'ERROR', message: e.message || String(e) }; }
}
function need_(role, allowed) { if (allowed.indexOf(role) < 0) throw AppError('FORBIDDEN', 'Peran "' + role + '" tidak diizinkan untuk aksi ini'); }

/* ---------------------------------------------------------------- autentikasi */
function props_() { return PropertiesService.getScriptProperties(); }
function authenticate_(token) {
  if (!token) throw AppError('UNAUTHENTICATED', 'Token masuk tidak ada');
  var cache = CacheService.getScriptCache(), key = 'tok_' + sha_(token), hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var apiKey = props_().getProperty('FIREBASE_API_KEY') || DEFAULT_FIREBASE_API_KEY;
  var resp = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(apiKey), { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: token }), muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw AppError('UNAUTHENTICATED', 'Token masuk tidak valid atau kedaluwarsa. Masuk ulang.');
  var body = JSON.parse(resp.getContentText()), u = body.users && body.users[0];
  if (!u || !u.email) throw AppError('UNAUTHENTICATED', 'Akun tidak memiliki email');
  if (u.emailVerified === false) throw AppError('UNAUTHENTICATED', 'Email akun belum terverifikasi');
  var out = { email: String(u.email).toLowerCase(), name: u.displayName || '' };
  cache.put(key, JSON.stringify(out), 300);
  return out;
}
function sha_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }

function roleFor_(email) {
  email = String(email || '').toLowerCase();
  var admins = (props_().getProperty('ADMIN_EMAILS') || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  if (admins.indexOf(email) > -1) return 'admin';
  var rows = usersRows_(), exact = null, dom = null, any = null, at = email.indexOf('@') > -1 ? email.slice(email.indexOf('@')) : '';
  rows.forEach(function (r) {
    var k = String(r.email).toLowerCase();
    if (k === email) exact = r.role; else if (at && k === at) dom = r.role; else if (k === '*') any = r.role;
  });
  var role = exact || dom || any || null;
  return role && USER_ROLES.indexOf(role) > -1 ? role : null;
}

/* ------------------------------------------------------------- akses spreadsheet */
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function findSheetCI_(ss, name) {
  var l = String(name).toLowerCase(), all = ss.getSheets();
  for (var i = 0; i < all.length; i++) if (all[i].getName().toLowerCase() === l) return all[i];
  return null;
}
function colMap_(sh) { // {header: kolom(1-based)}
  var lc = sh.getLastColumn(), m = {};
  if (lc < 1) return m;
  sh.getRange(1, 1, 1, lc).getValues()[0].forEach(function (h, i) { h = String(h).trim(); if (h && !m[h]) m[h] = i + 1; });
  return m;
}
function isStd_(sh) { return !!colMap_(sh)['ID Pengajuan']; }
function docProps_() { return PropertiesService.getDocumentProperties(); }
function stdNames_(ss, rescan) {
  var raw = docProps_().getProperty('STD_SHEETS'), list = null;
  if (raw && !rescan) { try { list = JSON.parse(raw); } catch (e) { list = null; } }
  if (list) { list = list.filter(function (n) { return !!ss.getSheetByName(n); }); if (list.length) return list; }
  list = ss.getSheets().filter(function (s) { return s.getName().charAt(0) !== '_' && isStd_(s); }).map(function (s) { return s.getName(); });
  if (!list.length && ss.getSheetByName(MAIN_SHEET)) list = [MAIN_SHEET];
  docProps_().setProperty('STD_SHEETS', JSON.stringify(list));
  return list;
}
function addStd_(ss, name) { var l = stdNames_(ss); if (l.indexOf(name) < 0) { l.push(name); docProps_().setProperty('STD_SHEETS', JSON.stringify(l)); } }

/** Siapkan satu sheet baku: kolom tambahan, format teks, mode tanggal. Idempoten; ditandai per versi. */
function ensureReady_(sh) {
  var flag = 'READY_' + sh.getName() + '_v1';
  if (docProps_().getProperty(flag) === '1' && colMap_(sh)['ID Pengajuan']) return;
  var cm = colMap_(sh), lastHeader = 0;
  Object.keys(cm).forEach(function (h) { if (cm[h] > lastHeader) lastHeader = cm[h]; });
  var headerFmtSrc = sh.getRange(1, Math.max(1, lastHeader), 1, 1);
  ALL_COLS.forEach(function (h) {
    if (cm[h]) return;
    lastHeader++; var c = sh.getRange(1, lastHeader); c.setValue(h); headerFmtSrc.copyTo(c, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); cm[h] = lastHeader;
  });
  var maxRows = Math.max(2, sh.getMaxRows());
  TEXT_COLS.forEach(function (h) { sh.getRange(2, cm[h], maxRows - 1, 1).setNumberFormat('@'); });
  var mode = 'DATE', first = sh.getLastRow() >= 2 ? sh.getRange(2, cm['Tanggal Input']).getValue() : null;
  if (first !== null && first !== '' && !(first instanceof Date)) mode = 'TEXT';
  if (mode === 'DATE') DATE_COLS.forEach(function (h) { sh.getRange(2, cm[h], maxRows - 1, 1).setNumberFormat('dd/MM/yyyy'); });
  docProps_().setProperty('DATEMODE_' + sh.getName(), mode);
  docProps_().setProperty(flag, '1');
}
function dateMode_(sh) { return docProps_().getProperty('DATEMODE_' + sh.getName()) || 'TEXT'; }

function createStdSheet_(ss, name) {
  var sh = ss.insertSheet(name), main = ss.getSheetByName(MAIN_SHEET);
  sh.getRange(1, 1, 1, ALL_COLS.length).setValues([ALL_COLS]);
  if (main) { try { main.getRange(1, 1, 1, LEGACY_COLS.length).copyTo(sh.getRange(1, 1, 1, LEGACY_COLS.length), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); } catch (e) { /* format opsional */ } }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, ALL_COLS.length).setFontWeight('bold');
  addStd_(ss, name);
  ensureReady_(sh);
  return sh;
}
function resolveSheet_(ss, hint) {
  var name = String(hint || MAIN_SHEET).trim() || MAIN_SHEET;
  var sh = findSheetCI_(ss, name);
  if (name.toLowerCase() === MAIN_SHEET.toLowerCase()) { if (!sh) throw AppError('NO_SHEET', 'Sheet "' + MAIN_SHEET + '" tidak ditemukan'); ensureReady_(sh); addStd_(ss, sh.getName()); return sh; }
  if (sh && isStd_(sh)) { ensureReady_(sh); addStd_(ss, sh.getName()); return sh; }
  if (sh) { // nama sudah dipakai sheet lain (format bebas): jangan disentuh; pakai sheet "<nama> (DB)"
    var alt = name.slice(0, 95).trim() + ' (DB)', sh2 = findSheetCI_(ss, alt);
    if (sh2 && isStd_(sh2)) { ensureReady_(sh2); addStd_(ss, sh2.getName()); return sh2; }
    if (sh2) throw AppError('SHEET_CONFLICT', 'Sheet "' + alt + '" sudah ada tetapi bukan sheet baku');
    return createStdSheet_(ss, alt);
  }
  return createStdSheet_(ss, name);
}

function ensureSystemSheets_(ss) {
  var u = ss.getSheetByName(USERS_SHEET);
  if (!u) { u = ss.insertSheet(USERS_SHEET); u.getRange(1, 1, 1, 4).setValues([['Email atau pola (@domain.go.id atau *)', 'Peran (admin / pengelola / perekam / pembaca / nonaktif)', 'Nama', 'Catatan']]).setFontWeight('bold'); u.setFrozenRows(1); u.setColumnWidth(1, 280); u.setColumnWidth(2, 260); }
  var d = ss.getSheetByName(DATA_SHEET);
  if (!d) { d = ss.insertSheet(DATA_SHEET); d.getRange(1, 1, 1, 2).setValues([['Path', 'JSON']]).setFontWeight('bold'); d.setFrozenRows(1); d.hideSheet(); }
  var a = ss.getSheetByName(AUDIT_SHEET);
  if (!a) { a = ss.insertSheet(AUDIT_SHEET); a.getRange(1, 1, 1, 9).setValues([['Waktu', 'Pengguna', 'Peran', 'Aksi', 'Jenis objek', 'ID objek', 'Alasan', 'Rincian (JSON)', 'Kunci']]).setFontWeight('bold'); a.setFrozenRows(1); [1, 6, 9].forEach(function (c) { a.getRange(2, c, Math.max(1, a.getMaxRows() - 1), 1).setNumberFormat('@'); }); }
}

/* ----------------------------------------------------------------------- snapshot */
function snapshot_(req, user, role) {
  var ss = ss_(); ensureSystemSheets_(ss);
  var names = stdNames_(ss, !!req.rescan), sheets = [];
  names.forEach(function (n) {
    var sh = ss.getSheetByName(n); if (!sh) return;
    ensureReady_(sh); sheets.push(readStd_(sh));
  });
  return { ok: true, role: role, email: user.email, name: user.name, version: VERSION, sheets: sheets, kv: kvDocs_(KV_CACHED), serverTime: new Date().toISOString() };
}
/** Baca satu sheet baku. Baris yang belum punya ID (mis. diketik manual) diberi ID di sini. */
function readStd_(sh) {
  var lr = sh.getLastRow(), lc = sh.getLastColumn(), cm = colMap_(sh);
  var headers = ALL_COLS.filter(function (h) { return !!cm[h]; }), out = { name: sh.getName(), headers: headers, rows: [] };
  if (lr < 2) return out;
  var vals = sh.getRange(1, 1, lr, lc).getDisplayValues();
  var idc = cm['ID Pengajuan'] - 1, need = [];
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][idc]).trim() !== '') continue;
    var any = false; LEGACY_COLS.forEach(function (h) { if (h !== 'No' && cm[h] && String(vals[r][cm[h] - 1]).trim() !== '') any = true; });
    if (any) need.push(r);
  }
  if (need.length) {
    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      var cur = sh.getRange(2, cm['ID Pengajuan'], lr - 1, 1).getValues(), changed = 0;
      need.forEach(function (r2) { if (String(cur[r2 - 1][0]).trim() === '') { cur[r2 - 1][0] = newId_(); vals[r2][idc] = cur[r2 - 1][0]; changed++; } else vals[r2][idc] = String(cur[r2 - 1][0]); });
      if (changed) sh.getRange(2, cm['ID Pengajuan'], lr - 1, 1).setValues(cur);
    } finally { lock.releaseLock(); }
  }
  var idx = headers.map(function (h) { return cm[h] - 1; }), moved = cm['Dipindahkan Ke'] ? cm['Dipindahkan Ke'] - 1 : -1;
  for (var r3 = 1; r3 < vals.length; r3++) {
    var row = vals[r3];
    if (moved > -1 && String(row[moved]).trim() !== '') continue; // sudah dipindahkan ke sheet lain
    var any2 = false, line = [r3 + 1];
    for (var k = 0; k < idx.length; k++) { var v = row[idx[k]]; if (headers[k] !== 'No' && String(v).trim() !== '') any2 = true; line.push(v); }
    if (any2) out.rows.push(line);
  }
  return out;
}
function newId_() { return 'P' + Utilities.getUuid().replace(/-/g, '').slice(0, 14); }

/* -------------------------------------------------------------------------- tulis */
function write_(req, user, role) {
  var rows = req.rows || [], kv = req.kv || [];
  if (rows.length) need_(role, EDIT_ROLES);
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var ss = ss_(); ensureSystemSheets_(ss);
    var ctx = { ss: ss, tz: ss.getSpreadsheetTimeZone(), user: user, role: role, ids: null, pending: {}, now: new Date() }, results = [];
    var seen = {};
    rows.forEach(function (rw) { if (seen[rw.id]) throw AppError('BAD_REQUEST', 'ID ganda dalam satu permintaan: ' + rw.id); seen[rw.id] = 1; });
    rows.forEach(function (rw) { results.push(writeRow_(ctx, rw)); });
    flushPending_(ctx, results);
    var auditRows = [];
    results.forEach(function (r) { auditRows.push([isoNow_(ctx), user.email, role, 'baris_ditulis', 'pengajuan', r.id, '', JSON.stringify({ sheet: r.sheet, baris: r.row, versi: r.version }), 'srv' + r.id + '_' + r.version]); });
    var kvStore = kvLoad_();
    kv.forEach(function (op) { applyKvOp_(ctx, kvStore, auditRows, op); });
    kvFlush_(kvStore); appendAudit_(auditRows);
    return { ok: true, rows: results, kvOps: kv.length };
  } finally { lock.releaseLock(); }
}
function isoNow_(ctx) { return Utilities.formatDate(ctx.now, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'"); }
function stamp_(ctx) { return Utilities.formatDate(ctx.now, ctx.tz, 'yyyy-MM-dd HH:mm:ss'); }

function idIndex_(ctx) {
  if (ctx.ids) return ctx.ids;
  var map = {};
  stdNames_(ctx.ss).forEach(function (n) {
    var sh = ctx.ss.getSheetByName(n); if (!sh) return;
    var cm = colMap_(sh), lr = sh.getLastRow(); if (lr < 2 || !cm['ID Pengajuan']) return;
    var ids = sh.getRange(2, cm['ID Pengajuan'], lr - 1, 1).getValues(), mv = cm['Dipindahkan Ke'] ? sh.getRange(2, cm['Dipindahkan Ke'], lr - 1, 1).getValues() : null;
    for (var i = 0; i < ids.length; i++) { var id = String(ids[i][0]).trim(); if (!id) continue; if (mv && String(mv[i][0]).trim() !== '') continue; map[id] = { sheet: n, row: i + 2 }; }
  });
  ctx.ids = map; return map;
}
function typed_(sh, h, v) { // nilai sel sesuai kolom
  if (DATE_COLS.indexOf(h) > -1) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v));
    if (m && dateMode_(sh) === 'DATE') return new Date(+m[3], +m[2] - 1, +m[1], 12, 0, 0);
    return String(v);
  }
  return v === null || v === undefined ? '' : String(v);
}
function writeRow_(ctx, rw) {
  var tgt = resolveSheet_(ctx.ss, rw.sheet), idx = idIndex_(ctx), hit = idx[rw.id], tcm = colMap_(tgt), prev = rw.prevVersion;
  if (!rw.id) throw AppError('BAD_REQUEST', 'ID pengajuan kosong');
  var cells = rw.cells || {};
  Object.keys(cells).forEach(function (h) { if (ALL_COLS.indexOf(h) < 0) throw AppError('BAD_REQUEST', 'Kolom tidak dikenal: ' + h); if (String(cells[h]).length > CELL_LIMIT) throw AppError('TOO_LARGE', 'Isi kolom "' + h + '" melebihi batas sel Google Sheets'); });
  if (hit) {
    var src = ctx.ss.getSheetByName(hit.sheet), scm = colMap_(src);
    var curVer = Number(src.getRange(hit.row, scm['Versi']).getValue()) || 1;
    if (prev !== null && prev !== undefined && Number(prev) !== curVer) throw AppError('CONFLICT', 'Pengajuan ' + rw.id + ' telah diubah pengguna lain (versi ' + curVer + ', Anda memuat versi ' + prev + '). Muat ulang.');
    if (src.getName() === tgt.getName()) return updateInPlace_(ctx, src, scm, hit.row, rw, curVer);
    // pindah sheet (mis. jalur berubah): tandai baris lama, tambahkan baris baru pada sheet tujuan
    src.getRange(hit.row, scm['Dipindahkan Ke']).setValue(tgt.getName());
    src.getRange(hit.row, scm['Diperbarui Oleh']).setValue(ctx.user.email); src.getRange(hit.row, scm['Diperbarui Pada']).setValue(stamp_(ctx));
    delete idx[rw.id];
    return queueAppend_(ctx, tgt, tcm, rw, curVer + 1, src.getName());
  }
  if (prev !== null && prev !== undefined && rw.isNew === false) throw AppError('NOTFOUND', 'Pengajuan ' + rw.id + ' tidak ditemukan pada sheet');
  return queueAppend_(ctx, tgt, tcm, rw, 1, null);
}
function updateInPlace_(ctx, sh, cm, row, rw, curVer) {
  var lc = sh.getLastColumn(), rng = sh.getRange(row, 1, 1, lc), vals = rng.getValues()[0], fm = rng.getFormulas()[0];
  Object.keys(rw.cells).forEach(function (h) {
    if (h === 'No') return; var c = cm[h]; if (!c) return;
    if (DERIVED_COLS.indexOf(h) > -1 && fm[c - 1]) return; // rumus dipertahankan
    vals[c - 1] = typed_(sh, h, rw.cells[h]);
  });
  vals[cm['Diperbarui Oleh'] - 1] = ctx.user.email; vals[cm['Diperbarui Pada'] - 1] = stamp_(ctx); vals[cm['Versi'] - 1] = String(curVer + 1);
  var out = vals.map(function (v, i) { return fm[i] ? fm[i] : v; });
  rng.setValues([out]);
  return { id: rw.id, sheet: sh.getName(), row: row, version: curVer + 1, updatedAt: stamp_(ctx), updatedBy: ctx.user.email, created: false };
}
function queueAppend_(ctx, sh, cm, rw, version, movedFrom) {
  var name = sh.getName(), q = ctx.pending[name] || (ctx.pending[name] = { sh: sh, cm: cm, items: [], nextNo: null });
  q.items.push({ rw: rw, version: version, movedFrom: movedFrom });
  var rowNo = sh.getLastRow() + q.items.length;
  ctx.ids[rw.id] = { sheet: name, row: rowNo };
  return { id: rw.id, sheet: name, row: rowNo, version: version, updatedAt: stamp_(ctx), updatedBy: ctx.user.email, created: true, movedFrom: movedFrom };
}
function flushPending_(ctx, results) {
  Object.keys(ctx.pending).forEach(function (name) {
    var q = ctx.pending[name], sh = q.sh, cm = q.cm, lc = sh.getLastColumn(), lr = sh.getLastRow(), n = q.items.length, start = lr + 1;
    if (start + n - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), start + n - 1 - sh.getMaxRows());
    var nextNo = 0;
    if (cm['No'] && lr >= 2) sh.getRange(2, cm['No'], lr - 1, 1).getValues().forEach(function (r) { var x = parseInt(r[0], 10); if (x > nextNo) nextNo = x; });
    var fmtSrcRow = lr >= 2 ? lr : 0, derivedSrc = {};
    if (lr >= 2) { var f = sh.getRange(lr, 1, 1, lc).getFormulas()[0]; DERIVED_COLS.forEach(function (h) { if (cm[h] && f[cm[h] - 1]) derivedSrc[h] = true; }); }
    if (fmtSrcRow) { try { sh.getRange(fmtSrcRow, 1, 1, lc).copyTo(sh.getRange(start, 1, n, lc), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); } catch (e) { /* opsional */ } }
    var block = q.items.map(function (it) {
      var row = new Array(lc); for (var i = 0; i < lc; i++) row[i] = '';
      Object.keys(it.rw.cells).forEach(function (h) { var c = cm[h]; if (c && h !== 'No' && !derivedSrc[h]) row[c - 1] = typed_(sh, h, it.rw.cells[h]); });
      if (cm['No']) row[cm['No'] - 1] = ++nextNo;
      row[cm['Diperbarui Oleh'] - 1] = ctx.user.email; row[cm['Diperbarui Pada'] - 1] = stamp_(ctx); row[cm['Versi'] - 1] = String(it.version);
      return row;
    });
    // jangan menimpa sel yang akan berisi rumus: tulis hanya kolom non-rumus
    var rng = sh.getRange(start, 1, n, lc);
    if (Object.keys(derivedSrc).length) {
      var cols = []; for (var c2 = 1; c2 <= lc; c2++) { var isD = false; DERIVED_COLS.forEach(function (h) { if (derivedSrc[h] && cm[h] === c2) isD = true; }); if (!isD) cols.push(c2); }
      cols.forEach(function (c3) { sh.getRange(start, c3, n, 1).setValues(block.map(function (r) { return [r[c3 - 1]]; })); });
      DERIVED_COLS.forEach(function (h) { if (derivedSrc[h]) sh.getRange(lr, cm[h], 1, 1).copyTo(sh.getRange(start, cm[h], n, 1), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false); });
    } else rng.setValues(block);
  });
}

/* ----------------------------------------------------------------- penyimpanan KV (_DATA) */
function kvLoad_() {
  var sh = ss_().getSheetByName(DATA_SHEET), lr = sh.getLastRow(), docs = {};
  if (lr >= 2) sh.getRange(2, 1, lr - 1, 2).getValues().forEach(function (r) { if (r[0]) { try { docs[String(r[0])] = JSON.parse(r[1]); } catch (e) { /* abaikan baris rusak */ } } });
  return { sh: sh, docs: docs, dirty: false };
}
function kvFlush_(kv) {
  if (!kv.dirty) return;
  var keys = Object.keys(kv.docs).sort(), rows = keys.map(function (k) { var j = JSON.stringify(kv.docs[k]); if (j.length > CELL_LIMIT) throw AppError('TOO_LARGE', 'Dokumen ' + k + ' melebihi batas sel'); return [k, j]; });
  var lr = kv.sh.getLastRow();
  if (lr >= 2) kv.sh.getRange(2, 1, lr - 1, 2).clearContent();
  if (rows.length) { kv.sh.getRange(2, 1, rows.length, 1).setNumberFormat('@'); kv.sh.getRange(2, 1, rows.length, 2).setValues(rows); }
}
function kvDocs_(roots) {
  var kv = kvLoad_(), out = [];
  Object.keys(kv.docs).forEach(function (p) { if (roots.indexOf(p.split('/')[0]) > -1) out.push([p, JSON.stringify(kv.docs[p])]); });
  return out;
}
function setIn_(obj, segs, val) {
  if (segs.length === 1) { if (val === null) delete obj[segs[0]]; else obj[segs[0]] = val; return; }
  if (obj[segs[0]] === null || typeof obj[segs[0]] !== 'object') { if (val === null) return; obj[segs[0]] = {}; }
  setIn_(obj[segs[0]], segs.slice(1), val);
  if (typeof obj[segs[0]] === 'object' && !Object.keys(obj[segs[0]]).length) delete obj[segs[0]];
}
function applyKvOp_(ctx, kv, auditRows, op) {
  var segs = String(op.path || '').split('/').filter(Boolean), root = segs[0], val = op.value === undefined ? null : op.value;
  if (!root) throw AppError('BAD_PATH', 'Path kosong');
  if (root === 'audit') { // audit/{jenis}/{id}/{key}: hanya ditambah; identitas pelaku ditetapkan server
    need_(ctx.role, EDIT_ROLES); if (val === null || segs.length < 4) throw AppError('BAD_PATH', 'Audit hanya dapat ditambah');
    var v = JSON.parse(JSON.stringify(val)); v.name = ctx.user.email; v.uid = ctx.user.email; v.role = ctx.role; v.ts = isoNow_(ctx);
    auditRows.push([v.ts, ctx.user.email, ctx.role, String(v.action || ''), segs[1], segs[2], String(v.reason || ''), JSON.stringify(v), segs[3]]); return;
  }
  if (root === 'audit_global') return; // diturunkan dari sheet _AUDIT
  var depth = KV_DEPTH[root]; if (!depth) throw AppError('BAD_PATH', 'Path tidak dikenal: ' + op.path);
  if (KV_DERIVED_ROOTS.indexOf(root) > -1) need_(ctx.role, val === null ? EDIT_ROLES : MGR_ROLES);
  else if (root === 'export') need_(ctx.role, MGR_ROLES);
  else if (root === 'config') need_(ctx.role, ['admin']);
  else need_(ctx.role, EDIT_ROLES);
  if (segs.length >= depth) {
    var docPath = segs.slice(0, depth).join('/'), sub = segs.slice(depth), doc = kv.docs[docPath];
    if (!sub.length) { if (val === null) delete kv.docs[docPath]; else kv.docs[docPath] = val; }
    else { if (doc === null || typeof doc !== 'object') doc = {}; setIn_(doc, sub, val); if (!Object.keys(doc).length) delete kv.docs[docPath]; else kv.docs[docPath] = doc; }
    kv.dirty = true;
  } else {
    if (val !== null) throw AppError('BAD_PATH', 'Menulis nilai pada path pendek tidak didukung: ' + op.path);
    var pre = segs.join('/') + '/'; Object.keys(kv.docs).forEach(function (k) { if (k.indexOf(pre) === 0) { delete kv.docs[k]; kv.dirty = true; } });
  }
}
function appendAudit_(rows) {
  if (!rows.length) return;
  var sh = ss_().getSheetByName(AUDIT_SHEET), lr = sh.getLastRow();
  sh.getRange(lr + 1, 1, rows.length, 9).setValues(rows);
}

/* --------------------------------------------------------------------------- baca terakhir */
function last_(req, role) {
  ensureSystemSheets_(ss_());
  var path = String(req.path || ''), n = Math.min(Number(req.n) || 50, 500), segs = path.split('/').filter(Boolean), items = [];
  if (segs[0] === 'audit_global' || segs[0] === 'audit') {
    var sh = ss_().getSheetByName(AUDIT_SHEET), lr = sh.getLastRow();
    if (lr >= 2) {
      var vals = sh.getRange(2, 1, lr - 1, 9).getValues();
      for (var i = vals.length - 1; i >= 0 && items.length < n; i--) {
        var r = vals[i];
        if (segs[0] === 'audit' && (String(r[4]) !== segs[1] || String(r[5]) !== segs[2])) continue;
        var o = {}; try { o = JSON.parse(r[7]); } catch (e) { o = {}; }
        o.refType = r[4]; o.refId = r[5]; if (!o.ts) o.ts = r[0]; if (!o.action) o.action = r[3]; if (!o.name) o.name = r[1];
        items.push([String(r[8]), o]);
      }
      items.reverse();
    }
    return { ok: true, items: items };
  }
  var root = segs[0]; if (!KV_DEPTH[root]) throw AppError('BAD_PATH', 'Path tidak dikenal: ' + path);
  var kv = kvLoad_(), pre = segs.join('/') + '/', keys = Object.keys(kv.docs).filter(function (k) { return k.indexOf(pre) === 0; }).sort();
  keys.slice(-n).forEach(function (k) { items.push([k.slice(pre.length).split('/')[0], kv.docs[k]]); });
  return { ok: true, items: items };
}

/* ----------------------------------------------------------------------------- pengguna */
function usersRows_() {
  var sh = ss_().getSheetByName(USERS_SHEET); if (!sh) return [];
  var lr = sh.getLastRow(); if (lr < 2) return [];
  return sh.getRange(2, 1, lr - 1, 4).getValues().filter(function (r) { return String(r[0]).trim() !== ''; }).map(function (r) { return { email: String(r[0]).trim(), role: String(r[1]).trim().toLowerCase(), name: String(r[2]), note: String(r[3]) }; });
}
function listUsers_() {
  var admins = (props_().getProperty('ADMIN_EMAILS') || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  return admins.map(function (e) { return { email: e, role: 'admin', name: '', note: 'Ditetapkan pada properti skrip (ADMIN_EMAILS); ubah lewat menu IKPA di spreadsheet', fixed: true }; }).concat(usersRows_());
}
function setUser_(req, user) {
  var email = String(req.email || '').trim().toLowerCase(), role = String(req.role || '').trim().toLowerCase();
  if (!/^(\*|@[^\s@]+\.[^\s@]+|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(email)) throw AppError('BAD_REQUEST', 'Email / pola tidak valid: ' + email);
  if (role !== 'hapus' && USER_ROLES.indexOf(role) < 0) throw AppError('BAD_REQUEST', 'Peran tidak valid: ' + role);
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var ss = ss_(); ensureSystemSheets_(ss); var sh = ss.getSheetByName(USERS_SHEET), lr = sh.getLastRow(), at = 0;
    if (lr >= 2) sh.getRange(2, 1, lr - 1, 1).getValues().forEach(function (r, i) { if (String(r[0]).trim().toLowerCase() === email) at = i + 2; });
    if (role === 'hapus') { if (at) sh.deleteRow(at); }
    else if (at) sh.getRange(at, 1, 1, 4).setValues([[email, role, req.name || '', req.note || '']]);
    else sh.getRange(lr + 1, 1, 1, 4).setValues([[email, role, req.name || '', req.note || '']]);
    appendAudit_([[new Date().toISOString(), user.email, 'admin', 'ubah_peran', 'user', email, String(req.reason || ''), JSON.stringify({ email: email, role: role }), 'usr' + Date.now().toString(36)]]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ---------------------------------------------------------------------- menu di spreadsheet */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('IKPA')
      .addItem('Siapkan database (sekali)', 'menuSetup')
      .addItem('Tetapkan admin…', 'menuSetAdmin')
      .addItem('Pindai ulang sheet baku', 'menuRescan')
      .addItem('Tampilkan alamat web app', 'menuInfo')
      .addToUi();
  } catch (e) { /* konteks tanpa UI */ }
}
function menuSetup() {
  var ss = ss_(); ensureSystemSheets_(ss);
  var names = stdNames_(ss, true), done = [];
  names.forEach(function (n) { var sh = ss.getSheetByName(n); ensureReady_(sh); fillIds_(sh); done.push(n); });
  SpreadsheetApp.getUi().alert('Siap.\n\nSheet baku: ' + done.join(', ') + '\nSheet sistem: ' + [USERS_SHEET, DATA_SHEET, AUDIT_SHEET].join(', ') + '\n\nLangkah berikut: Tetapkan admin (menu IKPA), lalu Deploy > New deployment > Web app.');
}
function menuSetAdmin() {
  var ui = SpreadsheetApp.getUi(), r = ui.prompt('Tetapkan admin', 'Masukkan email admin (pisahkan dengan koma bila lebih dari satu). Nilai ini menggantikan daftar admin sebelumnya:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var list = r.getResponseText().toLowerCase().split(/[\s,;]+/).filter(Boolean);
  if (!list.length || list.some(function (e) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); })) { ui.alert('Email tidak valid.'); return; }
  props_().setProperty('ADMIN_EMAILS', list.join(','));
  ui.alert('Admin: ' + list.join(', '));
}
function menuRescan() { var names = stdNames_(ss_(), true); SpreadsheetApp.getUi().alert('Sheet baku: ' + names.join(', ')); }
function menuInfo() {
  var url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(url ? 'Alamat web app (isi ke WEBAPP_URL pada ikpa-adj/config.js):\n\n' + url : 'Web app belum di-deploy. Pilih Deploy > New deployment > Web app (Execute as: Me; Who has access: Anyone).');
}
