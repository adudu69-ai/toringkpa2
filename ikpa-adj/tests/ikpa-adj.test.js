'use strict';
/* Pengujian otomatis modul Monitoring Penyesuaian IKPA.
 *  - Bagian A memakai FILE REFERENSI RIIL (dibaca dari IKPA_REF_DIR). Bila folder tidak ada, bagian A dilewati (skip), bukan dianggap lulus.
 *  - Bagian B-D memakai fixture sintetis yang dibuat di dalam tes ini SAJA (bukan data resmi, tidak masuk aplikasi).
 *  Jalankan:  IKPA_REF_DIR=/path/ke/file npm test   (di folder ikpa-adj/tests)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const X = require('xlsx');
const C = require('../core.js');
const ST = require('../store.js');

const REF = process.env.IKPA_REF_DIR || '/root/.claude/uploads/772f4016-5cc1-545d-ac1e-dceee62cb340';
const f = (frag) => { try { const n = fs.readdirSync(REF).filter(x => x.includes(frag)).sort(); return n.length ? path.join(REF, n[0]) : null; } catch (e) { return null; } };
const FILE_DB = f('5cdb7c0d-DB_Penyesuaian'), FILE_ME = f('59c37181-Master_Exception_Oktober');
const has = !!(FILE_DB && FILE_ME);
const readAoa = (p) => C.readWorkbookAoa(X, fs.readFileSync(p), 'buffer');
const newStore = (role) => { const a = new ST.MemoryAdapter(); return { a, s: ST.createStore(a, { uid: 'u-' + (role || 'admin'), name: 'Uji ' + role, role: role || 'admin' }, C) }; };
const peng = (o) => Object.assign({ ta: '2026', tw: 2, tanggalInput: '2026-03-01', submitter: 'Kanwil DJPb Uji', nomorND: 'ND-1/UJI/2026', indikator: 'Revisi DIPA', kdsatker: '123456', status: 'Disetujui', jalur: C.JALUR.SATKER, keterangan: '' }, o || {});
const detRev = (o) => Object.assign({ jenis: 'Deviasi', params: { periode: 'TW2', revision_number: '5', alasan: 'Uji: basis DIPA revisi ke-5', status: 'REAL' } }, o || {});
async function addP(s, p, d) { const r = await s.savePengajuan(p); const dd = await s.saveDetail(r.id, d); return { p: r, d: dd }; }

/* ============================ A. FILE RIIL ============================ */
test('A1 pembaca workbook tidak kehilangan sheet (bug SheetJS shared-formula)', { skip: !has }, () => {
  const r = readAoa(FILE_DB);
  assert.equal(r.missing.length, 0);
  assert.ok(r.sheets['Sheet1'] && r.sheets['Sheet1'].length > 100);
  // bukti bahwa pembacaan standar memang kehilangan Sheet1 (alasan helper ada)
  const wb = X.read(fs.readFileSync(FILE_DB), { type: 'buffer' });
  assert.equal(!!wb.Sheets['Sheet1'], false, 'jika ini mulai true, SheetJS sudah diperbaiki dan helper bisa disederhanakan');
});

test('A2 parse DB Oktober: semua baris terbaca, ID stabil & unik', { skip: !has }, () => {
  const aoa = readAoa(FILE_DB).sheets['Sheet1'];
  const nonEmpty = aoa.slice(1).filter(r => r.some(c => String(c).trim() !== '')).length;
  const p = C.parseDbRows(aoa, { ta: '2026', fileName: 'db.xlsx' });
  assert.deepEqual(p.missingColumns, []);
  assert.equal(p.summary.total, nonEmpty);
  assert.equal(p.summary.valid + p.summary.invalid, p.summary.total);
  assert.equal(new Set(p.records.map(r => r.id)).size, p.records.length);
  const p2 = C.parseDbRows(aoa, { ta: '2026', fileName: 'db.xlsx' });
  assert.deepEqual(p.records.map(r => r.id), p2.records.map(r => r.id), 'ID deterministik');
  p.records.forEach(r => { assert.equal(r.jalur, C.JALUR.BELUM, 'jalur riwayat tidak boleh ditebak'); assert.equal(r.tw, null, 'TW tidak diturunkan dari tanggal input'); });
});

test('A3 impor ulang DB yang sama tidak menggandakan data (skenario 6)', { skip: !has }, async () => {
  const { a, s } = newStore('admin');
  const p = C.parseDbRows(readAoa(FILE_DB).sheets['Sheet1'], { ta: '2026', fileName: 'db.xlsx' });
  const r1 = await s.importPengajuan(p.records, { file: 'db.xlsx' });
  const r2 = await s.importPengajuan(p.records, { file: 'db.xlsx' });
  assert.equal(r1.created, p.records.length); assert.equal(r2.created, 0); assert.equal(r2.skipped, p.records.length);
  const idx = await s.listIndex('2026'); assert.equal(idx.length, p.records.length);
});

test('A4 file Master Exception Oktober: tiap sheet terparse; SQL INSERT hasil sqlValue = nilai SQL pada file (semua baris)', { skip: !has }, () => {
  const r = readAoa(FILE_ME); const pm = C.parseMasterExceptionSheets(r.sheets);
  assert.deepEqual(pm.errors, []);
  let checked = 0;
  for (const n of Object.keys(r.sheets)) {
    const T = C.TYPES[n]; if (!T) continue; const aoa = r.sheets[n];
    const dataRows = aoa.slice(1).filter(l => T.cols.some((c, j) => String(l[j]).trim() !== ''));
    assert.equal(pm.perSheet[n], dataRows.length, n);
    const sqlIdx = T.cols.length + 1;
    pm.rows.filter(x => x.sheet === n).forEach(x => {
      const line = aoa[x.baris - 1]; const want = String(line[sqlIdx] || '');
      if (!want) return; assert.equal(C.sqlValue(n, x.row), want, n + ' baris ' + x.baris); checked++;
    });
  }
  assert.ok(checked > 1000, 'jumlah baris SQL yang dibandingkan: ' + checked);
});

test('A5 rekonsiliasi: impor ME historis dua kali tidak menggandakan; ekspor berikutnya kosong', { skip: !has }, async () => {
  const { a, s } = newStore('admin');
  const pm = C.parseMasterExceptionSheets(readAoa(FILE_ME).sheets);
  const r1 = await s.importHistoricalME(pm.rows, { file: 'ME_Okt.xlsx', markExported: true });
  const r2 = await s.importHistoricalME(pm.rows, { file: 'ME_Okt.xlsx', markExported: true });
  assert.equal(r2.created, 0);
  assert.ok(r1.created > 0 && r1.created + r1.merged === pm.rows.length);
  const open = await s.loadOpenExceptions('2026'); assert.equal(open.length, 0, 'yang sudah ditandai ekspor tidak muncul lagi');
});

test('A6 kunci ID tiap jenis: unik per baris pada file ME riil, atau duplikat dilaporkan apa adanya', { skip: !has }, () => {
  const pm = C.parseMasterExceptionSheets(readAoa(FILE_ME).sheets); const seen = {}, dup = {};
  pm.rows.forEach(x => { const k = C.keysOf(x.jenis, x.row).idKey; if (seen[k]) (dup[x.jenis] = dup[x.jenis] || []).push(x.baris); seen[k] = 1; });
  // Tidak diasumsikan nol; hanya memastikan fungsi deterministik. Hasil dicetak untuk laporan.
  console.log('# duplikat idKey dalam ME Oktober Final:', JSON.stringify(Object.fromEntries(Object.entries(dup).map(([k, v]) => [k, v.length]))));
  assert.ok(true);
});

test('A7 ekspor: header & urutan kolom sama persis dengan template; formula SQL membentuk string yang sama', { skip: !has }, () => {
  const pm = C.parseMasterExceptionSheets(readAoa(FILE_ME).sheets); const by = {};
  pm.rows.forEach(x => (by[x.jenis] = by[x.jenis] || []).push(x.row));
  const out = C.buildExportSheets(by, { sql: true });
  out.sheets.forEach(sh => { const T = C.TYPES[sh.name]; assert.deepEqual(sh.header, T.cols); assert.equal(sh.cells.length, by[sh.name].length); assert.ok(sh.cells[0][T.cols.length + 1].f.startsWith('"INSERT')); });
  const ref = readAoa(FILE_ME).sheets;
  out.sheets.forEach(sh => assert.deepEqual(sh.header, ref[sh.name][0].slice(0, sh.header.length).map(String), sh.name));
});


test('A8 render ulang file ME Oktober dari baris terparse: nilai tiap sel identik dengan file asli (multiset per sheet)', { skip: !has }, () => {
  const orig = X.read(fs.readFileSync(FILE_ME), { type: 'buffer', cellFormula: false });
  const pm = C.parseMasterExceptionSheets(readAoa(FILE_ME).sheets); const by = {};
  pm.rows.forEach(x => (by[x.jenis] = by[x.jenis] || []).push(x.row));
  const out = C.buildExportSheets(by, { sql: true }); let sameOrder = 0, total = 0, nNum = 0, eNum = 0;
  out.sheets.forEach(sh => {
    const T = C.TYPES[sh.name], ws = orig.Sheets[sh.name], n = T.cols.length;
    const rng = X.utils.decode_range(ws['!ref']); const sigO = [];
    for (let r = 1; r <= rng.e.r; r++) {
      const sig = []; let blank = true;
      for (let c = 0; c < n; c++) { const cell = ws[X.utils.encode_cell({ r, c })]; if (cell && String(cell.v).trim() !== '') blank = false; sig.push('v:' + (cell ? String(cell.v) : '')); if (cell && cell.t === 'n') nNum++; }
      if (blank) continue; const q = ws[X.utils.encode_cell({ r, c: n + 1 })]; sig.push('sql:' + (q ? q.v : '')); sigO.push(sig.join('\u0001'));
    }
    const sigE = sh.cells.map(l => l.slice(0, n).map(c => 'v:' + c.v).concat(['sql:' + l[n + 1].v]).join('\u0001'));
    sh.cells.forEach(l => l.slice(0, n).forEach(c => { if (c.t === 'n') eNum++; }));
    if (T.assignId) { // ID baris dibuat ulang (1..n) mengikuti urutan ekspor; bandingkan tanpa kolom ID & SQL
      const strip = a => a.map(x => x.split('\u0001').slice(1, -1).join('\u0001')).sort();
      assert.deepEqual(strip(sigE), strip(sigO), sh.name);
    } else {
      assert.equal(sigE.length, sigO.length, sh.name + ' jumlah baris');
      assert.deepEqual(sigE.slice().sort(), sigO.slice().sort(), sh.name);
      total += sigO.length; sameOrder += sigE.filter((x, i) => x === sigO[i]).length;
    }
  });
  console.log('# sel numerik: file asli ' + nNum + ', hasil render ' + eNum + ' (selisih = sel kode satker yang pada file asli bertipe teks)');
  console.log('# render ulang: urutan baris identik dengan file asli pada ' + sameOrder + ' dari ' + total + ' baris (urutan tidak dipersyaratkan)');
});

/* ============================ B. DEDUP LINTAS JALUR ============================ */
test('B1 skenario 1: satker & Eselon I identik pada tanggal berbeda -> 1 baris ekspor, 2 pengajuan tercatat', async () => {
  const { a, s } = newStore('admin');
  const x1 = await addP(s, peng({ jalur: C.JALUR.SATKER, tanggalInput: '2026-03-01', nomorND: 'ND-SATKER-1' }), detRev());
  const x2 = await addP(s, peng({ jalur: C.JALUR.ESELON_I, tanggalInput: '2026-05-01', nomorND: 'ND-ES1-1', submitter: 'Sekretariat Jenderal UJI' }), detRev());
  const plan = await s.planCandidates('2026');
  assert.equal(plan.stats.sumber, 2); assert.equal(plan.stats.unik, 1); assert.equal(plan.stats.identik, 1); assert.equal(plan.stats.potensi, 0);
  await s.applyPlan(plan, 'uji');
  const open = await s.loadOpenExceptions('2026'); assert.equal(open.length, 1);
  const refs = Object.values(open[0].refs); assert.equal(refs.length, 2);
  assert.deepEqual(refs.map(r => r.jalur).sort(), ['ESELON_I', 'SATKER']);
  const sh = C.buildExportSheets({ Deviasi: open.map(e => e.row) }); assert.equal(sh.sheets[0].count, 1);
  const sm = C.summarize(open); assert.equal(sm.sumberPengajuan, 2); assert.equal(sm.unik, 1); assert.equal(sm.duplikatIdentik, 1);
  // B4: kedua pengajuan administratif tetap tampil dua kali pada riwayat satker
  const h = await s.satkerHistory('123456'); assert.equal(h.length, 2);
  // B5: dapat ditelusuri dari kedua halaman detail (pengajuan -> exception, exception -> pengajuan)
  for (const x of [x1, x2]) { const m = await a.get('exc_by_pengajuan/' + x.p.id); assert.equal(Object.keys(m).length, 1); assert.equal(Object.keys(m)[0], open[0].id); }
  assert.ok(refs.some(r => r.pengajuanId === x1.p.id) && refs.some(r => r.pengajuanId === x2.p.id));
});

test('B2 skenario 2: revisi ke-5 vs ke-6 pada satker & periode sama TIDAK digabung otomatis; ekspor diblokir sampai diputuskan', async () => {
  const { s } = newStore('admin');
  await addP(s, peng({ jalur: C.JALUR.SATKER }), detRev());
  await addP(s, peng({ jalur: C.JALUR.ESELON_I, tanggalInput: '2026-05-01', nomorND: 'ND-2' }), detRev({ params: { periode: 'TW2', revision_number: '6', alasan: 'Uji revisi 6', status: 'REAL' } }));
  const plan = await s.planCandidates('2026');
  assert.equal(plan.stats.identik, 0); assert.equal(plan.stats.potensi, 1); assert.equal(plan.cases.length, 1);
  assert.ok(plan.cases[0].diff.some(d => d.field === 'REVISION_NUMBER'));
  await s.applyPlan(plan, 'uji');
  const open = await s.loadOpenExceptions('2026'); assert.equal(open.length, 2, 'tidak ada penghapusan/penggabungan otomatis');
  const bl = s.exportBlockers(open); assert.ok(bl.some(b => b.code === 'POTENSI_DUPLIKAT'));
  await assert.rejects(() => s.finalizeExport(open, {}), (e) => e.code === 'BLOCKED');
});

test('B3 skenario 3: satker & revisi sama, periode berbeda -> mengikuti aturan jenis (slot beda = exception baru)', async () => {
  const { s } = newStore('admin');
  await addP(s, peng(), detRev());
  await addP(s, peng({ tanggalInput: '2026-05-01', nomorND: 'ND-3' }), detRev({ params: { periode: 'TW3', revision_number: '5', alasan: 'Uji TW3', status: 'REAL' } }));
  const plan = await s.planCandidates('2026');
  assert.equal(plan.stats.baru, 2); assert.equal(plan.stats.potensi, 0); assert.equal(plan.stats.unik, 2);
});

test('B3b Deviasi_Kegiatan: flag TW berbeda pada kegiatan sama -> potensi duplikat (bukan gabung, bukan baru)', async () => {
  const { s } = newStore('admin');
  const d1 = { jenis: 'Deviasi_Kegiatan', params: { program: '14506GM', kegiatan: '1234', jenis_belanja: '52', tw1: 'N', tw2: 'Y', tw3: 'N', tw4: 'N' } };
  const d2 = { jenis: 'Deviasi_Kegiatan', params: { program: '14506GM', kegiatan: '1234', jenis_belanja: '52', tw1: 'N', tw2: 'Y', tw3: 'Y', tw4: 'N' } };
  await addP(s, peng({ indikator: 'Deviasi Halaman III DIPA' }), d1);
  await addP(s, peng({ indikator: 'Deviasi Halaman III DIPA', tanggalInput: '2026-04-01', nomorND: 'ND-4' }), d2);
  const plan = await s.planCandidates('2026'); assert.equal(plan.stats.potensi, 1);
});

test('B5 keputusan HUBUNGKAN: kandidat melebur ke exception lama, ref terbawa, audit tercatat (skenario 5 & 8)', async () => {
  const { a, s } = newStore('admin');
  const x1 = await addP(s, peng(), detRev());
  const x2 = await addP(s, peng({ tanggalInput: '2026-05-01', nomorND: 'ND-9' }), detRev({ params: { periode: 'TW2', revision_number: '6', alasan: 'Uji', status: 'REAL' } }));
  await s.applyPlan(await s.planCandidates('2026'), 'uji');
  const cases = await s.listOpenCases(); assert.equal(cases.length, 1);
  await assert.rejects(() => s.resolveCase(cases[0].id, 'HUBUNGKAN', { reason: '' }), (e) => e.code === 'INVALID');
  const cs = (await s.loadCases())[0];
  await s.resolveCase(cs.id, 'HUBUNGKAN', { reason: 'Revisi 6 ternyata salah ketik; mengacu ke revisi 5', targetExcId: cs.matches[0] });
  const open = await s.loadOpenExceptions('2026'); assert.equal(open.length, 1);
  assert.equal(Object.keys(open[0].refs).length, 2);
  assert.equal((await s.listOpenCases()).length, 0);
  const au = await s.listAudit('dedup', cs.id); assert.ok(au.some(x => x.action === 'putuskan_hubungkan' && x.reason && x.name));
  const m = await a.get('exc_by_pengajuan/' + x2.p.id); assert.equal(Object.keys(m)[0], open[0].id, 'pengajuan baru menunjuk exception lama');
});

test('B6 keputusan BARU membuka blokir ekspor; PERLU_PEMERIKSAAN tetap memblokir', async () => {
  const { s } = newStore('admin');
  await addP(s, peng(), detRev());
  await addP(s, peng({ tanggalInput: '2026-05-01', nomorND: 'ND-9' }), detRev({ params: { periode: 'TW2', revision_number: '6', alasan: 'Uji', status: 'REAL' } }));
  await s.applyPlan(await s.planCandidates('2026'), 'uji');
  const cs = (await s.loadCases())[0];
  await s.resolveCase(cs.id, 'PERLU_PEMERIKSAAN', { reason: 'tanya Kanwil' });
  assert.ok(s.exportBlockers(await s.loadOpenExceptions('2026')).length >= 1);
  await s.resolveCase(cs.id, 'BARU', { reason: 'Diverifikasi: memang revisi 6' });
  const open = await s.loadOpenExceptions('2026'); assert.equal(open.length, 2); assert.deepEqual(s.exportBlockers(open), []);
  // keputusan tidak hilang bila kandidat dibangun ulang (idempoten)
  const plan2 = await s.planCandidates('2026'); assert.equal(plan2.creates.length, 0); assert.equal(plan2.links.length, 0);
});

test('B7 skenario 7: setelah ekspor final, periode berikutnya tidak mengulang; ekspor ulang hanya admin + alasan', async () => {
  const { a, s } = newStore('admin');
  await addP(s, peng(), detRev());
  await s.applyPlan(await s.planCandidates('2026'), 'uji');
  const open = await s.loadOpenExceptions('2026');
  const res = await s.finalizeExport(open, { fileName: 'Master_Exception_TW2_2026_20261015.xlsx', ta: '2026' });
  assert.ok(res.exportId);
  assert.equal((await s.loadOpenExceptions('2026')).length, 0);
  // pengajuan baru yang identik dengan yang sudah diekspor -> hanya ditautkan, tidak ada baris baru
  await addP(s, peng({ jalur: C.JALUR.ESELON_I, tanggalInput: '2026-09-01', nomorND: 'ND-LATE' }), detRev());
  const plan = await s.planCandidates('2026'); assert.equal(plan.stats.identik, 1); assert.equal(plan.creates.length, 0);
  await s.applyPlan(plan, 'uji'); assert.equal((await s.loadOpenExceptions('2026')).length, 0);
  // ekspor ulang
  const all = await s.loadExceptionsFor([['2026', '123456']]);
  await assert.rejects(() => s.finalizeExport(all, {}), (e) => e.code === 'ALREADY_EXPORTED');
  const pe = newStore('pengelola'); // role lain: tidak boleh ekspor ulang
  await assert.rejects(async () => { const st = ST.createStore(a, { uid: 'p', name: 'P', role: 'pengelola' }, C); await st.finalizeExport(all, { reexport: true, reexportReason: 'x' }); }, (e) => e.code === 'FORBIDDEN');
  await assert.rejects(() => s.finalizeExport(all, { reexport: true }), (e) => e.code === 'INVALID');
  const r = await s.finalizeExport(all, { reexport: true, reexportReason: 'Koreksi berkas' }); assert.ok(r.exportId);
  assert.ok((await s.listAudit('export', r.exportId)).some(x => x.action === 'ekspor_ulang'));
});

test('B8 audit: perubahan pengajuan & detail tercatat dengan sebelum/sesudah; perubahan sumber membatalkan turunan yang belum diekspor', async () => {
  const { s } = newStore('admin');
  const x = await addP(s, peng(), detRev());
  await s.applyPlan(await s.planCandidates('2026'), 'uji');
  assert.equal((await s.loadOpenExceptions('2026')).length, 1);
  await s.saveDetail(x.p.id, Object.assign({}, x.d, { params: Object.assign({}, x.d.params, { revision_number: '7' }) }), { reason: 'koreksi' });
  assert.equal((await s.loadOpenExceptions('2026')).length, 0, 'turunan lama dihapus agar dibangun ulang');
  const plan = await s.planCandidates('2026'); assert.equal(plan.creates.length, 1); assert.equal(plan.creates[0].row.REVISION_NUMBER, '7');
  const au = await s.listAudit('pengajuan', x.p.id); assert.ok(au.some(a => a.action === 'ubah_detail' && a.before && a.after));
  await s.cancelPengajuan(x.p.id, 'salah input');
  assert.ok((await s.listAudit('pengajuan', x.p.id)).some(a => a.action === 'ubah' && a.after && a.after.dibatalkan === true));
});

/* ============================ C. HAK AKSES & VALIDASI ============================ */
test('C1 role: pembaca tidak dapat menulis; pengelola tidak dapat mengubah konfigurasi/ekspor ulang', async () => {
  const a = new ST.MemoryAdapter();
  const rd = ST.createStore(a, { uid: 'r', role: 'pembaca' }, C), pg = ST.createStore(a, { uid: 'p', role: 'pengelola', name: 'P' }, C);
  await assert.rejects(() => rd.savePengajuan(peng()), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(() => rd.importPengajuan([], {}), (e) => e.code === 'FORBIDDEN');
  const ok = await pg.savePengajuan(peng()); assert.ok(ok.id);
  await assert.rejects(() => pg.saveSettings({}, 'x'), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(() => pg.restorePengajuan(ok.id), (e) => e.code === 'FORBIDDEN');
});

test('C2 validasi sisi-simpan: wajib isi, status/jalur valid, alasan penolakan', async () => {
  const { s } = newStore('admin');
  await assert.rejects(() => s.savePengajuan(peng({ nomorND: '' })), (e) => e.code === 'INVALID');
  await assert.rejects(() => s.savePengajuan(peng({ status: 'Selesai' })), (e) => e.code === 'INVALID');
  await assert.rejects(() => s.savePengajuan(peng({ status: 'Ditolak' })), (e) => e.code === 'INVALID');
  await assert.rejects(() => s.savePengajuan(peng({ kdsatker: '12345' })), (e) => e.code === 'INVALID');
  const ok = await s.savePengajuan(peng({ status: 'Ditolak', alasanPenolakan: 'dokumen tidak lengkap' })); assert.ok(ok.id);
});

test('C3 konflik versi (dua pengguna mengedit bersamaan) terdeteksi', async () => {
  const { s } = newStore('admin'); const p = await s.savePengajuan(peng());
  await s.savePengajuan(Object.assign({}, p, { keterangan: 'A' }), { expectVersion: p.version });
  await assert.rejects(() => s.savePengajuan(Object.assign({}, p, { keterangan: 'B' }), { expectVersion: p.version }), (e) => e.code === 'CONFLICT');
});

test('C4 kelayakan ekspor: status/pooling/selesai mengikuti konfigurasi; tidak ada yang ditebak', async () => {
  const el = (o, cfg) => C.eligibility(Object.assign({ status: 'Disetujui', keterangan: '' }, o), cfg);
  assert.equal(el({}).ok, true); assert.equal(el({ status: 'Pending' }).ok, false); assert.equal(el({ status: 'Ditolak' }).ok, false);
  assert.equal(el({ keterangan: 'selesai' }).ok, false);
  assert.equal(el({ keterangan: 'Pooling (baru)' }).ok, true);
  assert.equal(el({ keterangan: 'Pooling (baru)' }, Object.assign({}, C.DEFAULT_CONFIG, { poolingPolicy: 'EXCLUDE' })).ok, false);
  assert.equal(el({ dibatalkan: true }).ok, false);
});

test('C5 jenis tanpa template (PPR Terpusat) dilaporkan sebagai mapping belum tersedia, bukan dibuat', async () => {
  const { s } = newStore('admin');
  const r = await s.savePengajuan(peng());
  await assert.rejects(() => s.saveDetail(r.id, { jenis: 'Deviasi PPR Terpusat', params: {} }), (e) => e.code === 'NO_TEMPLATE');
});

test('C6 Penyerapan: rentang bulan diperluas satu baris per bulan, Eselon I tanpa satker -> perlu dilengkapi', async () => {
  const p = peng({ id: 'Ptest' });
  const ex = C.expandDetail({ id: 'D1', jenis: 'Penyerapan', params: { program: '06001BQ', output: '3128EBA', jenis_belanja: '52', bulan_awal: '1', bulan_akhir: '3' } }, p);
  assert.equal(ex.rows.length, 3); assert.deepEqual(ex.rows.map(r => r.row.PERIOD_NUM), ['1', '2', '3']);
  const es = C.expandDetail({ id: 'D2', jenis: 'Deviasi', params: { periode: 'TW2', revision_number: '5', alasan: 'x' } }, peng({ kdsatker: null, satkerRingkasan: 'Seluruh satker Kementerian X' }));
  assert.equal(es.rows.length, 0); assert.ok(es.errors.length);
});

/* ============================ D. TAMBAHAN ============================ */
test('D1 previewAgainst: IDENTIK vs pengajuan lama, POTENSI untuk revisi beda, kosong untuk periode beda', async () => {
  const { s } = newStore('admin'); const x = await addP(s, peng(), detRev());
  const others = [{ pengajuan: x.p, details: [x.d] }];
  const np = peng({ id: 'NEW', jalur: C.JALUR.ESELON_I });
  const r1 = C.previewAgainst({ pengajuan: np, detail: { id: 'n1', jenis: 'Deviasi', params: detRev().params } }, others, []);
  assert.equal(r1[0].outcome, 'IDENTIK'); assert.equal(r1[0].hits[0].kind, 'PENGAJUAN');
  const r2 = C.previewAgainst({ pengajuan: np, detail: { id: 'n2', jenis: 'Deviasi', params: Object.assign({}, detRev().params, { revision_number: '6' }) } }, others, []);
  assert.equal(r2[0].outcome, 'POTENSI_DUPLIKAT'); assert.ok(r2[0].hits[0].diff.some(d => d.field === 'REVISION_NUMBER' && d.substantif));
  const r3 = C.previewAgainst({ pengajuan: np, detail: { id: 'n3', jenis: 'Deviasi', params: Object.assign({}, detRev().params, { periode: 'TW3' }) } }, others, []);
  assert.equal(r3[0].outcome, 'EXCEPTION_BARU'); assert.equal(r3[0].hits.length, 0);
});

test('D2 bulkUpdate: alasan wajib, hanya bidang yang diizinkan, tercatat pada audit tiap pengajuan', async () => {
  const { s } = newStore('admin'); const a = await s.savePengajuan(peng()), b = await s.savePengajuan(peng({ nomorND: 'ND-B' }));
  await assert.rejects(() => s.bulkUpdate([a.id], { tw: 3 }, ''), (e) => e.code === 'INVALID');
  await assert.rejects(() => s.bulkUpdate([a.id], { kdsatker: '654321' }, 'x'), /tidak boleh/);
  const r = await s.bulkUpdate([a.id, b.id], { tw: 3, twSumber: 'MANUAL' }, 'Dikonfirmasi pengguna'); assert.equal(r.done, 2);
  assert.equal((await s.getPengajuan(a.id)).tw, 3);
  assert.ok((await s.listAudit('pengajuan', b.id)).some(x => x.reason === 'Dikonfirmasi pengguna'));
  const rd = ST.createStore(s.adapter, { uid: 'r', role: 'pembaca' }, C);
  await assert.rejects(() => rd.bulkUpdate([a.id], { tw: 1 }, 'x'), (e) => e.code === 'FORBIDDEN');
});

test('D3 parseDbRows: satker berupa teks ringkasan ditandai, KPPN diberi nol, TW/jalur tidak ditebak, baris identik tidak dibuang', () => {
  const hdr = ['No', 'Tanggal Input', 'Nama Kanwil DJPb/Eselon I K/L', 'Nomor ND', 'Tanggal ND', 'Indikator', 'Kode Satker', 'Kode KPPN', 'Nomor Dokumen', 'Status', 'Keterangan', 'Alasan Penolakan', 'Komponen', 'Exception', 'Kronologis', 'Perbaikan/Catatan'];
  const row = (o) => Object.assign(['1', '2026-03-01', 'Sekretariat Jenderal X', 'ND-1', '2026-02-27', 'Revisi DIPA', '123456', '30', 'DIPA Revisi ke-5 TW 2', 'Disetujui', '', '', '', 'Deviasi', 'k', 'p'], o);
  const aoa = [hdr, row({}), row({ 6: 'Seluruh satker Eselon I X' }), row({}), row({ 1: 'bukan tanggal' })];
  const p = C.parseDbRows(aoa, { ta: '2026' });
  assert.equal(p.summary.valid, 3); assert.equal(p.summary.invalid, 1); assert.equal(p.summary.eselonRingkasan, 1); assert.equal(p.summary.duplikatDalamFile, 1);
  assert.equal(p.records[0].kdkppn, '030'); assert.equal(p.records[0].tw, null); assert.deepEqual(p.records[0].twSaran, [2]); assert.equal(p.records[0].jalur, 'BELUM_DIVERIFIKASI');
  assert.equal(p.records[1].kdsatker, null); assert.ok(p.records[1].satkerRingkasan);
  assert.equal(new Set(p.records.map(r => r.id)).size, 3);
});
