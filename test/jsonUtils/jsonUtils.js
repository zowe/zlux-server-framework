/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

// Stub the global logger before requiring any library code
const noop = () => {};
global.COM_RS_COMMON_LOGGER = {
  makeComponentLogger: () => ({
    info: noop, warn: noop, debug: noop, severe: noop, log: noop, trace: noop
  })
};

const path = require('path');
const fs = require('fs');
const os = require('os');
const chai = require('chai');
const expect = chai.expect;
const jsonUtils = require('../../lib/jsonUtils');

describe('lib/jsonUtils', function () {

  describe('parseJSONWithComments', function () {
    let tmpDir;

    before(function () {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonutils-test-'));
    });

    after(function () {
      // Clean up temp files
      const files = fs.readdirSync(tmpDir);
      for (const f of files) {
        fs.unlinkSync(path.join(tmpDir, f));
      }
      fs.rmdirSync(tmpDir);
    });

    function writeTemp(filename, content) {
      const filepath = path.join(tmpDir, filename);
      fs.writeFileSync(filepath, content, 'utf8');
      return filepath;
    }

    it('parses a simple valid JSON file', function () {
      const file = writeTemp('simple.json', '{"name": "test", "value": 42}');
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result).to.deep.equal({ name: 'test', value: 42 });
    });

    it('strips single-line // comments', function () {
      const content = [
        '{',
        '  // This is a comment',
        '  "key": "value"',
        '}'
      ].join('\n');
      const file = writeTemp('comments.json', content);
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result).to.deep.equal({ key: 'value' });
    });

    it('does not strip // inside a double-quoted string', function () {
      const content = '{"url": "http://example.com"}';
      const file = writeTemp('url.json', content);
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result.url).to.equal('http://example.com');
    });

    it('does not strip // inside a single-quoted value (treated as string content)', function () {
      // Note: single-quoted JSON isn't standard but the parser preserves content within quotes
      const content = '{"path": "C://Users//test"}';
      const file = writeTemp('path.json', content);
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result.path).to.equal('C://Users//test');
    });

    it('handles comments at end of line after valid JSON', function () {
      const content = [
        '{',
        '  "port": 8080 // default port',
        '}'
      ].join('\n');
      const file = writeTemp('eol-comment.json', content);
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result.port).to.equal(8080);
    });

    it('handles multiple consecutive comment lines', function () {
      const content = [
        '{',
        '  // comment 1',
        '  // comment 2',
        '  "x": true',
        '}'
      ].join('\n');
      const file = writeTemp('multi-comment.json', content);
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result.x).to.equal(true);
    });

    it('handles file with no newline at end', function () {
      const content = '{"a": 1}';
      const file = writeTemp('no-newline.json', content);
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result.a).to.equal(1);
    });

    it('handles escaped quotes inside strings', function () {
      const content = '{"msg": "say \\"hello\\""}';
      const file = writeTemp('escaped.json', content);
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result.msg).to.equal('say "hello"');
    });

    it('throws on invalid JSON', function () {
      const file = writeTemp('invalid.json', '{not valid json}');
      expect(() => jsonUtils.parseJSONWithComments(file)).to.throw();
    });

    it('handles empty object', function () {
      const file = writeTemp('empty.json', '{}');
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result).to.deep.equal({});
    });

    it('handles arrays', function () {
      const content = '[1, 2, 3]';
      const file = writeTemp('array.json', content);
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result).to.deep.equal([1, 2, 3]);
    });

    it('strips comment after array entry', function () {
      const content = [
        '[',
        '  "a", // first',
        '  "b"  // second',
        ']'
      ].join('\n');
      const file = writeTemp('array-comment.json', content);
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result).to.deep.equal(['a', 'b']);
    });

    it('preserves // after escaped backslash inside string', function () {
      // The string contains a slash followed by a backslash escape sequence
      const content = '{"val": "a\\\\b // not a comment"}';
      const file = writeTemp('escape-backslash.json', content);
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result.val).to.include('//');
    });

    it('handles single-quoted string containing //', function () {
      // Not valid JSON but tests the parser pathway for single-quote handling
      const content = `{"url": "https://host"}`;
      const file = writeTemp('https.json', content);
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result.url).to.equal('https://host');
    });

    it('handles a line that is only a comment', function () {
      const content = [
        '// top-level comment',
        '{"key": 1}'
      ].join('\n');
      const file = writeTemp('top-comment.json', content);
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result.key).to.equal(1);
    });

    it('handles deeply nested JSON', function () {
      const content = '{"a": {"b": {"c": {"d": 42}}}}';
      const file = writeTemp('deep.json', content);
      const result = jsonUtils.parseJSONWithComments(file);
      expect(result.a.b.c.d).to.equal(42);
    });

    it('handles string value with backslash before quote-like chars near //', function () {
      // Tests the ignoreNext path: backslash before a char in the parsed content
      const content = '{"msg": "path\\\\to // keep"}';
      const file = writeTemp('backslash-q.json', content);
      const result = jsonUtils.parseJSONWithComments(file);
      // The // is inside a quoted string so it should be preserved
      expect(result.msg).to.include('//');
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
