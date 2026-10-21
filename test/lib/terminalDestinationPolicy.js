/*
 * SPDX-License-Identifier: EPL-2.0
 * Copyright Contributors to the Zowe Project.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { deepAssign } = require('../../utils/mergeUtils');

// Load the complete proxy with transport dependencies stubbed. Inspect the lists passed to the
// policy parsers; parser behavior is covered separately by the util tests.
const filename = path.resolve(__dirname, '../../plugins/terminal-proxy/lib/terminalProxy.js');
const policyFunctions = vm.runInNewContext(fs.readFileSync(filename, 'utf8') +
  '\n({ getComponentConfig, createDestinationPolicy });', {
  exports: {},
  require(name) {
    if (name === 'express' || name === './ssh') return {};
    if (name === 'bluebird') return Promise;
    if (name === '../../../utils/mergeUtils') return require('../../utils/mergeUtils');
    if (name === '../../../lib/util.js') {
      return {
        prepareAllowList: list => Array.from(list),
        preparePortList(list, defaults) {
          assert.deepStrictEqual(Array.from(defaults), []);
          return Array.from(list);
        }
      };
    }
    return require(name);
  }
}, { filename });

function readPolicy(all, componentName) {
  const warnings = [];
  const context = { plugin: { server: { config: { all } } } };
  const config = policyFunctions.getComponentConfig(context, componentName);
  const policy = policyFunctions.createDestinationPolicy(config, componentName, {
    warn(...args) { warnings.push(args); }
  });
  return { allowList: Array.from(policy.allowList), allowPorts: Array.from(policy.allowPorts), warnings };
}

describe('terminal destination configuration validation', function () {
  const malformed = [undefined, null, false, true, 0, 23, '', 'bad', [],
    [{ allowList: ['internal.example.com'], allowPorts: [23] }]];

  for (const component of ['tn3270-ng2', 'tn5250-ng2', 'vt-ng2']) {
    function assertDenied(all, warningId = 'ZWED0195W') {
      const result = readPolicy(all, component);
      assert.deepStrictEqual(result.allowList, []);
      assert.deepStrictEqual(result.allowPorts, []);
      assert.strictEqual(result.warnings[0][0], warningId);
      assert.strictEqual(result.warnings[0][1], component);
    }

    it(`allows defaults only for absent policy in valid ${component} configuration`, function () {
      for (const config of [{}, { components: {} }, { components: { [component]: {} } }]) {
        assert.deepStrictEqual(readPolicy(config, component), {
          allowList: ['*'], allowPorts: ['1-65535'], warnings: []
        });
      }
    });

    for (const [index, value] of malformed.entries()) {
      it(`denies malformed ${component} sections and parents (${index})`, function () {
        assertDenied({ components: { [component]: value } });
        assertDenied({ components: value });
        assertDenied(value);
      });

      it(`preserves malformed ${component} overrides for validation (${index})`, function () {
        function base() {
          return { components: { [component]: { allowList: ['*'], allowPorts: ['1-65535'] } } };
        }
        assertDenied(deepAssign(base(), { components: { [component]: value } }));
        assertDenied(deepAssign(base(), { components: value }));
        const haConfig = deepAssign({ haInstances: { instance: base() } }, {
          haInstances: { instance: { components: { [component]: value } } }
        });
        assertDenied(deepAssign(base(), haConfig.haInstances.instance));
      });
    }

    it(`denies present invalid policy keys for ${component}`, function () {
      for (const value of malformed.concat([[null], [false], [{}], [['nested']]])) {
        const config = { components: { [component]: { allowList: value, allowPorts: value } } };
        assertDenied(config, 'ZWED0193W');
        assert.strictEqual(readPolicy(config, component).warnings[1][0], 'ZWED0194W');
      }
    });

    it(`says in the warning what was found instead of a valid value for ${component}`, function () {
      const found = (key, value) =>
        readPolicy({ components: { [component]: { [key]: value } } }, component).warnings[0][2];
      for (const key of ['allowList', 'allowPorts']) {
        assert.strictEqual(found(key, []), 'an empty list');
        assert.strictEqual(found(key, [null]), 'a list with an entry of the wrong type');
        assert.strictEqual(found(key, null), 'null');
        assert.strictEqual(found(key, true), 'boolean');
        assert.strictEqual(found(key, 23), 'number');
        assert.strictEqual(found(key, 'bad'), 'string');
      }
      assert.strictEqual(readPolicy({ components: { [component]: [] } }, component).warnings[0][2], 'a list');
    });

    it(`preserves valid restrictions and independent defaults for ${component}`, function () {
      assert.deepStrictEqual(readPolicy({ components: { [component]: {
        allowList: ['internal.example.com'], allowPorts: [22, '23', '2000-2005']
      } } }, component), {
        allowList: ['internal.example.com'], allowPorts: [22, '23', '2000-2005'], warnings: []
      });
      assert.deepStrictEqual(readPolicy({ components: { [component]: { allowPorts: [23] } } }, component), {
        allowList: ['*'], allowPorts: [23], warnings: []
      });
    });
  }
});
