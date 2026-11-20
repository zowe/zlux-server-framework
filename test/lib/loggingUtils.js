/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const assert = require('assert');
const loggingUtils = require('../../lib/loggingUtils');

describe('loggingUtils', function () {
  describe('sanitizeHeadersForLogging', function () {
    it('keeps allowlisted protocol and browser security header values', function () {
      const headers = {
        'content-type': 'application/json',
        'X-Frame-Options': 'SAMEORIGIN',
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'cross-origin-opener-policy': 'same-origin'
      };

      assert.deepStrictEqual(loggingUtils.sanitizeHeadersForLogging(headers), headers);
    });

    it('redacts credential-bearing and unknown header values', function () {
      const sanitized = loggingUtils.sanitizeHeadersForLogging({
        authorization: 'Bearer secret-jwt',
        cookie: 'LtpaToken2=secret-ltpa',
        'set-cookie': ['jwtToken=secret-jwt; Secure'],
        'x-custom-authentication': 'secret-custom-value',
        'content-security-policy': "script-src 'nonce-secret-nonce'"
      });

      assert.deepStrictEqual(sanitized, {
        authorization: loggingUtils.REDACTED_VALUE,
        cookie: loggingUtils.REDACTED_VALUE,
        'set-cookie': loggingUtils.REDACTED_VALUE,
        'x-custom-authentication': loggingUtils.REDACTED_VALUE,
        'content-security-policy': loggingUtils.REDACTED_VALUE
      });
    });

    it('does not modify the source headers', function () {
      const headers = {
        authorization: 'Basic secret-credentials',
        accept: ['application/json', 'text/plain']
      };
      const originalHeaders = JSON.parse(JSON.stringify(headers));

      loggingUtils.sanitizeHeadersForLogging(headers);

      assert.deepStrictEqual(headers, originalHeaders);
    });

    it('removes control characters and limits allowlisted values', function () {
      const longValue = `text/plain\r\ninjected${'a'.repeat(1100)}`;
      const sanitized = loggingUtils.sanitizeHeadersForLogging({ accept: longValue });

      assert.strictEqual(sanitized.accept.includes('\r'), false);
      assert.strictEqual(sanitized.accept.includes('\n'), false);
      assert.strictEqual(sanitized.accept.length, 1024);
    });
  });
});