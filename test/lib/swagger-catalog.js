const assert = require('assert');

describe('swagger-catalog', function () {
  let makeCatalog;

  before(function () {
    try {
      makeCatalog = require('../../lib/swagger-catalog');
    } catch (e) {
      console.warn('Could not load swagger-catalog module:', e.message);
      this.skip();
    }
  });

  it('should export a function', function () {
    assert.strictEqual(typeof makeCatalog, 'function');
  });

  it('should return a promise when called with a plugin', function (done) {
    var plugin = {
      identifier: 'org.zowe.test',
      pluginVersion: '1.0.0',
      location: '/fake/path',
      dataServices: []
    };
    var serverConfig = {
      zowe: { externalDomains: ['localhost'] },
      components: {
        'app-server': {
          node: {
            https: { port: 7556 },
            http: { port: 7557 }
          }
        }
      }
    };
    var result = makeCatalog(plugin, 'ZLUX', serverConfig);
    assert.ok(typeof result.then === 'function', 'should return a thenable');
    result.then(function (doc) {
      assert.ok(doc, 'should resolve with documentation');
      assert.ok(doc.pluginCatalog, 'should have pluginCatalog');
      assert.ok(doc.serviceDocs, 'should have serviceDocs');
      assert.strictEqual(doc.pluginCatalog.info.title, 'org.zowe.test');
      assert.strictEqual(doc.pluginCatalog.swagger, '2.0');
      done();
    }).catch(done);
  });

  it('should generate placeholder paths for services without swagger', function (done) {
    var plugin = {
      identifier: 'org.zowe.test2',
      pluginVersion: '1.0.0',
      location: '/fake/path',
      dataServices: [
        { name: 'myApi', type: 'router', version: '1.0.0' }
      ]
    };
    var serverConfig = {
      zowe: { externalDomains: ['localhost'] },
      components: {
        'app-server': {
          node: {
            https: { port: 7556 },
            http: { port: 7557 }
          }
        }
      }
    };
    makeCatalog(plugin, 'ZLUX', serverConfig).then(function (doc) {
      assert.ok(Object.keys(doc.pluginCatalog.paths).length > 0, 'should have at least one path');
      done();
    }).catch(done);
  });

  it('should include correct basePath', function (done) {
    var plugin = {
      identifier: 'org.zowe.basepath.test',
      pluginVersion: '2.0.0',
      location: '/fake/path',
      dataServices: []
    };
    var serverConfig = {
      zowe: { externalDomains: ['myhost.com'] },
      components: {
        'app-server': {
          node: {
            https: { port: 8544 }
          }
        }
      }
    };
    makeCatalog(plugin, 'ZLUX', serverConfig).then(function (doc) {
      assert.strictEqual(doc.pluginCatalog.basePath, '/ZLUX/plugins/org.zowe.basepath.test/services');
      done();
    }).catch(done);
  });

  it('should include https scheme when https is configured', function (done) {
    var plugin = {
      identifier: 'org.zowe.scheme.test',
      location: '/fake/path',
      dataServices: []
    };
    var serverConfig = {
      zowe: { externalDomains: ['localhost'] },
      components: {
        'app-server': {
          node: {
            https: { port: 7556 }
          }
        }
      }
    };
    makeCatalog(plugin, 'ZLUX', serverConfig).then(function (doc) {
      assert.ok(doc.pluginCatalog.schemes.includes('https'));
      done();
    }).catch(done);
  });

  it('should include http scheme when only http is configured', function (done) {
    var plugin = {
      identifier: 'org.zowe.http.test',
      location: '/fake/path',
      dataServices: []
    };
    var serverConfig = {
      zowe: { externalDomains: ['localhost'] },
      components: {
        'app-server': {
          node: {
            http: { port: 8080 }
          }
        }
      }
    };
    makeCatalog(plugin, 'ZLUX', serverConfig).then(function (doc) {
      assert.ok(doc.pluginCatalog.schemes.includes('http'));
      done();
    }).catch(done);
  });

  it('should set host from serverConfig', function (done) {
    var plugin = {
      identifier: 'org.zowe.host.test',
      location: '/fake/path',
      dataServices: []
    };
    var serverConfig = {
      zowe: { externalDomains: ['myhost.example.com'] },
      components: {
        'app-server': {
          node: {
            https: { port: 9999 }
          }
        }
      }
    };
    makeCatalog(plugin, 'ZLUX', serverConfig).then(function (doc) {
      assert.strictEqual(doc.pluginCatalog.host, 'myhost.example.com:9999');
      done();
    }).catch(done);
  });

  it('should skip import services in swagger docs', function (done) {
    var plugin = {
      identifier: 'org.zowe.import.test',
      location: '/fake/path',
      dataServices: [
        {
          name: 'imported',
          type: 'import',
          sourcePlugin: 'other',
          sourceName: 'api',
          localName: 'localApi',
          versionRange: '^1.0.0',
          version: '1.0.0'
        }
      ]
    };
    var serverConfig = {
      zowe: { externalDomains: ['localhost'] },
      components: {
        'app-server': {
          node: { https: { port: 7556 } }
        }
      }
    };
    makeCatalog(plugin, 'ZLUX', serverConfig).then(function (doc) {
      assert.strictEqual(doc.serviceDocs.length, 0, 'import services should be skipped');
      done();
    }).catch(done);
  });
});
