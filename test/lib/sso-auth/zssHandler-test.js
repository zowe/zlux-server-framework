/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

const assert = require('assert');
const makeZssHandler = require('../../../plugins/sso-auth/lib/zssHandler.js');

function makeHandler() {
  const noop = () => {};
  const context = { logger: { debug: noop, info: noop, warn: noop, error: noop } };
  const serverConf = {
    instanceID: '1',
    cookieIdentifier: 'test',
    agent: { https: { port: 12345 } }
  };
  return makeZssHandler({}, {}, serverConf, context);
}

// A plugin-service WebSocket URL. req.url would end in ".websocket", which is
// what used to trigger the fail-open syncOnly branch.
const WS_URL =
  '/ZLUX/plugins/org.zowe.terminal.proxy/services/tn3270data/_current/index.websocket';

describe('ZssHandler.authorized (WebSocket RBAC)', function() {
  it('runs the SAF check for a .websocket URL when RBAC is enabled', async function() {
    const handler = makeHandler();
    let agentCalled = false;
    handler._callAgent = async function() {
      agentCalled = true;
      // Simulate a user WITHOUT READ access to the profile.
      return { statusCode: 200, body: JSON.stringify({ authorized: false, message: 'no access' }) };
    };
    const request = { originalUrl: WS_URL, method: 'GET', zluxData: {} };
    const sessionState = { authenticated: true, username: 'BADUSER' };
    // syncOnly:true is what the auth middleware passes for a ".websocket" URL.
    // This is the exact input that used to hit the fail-open branch.
    const result = await handler.authorized(request, sessionState,
      { syncOnly: true, bypassAuthorizatonCheck: false });

    assert.strictEqual(agentCalled, true, 'SAF /saf-auth check must run for WebSocket requests');
    assert.strictEqual(result.authenticated, true);
    assert.strictEqual(result.authorized, false, 'denied user must NOT be authorized (this is the bug fix)');
  });

  it('authorizes a .websocket URL when the user has SAF access', async function() {
    const handler = makeHandler();
    handler._callAgent = async function() {
      return { statusCode: 200, body: JSON.stringify({ authorized: true }) };
    };
    const request = { originalUrl: WS_URL, method: 'GET', zluxData: {} };
    const sessionState = { authenticated: true, username: 'GOODUSER' };
    const result = await handler.authorized(request, sessionState,
      { syncOnly: true, bypassAuthorizatonCheck: false });

    assert.strictEqual(result.authorized, true);
  });

  it('short-circuits (no SAF call) when RBAC is disabled', async function() {
    const handler = makeHandler();
    let agentCalled = false;
    handler._callAgent = async function() { agentCalled = true; return {}; };
    handler.setCookieFromRequest = () => {};
    const request = { originalUrl: WS_URL, method: 'GET', zluxData: {} };
    const sessionState = { authenticated: true, username: 'ANYUSER' };
    const result = await handler.authorized(request, sessionState, { bypassAuthorizatonCheck: true });

    assert.strictEqual(agentCalled, false, 'RBAC disabled must not call the agent');
    assert.strictEqual(result.authorized, true);
  });
});
