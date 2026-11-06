# Feature E2E + screenshots: self-heal, CSV chart, proof receipt, live dashboard. python scripts/e2e_features.py [url]
import sys, os
from pathlib import Path
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4321'
DONE = "['ok','contained'].some(c=>document.querySelector('#badge').classList.contains(c)) && !document.querySelector('#run').disabled"
def run(pg):
    pg.wait_for_function("!document.querySelector('#run').disabled", timeout=90000); pg.click('#run')
    pg.wait_for_function(DONE, timeout=120000); pg.wait_for_timeout(800); return pg.inner_text('#badge')
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    pg = br.new_page(viewport={'width': 1600, 'height': 1150})
    pg.goto(U); pg.wait_for_timeout(800)
    if pg.locator('#login').is_visible():
        pg.fill('#token', Path(os.environ['SAFECODE_ACCESS_TOKEN_FILE']).read_text().strip()); pg.click('#login button')
    pg.wait_for_selector('#workspace:visible')
    pg.wait_for_timeout(800)
    pg.click('#healdemo button'); b = run(pg); print('heal =>', b, '|', pg.inner_text('#timeline').replace('\n', ' / '))
    assert 'Self-healed' in b; pg.screenshot(path='docs/09-self-heal.png', full_page=True)
    pg.set_input_files('#csv', 'docs/sample-sales.csv'); pg.wait_for_timeout(500)
    pg.fill('#task', 'Total revenue per region, and draw a bar chart of it'); pg.click('#gen'); b = run(pg)
    print('csv =>', b, '| img:', pg.locator('#artifacts img').count(), '| verified rows:', pg.locator('.vtable tr').count())
    assert pg.locator('#artifacts img').count() >= 1; pg.screenshot(path='docs/10-csv-chart.png', full_page=True)
    href = pg.get_attribute('#receipt a', 'href'); rp = pg.context.new_page(); rp.set_viewport_size({'width': 1000, 'height': 1200}); rp.goto(U + href)
    assert 'execution receipt' in rp.content(); rp.screenshot(path='docs/11-proof-receipt.png', full_page=True); rp.close()
    pg.click('#upload-reset') if pg.locator('#upload-reset').count() else pg.click('#clearcsv')
    for d in ['Fork bomb', 'curl exfil']:
        pg.click(f'#demos button:has-text("{d}")'); print(d, '=>', run(pg))
    pg.wait_for_timeout(800); print('dashboard:', pg.inner_text('#dgrid').replace('\n', ' '), '|', pg.inner_text('#attacks').replace('\n', ' '))
    pg.locator('#dash').screenshot(path='docs/12-safety-dashboard.png'); pg.screenshot(path='docs/13-full.png', full_page=True)
    br.close()
print('FEATURE E2E OK')
