/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

// NOTE: lib/encryption.js is deprecated. These tests exist to prevent accidental
// breakage while the module remains in the codebase.

const assert = require('assert');
const encryption = require('../../lib/encryption');

describe('encryption (deprecated)', function() {

  describe('encryptWithKey / decryptWithKey (AES-256-CTR)', function() {
    const key = 'test-secret-key-1234567890abcdef';

    it('should round-trip a plain ASCII string', function() {
      const original = 'hello world';
      const encrypted = encryption.encryptWithKey(original, key);
      const decrypted = encryption.decryptWithKey(encrypted, key);
      assert.strictEqual(decrypted, original);
    });

    it('should round-trip an empty string', function() {
      const original = '';
      const encrypted = encryption.encryptWithKey(original, key);
      const decrypted = encryption.decryptWithKey(encrypted, key);
      assert.strictEqual(decrypted, original);
    });

    it('should round-trip a unicode string', function() {
      const original = 'crédits — ñoño — 日本語';
      const encrypted = encryption.encryptWithKey(original, key);
      const decrypted = encryption.decryptWithKey(encrypted, key);
      assert.strictEqual(decrypted, original);
    });

    it('should produce consistent ciphertext for identical inputs', function() {
      const original = 'consistent';
      const e1 = encryption.encryptWithKey(original, key);
      const e2 = encryption.encryptWithKey(original, key);
      assert.strictEqual(e1, e2);
    });

    it('should produce different ciphertext for different keys', function() {
      const original = 'same plaintext';
      const e1 = encryption.encryptWithKey(original, 'key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      const e2 = encryption.encryptWithKey(original, 'key-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      assert.notStrictEqual(e1, e2);
    });
  });

  describe('encryptWithKeyAndIV / decryptWithKeyAndIV (AES-256-CBC)', function() {
    // AES-256 requires a 32-byte key and 16-byte IV
    const key = Buffer.alloc(32, 'k');
    const iv  = Buffer.alloc(16, 'i');

    it('should round-trip a plain ASCII string', function() {
      const original = 'hello cbc world';
      const encrypted = encryption.encryptWithKeyAndIV(original, key, iv);
      const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
      assert.strictEqual(decrypted, original);
    });

    it('should round-trip an empty string', function() {
      const original = '';
      const encrypted = encryption.encryptWithKeyAndIV(original, key, iv);
      const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
      assert.strictEqual(decrypted, original);
    });

    it('should round-trip a unicode string', function() {
      const original = 'unicode ñ 日本語';
      const encrypted = encryption.encryptWithKeyAndIV(original, key, iv);
      const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
      assert.strictEqual(decrypted, original);
    });

    it('should produce consistent ciphertext for identical inputs', function() {
      const original = 'repeatable';
      const e1 = encryption.encryptWithKeyAndIV(original, key, iv);
      const e2 = encryption.encryptWithKeyAndIV(original, key, iv);
      assert.strictEqual(e1, e2);
    });
  });

  describe('getKeyFromPassword', function() {
    it('should derive a key of the requested length', function(done) {
      encryption.getKeyFromPassword('password', 'salt', 32, function(derivedKey) {
        assert.ok(derivedKey instanceof Buffer);
        assert.strictEqual(derivedKey.length, 32);
        done();
      });
    });

    it('should produce the same key for the same inputs', function(done) {
      encryption.getKeyFromPassword('password', 'salt', 16, function(key1) {
        encryption.getKeyFromPassword('password', 'salt', 16, function(key2) {
          assert.deepStrictEqual(key1, key2);
          done();
        });
      });
    });

    it('should produce different keys for different passwords', function(done) {
      encryption.getKeyFromPassword('passwordA', 'salt', 16, function(key1) {
        encryption.getKeyFromPassword('passwordB', 'salt', 16, function(key2) {
          assert.notDeepStrictEqual(key1, key2);
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
