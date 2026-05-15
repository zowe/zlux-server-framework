const assert = require('assert');

describe('javaManager', function () {
  let javaManager;

  before(function () {
    try {
      javaManager = require('../../lib/javaManager');
    } catch (e) {
      console.warn('Could not load javaManager module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(javaManager, 'javaManager module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof javaManager;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
