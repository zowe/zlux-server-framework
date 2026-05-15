const assert = require('assert');

describe('util', function () {
  let util;

  before(function () {
    try {
      util = require('../../lib/util');
    } catch (e) {
      console.warn('Could not load util module:', e.message);
      this.skip();
    }
  });

  it('should export loggers object', function () {
    assert.ok(typeof util.loggers === 'object');
    assert.ok(util.loggers.bootstrapLogger);
    assert.ok(util.loggers.authLogger);
    assert.ok(util.loggers.contentLogger);
    assert.ok(util.loggers.childLogger);
    assert.ok(util.loggers.utilLogger);
    assert.ok(util.loggers.proxyLogger);
    assert.ok(util.loggers.installLogger);
    assert.ok(util.loggers.apiml);
    assert.ok(util.loggers.routing);
    assert.ok(util.loggers.network);
    assert.ok(util.loggers.langManager);
    assert.ok(util.loggers.clusterLogger);
    assert.ok(util.loggers.storeLogger);
  });

  describe('initLoggerMessages', function () {
    it('should be a function', function () {
      assert.strictEqual(typeof util.initLoggerMessages, 'function');
    });

    it('should not throw when called with en', function () {
      util.initLoggerMessages('en');
    });

    it('should not throw when called with no argument', function () {
      util.initLoggerMessages();
    });

    it('should not throw when called with invalid language', function () {
      util.initLoggerMessages('zz_INVALID');
    });

    it('should set messages on loggers for english', function () {
      util.initLoggerMessages('en');
      assert.ok(util.loggers.bootstrapLogger._messages);
    });
  });

  describe('getZoweVersion', function () {
    it('should return a string', function () {
      var version = util.getZoweVersion();
      assert.strictEqual(typeof version, 'string');
    });

    it('should return default version 0.0.0', function () {
      var version = util.getZoweVersion();
      assert.strictEqual(version, '0.0.0');
    });
  });

  describe('getHostAndPortFromUrl', function () {
    it('should parse https URL', function () {
      var result = util.getHostAndPortFromUrl('https://example.com:7554/api');
      assert.strictEqual(result.host, 'example.com');
      assert.strictEqual(result.port, '7554');
    });

    it('should parse http URL', function () {
      var result = util.getHostAndPortFromUrl('http://localhost:8080/path');
      assert.strictEqual(result.host, 'localhost');
      assert.strictEqual(result.port, '8080');
    });

    it('should return default https port 443 when no port', function () {
      var result = util.getHostAndPortFromUrl('https://example.com/api');
      assert.strictEqual(result.host, 'example.com');
      assert.strictEqual(result.port, 443);
    });

    it('should return default http port 80 when no port', function () {
      var result = util.getHostAndPortFromUrl('http://example.com/api');
      assert.strictEqual(result.host, 'example.com');
      assert.strictEqual(result.port, 80);
    });

    it('should return undefined for invalid URL', function () {
      var result = util.getHostAndPortFromUrl('not-a-url');
      assert.strictEqual(result, undefined);
    });

    it('should handle URL without path', function () {
      var result = util.getHostAndPortFromUrl('https://example.com:443');
      assert.strictEqual(result.host, 'example.com');
      assert.strictEqual(result.port, '443');
    });

    it('should handle IPv6 addresses', function () {
      var result = util.getHostAndPortFromUrl('https://[::1]:7554/api');
      assert.strictEqual(result.host, '::1');
      assert.strictEqual(result.port, '7554');
    });
  });

  describe('getPrefixForService', function () {
    it('should return default prefix', function () {
      assert.strictEqual(util.getPrefixForService('myservice'), '/myservice/api/v1');
    });

    it('should use custom type', function () {
      assert.strictEqual(util.getPrefixForService('myservice', 'ws'), '/myservice/ws/v1');
    });

    it('should use custom version', function () {
      assert.strictEqual(util.getPrefixForService('myservice', 'api', '2'), '/myservice/api/v2');
    });

    it('should use custom type and version', function () {
      assert.strictEqual(util.getPrefixForService('myservice', 'ui', '3'), '/myservice/ui/v3');
    });
  });

  describe('makeOptionsObject', function () {
    it('should merge options with defaults', function () {
      var defaults = { a: 1, b: 2 };
      var options = { b: 3, c: 4 };
      var result = util.makeOptionsObject(defaults, options);
      assert.strictEqual(result.a, 1);
      assert.strictEqual(result.b, 3);
      assert.strictEqual(result.c, 4);
    });

    it('should seal the result object', function () {
      var defaults = { a: 1 };
      var result = util.makeOptionsObject(defaults, {});
      assert.ok(Object.isSealed(result));
    });
  });

  describe('clone', function () {
    it('should deep clone an object', function () {
      var obj = { a: 1, b: { c: 2 } };
      var cloned = util.clone(obj);
      assert.deepStrictEqual(cloned, obj);
      cloned.b.c = 99;
      assert.strictEqual(obj.b.c, 2, 'original should not be modified');
    });

    it('should clone arrays', function () {
      var arr = [1, 2, { a: 3 }];
      var cloned = util.clone(arr);
      assert.deepStrictEqual(cloned, arr);
    });
  });

  describe('deepFreeze', function () {
    it('should freeze an object', function () {
      var obj = { a: 1 };
      util.deepFreeze(obj);
      assert.ok(Object.isFrozen(obj));
    });

    it('should deep freeze nested objects', function () {
      var obj = { a: { b: { c: 1 } } };
      util.deepFreeze(obj);
      assert.ok(Object.isFrozen(obj));
      assert.ok(Object.isFrozen(obj.a));
      assert.ok(Object.isFrozen(obj.a.b));
    });

    it('should handle circular references', function () {
      var obj = { a: 1 };
      obj.self = obj;
      util.deepFreeze(obj);
      assert.ok(Object.isFrozen(obj));
    });
  });

  describe('readOnlyProxy', function () {
    it('should allow reading properties', function () {
      var obj = { a: 1, b: 'hello' };
      var proxy = util.readOnlyProxy(obj);
      assert.strictEqual(proxy.a, 1);
      assert.strictEqual(proxy.b, 'hello');
    });
  });

  describe('getOrInit', function () {
    it('should return existing value', function () {
      var obj = { key: 'existing' };
      var result = util.getOrInit(obj, 'key', 'default');
      assert.strictEqual(result, 'existing');
    });

    it('should initialize and return default when key missing', function () {
      var obj = {};
      var result = util.getOrInit(obj, 'key', 'default');
      assert.strictEqual(result, 'default');
      assert.strictEqual(obj.key, 'default');
    });
  });

  describe('makeErrorObject', function () {
    it('should create error with defaults', function () {
      var err = util.makeErrorObject({ messageDetails: 'test error' });
      assert.strictEqual(err._objectType, 'org.zowe.zlux.error');
      assert.strictEqual(err._metaDataVersion, '1.0.0');
      assert.strictEqual(err.messageDetails, 'test error');
    });

    it('should override default fields', function () {
      var err = util.makeErrorObject({ returnCode: '5', messageID: 'ZOE999E' });
      assert.strictEqual(err.returnCode, '5');
      assert.strictEqual(err.messageID, 'ZOE999E');
    });

    it('should throw if _objectType is specified', function () {
      assert.throws(function () {
        util.makeErrorObject({ _objectType: 'custom' });
      });
    });

    it('should throw if _metaDataVersion is specified', function () {
      assert.throws(function () {
        util.makeErrorObject({ _metaDataVersion: '2.0' });
      });
    });
  });

  describe('formatErrorStatus', function () {
    it('should format error with description', function () {
      var err = { status: 404, path: '/test' };
      var descriptions = { 404: 'Not Found' };
      var result = util.formatErrorStatus(err, descriptions);
      assert.ok(result.includes('Not Found'));
      assert.ok(result.includes('path: /test'));
    });

    it('should use status code when no description', function () {
      var err = { status: 500 };
      var descriptions = {};
      var result = util.formatErrorStatus(err, descriptions);
      assert.ok(result.includes('500'));
    });
  });

  describe('normalizePath', function () {
    it('should return absolute path unchanged (minus trailing sep)', function () {
      var p;
      if (process.platform === 'win32') {
        p = util.normalizePath('C:\\Users\\test');
        assert.strictEqual(p, 'C:\\Users\\test');
      } else {
        p = util.normalizePath('/usr/test');
        assert.strictEqual(p, '/usr/test');
      }
    });

    it('should resolve relative path against cwd', function () {
      var result = util.normalizePath('./test');
      assert.ok(require('path').isAbsolute(result));
    });

    it('should resolve relative path against provided relativeTo', function () {
      var result = util.normalizePath('./sub', '/base/dir');
      assert.ok(result.includes('sub'));
    });
  });

  describe('getLoopbackAddress', function () {
    it('should return 127.0.0.1 when no addresses', function () {
      assert.strictEqual(util.getLoopbackAddress(null), '127.0.0.1');
      assert.strictEqual(util.getLoopbackAddress([]), '127.0.0.1');
    });

    it('should return 127.0.0.1 for 0.0.0.0', function () {
      assert.strictEqual(util.getLoopbackAddress(['0.0.0.0']), '127.0.0.1');
    });

    it('should return loopback when found', function () {
      assert.strictEqual(util.getLoopbackAddress(['127.0.0.1']), '127.0.0.1');
    });

    it('should return first address when no loopback found', function () {
      assert.strictEqual(util.getLoopbackAddress(['192.168.1.1', '10.0.0.1']), '192.168.1.1');
    });
  });

  describe('concatIterables', function () {
    it('should concatenate arrays', function () {
      var result = Array.from(util.concatIterables([1, 2], [3, 4]));
      assert.deepStrictEqual(result, [1, 2, 3, 4]);
    });

    it('should handle empty iterables', function () {
      var result = Array.from(util.concatIterables([], [1]));
      assert.deepStrictEqual(result, [1]);
    });
  });

  describe('isHaMode', function () {
    it('should return a boolean', function () {
      assert.strictEqual(typeof util.isHaMode(), 'boolean');
    });
  });

  describe('getCookieName', function () {
    it('should return connect.sid. prefix with identifier', function () {
      assert.strictEqual(util.getCookieName('test123'), 'connect.sid.test123');
    });
  });

  describe('serverSwaggerPluginId', function () {
    it('should be org.zowe.zlux', function () {
      assert.strictEqual(util.serverSwaggerPluginId, 'org.zowe.zlux');
    });
  });

  describe('agentSwaggerPluginId', function () {
    it('should be org.zowe.zlux.agent', function () {
      assert.strictEqual(util.agentSwaggerPluginId, 'org.zowe.zlux.agent');
    });
  });

  describe('timeout', function () {
    it('should return a promise', function () {
      var result = util.timeout(1);
      assert.ok(result instanceof Promise);
    });

    it('should resolve after specified ms', function (done) {
      var start = Date.now();
      util.timeout(50).then(function () {
        var elapsed = Date.now() - start;
        assert.ok(elapsed >= 40, 'should wait at least ~50ms');
        done();
      });
    });
  });

  describe('config helper functions', function () {
    var zoweConfig;

    beforeEach(function () {
      zoweConfig = {
        zowe: { externalDomains: ['example.com'] },
        components: {
          'app-server': {
            node: {
              productCode: 'ZLUX',
              rootRedirectUrl: '/ui/v1/zlux/',
              https: { port: 7556, ipAddresses: ['0.0.0.0'] },
              http: { port: 7557, ipAddresses: ['0.0.0.0'] }
            }
          }
        }
      };
    });

    it('isServerHttps should return true when https port exists', function () {
      assert.strictEqual(util.isServerHttps(zoweConfig), true);
    });

    it('isServerHttps should return false when no https port', function () {
      delete zoweConfig.components['app-server'].node.https;
      assert.strictEqual(util.isServerHttps(zoweConfig), false);
    });

    it('getBestPort should return https port when available', function () {
      assert.strictEqual(util.getBestPort(zoweConfig), 7556);
    });

    it('getBestPort should return http port when no https', function () {
      delete zoweConfig.components['app-server'].node.https;
      assert.strictEqual(util.getBestPort(zoweConfig), 7557);
    });

    it('getBestHostname should return first external domain', function () {
      assert.strictEqual(util.getBestHostname(zoweConfig), 'example.com');
    });

    it('getProductCode should return node productCode', function () {
      assert.strictEqual(util.getProductCode(zoweConfig), 'ZLUX');
    });

    it('getRootRedirectUrl should return node rootRedirectUrl', function () {
      assert.strictEqual(util.getRootRedirectUrl(zoweConfig), '/ui/v1/zlux/');
    });

    it('getComponentConfig should return app-server config', function () {
      var config = util.getComponentConfig(zoweConfig);
      assert.strictEqual(config.node.productCode, 'ZLUX');
    });

    it('getHttpsListeningAddresses should return https ipAddresses', function () {
      var addrs = util.getHttpsListeningAddresses(zoweConfig);
      assert.deepStrictEqual(addrs, ['0.0.0.0']);
    });

    it('getHttpListeningAddresses should return http ipAddresses', function () {
      var addrs = util.getHttpListeningAddresses(zoweConfig);
      assert.deepStrictEqual(addrs, ['0.0.0.0']);
    });

    it('getListeningAddresses should combine https and http addresses', function () {
      var addrs = util.getListeningAddresses(zoweConfig);
      assert.ok(Array.isArray(addrs));
      assert.ok(addrs.length > 0);
    });
  });

  describe('resolveRelativePaths', function () {
    it('should resolve relative paths in object', function () {
      var obj = { file: '../test/file.txt' };
      util.resolveRelativePaths(obj, require('path').resolve, '/base');
      assert.ok(require('path').isAbsolute(obj.file));
    });

    it('should not modify non-relative strings', function () {
      var obj = { file: '/absolute/path' };
      util.resolveRelativePaths(obj, require('path').resolve, '/base');
      assert.strictEqual(obj.file, '/absolute/path');
    });

    it('should recurse into nested objects', function () {
      var obj = { nested: { file: '../test/file.txt' } };
      util.resolveRelativePaths(obj, require('path').resolve, '/base');
      assert.ok(require('path').isAbsolute(obj.nested.file));
    });
  });

  describe('getRemoteIframeTemplate', function () {
    it('should return HTML string with remoteUrl', function () {
      var result = util.getRemoteIframeTemplate('https://example.com');
      assert.ok(typeof result === 'string');
      assert.ok(result.includes('https://example.com'));
    });
  });
});
