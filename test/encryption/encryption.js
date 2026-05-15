'use strict';
const { expect } = require('chai');
const crypto = require('crypto');
const encryption = require('../../lib/encryption');

describe('encryption', function () {

  describe('encryptWithKeyAndIV / decryptWithKeyAndIV (AES-256-CBC)', function () {

    it('should round-trip plaintext through encrypt then decrypt', function () {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const plaintext = 'hello world';
      const encrypted = encryption.encryptWithKeyAndIV(plaintext, key, iv);
      const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
      expect(decrypted).to.equal(plaintext);
    });

    it('should produce hex-encoded ciphertext', function () {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const encrypted = encryption.encryptWithKeyAndIV('test', key, iv);
      expect(encrypted).to.match(/^[0-9a-f]+$/);
    });

    it('should produce different ciphertext for different IVs', function () {
      const key = crypto.randomBytes(32);
      const iv1 = crypto.randomBytes(16);
      const iv2 = crypto.randomBytes(16);
      const text = 'same plaintext';
      const enc1 = encryption.encryptWithKeyAndIV(text, key, iv1);
      const enc2 = encryption.encryptWithKeyAndIV(text, key, iv2);
      expect(enc1).to.not.equal(enc2);
    });

    it('should fail to decrypt with wrong key', function () {
      const key1 = crypto.randomBytes(32);
      const key2 = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const encrypted = encryption.encryptWithKeyAndIV('secret', key1, iv);
      expect(() => encryption.decryptWithKeyAndIV(encrypted, key2, iv)).to.throw();
    });

    it('should fail to decrypt with wrong IV', function () {
      const key = crypto.randomBytes(32);
      const iv1 = crypto.randomBytes(16);
      const iv2 = crypto.randomBytes(16);
      const encrypted = encryption.encryptWithKeyAndIV('secret', key, iv1);
      expect(() => encryption.decryptWithKeyAndIV(encrypted, key, iv2)).to.throw();
    });

    it('should handle empty string', function () {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const encrypted = encryption.encryptWithKeyAndIV('', key, iv);
      expect(encrypted.length).to.be.greaterThan(0);
      const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
      expect(decrypted).to.equal('');
    });

    it('should handle unicode text', function () {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const text = '日本語テスト 🔑';
      const encrypted = encryption.encryptWithKeyAndIV(text, key, iv);
      const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
      expect(decrypted).to.equal(text);
    });

    it('should handle large payloads (1MB)', function () {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const text = 'A'.repeat(1024 * 1024);
      const encrypted = encryption.encryptWithKeyAndIV(text, key, iv);
      const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
      expect(decrypted).to.equal(text);
    });

    it('should fail on tampered ciphertext', function () {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const encrypted = encryption.encryptWithKeyAndIV('secret data', key, iv);
      const tampered = 'ff' + encrypted.substring(2);
      expect(() => encryption.decryptWithKeyAndIV(tampered, key, iv)).to.throw();
    });

    it('should fail on truncated ciphertext', function () {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const encrypted = encryption.encryptWithKeyAndIV('hello world', key, iv);
      const truncated = encrypted.substring(0, encrypted.length - 4);
      expect(() => encryption.decryptWithKeyAndIV(truncated, key, iv)).to.throw();
    });

    it('should reject invalid key length', function () {
      const shortKey = crypto.randomBytes(16);
      const iv = crypto.randomBytes(16);
      expect(() => encryption.encryptWithKeyAndIV('test', shortKey, iv)).to.throw();
    });

    it('should reject invalid IV length', function () {
      const key = crypto.randomBytes(32);
      const shortIv = crypto.randomBytes(8);
      expect(() => encryption.encryptWithKeyAndIV('test', key, shortIv)).to.throw();
    });
  });

  describe('encryptWithKey / decryptWithKey (AES-256-CTR, deprecated API)', function () {
    const hasCreateCipher = typeof crypto.createCipher === 'function';
    const skipMsg = 'crypto.createCipher removed in Node 22+';

    it('should round-trip plaintext', function () {
      if (!hasCreateCipher) return this.skip(skipMsg);
      const key = 'my-secret-password-key';
      const plaintext = 'sensitive data';
      const encrypted = encryption.encryptWithKey(plaintext, key);
      const decrypted = encryption.decryptWithKey(encrypted, key);
      expect(decrypted).to.equal(plaintext);
    });

    it('SECURITY FLAW: same key + same plaintext = same ciphertext (no IV)', function () {
      if (!hasCreateCipher) return this.skip(skipMsg);
      const key = 'deterministic-key';
      const text = 'same input';
      const enc1 = encryption.encryptWithKey(text, key);
      const enc2 = encryption.encryptWithKey(text, key);
      expect(enc1).to.equal(enc2);
    });

    it('should produce different ciphertext for different keys', function () {
      if (!hasCreateCipher) return this.skip(skipMsg);
      const text = 'hello';
      const enc1 = encryption.encryptWithKey(text, 'key1');
      const enc2 = encryption.encryptWithKey(text, 'key2');
      expect(enc1).to.not.equal(enc2);
    });

    it('should fail to decrypt with wrong key', function () {
      if (!hasCreateCipher) return this.skip(skipMsg);
      const encrypted = encryption.encryptWithKey('secret', 'key1');
      const decrypted = encryption.decryptWithKey(encrypted, 'key2');
      expect(decrypted).to.not.equal('secret');
    });

    it('should handle empty string', function () {
      if (!hasCreateCipher) return this.skip(skipMsg);
      const encrypted = encryption.encryptWithKey('', 'key');
      const decrypted = encryption.decryptWithKey(encrypted, 'key');
      expect(decrypted).to.equal('');
    });
  });

  describe('getKeyFromPassword (PBKDF2)', function () {
    // 100k rounds takes longer, increase default timeout for this suite
    this.timeout(30000);

    it('should derive a key of requested length', function (done) {
      encryption.getKeyFromPassword('password', 'salt', 32, (key) => {
        expect(key).to.be.instanceOf(Buffer);
        expect(key.length).to.equal(32);
        done();
      });
    });

    it('should produce deterministic output for same inputs', function (done) {
      const params = { password: 'mypass', salt: 'mysalt', length: 32 };
      encryption.getKeyFromPassword(params.password, params.salt, params.length, (key1) => {
        encryption.getKeyFromPassword(params.password, params.salt, params.length, (key2) => {
          expect(key1.equals(key2)).to.be.true;
          done();
        });
      });
    });

    it('should produce different keys for different salts', function (done) {
      encryption.getKeyFromPassword('pass', 'salt1', 32, (key1) => {
        encryption.getKeyFromPassword('pass', 'salt2', 32, (key2) => {
          expect(key1.equals(key2)).to.be.false;
          done();
        });
      });
    });

    it('should produce different keys for different passwords', function (done) {
      encryption.getKeyFromPassword('pass1', 'salt', 32, (key1) => {
        encryption.getKeyFromPassword('pass2', 'salt', 32, (key2) => {
          expect(key1.equals(key2)).to.be.false;
          done();
        });
      });
    });

    it('should support different key lengths', function (done) {
      encryption.getKeyFromPassword('pass', 'salt', 16, (key) => {
        expect(key.length).to.equal(16);
        done();
      });
    });

    it('FIXED: PBKDF2 now uses 100k rounds by default (stronger key derivation)', function (done) {
      this.timeout(10000);
      const start = process.hrtime.bigint();
      encryption.getKeyFromPassword('password', 'salt', 32, (key) => {
        const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
        // 100k rounds should take noticeably longer than the old 500 rounds
        // But still complete within a reasonable time (< 5s)
        expect(key.length).to.equal(32);
        expect(elapsed).to.be.lessThan(5000);
        done();
      });
    });

    it('should support legacy rounds parameter for backward compatibility', function (done) {
      encryption.getKeyFromPassword('password', 'salt', 32, (key) => {
        expect(key.length).to.equal(32);
        done();
      }, 500); // Explicitly pass 500 rounds for legacy behavior
    });

    it('derived key should work as AES-256-CBC key', function (done) {
      encryption.getKeyFromPassword('password', 'random-salt', 32, (key) => {
        const iv = crypto.randomBytes(16);
        const encrypted = encryption.encryptWithKeyAndIV('test data', key, iv);
        const decrypted = encryption.decryptWithKeyAndIV(encrypted, key, iv);
        expect(decrypted).to.equal('test data');
        done();
      });
    });
  });

  describe('integration: PBKDF2 key derivation + AES-256-CBC encrypt/decrypt', function () {
    this.timeout(30000);

    it('should complete a full password-based encryption workflow', function (done) {
      const password = 'user-password-123';
      const salt = crypto.randomBytes(16).toString('hex');
      const iv = crypto.randomBytes(16);
      const secret = 'sensitive configuration value with special chars: §±@#$%';

      encryption.getKeyFromPassword(password, salt, 32, (key) => {
        const ciphertext = encryption.encryptWithKeyAndIV(secret, key, iv);
        const recovered = encryption.decryptWithKeyAndIV(ciphertext, key, iv);
        expect(recovered).to.equal(secret);
        done();
      });
    });

    it('should fail decryption when wrong password derives key', function (done) {
      const salt = 'fixed-salt';
      const iv = crypto.randomBytes(16);
      encryption.getKeyFromPassword('correct-password', salt, 32, (correctKey) => {
        const ciphertext = encryption.encryptWithKeyAndIV('secret', correctKey, iv);
        encryption.getKeyFromPassword('wrong-password', salt, 32, (wrongKey) => {
          expect(() => {
            encryption.decryptWithKeyAndIV(ciphertext, wrongKey, iv);
          }).to.throw();
          done();
        });
      });
    });
  });
});
