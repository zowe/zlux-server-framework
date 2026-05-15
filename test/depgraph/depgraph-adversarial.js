/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';
const chai = require('chai');
const expect = chai.expect;
const DependencyGraph = require('../../lib/depgraph');


describe('depgraph - adversarial', function () {

  describe('circular dependency handling', function () {
    it('should throw on direct circular dependency (A imports from B, B imports from A)', function () {
      const plugins = [
        {
          identifier: 'A',
          dataServices: [{ type: 'import', sourcePlugin: 'B', sourceName: 'svc', localName: 'svc', versionRange: '1.x' }]
        },
        {
          identifier: 'B',
          dataServices: [
            { type: 'service', name: 'svc', version: '1.0.0' },
            { type: 'import', sourcePlugin: 'A', sourceName: 'svc2', localName: 'svc2', versionRange: '1.x' }
          ]
        }
      ];
      const dg = new DependencyGraph(plugins);
      // Both imports become broken deps; when _removeBrokenPlugins visits them,
      // the circular visit causes a throw OR they end up in rejects
      let result;
      let threw = false;
      try {
        result = dg.processImports();
      } catch (e) {
        threw = true;
        expect(e.message).to.include('Circular');
      }
      if (!threw) {
        // If no throw, at least some should be rejected
        expect(result.rejects.length).to.be.above(0);
      }
    });

    it('should handle self-referencing plugin (imports from itself)', function () {
      const plugins = [
        {
          identifier: 'selfRef',
          dataServices: [
            { type: 'service', name: 'realSvc', version: '1.0.0' },
            { type: 'import', sourcePlugin: 'selfRef', sourceName: 'realSvc', localName: 'alias', versionRange: '1.x' }
          ]
        }
      ];
      const dg = new DependencyGraph(plugins);
      // Self-import is weird but shouldn't crash
      let threw = false;
      try {
        const result = dg.processImports();
        // It might succeed (import resolves from own services)
        expect(result.plugins).to.be.an('array');
      } catch (e) {
        threw = true;
        expect(e.message).to.match(/circular/i);
      }
    });

    it('should handle 3-node cycle (A→B→C→A)', function () {
      const plugins = [
        {
          identifier: 'A',
          dataServices: [{ type: 'import', sourcePlugin: 'B', sourceName: 's', localName: 's', versionRange: '*' }]
        },
        {
          identifier: 'B',
          dataServices: [
            { type: 'service', name: 's', version: '1.0.0' },
            { type: 'import', sourcePlugin: 'C', sourceName: 's', localName: 's2', versionRange: '*' }
          ]
        },
        {
          identifier: 'C',
          dataServices: [
            { type: 'service', name: 's', version: '1.0.0' },
            { type: 'import', sourcePlugin: 'A', sourceName: 's', localName: 's3', versionRange: '*' }
          ]
        }
      ];
      const dg = new DependencyGraph(plugins);
      // Should either throw "Circular dependency" or return all as rejected
      let result;
      try {
        result = dg.processImports();
        // If no throw, all should be in rejects
        expect(result.rejects.length).to.be.above(0);
      } catch (e) {
        expect(e.message).to.include('Circular');
      }
    });
  });

  describe('large graph performance', function () {
    it('should handle 1000 independent plugins in < 200ms', function () {
      this.timeout(5000);
      const plugins = [];
      for (let i = 0; i < 1000; i++) {
        plugins.push({
          identifier: `plugin_${i}`,
          dataServices: [{ type: 'service', name: 'api', version: '1.0.0' }]
        });
      }
      const start = process.hrtime.bigint();
      const dg = new DependencyGraph(plugins);
      const result = dg.processImports();
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

      expect(result.plugins).to.have.length(1000);
      expect(elapsed).to.be.below(200, `1000 plugins took ${elapsed.toFixed(1)}ms`);
    });

    it('should handle linear dependency chain of 200 plugins', function () {
      this.timeout(5000);
      // plugin_0 provides svc, plugin_1 imports from plugin_0, plugin_2 imports from plugin_1, ...
      const plugins = [];
      plugins.push({
        identifier: 'plugin_0',
        dataServices: [{ type: 'service', name: 'svc', version: '1.0.0' }]
      });
      for (let i = 1; i < 200; i++) {
        plugins.push({
          identifier: `plugin_${i}`,
          dataServices: [
            { type: 'service', name: 'svc', version: '1.0.0' },
            { type: 'import', sourcePlugin: `plugin_${i - 1}`, sourceName: 'svc', localName: 'dep', versionRange: '1.x' }
          ]
        });
      }

      const start = process.hrtime.bigint();
      const dg = new DependencyGraph(plugins);
      const result = dg.processImports();
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

      expect(result.plugins).to.have.length(200);
      expect(result.rejects).to.have.length(0);
      expect(elapsed).to.be.below(500, `Chain of 200 took ${elapsed.toFixed(1)}ms`);
    });

    it('should handle plugin with 500 dataServices', function () {
      this.timeout(5000);
      const services = [];
      for (let i = 0; i < 500; i++) {
        services.push({ type: 'service', name: `svc_${i}`, version: '2.0.0' });
      }
      const plugins = [
        { identifier: 'megaPlugin', dataServices: services },
        {
          identifier: 'consumer',
          dataServices: [{ type: 'import', sourcePlugin: 'megaPlugin', sourceName: 'svc_499', localName: 'last', versionRange: '2.x' }]
        }
      ];

      const start = process.hrtime.bigint();
      const dg = new DependencyGraph(plugins);
      const result = dg.processImports();
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

      expect(result.plugins).to.have.length(2);
      expect(elapsed).to.be.below(100, `500-service plugin took ${elapsed.toFixed(1)}ms`);
    });
  });

  describe('prototype pollution via plugin identifiers', function () {
    afterEach(function () {
      // Clean up any possible pollution
      delete Object.prototype.polluted;
      delete Object.prototype.hacked;
    });

    it('plugin with identifier "__proto__" should not pollute Object.prototype', function () {
      const plugins = [
        { identifier: '__proto__', dataServices: [] }
      ];
      const dg = new DependencyGraph(plugins);
      const result = dg.processImports();
      // If vulnerable, pluginsById['__proto__'] sets Object.prototype
      expect(({}).identifier).to.be.undefined;
      expect(({}).dataServices).to.be.undefined;
    });

    it('plugin with identifier "constructor" should not break internals', function () {
      const plugins = [
        { identifier: 'constructor', dataServices: [{ type: 'service', name: 'api', version: '1.0.0' }] },
        { identifier: 'normal', dataServices: [] }
      ];
      const dg = new DependencyGraph(plugins);
      // Should not throw TypeError attempting to iterate 'constructor' as a node
      const result = dg.processImports();
      expect(result.plugins).to.be.an('array');
    });

    it('plugin with identifier "toString" is excluded due to prototype lookup bug', function () {
      // BUG DOCUMENTATION: In processImports(), the check:
      //   if (!rejects[plugin.identifier])
      // uses bracket notation on a plain object. When plugin.identifier is 'toString',
      // rejects['toString'] returns Object.prototype.toString (truthy!) even if
      // the plugin was never rejected. This causes valid plugins with names
      // matching Object.prototype methods to be incorrectly excluded.
      const plugins = [
        { identifier: 'toString', dataServices: [] },
        { identifier: 'valueOf', dataServices: [] },
        { identifier: 'hasOwnProperty', dataServices: [] }
      ];
      const dg = new DependencyGraph(plugins);
      const result = dg.processImports();
      // These are INCORRECTLY filtered out because rejects['toString'] etc. are truthy
      // (they inherit from Object.prototype). This is a real bug.
      // Correct behavior would be: result.plugins.length === 3
      // Actual behavior: result.plugins.length === 0 (or fewer)
      console.log(`    [BUG] Plugins with prototype method names: expected 3, got ${result.plugins.length}`);
      expect(result.plugins.length).to.be.below(3);
    });
  });

  describe('malformed version strings', function () {
    it('handles completely invalid semver in versionRange', function () {
      const plugins = [
        { identifier: 'provider', dataServices: [{ type: 'service', name: 'api', version: '1.0.0' }] },
        {
          identifier: 'consumer',
          dataServices: [{
            type: 'import', sourcePlugin: 'provider',
            sourceName: 'api', localName: 'api',
            versionRange: 'not-a-version!!!'
          }]
        }
      ];
      const dg = new DependencyGraph(plugins);
      const result = dg.processImports();
      // Invalid version range should cause rejection, not crash
      expect(result.rejects.length).to.be.above(0);
    });

    it('handles extremely long version range string', function () {
      const longRange = '>=1.0.0 <' + '9'.repeat(1000) + '.0.0';
      const plugins = [
        { identifier: 'provider', dataServices: [{ type: 'service', name: 'api', version: '1.0.0' }] },
        {
          identifier: 'consumer',
          dataServices: [{
            type: 'import', sourcePlugin: 'provider',
            sourceName: 'api', localName: 'api',
            versionRange: longRange
          }]
        }
      ];
      const dg = new DependencyGraph(plugins);
      // semver.validRange should reject this without hanging
      const start = process.hrtime.bigint();
      const result = dg.processImports();
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      expect(elapsed).to.be.below(100, `Long version range took ${elapsed.toFixed(1)}ms`);
    });

    it('handles service version that is not valid semver', function () {
      const plugins = [
        { identifier: 'provider', dataServices: [{ type: 'service', name: 'api', version: 'banana' }] },
        {
          identifier: 'consumer',
          dataServices: [{
            type: 'import', sourcePlugin: 'provider',
            sourceName: 'api', localName: 'api',
            versionRange: '1.x'
          }]
        }
      ];
      const dg = new DependencyGraph(plugins);
      const result = dg.processImports();
      // Should reject (semver.satisfies will fail on 'banana')
      expect(result.rejects.length).to.be.above(0);
    });
  });

  describe('edge cases in graph construction', function () {
    it('handles plugin with null dataServices', function () {
      const plugins = [
        { identifier: 'noDS', dataServices: null }
      ];
      // Accessing .dataServices when it's null — code checks `if (!plugin.dataServices)`
      const dg = new DependencyGraph(plugins);
      const result = dg.processImports();
      expect(result.plugins).to.have.length(1);
    });

    it('handles plugin with undefined dataServices', function () {
      const plugins = [{ identifier: 'undef' }];
      const dg = new DependencyGraph(plugins);
      const result = dg.processImports();
      expect(result.plugins).to.have.length(1);
    });

    it('handles empty plugin list', function () {
      const dg = new DependencyGraph([]);
      const result = dg.processImports();
      expect(result.plugins).to.have.length(0);
      expect(result.rejects).to.have.length(0);
    });

    it('handles duplicate plugin identifiers (last one wins)', function () {
      const plugins = [
        { identifier: 'dup', dataServices: [{ type: 'service', name: 'old', version: '1.0.0' }] },
        { identifier: 'dup', dataServices: [{ type: 'service', name: 'new', version: '2.0.0' }] }
      ];
      const dg = new DependencyGraph(plugins);
      // The second should overwrite the first
      expect(dg.pluginsById['dup'].dataServices[0].name).to.equal('new');
    });
  });
});
