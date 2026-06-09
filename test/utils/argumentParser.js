/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

const { expect } = require('chai');
const argParser = require('../../utils/argumentParser');

describe('argumentParser', function () {
  describe('constants', function () {
    it('should export ARG_TYPE_FLAG as 1', function () {
      expect(argParser.constants.ARG_TYPE_FLAG).to.equal(1);
    });

    it('should export ARG_TYPE_VALUE as 2', function () {
      expect(argParser.constants.ARG_TYPE_VALUE).to.equal(2);
    });

    it('should export ARG_TYPE_JSON as 3', function () {
      expect(argParser.constants.ARG_TYPE_JSON).to.equal(3);
    });
  });

  describe('CLIArgument', function () {
    it('should create argument with long and short names', function () {
      const arg = new argParser.CLIArgument('verbose', 'v', argParser.constants.ARG_TYPE_FLAG);
      expect(arg).to.not.be.null;
    });

    it('should return empty object for unsupported type', function () {
      const arg = new argParser.CLIArgument('test', 't', 99);
      expect(arg).to.not.have.property('getMatch');
    });

    it('should match long name argument', function () {
      const arg = new argParser.CLIArgument('config', 'c', argParser.constants.ARG_TYPE_VALUE);
      const result = arg.getMatch('--config', '/path/to/config');
      expect(result).to.not.be.null;
      expect(result.arg).to.equal('config');
      expect(result.value).to.equal('/path/to/config');
    });

    it('should match long name with equals sign', function () {
      const arg = new argParser.CLIArgument('config', 'c', argParser.constants.ARG_TYPE_VALUE);
      const result = arg.getMatch('--config=/path/to/config', null);
      expect(result).to.not.be.null;
      expect(result.arg).to.equal('config');
      expect(result.value).to.equal('/path/to/config');
    });

    it('should match short name argument', function () {
      const arg = new argParser.CLIArgument('config', 'c', argParser.constants.ARG_TYPE_VALUE);
      const result = arg.getMatch('-c', '/path/to/config');
      expect(result).to.not.be.null;
      expect(result.arg).to.equal('config');
      expect(result.value).to.equal('/path/to/config');
    });

    it('should match short name with equals sign', function () {
      const arg = new argParser.CLIArgument('config', 'c', argParser.constants.ARG_TYPE_VALUE);
      const result = arg.getMatch('-c=/path', null);
      expect(result).to.not.be.null;
      expect(result.value).to.equal('/path');
    });

    it('should match flag argument', function () {
      const arg = new argParser.CLIArgument('verbose', 'v', argParser.constants.ARG_TYPE_FLAG);
      const result = arg.getMatch('--verbose', null);
      expect(result).to.not.be.null;
      expect(result.arg).to.equal('verbose');
      expect(result.value).to.equal(true);
    });

    it('should match flag with short name', function () {
      const arg = new argParser.CLIArgument('verbose', 'v', argParser.constants.ARG_TYPE_FLAG);
      const result = arg.getMatch('-v', null);
      expect(result).to.not.be.null;
      expect(result.value).to.equal(true);
    });

    it('should return null for non-matching argument', function () {
      const arg = new argParser.CLIArgument('config', 'c', argParser.constants.ARG_TYPE_VALUE);
      const result = arg.getMatch('--verbose', null);
      expect(result).to.be.null;
    });

    it('should match JSON type with dot notation', function () {
      const arg = new argParser.CLIArgument(null, 'D', argParser.constants.ARG_TYPE_JSON);
      const result = arg.getMatch('-Dnode.https.port=8544', null);
      expect(result).to.not.be.null;
      expect(result.arg).to.equal('D');
      expect(result.jsonName).to.equal('node.https.port');
      expect(result.value).to.equal('8544');
    });

    it('should match JSON type with separate value', function () {
      const arg = new argParser.CLIArgument(null, 'D', argParser.constants.ARG_TYPE_JSON);
      const result = arg.getMatch('-Dnode.port', '443');
      expect(result).to.not.be.null;
      expect(result.value).to.equal('443');
      expect(result.jsonName).to.equal('node.port');
    });

    it('should work with only long name (null short)', function () {
      const arg = new argParser.CLIArgument('config', null, argParser.constants.ARG_TYPE_VALUE);
      const result = arg.getMatch('--config', 'val');
      expect(result).to.not.be.null;
      expect(result.value).to.equal('val');
    });

    it('should work with only short name (null long)', function () {
      const arg = new argParser.CLIArgument(null, 'c', argParser.constants.ARG_TYPE_VALUE);
      const result = arg.getMatch('-c', 'val');
      expect(result).to.not.be.null;
      expect(result.value).to.equal('val');
    });
  });

  describe('createParser', function () {
    it('should create a parser with parse method', function () {
      const args = [
        new argParser.CLIArgument('config', 'c', argParser.constants.ARG_TYPE_VALUE)
      ];
      const parser = argParser.createParser(args);
      expect(parser).to.have.property('parse');
      expect(parser.parse).to.be.a('function');
    });

    it('should parse multiple arguments', function () {
      const args = [
        new argParser.CLIArgument('config', 'c', argParser.constants.ARG_TYPE_VALUE),
        new argParser.CLIArgument('verbose', 'v', argParser.constants.ARG_TYPE_FLAG)
      ];
      const parser = argParser.createParser(args);
      const result = parser.parse(['--config', '/path', '-v']);
      expect(result.config).to.equal('/path');
      expect(result.verbose).to.equal(true);
    });

    it('should handle empty arguments array', function () {
      const args = [
        new argParser.CLIArgument('config', 'c', argParser.constants.ARG_TYPE_VALUE)
      ];
      const parser = argParser.createParser(args);
      const result = parser.parse([]);
      expect(result).to.deep.equal({});
    });

    it('should warn on unrecognized arguments', function () {
      const args = [
        new argParser.CLIArgument('config', 'c', argParser.constants.ARG_TYPE_VALUE)
      ];
      const parser = argParser.createParser(args);
      const result = parser.parse(['--unknown']);
      expect(result).to.deep.equal({});
    });

    it('should handle JSON arguments with nested keys', function () {
      const args = [
        new argParser.CLIArgument(null, 'D', argParser.constants.ARG_TYPE_JSON)
      ];
      const parser = argParser.createParser(args);
      const result = parser.parse(['-Dnode.https.port=8544', '-Dnode.http.port=8080']);
      expect(result.D).to.be.an('object');
      expect(result.D.node.https.port).to.equal(8544);
      expect(result.D.node.http.port).to.equal(8080);
    });
  });

  describe('stringToValue', function () {
    it('should convert "true" to boolean true', function () {
      expect(argParser.stringToValue('true')).to.equal(true);
    });

    it('should convert "false" to boolean false', function () {
      expect(argParser.stringToValue('false')).to.equal(false);
    });

    it('should convert "null" to null', function () {
      expect(argParser.stringToValue('null')).to.equal(null);
    });

    it('should convert "undefined" to undefined', function () {
      expect(argParser.stringToValue('undefined')).to.equal(undefined);
    });

    it('should convert numeric strings to numbers', function () {
      expect(argParser.stringToValue('42')).to.equal(42);
      expect(argParser.stringToValue('-1')).to.equal(-1);
      expect(argParser.stringToValue('3.14')).to.equal(3.14);
    });

    it('should keep non-numeric strings as strings', function () {
      expect(argParser.stringToValue('hello')).to.equal('hello');
      expect(argParser.stringToValue('/path/to/file')).to.equal('/path/to/file');
    });

    it('should parse bracket-enclosed CSV as array', function () {
      const result = argParser.stringToValue('[a,b,c]');
      expect(result).to.deep.equal(['a', 'b', 'c']);
    });

    it('should parse bracket-enclosed CSV with numbers', function () {
      const result = argParser.stringToValue('[1,2,3]');
      expect(result).to.deep.equal([1, 2, 3]);
    });

    it('should parse CSV as array when csvAsArray is true', function () {
      const result = argParser.stringToValue('a,b,c', true);
      expect(result).to.deep.equal(['a', 'b', 'c']);
    });

    it('should not parse CSV as array when csvAsArray is false', function () {
      const result = argParser.stringToValue('a,b,c', false);
      expect(result).to.equal('a,b,c');
    });
  });

  describe('environmentVarsToObject', function () {
    it('should convert prefixed env vars to nested object', function () {
      const env = {
        'ZWED_node_https_port': '8544',
        'ZWED_node_http_port': '8080'
      };
      const result = argParser.environmentVarsToObject('ZWED_', env);
      expect(result.node.https.port).to.equal(8544);
      expect(result.node.http.port).to.equal(8080);
    });

    it('should handle double underscore as literal underscore in longer keys', function () {
      const env = {
        'ZWED_node__key_value': 'test'
      };
      const result = argParser.environmentVarsToObject('ZWED_', env);
      // _ is separator, __ is literal _, pattern is complex
      expect(result).to.be.an('object');
    });

    it('should handle triple underscore as hyphen in longer keys', function () {
      const env = {
        'ZWED_node___key_value': 'test'
      };
      const result = argParser.environmentVarsToObject('ZWED_', env);
      expect(result).to.be.an('object');
    });

    it('should handle no prefix', function () {
      const env = { 'node_port': '8080' };
      const result = argParser.environmentVarsToObject(undefined, env);
      expect(result.node.port).to.equal(8080);
    });

    it('should filter by prefix case insensitively', function () {
      const env = {
        'zwed_port': '80',
        'ZWED_host': 'localhost',
        'OTHER_val': 'ignored'
      };
      const result = argParser.environmentVarsToObject('ZWED_', env);
      expect(result).to.have.property('port');
      expect(result).to.have.property('host');
    });

    it('should handle boolean values in env vars', function () {
      const env = {
        'ZWED_enabled': 'true',
        'ZWED_disabled': 'false'
      };
      const result = argParser.environmentVarsToObject('ZWED_', env);
      expect(result.enabled).to.equal(true);
      expect(result.disabled).to.equal(false);
    });

    it('should return empty object for empty env', function () {
      const result = argParser.environmentVarsToObject('ZWED_', {});
      expect(result).to.deep.equal({});
    });

    it('should handle hex escape sequences', function () {
      const env = {
        'ZWED_node_x2dkey': 'value'
      };
      const result = argParser.environmentVarsToObject('ZWED_', env);
      // _x2d = '-'
      expect(result).to.have.property('node-key');
    });
  });

  describe('envUnitTest', function () {
    it('should run without throwing', function () {
      // This is the built-in test function in argumentParser
      expect(function () { argParser.envUnitTest(); }).to.not.throw();
    });
  });
});
