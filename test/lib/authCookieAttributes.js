/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const assert = require('assert');
const express = require('express');

// APIML emits apimlAuthenticationToken as
//   Path=/; Secure; HttpOnly; SameSite=Strict
// (AuthConfigurationProperties defaults cookieSameSite to STRICT) and leaves
// Spring's CSRF token support disabled, relying on SameSite alone to protect
// this cookie -- see NewSecurityConfiguration:
//   csrf(AbstractHttpConfigurer::disable) // NOSONAR we are using SAMESITE cookie
// Emitting the same cookie name without SameSite would silently drop that
// control for every client that trusts the APIML contract.
let loadError = null;
let localJwt;
try {
  localJwt = require('../../plugins/sso-auth/lib/localJwt');
} catch (e) {
  loadError = e;
}

describe('apimlAuthenticationToken cookie attributes', function () {

  before(function () {
    if (loadError) {
      console.warn('Could not load auth modules:', loadError.message);
      this.skip();
    }
  });

  // Round-trips the options through Express rather than asserting on the plain
  // object, so the test fails if Express ever stops honouring an attribute.
  function setCookieHeaderFor(options) {
    const app = express();
    app.get('/', (req, res) => {
      res.cookie(localJwt.TOKEN_NAME, 'token-value', options);
      res.end();
    });
    return new Promise((resolve, reject) => {
      const server = app.listen(0, async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
          resolve(res.headers.getSetCookie()[0]);
        } catch (e) {
          reject(e);
        } finally {
          server.close();
        }
      });
    });
  }

  it('sets SameSite=Strict, HttpOnly, Secure and Path=/ on the session token', async function () {
    const header = await setCookieHeaderFor(localJwt.TOKEN_COOKIE_OPTIONS);
    assert.ok(header.startsWith(`${localJwt.TOKEN_NAME}=`), header);
    assert.match(header, /SameSite=Strict/i, header);
    assert.match(header, /HttpOnly/i, header);
    assert.match(header, /Secure/i, header);
    assert.match(header, /Path=\//i, header);
  });

  it('keeps those attributes when expiring the cookie, so the browser overwrites it', async function () {
    const header = await setCookieHeaderFor(
      localJwt.makeTokenCookieOptions({ expires: new Date(1) }));
    assert.match(header, /SameSite=Strict/i, header);
    assert.match(header, /HttpOnly/i, header);
    assert.match(header, /Secure/i, header);
    assert.match(header, /Path=\//i, header);
    assert.match(header, /Expires=/i, header);
  });

  it('does not let an override mutate the shared options', function () {
    const before = JSON.stringify(localJwt.TOKEN_COOKIE_OPTIONS);
    const overridden = localJwt.makeTokenCookieOptions({ sameSite: 'lax' });
    assert.strictEqual(overridden.sameSite, 'lax');
    assert.strictEqual(localJwt.TOKEN_COOKIE_OPTIONS.sameSite, 'strict');
    assert.strictEqual(JSON.stringify(localJwt.TOKEN_COOKIE_OPTIONS), before);
  });

  // Guards against a new emission site reintroducing bare {httpOnly, secure}.
  it('is the only cookie shape the auth handlers emit for this token', function () {
    const fs = require('fs');
    const path = require('path');
    const handlerDir = path.join(__dirname, '..', '..', 'plugins', 'sso-auth', 'lib');
    for (const file of ['gatewayApiHandler.js', 'apimlHandler.js', 'ssoAuth.js']) {
      const source = fs.readFileSync(path.join(handlerDir, file), 'utf8');
      const tokenCookieLines = source.split('\n')
        .filter(line => /options\s*:/.test(line) && !/sameSite/.test(line))
        .filter(line => /TOKEN_NAME|localJwt\.TOKEN_NAME/.test(line) || /httpOnly/.test(line));
      const offending = tokenCookieLines
        .filter(line => !/TOKEN_COOKIE_OPTIONS|makeTokenCookieOptions/.test(line));
      assert.deepStrictEqual(offending, [],
        `${file} emits a token cookie without the shared SameSite options`);
    }
  });
});

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
