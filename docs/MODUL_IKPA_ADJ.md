# Modul Monitoring Penyesuaian IKPA & Master Exception

Menu TORING → **Monitoring Penyesuaian IKPA** (`monitoring-ikpa.html`, kode di folder `ikpa-adj/`).

## 1. Prinsip yang ditegakkan

| Aturan | Cara ditegakkan |
|---|---|
| Database utama bukan `localStorage` | Semua data di Firebase Realtime Database, simpul `ikpa_adj/` (`store.js` → `RtdbAdapter`). Tidak ada `localStorage` yang dipakai. |
| Tidak ada data contoh/dummy | Dashboard dan tabel hanya menghitung dari database. Fixture hanya ada di folder `tests/` dan tidak pernah dimuat aplikasi. Mode memori hanya aktif di `localhost` dengan `?adapter=memory` dan menampilkan banner “MODE UJI”. |
| Mapping kolom tidak dikarang | `core.js` → `TYPES` diturunkan dari header & isi file referensi; diuji terhadap file riil (tes A4, A7, A8; LibreOffice). |
| Tanpa secret di frontend | Hanya konfigurasi web Firebase publik (sama dengan `index.html`). Tidak ada service-account key. Otorisasi: Firebase Auth (Google) + aturan database. |
| Tidak mengklaim terhubung ke MyIntress | Modul hanya menghasilkan berkas Excel; tidak ada integrasi API. Kolom SQL INSERT hanya rumus Excel. |
| Tidak menghapus “duplikat” otomatis | Identik → hanya **ditautkan** (referensi pengajuan ditambah). Potensi duplikat → kasus yang harus diputuskan pengguna. Pengajuan administratif tidak pernah dihapus (hanya `dibatalkan`). |
| Triwulan/jalur tidak ditebak | `tw` kosong dan `jalur = BELUM_DIVERIFIKASI` saat impor; saran hanya ditampilkan, diterapkan hanya atas keputusan pengguna (dengan alasan, tercatat audit). |
| Struktur tabel teknis tidak diubah | Modul hanya menulis ke simpul `ikpa_adj/`; simpul modul lain tidak disentuh. |
| Modul lain tetap jalan | `index.html` hanya ditambah satu tombol menu, satu entri judul, satu entri pencarian. |

## 2. Arsitektur

```
index.html ── iframe ──> monitoring-ikpa.html
                           ├─ ikpa-adj/core.js    logika murni (tanpa I/O): normalisasi, kunci dedup, validasi, kandidat, ekspor, parser
                           ├─ ikpa-adj/store.js   akses data (RtdbAdapter | MemoryAdapter), hak akses, audit, transaksi multi-path
                           ├─ ikpa-adj/ui-*.js    Dashboard, Database, Monitoring Satker, Master Exception, Admin
                           └─ ikpa-adj/app.css    tema terang TORING
```
`core.js` dan `store.js` berjalan di browser dan Node (dipakai oleh tes).

## 3. Skema database (`ikpa_adj/`)

| Simpul | Isi |
|---|---|
| `users/{uid}` | `{role: admin|pengelola|pembaca, name, email}` |
| `config/bootstrapped`, `config/settings` | penanda admin pertama; kriteria kelayakan ekspor |
| `pengajuan/{pid}` | pengajuan administratif lengkap (ID stabil `P…`; `version` untuk deteksi konflik) |
| `pengajuan_idx/{ta}/{pid}` | proyeksi ringkas untuk daftar/dashboard |
| `by_satker/{kdsatker}/{pid}` | indeks riwayat satker lintas TA |
| `detail/{pid}/{did}` | detail exception (banyak per pengajuan): `jenis`, `params`, `satkerList` |
| `exception/{thang}/{kdsatker}/{excId}` | exception teknis = satu baris Master Exception; `idKey`, `slotKey`, `row`, `refs` (banyak pengajuan), `st`, `exportedIn` |
| `exc_open/…`, `exc_by_pengajuan/{pid}/{excId}` | indeks kandidat belum diekspor; penelusuran pengajuan → exception |
| `dedup_case/{id}`, `dedup_open/{id}` | kasus potensi duplikat, keputusan pengguna |
| `export/{id}` | ledger ekspor final (berkas, pengguna, jumlah, checksum, ID exception) |
| `import_log/*`, `audit/{tipe}/{id}/*`, `audit_global/*` | log impor; audit (append-only oleh aturan) |

### Hak akses
| Aksi | admin | pengelola | pembaca |
|---|:-:|:-:|:-:|
| Lihat | ✔ | ✔ | ✔ |
| Tambah/ubah/batalkan pengajuan, impor, bangun kandidat, putuskan duplikasi, ekspor final | ✔ | ✔ | – |
| Pulihkan pengajuan, ekspor ulang, kelola pengguna, ubah pengaturan | ✔ | – | – |

Penegakan berlapis: (1) aturan database (`database.rules.ikpa_adj.json`) — role kasar, audit append-only, hanya admin untuk `users`/`config/settings`; (2) `store.js` — aturan halus (ekspor ulang hanya admin + alasan, validasi, versi). **Aturan database belum diuji di emulator** (lihat §7).

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

1. **Database Pengajuan → Impor Excel** (DB Penyesuaian IKPA). Pratinjau, pemetaan kolom, idempoten.
2. Lengkapi TW / jalur (massal atau per pengajuan) dan **detail exception** (bagian 4 pada form).
3. **Master Exception → Pratinjau kandidat → Terapkan**. Hasil: baru / identik (ditautkan) / potensi duplikat / perlu dilengkapi, plus daftar “tidak memenuhi kriteria” dan “mapping belum tersedia”.
4. Putuskan setiap potensi duplikat (hubungkan / baru / perlu pemeriksaan) dengan alasan.
5. **Pratinjau ekspor** → **Ekspor final** (diblokir bila ada potensi duplikat/belum lengkap). Nama berkas: `Master_Exception_TW{n}_{TA}_{YYYYMMDD}.xlsx` (TW dipilih pengguna).
6. **Rekonsiliasi**: muat berkas ME historis agar tidak diekspor ulang.

## 6. Menjalankan & menguji

```bash
# statis; cukup buka lewat server web (jangan file://) 
python3 -m http.server 8765        # di root repo
# mode uji lokal (memori, bukan produksi):
http://localhost:8765/monitoring-ikpa.html?adapter=memory&role=admin   # role=pengelola|pembaca

# tes logika + penyimpanan + file riil
cd ikpa-adj/tests && npm install && IKPA_REF_DIR=/folder/berkas/referensi npm test

# tes UI (Chromium/Playwright Python)
IKPA_REF_DIR=/folder/berkas/referensi python3 ui_test.py
```
Tes yang memakai berkas riil **dilewati (skip)** bila `IKPA_REF_DIR` tidak berisi berkasnya; skip bukan lulus.

## 7. Aktivasi Firebase (wajib dilakukan pemilik project)

1. Firebase Console → Authentication → Sign-in method → **Google = Enabled**; Authorized domains memuat `adudu69-ai.github.io`.
2. Realtime Database → Rules: gabungkan isi `ikpa-adj/database.rules.ikpa_adj.json` (simpul `ikpa_adj`) ke aturan yang ada. Uji dengan Rules Playground terlebih dulu.
3. Buka modul, masuk dengan Google, tekan **Jadikan saya admin pertama** (hanya muncul bila belum ada admin). Tambahkan pengguna lain di tab *Admin & Audit* memakai UID yang ditampilkan pada layar “Akun belum terdaftar”.

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
