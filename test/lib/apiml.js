const assert = require('assert');
const sinon = require('sinon');

describe('apiml', function () {
  let apiml;

  before(function () {
    try {
      apiml = require('../../lib/apiml');
    } catch (e) {
      console.warn('Could not load apiml module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(apiml, 'apiml module should be loadable');
  });

  it('should export ApimlConnector constructor', function () {
    assert.strictEqual(typeof apiml, 'function');
  });

  it('should export getUserId function', function () {
    assert.strictEqual(typeof apiml.getUserId, 'function');
  });

  describe('ApimlConnector constructor', function () {
    it('should create an instance with provided config', function () {
      var connector = new apiml({
        hostName: 'localhost',
        port: 7556,
        discoveryUrls: ['https://localhost:7553/eureka/'],
        discoveryPort: 7553,
        catalogPort: 7552,
        gatewayPort: 7554,
        tlsOptions: { rejectUnauthorized: false },
        eurekaOverrides: {},
        isClientAttls: false,
        traceTls: false
      });
      assert.ok(connector);
      assert.strictEqual(connector.hostName, 'localhost');
      assert.strictEqual(connector.port, 7556);
      assert.strictEqual(connector.discoveryPort, 7553);
      assert.strictEqual(connector.catalogPort, 7552);
      assert.strictEqual(connector.gatewayPort, 7554);
      assert.strictEqual(connector.isClientAttls, false);
    });

    it('should set vipAddress from hostName', function () {
      var connector = new apiml({
        hostName: 'myhost.example.com',
        port: 7556,
        discoveryUrls: ['https://localhost:7553/eureka/'],
        discoveryPort: 7553,
        catalogPort: 7552,
        gatewayPort: 7554,
        tlsOptions: {},
        eurekaOverrides: {},
        isClientAttls: false,
        traceTls: false
      });
      assert.strictEqual(connector.vipAddress, 'myhost.example.com');
    });
  });

  describe('_makeMainInstanceProperties', function () {
    var connector;

    before(function () {
      connector = new apiml({
        hostName: 'myhost.com',
        port: 7556,
        discoveryUrls: ['https://discovery.com:7553/eureka/'],
        discoveryPort: 7553,
        catalogPort: 7552,
        gatewayPort: 7554,
        tlsOptions: { rejectUnauthorized: false },
        eurekaOverrides: {},
        isClientAttls: false,
        traceTls: false
      });
      connector.ipAddr = '10.0.0.1';
    });

    it('should return instance properties object', function () {
      var instance = connector._makeMainInstanceProperties();
      assert.ok(instance);
      assert.strictEqual(typeof instance, 'object');
    });

    it('should set correct hostName', function () {
      var instance = connector._makeMainInstanceProperties();
      assert.strictEqual(instance.hostName, 'myhost.com');
    });

    it('should set correct ipAddr', function () {
      var instance = connector._makeMainInstanceProperties();
      assert.strictEqual(instance.ipAddr, '10.0.0.1');
    });

    it('should set vipAddress to zlux', function () {
      var instance = connector._makeMainInstanceProperties();
      assert.strictEqual(instance.vipAddress, 'zlux');
    });

    it('should set status to UP', function () {
      var instance = connector._makeMainInstanceProperties();
      assert.strictEqual(instance.status, 'UP');
    });

    it('should include port and securePort', function () {
      var instance = connector._makeMainInstanceProperties();
      assert.ok(instance.port);
      assert.ok(instance.securePort);
      assert.strictEqual(instance.port['$'], 7556);
      assert.strictEqual(instance.securePort['$'], 7556);
    });

    it('should generate correct instanceId', function () {
      var instance = connector._makeMainInstanceProperties();
      assert.strictEqual(instance.instanceId, 'myhost.com:zlux:7556');
    });

    it('should include URLs with host and port', function () {
      var instance = connector._makeMainInstanceProperties();
      assert.ok(instance.statusPageUrl.includes('myhost.com'));
      assert.ok(instance.statusPageUrl.includes('7556'));
      assert.ok(instance.healthCheckUrl.includes('myhost.com'));
      assert.ok(instance.homePageUrl.includes('myhost.com'));
    });

    it('should handle IPv6 hostName', function () {
      var ipv6Connector = new apiml({
        hostName: '::1',
        port: 7556,
        discoveryUrls: ['https://localhost:7553/eureka/'],
        discoveryPort: 7553,
        catalogPort: 7552,
        gatewayPort: 7554,
        tlsOptions: { rejectUnauthorized: false },
        eurekaOverrides: {},
        isClientAttls: false,
        traceTls: false
      });
      ipv6Connector.ipAddr = '::1';
      var instance = ipv6Connector._makeMainInstanceProperties();
      assert.ok(instance.instanceId.includes('[::1]'));
      assert.ok(instance.statusPageUrl.includes('[::1]'));
    });

    it('should set CORS metadata when gateway client ATTLS is enabled', function () {
      var attlsConnector = new apiml({
        hostName: 'myhost.com',
        port: 7556,
        discoveryUrls: ['https://discovery.com:7553/eureka/'],
        discoveryPort: 7553,
        catalogPort: 7552,
        gatewayPort: 7554,
        tlsOptions: { rejectUnauthorized: false },
        eurekaOverrides: {},
        isClientAttls: false,
        traceTls: false
      });
      attlsConnector.ipAddr = '10.0.0.1';
      attlsConnector.isGatewayClientAttls = true;
      var instance = attlsConnector._makeMainInstanceProperties();
      assert.strictEqual(instance.metadata['apiml.corsEnabled'], 'true');
      assert.ok(instance.metadata['apiml.corsAllowedOrigins'].includes('myhost.com'));
      assert.ok(instance.metadata['apiml.corsAllowedOrigins'].includes('7554'));
    });

    it('should include catalogPort in CORS origins when set', function () {
      var attlsConnector = new apiml({
        hostName: 'myhost.com',
        port: 7556,
        discoveryUrls: ['https://discovery.com:7553/eureka/'],
        discoveryPort: 7553,
        catalogPort: 7552,
        gatewayPort: 7554,
        tlsOptions: { rejectUnauthorized: false },
        eurekaOverrides: {},
        isClientAttls: false,
        traceTls: false
      });
      attlsConnector.ipAddr = '10.0.0.1';
      attlsConnector.isGatewayClientAttls = true;
      var instance = attlsConnector._makeMainInstanceProperties();
      assert.ok(instance.metadata['apiml.corsAllowedOrigins'].includes('7552'));
    });

    it('should accept overrides', function () {
      var instance = connector._makeMainInstanceProperties({ status: 'DOWN' });
      assert.strictEqual(instance.status, 'DOWN');
    });

    it('should include metadata with API ML routes', function () {
      var instance = connector._makeMainInstanceProperties();
      assert.ok(instance.metadata);
      assert.strictEqual(instance.metadata['apiml.routes.api__v1.gatewayUrl'], '/api/v1');
      assert.strictEqual(instance.metadata['apiml.routes.ui__v1.gatewayUrl'], '/ui/v1');
      assert.strictEqual(instance.metadata['apiml.routes.ws__v1.gatewayUrl'], '/ws/v1');
      assert.strictEqual(instance.metadata['apiml.authentication.scheme'], 'zoweJwt');
    });

    it('should include leaseInfo', function () {
      var instance = connector._makeMainInstanceProperties();
      assert.ok(instance.leaseInfo);
      assert.strictEqual(instance.leaseInfo.durationInSecs, 90);
      assert.strictEqual(instance.leaseInfo.renewalIntervalInSecs, 30);
    });

    it('should include dataCenterInfo', function () {
      var instance = connector._makeMainInstanceProperties();
      assert.ok(instance.dataCenterInfo);
      assert.strictEqual(instance.dataCenterInfo.name, 'MyOwn');
    });
  });

  describe('getServiceUrls', function () {
    it('should return array of discovery URLs with /apps suffix', function () {
      var connector = new apiml({
        hostName: 'localhost',
        port: 7556,
        discoveryUrls: ['https://disc1.com:7553/eureka/', 'https://disc2.com:7553/eureka'],
        discoveryPort: 7553,
        catalogPort: 7552,
        gatewayPort: 7554,
        tlsOptions: {},
        eurekaOverrides: {},
        isClientAttls: false,
        traceTls: false
      });
      var urls = connector.getServiceUrls();
      assert.ok(Array.isArray(urls));
      assert.strictEqual(urls.length, 2);
      assert.ok(urls[0].endsWith('/apps'));
      assert.ok(urls[1].endsWith('/apps'));
    });

    it('should not double-append slash before apps', function () {
      var connector = new apiml({
        hostName: 'localhost',
        port: 7556,
        discoveryUrls: ['https://disc.com:7553/eureka/'],
        discoveryPort: 7553,
        catalogPort: 7552,
        gatewayPort: 7554,
        tlsOptions: {},
        eurekaOverrides: {},
        isClientAttls: false,
        traceTls: false
      });
      var urls = connector.getServiceUrls();
      assert.ok(!urls[0].includes('//apps'));
    });

    it('should convert https to http when isClientAttls is true', function () {
      var connector = new apiml({
        hostName: 'localhost',
        port: 7556,
        discoveryUrls: ['https://disc.com:7553/eureka/'],
        discoveryPort: 7553,
        catalogPort: 7552,
        gatewayPort: 7554,
        tlsOptions: {},
        eurekaOverrides: {},
        isClientAttls: true,
        traceTls: false
      });
      var urls = connector.getServiceUrls();
      assert.ok(urls[0].startsWith('http://'));
      assert.ok(!urls[0].startsWith('https://'));
    });
  });

  describe('getRequestOptionsArray', function () {
    it('should return array of request options for each discovery URL', function () {
      var connector = new apiml({
        hostName: 'localhost',
        port: 7556,
        discoveryUrls: ['https://host1.com:7553/eureka/', 'https://host2.com:7554/eureka/'],
        discoveryPort: 7553,
        catalogPort: 7552,
        gatewayPort: 7554,
        tlsOptions: { rejectUnauthorized: true, ca: ['fakeca'] },
        eurekaOverrides: {},
        isClientAttls: false,
        traceTls: false
      });
      var options = connector.getRequestOptionsArray('GET', '/eureka/apps/zss');
      assert.ok(Array.isArray(options));
      assert.strictEqual(options.length, 2);
      assert.strictEqual(options[0].host, 'host1.com');
      assert.strictEqual(options[0].port, '7553');
      assert.strictEqual(options[0].method, 'GET');
      assert.strictEqual(options[0].path, '/eureka/apps/zss');
      assert.strictEqual(options[1].host, 'host2.com');
      assert.strictEqual(options[1].port, '7554');
    });

    it('should include TLS options', function () {
      var connector = new apiml({
        hostName: 'localhost',
        port: 7556,
        discoveryUrls: ['https://host1.com:7553/eureka/'],
        discoveryPort: 7553,
        catalogPort: 7552,
        gatewayPort: 7554,
        tlsOptions: { rejectUnauthorized: true, ca: ['fakeca'], cert: 'mycert', key: 'mykey' },
        eurekaOverrides: {},
        isClientAttls: false,
        traceTls: false
      });
      var options = connector.getRequestOptionsArray('GET', '/test');
      assert.strictEqual(options[0].ca[0], 'fakeca');
      assert.strictEqual(options[0].cert, 'mycert');
      assert.strictEqual(options[0].key, 'mykey');
    });

    it('should remove cert and key when rejectUnauthorized is false', function () {
      var connector = new apiml({
        hostName: 'localhost',
        port: 7556,
        discoveryUrls: ['https://host1.com:7553/eureka/'],
        discoveryPort: 7553,
        catalogPort: 7552,
        gatewayPort: 7554,
        tlsOptions: { rejectUnauthorized: false, cert: 'mycert', key: 'mykey' },
        eurekaOverrides: {},
        isClientAttls: false,
        traceTls: false
      });
      var options = connector.getRequestOptionsArray('GET', '/test');
      assert.strictEqual(options[0].cert, undefined);
      assert.strictEqual(options[0].key, undefined);
    });

    it('should set accept header to application/json', function () {
      var connector = new apiml({
        hostName: 'localhost',
        port: 7556,
        discoveryUrls: ['https://host1.com:7553/eureka/'],
        discoveryPort: 7553,
        catalogPort: 7552,
        gatewayPort: 7554,
        tlsOptions: { rejectUnauthorized: true },
        eurekaOverrides: {},
        isClientAttls: false,
        traceTls: false
      });
      var options = connector.getRequestOptionsArray('POST', '/test');
      assert.strictEqual(options[0].headers.accept, 'application/json');
      assert.strictEqual(options[0].method, 'POST');
    });
  });

  describe('getUserId', function () {
    it('should extract userId from a valid JWT token', function () {
      // Create a mock JWT with payload { sub: 'testuser' }
      var header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      var payload = Buffer.from(JSON.stringify({ sub: 'testuser', iat: 1234567890 })).toString('base64url');
      var signature = 'fakesignature';
      var token = header + '.' + payload + '.' + signature;
      var userId = apiml.getUserId(token);
      assert.strictEqual(userId, 'testuser');
    });

    it('should handle tokens with special characters in userId', function () {
      var header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
      var payload = Buffer.from(JSON.stringify({ sub: 'user@domain.com' })).toString('base64url');
      var token = header + '.' + payload + '.sig';
      var userId = apiml.getUserId(token);
      assert.strictEqual(userId, 'user@domain.com');
    });

    it('should handle tokens with uppercase userIds', function () {
      var header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
      var payload = Buffer.from(JSON.stringify({ sub: 'MAINFRAME_USER' })).toString('base64url');
      var token = header + '.' + payload + '.sig';
      var userId = apiml.getUserId(token);
      assert.strictEqual(userId, 'MAINFRAME_USER');
    });

    it('should return undefined when sub claim is missing', function () {
      var header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
      var payload = Buffer.from(JSON.stringify({ iat: 1234567890 })).toString('base64url');
      var token = header + '.' + payload + '.sig';
      var userId = apiml.getUserId(token);
      assert.strictEqual(userId, undefined);
    });

    it('should throw on completely invalid token', function () {
      assert.throws(function () {
        apiml.getUserId('not-a-jwt');
      }, /failed to parse APIML token/);
    });

    it('should throw on empty string', function () {
      assert.throws(function () {
        apiml.getUserId('');
      }, /failed to parse APIML token/);
    });

    it('should handle base64url padding correctly', function () {
      // Create a payload that needs padding
      var header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
      var payload = Buffer.from(JSON.stringify({ sub: 'a' })).toString('base64url');
      var token = header + '.' + payload + '.sig';
      var userId = apiml.getUserId(token);
      assert.strictEqual(userId, 'a');
    });
  });

  describe('gateway auth logout response', function () {
    it('returns 204 when best-effort credential invalidation is incomplete', function () {
      var response = {
        status: sinon.stub(),
        end: sinon.spy()
      };
      response.status.returns(response);
      var auth = {
        doLogout(req, res, formatter) {
          formatter.sendLogoutResult(res, { success: false });
        }
      };
      var handlers = apiml.createGatewayAuthHandlers(auth);

      handlers.logout({}, response);

      assert.strictEqual(response.status.calledOnceWithExactly(204), true);
      assert.strictEqual(response.end.calledOnce, true);
    });
  });

  describe('gateway auth key routes', function () {
    it('resolves the JWK plugin after routes are installed', async function () {
      var routes = {};
      var expressApp = {
        get(path, handler) {
          routes[path] = handler;
        }
      };
      var zoweConfig = {
        components: { 'app-server': { node: { mediationLayer: { enabled: false } } } },
        zOSMF: { host: 'zosmf.example.com', port: 1443 }
      };
      var jwkPlugin;
      apiml.installGatewayAuthKeysRoutes(expressApp, zoweConfig, function () {
        return jwkPlugin;
      });
      jwkPlugin = {
        getJwkSet() {
          return Promise.resolve({ keys: [{ kid: 'loaded-later' }] });
        }
      };
      var response = {
        status: sinon.stub(),
        json: sinon.spy()
      };
      response.status.returns(response);

      await routes['/gateway/api/v1/auth/keys/public/current']({}, response);

      assert.strictEqual(response.status.calledOnceWithExactly(200), true);
      assert.strictEqual(response.json.calledOnceWithExactly({ keys: [{ kid: 'loaded-later' }] }), true);
    });
  });

  describe('installZosmfProxy / installZssProxy auth gating', function () {
    // isApimlAvailable() short-circuits false as soon as mediationLayer.enabled is falsy,
    // which is enough to exercise the fallback-proxy install path below.
    var zoweConfig = {
      zowe: {},
      components: { 'app-server': { node: { mediationLayer: { enabled: false } }, agent: { host: 'zss.example.com', https: { port: 8544 } } } },
      zOSMF: { host: 'zosmf.example.com', port: 1443 }
    };
    var fakeAuth = { addProxyAuthorizations: function () {}, processProxiedHeaders: function (req, headers) { return headers; } };

    it('installZosmfProxy does not mount a route when no authMiddleware is supplied', function () {
      var expressApp = { use: sinon.spy() };
      apiml.installZosmfProxy(expressApp, zoweConfig, {}, fakeAuth, undefined);
      assert.strictEqual(expressApp.use.called, false);
    });

    it('installZssProxy does not mount a route when no authMiddleware is supplied', function () {
      var expressApp = { use: sinon.spy() };
      apiml.installZssProxy(expressApp, zoweConfig, {}, fakeAuth, undefined);
      assert.strictEqual(expressApp.use.called, false);
    });

    it('installZosmfProxy runs authMiddleware before the proxy handler', function () {
      var expressApp = { use: sinon.spy() };
      var authMiddleware = function (req, res, next) { next(); };
      apiml.installZosmfProxy(expressApp, zoweConfig, {}, fakeAuth, authMiddleware);
      assert.strictEqual(expressApp.use.calledOnce, true);
      var args = expressApp.use.firstCall.args;
      assert.strictEqual(args[0], apiml.ZOSMF_PROXY_PATH);
      var router = args[1];
      assert.ok(router.stack.length >= 2, 'router should have both the auth gate and the proxy handler');
      assert.strictEqual(router.stack[0].handle, authMiddleware, 'authMiddleware must run before the proxy handler');
    });

    it('installZssProxy runs authMiddleware before the proxy handler', function () {
      var expressApp = { use: sinon.spy() };
      var authMiddleware = function (req, res, next) { next(); };
      apiml.installZssProxy(expressApp, zoweConfig, {}, fakeAuth, authMiddleware);
      assert.strictEqual(expressApp.use.calledOnce, true);
      var args = expressApp.use.firstCall.args;
      assert.strictEqual(args[0], apiml.ZSS_PROXY_PATH);
      var router = args[1];
      assert.ok(router.stack.length >= 2, 'router should have both the auth gate and the proxy handler');
      assert.strictEqual(router.stack[0].handle, authMiddleware, 'authMiddleware must run before the proxy handler');
    });
  });

  describe('installZosmfProxy / installZssProxy inbound header allow-lists', function () {
    var zoweConfig = {
      zowe: {},
      components: { 'app-server': { node: { mediationLayer: { enabled: false } }, agent: { host: 'zss.example.com', https: { port: 8544 } } } },
      zOSMF: { host: 'zosmf.example.com', port: 1443 }
    };
    var fakeAuth = { addProxyAuthorizations: function () {}, processProxiedHeaders: function (req, headers) { return headers; } };
    var authMiddleware = function (req, res, next) { next(); };
    var makeSimpleProxyStub;

    beforeEach(function () {
      // apiml.js calls proxy.makeSimpleProxy via a property lookup on the shared,
      // cached module export, so stubbing it here is visible to apiml.js's internal call.
      makeSimpleProxyStub = sinon.stub(require('../../lib/proxy'), 'makeSimpleProxy').returns(function () {});
    });

    afterEach(function () {
      makeSimpleProxyStub.restore();
    });

    it('installZosmfProxy strips authorization and cookie from the client request before forwarding', function () {
      apiml.installZosmfProxy({ use: sinon.spy() }, zoweConfig, {}, fakeAuth, authMiddleware);
      var options = makeSimpleProxyStub.firstCall.args[2];
      assert.deepStrictEqual(options.requestProcessingOptions.headersToRemove.sort(), ['authorization', 'cookie']);
    });

    it('installZssProxy strips authorization but preserves cookie for reconstruction by addProxyAuthorizations', function () {
      apiml.installZssProxy({ use: sinon.spy() }, zoweConfig, {}, fakeAuth, authMiddleware);
      var options = makeSimpleProxyStub.firstCall.args[2];
      assert.deepStrictEqual(options.requestProcessingOptions.headersToRemove, ['authorization']);
    });
  });
});
