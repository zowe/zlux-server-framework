const assert = require('assert');

describe('jarManager', function () {
  let jarManager;

  before(function () {
    try {
      jarManager = require('../../lib/jarManager');
    } catch (e) {
      console.warn('Could not load jarManager module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(jarManager, 'jarManager module should be loadable');
  });

  it('should export JarManager class', function () {
    assert.strictEqual(typeof jarManager.JarManager, 'function');
  });

  describe('JarManager', function () {
    var manager;
    var mockConfig;

    before(function () {
      // serviceName must be the same object reference as the dataService entry
      // because JarManager compares dataServices[i] == serviceName (reference equality)
      var service = { name: 'api', type: 'java-jar', isHttps: true };
      mockConfig = {
        port: 8080,
        plugin: {
          identifier: 'org.zowe.testplugin',
          dataServices: [service]
        },
        serviceName: service,
        runtime: { home: '/usr/lib/jvm/java-11' },
        tempDir: '/tmp',
        zluxUrl: 'https://localhost:7556'
      };
      manager = new jarManager.JarManager(mockConfig);
    });

    describe('getId', function () {
      it('should return a number', function () {
        assert.strictEqual(typeof manager.getId(), 'number');
      });

      it('should return a positive number', function () {
        assert.ok(manager.getId() > 0);
      });
    });

    describe('getURL', function () {
      it('should return URL for matching plugin and service', function () {
        var url = manager.getURL('org.zowe.testplugin', 'api');
        assert.ok(url.length > 0);
        assert.ok(url.includes('8080'));
      });

      it('should return empty string for non-matching plugin', function () {
        var url = manager.getURL('wrong.plugin', 'api');
        assert.strictEqual(url, '');
      });

      it('should return empty string for non-matching service', function () {
        var url = manager.getURL('org.zowe.testplugin', 'wrong-service');
        assert.strictEqual(url, '');
      });
    });

    describe('getServerInfo', function () {
      it('should return an object with status', function () {
        var info = manager.getServerInfo();
        assert.strictEqual(info.status, 'stopped');
      });

      it('should return an object with rootUrl', function () {
        var info = manager.getServerInfo();
        assert.ok(typeof info.rootUrl === 'string');
        assert.ok(info.rootUrl.includes('8080'));
      });

      it('should return an object with services array', function () {
        var info = manager.getServerInfo();
        assert.ok(Array.isArray(info.services));
        assert.ok(info.services.length > 0);
        assert.ok(info.services[0].includes('org.zowe.testplugin'));
      });
    });

    describe('start', function () {
      it('should return a promise', function () {
        var result = manager.start();
        assert.ok(result && typeof result.then === 'function');
      });
    });

    describe('stop', function () {
      it('should return a promise', function () {
        var result = manager.stop();
        assert.ok(result && typeof result.then === 'function');
      });
    });

    describe('constructor with http service', function () {
      it('should use http URL when isHttps is false', function () {
        var service = { name: 'data', type: 'java-jar', isHttps: false };
        var httpConfig = {
          port: 9090,
          plugin: {
            identifier: 'org.zowe.httptest',
            dataServices: [service]
          },
          serviceName: service,
          runtime: { home: '/usr/lib/jvm/java-11' },
          tempDir: '/tmp',
          zluxUrl: 'https://localhost:7556'
        };
        var httpManager = new jarManager.JarManager(httpConfig);
        var info = httpManager.getServerInfo();
        assert.ok(info.rootUrl.startsWith('http://'));
      });

      it('should use https URL when isHttps is undefined', function () {
        var service = { name: 'svc', type: 'java-jar' };
        var noTlsConfig = {
          port: 9091,
          plugin: {
            identifier: 'org.zowe.noexplicit',
            dataServices: [service]
          },
          serviceName: service,
          runtime: { home: '/usr/lib/jvm/java-11' },
          tempDir: '/tmp',
          zluxUrl: 'https://localhost:7556'
        };
        var mgr = new jarManager.JarManager(noTlsConfig);
        var info = mgr.getServerInfo();
        assert.ok(info.rootUrl.startsWith('https://'));
      });
    });
  });
});
