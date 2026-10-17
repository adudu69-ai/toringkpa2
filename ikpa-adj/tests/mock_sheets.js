'use strict';
/* Tiruan minimal Google Apps Script + SpreadsheetApp agar apps-script/Code.gs dapat DIJALANKAN APA ADANYA di Node.
 * Ini bukan Google Sheets: perilaku yang ditiru dibatasi pada apa yang dipakai Code.gs (lihat catatan di tiap bagian).
 * Pengujian di sini membuktikan logika Code.gs; TIDAK membuktikan perilaku Google (kuota, latensi, penguraian sel oleh Sheets).
 * Ditiru dengan sengaja karena mudah salah: string angka -> angka pada sel non-teks, string dd/MM/yyyy & yyyy-MM-dd -> tanggal. */
const vm = require('vm'), fs = require('fs'), path = require('path'), crypto = require('crypto');

function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m) / 26); } return s; }
function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDate(d, tz, f) {
  const off = tz === 'Asia/Jakarta' ? 7 : 0, t = new Date(d.getTime() + off * 3600000);
  const map = { yyyy: t.getUTCFullYear(), MM: pad2(t.getUTCMonth() + 1), dd: pad2(t.getUTCDate()), HH: pad2(t.getUTCHours()), mm: pad2(t.getUTCMinutes()), ss: pad2(t.getUTCSeconds()) };
  return f.replace(/'T'/g, 'T').replace(/'Z'/g, 'Z').replace(/yyyy|MM|dd|HH|mm|ss/g, k => map[k]);
}
function shiftFormula(f, dRow) { return f.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g, (m, c, d, r) => d ? m : c + (+r + dRow)); }

class Cell { constructor() { this.v = ''; this.f = null; this.fmt = null; } }
class Sheet {
  constructor(book, name) { this.book = book; this.name = name; this.rows = []; this.maxRows = 1000; this.hidden = false; this.frozen = 0; }
  cell(r, c) { const row = this.rows[r - 1] || (this.rows[r - 1] = []); return row[c - 1] || (row[c - 1] = new Cell()); }
  peek(r, c) { const row = this.rows[r - 1]; return row && row[c - 1] ? row[c - 1] : null; }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getLastRow() { let last = 0; this.rows.forEach((row, i) => { if (row && row.some(c => c && (c.v !== '' || c.f))) last = i + 1; }); return last; }
  getLastColumn() { let last = 0; this.rows.forEach(row => { if (row) row.forEach((c, j) => { if (c && (c.v !== '' || c.f)) last = Math.max(last, j + 1); }); }); return last; }
  insertRowsAfter(after, n) { this.maxRows += n; return this; }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  setFrozenRows(n) { this.frozen = n; } hideSheet() { this.hidden = true; } setColumnWidth() { } createFilter() { }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); if (r < 1 || c < 1) throw new Error('Range di luar batas'); if (r + nr - 1 > sh.maxRows && nr > 0) throw new Error('Baris melebihi batas sheet (' + (r + nr - 1) + ' > ' + sh.maxRows + ')'); }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.sh.cell(this.r + i, this.c + j), i, j); }
  grid(fn) { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(fn(this.sh.peek(this.r + i, this.c + j))); out.push(row); } return out; }
  getValues() { return this.grid(c => c ? (c.f ? (c.v === undefined ? '' : c.v) : c.v) : ''); }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValues() {
    return this.grid(c => {
      if (!c) return ''; const v = c.v;
      if (v instanceof Date) return /yyyy/.test(c.fmt || '') ? fmtDate(v, 'Asia/Jakarta', c.fmt.replace(/dd\/MM/, 'dd/MM')) : fmtDate(v, 'Asia/Jakarta', 'dd/MM/yyyy');
      if (typeof v === 'number') { if (c.fmt && /^0+$/.test(c.fmt)) return String(v).padStart(c.fmt.length, '0'); return String(v); }
      return v === null || v === undefined ? '' : String(v);
    });
  }
  getFormulas() { return this.grid(c => c && c.f ? c.f : ''); }
  setValues(arr) {
    if (arr.length !== this.nr || arr.some(r => r.length !== this.nc)) throw new Error('Dimensi setValues tidak cocok: range ' + this.nr + 'x' + this.nc + ', data ' + arr.length + 'x' + (arr[0] || []).length);
    this.each((cell, i, j) => assign(cell, arr[i][j])); return this;
  }
  setValue(v) { this.each(cell => assign(cell, v)); return this; }
  clearContent() { this.each(cell => { cell.v = ''; cell.f = null; }); return this; }
  setNumberFormat(f) { this.each(cell => { cell.fmt = f; }); return this; }
  setFontWeight() { return this; } setFontColor() { return this; } setBackground() { return this; }
  copyTo(dest, type) {
    const src = this;
    for (let i = 0; i < dest.nr; i++) for (let j = 0; j < dest.nc; j++) {
      const s = src.sh.cell(src.r + (i % src.nr), src.c + (j % src.nc)), d = dest.sh.cell(dest.r + i, dest.c + j);
      if (type === 'F') d.fmt = s.fmt;
      else if (type === 'FM') { if (s.f) { d.f = shiftFormula(s.f, (dest.r + i) - (src.r + (i % src.nr))); d.v = ''; } }
      else { d.v = s.v; d.f = s.f; d.fmt = s.fmt; }
    }
    return this;
  }
}
function assign(cell, val) {
  if (typeof val === 'string') {
    if (val.startsWith('=')) { cell.f = val; cell.v = ''; return; }
    cell.f = null;
    if (cell.fmt !== '@') {                         // meniru penguraian otomatis Google Sheets
      if (/^-?\d+(\.\d+)?$/.test(val)) { cell.v = Number(val); return; }
      let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(val); if (m) { cell.v = new Date(+m[3], +m[2] - 1, +m[1], 12); return; }
      m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})Z?)?$/.exec(val); if (m) { cell.v = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0), +(m[6] || 0))); return; }
    }
    cell.v = val; return;
  }
  cell.f = null; cell.v = val === null || val === undefined ? '' : val;
}

function createEnv(opts) {
  opts = opts || {};
  const book = { sheets: [], tz: 'Asia/Jakarta' };
  const props = { script: {}, doc: {} }, cacheStore = {}, fetchLog = [];
  const tokens = Object.assign({}, opts.tokens || {});
  const ss = {
    getSheets: () => book.sheets.slice(), getSheetByName: n => book.sheets.find(s => s.name === n) || null, getSpreadsheetTimeZone: () => book.tz,
    insertSheet(name) { if (book.sheets.some(s => s.name.toLowerCase() === name.toLowerCase())) throw new Error('Nama sheet sudah dipakai: ' + name); const s = new Sheet(book, name); book.sheets.push(s); return s; }
  };
  const propSvc = which => ({ getProperty: k => (k in props[which] ? props[which][k] : null), setProperty: (k, v) => { props[which][k] = String(v); }, deleteProperty: k => { delete props[which][k]; } });
  let locks = 0;
  const sandbox = {
    console, JSON, Date, Math, Object, Array, String, Number, RegExp, Error, parseInt, parseFloat, isNaN,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, CopyPasteType: { PASTE_FORMAT: 'F', PASTE_FORMULA: 'FM', PASTE_NORMAL: 'N' }, getUi: () => ({ alert() { }, prompt() { return { getSelectedButton: () => 'OK', getResponseText: () => '' }; }, createMenu() { const m = { addItem() { return m; }, addToUi() { } }; return m; }, Button: { OK: 'OK' }, ButtonSet: { OK_CANCEL: 'OKC' } }) },
    PropertiesService: { getScriptProperties: () => propSvc('script'), getDocumentProperties: () => propSvc('doc') },
    CacheService: { getScriptCache: () => ({ get: k => cacheStore[k] || null, put: (k, v) => { cacheStore[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() { locks++; if (locks > 1) throw new Error('Kunci ganda'); }, releaseLock() { locks--; } }) },
    UrlFetchApp: {
      fetch(url, o) {
        const body = JSON.parse(o.payload || '{}'); fetchLog.push({ url, token: body.idToken });
        const u = tokens[body.idToken];
        if (!u) return { getResponseCode: () => 400, getContentText: () => JSON.stringify({ error: { message: 'INVALID_ID_TOKEN' } }) };
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ users: [Object.assign({ emailVerified: true }, u)] }) };
      }
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s).digest()).map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(), formatDate: fmtDate
    },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: s => ({ content: s, setMimeType() { return this; }, getContent() { return this.content; } }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }) }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script', 'Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });
  const env = {
    sandbox, ss, book, props, fetchLog, tokens,
    addToken(token, email, name) { tokens[token] = { email, displayName: name || '' }; return token; },
    call(req) { return sandbox.handle(req); },
    post(req) { return JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(req) } }).getContent()); },
    setAdmins(list) { props.script.ADMIN_EMAILS = list; },
    sheet: n => ss.getSheetByName(n),
    /** Isi sheet apa adanya (meniru data yang sudah ada). rows: array of arrays; nilai ditempatkan tanpa penguraian. */
    seed(name, aoa, o) { o = o || {}; let sh = ss.getSheetByName(name) || ss.insertSheet(name); aoa.forEach((r, i) => r.forEach((v, j) => { const c = sh.cell(i + 1, j + 1); c.v = v === undefined || v === null ? '' : v; if (o.textCols && o.textCols.indexOf(j + 1) > -1) c.fmt = '@'; })); return sh; },
    table(name) { const sh = ss.getSheetByName(name); const lr = sh.getLastRow(), lc = sh.getLastColumn(); return sh.getRange(1, 1, lr, lc).getDisplayValues(); }
  };
  return env;
}
module.exports = { createEnv, colName };
