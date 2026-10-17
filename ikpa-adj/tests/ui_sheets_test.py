"""Uji UI end-to-end dengan backend Sheets TIRUAN (mock_server.js menjalankan Code.gs). Login Google/Firebase TIDAK diuji.
Jalankan: python3 ui_sheets_test.py  (butuh http.server di root repo pada :8765; server tiruan dijalankan skrip ini)"""
import os, sys, json, subprocess, time, urllib.request, tempfile, re
from playwright.sync_api import sync_playwright
BASE = os.environ.get('IKPA_BASE', 'http://localhost:8765'); PORT = 8799; WEB = f'http://localhost:{PORT}/'
XLSX_JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'node_modules/xlsx/dist/xlsx.full.min.js')
results = []
def check(n, c, i=''):
    results.append((n, bool(c))); print(('PASS' if c else 'FAIL'), n, i)
def dump(sheet):
    return json.load(urllib.request.urlopen(WEB + '__dump?sheet=' + urllib.parse.quote(sheet)))
import urllib.parse
srv = subprocess.Popen(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock_server.js'), str(PORT)], stdout=subprocess.PIPE)
srv.stdout.readline()
def route(r):
    u = r.request.url
    if 'xlsx@0.18.5' in u: r.fulfill(path=XLSX_JS, content_type='application/javascript')
    elif 'gstatic.com/firebasejs' in u: r.fulfill(body='', content_type='application/javascript')
    elif u.startswith(BASE) or u.startswith(WEB): r.continue_()
    elif 'fonts.googleapis.com' in u: r.fulfill(body='', content_type='text/css')
    else: r.abort()
def url(tok): return f'{BASE}/monitoring-ikpa.html?webapp={urllib.parse.quote(WEB)}&testtoken={tok}'
try:
    # berkas Excel banyak satker (sintetis, hanya untuk tes)
    import openpyxl
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Satker'
    ws.append(['Kode Satker', 'Kode Kegiatan', 'Program', 'Jenis Belanja', 'Triwulan'])
    for r in [('012345', '7717', '14506GM', '52', None), ('000017', '7718', '14506GM', '53', 3), ('000017', '7718', '14506GM', '53', 3), ('XYZ', None, None, None, None)]: ws.append(list(r))
    xl = os.path.join(tempfile.mkdtemp(), 'banyak_satker.xlsx'); wb.save(xl)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome') if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1400, 'height': 900}); ctx.route('**/*', route)
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))

        # ---- perekam
        pg.goto(url('tk-rek')); pg.wait_for_selector('.tab'); pg.wait_for_selector('#pane-dash #kpis')
        check('perekam: chip peran', 'perekam' in pg.inner_text('#who'), pg.inner_text('#who')[:80])
        check('perekam: tab admin tidak ada', pg.locator('.tab').count() == 4)
        pg.click('.tab[data-tab=db]'); pg.wait_for_selector('#dbAdd'); pg.wait_for_timeout(300)
        check('perekam: 2 baris lama dari spreadsheet tampil', '2 pengajuan' in pg.inner_text('#pane-db .pg'), pg.inner_text('#pane-db .pg'))
        check('perekam: tombol Tambah & Impor daftar satker ada', pg.locator('#dbAdd').count() == 1 and pg.locator('#dbBulk').count() == 1)
        check('perekam: tombol muat ulang dari spreadsheet', pg.locator('#btnSync').count() == 1)
        check('kolom Mekanisme penyesuaian ada di tabel', 'mekanisme penyesuaian' in pg.inner_text('#pane-db').lower())

        # ---- rekam via form, jalur Satker + mekanisme Deviasi Kegiatan
        pg.click('#dbAdd'); pg.wait_for_selector('#fSave')
        check('form: bagian Mekanisme penyesuaian', 'mekanisme penyesuaian' in pg.inner_text('.md').lower())
        pg.select_option('#f_ta', '2026'); pg.select_option('#f_tw', '2'); pg.fill('#f_tanggalInput', '2026-10-17'); pg.select_option('#f_jalur', 'SATKER')
        pg.fill('#f_submitter', 'Kanwil DJPb Provinsi Uji'); pg.fill('#f_nomorND', 'ND-1/UJI/2026')
        pg.fill('#f_satkerQ', '000017'); pg.wait_for_selector('#acl .ac-i, #acl div', state='attached'); pg.locator('#acl > *').first.click()
        pg.select_option('#f_indikator', 'Deviasi Halaman III DIPA')
        pg.fill('#f_mekanismeUraian', 'Percepatan kegiatan prioritas')
        pg.select_option('#newJenis', 'Deviasi_Kegiatan'); pg.click('#addDet'); pg.wait_for_selector('#dets [data-k]')
        keys = pg.eval_on_selector_all('#dets [data-k]', 'els=>els.map(e=>e.dataset.k)'); print('  kolom mekanisme di form:', keys)
        def setk(k, v):
            el = pg.locator(f'#dets [data-k="{k}"]').first
            if el.evaluate('e=>e.tagName') == 'SELECT': el.select_option(v)
            else: el.fill(v)
        setk('program', '14506GM'); setk('kegiatan', '7717'); setk('jenis_belanja', '52'); setk('tw2', 'Y')
        check('form: petunjuk sheet tujuan = Sheet1', 'Sheet1' in pg.inner_text('#sheetHint'), pg.inner_text('#sheetHint'))
        pg.click('#fSave'); pg.wait_for_selector('#fSave', state='detached', timeout=15000); pg.wait_for_timeout(500)
        t = dump('Sheet1'); h = t[0]; row = t[-1]
        check('rekam: baris baru di Sheet1', len(t) == 4, str(len(t)))
        check('rekam: kode satker "000017" (nol di depan terjaga)', row[h.index('Kode Satker')] == '000017', row[h.index('Kode Satker')])
        mek = row[h.index('Mekanisme Penyesuaian')]; check('rekam: kolom mekanisme memuat kegiatan, jenis belanja, TW', all(x in mek for x in ['7717', '52']) and ('TW' in mek or 'riwulan' in mek), mek)
        check('rekam: uraian bebas tersimpan', row[h.index('Uraian Mekanisme')] == 'Percepatan kegiatan prioritas')
        check('rekam: identitas penyimpan dari token', row[h.index('Diperbarui Oleh')] == 'rekan@x.id')
        check('tabel menampilkan mekanisme baru', '7717' in pg.inner_text('#pane-db'))

        # ---- jalur Eselon I -> sheet baru
        pg.click('#dbAdd'); pg.wait_for_selector('#fSave')
        pg.select_option('#f_ta', '2026'); pg.fill('#f_tanggalInput', '2026-10-17'); pg.select_option('#f_jalur', 'ESELON_I')
        pg.fill('#f_submitter', 'Kementerian Uji Coba'); pg.fill('#f_nomorND', 'ND-E1/2026'); pg.fill('#f_satkerRingkasan', 'Seluruh satker K/L')
        pg.select_option('#f_indikator', 'Revisi DIPA')
        check('form: petunjuk sheet = nama Eselon I', 'Kementerian Uji Coba' in pg.inner_text('#sheetHint'), pg.inner_text('#sheetHint'))
        pg.click('#fSave'); pg.wait_for_selector('#fSave', state='detached', timeout=15000); pg.wait_for_timeout(500)
        sheets = json.load(urllib.request.urlopen(WEB + '__sheets')); check('sheet Eselon I dibuat otomatis', 'Kementerian Uji Coba' in sheets, str(sheets))
        check('Sheet1 tidak bertambah untuk jalur Eselon I', len(dump('Sheet1')) == 4)

        # ---- impor banyak satker
        pg.click('#dbBulk'); pg.wait_for_selector('#b_file')
        pg.select_option('#b_ta', '2026'); pg.select_option('#b_jalur', 'SATKER'); pg.fill('#b_submitter', 'Kanwil DJPb Provinsi Uji'); pg.fill('#b_nomorND', 'ND-BULK/2026')
        pg.fill('#b_tanggalInput', '2026-10-17'); pg.select_option('#b_indikator', 'Deviasi Halaman III DIPA'); pg.fill('#b_uraian', 'Impor massal')
        pg.select_option('#b_jenis', 'Deviasi_Kegiatan')
        pg.set_input_files('#b_file', xl); pg.wait_for_selector('#bPrev .kpis')
        txt = pg.inner_text('#bPrev').replace('\n', ' '); print('  ', txt[:260])
        check('impor banyak: 4 baris terbaca, 2 baru, 1 ganda dalam berkas, 1 tidak valid', re.search(r'4\s*Baris terbaca', txt) and re.search(r'2\s*Akan dibuat', txt) and re.search(r'1\s*Ganda dalam berkas', txt) and re.search(r'1\s*Tidak valid', txt), txt[:200])
        check('impor banyak: tombol aktif', pg.is_enabled('#b_go'))
        pg.click('#b_go'); pg.wait_for_selector('.alert.s', timeout=15000); msg = pg.inner_text('.alert.s'); check('impor banyak: 2 dibuat', '2 pengajuan dibuat' in msg, msg)
        t = dump('Sheet1'); check('impor banyak: Sheet1 bertambah 2 baris', len(t) == 6, str(len(t)))
        h = t[0]; tws = [r[h.index('TW')] for r in t[4:]]; check('impor banyak: TW dari kolom Excel / kosong bila tidak diisi (tidak ditebak)', sorted(tws) == ['', '3'], str(tws))
        pg.click('.md-h [data-x=close]'); pg.click('#dbBulk'); pg.wait_for_selector('#b_file')
        pg.select_option('#b_ta', '2026'); pg.select_option('#b_jalur', 'SATKER'); pg.fill('#b_submitter', 'Kanwil DJPb Provinsi Uji'); pg.fill('#b_nomorND', 'ND-BULK/2026')
        pg.fill('#b_tanggalInput', '2026-10-17'); pg.select_option('#b_indikator', 'Deviasi Halaman III DIPA'); pg.select_option('#b_jenis', 'Deviasi_Kegiatan')
        pg.set_input_files('#b_file', xl); pg.wait_for_selector('#bPrev .kpis'); txt = pg.inner_text('#bPrev').replace('\n', ' ')
        check('impor ulang berkas sama: 0 baru (idempoten)', re.search(r'0\s*Akan dibuat', txt) is not None, txt[:200])
        check('impor ulang: tombol nonaktif', not pg.is_enabled('#b_go'))
        pg.click('.md-h [data-x=close]')

        # ---- monitoring satker: riwayat dengan mekanisme
        pg.click('.tab[data-tab=sat]'); pg.wait_for_selector('#pane-sat tr.cl'); pg.locator('#pane-sat tr.cl', has_text='000017').first.click()
        pg.wait_for_selector('.md table'); pg.wait_for_timeout(500); mt = pg.inner_text('.md')
        check('monitoring satker: riwayat memuat mekanisme & dua pengajuan 000017', 'mekanisme penyesuaian' in mt.lower() and mt.count('ND-') >= 2, mt[:200].replace('\n', ' '))
        pg.click('.md-h [data-x=close]')
        check('tanpa error konsol/halaman', not errs, str(errs)[:300])

        # ---- pembaca
        pg.goto(url('tk-pemb')); pg.wait_for_selector('.tab'); pg.click('.tab[data-tab=db]'); pg.wait_for_timeout(500)
        check('pembaca: tidak ada tombol tambah/impor', pg.locator('#dbAdd').count() == 0 and pg.locator('#dbBulk').count() == 0)
        # ---- asing
        pg.goto(url('tk-asing')); pg.wait_for_selector('.gate'); check('akun tak terdaftar: layar penolakan, tanpa data', 'belum terdaftar' in pg.inner_text('.gate').lower() or 'belum memiliki akses' in pg.inner_text('.gate').lower(), pg.inner_text('.gate')[:100])
        # ---- admin
        pg.goto(url('tk-admin')); pg.wait_for_selector('.tab'); check('admin: 5 tab', pg.locator('.tab').count() == 5)
        pg.click('.tab[data-tab=admin]'); pg.wait_for_selector('[data-uid]'); at = pg.inner_text('#pane-admin')
        check('admin: pengguna berbasis email + peran perekam', 'rekan@x.id' in at and 'perekam' in at)
        pg.fill('#uUid', 'rekan3@x.id'); pg.select_option('#uRole', 'perekam'); pg.click('#uAdd'); pg.wait_for_selector('#askR'); pg.fill('#askR', 'rekan baru'); pg.click('#askOk')
        pg.wait_for_timeout(800); check('admin: tambah pengguna tersimpan di sheet _Pengguna', any('rekan3@x.id' in ' '.join(r) for r in dump('_Pengguna')))
        b.close()
finally:
    srv.terminate()
fails = [r for r in results if not r[1]]
print(f'\nRINGKASAN: {len(results)-len(fails)} lulus, {len(fails)} gagal'); sys.exit(1 if fails else 0)
