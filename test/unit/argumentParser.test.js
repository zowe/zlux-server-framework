/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const assert = require('assert');
const argParser = require('../../utils/argumentParser');
const { CLIArgument, constants } = argParser;

describe('argumentParser', function() {

  describe('CLIArgument — FLAG type', function() {
    const flagArg = CLIArgument('verbose', 'v', constants.ARG_TYPE_FLAG);

    it('should match a long flag and return true', function() {
      const result = flagArg.getMatch('--verbose', null);
      assert.deepStrictEqual(result, { arg: 'verbose', value: true });
    });

    it('should match a short flag and return true', function() {
      const result = flagArg.getMatch('-v', null);
      assert.deepStrictEqual(result, { arg: 'verbose', value: true });
    });

    it('should return null for a non-matching argument', function() {
      assert.strictEqual(flagArg.getMatch('--other', null), null);
    });
  });

  describe('CLIArgument — VALUE type', function() {
    const valArg = CLIArgument('host', 'h', constants.ARG_TYPE_VALUE);

    it('should parse --host=myhost (inline =)', function() {
      const result = valArg.getMatch('--host=myhost', null);
      assert.deepStrictEqual(result, { arg: 'host', value: 'myhost', isJson: true });
    });

    it('should parse --host myhost (nextString)', function() {
      const result = valArg.getMatch('--host', 'myhost');
      assert.deepStrictEqual(result, { arg: 'host', value: 'myhost', isJson: true });
    });

    it('should parse short -h=myhost (inline =)', function() {
      const result = valArg.getMatch('-h=myhost', null);
      assert.deepStrictEqual(result, { arg: 'host', value: 'myhost' });
    });

    it('should parse short -h myhost (nextString)', function() {
      const result = valArg.getMatch('-h', 'myhost');
      assert.deepStrictEqual(result, { arg: 'host', value: 'myhost' });
    });

    it('should return null for a non-matching argument', function() {
      assert.strictEqual(valArg.getMatch('--port', 'value'), null);
    });
  });

  describe('CLIArgument — JSON type', function() {
    const jsonArg = CLIArgument('config', 'c', constants.ARG_TYPE_JSON);

    it('should parse --config.key=value inline', function() {
      const result = jsonArg.getMatch('--config.key=value', null);
      assert.strictEqual(result.arg, 'config');
      assert.strictEqual(result.value, 'value');
    });

    it('should parse --config.key value via nextString', function() {
      const result = jsonArg.getMatch('--config.key', 'value');
      assert.strictEqual(result.arg, 'config');
      assert.strictEqual(result.value, 'value');
    });
  });

  describe('CLIArgument — invalid type', function() {
    it('should return null for an unsupported type', function() {
      const result = CLIArgument('foo', 'f', 999);
      assert.strictEqual(result, null);
    });
  });

  describe('CLIArgument — long-only definition', function() {
    const longOnly = CLIArgument('output', null, constants.ARG_TYPE_VALUE);

    it('should match the long form', function() {
      const result = longOnly.getMatch('--output=file.txt', null);
      assert.strictEqual(result.value, 'file.txt');
    });

    it('should not match a short form when none is defined', function() {
      assert.strictEqual(longOnly.getMatch('-output', null), null);
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
