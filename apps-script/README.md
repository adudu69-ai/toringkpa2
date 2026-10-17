# Backend Google Sheets untuk Monitoring Penyesuaian IKPA

Database modul = **spreadsheet Google "Lo.ditpa"** (`1vbLgJnkG5IsIc0dgJCQfPrS83wYIAGM4DjZltLxfQ7U`). Form TORING menulis ke sana
**hanya lewat skrip ini** (Google Apps Script yang terikat ke spreadsheet). Tidak ada kunci/rahasia di frontend.

| Jalur pengajuan | Disimpan di |
|---|---|
| Satker, atau belum diverifikasi | sheet **`Sheet1`** (satu baris per pengajuan) |
| Eselon I / K/L | sheet bernama **nama Eselon I** (dibuat otomatis; maks. 100 karakter, karakter `[]*/\?:` dibuang; bila bentrok dengan sheet lain yang bukan sheet baku, diberi akhiran ` (DB)`) |
| Data teknis (exception, kasus duplikasi, ekspor, konfigurasi) | sheet tersembunyi `_DATA` |
| Audit (hanya ditambah) | sheet `_AUDIT` |
| Pengguna & peran | sheet `_Pengguna` |

Kolom **A–S** = format DB yang sudah berjalan (tidak diubah). Kolom **T dst** ditambahkan skrip: `ID Pengajuan, Jalur, TA, TW, Nama Satker,
Mekanisme Penyesuaian, Uraian Mekanisme, Detail Mekanisme (JSON), Meta (JSON), Diperbarui Oleh, Diperbarui Pada, Versi, Dipindahkan Ke`.
Baris lama tanpa `ID Pengajuan` diberi ID saat pertama dibaca; TW/jalur yang kosong **tidak ditebak** (jalur = "belum diverifikasi").
Jangan menghapus kolom T dst. Baris boleh diedit manual di spreadsheet; tekan **↻ Muat ulang dari spreadsheet** di modul sesudahnya.

## Pemasangan (sekali, oleh pemilik spreadsheet — akun yang punya akses edit)

1. Buka spreadsheet → **Ekstensi → Apps Script**. Hapus isi `Code.gs` bawaan, tempel isi `apps-script/Code.gs`.
2. **Project Settings → Show "appsscript.json" manifest file**; ganti isinya dengan `apps-script/appsscript.json`.
3. Simpan, lalu muat ulang spreadsheet. Menu **IKPA** muncul → **Siapkan database (sekali)** (membuat sheet `_Pengguna`, `_DATA`, `_AUDIT`, menambah kolom T dst; setuju otorisasi Google).
4. Menu **IKPA → Tetapkan admin…**: isi email admin (pisahkan koma). Admin lain/rekan dapat ditambah kemudian di tab **Admin & Audit** modul, atau langsung di sheet `_Pengguna`.
5. **Deploy → New deployment → Web app**: *Execute as* = **Me**, *Who has access* = **Anyone**. (Browser tidak dapat mengirim cookie Google ke skrip; keamanan ditegakkan oleh token login pada tiap permintaan, bukan oleh pembatasan URL.) Salin URL berakhiran `/exec`.
6. Tempel URL itu ke `WEBAPP_URL` di `ikpa-adj/config.js`, commit, dan publikasikan situs.
7. Firebase Console → Authentication: **Google = Enabled**, dan *Authorized domains* memuat domain situs TORING.
8. Setelah mengubah `Code.gs` di kemudian hari: **Deploy → Manage deployments → Edit → New version** (URL tetap).

## Peran
| Peran | Lihat | Rekam / ubah / impor | Batalkan, pulihkan, bangun kandidat, putuskan duplikasi, ekspor | Pengguna & pengaturan |
|---|:-:|:-:|:-:|:-:|
| admin | ✔ | ✔ | ✔ | ✔ |
| pengelola | ✔ | ✔ | ✔ | – |
| perekam (rekan yang menginput) | ✔ | ✔ | – | – |
| pembaca | ✔ | – | – | – |
| nonaktif | ditolak | | | |

`_Pengguna` kolom A = email, `@domain.go.id` (semua akun domain), atau `*` (semua akun Google); B = peran; C = nama; D = catatan. Pencocokan: email persis > domain > `*`.
Peran **selalu ditentukan server**; peran yang dikirim klien diabaikan. Pembatasan "perekam tidak boleh membatalkan/ekspor" di sisi server berlaku untuk tulis ke data teknis (`exception`, `export`, `dedup*`, `config`); pembatalan pengajuan oleh perekam hanya dicegah di UI (terjadi sebagai perubahan baris biasa) — tercatat di audit.

## Keamanan & batasan
* Setiap permintaan membawa token Firebase pengguna; skrip memverifikasinya ke `identitytoolkit.googleapis.com` (kunci web Firebase bersifat publik) dan memakai email hasil verifikasi — bukan email kiriman klien — untuk peran dan audit.
* Skrip berjalan sebagai pemilik (mengubah spreadsheet atas nama pemilik). Siapa pun yang tidak terdaftar ditolak (`FORBIDDEN`).
* Semua tulis memakai kunci skrip (satu penulis sekaligus) dan versi baris (`Versi`): bila dua rekan mengedit baris yang sama, yang kedua ditolak dan data dimuat ulang. Tidak ada baris yang dihapus otomatis; ganti jalur memindahkan baris (kolom `Dipindahkan Ke` pada baris lama).
* Kuota harian dan batas waktu eksekusi Apps Script berlaku (lihat dokumentasi Google untuk jenis akun Anda). Satu simpan form = satu permintaan tulis; impor banyak satker dikirim dalam beberapa paket.
* Hasil uji otomatis memakai tiruan SpreadsheetApp (`ikpa-adj/tests/mock_sheets.js`); **belum diuji pada Google sungguhan** — lihat `docs/MODUL_IKPA_ADJ.md` §6.
