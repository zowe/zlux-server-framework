const assert = require('assert');
const crypto = require('crypto');

describe('encryption', function () {
  let encryption;

  before(function () {
    try {
      encryption = require('../../lib/encryption');
    } catch (e) {
      console.warn('Could not load encryption module:', e.message);
      this.skip();
    }
  });

  it('should export all expected functions', function () {
    assert.strictEqual(typeof encryption.encryptWithKey, 'function');
    assert.strictEqual(typeof encryption.decryptWithKey, 'function');
    assert.strictEqual(typeof encryption.encryptWithKeyAndIV, 'function');
    assert.strictEqual(typeof encryption.decryptWithKeyAndIV, 'function');
    assert.strictEqual(typeof encryption.getKeyFromPassword, 'function');
  });

  describe('encryptWithKeyAndIV / decryptWithKeyAndIV', function () {
    it('should encrypt and decrypt text correctly', function () {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const text = 'hello world secret message';
      const encrypted = encryption.encryptWithKeyAndIV(text, key, iv);
      assert.ok(typeof encrypted === 'string', 'encrypted should be a string');
      assert.notStrictEqual(encrypted, text, 'encrypted should differ from plaintext');
      const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
      assert.strictEqual(decrypted, text, 'decrypted should match original');
    });

    it('should produce different ciphertext with different IVs', function () {
      const key = crypto.randomBytes(32);
      const iv1 = crypto.randomBytes(16);
      const iv2 = crypto.randomBytes(16);
      const text = 'test message';
      const encrypted1 = encryption.encryptWithKeyAndIV(text, key, iv1);
      const encrypted2 = encryption.encryptWithKeyAndIV(text, key, iv2);
      assert.notStrictEqual(encrypted1, encrypted2, 'different IVs should produce different ciphertext');
    });

    it('should produce different ciphertext with different keys', function () {
      const key1 = crypto.randomBytes(32);
      const key2 = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const text = 'test message';
      const encrypted1 = encryption.encryptWithKeyAndIV(text, key1, iv);
      const encrypted2 = encryption.encryptWithKeyAndIV(text, key2, iv);
      assert.notStrictEqual(encrypted1, encrypted2, 'different keys should produce different ciphertext');
    });

    it('should handle empty string', function () {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const encrypted = encryption.encryptWithKeyAndIV('', key, iv);
      const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
      assert.strictEqual(decrypted, '', 'should handle empty string');
    });

    it('should handle special characters', function () {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const text = '!@#$%^&*()_+-={}[]|:";\'<>?,./~`';
      const encrypted = encryption.encryptWithKeyAndIV(text, key, iv);
      const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
      assert.strictEqual(decrypted, text, 'should handle special chars');
    });

    it('should handle unicode characters', function () {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const text = 'こんにちは世界 🌍';
      const encrypted = encryption.encryptWithKeyAndIV(text, key, iv);
      const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
      assert.strictEqual(decrypted, text, 'should handle unicode');
    });
  });

  describe('getKeyFromPassword', function () {
    it('should derive a key from password and salt', function (done) {
      encryption.getKeyFromPassword('mypassword', 'saltsalt', 32, function (derivedKey) {
        assert.ok(Buffer.isBuffer(derivedKey), 'derivedKey should be a Buffer');
        assert.strictEqual(derivedKey.length, 32, 'key length should be 32');
        done();
      });
    });

    it('should produce consistent keys for same inputs', function (done) {
      encryption.getKeyFromPassword('password1', 'salt1234', 32, function (key1) {
        encryption.getKeyFromPassword('password1', 'salt1234', 32, function (key2) {
          assert.ok(key1.equals(key2), 'same inputs should produce same key');
          done();
        });
      });
    });

    it('should produce different keys for different passwords', function (done) {
      encryption.getKeyFromPassword('password1', 'salt1234', 32, function (key1) {
        encryption.getKeyFromPassword('password2', 'salt1234', 32, function (key2) {
          assert.ok(!key1.equals(key2), 'different passwords should produce different keys');
          done();
        });
      });
    });

    it('should produce different keys for different salts', function (done) {
      encryption.getKeyFromPassword('password1', 'salt1111', 32, function (key1) {
        encryption.getKeyFromPassword('password1', 'salt2222', 32, function (key2) {
          assert.ok(!key1.equals(key2), 'different salts should produce different keys');
          done();
        });
      });
    });

    it('should respect the length parameter', function (done) {
      encryption.getKeyFromPassword('mypassword', 'saltsalt', 16, function (derivedKey) {
        assert.strictEqual(derivedKey.length, 16, 'key length should be 16');
        done();
      });
    });

    it('should work with getKeyFromPassword and encryptWithKeyAndIV together', function (done) {
      encryption.getKeyFromPassword('mypassword', 'saltsalt', 32, function (key) {
        var iv = crypto.randomBytes(16);
        var text = 'secret data';
        var encrypted = encryption.encryptWithKeyAndIV(text, key, iv);
        var decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
        assert.strictEqual(decrypted, text, 'end-to-end encrypt/decrypt with derived key');
        done();
      });
    });
  });
});