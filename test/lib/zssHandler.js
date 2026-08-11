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
});
