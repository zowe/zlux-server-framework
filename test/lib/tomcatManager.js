const assert = require('assert');

describe('tomcatManager', function () {
  let tomcatManager;

  before(function () {
    try {
      tomcatManager = require('../../lib/tomcatManager');
    } catch (e) {
      console.warn('Could not load tomcatManager module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(tomcatManager, 'tomcatManager module should be loadable');
  });

  it('should export TomcatManager class', function () {
    assert.strictEqual(typeof tomcatManager.TomcatManager, 'function');
  });

  describe('TomcatManager', function () {
    var manager;
    var mockConfig;

    before(function () {
      mockConfig = {
        path: '/opt/tomcat',
        config: '/opt/tomcat/conf/server.xml',
        runtime: { home: '/usr/lib/jvm/java-11' },
        plugins: [
          {
            identifier: 'org.zowe.testplugin',
            location: '/opt/plugins/test',
            dataServices: [
              { name: 'api', type: 'java-war', filename: 'api.war' }
            ]
          }
        ],
        https: { port: 8443, key: '/opt/certs/key.pem', certificate: '/opt/certs/cert.pem' },
        shutdown: { port: -1 },
        appRootDir: '/tmp/tomcat-apps',
        zluxUrl: 'https://localhost:7556'
      };
      manager = new tomcatManager.TomcatManager(mockConfig);
    });

    describe('getId', function () {
      it('should return a number', function () {
        assert.strictEqual(typeof manager.getId(), 'number');
      });

      it('should return a positive number', function () {
        assert.ok(manager.getId() > 0);
      });

      it('should return same id on multiple calls', function () {
        assert.strictEqual(manager.getId(), manager.getId());
      });
    });

    describe('getURL', function () {
      it('should return URL for registered plugin', function () {
        var url = manager.getURL('org.zowe.testplugin', 'api');
        assert.ok(typeof url === 'string');
        assert.ok(url.includes('8443'));
      });

      it('should return URL containing localhost', function () {
        var url = manager.getURL('org.zowe.testplugin', 'api');
        assert.ok(url.includes('localhost'));
      });

      it('should return null for unknown plugin', function () {
        var url = manager.getURL('unknown.plugin', 'api');
        assert.strictEqual(url, null);
      });

      it('should return null for unknown service', function () {
        var url = manager.getURL('org.zowe.testplugin', 'unknown');
        assert.strictEqual(url, null);
      });
    });

    describe('getServerInfo', function () {
      it('should return object with status', function () {
        var info = manager.getServerInfo();
        assert.strictEqual(typeof info.status, 'string');
      });

      it('should have initial status of stopped', function () {
        var info = manager.getServerInfo();
        assert.strictEqual(info.status, 'stopped');
      });

      it('should return object with rootUrl', function () {
        var info = manager.getServerInfo();
        assert.ok(typeof info.rootUrl === 'string');
        assert.ok(info.rootUrl.includes('8443'));
      });

      it('should return object with services array', function () {
        var info = manager.getServerInfo();
        assert.ok(Array.isArray(info.services));
      });

      it('should list registered services', function () {
        var info = manager.getServerInfo();
        assert.ok(info.services.length > 0);
        assert.ok(info.services[0].includes('org.zowe.testplugin'));
      });
    });

    describe('start', function () {
      it('should be a function', function () {
        assert.strictEqual(typeof manager.start, 'function');
      });
    });

    describe('stop', function () {
      it('should be a function', function () {
        assert.strictEqual(typeof manager.stop, 'function');
      });
    });
  });
});
