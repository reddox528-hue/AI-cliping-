import crypto from 'crypto';

const SCRYPT_PREFIX = 'scrypt';
const SALT_BYTES = 16;
const KEY_LENGTH = 64;
const SCRYPT_COST = 16384;

export function hashPassword(password: string): string {
  const saltHex = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derived = crypto.scryptSync(password, saltHex, KEY_LENGTH, { N: SCRYPT_COST, r: 8, p: 1 });
  return `${SCRYPT_PREFIX}$${saltHex}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!password || !storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== SCRYPT_PREFIX) {
    return false;
  }
  const [, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;

  try {
    const expected = Buffer.from(hashHex, 'hex');
    const derived = crypto.scryptSync(password, saltHex, expected.length, { N: SCRYPT_COST, r: 8, p: 1 });
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
