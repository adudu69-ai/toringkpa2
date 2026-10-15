// Membuat berkas ekspor contoh dari baris file Master Exception RIIL (render ulang), dengan atau tanpa nilai cache rumus.
// Pemakaian: node make_sample_export.js <ME.xlsx> <out.xlsx> [--nocache]
const X = require('xlsx'), fs = require('fs'), C = require('../core.js');
const [src, out, flag] = process.argv.slice(2);
const pm = C.parseMasterExceptionSheets(C.readWorkbookAoa(X, fs.readFileSync(src), 'buffer').sheets);
const by = {}; pm.rows.forEach(x => (by[x.jenis] = by[x.jenis] || []).push(x.row));
const o = C.buildExportSheets(by, { sql: true });
if (flag === '--nocache') o.sheets.forEach(sh => sh.cells.forEach(l => l.forEach(c => { if (c.f) delete c.v; })));
X.writeFile(C.buildWorkbook(X, o), out);
console.log('ditulis', out, o.sheets.map(s => s.name + ':' + s.count).join(', '));
