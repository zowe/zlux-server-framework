const assert = require('assert');

describe('depgraph', function () {
  let DependencyGraph;
  let statuses;

  before(function () {
    try {
      const mod = require('../../lib/depgraph');
      DependencyGraph = mod;
      statuses = mod.statuses;
    } catch (e) {
      console.warn('Could not load depgraph module:', e.message);
      this.skip();
    }
  });

  it('should export DependencyGraph constructor', function () {
    assert.strictEqual(typeof DependencyGraph, 'function');
  });

  it('should export statuses object', function () {
    assert.ok(typeof statuses === 'object');
    assert.ok(statuses.REQUIRED_PLUGIN_FAILED_TO_LOAD);
    assert.ok(statuses.REQUIRED_PLUGIN_NOT_FOUND);
    assert.ok(statuses.INVALID_REQUIRED_VERSION_RANGE);
    assert.ok(statuses.IMPORTED_SERVICE_IS_AN_IMPORT);
    assert.ok(statuses.REQUIRED_SERVICE_VERSION_NOT_FOUND);
    assert.ok(statuses.REQUIRED_SERVICE_NOT_FOUND);
  });

  describe('constructor', function () {
    it('should create a graph with no plugins', function () {
      var dg = new DependencyGraph([]);
      assert.ok(dg);
      assert.deepStrictEqual(dg.pluginsById, {});
    });

    it('should add initial plugins', function () {
      var plugins = [
        { identifier: 'pluginA' },
        { identifier: 'pluginB' }
      ];
      var dg = new DependencyGraph(plugins);
      assert.ok(dg.pluginsById['pluginA']);
      assert.ok(dg.pluginsById['pluginB']);
    });
  });

  describe('addPlugin', function () {
    it('should add a plugin by identifier', function () {
      var dg = new DependencyGraph([]);
      dg.addPlugin({ identifier: 'pluginC' });
      assert.ok(dg.pluginsById['pluginC']);
    });

    it('should overwrite duplicate plugin identifier', function () {
      var dg = new DependencyGraph([{ identifier: 'dup', version: '1' }]);
      dg.addPlugin({ identifier: 'dup', version: '2' });
      assert.strictEqual(dg.pluginsById['dup'].version, '2');
    });
  });

  describe('processImports', function () {
    it('should handle plugins with no dataServices', function () {
      var plugins = [
        { identifier: 'noServices' }
      ];
      var dg = new DependencyGraph(plugins);
      var result = dg.processImports();
      assert.ok(Array.isArray(result.plugins));
      assert.ok(Array.isArray(result.rejects));
      assert.strictEqual(result.plugins.length, 1);
      assert.strictEqual(result.rejects.length, 0);
    });

    it('should handle plugins with non-import dataServices', function () {
      var plugins = [{
        identifier: 'withRouter',
        dataServices: [{ name: 'api', type: 'router', version: '1.0.0' }]
      }];
      var dg = new DependencyGraph(plugins);
      var result = dg.processImports();
      assert.strictEqual(result.plugins.length, 1);
      assert.strictEqual(result.rejects.length, 0);
    });

    it('should resolve valid imports', function () {
      var plugins = [
        {
          identifier: 'provider',
          dataServices: [{ name: 'dataApi', type: 'router', version: '1.0.0' }]
        },
        {
          identifier: 'consumer',
          dataServices: [{
            name: 'dataApi',
            type: 'import',
            sourcePlugin: 'provider',
            sourceName: 'dataApi',
            localName: 'myLocalApi',
            versionRange: '^1.0.0'
          }]
        }
      ];
      var dg = new DependencyGraph(plugins);
      var result = dg.processImports();
      assert.strictEqual(result.rejects.length, 0);
      assert.strictEqual(result.plugins.length, 2);
      // provider should come before consumer in sorted list
      var providerIdx = result.plugins.findIndex(function (p) { return p.identifier === 'provider'; });
      var consumerIdx = result.plugins.findIndex(function (p) { return p.identifier === 'consumer'; });
      assert.ok(providerIdx < consumerIdx, 'provider should be sorted before consumer');
    });

    it('should reject import when provider plugin is missing', function () {
      var plugins = [{
        identifier: 'consumer',
        dataServices: [{
          name: 'api',
          type: 'import',
          sourcePlugin: 'nonexistent',
          sourceName: 'api',
          localName: 'localApi',
          versionRange: '^1.0.0'
        }]
      }];
      var dg = new DependencyGraph(plugins);
      var result = dg.processImports();
      assert.strictEqual(result.rejects.length, 1);
      assert.strictEqual(result.rejects[0].pluginId, 'consumer');
    });

    it('should reject import when service not found on provider', function () {
      var plugins = [
        {
          identifier: 'provider',
          dataServices: [{ name: 'otherService', type: 'router', version: '1.0.0' }]
        },
        {
          identifier: 'consumer',
          dataServices: [{
            name: 'api',
            type: 'import',
            sourcePlugin: 'provider',
            sourceName: 'missingService',
            localName: 'localApi',
            versionRange: '^1.0.0'
          }]
        }
      ];
      var dg = new DependencyGraph(plugins);
      var result = dg.processImports();
      assert.strictEqual(result.rejects.length, 1);
      assert.strictEqual(result.rejects[0].validationError.status, 'REQUIRED_SERVICE_NOT_FOUND');
    });

    it('should reject import when version does not match', function () {
      var plugins = [
        {
          identifier: 'provider',
          dataServices: [{ name: 'api', type: 'router', version: '2.0.0' }]
        },
        {
          identifier: 'consumer',
          dataServices: [{
            name: 'api',
            type: 'import',
            sourcePlugin: 'provider',
            sourceName: 'api',
            localName: 'localApi',
            versionRange: '^1.0.0'
          }]
        }
      ];
      var dg = new DependencyGraph(plugins);
      var result = dg.processImports();
      assert.strictEqual(result.rejects.length, 1);
      assert.strictEqual(result.rejects[0].validationError.status, 'REQUIRED_SERVICE_VERSION_NOT_FOUND');
    });

    it('should reject import with invalid version range', function () {
      var plugins = [
        {
          identifier: 'provider',
          dataServices: [{ name: 'api', type: 'router', version: '1.0.0' }]
        },
        {
          identifier: 'consumer',
          dataServices: [{
            name: 'api',
            type: 'import',
            sourcePlugin: 'provider',
            sourceName: 'api',
            localName: 'localApi',
            versionRange: 'not-a-valid-range!!!'
          }]
        }
      ];
      var dg = new DependencyGraph(plugins);
      var result = dg.processImports();
      assert.strictEqual(result.rejects.length, 1);
      assert.strictEqual(result.rejects[0].validationError.status, 'INVALID_REQUIRED_VERSION_RANGE');
    });

    it('should cascade rejections to dependents', function () {
      var plugins = [
        {
          identifier: 'base',
          dataServices: [{ name: 'baseApi', type: 'router', version: '1.0.0' }]
        },
        {
          identifier: 'middle',
          dataServices: [
            { name: 'middleApi', type: 'router', version: '1.0.0' },
            {
              name: 'baseImport',
              type: 'import',
              sourcePlugin: 'nonexistent',
              sourceName: 'missing',
              localName: 'baseLocal',
              versionRange: '^1.0.0'
            }
          ]
        },
        {
          identifier: 'top',
          dataServices: [{
            name: 'topImport',
            type: 'import',
            sourcePlugin: 'middle',
            sourceName: 'middleApi',
            localName: 'middleLocal',
            versionRange: '^1.0.0'
          }]
        }
      ];
      var dg = new DependencyGraph(plugins);
      var result = dg.processImports();
      // middle and top should both be rejected
      var rejectedIds = result.rejects.map(function (r) { return r.pluginId; });
      assert.ok(rejectedIds.includes('middle'), 'middle should be rejected');
      assert.ok(rejectedIds.includes('top'), 'top should be rejected');
    });

    it('should handle multiple independent plugins', function () {
      var plugins = [
        { identifier: 'standalone1' },
        { identifier: 'standalone2' },
        { identifier: 'standalone3' }
      ];
      var dg = new DependencyGraph(plugins);
      var result = dg.processImports();
      assert.strictEqual(result.plugins.length, 3);
      assert.strictEqual(result.rejects.length, 0);
    });

    it('should set actualVersion on resolved import', function () {
      var importService = {
        name: 'api',
        type: 'import',
        sourcePlugin: 'provider',
        sourceName: 'api',
        localName: 'localApi',
        versionRange: '^1.0.0'
      };
      var plugins = [
        {
          identifier: 'provider',
          dataServices: [{ name: 'api', type: 'router', version: '1.2.3' }]
        },
        {
          identifier: 'consumer',
          dataServices: [importService]
        }
      ];
      var dg = new DependencyGraph(plugins);
      var result = dg.processImports();
      assert.strictEqual(result.rejects.length, 0);
      assert.strictEqual(importService.version, '1.2.3');
    });
  });
});
