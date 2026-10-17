'use strict';
/* Server uji lokal: menjalankan apps-script/Code.gs di atas tiruan SpreadsheetApp dan melayaninya lewat HTTP,
 * agar UI dapat diuji end-to-end tanpa Google. BUKAN Google; hanya untuk tes. Port: argv[2] (default 8799). */
const http = require('http');
const { createEnv } = require('./mock_sheets.js');
const C = require('../core.js');
const env = createEnv(); env.setAdmins('boss@x.id');
[['tk-admin', 'boss@x.id', 'Boss'], ['tk-rek', 'rekan@x.id', 'Rekan'], ['tk-pemb', 'baca@x.id', 'Pembaca'], ['tk-asing', 'asing@x.id', 'Asing']].forEach(a => env.addToken(a[0], a[1], a[2]));
env.post({ action: 'users.set', token: 'tk-admin', email: 'rekan@x.id', role: 'perekam' });
env.post({ action: 'users.set', token: 'tk-admin', email: 'baca@x.id', role: 'pembaca' });
env.seed('Sheet1', [C.SHEET_LEGACY_COLS.concat(['', '', '']),
  [1, '03/03/2026', 'Kanwil DJPb Provinsi DKI Jakarta', 'ND-10/WPB.12/2026', '26/02/2026', 'Penyerapan Anggaran', '648521', '175', 'DIPA Awal', 'Disetujui', 'Selesai', '', '', '', 'Kronologi A', '', '015', 'KEMENTERIAN KEUANGAN', '648521'],
  [2, '16/03/2026', 'Kanwil DJPb Provinsi Maluku', 'ND-233/WPB.32/2026', '06/03/2026', 'Deviasi Halaman III DIPA', '099710', '173', 'DIPA Revisi ke-2', 'Disetujui', 'Pooling', '', '', 'Deviasi', 'Kronologi B', '', '015', 'KEMENTERIAN KEUANGAN', '099710']], { textCols: [7, 8] });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (u.pathname === '/__dump') { const n = u.searchParams.get('sheet'); res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)); return res.end(JSON.stringify(env.sheet(n) ? env.table(n) : null)); }
  if (u.pathname === '/__sheets') { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)); return res.end(JSON.stringify(env.ss.getSheets().map(s => s.getName()))); }
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
    res.end(req.method === 'POST' ? env.sandbox.doPost({ postData: { contents: body } }).getContent() : env.sandbox.doGet().getContent());
  });
}).listen(+process.argv[2] || 8799, () => console.log('mock siap'));
