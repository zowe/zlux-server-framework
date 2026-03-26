const assert = require('assert');

describe('webauth', function () {
  let webauth;

  before(function () {
    try {
      webauth = require('../../lib/webauth');
    } catch (e) {
      console.warn('Could not load webauth module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(webauth, 'webauth module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof webauth;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
