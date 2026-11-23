import { createHash } from 'node:crypto';
import { FF1 } from '@noble/ciphers/ff1.js';

export const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const FIRST_ID = 62n ** 4n;
export const DOMAIN_END = 62n ** 7n;

export function parameterFingerprint(key: Uint8Array, tweak: Uint8Array): string {
  return createHash('sha256').update(JSON.stringify([
    'FF1-AES-7/v1', ALPHABET, Buffer.from(key).toString('hex'), Buffer.from(tweak).toString('hex')
  ])).digest('hex');
}

export function createCodec(key: Uint8Array, tweak: Uint8Array) {
  const cipher = FF1(62, key, tweak);
  return {
    encode(id: bigint): string {
      if (id < 0n || id >= DOMAIN_END) throw new RangeError('ID fora do domínio Base62');
      const digits = Array<number>(7);
      for (let index = digits.length - 1; index >= 0; index--) {
        digits[index] = Number(id % 62n);
        id /= 62n;
      }
      return cipher.encrypt(digits).map(digit => ALPHABET[digit]).join('');
    },
    decode(code: string): bigint {
      if (code.length !== 7 || !/^[0-9A-Za-z]+$/.test(code)) throw new RangeError('Código inválido');
      const digits = Array.from(code, char => ALPHABET.indexOf(char));
      return cipher.decrypt(digits).reduce((id, digit) => id * 62n + BigInt(digit), 0n);
    }
  };
}
