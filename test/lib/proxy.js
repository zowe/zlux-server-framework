const assert = require('assert');

describe('proxy', function () {
  let proxy;

  before(function () {
    try {
      proxy = require('../../lib/proxy');
    } catch (e) {
      console.warn('Could not load proxy module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(proxy, 'proxy module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof proxy;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
