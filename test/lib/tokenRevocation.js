/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const assert = require('assert');
const sinon = require('sinon');
const fs = require('fs');
const path = require('path');

let loadError = null;
let localJwt, gatewayApiHandlerFactory, pluginStorage, apimlStorage;
try {
  localJwt = require('../../plugins/sso-auth/lib/localJwt');
  gatewayApiHandlerFactory = require('../../plugins/sso-auth/lib/gatewayApiHandler');
  pluginStorage = require('../../lib/pluginStorage');
  apimlStorage = require('../../lib/apimlStorage');
} catch (e) {
  loadError = e;
}

describe('server-side token revocation (S-06)', function () {
  const NOOP_LOGGER = { debug() {}, info() {}, warn() {}, error() {}, severe() {} };
  const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
  const certificatePem = fs.readFileSync(path.join(FIXTURES_DIR, 'mock-cert.pem'));
  const privateKeyPem = fs.readFileSync(path.join(FIXTURES_DIR, 'mock-key.pem'));
  const keyMaterial = { algorithm: 'RS256', privateKeyPem, certificatePem };
  let savedClusterManager;
  let isConfiguredStub;

  before(function () {
    if (loadError) {
      console.warn('Could not load auth modules:', loadError.message);
      this.skip();
    }
    // See test/lib/webauth.js for why this guard is needed: process.clusterManager
    // and apimlStorage's configured flag are process-wide singletons mutated by
    // other test files, and would otherwise force 'cluster'/'ha' storage here.
    savedClusterManager = process.clusterManager;
    delete process.clusterManager;
    isConfiguredStub = sinon.stub(apimlStorage, 'isConfigured').returns(false);
  });

  after(function () {
    if (savedClusterManager !== undefined) {
      process.clusterManager = savedClusterManager;
    }
    if (isConfiguredStub) {
      isConfiguredStub.restore();
    }
  });

  describe('localJwt.revokeToken / isTokenRevoked', function () {
    it('reports an untouched token as not revoked', async function () {
      const token = localJwt.createLocalJwt('ALICE', 60000, keyMaterial);
      const revoked = await localJwt.isTokenRevoked(token, NOOP_LOGGER);
      assert.strictEqual(revoked, false);
    });

    it('reports a revoked token as revoked', async function () {
      const token = localJwt.createLocalJwt('BOB', 60000, keyMaterial);
      await localJwt.revokeToken(token, Date.now() + 60000, NOOP_LOGGER);
      const revoked = await localJwt.isTokenRevoked(token, NOOP_LOGGER);
      assert.strictEqual(revoked, true);
    });

    it('does not affect other tokens for the same or different users', async function () {
      // Different expirationMs so the two tokens (same user, same second)
      // don't collide into an identical payload/signature/hash.
      const tokenA = localJwt.createLocalJwt('CAROL', 60000, keyMaterial);
      const tokenB = localJwt.createLocalJwt('CAROL', 61000, keyMaterial);
      await localJwt.revokeToken(tokenA, Date.now() + 60000, NOOP_LOGGER);
      assert.strictEqual(await localJwt.isTokenRevoked(tokenA, NOOP_LOGGER), true);
      assert.strictEqual(await localJwt.isTokenRevoked(tokenB, NOOP_LOGGER), false,
        'a second, differently-signed token for the same user must not be caught by the first token\'s hash');
    });

    it('prunes and stops reporting revoked once the recorded expiration has passed', async function () {
      const token = localJwt.createLocalJwt('DAVE', 60000, keyMaterial);
      await localJwt.revokeToken(token, Date.now() - 1, NOOP_LOGGER); // already "expired" at revocation time
      const revoked = await localJwt.isTokenRevoked(token, NOOP_LOGGER);
      assert.strictEqual(revoked, false,
        'a revocation entry past its own expMs is stale -- the exp claim would reject the token anyway');
    });

    it('fails open (reports not revoked) when the storage backend errors', async function () {
      const stub = sinon.stub(pluginStorage, 'PluginStorageFactory').returns({
        get: () => Promise.reject(new Error('storage unavailable')),
        set: () => Promise.reject(new Error('storage unavailable')),
        delete: () => Promise.reject(new Error('storage unavailable'))
      });
      try {
        const token = localJwt.createLocalJwt('ERIN', 60000, keyMaterial);
        const revoked = await localJwt.isTokenRevoked(token, NOOP_LOGGER);
        assert.strictEqual(revoked, false);
        await assert.doesNotReject(() => localJwt.revokeToken(token, Date.now() + 60000, NOOP_LOGGER));
      } finally {
        stub.restore();
      }
    });
  });

  describe('gatewayApiHandler integration (LTPA mode)', function () {
    const LTPA_MODE_ZOWE_CONF = {
      zowe: { network: {} },
      components: { 'app-server': {}, gateway: { apiml: { security: { auth: { zosmf: {} } } } } },
      zOSMF: { host: 'zosmf.example.com', port: 1443 }
    };

    function makeHandler() {
      // extractTlsKeyMaterial calls process.exit(1) if key/cert are absent --
      // must supply real fixture material, not an empty tlsOptions object.
      const tlsOptions = { key: [privateKeyPem], cert: [certificatePem] };
      return gatewayApiHandlerFactory({}, {}, {}, { logger: NOOP_LOGGER, tlsOptions }, LTPA_MODE_ZOWE_CONF);
    }

    it('rejects a signature-valid, non-expired token that has been revoked', async function () {
      const handler = makeHandler();
      const token = localJwt.createLocalJwt('FRANK', 60000, handler.keyMaterial);
      const result = await handler.queryToken(token);
      assert.strictEqual(result.userId, 'FRANK', 'sanity check: token is valid before revocation');

      await localJwt.revokeToken(token, Date.now() + 60000, NOOP_LOGGER);
      await assert.rejects(() => handler.queryToken(token), /revoked/i);
    });

    it('logout() revokes the session token so a replayed cookie is rejected afterwards', async function () {
      const handler = makeHandler();
      const token = localJwt.createLocalJwt('GRACE', 60000, handler.keyMaterial);
      const sessionState = {
        zosmfToken: token,
        zosmfTokenExpMs: Date.now() + 60000,
        zosmfNativeCookieName: 'LtpaToken2',
        zosmfNativeCookieValue: 'native-ltpa'
      };
      const invalidateToken = sinon.stub(handler.zosmfClient, 'invalidateToken').resolves({ success: true });

      const preLogout = await handler.queryToken(token);
      assert.strictEqual(preLogout.userId, 'GRACE');

      const logoutResult = await handler.logout({}, sessionState);
      assert.strictEqual(logoutResult.success, true);
      assert.strictEqual(invalidateToken.calledOnceWithExactly('LtpaToken2', 'native-ltpa'), true);
      assert.strictEqual(sessionState.zosmfToken, undefined, 'cleanupSession should still clear session state');
      assert.strictEqual(sessionState.zosmfNativeCookieValue, undefined);

      // A client that replays the cookie after logout must be rejected even
      // though the JWT's own signature and exp claim are still fine.
      await assert.rejects(() => handler.queryToken(token), /revoked/i);
    });

    it('still revokes locally and cleans up when native LTPA invalidation fails', async function () {
      const handler = makeHandler();
      const token = localJwt.createLocalJwt('HEIDI', 60000, handler.keyMaterial);
      const sessionState = {
        zosmfToken: token,
        zosmfTokenExpMs: Date.now() + 60000,
        zosmfNativeCookieName: 'LtpaToken2',
        zosmfNativeCookieValue: 'native-ltpa'
      };
      sinon.stub(handler.zosmfClient, 'invalidateToken').resolves({ success: false, reason: 'unreachable' });

      const result = await handler.logout({}, sessionState);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.cookies[0].name, localJwt.TOKEN_NAME);
      assert.strictEqual(sessionState.zosmfNativeCookieName, undefined);
      await assert.rejects(() => handler.queryToken(token), /revoked/i);
    });

    it('still revokes locally and cleans up when native invalidation throws synchronously', async function () {
      const handler = makeHandler();
      const token = localJwt.createLocalJwt('HEIDI2', 60000, handler.keyMaterial);
      const sessionState = {
        zosmfToken: token,
        zosmfTokenExpMs: Date.now() + 60000,
        zosmfNativeCookieName: 'LtpaToken2',
        zosmfNativeCookieValue: 'native-ltpa'
      };
      sinon.stub(handler.zosmfClient, 'invalidateToken').throws(new Error('request setup failed'));

      const result = await handler.logout({}, sessionState);

      assert.strictEqual(result.success, true);
      assert.strictEqual(sessionState.zosmfNativeCookieValue, undefined);
      await assert.rejects(() => handler.queryToken(token), /revoked/i);
    });

    it('revokes a presented wrapper token when its Express session state is missing', async function () {
      const handler = makeHandler();
      const token = localJwt.createLocalJwt('IVAN', 60000, handler.keyMaterial);
      const invalidateToken = sinon.stub(handler.zosmfClient, 'invalidateToken');
      const request = { cookies: { apimlAuthenticationToken: token }, headers: {} };

      const result = await handler.logout(request, {});

      assert.strictEqual(result.success, true);
      assert.strictEqual(invalidateToken.called, false, 'the native LTPA value must not be reconstructed');
      await assert.rejects(() => handler.queryToken(token), /revoked/i);
    });

    it('logout() is a no-op (no throw) when there is no token in the session', async function () {
      const handler = makeHandler();
      const result = await handler.logout({}, {});
      assert.strictEqual(result.success, true);
    });
  });

  describe('gatewayApiHandler integration (JWT mode)', function () {
    const JWT_MODE_ZOWE_CONF = {
      zowe: { network: {} },
      components: {
        'app-server': {},
        gateway: { apiml: { security: { auth: { zosmf: { jwtAutoconfiguration: 'jwt' } } } } }
      },
      zOSMF: { host: 'zosmf.example.com', port: 1443 }
    };

    it('uses the presented z/OSMF JWT as the native credential after session loss', async function () {
      const handler = gatewayApiHandlerFactory(
        {}, {}, {}, { logger: NOOP_LOGGER, tlsOptions: {} }, JWT_MODE_ZOWE_CONF
      );
      const token = localJwt.createLocalJwt('JUDY', 60000, keyMaterial);
      const invalidateToken = sinon.stub(handler.zosmfClient, 'invalidateToken').resolves({ success: true });
      const request = { cookies: {}, headers: { authorization: `Bearer ${token}` } };

      const result = await handler.logout(request, {});

      assert.strictEqual(result.success, true);
      assert.strictEqual(invalidateToken.calledOnceWithExactly('jwtToken', token), true);
      assert.strictEqual(await localJwt.isTokenRevoked(token, NOOP_LOGGER), true);
    });
  });
});
