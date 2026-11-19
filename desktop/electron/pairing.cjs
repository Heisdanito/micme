const crypto = require('node:crypto');

// No 0/O/1/I/L so the code is easy to type by hand.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

/** Must stay in sync with mobile/src/lib/pairing.ts */
function pairingUrl({ hosts, port, code, name }) {
  const q = [
    `h=${hosts.map(encodeURIComponent).join(',')}`,
    `p=${port}`,
    `c=${encodeURIComponent(code)}`,
    `n=${encodeURIComponent(name)}`,
  ].join('&');
  return `micme://pair?${q}`;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { newCode, pairingUrl, safeEqual, ALPHABET };
