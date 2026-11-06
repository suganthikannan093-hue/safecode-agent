# End-to-end check + screenshots: python scripts/e2e.py (needs playwright + chrome)
import sys, os
from pathlib import Path
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4321'
def flow(pg, task=None, demo=None, shot=None):
    if demo: pg.click(f'#demos button:has-text("{demo}")')
    else: pg.fill('#task', task); pg.click('#gen')
    pg.wait_for_function("!document.querySelector('#run').disabled", timeout=90000)
    pg.click('#run')
    pg.wait_for_function("['ok','contained'].some(c=>document.querySelector('#badge').classList.contains(c))", timeout=90000)
    pg.wait_for_timeout(600)
    b = pg.inner_text('#badge'); print(demo or task, '=>', b)
    if shot: pg.screenshot(path=f'docs/{shot}.png', full_page=True)
    return b
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    pg = br.new_page(viewport={'width': 1600, 'height': 1000})
    pg.goto(U); pg.wait_for_timeout(800)
    if pg.locator('#login').is_visible():
        pg.fill('#token', Path(os.environ['SAFECODE_ACCESS_TOKEN_FILE']).read_text().strip()); pg.click('#login button')
    pg.wait_for_selector('#workspace:visible')
    pg.wait_for_timeout(800); pg.screenshot(path='docs/01-home.png', full_page=True)
    assert 'Completed' in flow(pg, task='Simulate 10,000 dice rolls with a fixed seed and print a text histogram', shot='02-normal-task')
    for i, d in enumerate(['rm -rf /', 'Fork bomb', 'while True', 'curl exfil', 'read /etc/shadow', 'Memory bomb']):
        assert 'Containment signals' in flow(pg, demo=d, shot=f'{i+3:02d}-contained-{d.split()[0].strip("/").lower() or "rm"}')
    br.close()
print('E2E OK')
