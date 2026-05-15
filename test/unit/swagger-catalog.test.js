/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

// Bootstrap the global logger before requiring any lib module that uses it.
require('../../lib/util');

const assert = require('assert');
const path = require('path');

const makeCatalogForPlugin = require('../../lib/swagger-catalog');

// ─── fixtures ────────────────────────────────────────────────────────────────

const PLUGINS_DIR = path.resolve(__dirname, '../../plugins');

/**
 * Minimal serverConfig that satisfies the fields accessed by swagger-catalog.js:
 *   - getSchemesFromContext  → node.http / node.https
 *   - getHost                → zowe.externalDomains[0], node.https?.port / node.http.port
 */
function makeServerConfig({ https = false } = {}) {
  return {
    zowe: {
      externalDomains: ['localhost']
    },
    components: {
      'app-server': {
        node: {
          http:  { port: 7556, ipAddresses: ['127.0.0.1'] },
          https: https ? { port: 8544 } : undefined
        }
      }
    }
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('swagger-catalog', function() {

  describe('module export', function() {
    it('should export a function (the catalog-builder)', function() {
      assert.strictEqual(typeof makeCatalogForPlugin, 'function');
    });
  });

  // ─── config plugin (router service with real YAML swagger doc) ───────────

  describe('org.zowe.configjs — router service with swagger doc', function() {
    // Matches plugins/config/pluginDefinition.json + doc/swagger/data.yaml
    const configPlugin = {
      identifier: 'org.zowe.configjs',
      pluginVersion: '1.0.0',
      pluginType: 'application',
      license: 'EPL-2.0',
      location: path.join(PLUGINS_DIR, 'config'),
      dataServices: [
        { type: 'router', name: 'data', version: '1.0.1' }
      ]
    };

    it('should resolve with a pluginCatalog and serviceDocs', async function() {
      const result = await makeCatalogForPlugin(configPlugin, 'ZLUX', makeServerConfig());
      assert.ok(result, 'result should be truthy');
      assert.ok(result.pluginCatalog, 'result should have pluginCatalog');
      assert.ok(Array.isArray(result.serviceDocs), 'result should have serviceDocs array');
    });

    it('should set pluginCatalog.info.title to the plugin identifier', async function() {
      const result = await makeCatalogForPlugin(configPlugin, 'ZLUX', makeServerConfig());
      assert.strictEqual(result.pluginCatalog.info.title, 'org.zowe.configjs');
    });

    it('should set pluginCatalog.basePath using the productCode and identifier', async function() {
      const result = await makeCatalogForPlugin(configPlugin, 'ZLUX', makeServerConfig());
      assert.ok(
        result.pluginCatalog.basePath.startsWith('/ZLUX/plugins/org.zowe.configjs/services'),
        `unexpected basePath: ${result.pluginCatalog.basePath}`
      );
    });

    it('should include "http" in schemes when only HTTP is configured', async function() {
      const result = await makeCatalogForPlugin(configPlugin, 'ZLUX', makeServerConfig({ https: false }));
      assert.ok(result.pluginCatalog.schemes.includes('http'));
      assert.ok(!result.pluginCatalog.schemes.includes('https'));
    });

    it('should include both "http" and "https" in schemes when both are configured', async function() {
      const result = await makeCatalogForPlugin(configPlugin, 'ZLUX', makeServerConfig({ https: true }));
      assert.ok(result.pluginCatalog.schemes.includes('http'));
      assert.ok(result.pluginCatalog.schemes.includes('https'));
    });

    it('should parse the data.yaml swagger doc into serviceDocs', async function() {
      const result = await makeCatalogForPlugin(configPlugin, 'ZLUX', makeServerConfig());
      assert.strictEqual(result.serviceDocs.length, 1, 'should have one service doc');
      const doc = result.serviceDocs[0];
      assert.strictEqual(doc.serviceName, 'data');
      assert.strictEqual(doc.serviceVersion, '1.0.1');
      assert.ok(doc.serviceDoc, 'serviceDoc should be present');
      assert.ok(typeof doc.serviceDoc === 'object', 'serviceDoc should be parsed object');
    });

    it('should rewrite basePath of service doc to include plugin URL prefix and swagger info.version', async function() {
      const result = await makeCatalogForPlugin(configPlugin, 'ZLUX', makeServerConfig());
      const doc = result.serviceDocs[0];
      // overwriteSwaggerFieldsForServer prepends the plugin URL and appends swaggerJson.info.version
      // (the version declared inside the swagger YAML, not the dataService version field)
      assert.ok(
        doc.serviceDoc.basePath.includes('/ZLUX/plugins/org.zowe.configjs/services'),
        `basePath should contain plugin URL: ${doc.serviceDoc.basePath}`
      );
      // The swagger YAML declares info.version: 1.5.0
      assert.ok(
        doc.serviceDoc.basePath.includes('1.5.0'),
        `basePath should contain swagger info.version (1.5.0): ${doc.serviceDoc.basePath}`
      );
    });

    it('should populate paths in pluginCatalog from the swagger doc', async function() {
      const result = await makeCatalogForPlugin(configPlugin, 'ZLUX', makeServerConfig());
      const paths = result.pluginCatalog.paths;
      assert.ok(typeof paths === 'object', 'paths should be an object');
      assert.ok(Object.keys(paths).length > 0, 'paths should not be empty when swagger doc is present');
    });

    it('should set host in pluginCatalog from serverConfig', async function() {
      const result = await makeCatalogForPlugin(configPlugin, 'ZLUX', makeServerConfig());
      // getHost returns externalDomains[0] + ':' + port
      assert.ok(
        result.pluginCatalog.host.startsWith('localhost:'),
        `host should start with localhost: ${result.pluginCatalog.host}`
      );
    });
  });

  // ─── plugin with no swagger docs (placeholder path) ──────────────────────

  describe('plugin with no swagger docs — placeholder generation', function() {
    const noSwaggerPlugin = {
      identifier: 'org.zowe.test.noswagger',
      pluginVersion: '1.0.0',
      pluginType: 'application',
      location: path.join(PLUGINS_DIR, 'config'), // real dir but wrong service name → no file found
      dataServices: [
        { type: 'router', name: 'nonexistent-service', version: '1.0.0' }
      ]
    };

    it('should resolve with zero serviceDocs when no swagger file exists', async function() {
      const result = await makeCatalogForPlugin(noSwaggerPlugin, 'ZLUX', makeServerConfig());
      assert.strictEqual(result.serviceDocs.length, 0);
    });

    it('should generate a placeholder path entry in pluginCatalog', async function() {
      const result = await makeCatalogForPlugin(noSwaggerPlugin, 'ZLUX', makeServerConfig());
      const paths = result.pluginCatalog.paths;
      assert.ok(Object.keys(paths).length > 0, 'should have a placeholder path entry');
      const firstPath = Object.values(paths)[0];
      assert.ok(firstPath.get, 'placeholder path should have a GET entry');
      assert.ok(
        firstPath.get.responses[200].description.includes('placeholder'),
        'placeholder description should mention "placeholder"'
      );
    });
  });

  // ─── plugin with only import services (all skipped) ──────────────────────

  describe('plugin with only import services — all skipped', function() {
    const importOnlyPlugin = {
      identifier: 'org.zowe.test.importonly',
      pluginVersion: '1.0.0',
      pluginType: 'application',
      location: path.join(PLUGINS_DIR, 'config'),
      dataServices: [
        {
          type: 'import',
          localName: 'aliased',
          sourcePlugin: 'org.zowe.configjs',
          sourceName: 'data',
          version: '1.0.1'
        }
      ]
    };

    it('should produce zero serviceDocs since imports are skipped', async function() {
      const result = await makeCatalogForPlugin(importOnlyPlugin, 'ZLUX', makeServerConfig());
      assert.strictEqual(result.serviceDocs.length, 0);
    });

    it('should produce a placeholder path for the import service', async function() {
      const result = await makeCatalogForPlugin(importOnlyPlugin, 'ZLUX', makeServerConfig());
      const paths = result.pluginCatalog.paths;
      assert.ok(Object.keys(paths).length > 0, 'should have a placeholder path for the import service');
    });
  });

  // ─── plugin with no dataServices ─────────────────────────────────────────

  describe('plugin with no dataServices', function() {
    const emptyPlugin = {
      identifier: 'org.zowe.test.empty',
      pluginVersion: '1.0.0',
      pluginType: 'bootstrap',
      location: path.join(PLUGINS_DIR, 'config'),
    };

    it('should resolve with empty paths and empty serviceDocs', async function() {
      const result = await makeCatalogForPlugin(emptyPlugin, 'ZLUX', makeServerConfig());
      assert.strictEqual(result.serviceDocs.length, 0);
      assert.deepStrictEqual(result.pluginCatalog.paths, {});
    });
  });

  // ─── zlux-server plugin (multiple swagger docs) ──────────────────────────

  describe('org.zowe.zlux — external plugin with swagger docs', function() {
    // This plugin has a single external service and a swagger file.
    // We pass it as a plain object (not via makePlugin) so isPluginExternal()
    // returns false (dataServices[0].constructor.name is 'Object', not 'ExternalService').
    // That's intentional here — we just want to verify swagger loading and path merging.
    const zluxServerPlugin = {
      identifier: 'org.zowe.zlux',
      pluginVersion: '1.0.1',
      pluginType: 'application',
      license: 'EPL-2.0',
      location: path.join(PLUGINS_DIR, 'zlux-server'),
      dataServices: [
        { type: 'external', name: 'server-plugins-api', host: 'zlux', port: 7556, urlPrefix: '/', isHttps: true, version: '1.0.0' }
      ]
    };

    it('should parse server-plugins-api swagger doc', async function() {
      const result = await makeCatalogForPlugin(zluxServerPlugin, 'ZLUX', makeServerConfig());
      assert.strictEqual(result.serviceDocs.length, 1);
      assert.strictEqual(result.serviceDocs[0].serviceName, 'server-plugins-api');
    });

    it('should populate paths in pluginCatalog from the swagger doc', async function() {
      const result = await makeCatalogForPlugin(zluxServerPlugin, 'ZLUX', makeServerConfig());
      assert.ok(Object.keys(result.pluginCatalog.paths).length > 0, 'paths should not be empty');
    });
  });

  // ─── zlux-agent plugin (multiple services, multiple swagger docs) ─────────

  describe('org.zowe.zlux.agent — external plugin with multiple swagger docs', function() {
    const zluxAgentPlugin = {
      identifier: 'org.zowe.zlux.agent',
      pluginVersion: '1.0.1',
      pluginType: 'application',
      license: 'EPL-2.0',
      location: path.join(PLUGINS_DIR, 'zlux-agent'),
      dataServices: [
        { type: 'external', name: 'fileapi',           host: 'agent', port: 7557, urlPrefix: '/', isHttps: true, version: '1.0.0' },
        { type: 'external', name: 'security-mgmt-api', host: 'agent', port: 7557, urlPrefix: '/', isHttps: true, version: '1.0.0' },
        { type: 'external', name: 'agent-plugins-api', host: 'agent', port: 7557, urlPrefix: '/', isHttps: true, version: '1.0.0' }
      ]
    };

    it('should load all three swagger docs', async function() {
      const result = await makeCatalogForPlugin(zluxAgentPlugin, 'ZLUX', makeServerConfig());
      assert.strictEqual(result.serviceDocs.length, 3);
      const names = result.serviceDocs.map(d => d.serviceName).sort();
      assert.deepStrictEqual(names, ['agent-plugins-api', 'fileapi', 'security-mgmt-api']);
    });

    it('should merge all service paths into pluginCatalog.paths', async function() {
      const result = await makeCatalogForPlugin(zluxAgentPlugin, 'ZLUX', makeServerConfig());
      assert.ok(Object.keys(result.pluginCatalog.paths).length > 0);
    });

    it('should set serviceVersion correctly for each doc', async function() {
      const result = await makeCatalogForPlugin(zluxAgentPlugin, 'ZLUX', makeServerConfig());
      for (const doc of result.serviceDocs) {
        assert.strictEqual(doc.serviceVersion, '1.0.0');
      }
    });
  });

  // ─── getServiceSummary (exercised indirectly via placeholder generation) ──

  describe('getServiceSummary — via placeholder for each service type', function() {
    // Each test creates a plugin with one service of a specific type and no swagger,
    // which forces a placeholder entry whose `get.summary` is built by getServiceSummary.

    const serverConfig = makeServerConfig();
    const basePlugin = {
      identifier: 'org.zowe.test.summary',
      pluginVersion: '1.0.0',
      location: path.join(PLUGINS_DIR, 'config'),
    };

    async function getSummary(service) {
      const plugin = Object.assign({}, basePlugin, { dataServices: [service] });
      const result = await makeCatalogForPlugin(plugin, 'ZLUX', serverConfig);
      return Object.values(result.pluginCatalog.paths)[0]?.get?.summary;
    }

    it('router service summary contains service name', async function() {
      const summary = await getSummary({ type: 'router', name: 'myrouter', version: '1.0.0' });
      assert.ok(summary && summary.includes('myrouter'), `got: ${summary}`);
    });

    it('external service summary contains host and port', async function() {
      const summary = await getSummary({ type: 'external', name: 'ext', host: 'zss', port: 8080, version: '1.0.0' });
      assert.ok(summary && summary.includes('zss') && summary.includes('8080'), `got: ${summary}`);
    });

    it('import service summary contains sourcePlugin and sourceName', async function() {
      const summary = await getSummary({
        type: 'import', name: 'imp', localName: 'imp',
        sourcePlugin: 'org.zowe.provider', sourceName: 'data', version: '1.0.0'
      });
      assert.ok(summary && summary.includes('org.zowe.provider') && summary.includes('data'), `got: ${summary}`);
    });

    it('unknown service type summary falls back to service name', async function() {
      const summary = await getSummary({ type: 'legacy', name: 'legacysvc', version: '1.0.0' });
      assert.ok(summary && summary.includes('legacysvc'), `got: ${summary}`);
    });
  });

});

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
