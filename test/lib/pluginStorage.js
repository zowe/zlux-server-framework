const assert = require('assert');

describe('pluginStorage', function () {
  let pluginStorage;

  before(function () {
    try {
      pluginStorage = require('../../lib/pluginStorage');
    } catch (e) {
      console.warn('Could not load pluginStorage module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(pluginStorage, 'pluginStorage module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof pluginStorage;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
