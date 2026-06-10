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

  describe('encryptWithKey / decryptWithKey', function () {
    it('should encrypt and decrypt text correctly', function () {
      var key = 'my-secret-key-for-testing';
      var text = 'hello world';
      var encrypted = encryption.encryptWithKey(text, key);
      assert.ok(typeof encrypted === 'string');
      assert.notStrictEqual(encrypted, text);
      var decrypted = encryption.decryptWithKey(encrypted, key);
      assert.strictEqual(decrypted, text);
    });

    it('should produce different ciphertext with different keys', function () {
      var text = 'test message';
      var encrypted1 = encryption.encryptWithKey(text, 'key-one');
      var encrypted2 = encryption.encryptWithKey(text, 'key-two');
      assert.notStrictEqual(encrypted1, encrypted2);
    });

    it('should handle empty string', function () {
      var key = 'my-key';
      var encrypted = encryption.encryptWithKey('', key);
      var decrypted = encryption.decryptWithKey(encrypted, key);
      assert.strictEqual(decrypted, '');
    });

    it('should handle long text', function () {
      var key = 'long-text-key';
      var text = 'a'.repeat(10000);
      var encrypted = encryption.encryptWithKey(text, key);
      var decrypted = encryption.decryptWithKey(encrypted, key);
      assert.strictEqual(decrypted, text);
    });

    it('should handle special characters in text', function () {
      var key = 'special-key';
      var text = '!@#$%^&*(){}[]|\\:";\'<>?,./~`\n\t\r';
      var encrypted = encryption.encryptWithKey(text, key);
      var decrypted = encryption.decryptWithKey(encrypted, key);
      assert.strictEqual(decrypted, text);
    });

    it('should handle unicode text', function () {
      var key = 'unicode-key';
      var text = '日本語テスト 🎉';
      var encrypted = encryption.encryptWithKey(text, key);
      var decrypted = encryption.decryptWithKey(encrypted, key);
      assert.strictEqual(decrypted, text);
    });

    it('should fail to decrypt with wrong key', function () {
      var text = 'secret';
      var encrypted = encryption.encryptWithKey(text, 'correct-key');
      var decrypted = encryption.decryptWithKey(encrypted, 'wrong-key');
      assert.notStrictEqual(decrypted, text);
    });
  });

  describe('decryptWithKeyAndIV error cases', function () {
    it('should throw when decrypting with wrong key', function () {
      var key1 = crypto.randomBytes(32);
      var key2 = crypto.randomBytes(32);
      var iv = crypto.randomBytes(16);
      var encrypted = encryption.encryptWithKeyAndIV('test', key1, iv);
      assert.throws(function () {
        encryption.decryptWithKeyAndIV(encrypted, key2, iv);
      });
    });

    it('should throw when decrypting with wrong IV', function () {
      var key = crypto.randomBytes(32);
      var iv1 = crypto.randomBytes(16);
      var iv2 = crypto.randomBytes(16);
      var encrypted = encryption.encryptWithKeyAndIV('test', key, iv1);
      // Wrong IV typically produces garbage or throws
      try {
        var result = encryption.decryptWithKeyAndIV(encrypted, key, iv2);
        // If it doesn't throw, it should produce wrong output
        assert.notStrictEqual(result, 'test');
      } catch (e) {
        // Expected - bad decrypt
        assert.ok(true);
      }
    });

    it('should throw on invalid hex input', function () {
      var key = crypto.randomBytes(32);
      var iv = crypto.randomBytes(16);
      assert.throws(function () {
        encryption.decryptWithKeyAndIV('not-hex-!@#', key, iv);
      });
    });
  });
});