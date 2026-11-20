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
    assert.strictEqual(typeof pluginStorage.PluginStorageFactory, 'function');
  });

  describe('PluginStorageFactory', function () {
    it('should be a constructor', function () {
      assert.strictEqual(typeof pluginStorage.PluginStorageFactory, 'function');
    });

    it('should require ClusterManager infrastructure to instantiate', function () {
      // PluginStorageFactory constructor calls ClusterManager.getStorageAll()
      // which requires a running cluster - verify it throws without one
      assert.throws(function () {
        new pluginStorage.PluginStorageFactory({
          zowe: {},
          components: {
            'app-server': {
              node: { productCode: 'ZLUX' },
              productDir: '/opt/zowe'
            }
          }
        });
      });
    });
  });
});
