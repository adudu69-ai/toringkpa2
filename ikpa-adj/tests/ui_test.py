"""Uji UI end-to-end di Chromium (Playwright) memakai MODE UJI LOKAL (adapter memori).
Firebase TIDAK diuji di sini. File riil dibaca dari IKPA_REF_DIR. Jalankan: python3 ui_test.py
"""
import os, sys, json, glob, re, time
from playwright.sync_api import sync_playwright, expect

REF = os.environ.get('IKPA_REF_DIR', '/root/.claude/uploads/772f4016-5cc1-545d-ac1e-dceee62cb340')
BASE = os.environ.get('IKPA_BASE', 'http://localhost:8765')
XLSX_JS = os.path.join(os.path.dirname(__file__), 'node_modules/xlsx/dist/xlsx.full.min.js')
DB = glob.glob(REF + '/5cdb7c0d-DB_Penyesuaian*.xlsx')[0]
OUT = os.environ.get('IKPA_OUT', '/tmp/ikpa_ui_out'); os.makedirs(OUT, exist_ok=True)
results = []
def check(name, cond, info=''):
    results.append((name, bool(cond), info)); print(('PASS' if cond else 'FAIL'), name, info)

def route(r):
    u = r.request.url
    if 'xlsx@0.18.5' in u: r.fulfill(path=XLSX_JS, content_type='application/javascript')
    elif 'gstatic.com/firebasejs' in u: r.fulfill(body='', content_type='application/javascript')
    elif u.startswith(BASE): r.continue_()
    elif 'fonts.googleapis.com' in u: r.fulfill(body='', content_type='text/css')
    else: r.abort()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome') if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else p.chromium.launch()
    ctx = b.new_context(accept_downloads=True, viewport={'width': 1400, 'height': 900})
    ctx.route('**/*', route)
    pg = ctx.new_page(); errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.goto(BASE + '/monitoring-ikpa.html?adapter=memory&role=admin'); pg.wait_for_selector('.tab')
    check('shell: 5 tab (admin)', pg.locator('.tab').count() == 5, pg.locator('.tab').all_inner_texts().__str__())
    check('banner mode uji tampil', 'MODE UJI' in pg.inner_text('#banner'))
    pg.wait_for_selector('#kpis'); check('dashboard kosong: pesan belum ada data', 'Belum ada pengajuan' in pg.inner_text('#pane-dash'))

    # ---- impor DB riil
    pg.click('.tab[data-tab=db]'); pg.click('#dbImp'); pg.set_input_files('#iFile', DB)
    pg.wait_for_selector('#iPrev .kpis'); txt = pg.inner_text('#iPrev')
    check('impor: pratinjau 169 baris valid', '169' in txt, txt[:120].replace('\n', ' '))
    check('impor: sheet default Sheet1', pg.input_value('#iSheet') == 'Sheet1')
    check('impor: tombol aktif', pg.is_enabled('#iGo'))
    pg.click('#iGo'); pg.wait_for_selector('.alert.s'); check('impor: 169 dibuat', '169 pengajuan baru' in pg.inner_text('.alert.s'), pg.inner_text('.alert.s'))
    pg.click('.md-h [data-x=close]')
    pg.wait_for_timeout(300)
    check('tabel: 169 pengajuan', '169 pengajuan' in pg.inner_text('#pane-db .pg'), pg.inner_text('#pane-db .pg'))
    # impor ulang idempoten
    pg.click('#dbImp'); pg.set_input_files('#iFile', DB); pg.wait_for_selector('#iPrev .kpis'); pg.click('#iGo'); pg.wait_for_selector('.alert.s')
    check('impor ulang: 0 dibuat, 169 dilewati', '0 pengajuan baru' in pg.inner_text('.alert.s') and '169 sudah ada' in pg.inner_text('.alert.s'), pg.inner_text('.alert.s'))
    pg.click('.md-h [data-x=close]')
    check('impor ulang: tetap 169', '169 pengajuan' in pg.inner_text('#pane-db .pg'))

    # ---- dashboard dari DB
    pg.click('.tab[data-tab=dash]'); pg.wait_for_selector('#kpis')
    k = pg.inner_text('#kpis'); check('dashboard: total 169', re.search(r'169\s*\n?\s*Total pengajuan', k) is not None, k.replace('\n', ' ')[:150])
    check('dashboard: TW belum ditentukan', 'Belum ditentukan' in pg.inner_text('#pane-dash'))
    # filter status
    pg.select_option('[data-f="dash.status"]', 'Pooling'); pg.wait_for_timeout(200)
    nPool = pg.inner_text('#kpis').replace('\n', ' '); check('dashboard: filter Pooling berubah angka', not nPool.startswith('169 Total'), nPool[:80])
    pg.click('[data-reset=dash]')

    # ---- bulk set TW dan jalur
    pg.click('.tab[data-tab=db]'); pg.click('#selAll'); pg.click('#bkTw'); pg.select_option('#bkV', '3'); pg.fill('#bkR', 'Berkas DB Okt memuat TW3 (dikonfirmasi pengguna uji)'); pg.click('#bkOk')
    pg.wait_for_selector('.toast div'); pg.wait_for_timeout(500)
    pg.click('.tab[data-tab=dash]'); pg.wait_for_timeout(300)
    check('bulk TW: halaman pertama (50) menjadi TW III', 'TW III' in pg.inner_text('#pane-dash'))

    # ---- form: tambah dua pengajuan identik (satker vs eselon I)
    def add_pengajuan(jalur, tgl, nd, submitter, revisi='5', ack=False):
        pg.click('.tab[data-tab=db]'); pg.click('#dbAdd'); pg.wait_for_selector('#f_ta')
        pg.select_option('#f_tw', '2'); pg.fill('#f_tanggalInput', tgl); pg.select_option('#f_jalur', jalur); pg.fill('#f_submitter', submitter); pg.fill('#f_nomorND', nd)
        pg.fill('#f_satkerQ', '999999') if False else None
        pg.fill('#f_kdsatker', '123456'); pg.select_option('#f_indikator', 'Revisi DIPA'); pg.select_option('#f_status', 'Disetujui')
        pg.select_option('#newJenis', 'Deviasi'); pg.click('#addDet')
        pg.select_option('[id$=_periode]', 'TW2'); pg.fill('[id$=_revision_number]', revisi); pg.fill('[id$=_alasan]', 'Uji UI: basis DIPA revisi ke-' + revisi)
        pg.click('#fSave')
    add_pengajuan('SATKER', '2026-03-01', 'ND-UJI-SATKER', 'Kanwil DJPb Uji')
    pg.wait_for_selector('.toast div:has-text("disimpan")'); pg.wait_for_timeout(300)
    add_pengajuan('ESELON_I', '2026-05-01', 'ND-UJI-ES1', 'Sekretariat Jenderal Uji')
    pg.wait_for_selector('#dupOut .alert.w'); t = pg.inner_text('#dupOut')
    check('form: pemeriksaan duplikasi menampilkan IDENTIK terhadap pengajuan lama', 'IDENTIK' in t and 'ND-UJI-SATKER' in t, t[:200].replace('\n', ' '))
    pg.click('#dupOk'); pg.wait_for_selector('.toast div:has-text("disimpan")'); pg.wait_for_timeout(300)
    # revisi 6 -> potensi
    add_pengajuan('ESELON_I', '2026-06-01', 'ND-UJI-ES1-R6', 'Sekretariat Jenderal Uji', revisi='6')
    pg.wait_for_selector('#dupOut .alert.w'); t = pg.inner_text('#dupOut')
    check('form: revisi 6 => POTENSI DUPLIKAT dengan selisih REVISION_NUMBER', 'POTENSI DUPLIKAT' in t and 'REVISION_NUMBER' in t, t[:200].replace('\n', ' '))
    pg.click('#dupOk'); pg.wait_for_selector('.toast div:has-text("disimpan")'); pg.wait_for_timeout(300)

    # riwayat satker pada form
    pg.click('#dbAdd'); pg.fill('#f_kdsatker', '123456'); pg.wait_for_timeout(500)
    check('form: panel riwayat satker menampilkan 3 pengajuan', pg.locator('#hist tbody tr').count() == 3, str(pg.locator('#hist tbody tr').count()))
    pg.click('.md-h [data-x=close]')

    # ---- monitoring satker
    pg.click('.tab[data-tab=sat]'); pg.fill('[data-f="sat.q"]', '123456'); pg.wait_for_timeout(500)
    check('satker: baris 123456 dengan total 3', pg.locator('#pane-sat tbody tr').count() == 1 and '3' in pg.inner_text('#pane-sat tbody tr'))
    pg.click('#pane-sat tbody tr'); pg.wait_for_selector('.md-b table'); mt = pg.inner_text('.md-b')
    check('satker: riwayat memuat dua jalur pada pengajuan identik', 'Satker' in mt and 'Eselon I' in mt)
    pg.click('.md-h [data-x=close]')

    # ---- master exception
    pg.click('.tab[data-tab=me]'); pg.fill('[data-f="me.q"]', '') if pg.locator('[data-f="me.q"]').count() else None
    pg.wait_for_selector('#mePlan'); pg.click('#mePlan'); pg.wait_for_selector('#planOut .kpis')
    pt = pg.inner_text('#planOut'); check('ME: pratinjau kandidat tampil + peringatan 169 tanpa detail', 'Identik' in pt and '169 pengajuan memenuhi kriteria status tetapi belum memiliki detail' in pt, pt.replace('\n', ' ')[:200])
    pg.screenshot(path=OUT + '/me_plan.png')
    pg.click('#meApply'); pg.fill('#askR', 'uji'); pg.click('#askOk'); pg.wait_for_selector('.toast div:has-text("Kandidat disimpan")'); pg.wait_for_timeout(600)
    check('ME: ada 1 kasus duplikasi menunggu', pg.locator('[data-case]').count() == 1, str(pg.locator('[data-case]').count()))
    cmp = pg.inner_text('[data-case]'); check('ME: panel perbandingan menampilkan REVISION_NUMBER dan jalur', 'REVISION_NUMBER' in cmp and 'Eselon I' in cmp)
    # ekspor final harus diblokir
    pg.click('#meFinal'); pg.wait_for_selector('.md-b .alert.e'); check('ME: ekspor final diblokir saat potensi duplikat', 'potensi duplikat' in pg.inner_text('.md-b').lower())
    pg.click('.md-h [data-x=close]')
    # putuskan: revisi 6 = exception baru
    pg.click('[data-a=BARU]'); pg.fill('#askR', 'Diverifikasi: memang revisi ke-6'); pg.click('#askOk'); pg.wait_for_selector('.toast div:has-text("Keputusan dicatat")'); pg.wait_for_timeout(600)
    check('ME: tidak ada kasus menunggu', pg.locator('[data-case]').count() == 0)
    ks = pg.inner_text('.kpis >> nth=-1'); 
    pg.select_option('#meTw', '2'); pg.check('#meSql'); pg.click('#mePrev'); pg.wait_for_selector('#prevOut .tw')
    pv = pg.inner_text('#prevOut'); check('ME: pratinjau menunjukkan sheet Deviasi 2 baris dan kolom SQL INSERT', 'Deviasi' in pv and 'INSERT INTO IKPA_R_EXCEPTION_RPD' in pv, pv.replace('\n', ' ')[:200])
    pg.screenshot(path=OUT + '/me_preview.png', full_page=True)
    with pg.expect_download() as dl:
        pg.click('#meFinal'); pg.fill('#askR', 'ekspor uji'); pg.click('#askOk')
    d = dl.value; path = OUT + '/' + d.suggested_filename; d.save_as(path)
    check('ME: nama berkas Master_Exception_TW2_2026_YYYYMMDD.xlsx', re.match(r'^Master_Exception_TW2_2026_\d{8}\.xlsx$', d.suggested_filename), d.suggested_filename)
    pg.wait_for_selector('.toast div:has-text("Ekspor final tercatat")'); pg.wait_for_timeout(600)
    check('ME: kandidat habis setelah ekspor (tidak diulang)', 'Belum ada kandidat' in pg.inner_text('#pane-me') or pg.locator('#pane-me td.mono').count() == 0)
    check('ME: riwayat ekspor terisi', pg.locator('#pane-me .card:last-child tbody tr').count() == 1)
    # bangun lagi -> tidak ada exception baru
    pg.click('#mePlan'); pg.wait_for_selector('#planOut .kpis'); pt = pg.inner_text('#planOut'); check('ME: bangun ulang setelah ekspor tidak membuat apa pun', 'Sudah diproses sebelumnya' in pt, pt.replace('\n', ' ')[:200])
    # admin tab
    pg.click('.tab[data-tab=admin]'); pg.wait_for_selector('#cSave'); check('admin: audit global memuat aksi ekspor_final', 'ekspor_final' in pg.inner_text('#pane-admin'))

    # mobile layout
    pg.set_viewport_size({'width': 390, 'height': 800}); pg.click('.tab[data-tab=dash]'); pg.wait_for_timeout(300)
    sw = pg.evaluate('document.documentElement.scrollWidth'); check('mobile: tidak ada scroll horizontal halaman', sw <= 392, str(sw))
    pg.screenshot(path=OUT + '/mobile_dash.png')
    check('tanpa error konsol/halaman', not errs, str(errs[:5]))

    # ---- peran pembaca
    pg2 = ctx.new_page(); pg2.goto(BASE + '/monitoring-ikpa.html?adapter=memory&role=pembaca'); pg2.wait_for_selector('.tab')
    check('pembaca: tab admin tidak ada', pg2.locator('.tab').count() == 4)
    pg2.click('.tab[data-tab=db]'); pg2.wait_for_selector('#pane-db table')
    check('pembaca: tombol tambah/impor tidak ada', pg2.locator('#dbAdd').count() == 0 and pg2.locator('#dbImp').count() == 0)
    pg2.click('.tab[data-tab=me]'); pg2.wait_for_selector('#mePlan'); check('pembaca: tidak ada tombol terapkan/ekspor final', pg2.locator('#meApply').count() == 0 and pg2.locator('#meFinal').count() == 0)
    b.close()

fails = [r for r in results if not r[1]]
print('\nRINGKASAN: %d lulus, %d gagal' % (len(results) - len(fails), len(fails)))
json.dump(results, open(OUT + '/ui_results.json', 'w'), ensure_ascii=False, indent=1)
sys.exit(1 if fails else 0)
