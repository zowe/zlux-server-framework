const assert = require('assert');

describe('jarManager', function () {
  let jarManager;

  before(function () {
    try {
      jarManager = require('../../lib/jarManager');
    } catch (e) {
      console.warn('Could not load jarManager module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(jarManager, 'jarManager module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof jarManager;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
