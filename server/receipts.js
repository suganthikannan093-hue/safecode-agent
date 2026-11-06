import { createPrivateKey, createPublicKey, createHash, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const canonical = x => Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : x && typeof x === 'object' ? '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}' : JSON.stringify(x);
export const fingerprint = pem => createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex');
export function signer(path) {
  if (!path) return { publicKey: null, seal: x => ({ ...x, signature: { status: 'unsigned' } }) };
  const key = createPrivateKey(readFileSync(path));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Receipt key must be Ed25519');
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' });
  return { publicKey, seal: input => { const x = JSON.parse(JSON.stringify(input)); return { ...x, signature: { status: 'signed', algorithm: 'Ed25519', keyId: fingerprint(publicKey), value: sign(null, Buffer.from(canonical(x)), key).toString('base64') } }; } };
}
export function verifyReceipt(receipt, trustedPublicKey) {
  const { signature, ...payload } = receipt;
  if (signature?.status !== 'signed') return { valid: false, reason: 'unsigned' };
  try {
    const valid = signature.algorithm === 'Ed25519' && signature.keyId === fingerprint(trustedPublicKey) && verify(null, Buffer.from(canonical(payload)), trustedPublicKey, Buffer.from(signature.value, 'base64'));
    return { valid, reason: valid ? 'issuer signature and record integrity verified' : 'signature or trusted key mismatch' };
  } catch { return { valid: false, reason: 'invalid signature or key' }; }
}
