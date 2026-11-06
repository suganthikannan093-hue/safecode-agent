import { readFileSync } from 'node:fs';
import { verifyReceipt } from '../server/receipts.js';
const [receipt, key] = process.argv.slice(2);
if (!receipt || !key) { console.error('Usage: node scripts/verify-receipt.js receipt.json trusted-public.pem'); process.exit(2); }
const result = verifyReceipt(JSON.parse(readFileSync(receipt, 'utf8')), readFileSync(key, 'utf8'));
console.log(JSON.stringify(result)); process.exit(result.valid ? 0 : 1);
