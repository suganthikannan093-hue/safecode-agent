import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const path = process.argv[2];
if (!path) { console.error('Usage: node scripts/create-signing-key.js /private/path/receipt-key.pem'); process.exit(2); }
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
writeFileSync(path + '.pub', publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx', mode: 0o644 });
console.log('Signing key and public key written. Distribute the public key through a trusted channel.');
