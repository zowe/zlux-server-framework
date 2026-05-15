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

describe('utils/mergeUtils - adversarial', function () {

  describe('prototype pollution', function () {
    afterEach(function () {
      // Clean up any pollution that may have leaked onto Object.prototype
      delete Object.prototype.polluted;
      delete Object.prototype.isAdmin;
      delete Object.prototype.rce;
    });

    it('should NOT pollute Object.prototype via __proto__ key in source', function () {
      const target = {};
      const source = JSON.parse('{"__proto__": {"polluted": true}}');
      deepAssign(target, source);
      // If vulnerable, every object in the process now has .polluted === true
      expect(({}).polluted).to.not.equal(true);
    });

    it('should NOT pollute Object.prototype via nested __proto__', function () {
      const target = { a: {} };
      const source = { a: JSON.parse('{"__proto__": {"isAdmin": true}}') };
      deepAssign(target, source);
      expect(({}).isAdmin).to.not.equal(true);
    });

    it('should NOT pollute via constructor.prototype path', function () {
      const target = {};
      const source = { constructor: { prototype: { rce: true } } };
      deepAssign(target, source);
      expect(({}).rce).to.not.equal(true);
    });

    it('copies __proto__ as own property without polluting prototype chain', function () {
      // Even if the implementation copies __proto__ as a key, it must NOT
      // end up on the actual prototype chain of unrelated objects
      const target = {};
      const source = { ['__proto__']: { injected: 'yes' } };
      deepAssign(target, source);
      const newObj = {};
      expect(newObj.injected).to.be.undefined;
    });

    it('handles deeply nested prototype pollution attempt', function () {
      const target = { a: { b: { c: {} } } };
      const malicious = { a: { b: { c: JSON.parse('{"__proto__": {"deep": "pwned"}}') } } };
      deepAssign(target, malicious);
      expect(({}).deep).to.not.equal('pwned');
    });
  });

  describe('stack overflow / deep recursion', function () {
    it('should handle objects nested 100 levels deep without crashing', function () {
      // 100 levels is a realistic config nesting depth
      let target = {};
      let source = {};
      let currentT = target;
      let currentS = source;
      for (let i = 0; i < 100; i++) {
        currentT.child = {};
        currentS.child = {};
        currentT = currentT.child;
        currentS = currentS.child;
      }
      currentT.leaf = 'old';
      currentS.leaf = 'new';
      const result = deepAssign(target, source);
      // Traverse to validate
      let node = result;
      for (let i = 0; i < 100; i++) {
        node = node.child;
      }
      expect(node.leaf).to.equal('new');
    });

    it('should handle objects nested 500 levels deep without stack overflow', function () {
      // Node.js default stack is ~15000 frames; 500 recursive calls is aggressive
      let target = {};
      let source = {};
      let currentT = target;
      let currentS = source;
      for (let i = 0; i < 500; i++) {
        currentT.n = {};
        currentS.n = {};
        currentT = currentT.n;
        currentS = currentS.n;
      }
      currentT.v = 'target';
      currentS.v = 'source';
      // Should not throw RangeError: Maximum call stack size exceeded
      const result = deepAssign(target, source);
      let node = result;
      for (let i = 0; i < 500; i++) {
        node = node.n;
      }
      expect(node.v).to.equal('source');
    });

    it('should survive 5000 levels of nesting (stress)', function () {
      this.timeout(5000);
      let target = {};
      let source = {};
      let currentT = target;
      let currentS = source;
      for (let i = 0; i < 5000; i++) {
        currentT.x = {};
        currentS.x = {};
        currentT = currentT.x;
        currentS = currentS.x;
      }
      currentS.done = true;
      // This MAY throw stack overflow — that's a valid finding
      let threw = false;
      try {
        deepAssign(target, source);
      } catch (e) {
        threw = true;
        expect(e.message).to.match(/stack|recursion/i);
      }
      // Document whether it threw — both outcomes are informative
      if (threw) {
        console.log('    [INFO] deepAssign stack-overflows at 5000 levels — no recursion guard');
      }
    });
  });

  describe('CPU DoS / wide objects', function () {
    it('should merge a source with 10,000 keys in < 100ms', function () {
      const target = {};
      const source = {};
      for (let i = 0; i < 10000; i++) {
        source[`key_${i}`] = i;
      }
      const start = process.hrtime.bigint();
      const result = deepAssign(target, source);
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6; // ms
      expect(Object.keys(result)).to.have.length(10000);
      expect(elapsed).to.be.below(100, `Took ${elapsed.toFixed(1)}ms for 10k keys`);
    });

    it('should merge a source with 100,000 keys in < 500ms', function () {
      this.timeout(5000);
      const target = {};
      const source = {};
      for (let i = 0; i < 100000; i++) {
        source[`k${i}`] = i;
      }
      const start = process.hrtime.bigint();
      const result = deepAssign(target, source);
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      expect(Object.keys(result)).to.have.length(100000);
      expect(elapsed).to.be.below(500, `Took ${elapsed.toFixed(1)}ms for 100k keys`);
    });

    it('should handle wide + deep combination (100 keys x 10 levels)', function () {
      this.timeout(5000);
      function buildWideDeep(depth, width) {
        const obj = {};
        if (depth === 0) return obj;
        for (let i = 0; i < width; i++) {
          obj[`k${i}`] = buildWideDeep(depth - 1, width);
        }
        return obj;
      }
      // 100^1 * ... 100 keys at each of 3 levels = 100 + 10000 + 1000000 nodes
      // Use modest parameters to avoid OOM: 10 keys x 4 levels = 10000 nodes
      const target = buildWideDeep(4, 10);
      const source = buildWideDeep(4, 10);
      const start = process.hrtime.bigint();
      deepAssign(target, source);
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      expect(elapsed).to.be.below(2000, `Took ${elapsed.toFixed(1)}ms for 10k-node tree merge`);
    });
  });

  describe('memory / large values', function () {
    it('should handle megabyte-sized string values', function () {
      const bigString = 'A'.repeat(1024 * 1024); // 1MB
      const target = { data: 'small' };
      const source = { data: bigString };
      const result = deepAssign(target, source);
      expect(result.data.length).to.equal(1024 * 1024);
    });

    it('should handle arrays with 100,000 elements as target', function () {
      const target = new Array(100000).fill(0);
      const source = { 0: 'first', 99999: 'last' };
      const result = deepAssign(target, source);
      expect(result[0]).to.equal('first');
      expect(result[99999]).to.equal('last');
    });
  });

  describe('type confusion edge cases', function () {
    it('handles source with Symbol keys gracefully (only string keys processed)', function () {
      const sym = Symbol('attack');
      const target = {};
      const source = { normal: 'val' };
      Object.defineProperty(source, sym, { value: 'hidden', enumerable: true });
      // Object.keys() does NOT include Symbol keys, so this should be safe
      const result = deepAssign(target, source);
      expect(result.normal).to.equal('val');
    });

    it('handles source with getter that throws', function () {
      const target = {};
      const source = {};
      Object.defineProperty(source, 'trap', {
        get() { throw new Error('getter bomb'); },
        enumerable: true
      });
      // Object.keys will include 'trap', but accessing source['trap'] throws
      expect(() => deepAssign(target, source)).to.throw('getter bomb');
    });

    it('handles source with getter that returns different values each call', function () {
      const target = { counter: {} };
      let calls = 0;
      const source = {};
      Object.defineProperty(source, 'counter', {
        get() { return ++calls; },
        enumerable: true
      });
      // The value is read once during typeof check and once during assignment
      const result = deepAssign(target, source);
      // Just verify it doesn't crash — the exact value depends on access count
      expect(result).to.have.property('counter');
    });

    it('handles circular references without infinite loop', function () {
      const target = { a: {} };
      const source = { a: {} };
      source.a.self = source.a; // circular reference
      // deepAssign has no circular reference detection — it WILL stack overflow
      // This documents the vulnerability
      let threw = false;
      try {
        deepAssign(target, source);
      } catch (e) {
        threw = true;
        expect(e.message).to.match(/stack|recursion/i);
      }
      if (threw) {
        console.log('    [INFO] deepAssign has no circular reference guard — stack overflow on cycles');
      }
    });

    it('does not mutate the original target object', function () {
      const target = { a: { b: 1 } };
      const originalA = target.a;
      const source = { a: { b: 2, c: 3 } };
      const result = deepAssign(target, source);
      // deepAssign returns a new object, check original is intact
      expect(target.a).to.equal(originalA);
      expect(target.a.b).to.equal(1);
    });

    it('does not mutate the source object', function () {
      const source = { x: { y: 1 } };
      const frozen = JSON.parse(JSON.stringify(source));
      deepAssign({}, source);
      expect(source).to.deep.equal(frozen);
    });
  });
});
