/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

const assert = require('assert');
const http = require('http');
const express = require('express');
const sinon = require('sinon');
const { Writable } = require('stream');
const constants = require('../../lib/unp-constants');
const PluginLoader = require('../../lib/plugin-loader');
const externalProxyPluginDef = require('./fixtures/webapp-external-proxy-plugin.json');

// A dataservice that declares requiresRbac must fail closed (403) while RBAC is
// disabled, because with RBAC off every authenticated user passes the SAF check.
//
// lib/webapp.js keeps its express app, plugin list and proxy map at module level,
// so these tests use their own plugin id and mount only the per-service middleware
// chain on a private express app instead of going through the shared one.
describe('webapp requiresRbac', function () {
  const productCode = 'XXX';
  const pluginId = 'org.zowe.requiresrbactest';
  const serviceName = externalProxyPluginDef.dataServices[0].name;
  const appDataKey = `${constants.APP_NAME}Data`;

  let makeWebApp;
  let targetServer;
  let targetRequestCount;
  let appServer;

  before(function () {
    try {
      makeWebApp = require('../../lib/webapp').makeWebApp;
    } catch (e) {
      console.warn('Could not load webapp module:', e.message);
      this.skip();
    }
  });

  beforeEach(function (done) {
    targetRequestCount = 0;
    targetServer = http.createServer(function (req, res) {
      targetRequestCount++;
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Connection': 'close' });
      res.end('proxied-ok');
    });
    targetServer.listen(0, '127.0.0.1', done);
  });

  afterEach(function (done) {
    targetServer.close(function () {
      if (!appServer) {
        return done();
      }
      const server = appServer;
      appServer = null;
      server.close(done);
    });
    if (appServer && appServer.closeAllConnections) {
      appServer.closeAllConnections();
    }
  });

  function zoweConfigFor(rbac) {
    return {
      zowe: { cookieIdentifier: 'test', externalDomains: ['localhost'] },
      components: {
        'app-server': {
          productDir: __dirname,
          checkReferrer: {},
          dataserviceAuthentication: { rbac: rbac, defaultAuthentication: 'fallback' },
          enablePasswordChange: true,
          node: {
            productCode: productCode,
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

  function makeWebAppFor(rbac, authMiddleware) {
    return makeWebApp({
      zoweConfig: zoweConfigFor(rbac),
      port: 31390,
      isHttps: false,
      proxiedHost: 'localhost',
      proxiedPort: 1,
      auth: {
        doLogin() {}, doPasswordReset() {}, doPassTicket() {}, getStatus() {}, doLogout() {}, refreshStatus() {},
        semiAuthenticatedMiddleware(r, re, next) { next(); },
        addProxyAuthorizations() {},
        processProxiedHeaders(req, headers) { return headers; },
        middleware: authMiddleware || function (req, res, next) { next(); }
      }
    });
  }

  function makePlugin(requiresRbac) {
    const def = JSON.parse(JSON.stringify(externalProxyPluginDef));
    def.identifier = pluginId;
    def.dataServices[0].port = targetServer.address().port;
    if (requiresRbac !== undefined) {
      def.dataServices[0].requiresRbac = requiresRbac;
    }
    const plugin = PluginLoader.makePlugin(def, {}, { productCode: productCode, config: {}, authManager: {} }, false);
    const pluginContext = {
      pluginDef: plugin,
      server: {
        config: { app: {}, user: { node: { http: { port: 1 } } }, startUp: {} },
        state: { pluginMap: {} }
      }
    };
    return { plugin, pluginContext };
  }

  function serviceOf(plugin) {
    const group = plugin.dataServicesGrouped[serviceName];
    return group.versions[group.highestVersion];
  }

  // _makeRouter is a generator that may yield promises; run it to completion.
  async function runGenerator(generator) {
    let step = generator.next();
    while (!step.done) {
      step = generator.next(await step.value);
    }
    return step.value;
  }

  // Mounts the service's middleware chain on a private express app and calls it.
  async function callService({ rbac, requiresRbac, authMiddleware }) {
    const webApp = makeWebAppFor(rbac, authMiddleware);
    const { plugin, pluginContext } = makePlugin(requiresRbac);
    // stands in for the plugin-level middleware (injectPluginDef etc.) that normally runs first
    const pluginChain = [function (req, res, next) {
      req[appDataKey] = { plugin: { def: plugin }, service: {}, webApp: {} };
      next();
    }];
    const chain = await runGenerator(webApp._makeRouter(serviceOf(plugin), plugin, pluginContext, pluginChain));
    const app = express();
    app.use('/', chain);
    appServer = http.createServer(app);
    await new Promise((resolve, reject) => {
      appServer.once('error', reject);
      appServer.listen(0, '127.0.0.1', resolve);
    });
    const response = await fetch(`http://127.0.0.1:${appServer.address().port}/x`, { headers: { Connection: 'close' } });
    return { status: response.status, body: await response.text() };
  }

  it('returns 403 and does not reach the service when requiresRbac is true and RBAC is disabled', async function () {
    const result = await callService({ rbac: false, requiresRbac: true });
    assert.strictEqual(result.status, 403);
    assert.ok(result.body.includes('ZWED0315E'), `unexpected body: ${result.body}`);
    assert.strictEqual(targetRequestCount, 0);
  });

  it('serves the request when requiresRbac is true and RBAC is enabled', async function () {
    const result = await callService({ rbac: true, requiresRbac: true });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body, 'proxied-ok');
    assert.strictEqual(targetRequestCount, 1);
  });

  it('does not change services that do not declare requiresRbac', async function () {
    const result = await callService({ rbac: false });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(targetRequestCount, 1);
  });

  it('only a boolean true enables the restriction', async function () {
    const result = await callService({ rbac: false, requiresRbac: 'true' });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(targetRequestCount, 1);
  });

  it('still answers 401 from the authentication middleware before the RBAC check', async function () {
    const result = await callService({
      rbac: false,
      requiresRbac: true,
      authMiddleware: function (req, res) { res.status(401).json({ error: 'unauthorized' }); }
    });
    assert.strictEqual(result.status, 401);
    assert.strictEqual(targetRequestCount, 0);
  });

  describe('referer-based proxy fallback', function () {
    // The fallback handler re-implements the auth step for external services, so it
    // must apply the same restriction.
    async function callFallback({ rbac, requiresRbac }) {
      const webApp = makeWebAppFor(rbac);
      const { pluginContext } = makePlugin(requiresRbac);
      await webApp.installPlugin(pluginContext);

      let fallbackHandler;
      const useStub = sinon.stub(webApp.expressApp, 'use').callsFake(function (fn) { fallbackHandler = fn; });
      webApp.installErrorHanders();
      useStub.restore();

      const req = {
        headers: {
          referer: `http://localhost/${productCode}/plugins/${pluginId}/services/${serviceName}/legacy/x`,
          host: 'localhost'
        },
        url: '/legacy/broken/path',
        originalUrl: '/legacy/broken/path',
        method: 'GET',
        protocol: 'http',
        get(header) { return this.headers[header.toLowerCase()]; }
      };
      req[appDataKey] = { plugin: {}, service: {}, webApp: {} };
      return new Promise((resolve) => {
        let statusCode = null;
        const chunks = [];
        const res = new Writable({ write(chunk, enc, cb) { chunks.push(chunk); cb(); } });
        res.status = function (code) { statusCode = code; return res; };
        res.set = function () { return res; };
        res.json = function (body) { res.end(JSON.stringify(body)); return res; };
        res.send = function (body) { res.end(body); return res; };
        res.on('finish', () => resolve({ status: statusCode, body: Buffer.concat(chunks).toString() }));
        fallbackHandler(req, res, function () {});
      });
    }

    it('returns 403 when requiresRbac is true and RBAC is disabled', async function () {
      const result = await callFallback({ rbac: false, requiresRbac: true });
      assert.strictEqual(result.status, 403);
      assert.ok(result.body.includes('ZWED0315E'), `unexpected body: ${result.body}`);
      assert.strictEqual(targetRequestCount, 0);
    });
  });
});
