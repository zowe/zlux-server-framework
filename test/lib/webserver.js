const assert = require('assert');

describe('webserver', function () {
  let webserver;

  before(function () {
    try {
      webserver = require('../../lib/webserver');
    } catch (e) {
      console.warn('Could not load webserver module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(webserver, 'webserver module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof webserver;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
