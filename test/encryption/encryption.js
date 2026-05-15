/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';
const chai = require('chai');
const expect = chai.expect;
const encryption = require('../../lib/encryption');

describe('lib/encryption', function () {

  // Note: encryptWithKey/decryptWithKey use crypto.createCipher/createDecipher
  // which were removed in Node.js 22+. Those functions are untestable on modern Node.

  describe('encryptWithKeyAndIV / decryptWithKeyAndIV', function () {
    // AES-256-CBC requires a 32-byte key and 16-byte IV
    const key = Buffer.alloc(32, 'a'); // 32 bytes
    const iv = Buffer.alloc(16, 'b');  // 16 bytes

    it('encrypts and decrypts back to the original text', function () {
      const plaintext = 'hello world';
      const encrypted = encryption.encryptWithKeyAndIV(plaintext, key, iv);
      const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
      expect(decrypted).to.equal(plaintext);
    });

    it('produces different ciphertext for different plaintexts', function () {
      const enc1 = encryption.encryptWithKeyAndIV('foo', key, iv);
      const enc2 = encryption.encryptWithKeyAndIV('bar', key, iv);
      expect(enc1).to.not.equal(enc2);
    });

    it('produces hex string output', function () {
      const encrypted = encryption.encryptWithKeyAndIV('test', key, iv);
      expect(encrypted).to.match(/^[0-9a-f]+$/);
    });

    it('handles empty string encryption/decryption', function () {
      const encrypted = encryption.encryptWithKeyAndIV('', key, iv);
      const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
      expect(decrypted).to.equal('');
    });

    it('handles unicode text', function () {
      const plaintext = '日本語テスト 🎉';
      const encrypted = encryption.encryptWithKeyAndIV(plaintext, key, iv);
      const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
      expect(decrypted).to.equal(plaintext);
    });

    it('fails to decrypt with a wrong key', function () {
      const encrypted = encryption.encryptWithKeyAndIV('secret', key, iv);
      const wrongKey = Buffer.alloc(32, 'x');
      expect(() => encryption.decryptWithKeyAndIV(encrypted, wrongKey, iv)).to.throw();
    });

    it('fails to decrypt with a wrong IV', function () {
      const encrypted = encryption.encryptWithKeyAndIV('secret', key, iv);
      const wrongIV = Buffer.alloc(16, 'z');
      // Wrong IV may produce garbage or throw depending on padding
      let decrypted;
      try {
        decrypted = encryption.decryptWithKeyAndIV(encrypted, key, wrongIV);
      } catch (e) {
        // expected — decryption failure with wrong IV
        return;
      }
      // If it didn't throw, the decrypted text should NOT match
      expect(decrypted).to.not.equal('secret');
    });
  });

  describe('getKeyFromPassword', function () {
    it('derives a key of the requested length', function (done) {
      encryption.getKeyFromPassword('password', 'salt', 32, function (derivedKey) {
        expect(derivedKey).to.be.an.instanceOf(Buffer);
        expect(derivedKey.length).to.equal(32);
        done();
      });
    });

    it('produces the same key for the same inputs (deterministic)', function (done) {
      encryption.getKeyFromPassword('pass', 'salt1', 16, function (key1) {
        encryption.getKeyFromPassword('pass', 'salt1', 16, function (key2) {
          expect(key1.equals(key2)).to.be.true;
          done();
        });
      });
    });

    it('produces different keys for different passwords', function (done) {
      encryption.getKeyFromPassword('pass1', 'salt', 32, function (key1) {
        encryption.getKeyFromPassword('pass2', 'salt', 32, function (key2) {
          expect(key1.equals(key2)).to.be.false;
          done();
        });
      });
    });

    it('produces different keys for different salts', function (done) {
      encryption.getKeyFromPassword('pass', 'saltA', 32, function (key1) {
        encryption.getKeyFromPassword('pass', 'saltB', 32, function (key2) {
          expect(key1.equals(key2)).to.be.false;
          done();
        });
      });
    });
  });
});

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
