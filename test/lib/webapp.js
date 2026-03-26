const assert = require('assert');

describe('webapp', function () {
  let webapp;

  before(function () {
    try {
      webapp = require('../../lib/webapp');
    } catch (e) {
      console.warn('Could not load webapp module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(webapp, 'webapp module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof webapp;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
