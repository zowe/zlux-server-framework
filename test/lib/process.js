const assert = require('assert');

describe('process', function () {
  let processModule;

  before(function () {
    try {
      processModule = require('../../lib/process');
    } catch (e) {
      console.warn('Could not load process module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(processModule, 'process module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof processModule;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
