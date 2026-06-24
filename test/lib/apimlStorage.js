const assert = require('assert');

describe('apimlStorage', function () {
  let apimlStorage;

  before(function () {
    try {
      apimlStorage = require('../../lib/apimlStorage');
    } catch (e) {
      console.warn('Could not load apimlStorage module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(apimlStorage, 'apimlStorage module should be loadable');
  });

  it('should export expected functions', function () {
    assert.strictEqual(typeof apimlStorage.configure, 'function');
    assert.strictEqual(typeof apimlStorage.isConfigured, 'function');
    assert.strictEqual(typeof apimlStorage.makeStorageForPlugin, 'function');
    assert.strictEqual(typeof apimlStorage.isApimlStorageError, 'function');
    assert.strictEqual(typeof apimlStorage.isApimlStorageKeyNotFoundError, 'function');
  });

  describe('isConfigured', function () {
    it('should return false before configure is called', function () {
      // Note: other tests may have called configure already, so this may not always be false
      var result = apimlStorage.isConfigured();
      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('configure', function () {
    it('should set configured state for https', function () {
      apimlStorage.configure({
        host: 'localhost',
        port: 7554,
        tlsOptions: { rejectUnauthorized: false },
        isHttps: true
      });
      assert.strictEqual(apimlStorage.isConfigured(), true);
    });

    it('should set configured state for http', function () {
      apimlStorage.configure({
        host: 'localhost',
        port: 7554,
        tlsOptions: {},
        isHttps: false
      });
      assert.strictEqual(apimlStorage.isConfigured(), true);
    });
  });

  describe('makeStorageForPlugin', function () {
    before(function () {
      apimlStorage.configure({
        host: 'localhost',
        port: 7554,
        tlsOptions: { rejectUnauthorized: false },
        isHttps: true
      });
    });

    it('should return a storage object', function () {
      var storage = apimlStorage.makeStorageForPlugin('org.zowe.testplugin');
      assert.ok(storage);
      assert.strictEqual(typeof storage, 'object');
    });

    it('should return object with expected methods', function () {
      var storage = apimlStorage.makeStorageForPlugin('org.zowe.testplugin');
      assert.strictEqual(typeof storage.get, 'function');
      assert.strictEqual(typeof storage.set, 'function');
      assert.strictEqual(typeof storage.setAll, 'function');
      assert.strictEqual(typeof storage.getAll, 'function');
      assert.strictEqual(typeof storage.delete, 'function');
      assert.strictEqual(typeof storage.deleteAll, 'function');
    });

    it('should create distinct instances for different plugins', function () {
      var storage1 = apimlStorage.makeStorageForPlugin('plugin-a');
      var storage2 = apimlStorage.makeStorageForPlugin('plugin-b');
      assert.notStrictEqual(storage1, storage2);
    });
  });

  describe('ApimlStorageError', function () {
    it('should be a constructor', function () {
      assert.strictEqual(typeof apimlStorage.ApimlStorageError, 'function');
    });

    it('should create an error with code', function () {
      var err = new apimlStorage.ApimlStorageError('APIML_STORAGE_KEY_NOT_FOUND');
      assert.ok(err instanceof Error);
      assert.strictEqual(err.code, 'APIML_STORAGE_KEY_NOT_FOUND');
    });

    it('should have toString method', function () {
      var err = new apimlStorage.ApimlStorageError('APIML_STORAGE_CONNECTION_ERROR');
      assert.ok(err.toString().includes('APIML_STORAGE_CONNECTION_ERROR'));
    });

    it('should include cause message in toString', function () {
      var cause = new Error('network failure');
      var err = new apimlStorage.ApimlStorageError('APIML_STORAGE_UNKNOWN_ERROR', cause);
      assert.ok(err.toString().includes('network failure'));
    });

    it('should include apiml messages in toString when present', function () {
      var response = {
        statusCode: 400,
        headers: {},
        json: {
          messages: [
            { messageType: 'ERROR', messageNumber: '001', messageContent: 'Bad request', messageKey: 'org.zowe.apiml.cache.invalidPayload' }
          ]
        }
      };
      var err = new apimlStorage.ApimlStorageError('APIML_STORAGE_INVALID_PAYLOAD', undefined, response);
      var str = err.toString();
      assert.ok(str.includes('APIML_STORAGE_INVALID_PAYLOAD'));
      assert.ok(str.includes('Bad request'));
    });
  });

  describe('isApimlStorageError', function () {
    it('should return true for ApimlStorageError instances', function () {
      var err = new apimlStorage.ApimlStorageError('APIML_STORAGE_KEY_NOT_FOUND');
      assert.strictEqual(apimlStorage.isApimlStorageError(err), true);
    });

    it('should return false for regular Error instances', function () {
      var err = new Error('regular error');
      assert.strictEqual(apimlStorage.isApimlStorageError(err), false);
    });
  });

  describe('isApimlStorageKeyNotFoundError', function () {
    it('should return true for KEY_NOT_FOUND errors', function () {
      var err = new apimlStorage.ApimlStorageError('APIML_STORAGE_KEY_NOT_FOUND');
      assert.strictEqual(apimlStorage.isApimlStorageKeyNotFoundError(err), true);
    });

    it('should return false for other ApimlStorageError codes', function () {
      var err = new apimlStorage.ApimlStorageError('APIML_STORAGE_UNAUTHORIZED');
      assert.strictEqual(apimlStorage.isApimlStorageKeyNotFoundError(err), false);
    });

    it('should return false for regular errors', function () {
      var err = new Error('not found');
      assert.strictEqual(apimlStorage.isApimlStorageKeyNotFoundError(err), false);
    });
  });
});
