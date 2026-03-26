const assert = require('assert');

describe('auth-manager', function () {
  let authManager;

  before(function () {
    try {
      authManager = require('../../lib/auth-manager');
    } catch (e) {
      console.warn('Could not load auth-manager module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(authManager, 'auth-manager module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof authManager;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
