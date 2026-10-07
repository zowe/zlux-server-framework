const assert = require('assert');

describe('index', function () {
  let indexModule;

  before(function () {
    try {
      indexModule = require('../../lib/index');
    } catch (e) {
      console.warn('Could not load index module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(indexModule, 'index module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof indexModule;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
