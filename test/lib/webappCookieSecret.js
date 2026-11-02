/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

const WEBAPP_PATH = require.resolve('../../lib/webapp');

function zoweConfig() {
  return {
    zowe: { cookieIdentifier: 'test', externalDomains: ['localhost'] },
    components: {
      'app-server': {
        productDir: __dirname,
        checkReferrer: {},
        dataserviceAuthentication: { rbac: false, defaultAuthentication: 'fallback' },
        node: {
          productCode: 'ZLUX',
          http: { port: 0, ipAddresses: [] },
          https: {},
          checkReferrer: {},
          mediationLayer: { enabled: false, server: { gatewayPort: 7554, gatewayHostname: 'localhost' } },
          allowInvalidTLSProxy: true
        }
      }
    }
  };
}

const auth = {
  doLogin() {}, doPasswordReset() {}, doPassTicket() {}, getStatus() {}, doLogout() {}, refreshStatus() {},
  semiAuthenticatedMiddleware(req, res, next) { next(); },
  middleware(req, res, next) { next(); },
  addProxyAuthorizations() {},
  processProxiedHeaders(req, headers) { return headers; }
};

describe('webapp session cookie secret', function () {
  const tlsKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' });
  let webapp;
  let sessionModule;
  let realSession;
  let capturedSecrets;

  before(function () {
    let sessionPath;
    try {
      sessionPath = require.resolve('express-session', { paths: [path.dirname(WEBAPP_PATH)] });
      realSession = require(sessionPath);
    } catch (e) {
      console.warn('Could not load express-session:', e.message);
      this.skip();
    }
    // Wrap express-session so the options webapp hands it can be inspected.
    sessionModule = require.cache[sessionPath];
    const wrapper = Object.assign(function (opts) {
      capturedSecrets.push(opts.secret);
      return realSession(opts);
    }, realSession);
    sessionModule.exports = wrapper;
    delete require.cache[WEBAPP_PATH];
    try {
      webapp = require(WEBAPP_PATH);
    } catch (e) {
      console.warn('Could not load webapp module:', e.message);
      this.skip();
    }
  });

  after(function () {
    if (sessionModule) {
      sessionModule.exports = realSession;
    }
    delete require.cache[WEBAPP_PATH];
  });

  beforeEach(function () {
    capturedSecrets = [];
    delete process.env.expressSessionSecret;
  });

  function makeApp() {
    webapp.makeWebApp({
      zoweConfig: zoweConfig(),
      port: 0,
      isHttps: true,
      proxiedHost: 'localhost',
      proxiedPort: 1,
      tlsOptions: { key: [Buffer.from(tlsKey)], cert: [] },
      auth
    });
    assert.strictEqual(capturedSecrets.length, 1);
    return capturedSecrets.pop();
  }

  it('does not derive the secret from the TLS private key', function () {
    const md5OfKey = crypto.createHash('md5').update(Buffer.from(tlsKey)).digest('hex');
    const secret = makeApp();
    assert.notStrictEqual(secret, md5OfKey);
    assert.match(secret, /^[0-9a-f]{64}$/);
  });

  it('generates a different secret per process when none is handed down', function () {
    assert.notStrictEqual(makeApp(), makeApp());
  });

  it('uses the secret shared by the cluster manager and removes it from the environment', function () {
    process.env.expressSessionSecret = 'cluster-shared-secret';
    assert.strictEqual(makeApp(), 'cluster-shared-secret');
    assert.strictEqual(process.env.expressSessionSecret, undefined);
  });
});
