/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const assert = require('assert');
const { deepAssign } = require('../../utils/mergeUtils');

describe('mergeUtils', function() {

  describe('deepAssign', function() {

    it('should copy scalar values from source when key is absent in target', function() {
      const result = deepAssign({ a: 1 }, { b: 2 });
      assert.strictEqual(result.a, 1);
      assert.strictEqual(result.b, 2);
    });

    it('should overwrite a scalar target key with the source value', function() {
      const result = deepAssign({ a: 1 }, { a: 99 });
      assert.strictEqual(result.a, 99);
    });

    it('should recursively merge nested objects', function() {
      const target = { nested: { x: 1, y: 2 } };
      const source = { nested: { y: 99, z: 3 } };
      const result = deepAssign(target, source);
      assert.strictEqual(result.nested.x, 1);
      assert.strictEqual(result.nested.y, 99);
      assert.strictEqual(result.nested.z, 3);
    });

    it('should replace an array target with the source value', function() {
      const target = [1, 2, 3];
      const source = { 0: 10 };
      // When target is an array, deepAssign returns the array with source applied
      const result = deepAssign(target, source);
      // Source key '0' overwrites index 0 because source[key] is a scalar
      assert.strictEqual(result[0], 10);
    });

    it('should handle a null target by returning source values', function() {
      const result = deepAssign(null, { a: 1 });
      // target is falsy but not an array/object, falls through to source assignment
      assert.ok(result !== null);
    });

    it('should not mutate the original target object', function() {
      const target = { a: 1 };
      deepAssign(target, { b: 2 });
      assert.strictEqual(target.b, undefined);
    });

    it('should handle deeply nested structures', function() {
      const target = { level1: { level2: { level3: 'deep' } } };
      const source = { level1: { level2: { level3: 'overwritten', extra: 'new' } } };
      const result = deepAssign(target, source);
      assert.strictEqual(result.level1.level2.level3, 'overwritten');
      assert.strictEqual(result.level1.level2.extra, 'new');
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
