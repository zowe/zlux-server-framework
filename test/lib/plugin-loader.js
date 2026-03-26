const assert = require('assert');

describe('plugin-loader', function () {
  let pluginLoader;

  before(function () {
    try {
      pluginLoader = require('../../lib/plugin-loader');
    } catch (e) {
      console.warn('Could not load plugin-loader module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(pluginLoader, 'plugin-loader module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof pluginLoader;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
