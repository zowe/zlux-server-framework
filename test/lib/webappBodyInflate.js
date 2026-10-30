/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

const assert = require('assert');
const express = require('express');
const http = require('http');
const zlib = require('zlib');

// Request bodies with a Content-Encoding are only decompressed when
// components.app-server.node.inflate is true. These tests mount a root service
// that requires a JSON body on a private express app and check both settings.
describe('webapp request body inflate setting', function () {
  let makeWebApp;

  before(function () {
    try {
      makeWebApp = require('../../lib/webapp').makeWebApp;
    } catch (e) {
      console.warn('Could not load webapp module:', e.message);
      this.skip();
    }
  });

  function makeApp(nodeOverrides) {
    const webApp = makeWebApp({
      zoweConfig: {
        zowe: { cookieIdentifier: 'test', externalDomains: ['localhost'] },
        components: {
          'app-server': {
            productDir: __dirname,
            checkReferrer: {},
            dataserviceAuthentication: { rbac: false, defaultAuthentication: 'fallback' },
            node: Object.assign({
              productCode: 'XXX',
              http: { port: 0, ipAddresses: [] },
              https: {},
              checkReferrer: {},
              mediationLayer: { enabled: false, server: { gatewayPort: 7554, gatewayHostname: 'localhost' } }
            }, nodeOverrides)
          }
        }
      },
      port: 31391,
      isHttps: false,
      proxiedHost: 'localhost',
      proxiedPort: 1,
      auth: {
        doLogin() {}, doPasswordReset() {}, doPassTicket() {}, getStatus() {}, doLogout() {}, refreshStatus() {},
        semiAuthenticatedMiddleware(req, res, next) { next(); },
        addProxyAuthorizations() {},
        processProxiedHeaders(req, headers) { return headers; },
        middleware(req, res, next) { next(); }
      }
    });
    // the shared module-level express app is not used, so that routes do not leak between tests
    webApp.expressApp = express();
    webApp.installCommonMiddleware();
    webApp._installRootService('/echo', 'post', (req, res) => res.status(200).json(req.body),
      { needJson: true, needAuth: false });
    webApp.installRootServices();
    return webApp.expressApp;
  }

  // Sends the raw bytes with fetch: superagent would JSON-encode a Buffer for this content type.
  const post = async (app, encoding, body, path = '/echo') => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const headers = { 'Content-Type': 'application/json', 'Connection': 'close' };
      if (encoding) {
        headers['Content-Encoding'] = encoding;
      }
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers, body });
      return { status: response.status, text: await response.text() };
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  };
  const gzipped = zlib.gzipSync('{"a":1}');

  it('parses an uncompressed body by default', async function () {
    const res = await post(makeApp(), undefined, '{"a":1}');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(JSON.parse(res.text), { a: 1 });
  });

  it('rejects a gzip body with 415 by default', async function () {
    const res = await post(makeApp(), 'gzip', gzipped);
    assert.strictEqual(res.status, 415);
  });

  it('rejects a br body with 415 by default', async function () {
    const res = await post(makeApp(), 'br', Buffer.from('{"a":1}'));
    assert.strictEqual(res.status, 415);
  });

  it('rejects a gzip body with 415 when inflate is false', async function () {
    const res = await post(makeApp({ inflate: false }), 'gzip', gzipped);
    assert.strictEqual(res.status, 415);
  });

  it('parses a gzip body when inflate is true', async function () {
    const res = await post(makeApp({ inflate: true }), 'gzip', gzipped);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(JSON.parse(res.text), { a: 1 });
  });

  it('rejects a br body with 415 even when inflate is true', async function () {
    const res = await post(makeApp({ inflate: true }), 'br', Buffer.from('{"a":1}'));
    assert.strictEqual(res.status, 415);
  });

  // The /server router parses JSON itself and reports parse failures as 400.
  // A content encoding that is not decoded is not a JSON problem, so it answers 415.
  describe('/server router', function () {
    it('answers 415 for a gzip body by default', async function () {
      const res = await post(makeApp(), 'gzip', gzipped, '/server/environment');
      assert.strictEqual(res.status, 415);
      assert.ok(res.text.includes('Unsupported content encoding'), res.text);
    });

    it('answers 415 for a br body even when inflate is true', async function () {
      const res = await post(makeApp({ inflate: true }), 'br', Buffer.from('{"a":1}'), '/server/environment');
      assert.strictEqual(res.status, 415);
    });

    it('does not answer 415 for a gzip body when inflate is true', async function () {
      const res = await post(makeApp({ inflate: true }), 'gzip', gzipped, '/server/environment');
      assert.notStrictEqual(res.status, 415);
      assert.notStrictEqual(res.status, 400);
    });

    it('still answers 400 for an invalid JSON body', async function () {
      const res = await post(makeApp(), undefined, '{not json', '/server/environment');
      assert.strictEqual(res.status, 400);
      assert.ok(res.text.includes('Invalid JSON'), res.text);
    });
  });
});
