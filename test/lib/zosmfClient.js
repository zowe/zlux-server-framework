/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');

// Tests for ZosmfClient.verifyToken(), the server-to-server round-trip check
// added to mirror APIML's AuthenticatedEndpointStrategy (see
// TokenValidationConfigRsu2012 in api-layer, which registers exactly this kind
// of two-endpoint fallback list). This is the mechanism that replaced trusting
// a client-supplied JWT's decoded claims without verifying them.
describe('ZosmfClient', function () {
  let ZosmfClient;
  const NOOP_LOGGER = { debug() {}, info() {}, warn() {}, error() {} };

  before(function () {
    try {
      ({ ZosmfClient } = require('../../plugins/sso-auth/lib/zosmfClient'));
    } catch (e) {
      console.warn('Could not load zosmfClient module:', e.message);
      this.skip();
    }
  });

  // Fake req/res pair driven by a queue of canned responses, one per call to
  // httpModule.request(). Each entry describes a response, network error, or timeout.
  function makeFakeHttpModule(responses) {
    let callIndex = 0;
    const requestedOptions = [];
    const httpModule = {
      request(options, callback) {
        requestedOptions.push(options);
        const responseSpec = responses[callIndex++];
        const req = new EventEmitter();
        req.setTimeout = (timeout, callback) => {
          req.timeout = timeout;
          if (responseSpec.timeout) {
            process.nextTick(callback);
          }
        };
        req.destroy = () => {};
        req.end = () => {
          if (responseSpec.timeout) {
            return;
          }
          if (responseSpec.networkError) {
            const error = new Error(responseSpec.networkError);
            error.code = responseSpec.networkError;
            process.nextTick(() => req.emit('error', error));
            return;
          }
          const res = new EventEmitter();
          res.statusCode = responseSpec.statusCode;
          res.statusMessage = responseSpec.statusMessage || '';
          res.headers = responseSpec.headers || {};
          callback(res);
          process.nextTick(() => {
            res.emit('data', Buffer.from(responseSpec.body || ''));
            res.emit('end');
          });
        };
        return req;
      }
    };
    return { httpModule, requestedOptions };
  }

  function makeClient(responses, logger) {
    const { httpModule, requestedOptions } = makeFakeHttpModule(responses);
    const client = new ZosmfClient({
      logger: logger || NOOP_LOGGER,
      zosmfConf: { host: 'zosmf.example.com', port: 1443 },
      isHttps: true,
      httpsAgent: {},
      httpAgent: null,
      httpModule
    });
    return { client, requestedOptions };
  }

  it('redacts credentials while retaining safe header values in login logs', async function () {
    const loggedArguments = [];
    const logger = {
      debug() { loggedArguments.push(Array.from(arguments)); },
      info() {},
      warn() {},
      error() {}
    };
    const { client } = makeClient([{
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': ['jwtToken=secret-jwt; Secure', 'LtpaToken2=secret-ltpa; Secure'],
        'x-custom-credential': 'secret-custom-value'
      }
    }], logger);

    await client.doLogin('ALICE', 'secret-password');

    const logs = JSON.stringify(loggedArguments);
    const encodedCredentials = Buffer.from('ALICE:secret-password').toString('base64');
    assert.strictEqual(logs.includes('secret-password'), false);
    assert.strictEqual(logs.includes(encodedCredentials), false);
    assert.strictEqual(logs.includes('secret-jwt'), false);
    assert.strictEqual(logs.includes('secret-ltpa'), false);
    assert.strictEqual(logs.includes('secret-custom-value'), false);
    assert.strictEqual(logs.includes('application/json'), true);
  });

  it('resolves valid when the first endpoint answers 200', async function () {
    const { client, requestedOptions } = makeClient([{ statusCode: 200 }]);
    const result = await client.verifyToken('sometoken');
    assert.deepStrictEqual(result, { valid: true });
    assert.strictEqual(requestedOptions.length, 1, 'the second endpoint must not be tried');
  });

  it('resolves invalid when the first endpoint answers 401 (no fallback needed)', async function () {
    const { client, requestedOptions } = makeClient([{ statusCode: 401 }]);
    const result = await client.verifyToken('forgedtoken');
    assert.deepStrictEqual(result, { valid: false, reason: 'invalid' });
    assert.strictEqual(requestedOptions.length, 1, 'a definitive 401 must not trigger a fallback attempt');
  });

  it('falls back to the second endpoint when the first is unreachable', async function () {
    const { client, requestedOptions } = makeClient([
      { networkError: 'ECONNREFUSED' },
      { statusCode: 200 }
    ]);
    const result = await client.verifyToken('sometoken');
    assert.deepStrictEqual(result, { valid: true });
    assert.strictEqual(requestedOptions.length, 2);
  });

  it('resolves unreachable (fails closed) when every endpoint is inconclusive', async function () {
    const { client } = makeClient([
      { statusCode: 500 },
      { networkError: 'ETIMEDOUT' }
    ]);
    const result = await client.verifyToken('sometoken');
    assert.deepStrictEqual(result, { valid: false, reason: 'unreachable' });
  });

  it('sends the token as its own jwtToken cookie, not trusted as-is', async function () {
    const { client, requestedOptions } = makeClient([{ statusCode: 200 }]);
    await client.verifyToken('the-token-value');
    assert.strictEqual(requestedOptions[0].headers['Cookie'], 'jwtToken=the-token-value');
  });

  describe('invalidateToken', function () {
    it('invalidates a z/OSMF JWT using the APIML request contract', async function () {
      const { client, requestedOptions } = makeClient([{ statusCode: 204 }]);
      const result = await client.invalidateToken('jwtToken', 'native-jwt');

      assert.deepStrictEqual(result, { success: true });
      assert.strictEqual(requestedOptions[0].method, 'DELETE');
      assert.strictEqual(requestedOptions[0].path, '/zosmf/services/authenticate');
      assert.strictEqual(requestedOptions[0].headers['X-CSRF-ZOSMF-HEADER'], '');
      assert.strictEqual(requestedOptions[0].headers['Cookie'], 'jwtToken=native-jwt');
    });

    it('invalidates an LTPA token using its native cookie name', async function () {
      const { client, requestedOptions } = makeClient([{ statusCode: 200 }]);
      const result = await client.invalidateToken('LtpaToken2', 'native-ltpa');

      assert.deepStrictEqual(result, { success: true });
      assert.strictEqual(requestedOptions[0].headers['Cookie'], 'LtpaToken2=native-ltpa');
    });

    it('reports an unsupported logout endpoint without exposing the token', async function () {
      const loggedArguments = [];
      const logger = {
        debug() {},
        info() {},
        warn() { loggedArguments.push(Array.from(arguments)); },
        error() {}
      };
      const { client } = makeClient([{ statusCode: 404 }], logger);
      const result = await client.invalidateToken('jwtToken', 'secret-native-jwt');

      assert.deepStrictEqual(result, { success: false, reason: 'unsupported', statusCode: 404 });
      assert.strictEqual(JSON.stringify(loggedArguments).includes('secret-native-jwt'), false);
    });

    it('reports network errors without rejecting', async function () {
      const { client } = makeClient([{ networkError: 'ECONNREFUSED' }]);
      const result = await client.invalidateToken('jwtToken', 'native-jwt');
      assert.deepStrictEqual(result, { success: false, reason: 'unreachable' });
    });

    it('bounds the invalidation request with the APIML service timeout', async function () {
      const { client } = makeClient([{ timeout: true }]);
      const result = await client.invalidateToken('LtpaToken2', 'native-ltpa');
      assert.deepStrictEqual(result, { success: false, reason: 'timeout' });
    });

    it('rejects unsupported credential types without sending a request', async function () {
      const { client, requestedOptions } = makeClient([]);
      const result = await client.invalidateToken('unsupportedCookie', 'credential');
      assert.deepStrictEqual(result, { success: false, reason: 'invalidCredential' });
      assert.strictEqual(requestedOptions.length, 0);
    });
  });
});
