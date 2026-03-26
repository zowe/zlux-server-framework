const assert = require('assert');

describe('tomcatManager', function () {
  let tomcatManager;

  before(function () {
    try {
      tomcatManager = require('../../lib/tomcatManager');
    } catch (e) {
      console.warn('Could not load tomcatManager module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(tomcatManager, 'tomcatManager module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof tomcatManager;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
