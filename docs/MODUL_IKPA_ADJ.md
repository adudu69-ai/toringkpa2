# Modul Monitoring Penyesuaian IKPA & Master Exception

Menu TORING → **Monitoring Penyesuaian IKPA** (`monitoring-ikpa.html`, kode di folder `ikpa-adj/`).

## 1. Prinsip yang ditegakkan

| Aturan | Cara ditegakkan |
|---|---|
| Database utama bukan `localStorage` | Semua data di **Google Spreadsheet "Lo.ditpa"** lewat Apps Script (`apps-script/Code.gs`, `sheets-adapter.js`). Pengajuan = baris `Sheet1` / sheet Eselon I; data teknis di `_DATA`; audit di `_AUDIT`. Tidak ada `localStorage`. Firebase hanya untuk login Google. |
| Tidak ada data contoh/dummy | Dashboard dan tabel hanya menghitung dari database. Fixture hanya ada di folder `tests/` dan tidak pernah dimuat aplikasi. Mode memori hanya aktif di `localhost` dengan `?adapter=memory` dan menampilkan banner “MODE UJI”. |
| Mapping kolom tidak dikarang | `core.js` → `TYPES` diturunkan dari header & isi file referensi; diuji terhadap file riil (tes A4, A7, A8; LibreOffice). |
| Tanpa secret di frontend | Hanya konfigurasi web Firebase publik (sama dengan `index.html`) dan URL web app. Tidak ada service-account key. Otorisasi: token Firebase diverifikasi **server** (Apps Script) pada tiap permintaan + peran di sheet `_Pengguna`. |
| Tidak mengklaim terhubung ke MyIntress | Modul hanya menghasilkan berkas Excel; tidak ada integrasi API. Kolom SQL INSERT hanya rumus Excel. |
| Tidak menghapus “duplikat” otomatis | Identik → hanya **ditautkan** (referensi pengajuan ditambah). Potensi duplikat → kasus yang harus diputuskan pengguna. Pengajuan administratif tidak pernah dihapus (hanya `dibatalkan`). |
| Triwulan/jalur tidak ditebak | `tw` kosong dan `jalur = BELUM_DIVERIFIKASI` saat impor; saran hanya ditampilkan, diterapkan hanya atas keputusan pengguna (dengan alasan, tercatat audit). |
| Struktur tabel teknis tidak diubah | Kolom A–S `Sheet1` tidak diubah; modul hanya **menambah** kolom T dst dan sheet `_Pengguna/_DATA/_AUDIT` (dan sheet Eselon I). Simpul Firebase modul lain tidak disentuh. |
| Modul lain tetap jalan | `index.html` hanya ditambah satu tombol menu, satu entri judul, satu entri pencarian. |

## 2. Arsitektur

```
index.html ── iframe ──> monitoring-ikpa.html
                           ├─ ikpa-adj/core.js           logika murni (normalisasi, kunci dedup, validasi, kandidat, ekspor, parser, pemetaan baris<->pengajuan, impor banyak satker)
                           ├─ ikpa-adj/store.js          hak akses, audit, transaksi multi-path (adapter: SheetsAdapter | MemoryAdapter [uji lokal])
                           ├─ ikpa-adj/sheets-adapter.js klien web app; menurunkan indeks (per TA, per satker) dari baris
                           ├─ ikpa-adj/config.js         WEBAPP_URL (alamat web app), SHEET_URL
                           ├─ ikpa-adj/ui-*.js           Dashboard, Database, Monitoring Satker, Master Exception, Admin
                           └─ ikpa-adj/app.css
Login: Firebase Auth (Google) ──ID token──> Apps Script (apps-script/Code.gs) ──> Google Spreadsheet
```
`core.js` dan `store.js` berjalan di browser dan Node (dipakai oleh tes). Pemasangan backend: [`apps-script/README.md`](../apps-script/README.md).

## 3. Penyimpanan di spreadsheet

| Lokasi | Isi |
|---|---|
| `Sheet1` | pengajuan jalur Satker / Belum diverifikasi, satu baris per pengajuan. Kolom A–S = format DB berjalan; T dst = `ID Pengajuan, Jalur, TA, TW, Nama Satker, Mekanisme Penyesuaian, Uraian Mekanisme, Detail Mekanisme (JSON), Meta (JSON), Diperbarui Oleh, Diperbarui Pada, Versi, Dipindahkan Ke` |
| sheet bernama Eselon I | pengajuan jalur Eselon I (kolom sama; sheet dibuat otomatis) |
| `_DATA` (tersembunyi) | dokumen JSON teknis: `exception`, `exc_open`, `exc_by_pengajuan`, `dedup_case`, `dedup_open`, `export`, `import_log`, `config` |
| `_AUDIT` | log hanya-tambah (identitas = email dari token terverifikasi), plus audit per baris yang ditulis |
| `_Pengguna` | email / `@domain` / `*` → peran |

**Mekanisme penyesuaian** (mis. *Deviasi Kegiatan — Kegiatan 7717, Jenis belanja 52, TW 2*) = "detail exception" milik pengajuan: jenis + parameter terstruktur, disimpan sebagai JSON (`Detail Mekanisme (JSON)`) dan sebagai teks terbaca (`Mekanisme Penyesuaian`); teks bebas di `Uraian Mekanisme`. Riwayat satker lintas TW/tahun menampilkan mekanisme tiap pengajuan.

### Hak akses
| Aksi | admin | pengelola | perekam | pembaca |
|---|:-:|:-:|:-:|:-:|
| Lihat | ✔ | ✔ | ✔ | ✔ |
| Tambah/ubah pengajuan, impor (DB, daftar satker) | ✔ | ✔ | ✔ | – |
| Batalkan/pulihkan pengajuan, bangun kandidat, putuskan duplikasi, ekspor final | ✔ | ✔ | – (UI) | – |
| Ekspor ulang, kelola pengguna, ubah pengaturan | ✔ | – | – | – |

Penegakan berlapis: (1) **server** (Apps Script) memverifikasi token, menentukan peran, menolak tulis oleh pembaca/tak terdaftar, membatasi tulis data teknis & pengguna per peran, dan menulis identitas audit; (2) `store.js` — aturan halus (ekspor ulang hanya admin + alasan, validasi, versi). Pembatasan batal/pulihkan untuk *perekam* hanya di UI/`store.js` (server memperlakukannya sebagai tulis baris biasa).

## 4. Kunci deduplikasi per jenis exception

Diturunkan dari template dan data (file ME Maret, Juni, Juli–Agustus, Agustus, September, Oktober + DB Oktober). *ID* = identitas penuh (sama → IDENTIK); *Slot* = kombinasi yang secara logika hanya boleh satu (sama slot tetapi ID beda → POTENSI_DUPLIKAT).

| Sheet (tabel target) | ID | Slot |
|---|---|---|
| Deviasi (IKPA_R_EXCEPTION_RPD) | THANG, KDSATKER, PERIODE, REVISION_NUMBER | THANG, KDSATKER, PERIODE |
| Deviasi_Kegiatan (…RPD_DETAIL) | THANG, KDSATKER, KDPROGRAM, KDKEGIATAN, JENIS BELANJA, TW1–TW4_FLAG | tanpa flag |
| Penyerapan (…PENYERAPAN_2026) | THANG, PERIOD_NUM, KDSATKER, PROGRAM, OUTPUT, JNS_BELANJA | THANG, PERIOD_NUM, KDSATKER, JNS_BELANJA |
| Revisi (…REVISI_2026) | THANG, KDSATKER, REVISION_NO, KDJNSREVISI (himpunan terurut) | THANG, KDSATKER, REVISION_NO |
| Belanja Kontraktual (…KONTRAK_2026) | THANG, KDSATKER, NO_KONTRAK, TANGGAL_KONTRAK, TAG_FLAG (kolom ID bukan kunci) | THANG, KDSATKER, NO_KONTRAK |
| Tagihan (…KESALAHAN_SPM_2026) | THANG, NO_SPM | sama |
| UP TUP (…UPTUP_2026) | THANG, NO_SP2D, KD_SATKER, TGL_SP2D | THANG, NO_SP2D |
| Penyerapan_100 (…TOTAL_SERAP_TIMBANG_2026) | THANG, KDSATKER, PERIODE | sama |
| Deviasi_tertimbang (IKPA_EXCEPTION_DEVIASI_TERTIMBANG) | THANG, KDSATKER, BULAN, JENIS BELANJA | sama |

Bukan kunci: tanggal pengajuan, nomor ND, jalur, ID pengajuan, ALASAN/KET.
Baris dengan data belum lengkap tidak pernah digabung otomatis: jika cocok sebagian dengan exception existing → POTENSI_DUPLIKAT; jika tidak → *perlu dilengkapi*.

Alur: `Detail pengajuan → expandDetail → classify(IDENTIK | POTENSI_DUPLIKAT | EXCEPTION_BARU | perlu dilengkapi)`. Ekspor: satu baris per `excId`; ID exception = hash kunci ID (stabil, dapat ditelusuri dari kedua pengajuan).

## 5. Alur kerja pengguna

1. **Merekam**: *Tambah pengajuan* (bagian 4 = mekanisme penyesuaian: jenis, kegiatan, jenis belanja, TW, dst.), atau **Impor daftar satker (Excel)** — satu berkas berisi banyak satker; data pengajuan & mekanisme diisi sekali, kolom Excel menimpa per satker; templat kosong dapat diunduh. Atau **Impor Excel format DB**. Semua dengan pratinjau, pemetaan kolom, dan idempoten.
2. Lengkapi TW / jalur (massal atau per pengajuan) dan **detail exception** (bagian 4 pada form).
3. **Master Exception → Pratinjau kandidat → Terapkan**. Hasil: baru / identik (ditautkan) / potensi duplikat / perlu dilengkapi, plus daftar “tidak memenuhi kriteria” dan “mapping belum tersedia”.
4. Putuskan setiap potensi duplikat (hubungkan / baru / perlu pemeriksaan) dengan alasan.
5. **Pratinjau ekspor** → **Ekspor final** (diblokir bila ada potensi duplikat/belum lengkap). Nama berkas: `Master_Exception_TW{n}_{TA}_{YYYYMMDD}.xlsx` (TW dipilih pengguna).
6. **Rekonsiliasi**: muat berkas ME historis agar tidak diekspor ulang.

## 6. Menjalankan & menguji

```bash
python3 -m http.server 8765        # di root repo (jangan file://)
# mode uji lokal (memori, bukan produksi):
http://localhost:8765/monitoring-ikpa.html?adapter=memory&role=admin   # role=admin|pengelola|perekam|pembaca

cd ikpa-adj/tests && npm install
IKPA_REF_DIR=/folder/berkas/referensi npm test      # core/store (ikpa-adj.test.js) + backend Sheets pada tiruan (sheets.test.js)
IKPA_REF_DIR=/folder/berkas/referensi python3 ui_test.py   # UI, mode memori (Playwright)
python3 ui_sheets_test.py                                   # UI -> web app tiruan (mock_server.js menjalankan Code.gs)
```
Tes berkas riil **dilewati (skip)** bila `IKPA_REF_DIR` tidak berisi berkasnya; skip bukan lulus.

**Yang dibuktikan tes:** logika `Code.gs` (pembacaan baris lama, penulisan kolom, nama sheet Eselon I, pemindahan baris, konflik versi, peran, audit, nol di depan, tanggal) dijalankan apa adanya di atas tiruan SpreadsheetApp, serta UI end-to-end ke tiruan itu.
**Yang BELUM terbukti:** perilaku Google sungguhan (penguraian sel, kuota, latensi, CORS web app), verifikasi token Firebase sungguhan (`identitytoolkit`), dan login Google. Uji asap pada spreadsheet salinan sebelum dipakai rekan.

## 7. Aktivasi (wajib dilakukan pemilik spreadsheet)

Ikuti [`apps-script/README.md`](../apps-script/README.md): pasang `Code.gs`, **Siapkan database**, tetapkan admin, deploy web app, isi `WEBAPP_URL` di `ikpa-adj/config.js`, aktifkan Google sign-in di Firebase Authentication. Tanpa `WEBAPP_URL`, modul hanya menampilkan petunjuk pemasangan (tidak ada data).

## 8. Temuan teknis yang perlu diketahui

* SheetJS 0.18.5 **membuang sheet secara diam-diam** bila gagal menggeser rumus bersama (terjadi pada `Sheet1` DB Oktober 2026: “invalid column -7”). Modul memakai `readWorkbookAoa` (`cellFormula:false`); jangan membaca berkas DB dengan `XLSX.read` biasa. Tes A1 mengunci perilaku ini.
* KDSATKER pada berkas ME asli bertipe angka, kecuali beberapa sel bertipe teks; ekspor modul menulis angka bila tanpa nol di depan dan teks bila berawalan nol. Hasil SQL identik.
* Kolom ID “Belanja Kontraktual” dibuat ulang 1..n mengikuti urutan ekspor (seperti template).

## 9. Belum dapat dipastikan dari berkas rujukan (tidak ditebak)

* Apakah tabel Oracle mengizinkan >1 baris per *slot* dan apakah perubahan flag diterapkan sebagai INSERT atau UPDATE.
* Makna `TAG_FLAG`, asal nilai `ID` Kontraktual, makna `LOGIC_BARU` (hanya “no” teramati), format kode jenis revisi bertitik (mis. `211.239`).
* Jalur pengajuan, TA/TW, nomor revisi, program/KRO/jenis belanja **tidak ada** pada DB historis → impor menghasilkan pengajuan dengan detail “perlu dilengkapi”.
* Template *Deviasi PPR Terpusat* hanya ada pada template Juni → ditandai “mapping belum tersedia” (tidak dibuat).
* Kebijakan Pooling saat ekspor (dibuat sebagai pengaturan; bawaan = ikut diekspor — **perlu konfirmasi**).
* Salinan ME September mana yang kanonik (ada beberapa versi berbeda ukuran).
