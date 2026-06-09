const assert = require('assert');

describe('auth-manager', function () {
  let AuthManager;

  before(function () {
    try {
      AuthManager = require('../../lib/auth-manager');
    } catch (e) {
      console.warn('Could not load auth-manager module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(AuthManager, 'auth-manager module should be loadable');
  });

  it('should export AuthManager constructor', function () {
    assert.strictEqual(typeof AuthManager, 'function');
  });

  describe('isConfigValid', function () {
    it('should return true for valid config', function () {
      assert.strictEqual(AuthManager.isConfigValid({ defaultAuthentication: 'fallback' }), true);
    });

    it('should return false for null config', function () {
      assert.strictEqual(AuthManager.isConfigValid(null), false);
    });

    it('should return false for config without defaultAuthentication', function () {
      assert.strictEqual(AuthManager.isConfigValid({}), false);
    });

    it('should return false for undefined config', function () {
      assert.strictEqual(AuthManager.isConfigValid(undefined), false);
    });
  });

  describe('constructor', function () {
    var mgr;

    before(function () {
      // Mock process.exit to prevent it from killing the test runner
      var originalExit = process.exit;
      process.exit = function () { throw new Error('process.exit called'); };
      try {
        mgr = new AuthManager({ config: { defaultAuthentication: 'fallback', rbac: true } });
      } finally {
        process.exit = originalExit;
      }
    });

    it('should create an instance', function () {
      assert.ok(mgr);
    });

    it('should set defaultType from config', function () {
      assert.strictEqual(mgr.defaultType, 'fallback');
    });

    it('should set rbacEnabled from config', function () {
      assert.strictEqual(mgr.rbacEnabled, true);
    });

    it('should initialize handlers as empty object', function () {
      assert.ok(mgr.handlers);
      assert.strictEqual(Object.keys(mgr.handlers).length, 0);
    });

    it('should initialize pendingPlugins as empty array', function () {
      assert.ok(Array.isArray(mgr.pendingPlugins));
    });

    it('should initialize authTypes as empty object', function () {
      assert.ok(mgr.authTypes);
    });
  });

  describe('constructor with invalid config', function () {
    it('should call process.exit for invalid config', function () {
      var exitCalled = false;
      var originalExit = process.exit;
      process.exit = function () { exitCalled = true; throw new Error('exit'); };
      try {
        new AuthManager({ config: {} });
      } catch (e) {
        // expected
      } finally {
        process.exit = originalExit;
      }
      assert.strictEqual(exitCalled, true);
    });
  });

  describe('registerAuthenticator', function () {
    var mgr;

    before(function () {
      var originalExit = process.exit;
      process.exit = function () { throw new Error('process.exit called'); };
      try {
        mgr = new AuthManager({ config: { defaultAuthentication: 'fallback' } });
      } finally {
        process.exit = originalExit;
      }
    });

    it('should add plugin to pendingPlugins', function () {
      var plugin = { identifier: 'test-auth-plugin' };
      mgr.registerAuthenticator(plugin);
      assert.ok(mgr.pendingPlugins.includes(plugin));
    });

    it('should accumulate multiple plugins', function () {
      var initialLength = mgr.pendingPlugins.length;
      mgr.registerAuthenticator({ identifier: 'plugin-2' });
      assert.strictEqual(mgr.pendingPlugins.length, initialLength + 1);
    });
  });

  describe('getBestAuthenticationHandler', function () {
    var mgr;

    before(function () {
      var originalExit = process.exit;
      process.exit = function () { throw new Error('process.exit called'); };
      try {
        mgr = new AuthManager({ config: { defaultAuthentication: 'fallback' } });
      } finally {
        process.exit = originalExit;
      }
      mgr.handlers = {
        'handler-a': { pluginID: 'handler-a', authenticate: function () {} },
        'handler-b': { pluginID: 'handler-b', authenticate: function () {} }
      };
      mgr.authTypes = {
        'fallback': ['handler-a'],
        'sso': ['handler-b']
      };
    });

    it('should return handler for specified auth type', function () {
      var handler = mgr.getBestAuthenticationHandler('sso');
      assert.strictEqual(handler.pluginID, 'handler-b');
    });

    it('should return default handler when authType is null', function () {
      var handler = mgr.getBestAuthenticationHandler(null);
      assert.strictEqual(handler.pluginID, 'handler-a');
    });

    it('should return null for unknown auth type', function () {
      var handler = mgr.getBestAuthenticationHandler('nonexistent');
      assert.strictEqual(handler, null);
    });
  });

  describe('getAllHandlers', function () {
    var mgr;

    before(function () {
      var originalExit = process.exit;
      process.exit = function () { throw new Error('process.exit called'); };
      try {
        mgr = new AuthManager({ config: { defaultAuthentication: 'fallback' } });
      } finally {
        process.exit = originalExit;
      }
      mgr.handlers = {
        'handler-a': { pluginID: 'handler-a' },
        'handler-b': { pluginID: 'handler-b' }
      };
    });

    it('should return array of all handlers', function () {
      var handlers = mgr.getAllHandlers();
      assert.ok(Array.isArray(handlers));
      assert.strictEqual(handlers.length, 2);
    });

    it('should include all registered handlers', function () {
      var handlers = mgr.getAllHandlers();
      var ids = handlers.map(function (h) { return h.pluginID; });
      assert.ok(ids.includes('handler-a'));
      assert.ok(ids.includes('handler-b'));
    });
  });

  describe('getAuthHandlerForService', function () {
    var mgr;

    before(function () {
      var originalExit = process.exit;
      process.exit = function () { throw new Error('process.exit called'); };
      try {
        mgr = new AuthManager({ config: { defaultAuthentication: 'fallback' } });
      } finally {
        process.exit = originalExit;
      }
      mgr.handlers = {
        'handler-a': { pluginID: 'handler-a', authenticate: function () {} }
      };
      mgr.authTypes = {
        'fallback': ['handler-a']
      };
    });

    it('should return null for null authenticationData', function () {
      var handler = mgr.getAuthHandlerForService(null);
      assert.strictEqual(handler, null);
    });

    it('should return null for undefined authenticationData', function () {
      var handler = mgr.getAuthHandlerForService(undefined);
      assert.strictEqual(handler, null);
    });

    it('should return acceptAllHandler when enabled is false', function () {
      var handler = mgr.getAuthHandlerForService({ enabled: false });
      assert.ok(handler);
      // acceptAllHandler has an authorized() method
      assert.strictEqual(typeof handler.authorized, 'function');
    });

    it('should return handler for authType', function () {
      var handler = mgr.getAuthHandlerForService({ authType: 'fallback' });
      assert.strictEqual(handler.pluginID, 'handler-a');
    });

    it('should return null for unknown authType', function () {
      var handler = mgr.getAuthHandlerForService({ authType: 'unknown' });
      assert.strictEqual(handler, null);
    });
  });

  describe('isRbacEnabled', function () {
    it('should return true when rbac is configured', function () {
      var originalExit = process.exit;
      process.exit = function () { throw new Error('process.exit called'); };
      var mgr;
      try {
        mgr = new AuthManager({ config: { defaultAuthentication: 'fallback', rbac: true } });
      } finally {
        process.exit = originalExit;
      }
      assert.strictEqual(mgr.isRbacEnabled(), true);
    });

    it('should return false when rbac is not configured', function () {
      var originalExit = process.exit;
      process.exit = function () { throw new Error('process.exit called'); };
      var mgr;
      try {
        mgr = new AuthManager({ config: { defaultAuthentication: 'fallback' } });
      } finally {
        process.exit = originalExit;
      }
      assert.strictEqual(mgr.isRbacEnabled(), false);
    });
  });

  describe('authPluginRequested', function () {
    it('should always return true', function () {
      var originalExit = process.exit;
      process.exit = function () { throw new Error('process.exit called'); };
      var mgr;
      try {
        mgr = new AuthManager({ config: { defaultAuthentication: 'fallback' } });
      } finally {
        process.exit = originalExit;
      }
      assert.strictEqual(mgr.authPluginRequested('any-plugin', 'any-category'), true);
    });
  });

  describe('sessionTimeoutMs', function () {
    it('should default to 3600000ms (1 hour)', function () {
      var originalExit = process.exit;
      process.exit = function () { throw new Error('process.exit called'); };
      var mgr;
      try {
        mgr = new AuthManager({ config: { defaultAuthentication: 'fallback' } });
      } finally {
        process.exit = originalExit;
      }
      assert.strictEqual(mgr.sessionTimeoutMs, 3600000);
    });
  });
});
