/*!
 * TORING — Monitoring Penyesuaian IKPA & Master Exception
 * core.js : logika murni (tanpa DOM, tanpa Firebase). Dipakai browser (window.IkpaAdj) dan Node (require).
 *
 * Semua definisi sheet/kolom/rumus SQL di bawah DITURUNKAN dari file referensi
 * (Master_Exception_Sept_2026_v2_final.xlsx, Master_Exception_Oktober_2026_Final.xlsx,
 *  Master_Exception Juni 2026 template SITP). Lihat docs/MODUL_IKPA_ADJ.md untuk bukti dan batasan.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IkpaAdj = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ util */
  var SEP = '␟'; // pemisah komponen kunci
  function S(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return isNaN(v) ? '' : v.toISOString();
    if (typeof v === 'number' && isFinite(v) && Math.floor(v) === v) return String(v);
    return String(v).trim();
  }
  function isBlank(v) { return S(v) === ''; }
  // cyrb53 — hash deterministik 53-bit -> base36 (bukan kripto; hanya untuk ID stabil)
  function hash(str, seed) {
    var h1 = 0xdeadbeef ^ (seed || 0), h2 = 0x41c6ce57 ^ (seed || 0);
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

  /* ------------------------------------------------------------ konstanta */
  var MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var MON_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  // Domain Status MENGIKUTI SUMBER (DB Sept: Disetujui/Pending/Ditolak). "Pooling" ada di kolom Keterangan.
  var STATUS = { DISETUJUI: 'Disetujui', PENDING: 'Pending', DITOLAK: 'Ditolak' };
  var JALUR = { SATKER: 'SATKER', ESELON_I: 'ESELON_I', BELUM: 'BELUM_DIVERIFIKASI' };
  var OUTCOME = { IDENTIK: 'IDENTIK', POTENSI: 'POTENSI_DUPLIKAT', BARU: 'EXCEPTION_BARU', LENGKAPI: 'PERLU_DILENGKAPI' };
  var ROLES = { ADMIN: 'admin', PENGELOLA: 'pengelola', PEREKAM: 'perekam', PEMBACA: 'pembaca' };

  // Nilai Indikator yang teramati pada DB Sept/Okt 2026
  var INDIKATOR = [
    'Deviasi Halaman III DIPA', 'Penyerapan Anggaran', 'Belanja Kontraktual', 'Pengelolaan UP dan TUP',
    'Capaian Output', 'Penyelesaian Tagihan', 'Revisi DIPA', 'Pengecualian Nilai IKPA'
  ];
  // Indikator -> jenis exception yang PASTI (hanya bila satu-satunya). Deviasi/Penyerapan ambigu -> harus dari kolom Exception.
  var INDIKATOR_JENIS_TUNGGAL = {
    'belanja kontraktual': 'Belanja Kontraktual',
    'pengelolaan up dan tup': 'UP TUP',
    'penyelesaian tagihan': 'Tagihan',
    'revisi dipa': 'Revisi'
  };
  var INDIKATOR_TANPA_TEMPLATE = ['capaian output', 'pengecualian nilai ikpa'];
  var EXC_ALIAS = {
    'deviasi': 'Deviasi', 'deviasi_kegiatan': 'Deviasi_Kegiatan', 'deviasi kegiatan': 'Deviasi_Kegiatan',
    'penyerapan': 'Penyerapan', 'penyerapan_100': 'Penyerapan_100', 'penyerapan 100': 'Penyerapan_100',
    'deviasi_tertimbang': 'Deviasi_tertimbang', 'deviasi tertimbang': 'Deviasi_tertimbang',
    'belanja kontraktual': 'Belanja Kontraktual', 'kontraktual': 'Belanja Kontraktual',
    'revisi': 'Revisi', 'tagihan': 'Tagihan', 'up tup': 'UP TUP', 'uptup': 'UP TUP', 'up_tup': 'UP TUP'
  };
  // Hanya nilai yang teramati pada file referensi; di luar itu hanya PERINGATAN (tidak diblokir)
  var OBS = {
    jb: ['51', '52', '53', '57'], status: ['REAL'], logicBaru: ['no'], tagFlag: ['1', '2', '3']
  };

  /* --------------------------------------------------------- normalizer */
  function normSatker(v) { // -> {v:'012345'|null, padded:bool}
    var s = S(v).replace(/\s+/g, '');
    if (/^\d{6}$/.test(s)) return { v: s, padded: false };
    if (/^\d{1,5}$/.test(s)) return { v: pad(s, 6), padded: true };
    return { v: null, padded: false };
  }
  function normTW(v) { // 'TW3' | 3 | 'TW III' | 'Triwulan III' -> 'TW3'
    var s = S(v).toUpperCase().replace(/TRIWULAN|TW|\s|\./g, '');
    var m = { '1': 1, 'I': 1, '2': 2, 'II': 2, '3': 3, 'III': 3, '4': 4, 'IV': 4 }[s];
    return m ? 'TW' + m : null;
  }
  function twNum(v) { var t = normTW(v); return t ? +t.slice(2) : null; }
  function normMonth(v) { // -> 1..12 | null ; menerima 7, '07', 'JUL-26', 'Juli'
    var s = S(v);
    if (/^\d{1,2}$/.test(s)) { var n = +s; return n >= 1 && n <= 12 ? n : null; }
    var u = s.toUpperCase();
    var i = MON_EN.indexOf(u.slice(0, 3));
    if (i >= 0 && /^[A-Z]{3}(-\d{2,4})?$/.test(u)) return i + 1;
    for (var j = 0; j < 12; j++) if (MONTHS_ID[j].toUpperCase() === u) return j + 1;
    return null;
  }
  function normJB(v) { var s = S(v); return /^\d{2}$/.test(s) ? s : null; }
  function normDate(v) { // -> 'dd-mm-yyyy' | null. Menerima Date, serial Excel, dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd
    if (v === null || v === undefined || v === '') return null;
    var d = null;
    if (v instanceof Date) d = v;
    else if (typeof v === 'number') { if (v > 20000 && v < 80000) d = new Date(Math.round((v - 25569) * 86400000)); else return null; }
    else {
      var s = S(v), m;
      if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(s))) return validDMY(+m[1], +m[2], +m[3]);
      if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(s))) return validDMY(+m[3], +m[2], +m[1]);
      return null;
    }
    if (isNaN(d)) return null;
    return validDMY(d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear());
  }
  function validDMY(d, m, y) {
    var t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
    return pad(d, 2) + '-' + pad(m, 2) + '-' + y;
  }
  function dmyToISO(s) { var m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(S(s)); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; }
  function normFlag(v) { var s = S(v).toUpperCase(); return s === 'Y' || s === 'N' ? s : null; }
  function normKdjns(v) { // 'a,b' -> sorted unique list (hanya untuk PEMBANDINGAN), tidak mengubah nilai asli
    return S(v).split(/[,.;\s]+/).filter(Boolean).sort().join(',');
  }
  function jenisFromException(raw) {
    var k = S(raw).toLowerCase().replace(/\s+/g, ' ');
    return EXC_ALIAS[k] || null;
  }
  function jenisFromRecord(exceptionRaw, indikator) {
    var j = jenisFromException(exceptionRaw);
    if (j) return j;
    return INDIKATOR_JENIS_TUNGGAL[S(indikator).toLowerCase()] || null;
  }
  function isPooling(ket) { return /pooling/i.test(S(ket)); }
  function isSelesai(ket) { return /^\s*selesai/i.test(S(ket)); }

  /* -------------------------------------------------------------- registry
   * cols   : header persis seperti template (urutan = urutan kolom)
   * keys   : nama kunci internal (header 'BULAN' ganda pada Deviasi_tertimbang dibedakan)
   * kind   : tipe sel saat ekspor: 'int' angka, 'text' teks
   * sqlHead/sqlSrc : bagian tetap rumus SQL + indeks kolom sumber (0-based); sqlCol = kolom rumus (1-based)
   * id/slot: komponen kunci deduplikasi (lihat docs, bagian "Kunci deduplikasi")
   */
  var TYPES = {
    'Deviasi': {
      table: 'IKPA_R_EXCEPTION_RPD', label: 'Deviasi (basis revisi DIPA / RPD Halaman III)',
      cols: ['THANG', 'KDSATKER', 'REVISION_NUMBER', 'PERIODE', 'ALASAN', 'STATUS', 'Ket'],
      keys: ['THANG', 'KDSATKER', 'REVISION_NUMBER', 'PERIODE', 'ALASAN', 'STATUS', 'Ket'],
      kind: ['int', 'text', 'int', 'text', 'text', 'text', 'text'],
      sqlCol: 9, sqlHead: "INSERT INTO IKPA_R_EXCEPTION_RPD (THANG, KDSATKER, REVISION_NUMBER, PERIODE, ALASAN, STATUS) VALUES(", sqlSrc: [0, 1, 2, 3, 4, 5],
      id: ['THANG', 'KDSATKER', 'PERIODE', 'REVISION_NUMBER'], slot: ['THANG', 'KDSATKER', 'PERIODE'],
      info: ['ALASAN', 'STATUS', 'Ket'], sortBy: ['KDSATKER', 'PERIODE']
    },
    'Deviasi_Kegiatan': {
      table: 'IKPA_R_EXCEPTION_RPD_DETAIL', label: 'Deviasi Kegiatan (per program/kegiatan/jenis belanja)',
      cols: ['THANG', 'KDSATKER', 'KDPROGRAM', 'KDKEGIATAN', 'JENIS BELANJA', 'TW1_FLAG', 'TW2_FLAG', 'TW3_FLAG', 'TW4_FLAG'],
      keys: ['THANG', 'KDSATKER', 'KDPROGRAM', 'KDKEGIATAN', 'JENIS BELANJA', 'TW1_FLAG', 'TW2_FLAG', 'TW3_FLAG', 'TW4_FLAG'],
      kind: ['int', 'text', 'text', 'text', 'int', 'text', 'text', 'text', 'text'],
      sqlCol: 11, sqlHead: "INSERT INTO IKPA_R_EXCEPTION_RPD_DETAIL (THANG, KDSATKER, PROGRAM, KEGIATAN, AKUN, TW1_FLAG, TW2_FLAG, TW3_FLAG, TW4_FLAG) VALUES(", sqlSrc: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      id: ['THANG', 'KDSATKER', 'KDPROGRAM', 'KDKEGIATAN', 'JENIS BELANJA', 'TW1_FLAG', 'TW2_FLAG', 'TW3_FLAG', 'TW4_FLAG'],
      slot: ['THANG', 'KDSATKER', 'KDPROGRAM', 'KDKEGIATAN', 'JENIS BELANJA'], info: [], sortBy: ['KDSATKER', 'KDPROGRAM', 'KDKEGIATAN']
    },
    'Penyerapan': {
      table: 'IKPA_R_EXCEPTION_PENYERAPAN_2026', label: 'Penyerapan (per bulan, per P/K/KRO-RO, jenis belanja)',
      cols: ['THANG', 'PERIOD_NUM', 'KDSATKER', 'PROGRAM', 'OUTPUT', 'JNS_BELANJA'],
      keys: ['THANG', 'PERIOD_NUM', 'KDSATKER', 'PROGRAM', 'OUTPUT', 'JNS_BELANJA'],
      kind: ['int', 'int', 'text', 'text', 'text', 'int'],
      sqlCol: 8, sqlHead: "INSERT INTO IKPA_R_EXCEPTION_PENYERAPAN_2026 (THANG, PERIOD_NUM, KDSATKER, PROGRAM, OUTPUT, JNS_BELANJA) VALUES(", sqlSrc: [0, 1, 2, 3, 4, 5],
      id: ['THANG', 'PERIOD_NUM', 'KDSATKER', 'PROGRAM', 'OUTPUT', 'JNS_BELANJA'], slot: ['THANG', 'PERIOD_NUM', 'KDSATKER', 'JNS_BELANJA'],
      info: [], sortBy: ['KDSATKER', 'PROGRAM', 'OUTPUT', 'JNS_BELANJA', 'PERIOD_NUM']
    },
    'Revisi': {
      table: 'IKPA_R_EXCEPTION_REVISI_2026', label: 'Revisi DIPA (jenis revisi dikecualikan)',
      cols: ['THANG', 'KDSATKER', 'REVISION_NO', 'KDJNSREVISI', 'LOGIC_BARU'],
      keys: ['THANG', 'KDSATKER', 'REVISION_NO', 'KDJNSREVISI', 'LOGIC_BARU'],
      kind: ['int', 'text', 'int', 'text', 'text'],
      sqlCol: 7, sqlHead: "INSERT INTO IKPA_R_EXCEPTION_REVISI_2026 (THANG, KDSATKER, REVISION_NO, KDJNSREVISI, LOGIC_BARU) VALUES(", sqlSrc: [0, 1, 2, 3, 4],
      id: ['THANG', 'KDSATKER', 'REVISION_NO', 'KDJNSREVISI~'], slot: ['THANG', 'KDSATKER', 'REVISION_NO'],
      info: ['LOGIC_BARU'], sortBy: ['KDSATKER', 'REVISION_NO']
    },
    'Belanja Kontraktual': {
      table: 'IKPA_R_EXCEPTION_KONTRAK_2026', label: 'Belanja Kontraktual (tanggal kontrak)',
      cols: ['ID', 'THANG', 'KDSATKER', 'NO_KONTRAK', 'TANGGAL_KONTRAK', 'KETERANGAN', 'CREATION_DATE', 'MAX_CHECK_DATE', 'TAG_FLAG'],
      keys: ['ID', 'THANG', 'KDSATKER', 'NO_KONTRAK', 'TANGGAL_KONTRAK', 'KETERANGAN', 'CREATION_DATE', 'MAX_CHECK_DATE', 'TAG_FLAG'],
      kind: ['int', 'int', 'text', 'text', 'text', 'text', 'text', 'text', 'int'],
      sqlCol: 11, sqlHead: "INSERT INTO IKPA_R_EXCEPTION_KONTRAK_2026 (ID, THANG, KDSATKER, NO_KONTRAK, TANGGAL_KONTRAK, KETERANGAN, CREATION_DATE, MAX_CHECK_DATE, TAG_FLAG) VALUES (", sqlSrc: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      id: ['THANG', 'KDSATKER', 'NO_KONTRAK', 'TANGGAL_KONTRAK', 'TAG_FLAG'], slot: ['THANG', 'KDSATKER', 'NO_KONTRAK'],
      info: ['KETERANGAN', 'CREATION_DATE', 'MAX_CHECK_DATE'], sortBy: ['KDSATKER', 'NO_KONTRAK'], assignId: true
    },
    'Tagihan': {
      table: 'IKPA_R_EXCEPTION_KESALAHAN_SPM_2026', label: 'Penyelesaian Tagihan (kesalahan SPM)',
      cols: ['THANG', 'NO_SPM', 'KDSATKER', 'NO_SURAT_PERMOHONAN', 'TGL_SURAT_PERMOHONAN', 'NO_ND', 'TANGGAL_ND', 'CREATION_DATE', 'LAST_UPDATED_DATE', 'ALASAN'],
      keys: ['THANG', 'NO_SPM', 'KDSATKER', 'NO_SURAT_PERMOHONAN', 'TGL_SURAT_PERMOHONAN', 'NO_ND', 'TANGGAL_ND', 'CREATION_DATE', 'LAST_UPDATED_DATE', 'ALASAN'],
      kind: ['int', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text'],
      sqlCol: 12, sqlHead: "INSERT INTO IKPA_R_EXCEPTION_KESALAHAN_SPM_2026 (THANG, NO_SPM, KDSATKER, NO_SURAT_PERMOHONAN, TGL_SURAT_PERMOHONAN, NO_ND, TANGGAL_ND, CREATION_DATE, LAST_UPDATED_DATE, ALASAN) VALUES(", sqlSrc: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      id: ['THANG', 'NO_SPM'], slot: ['THANG', 'NO_SPM'], info: ['NO_ND', 'TANGGAL_ND', 'ALASAN', 'NO_SURAT_PERMOHONAN', 'TGL_SURAT_PERMOHONAN'], sortBy: ['KDSATKER', 'NO_SPM']
    },
    'UP TUP': {
      table: 'IKPA_R_EXCEPTION_UPTUP_2026', label: 'Pengelolaan UP dan TUP (SP2D dikecualikan)',
      cols: ['THANG', 'KD_SATKER', 'NO_SP2D', 'TGL_SP2D'],
      keys: ['THANG', 'KD_SATKER', 'NO_SP2D', 'TGL_SP2D'],
      kind: ['int', 'text', 'text', 'text'],
      sqlCol: 6, sqlHead: "INSERT INTO IKPA_R_EXCEPTION_UPTUP_2026 (THANG, KD_SATKER, NO_SP2D, TGL_SP2D) VALUES(", sqlSrc: [0, 1, 2, 3],
      id: ['THANG', 'NO_SP2D', 'KD_SATKER', 'TGL_SP2D'], slot: ['THANG', 'NO_SP2D'], info: [], sortBy: ['KD_SATKER', 'NO_SP2D'], satkerKey: 'KD_SATKER'
    },
    'Penyerapan_100': {
      table: 'IKPA_R_EXCEPTION_TOTAL_SERAP_TIMBANG_2026', label: 'Penyerapan 100 (NKPA tertimbang seluruh JB)',
      cols: ['THANG', 'KDSATKER', 'PERIODE', 'KETERANGAN', 'ALASAN'],
      keys: ['THANG', 'KDSATKER', 'PERIODE', 'KETERANGAN', 'ALASAN'],
      kind: ['int', 'text', 'text', 'text', 'text'],
      sqlCol: 7, sqlHead: "INSERT INTO IKPA_R_EXCEPTION_TOTAL_SERAP_TIMBANG_2026 (TAHUN,KD_SATKER, PERIODE) VALUES(", sqlSrc: [0, 1, 2],
      id: ['THANG', 'KDSATKER', 'PERIODE'], slot: ['THANG', 'KDSATKER', 'PERIODE'], info: ['KETERANGAN', 'ALASAN'], sortBy: ['KDSATKER', 'PERIODE']
    },
    'Deviasi_tertimbang': {
      table: 'IKPA_EXCEPTION_DEVIASI_TERTIMBANG', label: 'Deviasi Tertimbang (jenis belanja & bulan di-nol-kan)',
      cols: ['THANG', 'KDSATKER', 'BULAN', 'JENIS BELANJA', 'BULAN', 'KETERANGAN', 'ALASAN'],
      keys: ['THANG', 'KDSATKER', 'BULAN', 'JENIS BELANJA', 'BULAN_NAMA', 'KETERANGAN', 'ALASAN'],
      kind: ['int', 'text', 'text', 'int', 'text', 'text', 'text'],
      sqlCol: 9, sqlHead: "INSERT INTO IKPA_EXCEPTION_DEVIASI_TERTIMBANG (TAHUN, BULAN, JENIS_BELANJA, SATKER) VALUES(", sqlSrc: [0, 2, 3, 1],
      id: ['THANG', 'KDSATKER', 'BULAN', 'JENIS BELANJA'], slot: ['THANG', 'KDSATKER', 'BULAN', 'JENIS BELANJA'], info: ['KETERANGAN', 'ALASAN'], sortBy: ['KDSATKER', 'JENIS BELANJA', 'BULAN']
    }
  };
  // Urutan sheet pada file ekspor = urutan pada Master_Exception_Sept/Okt 2026
    Object.keys(TYPES).forEach(function (n) { var T = TYPES[n], i = T.keys.indexOf(satkerKey(n)); if (i > -1) T.kind[i] = 'satker'; });
var SHEET_ORDER = ['Deviasi', 'Deviasi_Kegiatan', 'Penyerapan', 'Revisi', 'Belanja Kontraktual', 'Tagihan', 'UP TUP', 'Penyerapan_100', 'Deviasi_tertimbang'];
  // Template yang teridentifikasi tetapi BELUM diimplementasikan
  var UNSUPPORTED = {
    'Deviasi PPR Terpusat': 'Hanya ada pada template Juni 2026; tidak ada sumber pada DB pengajuan; kolom "TANGGAL SP2D (STATIS)" tidak ikut rumus SQL. Perlu konfirmasi sebelum diimplementasikan.'
  };

  function satkerKey(type) { return TYPES[type].satkerKey || 'KDSATKER'; }

  /* ----------------------------------------------- spesifikasi form detail */
  var TW_OPTS = ['TW1', 'TW2', 'TW3', 'TW4'];
  var JB_OPTS = ['51', '52', '53', '54', '55', '56', '57'];
  var MONTH_OPTS = MONTHS_ID.map(function (n, i) { return { v: String(i + 1), l: pad(i + 1, 2) + ' - ' + n }; });
  var FIELD = function (key, label, type, req, extra) {
    var o = { key: key, label: label, type: type, required: !!req }; for (var k in (extra || {})) o[k] = extra[k]; return o;
  };
  var DETAIL_FIELDS = {
    'Deviasi': [
      FIELD('thang', 'Tahun (THANG)', 'text', false, { hint: 'Kosongkan = tahun anggaran pengajuan.' }),
      FIELD('periode', 'Periode (TW)', 'select', true, { options: TW_OPTS.map(function (t) { return { v: t, l: t }; }) }),
      FIELD('revision_number', 'Nomor revisi DIPA basis (REVISION_NUMBER)', 'int', true, { hint: '"DIPA Awal" belum dipetakan otomatis (0 hanya muncul 1x pada referensi).' }),
      FIELD('alasan', 'Alasan (ALASAN)', 'textarea', true),
      FIELD('status', 'STATUS', 'text', true, { def: 'REAL', hint: 'Satu-satunya nilai pada file referensi: REAL.' }),
      FIELD('ket', 'Ket', 'text', false, { hint: 'Label asal (mis. Kanwil DJPb Riau). Tidak ikut SQL.' })
    ],
    'Deviasi_Kegiatan': [
      FIELD('thang', 'Tahun (THANG)', 'text', false),
      FIELD('program', 'Kode program (KDPROGRAM)', 'text', true, { hint: '7 karakter, mis. 14506GM.' }),
      FIELD('kegiatan', 'Kode kegiatan (KDKEGIATAN)', 'text', true, { hint: '4 digit.' }),
      FIELD('jenis_belanja', 'Jenis belanja', 'select', true, { options: JB_OPTS.map(function (t) { return { v: t, l: t }; }) }),
      FIELD('tw1', 'TW1_FLAG', 'yn', true, { def: 'N' }), FIELD('tw2', 'TW2_FLAG', 'yn', true, { def: 'N' }),
      FIELD('tw3', 'TW3_FLAG', 'yn', true, { def: 'N' }), FIELD('tw4', 'TW4_FLAG', 'yn', true, { def: 'N' })
    ],
    'Penyerapan': [
      FIELD('thang', 'Tahun (THANG)', 'text', false),
      FIELD('program', 'Kode program (PROGRAM)', 'text', true, { hint: '7 karakter, mis. 06001BQ.' }),
      FIELD('output', 'Output KRO+RO (OUTPUT)', 'text', true, { hint: '7 karakter tanpa sufiks, mis. 3128EBA.' }),
      FIELD('jenis_belanja', 'Jenis belanja (JNS_BELANJA)', 'select', true, { options: JB_OPTS.map(function (t) { return { v: t, l: t }; }) }),
      FIELD('bulan_awal', 'Bulan awal (PERIOD_NUM)', 'select', true, { options: MONTH_OPTS }),
      FIELD('bulan_akhir', 'Bulan akhir (PERIOD_NUM)', 'select', true, { options: MONTH_OPTS, hint: 'Satu baris ekspor dibuat per bulan.' })
    ],
    'Revisi': [
      FIELD('thang', 'Tahun (THANG)', 'text', false),
      FIELD('revision_no', 'Nomor revisi (REVISION_NO)', 'int', true),
      FIELD('kdjnsrevisi', 'Kode jenis revisi (KDJNSREVISI)', 'text', true, { hint: 'Dipisah koma, mis. 201,223,307. Titik dipertahankan apa adanya (diberi peringatan).' }),
      FIELD('logic_baru', 'LOGIC_BARU', 'text', true, { def: 'no', hint: 'Satu-satunya nilai pada file referensi: no. Artinya belum terdokumentasi.' })
    ],
    'Belanja Kontraktual': [
      FIELD('thang', 'Tahun (THANG)', 'text', false),
      FIELD('no_kontrak', 'Nomor kontrak (NO_KONTRAK)', 'text', true),
      FIELD('tanggal_kontrak', 'Tanggal kontrak (dd-mm-yyyy)', 'text', true),
      FIELD('keterangan', 'Keterangan (alasan satker)', 'textarea', true),
      FIELD('creation_date', 'CREATION_DATE (dd-mm-yyyy)', 'text', false),
      FIELD('max_check_date', 'MAX_CHECK_DATE (dd-mm-yyyy)', 'text', false),
      FIELD('tag_flag', 'TAG_FLAG', 'select', true, { options: OBS.tagFlag.map(function (t) { return { v: t, l: t }; }), hint: 'Arti 1/2/3 belum terdokumentasi pada file referensi.' })
    ],
    'Tagihan': [
      FIELD('thang', 'Tahun (THANG)', 'text', false),
      FIELD('no_spm', 'Nomor SPM (NO_SPM)', 'text', true, { hint: 'Format 00534T/645163/2026 (tanpa awalan "SPM Nomor").' }),
      FIELD('no_surat_permohonan', 'NO_SURAT_PERMOHONAN', 'text', false), FIELD('tgl_surat_permohonan', 'TGL_SURAT_PERMOHONAN', 'text', false),
      FIELD('no_nd', 'NO_ND', 'text', true), FIELD('tanggal_nd', 'TANGGAL_ND (dd-mm-yyyy)', 'text', true),
      FIELD('alasan', 'ALASAN', 'textarea', true)
    ],
    'UP TUP': [
      FIELD('thang', 'Tahun (THANG)', 'text', false),
      FIELD('no_sp2d', 'Nomor SP2D (NO_SP2D)', 'text', true, { hint: '15 digit.' }),
      FIELD('tgl_sp2d', 'Tanggal SP2D (dd-mm-yyyy)', 'text', true)
    ],
    'Penyerapan_100': [
      FIELD('thang', 'Tahun (THANG)', 'text', false),
      FIELD('periode', 'Periode (TW)', 'select', true, { options: TW_OPTS.map(function (t) { return { v: t, l: t }; }) }),
      FIELD('keterangan', 'KETERANGAN', 'text', false, { hint: 'Kosong = teks baku "Mengubah kolom NKPA TERTIMBANG SELURUH JB bulan terakhir TWn menjadi 100".' }),
      FIELD('alasan', 'ALASAN', 'textarea', true)
    ],
    'Deviasi_tertimbang': [
      FIELD('thang', 'Tahun (THANG)', 'text', false),
      FIELD('jenis_belanja', 'Jenis belanja', 'select', true, { options: JB_OPTS.map(function (t) { return { v: t, l: t }; }) }),
      FIELD('bulan_awal', 'Bulan awal', 'select', true, { options: MONTH_OPTS }),
      FIELD('bulan_akhir', 'Bulan akhir', 'select', true, { options: MONTH_OPTS, hint: 'Satu baris ekspor per bulan.' }),
      FIELD('keterangan', 'KETERANGAN', 'text', false, { hint: 'Kosong = teks baku "Mengubah KOLOM DEVIASI TERTIMBANG belanja X bulan Y menjadi 0".' }),
      FIELD('alasan', 'ALASAN', 'textarea', true)
    ]
  };

  /* ---------------------------------------------------------- expandDetail
   * detail : {jenis, params:{...}, satkerList?:[kode]}
   * pengajuan : {ta, kdsatker, submitter}
   * -> [{jenis,row,rowKey,idKey,slotKey,errors,warnings,ref}]
   */
  function monthRange(a, b) {
    var x = normMonth(a), y = normMonth(b), out = [];
    if (!x || !y || y < x) return null;
    for (var m = x; m <= y; m++) out.push(m);
    return out;
  }
  function shortKet(submitter) {
    return S(submitter).replace(/\s+Provinsi\s+/i, ' ').replace(/\s+/g, ' ');
  }
  function expandDetail(detail, pengajuan) {
    var type = detail.jenis, p = detail.params || {}, T = TYPES[type];
    if (!T) return { rows: [], errors: ['Jenis exception tidak dikenal / belum memiliki template: ' + S(type)] };
    var thang = S(p.thang) || S(pengajuan.ta);
    var satkers = (detail.satkerList && detail.satkerList.length) ? detail.satkerList : (pengajuan.kdsatker ? [pengajuan.kdsatker] : []);
    var errors = [];
    if (!satkers.length) errors.push('Kode satker belum ada (pengajuan tingkat Eselon I perlu daftar satker).');
    var base = [];
    satkers.forEach(function (sk0) {
      var sk = normSatker(sk0).v || S(sk0);
      var mk = function (extra) { var r = {}; T.keys.forEach(function (k) { r[k] = ''; }); r.THANG = thang; r[satkerKey(type)] = sk; for (var k in extra) r[k] = extra[k]; base.push(r); };
      switch (type) {
        case 'Deviasi':
          mk({ REVISION_NUMBER: S(p.revision_number), PERIODE: normTW(p.periode) || S(p.periode), ALASAN: S(p.alasan), STATUS: S(p.status) || 'REAL', Ket: S(p.ket) });
          break;
        case 'Deviasi_Kegiatan':
          mk({ KDPROGRAM: S(p.program).toUpperCase(), KDKEGIATAN: S(p.kegiatan), 'JENIS BELANJA': S(p.jenis_belanja), TW1_FLAG: S(p.tw1 || 'N').toUpperCase(), TW2_FLAG: S(p.tw2 || 'N').toUpperCase(), TW3_FLAG: S(p.tw3 || 'N').toUpperCase(), TW4_FLAG: S(p.tw4 || 'N').toUpperCase() });
          break;
        case 'Penyerapan': {
          var rg = monthRange(p.bulan_awal, p.bulan_akhir);
          if (!rg) { errors.push('Rentang bulan tidak valid.'); break; }
          rg.forEach(function (m) { mk({ PERIOD_NUM: String(m), PROGRAM: S(p.program).toUpperCase(), OUTPUT: S(p.output).toUpperCase(), JNS_BELANJA: S(p.jenis_belanja) }); });
          break;
        }
        case 'Revisi':
          mk({ REVISION_NO: S(p.revision_no), KDJNSREVISI: S(p.kdjnsrevisi), LOGIC_BARU: S(p.logic_baru) || 'no' });
          break;
        case 'Belanja Kontraktual':
          mk({ NO_KONTRAK: S(p.no_kontrak), TANGGAL_KONTRAK: normDate(p.tanggal_kontrak) || S(p.tanggal_kontrak), KETERANGAN: S(p.keterangan), CREATION_DATE: normDate(p.creation_date) || S(p.creation_date), MAX_CHECK_DATE: normDate(p.max_check_date) || S(p.max_check_date), TAG_FLAG: S(p.tag_flag) });
          break;
        case 'Tagihan': {
          var spm = S(p.no_spm).replace(/^SPM\s*Nomor\s*/i, '');
          mk({ NO_SPM: spm, NO_SURAT_PERMOHONAN: S(p.no_surat_permohonan), TGL_SURAT_PERMOHONAN: normDate(p.tgl_surat_permohonan) || S(p.tgl_surat_permohonan), NO_ND: S(p.no_nd), TANGGAL_ND: normDate(p.tanggal_nd) || S(p.tanggal_nd), ALASAN: S(p.alasan) });
          break;
        }
        case 'UP TUP':
          mk({ NO_SP2D: S(p.no_sp2d), TGL_SP2D: normDate(p.tgl_sp2d) || S(p.tgl_sp2d) });
          break;
        case 'Penyerapan_100': {
          var tw = normTW(p.periode);
          mk({ PERIODE: tw || S(p.periode), KETERANGAN: S(p.keterangan) || (tw ? 'Mengubah kolom NKPA TERTIMBANG SELURUH JB bulan terakhir ' + tw + ' menjadi 100' : ''), ALASAN: S(p.alasan) });
          break;
        }
        case 'Deviasi_tertimbang': {
          var rg2 = monthRange(p.bulan_awal, p.bulan_akhir);
          if (!rg2) { errors.push('Rentang bulan tidak valid.'); break; }
          rg2.forEach(function (m) {
            var nama = MONTHS_ID[m - 1];
            mk({ BULAN: pad(m, 2), 'JENIS BELANJA': S(p.jenis_belanja), BULAN_NAMA: nama, KETERANGAN: S(p.keterangan) || ('Mengubah KOLOM DEVIASI TERTIMBANG belanja ' + S(p.jenis_belanja) + ' bulan ' + nama + ' menjadi 0'), ALASAN: S(p.alasan) });
          });
          break;
        }
      }
    });
    var rows = base.map(function (row) {
      var v = validateRow(type, row);
      var k = keysOf(type, row);
      return { jenis: type, row: row, errors: v.errors, warnings: v.warnings, idKey: k.idKey, slotKey: k.slotKey, excId: k.excId };
    });
    return { rows: rows, errors: errors };
  }

  /* ------------------------------------------------------------ validasi */
  function validateRow(type, r) {
    var T = TYPES[type], E = [], W = [];
    var need = function (k, label) { if (isBlank(r[k])) E.push({ field: k, msg: (label || k) + ' wajib diisi' }); };
    var re = function (k, rx, msg) { if (!isBlank(r[k]) && !rx.test(S(r[k]))) E.push({ field: k, msg: msg }); };
    var date = function (k, req) {
      if (isBlank(r[k])) { if (req) E.push({ field: k, msg: k + ' wajib diisi' }); return; }
      if (!normDate(r[k])) E.push({ field: k, msg: k + ' bukan tanggal valid (dd-mm-yyyy)' });
    };
    need('THANG'); re('THANG', /^20\d{2}$/, 'THANG harus 4 digit (20xx)');
    var sk = satkerKey(type); need(sk, sk); re(sk, /^\d{6}$/, sk + ' harus 6 digit (teks, leading zero dipertahankan)');
    var jb = function (k) { need(k, 'Jenis belanja'); re(k, /^\d{2}$/, 'Jenis belanja harus 2 digit'); if (/^\d{2}$/.test(S(r[k])) && OBS.jb.indexOf(S(r[k])) < 0) W.push({ field: k, msg: 'Jenis belanja ' + r[k] + ' tidak muncul pada file referensi (teramati: ' + OBS.jb.join(', ') + ')' }); };
    switch (type) {
      case 'Deviasi':
        need('REVISION_NUMBER'); re('REVISION_NUMBER', /^\d{1,2}$/, 'REVISION_NUMBER harus angka (0-99)');
        need('PERIODE'); re('PERIODE', /^TW[1-4]$/, 'PERIODE harus TW1..TW4');
        need('ALASAN'); need('STATUS');
        if (!isBlank(r.STATUS) && OBS.status.indexOf(S(r.STATUS)) < 0) W.push({ field: 'STATUS', msg: 'STATUS selain REAL tidak muncul pada file referensi' });
        if (S(r.REVISION_NUMBER) === '0') W.push({ field: 'REVISION_NUMBER', msg: 'Revisi 0 hanya muncul 1x pada file referensi; verifikasi' });
        break;
      case 'Deviasi_Kegiatan':
        need('KDPROGRAM'); re('KDPROGRAM', /^\d{5}[A-Z]{2}$/, 'KDPROGRAM harus 5 digit + 2 huruf (mis. 14506GM)');
        need('KDKEGIATAN'); re('KDKEGIATAN', /^\d{4}$/, 'KDKEGIATAN harus 4 digit');
        jb('JENIS BELANJA');
        ['TW1_FLAG', 'TW2_FLAG', 'TW3_FLAG', 'TW4_FLAG'].forEach(function (k) { need(k); re(k, /^[YN]$/, k + ' harus Y atau N'); });
        if (['TW1_FLAG', 'TW2_FLAG', 'TW3_FLAG', 'TW4_FLAG'].every(function (k) { return S(r[k]) === 'N'; })) E.push({ field: 'TW1_FLAG', msg: 'Tidak ada triwulan yang ditandai Y' });
        break;
      case 'Penyerapan':
        need('PERIOD_NUM'); re('PERIOD_NUM', /^(?:[1-9]|1[0-2])$/, 'PERIOD_NUM harus 1-12');
        need('PROGRAM'); re('PROGRAM', /^\d{5}[A-Z]{2}$/, 'PROGRAM harus 5 digit + 2 huruf');
        need('OUTPUT'); re('OUTPUT', /^\d{4}[A-Z]{3}$/, 'OUTPUT harus 4 digit + 3 huruf (KRO+RO tanpa sufiks)');
        jb('JNS_BELANJA');
        break;
      case 'Revisi':
        need('REVISION_NO'); re('REVISION_NO', /^\d{1,2}$/, 'REVISION_NO harus angka');
        need('KDJNSREVISI'); need('LOGIC_BARU');
        if (!isBlank(r.KDJNSREVISI)) {
          if (/\./.test(S(r.KDJNSREVISI))) W.push({ field: 'KDJNSREVISI', msg: 'Memakai titik sebagai pemisah (seperti 211.239 pada referensi); dipertahankan apa adanya, verifikasi' });
          else if (!/^\d{3}(,\d{3})*$/.test(S(r.KDJNSREVISI))) E.push({ field: 'KDJNSREVISI', msg: 'KDJNSREVISI harus daftar kode 3 digit dipisah koma' });
        }
        if (!isBlank(r.LOGIC_BARU) && OBS.logicBaru.indexOf(S(r.LOGIC_BARU)) < 0) W.push({ field: 'LOGIC_BARU', msg: 'Hanya nilai "no" yang teramati pada referensi' });
        break;
      case 'Belanja Kontraktual':
        need('NO_KONTRAK'); date('TANGGAL_KONTRAK', true); need('KETERANGAN'); date('CREATION_DATE', false); date('MAX_CHECK_DATE', false);
        need('TAG_FLAG'); re('TAG_FLAG', /^\d$/, 'TAG_FLAG harus angka');
        if (!isBlank(r.TAG_FLAG) && OBS.tagFlag.indexOf(S(r.TAG_FLAG)) < 0) W.push({ field: 'TAG_FLAG', msg: 'TAG_FLAG di luar 1/2/3 yang teramati' });
        if (isBlank(r.MAX_CHECK_DATE)) W.push({ field: 'MAX_CHECK_DATE', msg: 'MAX_CHECK_DATE kosong (kosong pada sebagian baris referensi)' });
        break;
      case 'Tagihan': {
        need('NO_SPM'); re('NO_SPM', /^\d{5}T\/\d{6}\/\d{4}$/, 'NO_SPM harus berformat 00534T/645163/2026');
        var m = /^\d{5}T\/(\d{6})\/(\d{4})$/.exec(S(r.NO_SPM));
        if (m && m[1] !== S(r.KDSATKER)) E.push({ field: 'NO_SPM', msg: 'Kode satker pada NO_SPM (' + m[1] + ') berbeda dari KDSATKER' });
        if (m && m[2] !== S(r.THANG)) E.push({ field: 'NO_SPM', msg: 'Tahun pada NO_SPM berbeda dari THANG' });
        need('NO_ND'); date('TANGGAL_ND', true); need('ALASAN'); date('TGL_SURAT_PERMOHONAN', false);
        break;
      }
      case 'UP TUP':
        need('NO_SP2D'); re('NO_SP2D', /^\d{15}$/, 'NO_SP2D harus 15 digit'); date('TGL_SP2D', true);
        break;
      case 'Penyerapan_100':
        need('PERIODE'); re('PERIODE', /^TW[1-4]$/, 'PERIODE harus TW1..TW4'); need('KETERANGAN'); need('ALASAN');
        break;
      case 'Deviasi_tertimbang':
        need('BULAN'); re('BULAN', /^(0[1-9]|1[0-2])$/, 'BULAN harus 01-12'); jb('JENIS BELANJA'); need('KETERANGAN'); need('ALASAN');
        break;
    }
    return { errors: E, warnings: W };
  }

  /* ----------------------------------------------------- kunci deduplikasi */
  function compVal(type, k, row) {
    if (k === 'KDJNSREVISI~') return normKdjns(row.KDJNSREVISI);
    var v = row[k];
    if (k === 'PERIOD_NUM') { var mth = normMonth(v); return mth ? String(mth) : S(v); }
    if (k === 'REVISION_NUMBER' || k === 'REVISION_NO' || k === 'TAG_FLAG') return S(v).replace(/^0+(?=\d)/, '');
    return S(v);
  }
  function keysOf(type, row) {
    var T = TYPES[type];
    var idKey = type + SEP + T.id.map(function (k) { return compVal(type, k, row); }).join(SEP);
    var slotKey = type + SEP + T.slot.map(function (k) { return compVal(type, k, row); }).join(SEP);
    return { idKey: idKey, slotKey: slotKey, excId: 'E' + hash(idKey) };
  }
  function canon(type, rawRow) { // normalisasi baris -> bentuk kanonik (untuk impor ME historis)
    var T = TYPES[type], r = {};
    T.keys.forEach(function (k) { r[k] = rawRow[k] === undefined || rawRow[k] === null ? '' : rawRow[k]; });
    r.THANG = S(r.THANG);
    var sk = satkerKey(type); var ns = normSatker(r[sk]); r[sk] = ns.v || S(r[sk]);
    ['PERIODE'].forEach(function (k) { if (r[k] !== '' && (type === 'Deviasi' || type === 'Penyerapan_100')) r[k] = normTW(r[k]) || S(r[k]); });
    if (type === 'Penyerapan') { var m = normMonth(r.PERIOD_NUM); r.PERIOD_NUM = m ? String(m) : S(r.PERIOD_NUM); r.JNS_BELANJA = S(r.JNS_BELANJA); }
    ['TANGGAL_KONTRAK', 'CREATION_DATE', 'MAX_CHECK_DATE', 'TANGGAL_ND', 'TGL_SURAT_PERMOHONAN', 'LAST_UPDATED_DATE', 'TGL_SP2D'].forEach(function (k) { if (k in r && r[k] !== '') r[k] = normDate(r[k]) || S(r[k]); });
    if (type === 'Deviasi_tertimbang') { var bm = normMonth(r.BULAN); if (bm) { r.BULAN = pad(bm, 2); r.BULAN_NAMA = r.BULAN_NAMA || MONTHS_ID[bm - 1]; } }
    Object.keys(r).forEach(function (k) { if (typeof r[k] !== 'string') r[k] = S(r[k]); });
    return r;
  }
  function diffRows(type, a, b) { // bandingkan atribut identitas + informasional
    var T = TYPES[type], out = [], seen = {};
    T.id.concat(T.slot, T.info).forEach(function (k0) {
      var k = k0.replace('~', ''); if (seen[k]) return; seen[k] = 1;
      var va = k0.indexOf('~') > -1 ? S(a[k]) : compVal(type, k, a), vb = k0.indexOf('~') > -1 ? S(b[k]) : compVal(type, k, b);
      var cmpA = k0.indexOf('~') > -1 ? normKdjns(a[k]) : va, cmpB = k0.indexOf('~') > -1 ? normKdjns(b[k]) : vb;
      if (cmpA !== cmpB) out.push({ field: k, a: va, b: vb, substantif: T.id.indexOf(k0) > -1 || T.slot.indexOf(k0) > -1 });
    });
    return out;
  }

  /* --------------------------------------------------------------- dedup */
  // exc: {id, jenis, row, idKey, slotKey, refs, ...}
  function buildIndex(excs) {
    var ix = { byId: {}, bySlot: {}, byPartial: {} };
    (excs || []).forEach(function (e) { addToIndex(ix, e); });
    return ix;
  }
  function partialKey(type, row) { return type + SEP + compVal(type, 'THANG', row) + SEP + compVal(type, satkerKey(type), row); }
  function addToIndex(ix, e) {
    (ix.byId[e.idKey] = ix.byId[e.idKey] || []).push(e);
    (ix.bySlot[e.slotKey] = ix.bySlot[e.slotKey] || []).push(e);
    var pk = partialKey(e.jenis, e.row); (ix.byPartial[pk] = ix.byPartial[pk] || []).push(e);
  }
  /* classify satu baris kandidat terhadap indeks.
   * return {outcome, matches:[exc], diff:[...], reason} */
  function classify(cand, ix) {
    var type = cand.jenis, T = TYPES[type];
    if (cand.errors && cand.errors.length) {
      // Data belum cukup: jika ada exception existing pada satker+tahun+jenis yang cocok pada atribut yang SUDAH terisi -> POTENSI
      var pk = partialKey(type, cand.row), pool = ix.byPartial[pk] || [];
      var filled = T.id.filter(function (k) { return !isBlank(k === 'KDJNSREVISI~' ? cand.row.KDJNSREVISI : cand.row[k]); });
      var hit = pool.filter(function (e) {
        return filled.length > 2 && filled.every(function (k) { return compVal(type, k, e.row) === compVal(type, k, cand.row); });
      });
      if (hit.length) return { outcome: OUTCOME.POTENSI, matches: hit, diff: diffRows(type, cand.row, hit[0].row), reason: 'DATA_BELUM_LENGKAP' };
      return { outcome: OUTCOME.LENGKAPI, matches: [], diff: [], reason: 'DATA_BELUM_LENGKAP' };
    }
    var same = ix.byId[cand.idKey];
    if (same && same.length) return { outcome: OUTCOME.IDENTIK, matches: same, diff: diffRows(type, cand.row, same[0].row).filter(function (d) { return !d.substantif; }), reason: 'ID_SAMA' };
    var slot = ix.bySlot[cand.slotKey];
    if (slot && slot.length) return { outcome: OUTCOME.POTENSI, matches: slot, diff: diffRows(type, cand.row, slot[0].row), reason: 'SLOT_SAMA_NILAI_BEDA' };
    return { outcome: OUTCOME.BARU, matches: [], diff: [], reason: '' };
  }

  /* ------------------------------------------------------ kelayakan ekspor */
  var DEFAULT_CONFIG = {
    eligibleStatus: ['Disetujui'],     // spec: hanya yang disetujui menjadi kandidat
    excludeKeteranganSelesai: true,    // Keterangan "selesai*" = sudah diproses sebelumnya (DB Sept)
    poolingPolicy: 'INCLUDE',          // INCLUDE | EXCLUDE ; [PERLU KONFIRMASI]
    blockOnPotensi: true,
    blockOnWarnings: false,
    ta: null
  };
  function eligibility(pengajuan, cfg) {
    cfg = cfg || DEFAULT_CONFIG;
    if (pengajuan.dibatalkan) return { ok: false, why: 'Pengajuan dibatalkan' };
    if (cfg.eligibleStatus.indexOf(pengajuan.status) < 0) return { ok: false, why: 'Status "' + S(pengajuan.status) + '" tidak memenuhi kriteria ekspor' };
    if (cfg.excludeKeteranganSelesai && isSelesai(pengajuan.keterangan)) return { ok: false, why: 'Keterangan "selesai" — sudah diproses sebelumnya' };
    if (cfg.poolingPolicy === 'EXCLUDE' && isPooling(pengajuan.keterangan)) return { ok: false, why: 'Berstatus pooling dan kebijakan pooling = tidak diekspor' };
    return { ok: true, why: '' };
  }

  /* ----------------------------------------------- bangun kandidat (plan)
   * input: items [{pengajuan, detail}], existingExcs [exc], cfg
   * output: plan {creates:[exc], links:[{excId, refKey, ref}], cases:[case], skipped:[], stats}
   * Idempoten: ref yang sudah tercatat pada exception tidak diproses ulang.
   */
  function refKeyOf(p, d, rowIdKey) { return p.id + '_' + d.id + '_' + hash(rowIdKey || ''); }
  function makeRef(p, d, linkType) {
    return { pengajuanId: p.id, detailId: d.id, jalur: p.jalur || JALUR.BELUM, tanggalInput: p.tanggalInput || '', nomorND: p.nomorND || '', tanggalND: p.tanggalND || '', submitter: p.submitter || '', linkType: linkType };
  }
  function buildPlan(items, existingExcs, cfg, decisions) {
    cfg = cfg || DEFAULT_CONFIG; decisions = decisions || {};
    var ix = buildIndex(existingExcs);
    var known = {}; // refKey -> excId
    (existingExcs || []).forEach(function (e) { Object.keys(e.refs || {}).forEach(function (rk) { known[rk] = e.id; }); });
    var plan = { creates: [], links: [], cases: [], skipped: [], mappingMissing: [], stats: { sumber: 0, unik: 0, identik: 0, potensi: 0, baru: 0, lengkapi: 0 } };
    var sorted = items.slice().sort(function (a, b) { return (S(a.pengajuan.tanggalInput) + a.pengajuan.id + a.detail.id) < (S(b.pengajuan.tanggalInput) + b.pengajuan.id + b.detail.id) ? -1 : 1; });
    var batchNew = {}, createdById = {};
    var addCreate = function (e) { plan.creates.push(e); createdById[e.id] = e; };
    sorted.forEach(function (it) {
      var p = it.pengajuan, d = it.detail;
      var el = eligibility(p, cfg);
      if (!el.ok) { plan.skipped.push({ pengajuanId: p.id, detailId: d.id, why: el.why }); return; }
      if (!TYPES[d.jenis]) { plan.mappingMissing.push({ pengajuanId: p.id, detailId: d.id, why: d.jenis ? 'Template untuk "' + d.jenis + '" belum diimplementasikan' : 'Jenis exception belum ditentukan' }); return; }
      var ex = expandDetail(d, p);
      ex.errors.forEach(function (m) { plan.skipped.push({ pengajuanId: p.id, detailId: d.id, why: m, perlu: true }); });
      ex.rows.forEach(function (c) {
        plan.stats.sumber++;
        var rk = refKeyOf(p, d, c.idKey);
        if (known[rk] || batchNew[rk]) { plan.skipped.push({ pengajuanId: p.id, detailId: d.id, why: 'Sudah diproses', already: true }); plan.stats.sumber--; return; }
        var res = classify(c, ix);
        var caseId = 'C' + hash(rk);
        var dec = decisions[caseId];
        var linkTo = function (target, type) {
          if (createdById[target.id]) createdById[target.id].refs[rk] = makeRef(p, d, type);   // target dibuat pada batch yang sama
          else plan.links.push({ excId: target.id, thang: target.thang, kdsatker: target.kdsatker, refKey: rk, ref: makeRef(p, d, type) });
          batchNew[rk] = 1;
        };
        if (res.outcome === OUTCOME.LENGKAPI) {
          plan.stats.lengkapi++;
          var inc = newExc(c, p, d, rk, { st: 'PERLU_DILENGKAPI' }); inc.id = 'X' + hash(rk);
          addCreate(inc); batchNew[rk] = 1; return;
        }
        if (res.outcome === OUTCOME.IDENTIK) { plan.stats.identik++; linkTo(res.matches[0], 'IDENTIK'); return; }
        if (res.outcome === OUTCOME.POTENSI) {
          if (dec && dec.status === 'HUBUNGKAN' && dec.target) { plan.stats.identik++; linkTo({ id: dec.target, thang: dec.targetThang, kdsatker: dec.targetKd }, 'DIHUBUNGKAN'); return; }
          plan.stats.potensi++;
          var exc = newExc(c, p, d, rk, { st: dec && dec.status === 'BARU' ? 'KANDIDAT' : 'PERLU_VERIFIKASI', caseId: caseId });
          var cs = { id: caseId, status: dec && dec.status ? dec.status : 'MENUNGGU', kandidatExcId: exc.id, kandidatRefKey: rk, pengajuanId: p.id, detailId: d.id, jenis: c.jenis, reason: res.reason, matches: res.matches.map(function (m) { return m.id; }), diff: res.diff };
          addCreate(exc); plan.cases.push(cs); batchNew[rk] = 1; addToIndex(ix, exc);
          return;
        }
        plan.stats.baru++;
        var ne = newExc(c, p, d, rk, { st: 'KANDIDAT' });
        addCreate(ne); batchNew[rk] = 1; addToIndex(ix, ne);
      });
    });
    plan.stats.unik = plan.creates.length;
    return plan;
  }
  function newExc(c, p, d, rk, extra) {
    var e = { id: c.excId, jenis: c.jenis, row: c.row, idKey: c.idKey, slotKey: c.slotKey, thang: S(c.row.THANG), kdsatker: S(c.row[satkerKey(c.jenis)]), refs: {}, sumber: 'PENGAJUAN', st: 'KANDIDAT', errors: c.errors, warnings: c.warnings };
    e.refs[rk] = makeRef(p, d, 'ASAL');
    for (var k in extra) e[k] = extra[k];
    return e;
  }

  /* ---------------------------------------------- ringkasan / ekspor tabel */
  function summarize(excs, cfg) {
    cfg = cfg || DEFAULT_CONFIG;
    var s = { sumberPengajuan: 0, unik: 0, duplikatIdentik: 0, perluVerifikasi: 0, perluDilengkapi: 0, siap: 0, sudahDiekspor: 0, peringatan: 0 }, srcSet = {};
    excs.forEach(function (e) {
      var refs = Object.keys(e.refs || {});
      refs.forEach(function (rk) { srcSet[e.refs[rk].pengajuanId] = 1; });
      s.unik++;
      s.duplikatIdentik += refs.filter(function (rk) { return e.refs[rk].linkType === 'IDENTIK' || e.refs[rk].linkType === 'DIHUBUNGKAN'; }).length;
      if (e.exportedIn && Object.keys(e.exportedIn).length) s.sudahDiekspor++;
      else if (e.st === 'PERLU_VERIFIKASI') s.perluVerifikasi++;
      else if (e.st === 'PERLU_DILENGKAPI' || (e.errors && e.errors.length)) s.perluDilengkapi++;
      else s.siap++;
      if (e.warnings && e.warnings.length) s.peringatan++;
    });
    s.sumberPengajuan = Object.keys(srcSet).length;
    return s;
  }
  function exportCategory(e) { // kategori validasi (spec §6E)
    if (e.exportedIn && Object.keys(e.exportedIn).length) return 'Sudah diekspor';
    if (e.st === 'PERLU_VERIFIKASI') return 'Duplikat';
    if (e.st === 'PERLU_DILENGKAPI' || (e.errors && e.errors.length)) return 'Perlu dilengkapi';
    return 'Valid';
  }
  function excelValue(kind, v) { // -> {t:'n'|'s', v}
    var s = S(v);
    if (kind === 'int' && /^\d+$/.test(s)) return { t: 'n', v: Number(s) };
    if (kind === 'satker' && /^[1-9]\d{5}$/.test(s)) return { t: 'n', v: Number(s) }; // sama dengan template (angka); kode berawalan nol tetap teks agar nol tidak hilang
    return { t: 's', v: s };
  }
  function sqlValue(type, row) { // nilai string yang dihasilkan rumus SQL
    var T = TYPES[type];
    var vals = T.sqlSrc.map(function (i) { return S(row[T.keys[i]]); });
    return T.sqlHead + "'" + vals.join("','") + "');";
  }
  function colLetter(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - m) / 26); } return s; }
  function sqlFormula(type, r) { // r: nomor baris Excel (1-based)
    var T = TYPES[type];
    return '="' + T.sqlHead + "'\"&" + T.sqlSrc.map(function (i) { return colLetter(i) + r; }).join("&\"','\"&") + "&\"');\"";
  }
  /* rowsByType: {type:[row]} -> {sheets:[{name, header:[..], cells:[[{t,v,f?}]], count}]}
   * opts: {sql:boolean}. Kolom internal aplikasi TIDAK ikut. ID Kontraktual = urutan 1..n dalam file (mengikuti template). */
  function buildExportSheets(rowsByType, opts) {
    opts = opts || {};
    var sheets = [];
    SHEET_ORDER.forEach(function (type) {
      var rows = (rowsByType[type] || []).slice(); if (!rows.length) return;
      var T = TYPES[type];
      rows.sort(function (a, b) {
        for (var i = 0; i < T.sortBy.length; i++) {
          var k = T.sortBy[i], x = compVal(type, k, a), y = compVal(type, k, b);
          var nx = /^\d+$/.test(x) && /^\d+$/.test(y);
          if (x !== y) return nx ? Number(x) - Number(y) : (x < y ? -1 : 1);
        }
        return 0;
      });
      var cells = rows.map(function (row, idx) {
        var r = Object.assign({}, row); if (T.assignId) r.ID = String(idx + 1);
        var line = T.keys.map(function (k, ci) { return excelValue(T.kind[ci], r[k]); });
        if (opts.sql) {
          line.push({ t: 'z' }); // kolom pemisah kosong (template: 1 kolom kosong sebelum rumus)
          line.push({ t: 's', f: sqlFormula(type, idx + 2).slice(1), v: sqlValue(type, r) });
        }
        return line;
      });
      sheets.push({ name: type, header: T.cols.slice(), cells: cells, count: rows.length, sqlCol: opts.sql ? T.sqlCol : null });
    });
    return { sheets: sheets };
  }


  /* out: hasil buildExportSheets -> workbook SheetJS. Sel {t:'z'} (pemisah) dilewati; rumus SQL ditulis sebagai formula + nilai cache. */
  function buildWorkbook(XLSX, out) {
    var wb = XLSX.utils.book_new();
    out.sheets.forEach(function (sh) {
      var ws = {}, ncol = sh.header.length + (sh.sqlCol ? 2 : 0);
      sh.header.forEach(function (h, c) { ws[XLSX.utils.encode_cell({ r: 0, c: c })] = { t: 's', v: h }; });
      sh.cells.forEach(function (line, r) {
        line.forEach(function (cell, c) {
          if (cell.t === 'z') return; var o = { t: cell.t, v: cell.v }; if (cell.f) o.f = cell.f;
          ws[XLSX.utils.encode_cell({ r: r + 1, c: c })] = o;
        });
      });
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sh.cells.length, c: Math.max(ncol - 1, 0) } });
      ws['!cols'] = sh.header.map(function () { return { wch: 16 }; }).concat(sh.sqlCol ? [{ wch: 3 }, { wch: 60 }] : []);
      XLSX.utils.book_append_sheet(wb, ws, sh.name);
    });
    return wb;
  }

  /* ---------------------------------------- parser: DB pengajuan (Sheet1) */
  var DB_MAP = [
    ['noSumber', ['no']], ['tanggalInput', ['tanggal input']], ['submitter', ['nama kanwil djpb/eselon i k/l', 'nama kanwil djpb/eselon i', 'kanwil/eselon i']],
    ['nomorND', ['nomor nd']], ['tanggalND', ['tanggal nd']], ['indikator', ['indikator']], ['kodeSatker', ['kode satker']], ['kdkppn', ['kode kppn']],
    ['nomorDokumen', ['nomor dokumen']], ['status', ['status']], ['keterangan', ['keterangan']], ['alasanPenolakan', ['alasan penolakan']],
    ['komponen', ['komponen']], ['exceptionRaw', ['exception']], ['kronologis', ['kronologis']], ['perbaikan', ['perbaikan/catatan', 'perbaikan', 'catatan']],
    ['kl', ['k/l']], ['namaKL', ['nama k/l']], ['satkerAlt', ['satker']], ['namaSatker', ['nama satker']]
  ];
  var DB_REQUIRED = ['tanggalInput', 'nomorND', 'indikator', 'kodeSatker', 'status'];
  function normHeader(h) { return S(h).toLowerCase().replace(/\s+/g, ' '); }
  function detectColumns(headerRow) { // -> {field: colIndex}
    var map = {}, used = {};
    DB_MAP.forEach(function (pair) {
      var f = pair[0];
      for (var i = 0; i < headerRow.length; i++) {
        if (used[i]) continue;
        if (pair[1].indexOf(normHeader(headerRow[i])) > -1) { map[f] = i; used[i] = 1; break; }
      }
    });
    return map;
  }
  function suggestTW(text) { // -> [1..4] yang disebut pada teks (HANYA saran)
    var t = S(text).toUpperCase(), out = {}, m;
    var rx = /(?:TRIWULAN|TW)\s*((?:I{1,3}|IV|[1-4])(?:\s*(?:,|DAN|&|S\.?D\.?|-|\/)\s*(?:I{1,3}|IV|[1-4]))*)/g;
    while ((m = rx.exec(t))) {
      (m[1].match(/IV|I{1,3}|[1-4]/g) || []).forEach(function (x) { var n = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4 }[x] || +x; if (n) out[n] = 1; });
    }
    return Object.keys(out).map(Number).sort();
  }
  function suggestRevision(nomorDokumen) { // 'DIPA Revisi ke-9' -> 9 (HANYA saran)
    var m = /revisi\s*ke\s*-?\s*(\d{1,2})/i.exec(S(nomorDokumen));
    return m ? +m[1] : null;
  }
  function parseDocCode(text) { // 'GM.7717.RBI' / '145.03.FC.7691.CBR' / '7691.CBS.002' -> {kegiatan, ro, kro, huruf} (saran)
    var out = [], re = /(?:\b([A-Z]{2})\.)?(\d{4})\.([A-Z]{3})(?:\.\d{3})?/g, m, s = S(text).toUpperCase();
    while ((m = re.exec(s))) out.push({ kodeProgramHuruf: m[1] || null, kegiatan: m[2], output: m[2] + m[3] });
    return out;
  }
  function suggestJalur(submitter) { // saran saja; tidak pernah diterapkan otomatis
    var s = S(submitter);
    if (/^kanwil\s+djpb/i.test(s)) return JALUR.SATKER;
    return s ? JALUR.ESELON_I : null;
  }
  /* aoa: array of arrays (baris pertama = header). opts: {ta, tw, useTwSuggestion, fileName, fileHash, colMap}
   * -> {records:[pengajuan], rowErrors:[{row,msgs}], summary} ; deterministik (ID stabil) */
  function parseDbRows(aoa, opts) {
    opts = opts || {};
    var header = aoa[0] || [], map = opts.colMap || detectColumns(header);
    var missing = DB_REQUIRED.filter(function (f) { return map[f] === undefined; });
    var res = { records: [], rowErrors: [], missingColumns: missing, summary: { total: 0, valid: 0, invalid: 0, warnings: 0, duplikatDalamFile: 0, eselonRingkasan: 0 }, map: map };
    if (missing.length) return res;
    var seen = {};
    for (var i = 1; i < aoa.length; i++) {
      var row = aoa[i];
      if (!row || row.every(function (c) { return isBlank(c); })) continue;
      res.summary.total++;
      var g = function (f) { return map[f] === undefined ? '' : row[map[f]]; };
      var errs = [], warns = [];
      var tglInput = normDate(g('tanggalInput')), tglND = normDate(g('tanggalND'));
      if (!tglInput) errs.push('Tanggal Input tidak valid');
      if (isBlank(g('tanggalND'))) warns.push('Tanggal ND kosong'); else if (!tglND) errs.push('Tanggal ND tidak valid');
      if (isBlank(g('nomorND'))) errs.push('Nomor ND kosong');
      var ind = S(g('indikator')); if (!ind) errs.push('Indikator kosong'); else if (INDIKATOR.map(function (x) { return x.toLowerCase(); }).indexOf(ind.toLowerCase()) < 0) warns.push('Indikator "' + ind + '" tidak dikenal');
      var ksRaw = S(g('kodeSatker')), ks = normSatker(ksRaw), ringkasan = false, kodeSatker = null;
      if (!ksRaw) errs.push('Kode Satker kosong');
      else if (/^\d{6}$/.test(ksRaw)) kodeSatker = ksRaw;
      else if (ks.v && ks.padded) { kodeSatker = ks.v; warns.push('Kode satker ' + ksRaw + ' dilengkapi nol di depan menjadi ' + ks.v + ' (verifikasi)'); }
      else { ringkasan = true; warns.push('Kode Satker berupa teks ringkasan (tingkat Eselon I); satker perlu dirinci pada detail'); }
      var st = S(g('status'));
      if (!st) errs.push('Status kosong'); else if (['disetujui', 'pending', 'ditolak'].indexOf(st.toLowerCase()) < 0) warns.push('Status "' + st + '" tidak dikenal (nilai sumber dipertahankan)');
      var statusNorm = ['disetujui', 'pending', 'ditolak'].indexOf(st.toLowerCase()) > -1 ? st.charAt(0).toUpperCase() + st.slice(1).toLowerCase() : st;
      var exRaw = S(g('exceptionRaw')), jenis = jenisFromRecord(exRaw, ind);
      if (!jenis) warns.push('Jenis exception belum dapat ditentukan' + (exRaw ? ' ("' + exRaw + '")' : ''));
      if (INDIKATOR_TANPA_TEMPLATE.indexOf(ind.toLowerCase()) > -1) warns.push('Mapping belum tersedia: tidak ada template Master Exception untuk indikator ini');
      var kppnRaw = S(g('kdkppn')), kppn = /^\d{1,3}$/.test(kppnRaw) ? pad(kppnRaw, 3) : kppnRaw;
      var kronologis = S(g('kronologis')), perbaikan = S(g('perbaikan'));
      var sugTW = suggestTW(perbaikan + ' ' + S(g('nomorDokumen')) + ' ' + kronologis);
      var tw = null, twSumber = 'BELUM';
      if (opts.tw) { tw = +opts.tw; twSumber = 'IMPOR_DEFAULT'; }
      else if (opts.useTwSuggestion && sugTW.length === 1) { tw = sugTW[0]; twSumber = 'SARAN'; }
      var key = [opts.ta, tglInput, S(g('submitter')), S(g('nomorND')), tglND, ind, ksRaw, S(g('nomorDokumen')), jenis || exRaw, kronologis, perbaikan].join(SEP);
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 1) { warns.push('Baris identik dengan baris sebelumnya dalam file (disimpan sebagai pengajuan terpisah #' + seen[key] + ')'); res.summary.duplikatDalamFile++; }
      var id = 'P' + hash(key + (seen[key] > 1 ? SEP + '#' + seen[key] : ''));
      if (errs.length) { res.summary.invalid++; res.rowErrors.push({ row: i + 1, errors: errs, warnings: warns }); continue; }
      if (warns.length) res.summary.warnings++;
      if (ringkasan) res.summary.eselonRingkasan++;
      res.summary.valid++;
      var rec = {
        id: id, ta: S(opts.ta), tw: tw, twSumber: twSumber, twSaran: sugTW, tanggalInput: dmyToISO(tglInput), submitter: S(g('submitter')),
        nomorND: S(g('nomorND')), tanggalND: tglND ? dmyToISO(tglND) : '', indikator: ind, kdsatker: kodeSatker, satkerRingkasan: ringkasan ? ksRaw : '',
        kdkppn: kppn, nomorDokumen: S(g('nomorDokumen')), status: statusNorm, keterangan: S(g('keterangan')), pooling: isPooling(g('keterangan')),
        alasanPenolakan: S(g('alasanPenolakan')), komponen: S(g('komponen')), exceptionRaw: exRaw, jenis: jenis, kronologis: kronologis, perbaikan: perbaikan,
        kl: S(g('kl')) === '#N/A' ? '' : S(g('kl')), namaKL: S(g('namaKL')) === '#N/A' ? '' : S(g('namaKL')), namaSatker: S(g('namaSatker')),
        jalur: JALUR.BELUM, jalurSaran: suggestJalur(g('submitter')), periodeProses: '',
        saranRevisi: suggestRevision(g('nomorDokumen')),
        sumber: { type: 'IMPOR', file: S(opts.fileName), fileHash: S(opts.fileHash), baris: i + 1, noSumber: S(g('noSumber')) },
        warnings: warns
      };
      res.records.push(rec);
    }
    return res;
  }

  /* ------------------------------------ parser: file Master Exception (ME)
   * sheetsAoa: {sheetName: aoa} ; -> {rows:[{jenis,row,sheet,baris}], ignored:[...], errors:[...]}
   * Dipakai untuk rekonsiliasi file historis. Header sheet harus sama dengan template. */
  function parseMasterExceptionSheets(sheetsAoa) {
    var out = { rows: [], ignored: [], errors: [], perSheet: {} };
    Object.keys(sheetsAoa).forEach(function (name) {
      var T = TYPES[name];
      if (!T) { out.ignored.push({ sheet: name, why: UNSUPPORTED[name] ? 'Template teridentifikasi tetapi belum diimplementasikan' : 'Bukan sheet exception yang dikenal' }); return; }
      var aoa = sheetsAoa[name], hdr = (aoa[0] || []).map(S);
      var need = T.cols;
      var ok = need.every(function (c, i) { return hdr[i] === c; });
      if (!ok) { out.errors.push({ sheet: name, why: 'Header tidak sesuai template. Diharapkan: ' + need.join(' | ') + ' ; ditemukan: ' + hdr.slice(0, need.length).join(' | ') }); return; }
      var n = 0;
      for (var i = 1; i < aoa.length; i++) {
        var line = aoa[i] || [];
        if (need.every(function (c, j) { return isBlank(line[j]); })) continue;
        var raw = {}; T.keys.forEach(function (k, j) { raw[k] = line[j]; });
        out.rows.push({ jenis: name, row: canon(name, raw), sheet: name, baris: i + 1 }); n++;
      }
      out.perSheet[name] = n;
    });
    return out;
  }
  function excFromMeRow(r, meta) { // exception historis (sumber: file ME) — status TEREKSPOR bila meta.sudahDiekspor
    var k = keysOf(r.jenis, r.row), v = validateRow(r.jenis, r.row);
    return { id: k.excId, jenis: r.jenis, row: r.row, idKey: k.idKey, slotKey: k.slotKey, thang: S(r.row.THANG), kdsatker: S(r.row[satkerKey(r.jenis)]), refs: {}, sumber: 'ME_HISTORIS', st: v.errors.length ? 'PERLU_DILENGKAPI' : 'KANDIDAT', errors: v.errors, warnings: v.warnings, meSumber: { file: meta.file, sheet: r.sheet, baris: r.baris, periode: meta.periode || '' } };
  }

  /* -------------------------------------------- ringkasan satker & dashboard */
  function twSummaryForSatker(list) { // list: pengajuan compact; -> {1:{n,status:{..},indikator:[..]},...,belumTW:{...}}
    var out = { 1: blankTW(), 2: blankTW(), 3: blankTW(), 4: blankTW(), 0: blankTW() }; // 0 = TW belum ditentukan
    list.filter(function (p) { return !p.dibatalkan; }).forEach(function (p) {
      var b = out[p.tw || 0];
      b.n++; b.status[p.status] = (b.status[p.status] || 0) + 1; if (p.pooling) b.pooling++;
      if (b.indikator.indexOf(p.indikator) < 0) b.indikator.push(p.indikator);
    });
    return out;
  }
  function blankTW() { return { n: 0, status: {}, pooling: 0, indikator: [] }; }
  function compactOf(p) { // proyeksi ringkas untuk daftar/dashboard
    return { id: p.id, ta: p.ta, tw: p.tw || null, kdsatker: p.kdsatker || null, satkerRingkasan: p.satkerRingkasan || '', namaSatker: p.namaSatker || '', kdkppn: p.kdkppn || '', kl: p.kl || '', namaKL: p.namaKL || '', submitter: p.submitter || '', nomorND: p.nomorND || '', tanggalND: p.tanggalND || '', tanggalInput: p.tanggalInput || '', indikator: p.indikator || '', jenis: p.jenis || null, status: p.status || '', keterangan: p.keterangan || '', pooling: !!p.pooling, jalur: p.jalur || JALUR.BELUM, periodeProses: p.periodeProses || '', dibatalkan: !!p.dibatalkan, detailCount: p.detailCount || 0, detailLengkap: p.detailLengkap || 0, mekanisme: p.mekanisme || '', sheet: p.sheet || '' };
  }
  function applyFilters(list, f) {
    f = f || {};
    var q = S(f.q).toLowerCase();
    return list.filter(function (p) {
      if (f.ta && p.ta !== f.ta) return false;
      if (f.tw && String(p.tw || 0) !== String(f.tw)) return false;
      if (f.kanwil && p.submitter !== f.kanwil) return false;
      if (f.kl && p.kl !== f.kl && p.namaKL !== f.kl && p.submitter !== f.kl) return false;
      if (f.kppn && p.kdkppn !== f.kppn) return false;
      if (f.indikator && p.indikator !== f.indikator) return false;
      if (f.status && (f.status === 'Pooling' ? !p.pooling : p.status !== f.status)) return false;
      if (f.jalur && p.jalur !== f.jalur) return false;
      if (f.jenis && p.jenis !== f.jenis) return false;
      if (!f.termasukBatal && p.dibatalkan) return false;
      if (q) {
        var hay = [p.kdsatker, p.namaSatker, p.satkerRingkasan, p.nomorND, p.submitter, p.indikator, p.namaKL, p.kdkppn].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function kpi(list) {
    var act = list.filter(function (p) { return !p.dibatalkan; }), sat = {};
    act.forEach(function (p) { if (p.kdsatker) sat[p.kdsatker] = 1; });
    var cnt = function (fn) { return act.filter(fn).length; };
    return {
      totalPengajuan: act.length,
      satkerUnik: Object.keys(sat).length,
      satkerBelumDirinci: cnt(function (p) { return !p.kdsatker && p.satkerRingkasan; }),
      disetujui: cnt(function (p) { return p.status === STATUS.DISETUJUI; }),
      ditolak: cnt(function (p) { return p.status === STATUS.DITOLAK; }),
      diproses: cnt(function (p) { return p.status === STATUS.PENDING; }),
      pooling: cnt(function (p) { return p.pooling; })
    };
  }
  function groupCount(list, keyFn) { var o = {}; list.filter(function (p) { return !p.dibatalkan; }).forEach(function (p) { var k = keyFn(p); o[k] = (o[k] || 0) + 1; }); return o; }



  /* ------------------------------------------- pratinjau duplikasi saat input
   * newItem {pengajuan, detail} ; others [{pengajuan, details[]}] (riwayat satker) ; existingExcs [exc]
   * -> [{index,row,errors,hits:[{kind:'EXCEPTION'|'PENGAJUAN', outcome, diff, exc?|pengajuan?,detail?}]}]
   * Tidak menulis apa pun. Hanya informasi bagi pengguna sebelum menyimpan. */
  function previewAgainst(newItem, others, existingExcs) {
    var ex = expandDetail(newItem.detail, newItem.pengajuan), ixE = buildIndex(existingExcs || []), pool = [];
    (others || []).forEach(function (o) {
      if (!o.pengajuan || o.pengajuan.id === newItem.pengajuan.id || o.pengajuan.dibatalkan) return;
      (o.details || []).forEach(function (d) {
        if (!TYPES[d.jenis] || d.jenis !== newItem.detail.jenis) return;
        expandDetail(d, o.pengajuan).rows.forEach(function (r) { pool.push({ r: r, p: o.pengajuan, d: d }); });
      });
    });
    return ex.rows.map(function (c, i) {
      var hits = [], excIds = {};
      var res = classify(c, ixE);
      if (res.outcome === OUTCOME.IDENTIK || res.outcome === OUTCOME.POTENSI) res.matches.forEach(function (e) { excIds[e.idKey] = 1; hits.push({ kind: 'EXCEPTION', outcome: res.outcome, exc: e, diff: res.diff }); });
      if (!c.errors.length) pool.forEach(function (o) {
        if (o.r.errors.length || o.r.jenis !== c.jenis) return;
        if (o.r.idKey === c.idKey) { if (!excIds[o.r.idKey]) hits.push({ kind: 'PENGAJUAN', outcome: OUTCOME.IDENTIK, pengajuan: o.p, detail: o.d, diff: diffRows(c.jenis, c.row, o.r.row).filter(function (d) { return !d.substantif; }) }); }
        else if (o.r.slotKey === c.slotKey) hits.push({ kind: 'PENGAJUAN', outcome: OUTCOME.POTENSI, pengajuan: o.p, detail: o.d, diff: diffRows(c.jenis, c.row, o.r.row) });
      });
      return { index: i, row: c.row, errors: c.errors, hits: hits, outcome: hits.some(function (h) { return h.outcome === OUTCOME.POTENSI; }) ? OUTCOME.POTENSI : (hits.length ? OUTCOME.IDENTIK : (c.errors.length ? OUTCOME.LENGKAPI : OUTCOME.BARU)) };
    });
  }

  /* ------------------------------------------------ pembaca workbook (SheetJS)
   * PENTING: SheetJS 0.18.5 membuang sheet secara diam-diam bila gagal menggeser rumus bersama
   * ("invalid column -7"; terjadi pada DB Oktober 2026 'Sheet1'). cellFormula:false menghindarinya,
   * dan kita hanya perlu nilai. Tanggal dibaca sebagai serial Excel/teks (tanpa konversi zona waktu). */
  function readWorkbookAoa(XLSX, data, type) {
    var wb = XLSX.read(data, { type: type || 'array', cellFormula: false, cellStyles: false, cellDates: false });
    var out = {}, names = wb.SheetNames.slice(), missing = [];
    names.forEach(function (n) {
      var ws = wb.Sheets[n];
      if (!ws) { missing.push(n); return; }
      out[n] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
    });
    return { sheets: out, names: names, missing: missing };
  }

  /* ====================================================================
   * Penyimpanan Google Sheets: kolom, konversi baris <-> pengajuan, mekanisme
   * Sumber kebenaran pengajuan = BARIS pada spreadsheet (Sheet1 + sheet per Eselon I).
   * Kolom A–S = format DB yang sudah berjalan (tidak diubah); kolom T dst = tambahan aplikasi.
   * Salinan daftar kolom ini ada di apps-script/Code.gs; tes memastikan keduanya identik.
   * ==================================================================== */
  var SHEET_MAIN = 'Sheet1';
  var SHEET_LEGACY_COLS = ['No', 'Tanggal Input', 'Nama Kanwil DJPb/Eselon I K/L', 'Nomor ND', 'Tanggal ND', 'Indikator', 'Kode Satker', 'Kode KPPN', 'Nomor Dokumen', 'Status', 'Keterangan', 'Alasan Penolakan', 'Komponen', 'Exception', 'Kronologis', 'Perbaikan/Catatan', 'K/L', 'Nama K/L', 'Satker'];
  var SHEET_APP_COLS = ['ID Pengajuan', 'Jalur', 'TA', 'TW', 'Nama Satker', 'Mekanisme Penyesuaian', 'Uraian Mekanisme', 'Detail Mekanisme (JSON)', 'Meta (JSON)', 'Diperbarui Oleh', 'Diperbarui Pada', 'Versi', 'Dipindahkan Ke'];
  var SHEET_COLS = SHEET_LEGACY_COLS.concat(SHEET_APP_COLS);

  function isoToDMY(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(iso)); return m ? m[3] + '/' + m[2] + '/' + m[1] : S(iso); }
  /** Nama sheet untuk jalur Eselon I = nama Eselon I (batas Google Sheets: <=100 karakter, tanpa [ ] * / \ ? :). */
  function eselonSheetName(name) {
    var n = S(name).replace(/[\[\]\*\/\\\?:]/g, ' ').replace(/\s+/g, ' ').replace(/^'+|'+$/g, '').trim();
    if (n.length > 100) n = n.slice(0, 100).trim();
    return n;
  }
  /** Sheet tujuan: jalur Eselon I -> sheet bernama Eselon I; selain itu (Satker / belum diverifikasi) -> Sheet1. */
  function targetSheetOf(p) {
    if (p.jalur === JALUR.ESELON_I) { var n = eselonSheetName(p.submitter); if (n && n.charAt(0) !== '_' && n.toLowerCase() !== SHEET_MAIN.toLowerCase()) return n; }
    return SHEET_MAIN;
  }

  /* ---- teks mekanisme penyesuaian (untuk tabel, riwayat, dan kolom sheet) ---- */
  var JENIS_LABEL = {
    'Deviasi': 'Deviasi Halaman III DIPA', 'Deviasi_Kegiatan': 'Deviasi Kegiatan', 'Penyerapan': 'Penyerapan Anggaran',
    'Revisi': 'Revisi DIPA', 'Belanja Kontraktual': 'Belanja Kontraktual', 'Tagihan': 'Penyelesaian Tagihan',
    'UP TUP': 'Pengelolaan UP dan TUP', 'Penyerapan_100': 'Penyerapan = 100', 'Deviasi_tertimbang': 'Deviasi Tertimbang'
  };
  function bulanRange(a, b) {
    var x = normMonth(a), y = normMonth(b);
    if (!x && !y) return '';
    if (x && (!y || x === y)) return MONTHS_ID[x - 1];
    return (x ? MONTHS_ID[x - 1] : '?') + '–' + (y ? MONTHS_ID[y - 1] : '?');
  }
  /** Contoh: "Deviasi Kegiatan — Kegiatan 7717 (Program 14506GM), Jenis belanja 52, TW2". Hanya merangkum isian; tidak menambah informasi. */
  function describeDetail(d) {
    var p = (d && d.params) || {}, j = d && d.jenis, parts = [], q = '?';
    var add = function (label, v) { var t = S(v); parts.push(label + ' ' + (t === '' ? q : t)); };
    switch (j) {
      case 'Deviasi': parts.push(S(p.periode) || 'TW ?'); if (!isBlank(p.revision_number)) parts.push('revisi ke-' + S(p.revision_number)); break;
      case 'Deviasi_Kegiatan': {
        var tws = [1, 2, 3, 4].filter(function (i) { return S(p['tw' + i]).toUpperCase() === 'Y'; }).map(function (i) { return 'TW' + i; });
        add('Kegiatan', p.kegiatan); if (!isBlank(p.program)) parts[parts.length - 1] += ' (Program ' + S(p.program) + ')';
        add('Jenis belanja', p.jenis_belanja); parts.push(tws.length ? tws.join(', ') : 'TW ?'); break;
      }
      case 'Penyerapan': add('Program', p.program); add('Output', p.output); add('Jenis belanja', p.jenis_belanja); parts.push(bulanRange(p.bulan_awal, p.bulan_akhir) || 'bulan ?'); break;
      case 'Revisi': add('Revisi ke-', p.revision_no); parts[parts.length - 1] = parts[parts.length - 1].replace('ke- ', 'ke-'); add('Jenis revisi', p.kdjnsrevisi); break;
      case 'Belanja Kontraktual': add('Kontrak', p.no_kontrak); if (!isBlank(p.tanggal_kontrak)) parts.push('tgl ' + S(p.tanggal_kontrak)); break;
      case 'Tagihan': add('SPM', p.no_spm); break;
      case 'UP TUP': add('SP2D', p.no_sp2d); break;
      case 'Penyerapan_100': parts.push(S(p.periode) || 'TW ?'); break;
      case 'Deviasi_tertimbang': add('Jenis belanja', p.jenis_belanja); parts.push(bulanRange(p.bulan_awal, p.bulan_akhir) || 'bulan ?'); break;
      default: parts.push('(jenis belum dikenal)');
    }
    var n = d && d.satkerList && d.satkerList.length;
    return (JENIS_LABEL[j] || S(j)) + ' — ' + parts.join(', ') + (n ? ' (' + n + ' satker)' : '');
  }
  function describeDetails(list) { return (list || []).map(describeDetail).join(' | '); }

  function deriveCounts(p, details) {
    var ok = 0;
    (details || []).forEach(function (d) { var ex = expandDetail(d, p); if (ex.rows.length && !ex.errors.length && ex.rows.every(function (x) { return !x.errors.length; })) ok++; });
    return { detailCount: (details || []).length, detailLengkap: ok };
  }

  /* ---- pengajuan -> sel baris ---- */
  function detailsToJson(details) {
    return JSON.stringify((details || []).map(function (d) {
      var o = { id: d.id, jenis: d.jenis, params: d.params || {}, satkerList: d.satkerList || [] };
      ['version', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'].forEach(function (k) { if (d[k] !== undefined && d[k] !== null) o[k] = d[k]; });
      return o;
    }));
  }
  /** -> {header: nilai}. Server menambah/menimpa: No, Diperbarui Oleh/Pada, Versi. Tanggal ditulis dd/mm/yyyy. */
  function recordToCells(p, details) {
    details = details || [];
    var meta = {
      twSumber: p.twSumber || '', periodeProses: p.periodeProses || '', dibatalkan: !!p.dibatalkan, alasanBatal: p.alasanBatal || '', jenis: p.jenis || '',
      createdAt: p.createdAt || '', createdBy: p.createdBy || '', sumberImpor: p.sumber && p.sumber.type === 'IMPOR' ? { file: p.sumber.file || '', fileHash: p.sumber.fileHash || '', baris: p.sumber.baris || '' } : null
    };
    var c = {};
    c['Tanggal Input'] = isoToDMY(p.tanggalInput); c['Nama Kanwil DJPb/Eselon I K/L'] = S(p.submitter); c['Nomor ND'] = S(p.nomorND); c['Tanggal ND'] = isoToDMY(p.tanggalND);
    c['Indikator'] = S(p.indikator); c['Kode Satker'] = S(p.kdsatker) || S(p.satkerRingkasan); c['Kode KPPN'] = S(p.kdkppn); c['Nomor Dokumen'] = S(p.nomorDokumen);
    c['Status'] = S(p.status); c['Keterangan'] = S(p.keterangan); c['Alasan Penolakan'] = S(p.alasanPenolakan); c['Komponen'] = S(p.komponen);
    c['Exception'] = S(p.exceptionRaw) || (details[0] ? S(details[0].jenis) : ''); c['Kronologis'] = S(p.kronologis); c['Perbaikan/Catatan'] = S(p.perbaikan);
    c['K/L'] = S(p.kl); c['Nama K/L'] = S(p.namaKL); c['Satker'] = S(p.kdsatker);
    c['ID Pengajuan'] = S(p.id); c['Jalur'] = S(p.jalur) || JALUR.BELUM; c['TA'] = S(p.ta); c['TW'] = p.tw ? String(p.tw) : ''; c['Nama Satker'] = S(p.namaSatker);
    c['Mekanisme Penyesuaian'] = S(p.mekanisme) || describeDetails(details); c['Uraian Mekanisme'] = S(p.mekanismeUraian);
    c['Detail Mekanisme (JSON)'] = details.length ? detailsToJson(details) : ''; c['Meta (JSON)'] = JSON.stringify(meta);
    return c;
  }
  /** Baris sheet -> {record, details} | {error,row}. vals sejajar dengan headers. */
  function recordFromRow(sheetName, rowNum, vals, headers, opts) {
    opts = opts || {};
    var cell = {}; headers.forEach(function (h, i) { cell[h] = vals[i] === undefined || vals[i] === null ? '' : vals[i]; });
    var dataCols = SHEET_LEGACY_COLS.slice(1);
    if (dataCols.every(function (h) { return isBlank(cell[h]); }) && isBlank(cell['ID Pengajuan'])) return null; // baris kosong
    var tglIn = normDate(cell['Tanggal Input']), ta = S(cell['TA']) || (tglIn ? tglIn.slice(6) : '');
    var aoaHead = SHEET_LEGACY_COLS.concat(['Nama Satker']), aoaRow = aoaHead.map(function (h) { return cell[h]; });
    var res = parseDbRows([aoaHead, aoaRow], { ta: ta, fileName: sheetName });
    if (!res.records.length) return { error: res.rowErrors.length ? res.rowErrors[0].errors.join('; ') : 'Baris tidak terbaca', row: rowNum, sheet: sheetName };
    var rec = res.records[0];
    rec.contentId = rec.id; rec.id = S(cell['ID Pengajuan']); if (!rec.id) { rec.id = 'T' + hash(sheetName + '|' + rowNum); rec.idTemp = true; }
    var jl = S(cell['Jalur']); rec.jalur = [JALUR.SATKER, JALUR.ESELON_I, JALUR.BELUM].indexOf(jl) > -1 ? jl : JALUR.BELUM;
    var tw = twNum(cell['TW']); var meta = {}; try { meta = cell['Meta (JSON)'] ? JSON.parse(cell['Meta (JSON)']) : {}; } catch (e) { rec.warnings.push('Kolom Meta (JSON) rusak; diabaikan'); }
    rec.tw = tw || null; rec.twSumber = tw ? (meta.twSumber || 'MANUAL') : 'BELUM';
    var details = []; try { details = cell['Detail Mekanisme (JSON)'] ? JSON.parse(cell['Detail Mekanisme (JSON)']) : []; } catch (e) { rec.warnings.push('Kolom Detail Mekanisme (JSON) rusak; detail tidak dimuat'); }
    if (!Array.isArray(details)) details = [];
    details = details.filter(function (d) { return d && d.id && d.jenis; });
    if (details.length) rec.jenis = details[0].jenis;
    rec.mekanisme = S(cell['Mekanisme Penyesuaian']); rec.mekanismeUraian = S(cell['Uraian Mekanisme']);
    rec.version = Number(cell['Versi']) || 1; rec.updatedBy = S(cell['Diperbarui Oleh']); rec.updatedAt = S(cell['Diperbarui Pada']);
    ['periodeProses', 'alasanBatal', 'createdAt', 'createdBy'].forEach(function (k) { if (meta[k]) rec[k] = meta[k]; });
    rec.dibatalkan = !!meta.dibatalkan; if (meta.jenis && !details.length) rec.jenis = rec.jenis || meta.jenis;
    if (meta.sumberImpor) rec.sumber = { type: 'IMPOR', file: meta.sumberImpor.file || '', fileHash: meta.sumberImpor.fileHash || '', baris: meta.sumberImpor.baris || '' };
    else rec.sumber = { type: 'SHEET', sheet: sheetName, baris: rowNum };
    var kd = rec.kdsatker, info = kd && opts.satkerLookup ? opts.satkerLookup(kd) : null;
    if (info) { if (!rec.namaSatker) rec.namaSatker = info.nama || ''; if (!rec.kdkppn) rec.kdkppn = info.kdkppn || ''; if (!rec.namaKL) rec.namaKL = info.kl || ''; if (!rec.kl) rec.kl = info.klKode || ''; }
    rec.sheet = sheetName; rec.row = rowNum; rec.pooling = isPooling(rec.keterangan);
    var dc = deriveCounts(rec, details); rec.detailCount = dc.detailCount; rec.detailLengkap = dc.detailLengkap;
    return { record: rec, details: details };
  }

  /* ---- impor massal: satu berkas Excel berisi banyak satker ---- */
  var BULK_BASE_FIELDS = [
    ['kode', 'Kode Satker', ['kode satker', 'kdsatker', 'satker', 'kode']], ['namaSatker', 'Nama Satker', ['nama satker', 'nmsatker', 'nama']],
    ['tw', 'Triwulan', ['triwulan', 'tw']], ['indikator', 'Indikator', ['indikator']], ['status', 'Status', ['status']],
    ['keterangan', 'Keterangan', ['keterangan', 'ket']], ['nomorDokumen', 'Nomor Dokumen', ['nomor dokumen', 'dokumen']], ['alasanPenolakan', 'Alasan Penolakan', ['alasan penolakan']]
  ];
  function paramAliases(f) {
    var a = [normHeader(f.label), String(f.key).toLowerCase(), String(f.key).toLowerCase().replace(/_/g, ' ')], m = /\(([^)]+)\)/.exec(f.label);
    if (m) a.push(m[1].toLowerCase()); return a;
  }
  /** Daftar kolom yang dikenali untuk satu jenis mekanisme: [{key,label,aliases,req}] */
  function bulkFields(jenis) {
    var out = BULK_BASE_FIELDS.map(function (b) { return { key: b[0], label: b[1], aliases: b[2], req: b[0] === 'kode' }; });
    (DETAIL_FIELDS[jenis] || []).forEach(function (f) { if (f.key === 'thang') return; out.push({ key: 'p.' + f.key, label: f.label, aliases: paramAliases(f), req: false, param: true }); });
    return out;
  }
  function detectBulkColumns(header, jenis) {
    var map = {}, used = {}, fields = bulkFields(jenis);
    fields.forEach(function (f) {
      for (var i = 0; i < header.length; i++) { if (used[i]) continue; if (f.aliases.indexOf(normHeader(header[i])) > -1) { map[f.key] = i; used[i] = 1; break; } }
    });
    return map;
  }
  /** Berkas kosong (hanya judul kolom) untuk diisi rekan: satu baris per satker. Tidak berisi data contoh. */
  function bulkTemplateAoa(jenis) { return [bulkFields(jenis).map(function (f) { return f.label; })]; }
  /** cfg: {common:{ta,tw,tanggalInput,jalur,submitter,nomorND,tanggalND,indikator,status,keterangan,nomorDokumen,alasanPenolakan,komponen,kronologis,perbaikan,mekanismeUraian},
   *        mech:{jenis,params}|null, colMap?, lookup?(kode)->info, existingIds?:{id:1}}
   * -> {rows:[{row,kode,errors,warnings,pengajuan,detail,status:'BARU'|'SUDAH_ADA'|'DUPLIKAT_BERKAS'|'TIDAK_VALID'}], map, summary} */
  function buildSatkerBatch(aoa, cfg) {
    var header = (aoa && aoa[0]) || [], jenis = cfg.mech && cfg.mech.jenis, map = cfg.colMap || detectBulkColumns(header, jenis), com = cfg.common || {};
    var res = { rows: [], map: map, missing: map.kode === undefined ? ['Kode Satker'] : [], summary: { total: 0, baru: 0, sudahAda: 0, duplikatBerkas: 0, tidakValid: 0, mekanismeBelumLengkap: 0, tidakAdaDiDb: 0 } };
    if (res.missing.length) return res;
    var seen = {}, ex0 = cfg.existingIds || {};
    for (var i = 1; i < aoa.length; i++) {
      var row = aoa[i]; if (!row || row.every(function (c) { return isBlank(c); })) continue;
      res.summary.total++;
      var g = function (k) { return map[k] === undefined ? '' : row[map[k]]; };
      var errors = [], warnings = [], ksRaw = S(g('kode')), ks = normSatker(ksRaw), kode = ks.v, info = null;
      if (!kode) errors.push('Kode satker tidak valid: "' + ksRaw + '"');
      else { if (ks.padded) warnings.push('Kode satker ' + ksRaw + ' dilengkapi nol di depan menjadi ' + kode + ' (verifikasi)'); info = cfg.lookup ? cfg.lookup(kode) : null; if (!info && cfg.lookup) { warnings.push('Kode satker tidak ditemukan pada satker_db.js (verifikasi)'); res.summary.tidakAdaDiDb++; } }
      var tw = com.tw ? +com.tw : null; if (!isBlank(g('tw'))) { var tn = twNum(g('tw')); if (!tn) errors.push('Triwulan tidak valid: "' + S(g('tw')) + '"'); else tw = tn; }
      var st = S(g('status')) || S(com.status), stNorm = st ? st.charAt(0).toUpperCase() + st.slice(1).toLowerCase() : '';
      if ([STATUS.DISETUJUI, STATUS.PENDING, STATUS.DITOLAK].indexOf(stNorm) < 0) errors.push('Status harus Disetujui / Pending / Ditolak');
      var ind = S(g('indikator')) || S(com.indikator); if (!ind) errors.push('Indikator kosong');
      var ket = isBlank(g('keterangan')) ? S(com.keterangan) : S(g('keterangan')), alasan = isBlank(g('alasanPenolakan')) ? S(com.alasanPenolakan) : S(g('alasanPenolakan'));
      if (stNorm === STATUS.DITOLAK && !alasan) errors.push('Alasan penolakan wajib untuk status Ditolak');
      var params = Object.assign({}, (cfg.mech && cfg.mech.params) || {});
      (DETAIL_FIELDS[jenis] || []).forEach(function (f) { var v = g('p.' + f.key); if (!isBlank(v)) params[f.key] = S(v); });
      var p = Object.assign({}, com, { kdsatker: kode, satkerRingkasan: '', namaSatker: info ? info.nama : '', kdkppn: info ? info.kdkppn : '', namaKL: info ? info.kl : '', kl: info ? info.klKode : '', tw: tw || null, twSumber: tw ? 'IMPOR_DEFAULT' : 'BELUM', indikator: ind, status: stNorm, keterangan: ket, alasanPenolakan: alasan, nomorDokumen: isBlank(g('nomorDokumen')) ? S(com.nomorDokumen) : S(g('nomorDokumen')), pooling: isPooling(ket), jalur: com.jalur || JALUR.BELUM });
      var key = ['BULK', S(com.ta), S(com.nomorND), S(com.tanggalND), ind, kode || ksRaw, jenis || '', JSON.stringify(params), tw || '', p.nomorDokumen].join(SEP);
      p.id = 'P' + hash(key);
      var detail = jenis ? { id: 'D' + hash(p.id + '|' + jenis), jenis: jenis, params: params, satkerList: [] } : null;
      if (detail && !errors.length) { var ex = expandDetail(detail, p); var bad = ex.errors.length + ex.rows.filter(function (r) { return r.errors.length; }).length; if (bad) { warnings.push('Mekanisme belum lengkap (' + bad + ' isian perlu dilengkapi)'); res.summary.mekanismeBelumLengkap++; } }
      var status = 'BARU';
      if (errors.length) { status = 'TIDAK_VALID'; res.summary.tidakValid++; }
      else if (seen[p.id]) { status = 'DUPLIKAT_BERKAS'; res.summary.duplikatBerkas++; }
      else if (ex0[p.id]) { status = 'SUDAH_ADA'; res.summary.sudahAda++; }
      else res.summary.baru++;
      if (!errors.length) seen[p.id] = 1;
      res.rows.push({ row: i + 1, kode: kode || ksRaw, errors: errors, warnings: warnings, pengajuan: p, detail: detail, status: status });
    }
    return res;
  }

  /* ---------------------------------------------------------- hak akses */
  var PERM = {
    baca: ['admin', 'pengelola', 'perekam', 'pembaca'],
    tulisPengajuan: ['admin', 'pengelola', 'perekam'],   // semua rekan yang terdaftar dapat merekam
    batalkanPengajuan: ['admin', 'pengelola'],
    impor: ['admin', 'pengelola', 'perekam'],
    selesaikanDuplikat: ['admin', 'pengelola'],
    bangunKandidat: ['admin', 'pengelola'],
    ekspor: ['admin', 'pengelola'],
    eksporUlang: ['admin'],
    pulihkan: ['admin'],
    kelolaPengguna: ['admin'],
    ubahKonfigurasi: ['admin']
  };
  function can(role, action) { return !!PERM[action] && PERM[action].indexOf(role) > -1; }

  return {
    S: S, hash: hash, pad: pad, clone: clone, SEP: SEP, isBlank: isBlank,
    MONTHS_ID: MONTHS_ID, STATUS: STATUS, JALUR: JALUR, OUTCOME: OUTCOME, ROLES: ROLES, INDIKATOR: INDIKATOR, OBS: OBS,
    TYPES: TYPES, SHEET_ORDER: SHEET_ORDER, UNSUPPORTED: UNSUPPORTED, DETAIL_FIELDS: DETAIL_FIELDS, DEFAULT_CONFIG: DEFAULT_CONFIG,
    normSatker: normSatker, normTW: normTW, twNum: twNum, normMonth: normMonth, normJB: normJB, normDate: normDate, dmyToISO: dmyToISO, normFlag: normFlag, normKdjns: normKdjns,
    jenisFromException: jenisFromException, jenisFromRecord: jenisFromRecord, isPooling: isPooling, isSelesai: isSelesai,
    expandDetail: expandDetail, validateRow: validateRow, keysOf: keysOf, canon: canon, diffRows: diffRows, shortKet: shortKet,
    buildIndex: buildIndex, addToIndex: addToIndex, classify: classify, eligibility: eligibility, buildPlan: buildPlan, refKeyOf: refKeyOf, makeRef: makeRef,
    summarize: summarize, exportCategory: exportCategory, sqlValue: sqlValue, sqlFormula: sqlFormula, buildExportSheets: buildExportSheets, colLetter: colLetter,
    detectColumns: detectColumns, parseDbRows: parseDbRows, parseMasterExceptionSheets: parseMasterExceptionSheets, excFromMeRow: excFromMeRow,
    suggestTW: suggestTW, suggestRevision: suggestRevision, parseDocCode: parseDocCode, suggestJalur: suggestJalur,
    twSummaryForSatker: twSummaryForSatker, compactOf: compactOf, applyFilters: applyFilters, kpi: kpi, groupCount: groupCount,
    can: can, PERM: PERM, readWorkbookAoa: readWorkbookAoa, buildWorkbook: buildWorkbook, previewAgainst: previewAgainst,
    SHEET_MAIN: SHEET_MAIN, SHEET_LEGACY_COLS: SHEET_LEGACY_COLS, SHEET_APP_COLS: SHEET_APP_COLS, SHEET_COLS: SHEET_COLS, isoToDMY: isoToDMY, eselonSheetName: eselonSheetName, targetSheetOf: targetSheetOf,
    JENIS_LABEL: JENIS_LABEL, describeDetail: describeDetail, describeDetails: describeDetails, deriveCounts: deriveCounts, recordToCells: recordToCells, recordFromRow: recordFromRow,
    bulkFields: bulkFields, detectBulkColumns: detectBulkColumns, bulkTemplateAoa: bulkTemplateAoa, buildSatkerBatch: buildSatkerBatch
  };
});
