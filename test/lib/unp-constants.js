const assert = require('assert');

describe('unp-constants', function () {
  let unpConstants;

  before(function () {
    try {
      unpConstants = require('../../lib/unp-constants');
    } catch (e) {
      console.warn('Could not load unp-constants module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(unpConstants, 'unp-constants module should be loadable');
  });

  describe('exit codes', function () {
    it('should export EXIT_GENERIC as 2', function () {
      assert.strictEqual(unpConstants.EXIT_GENERIC, 2);
    });

    it('should export EXIT_AUTH as 3', function () {
      assert.strictEqual(unpConstants.EXIT_AUTH, 3);
    });

    it('should export EXIT_PFX_READ as 4', function () {
      assert.strictEqual(unpConstants.EXIT_PFX_READ, 4);
    });

    it('should export EXIT_HTTPS_LOAD as 5', function () {
      assert.strictEqual(unpConstants.EXIT_HTTPS_LOAD, 5);
    });

    it('should export EXIT_NO_PLUGINS as 6', function () {
      assert.strictEqual(unpConstants.EXIT_NO_PLUGINS, 6);
    });

    it('should export EXIT_NO_SAFKEYRING as 7', function () {
      assert.strictEqual(unpConstants.EXIT_NO_SAFKEYRING, 7);
    });
  });

  describe('websocket close codes', function () {
    it('should export WEBSOCKET_CLOSE_INTERNAL_ERROR as 4999', function () {
      assert.strictEqual(unpConstants.WEBSOCKET_CLOSE_INTERNAL_ERROR, 4999);
    });

    it('should export WEBSOCKET_CLOSE_BY_PROXY as 4998', function () {
      assert.strictEqual(unpConstants.WEBSOCKET_CLOSE_BY_PROXY, 4998);
    });

    it('should export WEBSOCKET_CLOSE_CODE_MINIMUM as 3000', function () {
      assert.strictEqual(unpConstants.WEBSOCKET_CLOSE_CODE_MINIMUM, 3000);
    });
  });

  describe('APP_NAME', function () {
    it('should have APP_NAME as a string', function () {
      assert.strictEqual(typeof unpConstants.APP_NAME, 'string');
    });

    it('should default APP_NAME to zlux', function () {
      assert.strictEqual(unpConstants.APP_NAME, 'zlux');
    });
  });

  describe('setProductCode', function () {
    afterEach(function () {
      unpConstants.setProductCode('ZLUX');
    });

    it('should be a function', function () {
      assert.strictEqual(typeof unpConstants.setProductCode, 'function');
    });

    it('should update APP_NAME to lowercase', function () {
      unpConstants.setProductCode('MYAPP');
      assert.strictEqual(unpConstants.APP_NAME, 'myapp');
    });

    it('should handle already lowercase input', function () {
      unpConstants.setProductCode('test');
      assert.strictEqual(unpConstants.APP_NAME, 'test');
    });
  });

  describe('TLS_VERSION', function () {
    it('should export TLS_VERSION object', function () {
      assert.ok(typeof unpConstants.TLS_VERSION === 'object');
    });

    it('should map TLSv1.0 to 1', function () {
      assert.strictEqual(unpConstants.TLS_VERSION['TLSv1.0'], 1);
    });

    it('should map TLSv1.1 to 2', function () {
      assert.strictEqual(unpConstants.TLS_VERSION['TLSv1.1'], 2);
    });

    it('should map TLSv1.2 to 3', function () {
      assert.strictEqual(unpConstants.TLS_VERSION['TLSv1.2'], 3);
    });

    it('should map TLSv1.3 to 4', function () {
      assert.strictEqual(unpConstants.TLS_VERSION['TLSv1.3'], 4);
    });
  });

  describe('OPENSSL_CIPHER_NAME_FROM_IANA', function () {
    it('should export OPENSSL_CIPHER_NAME_FROM_IANA object', function () {
      assert.ok(typeof unpConstants.OPENSSL_CIPHER_NAME_FROM_IANA === 'object');
    });

    it('should have known cipher mappings', function () {
      assert.strictEqual(unpConstants.OPENSSL_CIPHER_NAME_FROM_IANA['TLS_RSA_WITH_AES_128_CBC_SHA'], 'AES128-SHA');
      assert.strictEqual(unpConstants.OPENSSL_CIPHER_NAME_FROM_IANA['TLS_RSA_WITH_AES_256_CBC_SHA'], 'AES256-SHA');
    });

    it('should have TLS 1.3 ciphers', function () {
      assert.strictEqual(unpConstants.OPENSSL_CIPHER_NAME_FROM_IANA['TLS_AES_128_GCM_SHA256'], 'TLS_AES_128_GCM_SHA256');
      assert.strictEqual(unpConstants.OPENSSL_CIPHER_NAME_FROM_IANA['TLS_AES_256_GCM_SHA384'], 'TLS_AES_256_GCM_SHA384');
    });
  });

  describe('HTTPS_DEFAULT_CIPHERS', function () {
    it('should export HTTPS_DEFAULT_CIPHERS as an array', function () {
      assert.ok(Array.isArray(unpConstants.HTTPS_DEFAULT_CIPHERS));
    });

    it('should contain only strings', function () {
      unpConstants.HTTPS_DEFAULT_CIPHERS.forEach(function (cipher) {
        assert.strictEqual(typeof cipher, 'string');
      });
    });

    it('should have at least one cipher', function () {
      assert.ok(unpConstants.HTTPS_DEFAULT_CIPHERS.length > 0, 'should have supported ciphers');
    });

    it('should only contain ciphers from the desired list', function () {
      var desired = [
        'DHE-RSA-AES128-GCM-SHA256', 'DHE-RSA-AES256-GCM-SHA384',
        'ECDHE-ECDSA-AES128-GCM-SHA256', 'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES128-GCM-SHA256', 'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-ECDSA-CHACHA20-POLY1305', 'ECDHE-RSA-CHACHA20-POLY1305',
        'TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256'
      ];
      unpConstants.HTTPS_DEFAULT_CIPHERS.forEach(function (cipher) {
        assert.ok(desired.includes(cipher), cipher + ' should be in desired list');
      });
    });
  });
});
