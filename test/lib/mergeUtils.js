/*
 * SPDX-License-Identifier: EPL-2.0
 * Copyright Contributors to the Zowe Project.
 */

const assert = require('assert');
const { deepAssign } = require('../../utils/mergeUtils');

describe('terminal destination policy configuration merging', function () {
  for (const component of ['tn3270-ng2', 'tn5250-ng2', 'vt-ng2']) {
    for (const key of ['allowList', 'allowPorts']) {
      for (const override of [[], {}, null, undefined, false, 23, ['restricted']]) {
        it(`replaces ${component}.${key} with ${String(override)}`, function () {
          const target = { components: { [component]: { [key]: ['*', 'inherited'] } } };
          const source = { components: { [component]: { [key]: override } } };
          const merged = deepAssign(target, source);
          assert.ok(Object.prototype.hasOwnProperty.call(merged.components[component], key));
          assert.deepStrictEqual(merged.components[component][key], override);
        });
      }
    }
  }

  it('replaces policy arrays within HA instance definitions', function () {
    const target = { haInstances: { instance: { components: { 'vt-ng2': { allowList: ['*'] } } } } };
    const source = { haInstances: { instance: { components: { 'vt-ng2': { allowList: [] } } } } };
    assert.deepStrictEqual(deepAssign(target, source).haInstances.instance.components['vt-ng2'].allowList, []);
  });

  it('preserves inherited policy when an override omits the key', function () {
    const target = { components: { 'vt-ng2': { allowList: ['*'] } } };
    assert.deepStrictEqual(deepAssign(target, { components: { 'vt-ng2': {} } }).components['vt-ng2'].allowList, ['*']);
  });

  it('preserves existing array merge behavior for other configuration', function () {
    assert.deepStrictEqual(deepAssign({ values: [1, 2] }, { values: [3] }), { values: [3, 2] });
  });
});
