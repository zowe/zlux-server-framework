/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

// Bootstrap the global logger before requiring any lib module that uses it.
require('../../lib/util');

const assert = require('assert');
const webserver = require('../../lib/webserver');

describe('webserver pure functions', function() {

  describe('readCiphers', function() {

    it('should return null for null input', function() {
      assert.strictEqual(webserver.readCiphers(null), null);
    });

    it('should return null for an empty string', function() {
      assert.strictEqual(webserver.readCiphers(''), null);
    });

    it('should return null for an empty array', function() {
      assert.strictEqual(webserver.readCiphers([]), null);
    });

    it('should uppercase a single cipher name string', function() {
      assert.strictEqual(webserver.readCiphers('aes128-sha'), 'AES128-SHA');
    });

    it('should split and uppercase a colon-separated string', function() {
      assert.strictEqual(
        webserver.readCiphers('aes128-sha:aes256-sha'),
        'AES128-SHA:AES256-SHA'
      );
    });

    it('should uppercase an array of cipher names', function() {
      assert.strictEqual(
        webserver.readCiphers(['aes128-sha', 'aes256-sha']),
        'AES128-SHA:AES256-SHA'
      );
    });

    it('should translate an IANA cipher name to its OpenSSL equivalent', function() {
      // TLS_RSA_WITH_3DES_EDE_CBC_SHA -> DES-CBC3-SHA
      assert.strictEqual(
        webserver.readCiphers('TLS_RSA_WITH_3DES_EDE_CBC_SHA'),
        'DES-CBC3-SHA'
      );
    });

    it('should translate IANA names in a colon-separated string', function() {
      const result = webserver.readCiphers('TLS_RSA_WITH_NULL_SHA:TLS_RSA_WITH_NULL_MD5');
      assert.strictEqual(result, 'NULL-SHA:NULL-MD5');
    });

    it('should pass through an unknown IANA-style name uppercased', function() {
      // starts with TLS_ but not in the mapping — should remain uppercased
      const result = webserver.readCiphers('TLS_UNKNOWN_CIPHER_XYZ');
      assert.strictEqual(result, 'TLS_UNKNOWN_CIPHER_XYZ');
    });

    it('should return null if the array contains a non-string element', function() {
      assert.strictEqual(webserver.readCiphers(['AES128-SHA', 42, 'AES256-SHA']), null);
    });
  });

  describe('parseSafKeyringAddress', function() {

    it('should return null when there is no "/" separator', function() {
      assert.strictEqual(webserver.parseSafKeyringAddress('BADENTRY'), null);
    });

    it('should parse userId and keyringName without a label', function() {
      const result = webserver.parseSafKeyringAddress('USER/MYKEYRING');
      assert.deepStrictEqual(result, { userId: 'USER', keyringName: 'MYKEYRING' });
    });

    it('should parse userId, keyringName and label', function() {
      const result = webserver.parseSafKeyringAddress('USER/MYKEYRING&MYLABEL');
      assert.deepStrictEqual(result, { userId: 'USER', keyringName: 'MYKEYRING', label: 'MYLABEL' });
    });

    it('should return no label property when "&" is missing', function() {
      const result = webserver.parseSafKeyringAddress('USER/RING');
      assert.ok(!('label' in result));
    });

    it('should handle a userId with no ring name after "/"', function() {
      // endUserIndex found but nothing after — keyringName is empty string
      const result = webserver.parseSafKeyringAddress('USER/');
      assert.ok(result !== null);
      assert.strictEqual(result.userId, 'USER');
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
