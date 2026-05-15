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
const { deepAssign } = require('../../utils/mergeUtils');

describe('utils/mergeUtils', function () {

  describe('deepAssign', function () {
    it('merges flat source properties into an empty target', function () {
      const result = deepAssign({}, { a: 1, b: 2 });
      expect(result).to.deep.equal({ a: 1, b: 2 });
    });

    it('overwrites target scalar values with source values', function () {
      const result = deepAssign({ a: 1 }, { a: 99 });
      expect(result).to.deep.equal({ a: 99 });
    });

    it('deeply merges nested objects', function () {
      const target = { nested: { x: 1, y: 2 } };
      const source = { nested: { y: 99, z: 3 } };
      const result = deepAssign(target, source);
      expect(result.nested).to.deep.equal({ x: 1, y: 99, z: 3 });
    });

    it('overwrites target with source value when source property is not an object', function () {
      const target = { a: { deep: true } };
      const source = { a: 'scalar' };
      const result = deepAssign(target, source);
      expect(result.a).to.equal('scalar');
    });

    it('replaces target value entirely when target property is not an object', function () {
      const target = { a: 'scalar' };
      const source = { a: { deep: true } };
      const result = deepAssign(target, source);
      expect(result.a).to.deep.equal({ deep: true });
    });

    it('preserves target properties not present in source', function () {
      const result = deepAssign({ a: 1, b: 2 }, { b: 99 });
      expect(result).to.deep.equal({ a: 1, b: 99 });
    });

    it('handles array as target', function () {
      const target = [1, 2, 3];
      const source = { 1: 'replaced' };
      const result = deepAssign(target, source);
      // Array is kept as the base, with source keys applied
      expect(result[1]).to.equal('replaced');
    });

    it('handles null target gracefully (treats as empty)', function () {
      const result = deepAssign(null, { a: 1 });
      expect(result).to.deep.equal({ a: 1 });
    });

    it('handles string as target by replacing with source', function () {
      const result = deepAssign('hello', { a: 1 });
      expect(result).to.deep.equal({ a: 1 });
    });

    it('handles deeply nested merge (3 levels)', function () {
      const target = { l1: { l2: { l3: 'old' } } };
      const source = { l1: { l2: { l3: 'new', extra: true } } };
      const result = deepAssign(target, source);
      expect(result.l1.l2).to.deep.equal({ l3: 'new', extra: true });
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
