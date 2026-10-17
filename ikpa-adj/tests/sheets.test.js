'use strict';
/* Pengujian backend Google Sheets: menjalankan apps-script/Code.gs APA ADANYA di atas tiruan SpreadsheetApp (mock_sheets.js)
 * lewat SheetsAdapter + store.js. Membuktikan LOGIKA kode kita; TIDAK membuktikan perilaku Google (kuota, latensi, penguraian sel,
 * verifikasi token Firebase sungguhan). Data di sini sintetis & hanya hidup di dalam tes. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./mock_sheets.js');
const C = require('../core.js');
const ST = require('../store.js');
const { SheetsAdapter } = require('../sheets-adapter.js');

const LEG = C.SHEET_LEGACY_COLS;
function env0(o) {
  const env = createEnv(); env.setAdmins('boss@x.id');
  env.addToken('t-admin', 'boss@x.id', 'Boss'); env.addToken('t-rek', 'rekan@x.id', 'Rekan'); env.addToken('t-rek2', 'rekan2@x.id', 'Rekan Dua');
  env.addToken('t-pemb', 'baca@x.id', 'Pembaca'); env.addToken('t-asing', 'asing@x.id', 'Asing');
  env.post({ action: 'users.set', token: 't-admin', email: 'rekan@x.id', role: 'perekam' });
  env.post({ action: 'users.set', token: 't-admin', email: 'rekan2@x.id', role: 'perekam' });
  env.post({ action: 'users.set', token: 't-admin', email: 'baca@x.id', role: 'pembaca' });
  if (!o || o.legacy !== false) env.seed('Sheet1', [LEG.concat(['', '', '']),
    [1, '03/03/2026', 'Kanwil DJPb Provinsi DKI Jakarta', 'ND-10/WPB.12/2026', '26/02/2026', 'Penyerapan Anggaran', '648521', '175', 'DIPA Awal', 'Disetujui', 'Selesai', '', '', '', 'Kronologi A', '', '015', 'KEMENTERIAN KEUANGAN', '648521'],
    [2, '16/03/2026', 'Kanwil DJPb Provinsi Maluku', 'ND-233/WPB.32/2026', '06/03/2026', 'Deviasi Halaman III DIPA', '099710', '173', 'DIPA Revisi ke-2', 'Disetujui', 'Pooling', '', '', 'Deviasi', 'Kronologi B', '', '015', 'KEMENTERIAN KEUANGAN', '099710']], { textCols: [7, 8] });
  return env;
}
function mk(env, token, email, role, name) {
  const ad = SheetsAdapter({ url: 'x', getToken: async () => token, C, satkerLookup: (kd) => null, fetch: async (u, o) => ({ ok: true, text: async () => JSON.stringify(env.post(JSON.parse(o.body))) }) });
  const st = ST.createStore(ad, { uid: email, email, name: name || email, role }, C);
  return { ad, st };
}
const base = (o) => Object.assign({ ta: '2026', tw: 2, tanggalInput: '2026-10-17', submitter: 'Kanwil DJPb Provinsi Uji', nomorND: 'ND-1/UJI/2026', tanggalND: '2026-10-10', indikator: 'Deviasi Halaman III DIPA', kdsatker: '012345', status: 'Disetujui', jalur: 'SATKER', keterangan: '', mekanismeUraian: '' }, o || {});
const devKeg = (o) => ({ jenis: 'Deviasi_Kegiatan', params: Object.assign({ program: '14506GM', kegiatan: '7717', jenis_belanja: '52', tw1: 'N', tw2: 'Y', tw3: 'N', tw4: 'N' }, o || {}) });
const col = (env, sheet, name) => { const t = env.table(sheet), i = t[0].indexOf(name); return t.slice(1).map(r => r[i]); };

test('E1 data lama (A–S) terbaca, TW/jalur TIDAK ditebak, nol di depan terjaga, kolom lama tidak disentuh', async () => {
  const env = env0(); const before = env.table('Sheet1').map(r => r.slice(0, 19).join('|'));
  const { ad, st } = mk(env, 't-admin', 'boss@x.id', 'admin'); const r = await ad.refresh();
  assert.equal(r.pengajuan, 2); assert.equal(r.unreadable, 0);
  const l = await st.listIndex('2026'); assert.equal(l.length, 2);
  l.forEach(p => { assert.equal(p.tw, null); assert.equal(p.jalur, 'BELUM_DIVERIFIKASI'); });
  assert.ok(l.some(p => p.kdsatker === '099710'));
  const after = env.table('Sheet1').map(r => r.slice(0, 19).join('|'));
  assert.deepEqual(after, before, 'kolom A–S harus tetap persis');
  assert.equal(env.table('Sheet1')[0].length >= 19 + 13, true, 'kolom aplikasi ditambahkan di kanan');
});

test('E2 jalur SATKER -> Sheet1; teks "0xxxxx" tidak berubah jadi angka; mekanisme tertulis di kolom', async () => {
  const env = env0(); const { ad, st } = mk(env, 't-rek', 'rekan@x.id', 'perekam'); await ad.refresh();
  const r = await st.saveBundle(base(), [devKeg()], [], { reason: 'uji' });
  assert.ok(r.id);
  const t = env.table('Sheet1'); assert.equal(t.length, 4);
  const last = t[3], h = t[0];
  assert.equal(last[h.indexOf('Kode Satker')], '012345');
  assert.equal(last[h.indexOf('Jalur')], 'SATKER'); assert.equal(last[h.indexOf('TW')], '2'); assert.equal(last[h.indexOf('TA')], '2026');
  const mek = last[h.indexOf('Mekanisme Penyesuaian')];
  assert.match(mek, /Deviasi/i); assert.match(mek, /7717/); assert.match(mek, /52/); assert.match(mek, /TW ?2|triwulan/i);
  assert.equal(last[h.indexOf('Diperbarui Oleh')], 'rekan@x.id', 'identitas dari token, bukan kiriman klien');
  assert.equal(last[h.indexOf('Versi')], '1');
});

test('E3 jalur ESELON_I -> sheet baru bernama Eselon I; pengajuan berikutnya memakai sheet yang sama', async () => {
  const env = env0(); const { ad, st } = mk(env, 't-rek', 'rekan@x.id', 'perekam'); await ad.refresh();
  const nm = 'Kementerian Pertanian';
  await st.saveBundle(base({ jalur: 'ESELON_I', submitter: nm, kdsatker: '', satkerRingkasan: 'Seluruh satker', nomorND: 'ND-E1' }), [], [], { reason: 'uji' });
  await st.saveBundle(base({ jalur: 'ESELON_I', submitter: nm, kdsatker: '', satkerRingkasan: 'Satker X', nomorND: 'ND-E2' }), [], [], { reason: 'uji' });
  assert.ok(env.sheet(nm), 'sheet Eselon I dibuat'); assert.equal(env.table(nm).length, 3);
  assert.equal(env.table('Sheet1').length, 3, 'Sheet1 tidak bertambah');
  const { ad: ad2 } = mk(env, 't-admin', 'boss@x.id', 'admin'); const r = await ad2.refresh(); assert.equal(r.pengajuan, 4); assert.ok(r.sheets.includes(nm));
});

test('E4 ganti jalur memindahkan baris (tidak dihapus): tercatat "Dipindahkan Ke", jumlah pengajuan tetap', async () => {
  const env = env0(); const { ad, st } = mk(env, 't-rek', 'rekan@x.id', 'perekam'); await ad.refresh();
  const r = await st.saveBundle(base({ jalur: 'BELUM_DIVERIFIKASI', nomorND: 'ND-M' }), [], [], { reason: 'uji' });
  const p = await st.getPengajuan(r.id);
  await st.saveBundle(Object.assign({}, p, { jalur: 'ESELON_I', submitter: 'Kementerian Uji', kdsatker: '', satkerRingkasan: 'Seluruh satker' }), [], [], { expectVersion: p.version, reason: 'verifikasi jalur' });
  assert.ok(env.sheet('Kementerian Uji'));
  assert.ok(col(env, 'Sheet1', 'Dipindahkan Ke').some(x => /Kementerian Uji/.test(x)), 'jejak pemindahan di baris lama');
  const { ad: ad2 } = mk(env, 't-admin', 'boss@x.id', 'admin'); const rr = await ad2.refresh(); assert.equal(rr.pengajuan, 3, 'tidak ada ganda, tidak ada yang hilang');
});

test('E5 mekanisme (detail JSON) bertahan setelah muat ulang oleh pengguna lain', async () => {
  const env = env0(); const a = mk(env, 't-rek', 'rekan@x.id', 'perekam'); await a.ad.refresh();
  const r = await a.st.saveBundle(base({ mekanismeUraian: 'Kegiatan dipercepat' }), [devKeg(), devKeg({ kegiatan: '7718', jenis_belanja: '53', tw2: 'N', tw3: 'Y' })], [], { reason: 'uji' });
  const b = mk(env, 't-admin', 'boss@x.id', 'admin'); await b.ad.refresh();
  const dets = await b.st.listDetails(r.id); assert.equal(dets.length, 2);
  assert.deepEqual(dets.map(d => d.params.kegiatan).sort(), ['7717', '7718']);
  const p = await b.st.getPengajuan(r.id); assert.equal(p.mekanismeUraian, 'Kegiatan dipercepat'); assert.match(p.mekanisme, /7718/);
});

test('E6 riwayat satker lintas triwulan & tahun beserta mekanismenya', async () => {
  const env = env0(); const a = mk(env, 't-rek', 'rekan@x.id', 'perekam'); await a.ad.refresh();
  await a.st.saveBundle(base({ ta: '2025', tw: 4, nomorND: 'ND-A' }), [devKeg({ tw4: 'Y', tw2: 'N' })], [], {});
  await a.st.saveBundle(base({ ta: '2026', tw: 1, nomorND: 'ND-B' }), [devKeg({ kegiatan: '1111', jenis_belanja: '51', tw1: 'Y', tw2: 'N' })], [], {});
  await a.st.saveBundle(base({ ta: '2026', tw: 3, nomorND: 'ND-C' }), [devKeg({ kegiatan: '2222', tw3: 'Y', tw2: 'N' })], [], {});
  const b = mk(env, 't-pemb', 'baca@x.id', 'pembaca'); await b.ad.refresh();
  const h = await b.st.satkerHistory('012345'); assert.equal(h.length, 3);
  assert.deepEqual(h.map(x => x.ta + '/' + x.tw).sort(), ['2025/4', '2026/1', '2026/3']);
  h.forEach(x => assert.match(x.mekanisme, /Deviasi/i));
});

test('E7 impor banyak satker: satu pengajuan per satker, idempoten, tidak menebak TW, satker tak dikenal tetap diimpor', async () => {
  const env = env0(); const a = mk(env, 't-rek', 'rekan@x.id', 'perekam'); await a.ad.refresh();
  const aoa = [['Kode Satker', 'Kode Kegiatan', 'Program', 'Jenis Belanja', 'Triwulan'], ['012345', '7717', '14506GM', '52', ''], ['023456', '7718', '14506GM', '53', '3'], ['012345', '7717', '14506GM', '52', ''], ['abc', '', '', '', '']];
  const mkBatch = () => C.buildSatkerBatch(aoa, { common: Object.assign(base(), { kdsatker: undefined, tw: null }), mech: { jenis: 'Deviasi_Kegiatan', params: { tw2: 'Y' } }, lookup: () => null, existingIds: a.ad.existingIds() });
  let b = mkBatch(); assert.equal(b.summary.baru, 2); assert.equal(b.summary.duplikatBerkas, 1); assert.equal(b.summary.tidakValid, 1);
  const items = b.rows.filter(r => r.status === 'BARU').map(r => ({ pengajuan: r.pengajuan, detail: r.detail, row: r.row }));
  const res = await a.st.importSatkerBatch(items, { file: 'x.xlsx', fileHash: 'h1', ta: '2026' }); assert.equal(res.created, 2);
  assert.equal(env.table('Sheet1').length, 5);
  const tws = col(env, 'Sheet1', 'TW'); assert.ok(tws.includes('3') && tws.filter(x => x === '').length >= 3, 'TW kosong tidak diisi tebakan');
  b = mkBatch(); assert.equal(b.summary.baru, 0, 'impor ulang berkas sama: tidak ada yang baru'); assert.ok(b.summary.sudahAda >= 2);
  const again = b.rows.filter(r => r.status === 'SUDAH_ADA').map(r => ({ pengajuan: r.pengajuan, detail: r.detail, row: r.row }));
  const r2 = await a.st.importSatkerBatch(again, { file: 'x.xlsx', fileHash: 'h1', ta: '2026' }); assert.equal(r2.created, 0); assert.ok(r2.skipped >= 2);
  assert.equal(env.table('Sheet1').length, 5, 'tidak bertambah');
});

test('E8 hak akses ditegakkan SERVER: pembaca/asing/token palsu ditolak; perekam tidak dapat kelola pengguna', async () => {
  const env = env0();
  assert.equal(env.post({ action: 'snapshot', token: 'palsu' }).code, 'UNAUTHENTICATED');
  assert.equal(env.post({ action: 'snapshot', token: 't-asing' }).code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'whoami', token: 't-asing' }).role, null);
  const row = { sheet: 'Sheet1', id: 'Px', cells: {}, isNew: true, prevVersion: null };
  assert.equal(env.post({ action: 'write', token: 't-pemb', rows: [row], kv: [] }).code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'users.set', token: 't-rek', email: 'x@x.id', role: 'admin' }).code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'users.list', token: 't-rek' }).code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'users.set', token: 't-admin', email: 'x@x.id', role: 'superuser' }).code, 'BAD_REQUEST');
  const s = env.post({ action: 'snapshot', token: 't-pemb' }); assert.equal(s.ok, true);
  assert.equal(env.fetchLog.every(f => f.url.includes('identitytoolkit')), true);
});

test('E9 konflik: dua rekan mengubah baris yang sama -> yang kedua ditolak, tidak menimpa', async () => {
  const env = env0(); const a = mk(env, 't-rek', 'rekan@x.id', 'perekam'), b = mk(env, 't-rek2', 'rekan2@x.id', 'perekam'); await a.ad.refresh();
  const r = await a.st.saveBundle(base(), [], [], {}); await b.ad.refresh();
  const pa = await a.st.getPengajuan(r.id), pb = await b.st.getPengajuan(r.id);
  await a.st.saveBundle(Object.assign({}, pa, { keterangan: 'dari A' }), [], [], { expectVersion: pa.version, reason: 'a' });
  await assert.rejects(() => b.st.saveBundle(Object.assign({}, pb, { keterangan: 'dari B' }), [], [], { expectVersion: pb.version, reason: 'b' }), (e) => e.code === 'CONFLICT' || /diubah|konflik|versi/i.test(e.message));
  assert.ok(col(env, 'Sheet1', 'Keterangan').includes('dari A')); assert.ok(!col(env, 'Sheet1', 'Keterangan').includes('dari B'));
});

test('E10 baris ketikan manual tanpa ID diberi ID, baris rusak dilaporkan & tidak diubah; tidak ada baris dihapus', async () => {
  const env = env0(); const sh = env.sheet('Sheet1'); const n = sh.getLastRow();
  const c = (r, k, v) => { sh.cell(r, k).v = v; };
  c(n + 1, 2, '05/10/2026'); c(n + 1, 3, 'Kanwil DJPb Provinsi Papua'); c(n + 1, 4, 'ND-manual'); c(n + 1, 6, 'Revisi DIPA'); c(n + 1, 7, '123456'); c(n + 1, 10, 'Disetujui');
  c(n + 2, 3, 'Kanwil DJPb Rusak'); c(n + 2, 4, 'ND-rusak'); c(n + 2, 10, 'StatusAneh');
  const { ad } = mk(env, 't-admin', 'boss@x.id', 'admin'); const r = await ad.refresh();
  assert.equal(r.pengajuan, 3, 'baris manual yang lengkap terbaca'); assert.equal(r.unreadable, 1, 'baris rusak dilaporkan, tidak dibaca');
  assert.match(ad.unreadable()[0].error, /Kode Satker kosong|Indikator kosong/);
  const ids = col(env, 'Sheet1', 'ID Pengajuan'); assert.equal(ids.filter(Boolean).length, 4, 'semua baris diberi ID');
  const t = env.table('Sheet1'), h = t[0]; assert.equal(t[n][h.indexOf('Kode Satker')], '123456'); assert.equal(t[n + 1][h.indexOf('Status')], 'StatusAneh', 'isi baris rusak tidak diubah');
  assert.equal(t.length, n + 2, 'jumlah baris tidak berkurang');
});

test('E11 konfigurasi & dokumen teknis (KV) bertahan; perekam tidak boleh mengubah pengaturan; audit tak dapat dipalsukan identitasnya', async () => {
  const env = env0(); const adm = mk(env, 't-admin', 'boss@x.id', 'admin'); await adm.ad.refresh();
  await adm.st.saveSettings(Object.assign({}, C.DEFAULT_CONFIG, { poolingPolicy: 'EXCLUDE' }), 'uji');
  const b = mk(env, 't-pemb', 'baca@x.id', 'pembaca'); await b.ad.refresh(); assert.equal((await b.st.getSettings()).poolingPolicy, 'EXCLUDE');
  const rek = mk(env, 't-rek', 'rekan@x.id', 'admin' /* klien berbohong soal perannya */); await rek.ad.refresh();
  await assert.rejects(() => rek.st.saveSettings(Object.assign({}, C.DEFAULT_CONFIG, { poolingPolicy: 'INCLUDE' }), 'serang'), (e) => e.code === 'FORBIDDEN');
  const adm2 = mk(env, 't-admin', 'boss@x.id', 'admin'); await adm2.ad.refresh(); assert.equal((await adm2.st.getSettings()).poolingPolicy, 'EXCLUDE');
  const a = env.table('_AUDIT'); assert.ok(a.length > 1);
  const hasForged = a.slice(1).some(r => r.join('|').includes('serang'));
  assert.equal(hasForged, false, 'permintaan yang ditolak tidak masuk audit sebagai sukses');
});

test('E12 daftar kolom Code.gs identik dengan core.js (satu sumber kebenaran)', () => {
  const env = createEnv(); const g = env.sandbox;
  const vm = require('vm');
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('LEGACY_COLS', g))), C.SHEET_LEGACY_COLS);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('APP_COLS', g))), C.SHEET_APP_COLS);
});
