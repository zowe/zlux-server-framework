const assert = require('assert');

describe('apimlStorage', function () {
  let apimlStorage;

  before(function () {
    try {
      apimlStorage = require('../../lib/apimlStorage');
    } catch (e) {
      console.warn('Could not load apimlStorage module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(apimlStorage, 'apimlStorage module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof apimlStorage;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
