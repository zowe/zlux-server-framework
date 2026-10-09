/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

const assert = require('assert');
const sinon = require('sinon');

// Regression tests for the RBAC-for-WebSocket security fix. Prior to the fix,
// the ZSS auth handler unconditionally authorized any authenticated user when
// the request was a WebSocket (the `syncOnly` short-circuit), bypassing the SAF
// check. These tests assert that WebSocket requests now go through the same
// agent (SAF) authorization call as REST requests.
describe('zssHandler', function () {
  let zssHandlerFactory;

  const NOOP_LOGGER = { debug() {}, info() {}, warn() {}, error() {} };
  const SERVER_CONF = {
    instanceID: 'TESTINSTANCE',
    cookieIdentifier: '1',
    agent: { https: { port: 7557 } }
  };
  const WEBSOCKET_URL =
    '/ZLUX/plugins/org.zowe.terminal.proxy/services/_unp/_current/data.websocket';

  before(function () {
    try {
      zssHandlerFactory = require('../../plugins/sso-auth/lib/zssHandler');
    } catch (e) {
      console.warn('Could not load zssHandler module:', e.message);
      this.skip();
    }
  });

  function makeHandler() {
    return zssHandlerFactory({}, {}, SERVER_CONF, { logger: NOOP_LOGGER });
  }

  function makeRequest(safStub, originalUrl) {
    return {
      originalUrl: originalUrl || WEBSOCKET_URL,
      method: 'GET',
      ip: '127.0.0.1',
      cookies: {},
      zluxData: { webApp: { callRootService: safStub } }
    };
  }

  it('should authorize a WebSocket request when the SAF check passes', async function () {
    const handler = makeHandler();
    const saf = sinon.stub().resolves({
      statusCode: 200,
      body: JSON.stringify({ authorized: true })
    });
    const request = makeRequest(saf);
    const sessionState = { authenticated: true, username: 'TESTUSER' };

    const result = await handler.authorized(request, sessionState, {
      syncOnly: true,
      bypassAuthorizatonCheck: false
    });

    assert.strictEqual(saf.calledOnce, true, 'the SAF agent must be queried for WebSocket requests');
    assert.strictEqual(saf.firstCall.args[0], 'saf-auth');
    assert.strictEqual(result.authenticated, true);
    assert.strictEqual(result.authorized, true);
  });

  it('should DENY a WebSocket request when the SAF check fails (no syncOnly bypass)', async function () {
    const handler = makeHandler();
    const saf = sinon.stub().resolves({
      statusCode: 200,
      body: JSON.stringify({ authorized: false, message: 'no access' })
    });
    const request = makeRequest(saf);
    const sessionState = { authenticated: true, username: 'TESTUSER' };

    const result = await handler.authorized(request, sessionState, {
      syncOnly: true,
      bypassAuthorizatonCheck: false
    });

    assert.strictEqual(saf.calledOnce, true, 'the SAF agent must be queried for WebSocket requests');
    assert.strictEqual(result.authenticated, true);
    assert.strictEqual(result.authorized, false,
      'WebSocket requests must not be authorized when the SAF check denies access');
  });

  it('should still bypass the SAF check when RBAC is disabled (bypassAuthorizatonCheck)', async function () {
    const handler = makeHandler();
    const saf = sinon.stub().resolves({
      statusCode: 200,
      body: JSON.stringify({ authorized: true })
    });
    const request = makeRequest(saf);
    const sessionState = { authenticated: true, username: 'TESTUSER' };

    const result = await handler.authorized(request, sessionState, {
      syncOnly: true,
      bypassAuthorizatonCheck: true
    });

    assert.strictEqual(saf.called, false,
      'when RBAC is disabled the agent is not queried; access is granted via bypass, not the WebSocket short-circuit');
    assert.strictEqual(result.authorized, true);
  });

  it('should query the SAF agent for non-WebSocket requests the same way', async function () {
    const handler = makeHandler();
    const saf = sinon.stub().resolves({
      statusCode: 200,
      body: JSON.stringify({ authorized: true })
    });
    const request = makeRequest(saf,
      '/ZLUX/plugins/org.zowe.terminal.proxy/services/_unp/_current/data');
    const sessionState = { authenticated: true, username: 'TESTUSER' };

    const result = await handler.authorized(request, sessionState, {
      syncOnly: false,
      bypassAuthorizatonCheck: false
    });

    assert.strictEqual(saf.calledOnce, true);
    assert.strictEqual(result.authorized, true);
  });

  it('should not authenticate when the session is not authenticated', async function () {
    const handler = makeHandler();
    const saf = sinon.stub().resolves({
      statusCode: 200,
      body: JSON.stringify({ authorized: true })
    });
    const request = makeRequest(saf);
    const sessionState = { authenticated: false };

    const result = await handler.authorized(request, sessionState, {
      syncOnly: true,
      bypassAuthorizatonCheck: false
    });

    assert.strictEqual(saf.called, false);
    assert.strictEqual(result.authenticated, false);
    assert.strictEqual(result.authorized, false);
  });

  // A real express-ws upgrade arrives as '<service>/_current/.websocket'. The
  // SAF resource must be the service's normal GET resource, not a malformed
  // '<service>.GET..WEBSOCKET' that no admin profile would match.
  const UPGRADE_URL =
    '/ZLUX/plugins/org.zowe.terminal.proxy/services/tn3270data/_current/.websocket';
  const REST_GET_URL =
    '/ZLUX/plugins/org.zowe.terminal.proxy/services/tn3270data/_current/';

  function resourceQueriedFor(originalUrl) {
    const handler = makeHandler();
    const saf = sinon.stub().resolves({
      statusCode: 200,
      body: JSON.stringify({ authorized: true })
    });
    const request = makeRequest(saf, originalUrl);
    return handler.authorized(request, { authenticated: true, username: 'TESTUSER' }, {
      syncOnly: originalUrl.endsWith('.websocket'),
      bypassAuthorizatonCheck: false
    }).then(() => saf.firstCall.args[1]);
  }

  it('maps a WebSocket upgrade to the service GET resource (strips .websocket)', async function () {
    const resource = await resourceQueriedFor(UPGRADE_URL);
    assert.strictEqual(resource,
      'ZLUX.TESTINSTANCE.SVC.ORG_ZOWE_TERMINAL_PROXY.TN3270DATA.GET/READ');
  });

  it('authorizes a WebSocket upgrade against the same resource as the REST GET', async function () {
    const wsResource = await resourceQueriedFor(UPGRADE_URL);
    const restResource = await resourceQueriedFor(REST_GET_URL);
    assert.strictEqual(wsResource, restResource);
  });

  // Regression tests: addProxyAuthorizations must forward only cookies ZSS itself
  // recognizes, never the client's raw Cookie header (see apiml.ts's ZSS fallback proxy).
  describe('addProxyAuthorizations', function () {
    const TOKEN_NAME = 'apimlAuthenticationToken';

    it('forwards only the tracked ZSS session cookie, not the client raw Cookie header', function () {
      const handler = makeHandler();
      const sessionState = { zssCookies: 'jedHTTPSession.7557=abc123' };
      const req1 = {
        cookies: { 'jedHTTPSession.7557': 'abc123', unrelatedThirdPartyCookie: 'attacker-set-value' },
        headers: { cookie: 'jedHTTPSession.7557=abc123; unrelatedThirdPartyCookie=attacker-set-value' }
      };
      const req2Options = { headers: {} };

      handler.addProxyAuthorizations(req1, req2Options, sessionState);

      assert.strictEqual(req2Options.headers['cookie'], 'jedHTTPSession.7557=abc123');
    });

    it('also forwards the apimlAuthenticationToken cookie when present, alongside the ZSS cookie', function () {
      const handler = makeHandler();
      const sessionState = { zssCookies: 'jedHTTPSession.7557=abc123' };
      const req1 = { cookies: { [TOKEN_NAME]: 'jwt-value' }, headers: {} };
      const req2Options = { headers: {} };

      handler.addProxyAuthorizations(req1, req2Options, sessionState);

      assert.strictEqual(req2Options.headers['cookie'], 'jedHTTPSession.7557=abc123; apimlAuthenticationToken=jwt-value');
    });

    it('forwards only the apimlAuthenticationToken cookie when no ZSS session cookie is tracked', function () {
      const handler = makeHandler();
      const sessionState = {};
      const req1 = { cookies: { [TOKEN_NAME]: 'jwt-value' }, headers: {} };
      const req2Options = { headers: {} };

      handler.addProxyAuthorizations(req1, req2Options, sessionState);

      assert.strictEqual(req2Options.headers['cookie'], 'apimlAuthenticationToken=jwt-value');
    });

    it('sets no cookie header when neither credential is present', function () {
      const handler = makeHandler();
      const req1 = { cookies: {}, headers: {} };
      const req2Options = { headers: {} };

      handler.addProxyAuthorizations(req1, req2Options, {});

      assert.strictEqual(req2Options.headers['cookie'], undefined);
    });
  });
});

// The bypass list in ZssHandler.authorized() used to be matched with
// originalUrl.startsWith(entry), so any route that merely started with a listed
// entry (e.g. /unixfileX) was authorized without a session. The match is now
// done on the parsed pathname: the entry itself, or the entry followed by '/'.
describe('zssHandler bypass path matching', function () {
  let zssHandlerFactory;

  const NOOP_LOGGER = { debug() {}, info() {}, warn() {}, error() {} };
  const SERVER_CONF = {
    instanceID: 'TESTINSTANCE',
    cookieIdentifier: '1',
    agent: { https: { port: 7557 } }
  };
  const BYPASS_ENTRIES = [
    '/login',
    '/logout',
    '/password',
    '/unixfile',
    '/datasetContents',
    '/VSAMdatasetContents',
    '/datasetMetadata',
    '/omvs',
    '/security-mgmt',
    '/passticket'
  ];

  before(function () {
    try {
      zssHandlerFactory = require('../../plugins/sso-auth/lib/zssHandler');
    } catch (e) {
      console.warn('Could not load zssHandler module:', e.message);
      this.skip();
    }
  });

  // Returns the authorization result and the SAF stub, so tests can also assert
  // whether the agent was queried.
  async function authorize(originalUrl, sessionState, options) {
    const handler = zssHandlerFactory({}, {}, SERVER_CONF, { logger: NOOP_LOGGER });
    const saf = sinon.stub().resolves({
      statusCode: 200,
      body: JSON.stringify({ authorized: true })
    });
    const request = {
      originalUrl,
      method: 'GET',
      ip: '127.0.0.1',
      cookies: {},
      zluxData: { webApp: { callRootService: saf } }
    };
    const result = await handler.authorized(request, sessionState, options || { bypassAuthorizatonCheck: false });
    return { result, saf };
  }

  BYPASS_ENTRIES.forEach(function (entry) {
    it(`should authorize ${entry} without a session`, async function () {
      const { result } = await authorize(entry, { authenticated: false });
      assert.strictEqual(result.authorized, true);
    });

    it(`should authorize a sub-path of ${entry} without a session`, async function () {
      const { result } = await authorize(entry + '/some/sub/path', { authenticated: false });
      assert.strictEqual(result.authorized, true);
    });
  });

  it('should ignore the query string when matching a bypass entry', async function () {
    const { result } = await authorize('/datasetContents?dsn=USER.DATA', { authenticated: false });
    assert.strictEqual(result.authorized, true);
  });

  it('should not let a bypass entry in the query string authorize another route', async function () {
    const { result, saf } = await authorize('/somethingelse?next=/unixfile', { authenticated: false });
    assert.strictEqual(result.authorized, false);
    assert.strictEqual(result.authenticated, false);
    assert.strictEqual(saf.called, false);
  });

  [
    '/unixfileX',
    '/omvsAnything',
    '/loginfoo',
    '/passwordreset',
    '/datasetContentsX/sub',
    '/security-mgmtfoo'
  ].forEach(function (route) {
    it(`should not authorize ${route} without a session, since it only shares a prefix with a bypass entry`, async function () {
      const { result, saf } = await authorize(route, { authenticated: false });
      assert.strictEqual(result.authorized, false);
      assert.strictEqual(result.authenticated, false);
      assert.strictEqual(saf.called, false);
    });
  });

  it('should not match a bypass entry that appears later in the path', async function () {
    const { result } = await authorize('/foo/unixfile', { authenticated: false });
    assert.strictEqual(result.authorized, false);
  });

  it('should still require a session for routes that are not in the bypass list', async function () {
    const { result, saf } = await authorize('/jes/jobs', { authenticated: false });
    assert.strictEqual(result.authorized, false);
    assert.strictEqual(result.authenticated, false);
    assert.strictEqual(saf.called, false);
  });

  it('should keep applying the SAF endpoint check to routes outside the bypass list when RBAC is on', async function () {
    const { result, saf } = await authorize('/jes/jobs', { authenticated: true, username: 'TESTUSER' },
                                            { bypassAuthorizatonCheck: false });
    assert.strictEqual(saf.calledOnce, true);
    assert.strictEqual(saf.firstCall.args[0], 'saf-auth');
    assert.strictEqual(result.authorized, true);
  });

  it('should not run the SAF endpoint check for bypass entries, even for an authenticated user with RBAC on', async function () {
    const { result, saf } = await authorize('/unixfile/etc/hosts', { authenticated: true, username: 'TESTUSER' },
                                            { bypassAuthorizatonCheck: false });
    assert.strictEqual(saf.called, false);
    assert.strictEqual(result.authorized, true);
  });
});
