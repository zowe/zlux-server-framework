/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const assert = require('assert');
const constants = require('../../lib/unp-constants');

describe('unp-constants', function() {

  describe('EXIT codes', function() {
    it('should define EXIT_GENERIC as a number', function() {
      assert.strictEqual(typeof constants.EXIT_GENERIC, 'number');
    });

    it('should define all expected EXIT codes as numbers', function() {
      const exitCodes = [
        'EXIT_GENERIC', 'EXIT_AUTH', 'EXIT_PFX_READ',
        'EXIT_HTTPS_LOAD', 'EXIT_NO_PLUGINS', 'EXIT_NO_SAFKEYRING'
      ];
      for (const code of exitCodes) {
        assert.strictEqual(typeof constants[code], 'number', `${code} should be a number`);
      }
    });

    it('should have unique EXIT code values', function() {
      const values = [
        constants.EXIT_GENERIC, constants.EXIT_AUTH, constants.EXIT_PFX_READ,
        constants.EXIT_HTTPS_LOAD, constants.EXIT_NO_PLUGINS, constants.EXIT_NO_SAFKEYRING
      ];
      const unique = new Set(values);
      assert.strictEqual(unique.size, values.length);
    });
  });

  describe('WebSocket close codes', function() {
    it('should define WEBSOCKET_CLOSE_INTERNAL_ERROR as a number', function() {
      assert.strictEqual(typeof constants.WEBSOCKET_CLOSE_INTERNAL_ERROR, 'number');
    });

    it('WEBSOCKET_CLOSE_INTERNAL_ERROR should be above WEBSOCKET_CLOSE_CODE_MINIMUM', function() {
      assert.ok(constants.WEBSOCKET_CLOSE_INTERNAL_ERROR >= constants.WEBSOCKET_CLOSE_CODE_MINIMUM);
    });

    it('WEBSOCKET_CLOSE_BY_PROXY should be above WEBSOCKET_CLOSE_CODE_MINIMUM', function() {
      assert.ok(constants.WEBSOCKET_CLOSE_BY_PROXY >= constants.WEBSOCKET_CLOSE_CODE_MINIMUM);
    });
  });

  describe('TLS_VERSION', function() {
    it('should have correct ordinal ordering', function() {
      const v = constants.TLS_VERSION;
      assert.ok(v['TLSv1.0'] < v['TLSv1.1'], 'TLSv1.0 < TLSv1.1');
      assert.ok(v['TLSv1.1'] < v['TLSv1.2'], 'TLSv1.1 < TLSv1.2');
      assert.ok(v['TLSv1.2'] < v['TLSv1.3'], 'TLSv1.2 < TLSv1.3');
    });

    it('should contain all four TLS versions', function() {
      assert.ok('TLSv1.0' in constants.TLS_VERSION);
      assert.ok('TLSv1.1' in constants.TLS_VERSION);
      assert.ok('TLSv1.2' in constants.TLS_VERSION);
      assert.ok('TLSv1.3' in constants.TLS_VERSION);
    });
  });

  describe('OPENSSL_CIPHER_NAME_FROM_IANA', function() {
    it('should map known IANA names to OpenSSL names', function() {
      const map = constants.OPENSSL_CIPHER_NAME_FROM_IANA;
      // Spot-check a few well-known entries
      assert.strictEqual(map['TLS_RSA_WITH_NULL_MD5'], 'NULL-MD5');
      assert.strictEqual(map['TLS_RSA_WITH_NULL_SHA'], 'NULL-SHA');
      assert.strictEqual(map['TLS_RSA_WITH_3DES_EDE_CBC_SHA'], 'DES-CBC3-SHA');
    });

    it('should be a non-empty object', function() {
      assert.ok(Object.keys(constants.OPENSSL_CIPHER_NAME_FROM_IANA).length > 0);
    });
  });

  describe('setProductCode', function() {
    afterEach(function() {
      // restore default after each test
      constants.setProductCode('zlux');
    });

    it('should mutate APP_NAME', function() {
      constants.setProductCode('MYPRODUCT');
      assert.strictEqual(constants.APP_NAME, 'myproduct');
    });

    it('should lowercase the product code', function() {
      constants.setProductCode('UPPER');
      assert.strictEqual(constants.APP_NAME, 'upper');
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
