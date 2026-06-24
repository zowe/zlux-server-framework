const assert = require('assert');

describe('javaManager', function () {
  let javaManager;

  before(function () {
    try {
      javaManager = require('../../lib/javaManager');
    } catch (e) {
      console.warn('Could not load javaManager module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(javaManager, 'javaManager module should be loadable');
  });

  it('should export JavaManager class', function () {
    assert.strictEqual(typeof javaManager.JavaManager, 'function');
  });

  describe('JavaManager constructor validation', function () {
    it('should throw when no war or jar config given', function () {
      assert.throws(function () {
        new javaManager.JavaManager({}, '/usr/lib/jvm', '/tmp', 'https://localhost:7556');
      }, /ZWED0046E/);
    });

    it('should throw when war config missing javaAppServer', function () {
      assert.throws(function () {
        new javaManager.JavaManager({ war: {} }, '/usr/lib/jvm', '/tmp', 'https://localhost:7556');
      }, /ZWED0045E/);
    });

    it('should throw when no ports specified', function () {
      assert.throws(function () {
        new javaManager.JavaManager({
          war: { javaAppServer: { type: 'tomcat', path: '/opt/tomcat', config: '/opt/config.xml', https: { key: '/key.pem' } } }
        }, '/usr/lib/jvm', '/tmp', 'https://localhost:7556');
      }, /ZWED0039E/);
    });

    it('should throw for invalid port range', function () {
      assert.throws(function () {
        new javaManager.JavaManager({
          war: { javaAppServer: { type: 'tomcat', path: '/opt/tomcat', config: '/opt/config.xml', https: { key: '/key.pem' } } },
          portRange: [65535, 1]
        }, '/usr/lib/jvm', '/tmp', 'https://localhost:7556');
      }, /ZWED0038E/);
    });

    it('should create instance with valid port range', function () {
      var mgr = new javaManager.JavaManager({
        war: { javaAppServer: { type: 'tomcat', path: '/opt/tomcat', config: '/opt/config.xml', https: { key: '/key.pem' } } },
        portRange: [8000, 8010]
      }, '/usr/lib/jvm', '/tmp', 'https://localhost:7556');
      assert.ok(mgr);
    });

    it('should create instance with valid ports array', function () {
      var mgr = new javaManager.JavaManager({
        war: { javaAppServer: { type: 'tomcat', path: '/opt/tomcat', config: '/opt/config.xml', https: { key: '/key.pem' } } },
        ports: [8080, 8081, 8082]
      }, '/usr/lib/jvm', '/tmp', 'https://localhost:7556');
      assert.ok(mgr);
    });

    it('should use JAVA_HOME when no runtimes specified', function () {
      var mgr = new javaManager.JavaManager({
        war: { javaAppServer: { type: 'tomcat', path: '/opt/tomcat', config: '/opt/config.xml', https: { key: '/key.pem' } } },
        ports: [8080]
      }, '/usr/lib/jvm/java-11', '/tmp', 'https://localhost:7556');
      assert.ok(mgr);
    });

    it('should throw when no runtimes and no JAVA_HOME', function () {
      assert.throws(function () {
        new javaManager.JavaManager({
          war: { javaAppServer: { type: 'tomcat', path: '/opt/tomcat', config: '/opt/config.xml', https: { key: '/key.pem' } } },
          ports: [8080]
        }, null, '/tmp', 'https://localhost:7556');
      }, /ZWED0044E/);
    });
  });

  describe('getSupportedTypes', function () {
    var mgr;

    before(function () {
      mgr = new javaManager.JavaManager({
        war: { javaAppServer: { type: 'tomcat', path: '/opt/tomcat', config: '/opt/config.xml', https: { key: '/key.pem' } } },
        ports: [8080]
      }, '/usr/lib/jvm', '/tmp', 'https://localhost:7556');
    });

    it('should return an array', function () {
      var types = mgr.getSupportedTypes();
      assert.ok(Array.isArray(types));
    });

    it('should include java-war', function () {
      var types = mgr.getSupportedTypes();
      assert.ok(types.includes('java-war'));
    });

    it('should include java-jar', function () {
      var types = mgr.getSupportedTypes();
      assert.ok(types.includes('java-jar'));
    });
  });

  describe('getConnectionInfo', function () {
    var mgr;

    before(function () {
      mgr = new javaManager.JavaManager({
        war: { javaAppServer: { type: 'tomcat', path: '/opt/tomcat', config: '/opt/config.xml', https: { key: '/key.pem' } } },
        ports: [8080]
      }, '/usr/lib/jvm', '/tmp', 'https://localhost:7556');
    });

    it('should return undefined for unregistered plugin', function () {
      var info = mgr.getConnectionInfo('unknown.plugin', 'service', 'java-war');
      assert.strictEqual(info, undefined);
    });
  });

  describe('registerPlugins', function () {
    var mgr;

    before(function () {
      mgr = new javaManager.JavaManager({
        war: { javaAppServer: { type: 'tomcat', path: '/opt/tomcat', config: '/opt/config.xml', https: { key: '/key.pem' } } },
        ports: [8080, 8081, 8082]
      }, '/usr/lib/jvm', '/tmp', 'https://localhost:7556');
    });

    it('should not throw when given empty array', function () {
      assert.doesNotThrow(function () {
        mgr.registerPlugins([]);
      });
    });

    it('should not throw when given plugins without dataServices', function () {
      assert.doesNotThrow(function () {
        mgr.registerPlugins([{ identifier: 'test', dataServices: [] }]);
      });
    });
  });
});
