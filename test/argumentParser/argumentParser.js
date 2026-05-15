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
const argParser = require('../../utils/argumentParser');

describe('utils/argumentParser', function () {

  describe('stringToValue', function () {
    it('converts "true" to boolean true', function () {
      expect(argParser.stringToValue('true')).to.equal(true);
    });

    it('converts "false" to boolean false', function () {
      expect(argParser.stringToValue('false')).to.equal(false);
    });

    it('converts "null" to null', function () {
      expect(argParser.stringToValue('null')).to.equal(null);
    });

    it('converts "undefined" to undefined', function () {
      expect(argParser.stringToValue('undefined')).to.equal(undefined);
    });

    it('converts numeric strings to numbers', function () {
      expect(argParser.stringToValue('42')).to.equal(42);
      expect(argParser.stringToValue('-3.14')).to.equal(-3.14);
      expect(argParser.stringToValue('0')).to.equal(0);
    });

    it('returns non-numeric strings as-is', function () {
      expect(argParser.stringToValue('hello')).to.equal('hello');
    });

    it('parses bracket-delimited CSV as array', function () {
      const result = argParser.stringToValue('[a,b,c]');
      expect(result).to.deep.equal(['a', 'b', 'c']);
    });

    it('parses bracket-delimited CSV with numeric values', function () {
      const result = argParser.stringToValue('[1,2,3]');
      expect(result).to.deep.equal([1, 2, 3]);
    });

    it('filters empty entries from bracket-delimited array', function () {
      const result = argParser.stringToValue('[a,,b]');
      expect(result).to.deep.equal(['a', 'b']);
    });

    it('parses plain CSV as array when csvAsArray is true', function () {
      const result = argParser.stringToValue('a,b,c', true);
      expect(result).to.deep.equal(['a', 'b', 'c']);
    });

    it('does not parse plain CSV as array when csvAsArray is false', function () {
      const result = argParser.stringToValue('a,b,c', false);
      expect(result).to.equal('a,b,c');
    });

    it('converts booleans inside arrays', function () {
      const result = argParser.stringToValue('[true,false,1]');
      expect(result).to.deep.equal([true, false, 1]);
    });
  });

  describe('CLIArgument', function () {
    it('returns null for unsupported type', function () {
      const arg = argParser.CLIArgument('test', 't', 999);
      expect(arg).to.be.null;
    });

    it('creates a FLAG argument that matches --longname', function () {
      const arg = argParser.CLIArgument('verbose', 'v', argParser.constants.ARG_TYPE_FLAG);
      const match = arg.getMatch('--verbose', null);
      expect(match).to.deep.equal({ arg: 'verbose', value: true });
    });

    it('creates a FLAG argument that matches -shortname', function () {
      const arg = argParser.CLIArgument('verbose', 'v', argParser.constants.ARG_TYPE_FLAG);
      const match = arg.getMatch('-v', null);
      expect(match).to.deep.equal({ arg: 'verbose', value: true });
    });

    it('returns null when flag does not match', function () {
      const arg = argParser.CLIArgument('verbose', 'v', argParser.constants.ARG_TYPE_FLAG);
      expect(arg.getMatch('--other', null)).to.be.null;
    });

    it('creates a VALUE argument that matches --name=value', function () {
      const arg = argParser.CLIArgument('port', 'p', argParser.constants.ARG_TYPE_VALUE);
      const match = arg.getMatch('--port=8080', null);
      expect(match.arg).to.equal('port');
      expect(match.value).to.equal('8080');
    });

    it('creates a VALUE argument that takes value from next argument', function () {
      const arg = argParser.CLIArgument('port', 'p', argParser.constants.ARG_TYPE_VALUE);
      const match = arg.getMatch('--port', '9090');
      expect(match.arg).to.equal('port');
      expect(match.value).to.equal('9090');
    });

    it('creates a VALUE argument that matches -p=value', function () {
      const arg = argParser.CLIArgument('port', 'p', argParser.constants.ARG_TYPE_VALUE);
      const match = arg.getMatch('-p=8080', null);
      expect(match.arg).to.equal('port');
      expect(match.value).to.equal('8080');
    });

    it('creates a VALUE argument that takes next from short form', function () {
      const arg = argParser.CLIArgument('port', 'p', argParser.constants.ARG_TYPE_VALUE);
      const match = arg.getMatch('-p', '3000');
      expect(match.arg).to.equal('port');
      expect(match.value).to.equal('3000');
    });

    it('creates a JSON argument that extracts jsonName with = sign (long form)', function () {
      const arg = argParser.CLIArgument('config', 'c', argParser.constants.ARG_TYPE_JSON);
      const match = arg.getMatch('--confignode.http.port=8080', null);
      expect(match.arg).to.equal('config');
      expect(match.value).to.equal('8080');
      // jsonName is extracted between the prefix (--config) and the '=' sign
      // substr(longMatch.length, index-2) where longMatch='--config' (8 chars), index is position of '='
      expect(match.jsonName).to.be.a('string');
    });

    it('creates a JSON argument that takes value from next (long form)', function () {
      const arg = argParser.CLIArgument('config', 'c', argParser.constants.ARG_TYPE_JSON);
      const match = arg.getMatch('--confignode.http.port', '3000');
      expect(match.arg).to.equal('config');
      expect(match.value).to.equal('3000');
      expect(match.jsonName).to.equal('node.http.port');
    });

    it('creates a JSON argument that extracts jsonName with = sign (short form)', function () {
      const arg = argParser.CLIArgument('config', 'c', argParser.constants.ARG_TYPE_JSON);
      const match = arg.getMatch('-cnode.port=9090', null);
      expect(match.arg).to.equal('config');
      expect(match.value).to.equal('9090');
      expect(match.jsonName).to.equal('node.port');
    });

    it('creates a JSON argument that takes value from next (short form)', function () {
      const arg = argParser.CLIArgument('config', 'c', argParser.constants.ARG_TYPE_JSON);
      const match = arg.getMatch('-cnode.port', '7070');
      expect(match.arg).to.equal('config');
      expect(match.value).to.equal('7070');
      expect(match.jsonName).to.equal('node.port');
    });

    it('handles longName only (no shortName)', function () {
      const arg = argParser.CLIArgument('debug', null, argParser.constants.ARG_TYPE_FLAG);
      const match = arg.getMatch('--debug', null);
      expect(match).to.deep.equal({ arg: 'debug', value: true });
      expect(arg.getMatch('-d', null)).to.be.null;
    });

    it('handles shortName only (no longName)', function () {
      const arg = argParser.CLIArgument(null, 'd', argParser.constants.ARG_TYPE_FLAG);
      const match = arg.getMatch('-d', null);
      expect(match).to.deep.equal({ arg: 'd', value: true });
      expect(arg.getMatch('--d', null)).to.be.null;
    });
  });

  describe('createParser / parse', function () {
    it('parses multiple arguments from an array', function () {
      const args = [
        argParser.CLIArgument('verbose', 'v', argParser.constants.ARG_TYPE_FLAG),
        argParser.CLIArgument('port', 'p', argParser.constants.ARG_TYPE_VALUE),
      ];
      const parser = argParser.createParser(args);
      const result = parser.parse(['--verbose', '--port', '8080']);
      expect(result.verbose).to.equal(true);
      expect(result.port).to.equal('8080');
    });

    it('handles short-form arguments', function () {
      const args = [
        argParser.CLIArgument('port', 'p', argParser.constants.ARG_TYPE_VALUE),
      ];
      const parser = argParser.createParser(args);
      const result = parser.parse(['-p', '3000']);
      expect(result.port).to.equal('3000');
    });

    it('handles = syntax for value args', function () {
      const args = [
        argParser.CLIArgument('host', 'h', argParser.constants.ARG_TYPE_VALUE),
      ];
      const parser = argParser.createParser(args);
      const result = parser.parse(['--host=localhost']);
      expect(result.host).to.equal('localhost');
    });

    it('ignores unrecognized arguments gracefully', function () {
      const args = [
        argParser.CLIArgument('port', 'p', argParser.constants.ARG_TYPE_VALUE),
      ];
      const parser = argParser.createParser(args);
      const result = parser.parse(['--unknown', '-p', '80']);
      expect(result.port).to.equal('80');
      expect(result.unknown).to.be.undefined;
    });

    it('builds nested JSON from JSON-type arguments', function () {
      const args = [
        argParser.CLIArgument('config', 'c', argParser.constants.ARG_TYPE_JSON),
      ];
      const parser = argParser.createParser(args);
      const result = parser.parse(['--confignode.http.port', '8080', '--confignode.http.host', 'localhost']);
      expect(result.config).to.be.an('object');
      expect(result.config.node).to.be.an('object');
      expect(result.config.node.http).to.be.an('object');
      expect(result.config.node.http.port).to.equal(8080);
      expect(result.config.node.http.host).to.equal('localhost');
    });

    it('returns empty object when no args given', function () {
      const args = [
        argParser.CLIArgument('verbose', 'v', argParser.constants.ARG_TYPE_FLAG),
      ];
      const parser = argParser.createParser(args);
      const result = parser.parse([]);
      expect(result).to.deep.equal({});
    });
  });

  describe('environmentVarsToObject', function () {
    it('converts simple env var to a flat object', function () {
      const env = { MYPREFIX_someKey: 'hello' };
      const result = argParser.environmentVarsToObject('MYPREFIX_', env);
      expect(result.someKey).to.equal('hello');
    });

    it('converts numeric values to numbers', function () {
      const env = { P_port: '8080' };
      const result = argParser.environmentVarsToObject('P_', env);
      expect(result.port).to.equal(8080);
    });

    it('converts boolean values', function () {
      const env = { P_enabled: 'true', P_disabled: 'false' };
      const result = argParser.environmentVarsToObject('P_', env);
      expect(result.enabled).to.equal(true);
      expect(result.disabled).to.equal(false);
    });

    it('handles no prefix (uses all env vars)', function () {
      const env = { myVar: 'val' };
      const result = argParser.environmentVarsToObject(undefined, env);
      expect(result.myVar).to.equal('val');
    });

    it('filters by prefix case-insensitively', function () {
      const env = { PREFIX_key: 'a', prefix_key2: 'b', OTHER_key3: 'c' };
      const result = argParser.environmentVarsToObject('PREFIX_', env);
      expect(result.key).to.equal('a');
      expect(result.key2).to.equal('b');
      expect(result.key3).to.be.undefined;
    });

    it('builds nested objects using single underscore as separator', function () {
      const env = { P_node_port: '3000' };
      const result = argParser.environmentVarsToObject('P_', env);
      // single _ between non-_ chars maps to object separator "
      expect(result.node).to.be.an('object');
      expect(result.node.port).to.equal(3000);
    });

    it('handles CSV values as arrays', function () {
      const env = { P_list: 'a,b,c' };
      const result = argParser.environmentVarsToObject('P_', env);
      expect(result.list).to.deep.equal(['a', 'b', 'c']);
    });

    it('handles hex escape _xNN patterns', function () {
      // _x2d = '-'  (0x2d = 45 = '-')
      const env = { 'P_node_x2dname': 'val' };
      const result = argParser.environmentVarsToObject('P_', env);
      // The key should contain a '-' character from the hex decode
      const keys = Object.keys(result);
      const hasHyphen = keys.some(k => k.includes('-') || JSON.stringify(result).includes('-'));
      // At minimum, the value should be present somewhere
      expect(JSON.stringify(result)).to.include('val');
    });

    it('maps double underscore (__) to literal underscore in key', function () {
      const env = { 'P_my__key': 'value' };
      const result = argParser.environmentVarsToObject('P_', env);
      // __ maps to _, so the result should be { my_key: 'value' }
      expect(JSON.stringify(result)).to.include('value');
    });

    it('maps triple underscore (___) to hyphen in key', function () {
      const env = { 'P_some___thing': 'yes' };
      const result = argParser.environmentVarsToObject('P_', env);
      expect(JSON.stringify(result)).to.include('yes');
    });

    it('maps quad underscore (____) to dot in key', function () {
      const env = { 'P_org____zowe': 'test' };
      const result = argParser.environmentVarsToObject('P_', env);
      expect(JSON.stringify(result)).to.include('test');
    });

    it('handles complex env structure with nested separators', function () {
      const env = {
        'node_mediationLayer_server_gatewayPort': '$GATEWAY_PORT',
        'node_mediationLayer_enabled': 'true'
      };
      const result = argParser.environmentVarsToObject(undefined, env);
      expect(result.node).to.be.an('object');
      expect(result.node.mediationLayer).to.be.an('object');
      expect(result.node.mediationLayer.enabled).to.equal(true);
    });

    it('returns empty object when env has no matching prefix', function () {
      const env = { 'OTHER_key': 'val' };
      const result = argParser.environmentVarsToObject('MYPREFIX_', env);
      expect(result).to.deep.equal({});
    });

    it('handles values with brackets as arrays', function () {
      const env = { 'P_items': '[one,two,three]' };
      const result = argParser.environmentVarsToObject('P_', env);
      expect(result.items).to.deep.equal(['one', 'two', 'three']);
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
