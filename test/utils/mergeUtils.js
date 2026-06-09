/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

const { expect } = require('chai');
const mergeUtils = require('../../utils/mergeUtils');

describe('mergeUtils', function () {
  describe('deepAssign', function () {
    it('should merge flat objects', function () {
      const result = mergeUtils.deepAssign({ a: 1 }, { b: 2 });
      expect(result).to.deep.equal({ a: 1, b: 2 });
    });

    it('should override primitive values', function () {
      const result = mergeUtils.deepAssign({ a: 1 }, { a: 2 });
      expect(result).to.deep.equal({ a: 2 });
    });

    it('should deep merge nested objects', function () {
      const target = { node: { https: { port: 8544 } } };
      const source = { node: { https: { cert: '/path' } } };
      const result = mergeUtils.deepAssign(target, source);
      expect(result.node.https.port).to.equal(8544);
      expect(result.node.https.cert).to.equal('/path');
    });

    it('should override nested values', function () {
      const target = { node: { port: 80 } };
      const source = { node: { port: 443 } };
      const result = mergeUtils.deepAssign(target, source);
      expect(result.node.port).to.equal(443);
    });

    it('should handle target being an array', function () {
      const result = mergeUtils.deepAssign([1, 2, 3], { 0: 10 });
      expect(result[0]).to.equal(10);
    });

    it('should handle null target', function () {
      const result = mergeUtils.deepAssign(null, { a: 1 });
      expect(result).to.deep.equal({ a: 1 });
    });

    it('should handle source with non-object overriding object', function () {
      const result = mergeUtils.deepAssign({ a: { b: 1 } }, { a: 'string' });
      expect(result.a).to.equal('string');
    });

    it('should handle empty source', function () {
      const result = mergeUtils.deepAssign({ a: 1 }, {});
      expect(result).to.deep.equal({ a: 1 });
    });

    it('should handle empty target', function () {
      const result = mergeUtils.deepAssign({}, { a: 1 });
      expect(result).to.deep.equal({ a: 1 });
    });

    it('should handle deeply nested merge', function () {
      const target = { a: { b: { c: { d: 1 } } } };
      const source = { a: { b: { c: { e: 2 } } } };
      const result = mergeUtils.deepAssign(target, source);
      expect(result.a.b.c.d).to.equal(1);
      expect(result.a.b.c.e).to.equal(2);
    });

    it('should handle target being a string', function () {
      const result = mergeUtils.deepAssign('hello', { a: 1 });
      expect(result).to.deep.equal({ a: 1 });
    });

    it('should not mutate the original target', function () {
      const target = { a: 1, b: 2 };
      const source = { b: 3 };
      const result = mergeUtils.deepAssign(target, source);
      expect(result.b).to.equal(3);
      // Original should still be 2
      expect(target.b).to.equal(2);
    });

    it('should throw when source value is null and target has that key', function () {
      // deepAssign recurses into null, causing Object.keys(null) to throw
      expect(function () {
        mergeUtils.deepAssign({ a: 1 }, { a: null });
      }).to.throw(TypeError);
    });
  });
});
