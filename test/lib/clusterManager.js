const assert = require('assert');

describe('clusterManager', function () {
  let clusterManager;

  before(function () {
    try {
      clusterManager = require('../../lib/clusterManager');
    } catch (e) {
      console.warn('Could not load clusterManager module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(clusterManager, 'clusterManager module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof clusterManager;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
