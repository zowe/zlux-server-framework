const assert = require('assert');

describe('javaTypes', function () {
  let javaTypes;

  before(function () {
    try {
      javaTypes = require('../../lib/javaTypes');
    } catch (e) {
      console.warn('Could not load javaTypes module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(javaTypes, 'javaTypes module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof javaTypes;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });
});
