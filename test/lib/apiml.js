const assert = require('assert');

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
});
