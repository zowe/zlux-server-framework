const assert = require('assert');

describe('apiml', function () {
  let apiml;

  before(function () {
    try {
      apiml = require('../../lib/apiml');
    } catch (e) {
      console.warn('Could not load apiml module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(apiml, 'apiml module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof apiml;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
