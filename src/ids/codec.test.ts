import assert from 'node:assert/strict';
import test from 'node:test';
import { FF1 } from '@noble/ciphers/ff1.js';
import { ALPHABET, createCodec, DOMAIN_END, FIRST_ID } from './codec.js';

const key = Buffer.from('2b7e151628aed2a6abf7158809cf4f3c', 'hex');
const tweak = Buffer.from('39383736353433323130', 'hex');

test('FF1-AES128 reproduz as amostras 1 e 2 do NIST', () => {
  // https://csrc.nist.gov/CSRC/media/Projects/Cryptographic-Standards-and-Guidelines/documents/examples/FF1samples.pdf
  for (const [t, expected] of [[Buffer.alloc(0), '2433477484'], [tweak, '6124200773']] as const) {
    const ff1 = FF1(10, key, t);
    const digits = [...'0123456789'].map(Number);
    const encrypted = ff1.encrypt(digits);
    assert.equal(encrypted.join(''), expected);
    assert.deepEqual(ff1.decrypt(encrypted), digits);
  }
});

test('sete índices Base62 coincidem com o FF1 independente do Bouncy Castle 1.80', () => {
  const codec = createCodec(key, tweak);
  for (const [plain, encrypted] of [
    ['0000000', 'WKkPw3M'], ['00000Aa', 'tT2LnCL'], ['00000aA', 'WaUOJqQ'],
    ['0010000', 'n9SJO3l'], ['zzzzzzz', 'f4ss3Kg']
  ]) {
    const id = [...plain].reduce((value, symbol) => 62n * value + BigInt(ALPHABET.indexOf(symbol)), 0n);
    assert.equal(codec.encode(id), encrypted);
    assert.equal(codec.decode(encrypted), id);
  }
  assert.equal(codec.encode(FIRST_ID), 'n9SJO3l');
  assert.throws(() => codec.encode(-1n), RangeError);
  assert.throws(() => codec.encode(DOMAIN_END), RangeError);
  assert.throws(() => codec.decode('abcdef!'), RangeError);
});
