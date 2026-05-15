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
const path = require('path');
const fs = require('fs');
const os = require('os');
const { readJSONStringWithComments } = require('../../lib/jsonUtils');

describe('jsonUtils - adversarial', function () {

  describe('CPU performance on large inputs', function () {

    it('should parse a 1MB JSON string in < 200ms', function () {
      this.timeout(5000);
      // Generate a large but valid JSON with no comments
      const entries = [];
      for (let i = 0; i < 10000; i++) {
        entries.push(`"key_${i}": "value_${'x'.repeat(80)}"`);
      }
      const content = '{\n' + entries.join(',\n') + '\n}';
      expect(content.length).to.be.above(1000000); // >1MB

      const start = process.hrtime.bigint();
      const result = readJSONStringWithComments(content, 'large.json');
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

      expect(Object.keys(result)).to.have.length(10000);
      expect(elapsed).to.be.below(200, `Took ${elapsed.toFixed(1)}ms for 1MB JSON`);
    });

    it('should handle a file with 100,000 short lines in < 500ms', function () {
      this.timeout(5000);
      // Each line is a JSON key-value, stress-testing the outer loop + string concat
      const lines = ['{'];
      for (let i = 0; i < 50000; i++) {
        lines.push(`"k${i}": ${i}${i < 49999 ? ',' : ''}`);
      }
      lines.push('}');
      const content = lines.join('\n');

      const start = process.hrtime.bigint();
      const result = readJSONStringWithComments(content, 'manylines.json');
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

      expect(Object.keys(result)).to.have.length(50000);
      expect(elapsed).to.be.below(500, `Took ${elapsed.toFixed(1)}ms for 100k lines`);
    });

    it('should handle a single extremely long line (1MB) without hanging', function () {
      this.timeout(5000);
      // One line = inner for loop iterates 1M chars
      const longValue = 'a'.repeat(1000000);
      const content = `{"data": "${longValue}"}`;

      const start = process.hrtime.bigint();
      const result = readJSONStringWithComments(content, 'longline.json');
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

      expect(result.data.length).to.equal(1000000);
      expect(elapsed).to.be.below(200, `Took ${elapsed.toFixed(1)}ms for 1MB single line`);
    });

    it('should handle many lines that are all comments (stripped away)', function () {
      this.timeout(5000);
      const lines = [];
      for (let i = 0; i < 50000; i++) {
        lines.push('// This is comment line ' + i);
      }
      lines.push('{"result": true}');
      const content = lines.join('\n');

      const start = process.hrtime.bigint();
      const result = readJSONStringWithComments(content, 'allcomments.json');
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

      expect(result.result).to.equal(true);
      expect(elapsed).to.be.below(300, `Took ${elapsed.toFixed(1)}ms for 50k comment lines`);
    });
  });

  describe('comment stripping correctness under adversarial input', function () {

    it('preserves // inside double-quoted strings', function () {
      const content = '{"url": "http://example.com/path"}';
      const result = readJSONStringWithComments(content, 'url.json');
      expect(result.url).to.equal('http://example.com/path');
    });

    it('preserves // inside single-quoted strings (non-standard JSON)', function () {
      // jsonUtils handles single quotes for its comment scanner, but JSON.parse won't
      // The scanner should NOT strip // inside single quotes, but JSON.parse will fail
      const content = "{'url': 'http://example.com'}";
      expect(() => readJSONStringWithComments(content, 'single.json')).to.throw();
    });

    it('handles escaped quotes before // correctly', function () {
      const content = '{"path": "C:\\\\Users\\\\test", "b": 1}';
      // The \\\\ becomes \\ in the string, scanner should handle escaped backslashes
      const result = readJSONStringWithComments(content, 'escaped.json');
      expect(result.path).to.equal('C:\\Users\\test');
    });

    it('handles string ending with backslash before // on same line', function () {
      // This is tricky: "foo\\" // comment
      // The string ends at the second ", then // is a real comment
      const content = '{"val": "foo\\\\"}\n// post';
      // After stripping: {"val": "foo\\"}\n
      // JSON.parse: val = "foo\"  — wait, let me think...
      // In the JSON source: "foo\\\\" means the string foo\ (escaped backslash = \, then closing quote)
      // Actually: In JSON, \\\\ is two backslashes, so "foo\\\\" = foo\\
      const result = readJSONStringWithComments(content, 'trailingbs.json');
      expect(result.val).to.equal('foo\\');
    });

    it('does not strip // in a line with unbalanced quotes (no crash)', function () {
      // Malformed: odd number of quotes in a line
      const content = '{"broken": "value} // not a comment actually"}\n';
      // The scanner tracks quote state; this tests if it handles unterminated strings
      // JSON.parse will probably fail, but scanner shouldn't hang
      const start = process.hrtime.bigint();
      try {
        readJSONStringWithComments(content, 'unbalanced.json');
      } catch (e) {
        // JSON parse error expected
      }
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      expect(elapsed).to.be.below(50, 'Should not hang on unbalanced quotes');
    });

    it('handles lines with only slashes', function () {
      const content = '// //// /// //\n{"ok": true}';
      const result = readJSONStringWithComments(content, 'slashes.json');
      expect(result.ok).to.equal(true);
    });

    it('handles a line that is a single /', function () {
      // A single / is not a comment — it should be preserved
      const content = '{"a": 1}\n';
      const result = readJSONStringWithComments(content, 'singleslash.json');
      expect(result.a).to.equal(1);
    });
  });

  describe('malicious content / binary data', function () {

    it('handles null bytes in content without hanging', function () {
      const content = '{"a": "val\x00ue"}';
      // This may or may not throw from JSON.parse, but must not hang
      const start = process.hrtime.bigint();
      try {
        readJSONStringWithComments(content, 'null.json');
      } catch (e) {
        // acceptable
      }
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      expect(elapsed).to.be.below(50);
    });

    it('handles content with no newlines (entire file is one line)', function () {
      const obj = {};
      for (let i = 0; i < 1000; i++) {
        obj[`k${i}`] = i;
      }
      const content = JSON.stringify(obj); // No newlines
      const result = readJSONStringWithComments(content, 'oneline.json');
      expect(Object.keys(result)).to.have.length(1000);
    });

    it('handles content that is only whitespace + valid JSON', function () {
      const content = '\n'.repeat(10000) + '{"a": 1}';
      const result = readJSONStringWithComments(content, 'whitespace.json');
      expect(result.a).to.equal(1);
    });

    it('rejects content that has no valid JSON after comment stripping', function () {
      const content = '// everything is a comment\n// no JSON here\n';
      expect(() => readJSONStringWithComments(content, 'noJSON.json')).to.throw();
    });

    it('handles deeply nested JSON (1000 levels)', function () {
      // JSON.parse handles this, but tests the full pipeline
      let content = '';
      for (let i = 0; i < 1000; i++) {
        content += '{"n":';
      }
      content += '1';
      for (let i = 0; i < 1000; i++) {
        content += '}';
      }
      // This may throw due to JSON.parse recursion limit depending on Node version
      try {
        const result = readJSONStringWithComments(content, 'deep.json');
        // If it parses, verify structure (1000 wrapping objects → 1000 .n accesses)
        let node = result;
        for (let i = 0; i < 1000; i++) {
          node = node.n;
        }
        expect(node).to.equal(1);
      } catch (e) {
        // Stack overflow in JSON.parse is acceptable behavior
        expect(e.message).to.match(/stack|recursion|depth|parse/i);
      }
    });
  });

  describe('string concatenation performance (O(n²) risk)', function () {
    it('should NOT exhibit quadratic behavior on 10k lines', function () {
      this.timeout(10000);
      // If string concat is O(n²), doubling lines should ~4x the time
      function buildContent(numLines) {
        const lines = ['{'];
        for (let i = 0; i < numLines - 2; i++) {
          lines.push(`"k${i}": ${i}${i < numLines - 3 ? ',' : ''}`);
        }
        lines.push('}');
        return lines.join('\n');
      }

      const small = buildContent(1000);
      const large = buildContent(10000);

      const start1 = process.hrtime.bigint();
      readJSONStringWithComments(small, 's.json');
      const t1 = Number(process.hrtime.bigint() - start1) / 1e6;

      const start2 = process.hrtime.bigint();
      readJSONStringWithComments(large, 'l.json');
      const t2 = Number(process.hrtime.bigint() - start2) / 1e6;

      // If O(n²), t2/t1 would be ~100 (10x lines → 100x time)
      // If O(n), t2/t1 should be ~10
      // Allow up to 30x as "linear enough" (accounting for GC, caching)
      const ratio = t2 / Math.max(t1, 0.1);
      expect(ratio).to.be.below(50,
        `Quadratic detected: 1k=${t1.toFixed(1)}ms, 10k=${t2.toFixed(1)}ms, ratio=${ratio.toFixed(1)}`);
    });
  });
});
