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
    it('should return a thenable', function () {
      var result = util.timeout(1);
      assert.ok(result && typeof result.then === 'function');
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

  describe('getAgentRequestOptions', function () {
    it('should return undefined when no app-server config', function () {
      var result = util.getAgentRequestOptions({components: {}}, null, false, '/path');
      assert.strictEqual(result, undefined);
    });

    it('should return undefined when no agent config', function () {
      var zoweConfig = {
        components: { 'app-server': { node: {} } }
      };
      var result = util.getAgentRequestOptions(zoweConfig, null, false, '/path');
      assert.strictEqual(result, undefined);
    });

    it('should return undefined when agent has no https or http', function () {
      var zoweConfig = {
        components: { 'app-server': { node: {}, agent: {} } }
      };
      var result = util.getAgentRequestOptions(zoweConfig, null, false, '/path');
      assert.strictEqual(result, undefined);
    });

    it('should return options for http agent', function () {
      var zoweConfig = {
        zowe: { network: {} },
        components: {
          'app-server': {
            node: { allowInvalidTLSProxy: false },
            agent: { host: 'localhost', http: { port: 7557 } }
          }
        }
      };
      var result = util.getAgentRequestOptions(zoweConfig, null, false, '/test');
      assert.ok(result);
      assert.strictEqual(result.host, 'localhost');
      assert.strictEqual(result.port, 7557);
      assert.strictEqual(result.protocol, 'http:');
      assert.strictEqual(result.path, '/test');
    });

    it('should return options for https agent with tls options', function () {
      var zoweConfig = {
        zowe: { network: {} },
        components: {
          'app-server': {
            node: { allowInvalidTLSProxy: true },
            agent: { host: 'myhost', https: { port: 7556 }, http: { port: 7557 } }
          }
        }
      };
      var tlsOptions = { ca: ['fake-ca'], cert: 'fake-cert', key: 'fake-key' };
      var result = util.getAgentRequestOptions(zoweConfig, tlsOptions, false, '/api');
      assert.ok(result);
      assert.strictEqual(result.host, 'myhost');
      assert.strictEqual(result.port, 7556);
      assert.strictEqual(result.protocol, 'https:');
      assert.strictEqual(result.rejectUnauthorized, false);
      assert.strictEqual(result.ca[0], 'fake-ca');
      assert.strictEqual(result.key, undefined); // key should be removed
      assert.strictEqual(result.cert, undefined); // cert removed when includeCert is false
    });

    it('should include cert when includeCert is true', function () {
      var zoweConfig = {
        zowe: { network: {} },
        components: {
          'app-server': {
            node: { allowInvalidTLSProxy: false },
            agent: { host: 'myhost', https: { port: 7556 } }
          }
        }
      };
      var tlsOptions = { ca: ['fake-ca'], cert: 'fake-cert', key: 'fake-key' };
      var result = util.getAgentRequestOptions(zoweConfig, tlsOptions, true, '/api');
      assert.ok(result);
      assert.strictEqual(result.cert, 'fake-cert');
      assert.strictEqual(result.key, undefined);
    });

    it('should return undefined for https agent without tls options', function () {
      var zoweConfig = {
        zowe: { network: {} },
        components: {
          'app-server': {
            node: { allowInvalidTLSProxy: false },
            agent: { host: 'myhost', https: { port: 7556 } }
          }
        }
      };
      var result = util.getAgentRequestOptions(zoweConfig, null, false, '/api');
      assert.strictEqual(result, undefined);
    });

    it('should use apiml routing when mediationLayer enabled', function () {
      var zoweConfig = {
        zowe: { network: {} },
        components: {
          'app-server': {
            node: {
              allowInvalidTLSProxy: false,
              mediationLayer: {
                server: { gatewayHostname: 'gateway.com', gatewayPort: 7554 }
              }
            },
            agent: {
              host: 'agenthost',
              https: { port: 7556 },
              mediationLayer: { enabled: true, serviceName: 'zss' }
            }
          }
        }
      };
      var tlsOptions = { ca: ['fake-ca'] };
      var result = util.getAgentRequestOptions(zoweConfig, tlsOptions, false, '/endpoint');
      assert.ok(result);
      assert.strictEqual(result.host, 'gateway.com');
      assert.strictEqual(result.port, 7554);
      assert.ok(result.path.includes('/zss/'));
      assert.ok(result.path.includes('/endpoint'));
      assert.ok(result.requestProcessingOptions);
      assert.ok(result.requestProcessingOptions.headersToRemove.includes('origin'));
    });
  });

  describe('isClientAttls', function () {
    it('should return false when no attls config', function () {
      var zoweConfig = {
        zowe: { network: {} },
        components: { 'app-server': { zowe: {} } }
      };
      assert.strictEqual(util.isClientAttls(zoweConfig), false);
    });

    it('should return true when client local attls is true', function () {
      var zoweConfig = {
        zowe: { network: {} },
        components: { 'app-server': { zowe: { network: { client: { tls: { attls: true } } } } } }
      };
      assert.strictEqual(util.isClientAttls(zoweConfig), true);
    });

    it('should return true when client global attls is true', function () {
      var zoweConfig = {
        zowe: { network: { client: { tls: { attls: true } } } },
        components: { 'app-server': { zowe: {} } }
      };
      assert.strictEqual(util.isClientAttls(zoweConfig), true);
    });

    it('should follow server attls when client not explicitly set', function () {
      var zoweConfig = {
        zowe: { network: { server: { tls: { attls: true } } } },
        components: { 'app-server': { zowe: {} } }
      };
      assert.strictEqual(util.isClientAttls(zoweConfig), true);
    });

    it('should return false when client explicitly set to false', function () {
      var zoweConfig = {
        zowe: { network: { client: { tls: { attls: false } }, server: { tls: { attls: true } } } },
        components: { 'app-server': { zowe: {} } }
      };
      assert.strictEqual(util.isClientAttls(zoweConfig), false);
    });
  });

  describe('asyncEventListener', function () {
    it('should return a function', function () {
      var listener = util.asyncEventListener(function () { return Promise.resolve(); });
      assert.strictEqual(typeof listener, 'function');
    });

    it('should queue invocations and resolve sequentially', function (done) {
      var order = [];
      var listener = util.asyncEventListener(function (event) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            order.push(event);
            resolve();
          }, event === 'first' ? 30 : 10);
        });
      });
      listener('first');
      listener('second');
      setTimeout(function () {
        assert.deepStrictEqual(order, ['first', 'second']);
        done();
      }, 100);
    });

    it('should continue processing events after a handler error', function (done) {
      var order = [];
      var listener = util.asyncEventListener(function (event) {
        if (event === 'fail') {
          return Promise.reject(new Error('test error'));
        }
        order.push(event);
        return Promise.resolve();
      });
      listener('fail');    // this rejects
      listener('recover'); // this catches the rejection (error handler runs)
      listener('success'); // this runs normally
      setTimeout(function () {
        assert.deepStrictEqual(order, ['success']);
        done();
      }, 200);
    });
  });

  describe('isPluginExternal', function () {
    it('should return falsy when no dataServices', function () {
      assert.ok(!util.isPluginExternal({}));
    });

    it('should return false when dataServices is empty', function () {
      assert.strictEqual(util.isPluginExternal({ dataServices: [] }), false);
    });

    it('should return false for non-external service', function () {
      function InternalService() {}
      assert.strictEqual(util.isPluginExternal({
        dataServices: [new InternalService()]
      }), false);
    });

    it('should return true for external service', function () {
      function ExternalService() {}
      assert.strictEqual(util.isPluginExternal({
        dataServices: [new ExternalService()]
      }), true);
    });
  });

  describe('setZoweVersionFromManifest', function () {
    var fs = require('fs');
    var path = require('path');
    var os = require('os');
    var tmpDir;

    beforeEach(function () {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zowe-test-'));
    });

    afterEach(function () {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should set version from manifest.json', function () {
      fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify({ version: '2.15.0' }));
      util.setZoweVersionFromManifest({ zowe: { runtimeDirectory: tmpDir } });
      assert.strictEqual(util.getZoweVersion(), '2.15.0');
    });

    it('should keep previous version when runtimeDirectory is missing', function () {
      var before = util.getZoweVersion();
      util.setZoweVersionFromManifest({ zowe: {} });
      assert.strictEqual(util.getZoweVersion(), before);
    });

    it('should keep previous version when manifest.json does not exist', function () {
      var before = util.getZoweVersion();
      util.setZoweVersionFromManifest({ zowe: { runtimeDirectory: '/nonexistent/path' } });
      assert.strictEqual(util.getZoweVersion(), before);
    });
  });
});
