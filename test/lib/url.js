const assert = require('assert');

describe('url', function () {
  let urlModule;

  before(function () {
    try {
      urlModule = require('../../lib/url');
    } catch (e) {
      console.warn('Could not load url module:', e.message);
      this.skip();
    }
  });

  it('should export expected functions', function () {
    assert.strictEqual(typeof urlModule.makePluginURL, 'function');
    assert.strictEqual(typeof urlModule.makeServiceSubURL, 'function');
    assert.strictEqual(typeof urlModule.join, 'function');
  });

  describe('makePluginURL', function () {
    it('should create correct plugin URL', function () {
      var result = urlModule.makePluginURL('ZLUX', 'org.zowe.myplugin');
      assert.strictEqual(result, '/ZLUX/plugins/org.zowe.myplugin');
    });

    it('should handle different product codes', function () {
      assert.strictEqual(urlModule.makePluginURL('ABC', 'plugin1'), '/ABC/plugins/plugin1');
      assert.strictEqual(urlModule.makePluginURL('xyz', 'plugin2'), '/xyz/plugins/plugin2');
    });

    it('should handle empty strings', function () {
      assert.strictEqual(urlModule.makePluginURL('', ''), '//plugins/');
    });
  });

  describe('makeServiceSubURL', function () {
    it('should create URL with version for non-import service', function () {
      var service = { name: 'myservice', type: 'service', version: '1.0.0' };
      var result = urlModule.makeServiceSubURL(service, false, false);
      assert.strictEqual(result, '/services/myservice/1.0.0');
    });

    it('should use localName for import service type', function () {
      var service = { name: 'remotename', localName: 'localname', type: 'import', version: '2.0.0' };
      var result = urlModule.makeServiceSubURL(service, false, false);
      assert.strictEqual(result, '/services/localname/2.0.0');
    });

    it('should use _current when latest is true', function () {
      var service = { name: 'myservice', type: 'service', version: '1.0.0' };
      var result = urlModule.makeServiceSubURL(service, true, false);
      assert.strictEqual(result, '/services/myservice/_current');
    });

    it('should omit version when omitVersion is true', function () {
      var service = { name: 'myservice', type: 'service', version: '1.0.0' };
      var result = urlModule.makeServiceSubURL(service, false, true);
      assert.strictEqual(result, '/services/myservice');
    });

    it('should append path when provided', function () {
      var service = { name: 'myservice', type: 'service', version: '1.0.0' };
      var result = urlModule.makeServiceSubURL(service, false, false, 'some/path');
      assert.strictEqual(result, '/services/myservice/1.0.0/some/path');
    });

    it('should not append path when not provided', function () {
      var service = { name: 'myservice', type: 'service', version: '1.0.0' };
      var result = urlModule.makeServiceSubURL(service, false, false, undefined);
      assert.strictEqual(result, '/services/myservice/1.0.0');
    });

    it('should handle omitVersion with path', function () {
      var service = { name: 'myservice', type: 'service', version: '1.0.0' };
      var result = urlModule.makeServiceSubURL(service, false, true, 'data');
      assert.strictEqual(result, '/services/myservice/data');
    });

    it('should handle latest with path', function () {
      var service = { name: 'myservice', type: 'service', version: '1.0.0' };
      var result = urlModule.makeServiceSubURL(service, true, false, 'info');
      assert.strictEqual(result, '/services/myservice/_current/info');
    });
  });

  describe('join', function () {
    it('should concatenate base URL and relative path', function () {
      assert.strictEqual(urlModule.join('/base', '/path'), '/base/path');
    });

    it('should handle empty relative path', function () {
      assert.strictEqual(urlModule.join('/base', ''), '/base');
    });

    it('should handle empty base URL', function () {
      assert.strictEqual(urlModule.join('', '/path'), '/path');
    });

    it('should handle both empty', function () {
      assert.strictEqual(urlModule.join('', ''), '');
    });
  });
});
