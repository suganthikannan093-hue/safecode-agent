"""Standard-library client: upload, generate, review, explicitly approve, execute, save receipt.
SAFECODE_URL and SAFECODE_ACCESS_TOKEN_FILE configure the target. No secrets are printed.
"""
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

base = os.environ.get('SAFECODE_URL', 'http://127.0.0.1:4321')
token_file = os.environ.get('SAFECODE_ACCESS_TOKEN_FILE')
headers = {'Authorization': 'Bearer ' + Path(token_file).read_text().strip()} if token_file else {}

def request(path, payload=None, method=None):
    data = json.dumps(payload).encode() if payload is not None else None
    return urlopen(Request(base + path, data=data, method=method,
                           headers={**headers, 'Content-Type': 'application/json'}), timeout=90)

csv = Path(__file__).resolve().parents[1] / 'docs/sample-sales.csv'
with urlopen(Request(base + '/api/upload?name=sales.csv', data=csv.read_bytes(), headers=headers), timeout=30) as response:
    upload = json.load(response)
with request('/api/generate', {'task': 'Total revenue per region and draw an SVG bar chart', 'fileId': upload['fileId']}) as response:
    draft = json.load(response)
print(draft['code'])
if input('Execute this reviewed code? Type RUN: ') != 'RUN':
    raise SystemExit('Not executed')
with request('/api/run', {'id': draft['id'], 'heal': False}) as response:
    for line in response:
        event = json.loads(line)
        if event['type'] == 'start':
            print('Execution ID:', event['id'], '(POST /api/cancel with this id to cancel)')
        elif event['type'] == 'chunk':
            print(event['data'], end='')
        elif event['type'] == 'error':
            raise RuntimeError(event['error'])
        elif event['type'] == 'result':
            with request(event['receipt']['json']) as receipt:
                Path('receipt.json').write_bytes(receipt.read())
            print('\nSaved receipt.json. Verify using scripts/verify-receipt.js and a trusted public key.')
