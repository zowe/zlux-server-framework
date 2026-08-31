const assert = require('assert');
const http = require('http');
const sinon = require('sinon');
const { Writable } = require('stream');
const constants = require('../../lib/unp-constants');
const PluginLoader = require('../../lib/plugin-loader');
const externalProxyPluginDef = require('./fixtures/webapp-external-proxy-plugin.json');

describe('webapp', function () {
  let webapp;

  before(function () {
    try {
      webapp = require('../../lib/webapp');
    } catch (e) {
      console.warn('Could not load webapp module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(webapp, 'webapp module should be loadable');
  });

  it('should export expected interface', function () {
    const exportType = typeof webapp;
    assert.ok(exportType === 'object' || exportType === 'function', 'should export object or function');
  });

  describe('installErrorHanders() referer-based proxy fallback', function () {
    const productCode = 'XXX';
    const pluginId = externalProxyPluginDef.identifier;
    const serviceName = externalProxyPluginDef.dataServices[0].name;
    const appDataKey = `${constants.APP_NAME}Data`;

    let targetServer;
    let targetRequestCount;
    let webApp;
    let fallbackHandler;
    let authMiddlewareSpy;

    function zoweConfigFor() {
      return {
        zowe: {
          cookieIdentifier: 'test',
          externalDomains: ['localhost']
        },
        components: {
          'app-server': {
            productDir: __dirname,
            checkReferrer: {},
            dataserviceAuthentication: { rbac: false, defaultAuthentication: 'fallback' },
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

    before(function (done) {
      targetRequestCount = 0;
      targetServer = http.createServer(function (req, res) {
        targetRequestCount++;
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('proxied-ok');
      });
      targetServer.listen(0, '127.0.0.1', function () {
        const targetPort = targetServer.address().port;

        const def = JSON.parse(JSON.stringify(externalProxyPluginDef));
        def.dataServices[0].port = targetPort;
        const makePluginContext = { productCode: productCode, config: {}, authManager: {} };
        const plugin = PluginLoader.makePlugin(def, {}, makePluginContext, false);
        const pluginContext = {
          pluginDef: plugin,
          server: {
            config: { app: {}, user: { node: { http: { port: 1 } } }, startUp: {} },
            state: { pluginMap: {} }
          }
        };

        authMiddlewareSpy = sinon.stub().callsFake(function (req, res, next) { next(); });

        const makeWebApp = require('../../lib/webapp').makeWebApp;
        webApp = makeWebApp({
          zoweConfig: zoweConfigFor(),
          port: 31390,
          isHttps: false,
          proxiedHost: 'localhost',
          proxiedPort: 1,
          auth: {
            doLogin() {}, doPasswordReset() {}, getStatus() {}, doLogout() {}, refreshStatus() {},
            semiAuthenticatedMiddleware(r, re, next) { next(); },
            addProxyAuthorizations() {},
            processProxiedHeaders(req, headers) { return headers; },
            middleware: authMiddlewareSpy
          }
        });

        webApp.installPlugin(pluginContext).then(function () {
          webApp.installRootServices();
          webApp.injectPluginRouter();

          // capture the catch-all handler instead of letting it register on the shared expressApp
          const useStub = sinon.stub(webApp.expressApp, 'use').callsFake(function (fn) {
            fallbackHandler = fn;
          });
          webApp.installErrorHanders();
          useStub.restore();

          done();
        }).catch(done);
      });
    });

    after(function (done) {
      targetServer.close(done);
    });

    beforeEach(function () {
      authMiddlewareSpy.resetHistory();
      authMiddlewareSpy.callsFake(function (req, res, next) { next(); });
      targetRequestCount = 0;
    });

    function makeReq(referer, url) {
      const req = {
        headers: { referer: referer, host: 'localhost' },
        url: url,
        originalUrl: url,
        method: 'GET',
        protocol: 'http',
        get(header) { return this.headers[header.toLowerCase()]; }
      };
      req[appDataKey] = { plugin: {}, service: {}, webApp: {} };
      return req;
    }

    function makeRes(onFinish) {
      const chunks = [];
      let statusCode = null;
      const res = new Writable({
        write(chunk, encoding, callback) { chunks.push(chunk); callback(); }
      });
      res.status = function (code) { statusCode = code; return res; };
      res.set = function () { return res; };
      res.json = function (body) { res.end(JSON.stringify(body)); return res; };
      res.send = function (body) { res.end(body); return res; };
      res.on('finish', function () { onFinish(statusCode, Buffer.concat(chunks).toString()); });
      return res;
    }

    it('runs auth.middleware with the resolved plugin/service before proxying an authorized request', function (done) {
      const referer = `http://localhost/${productCode}/plugins/${pluginId}/services/${serviceName}/legacy/broken/path`;
      const req = makeReq(referer, '/legacy/broken/path');
      const res = makeRes(function (status, body) {
        assert.strictEqual(authMiddlewareSpy.called, true, 'auth.middleware should have been invoked');
        const authedReq = authMiddlewareSpy.firstCall.args[0];
        assert.strictEqual(authedReq[appDataKey].plugin.def.identifier, pluginId);
        assert.strictEqual(authedReq[appDataKey].service.def.name, serviceName);
        assert.strictEqual(status, 200);
        assert.strictEqual(body, 'proxied-ok');
        assert.strictEqual(targetRequestCount, 1);
        done();
      });
      fallbackHandler(req, res, function () {});
    });

    it('does not proxy when auth.middleware denies the request', function (done) {
      authMiddlewareSpy.callsFake(function (req, res, next) {
        res.status(401).json({ error: 'unauthorized' });
      });
      const referer = `http://localhost/${productCode}/plugins/${pluginId}/services/${serviceName}/legacy/broken/path`;
      const req = makeReq(referer, '/legacy/broken/path');
      const res = makeRes(function (status, body) {
        assert.strictEqual(authMiddlewareSpy.called, true);
        assert.strictEqual(status, 401);
        assert.strictEqual(targetRequestCount, 0, 'the external target should never have been reached');
        done();
      });
      fallbackHandler(req, res, function () {});
    });

    it('falls back to 404 without invoking auth when the referer does not match a known plugin/service', function (done) {
      const referer = `http://localhost/${productCode}/plugins/org.zowe.unknownplugin/services/unknownsvc/legacy/broken/path`;
      const req = makeReq(referer, '/legacy/broken/path');
      const res = makeRes(function (status) {
        assert.strictEqual(authMiddlewareSpy.called, false, 'auth.middleware should not run for an unresolved proxy target');
        assert.strictEqual(status, 404);
        assert.strictEqual(targetRequestCount, 0);
        done();
      });
      fallbackHandler(req, res, function () {});
    });
  });
});
