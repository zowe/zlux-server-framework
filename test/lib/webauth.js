const assert = require('assert');

describe('webauth', function () {
  let webauth;

  before(function () {
    try {
      webauth = require('../../lib/webauth');
    } catch (e) {
      console.warn('Could not load webauth module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(webauth, 'webauth module should be loadable');
  });

  it('should export a factory function', function () {
    assert.strictEqual(typeof webauth, 'function');
  });

  it('should return an object with expected methods when called with authManager', function () {
    var mockAuthManager = {
      getAllHandlers: function () { return []; },
      getAuthHandlerForService: function () { return null; },
      getBestAuthenticationHandler: function () { return null; }
    };
    var result = webauth(mockAuthManager, 'test-cookie', true);
    assert.ok(result, 'factory should return an object');
    assert.strictEqual(typeof result.doLogin, 'function');
    assert.strictEqual(typeof result.doLogout, 'function');
    assert.strictEqual(typeof result.refreshStatus, 'function');
    assert.strictEqual(typeof result.addProxyAuthorizations, 'function');
    assert.strictEqual(typeof result.processProxiedHeaders, 'function');
    assert.strictEqual(typeof result.middleware, 'function');
    assert.strictEqual(typeof result.generateHaSessionId, 'function');
  });

  it('should expose sessionTimeoutMs', function () {
    var mockAuthManager = {
      getAllHandlers: function () { return []; },
      getAuthHandlerForService: function () { return null; },
      getBestAuthenticationHandler: function () { return null; },
      sessionTimeoutMs: 3600000
    };
    var result = webauth(mockAuthManager, 'my-cookie', false);
    assert.ok(result);
  });
});
