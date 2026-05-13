/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

// Bootstrap the global logger required by jsonUtils -> util
require('../../lib/util');

const assert = require('assert');
const jsonUtils = require('../../lib/jsonUtils');

describe('jsonUtils', function() {

  describe('readJSONStringWithComments', function() {

    it('should parse plain valid JSON', function() {
      const result = jsonUtils.readJSONStringWithComments('{"a":1,"b":"two"}', 'test');
      assert.deepStrictEqual(result, { a: 1, b: 'two' });
    });

    it('should strip single-line // comments', function() {
      const input = '{\n  "key": "value" // this is a comment\n}';
      const result = jsonUtils.readJSONStringWithComments(input, 'test');
      assert.deepStrictEqual(result, { key: 'value' });
    });

    it('should not strip // that appears inside a quoted string', function() {
      const input = '{"url": "http://example.com"}';
      const result = jsonUtils.readJSONStringWithComments(input, 'test');
      assert.deepStrictEqual(result, { url: 'http://example.com' });
    });

    it('should strip a comment-only line', function() {
      const input = '{\n  // whole line comment\n  "x": 42\n}';
      const result = jsonUtils.readJSONStringWithComments(input, 'test');
      assert.deepStrictEqual(result, { x: 42 });
    });

    it('should handle multiple comments across multiple lines', function() {
      const input = [
        '{',
        '  "a": 1, // first',
        '  "b": 2  // second',
        '}'
      ].join('\n');
      const result = jsonUtils.readJSONStringWithComments(input, 'test');
      assert.deepStrictEqual(result, { a: 1, b: 2 });
    });

    it('should throw on invalid JSON after comment stripping', function() {
      const input = '{ "bad": }';
      assert.throws(() => {
        jsonUtils.readJSONStringWithComments(input, 'test');
      });
    });

    it('should handle an escaped quote inside a string without misidentifying comments', function() {
      const input = '{"msg": "say \\"hello\\""}';
      const result = jsonUtils.readJSONStringWithComments(input, 'test');
      assert.deepStrictEqual(result, { msg: 'say "hello"' });
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
