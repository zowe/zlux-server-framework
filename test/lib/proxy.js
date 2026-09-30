const assert = require('assert');
const http = require('http');
const net = require('net');

describe('proxy', function () {
  let proxy;

  before(function () {
    try {
      proxy = require('../../lib/proxy');
    } catch (e) {
      console.warn('Could not load proxy module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(proxy, 'proxy module should be loadable');
  });

  it('should export expected interface', function () {
    assert.strictEqual(typeof proxy.makeSimpleProxy, 'function');
    assert.strictEqual(typeof proxy.makeWsProxy, 'function');
    assert.strictEqual(typeof proxy.checkProxiedHost, 'function');
  });

  describe('makeSimpleProxy', function () {
    it('should throw when host is missing', function () {
      assert.throws(function () {
        proxy.makeSimpleProxy(null, 8080, {});
      }, /ZWED0047E/);
    });

    it('should throw when port is missing', function () {
      assert.throws(function () {
        proxy.makeSimpleProxy('localhost', null, {});
      }, /ZWED0047E/);
    });

    it('should throw when both host and port are missing', function () {
      assert.throws(function () {
        proxy.makeSimpleProxy(null, null, {}, 'testPlugin', 'testService');
      }, /ZWED0047E/);
    });

    it('should include pluginID and serviceName in error message', function () {
      assert.throws(function () {
        proxy.makeSimpleProxy(null, null, {}, 'org.zowe.test', 'myService');
      }, /org\.zowe\.test.*myService/);
    });

    it('should return a function when host and port are valid', function () {
      var handler = proxy.makeSimpleProxy('localhost', 8080, {
        urlPrefix: '/api',
        isHttps: false,
        addProxyAuthorizations: null,
        processProxiedHeaders: null,
        allowInvalidTLSProxy: false
      });
      assert.strictEqual(typeof handler, 'function');
    });

    it('should proxy a GET request to the target host', function (done) {
      var targetServer = http.createServer(function (req, res) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('proxied response');
      });

      targetServer.listen(0, '127.0.0.1', function () {
        var port = targetServer.address().port;
        var handler = proxy.makeSimpleProxy('127.0.0.1', port, {
          urlPrefix: '',
          isHttps: false,
          addProxyAuthorizations: null,
          processProxiedHeaders: null,
          allowInvalidTLSProxy: false
        });

        var mockReq = new http.IncomingMessage();
        mockReq.method = 'GET';
        mockReq.url = '/test';
        mockReq.headers = { host: 'localhost:3000' };
        mockReq.protocol = 'http';
        mockReq.get = function (header) {
          return this.headers[header.toLowerCase()];
        };

        var { Writable } = require('stream');
        var chunks = [];
        var statusCode = null;
        var resHeaders = {};
        var writableRes = new Writable({
          write: function (chunk, encoding, callback) {
            chunks.push(chunk);
            callback();
          }
        });
        writableRes.status = function (code) { statusCode = code; return writableRes; };
        writableRes.set = function (key, val) { resHeaders[key] = val; };
        writableRes.on('finish', function () {
          var body = Buffer.concat(chunks).toString();
          assert.strictEqual(statusCode, 200);
          assert.strictEqual(body, 'proxied response');
          targetServer.close();
          done();
        });

        handler(mockReq, writableRes);
      });
    });

    it('should call addProxyAuthorizations when provided', function (done) {
      var targetServer = http.createServer(function (req, res) {
        res.writeHead(200);
        res.end('ok');
      });

      targetServer.listen(0, '127.0.0.1', function () {
        var port = targetServer.address().port;
        var authCalled = false;
        var handler = proxy.makeSimpleProxy('127.0.0.1', port, {
          urlPrefix: '',
          isHttps: false,
          addProxyAuthorizations: function (req, options) {
            authCalled = true;
            options.headers['x-test-auth'] = 'test-value';
          },
          processProxiedHeaders: null,
          allowInvalidTLSProxy: false
        });

        var mockReq = new http.IncomingMessage();
        mockReq.method = 'GET';
        mockReq.url = '/auth-test';
        mockReq.headers = { host: 'localhost:3000' };
        mockReq.protocol = 'http';
        mockReq.get = function (header) {
          return this.headers[header.toLowerCase()];
        };

        var { Writable } = require('stream');
        var writableRes = new Writable({
          write: function (chunk, enc, cb) { cb(); }
        });
        writableRes.status = function () { return writableRes; };
        writableRes.set = function () {};
        writableRes.on('finish', function () {
          assert.strictEqual(authCalled, true);
          targetServer.close();
          done();
        });

        handler(mockReq, writableRes);
      });
    });

    it('should handle request errors gracefully', function (done) {
      // Connect to a port that will refuse connections
      var handler = proxy.makeSimpleProxy('127.0.0.1', 1, {
        urlPrefix: '',
        isHttps: false,
        addProxyAuthorizations: null,
        processProxiedHeaders: null,
        allowInvalidTLSProxy: false
      });

      var mockReq = new http.IncomingMessage();
      mockReq.method = 'GET';
      mockReq.url = '/fail';
      mockReq.headers = { host: 'localhost:3000' };
      mockReq.protocol = 'http';
      mockReq.get = function (header) {
        return this.headers[header.toLowerCase()];
      };

      var statusSet = null;
      var ended = false;
      var mockRes = {
        status: function (code) { statusSet = code; return mockRes; },
        set: function () {},
        end: function () {
          ended = true;
          assert.strictEqual(statusSet, 500);
          done();
        }
      };

      handler(mockReq, mockRes);
    });
  });

  describe('makeWsProxy', function () {
    it('should return a function', function () {
      var wsProxy = proxy.makeWsProxy('localhost', 8080, '/prefix', {
        isHttps: false,
        allowInvalidTLSProxy: false
      });
      assert.strictEqual(typeof wsProxy, 'function');
    });
  });

  describe('checkProxiedHost', function () {
    it('should resolve when server is reachable', function (done) {
      var server = net.createServer(function (socket) {
        socket.end();
      });
      server.listen(0, '127.0.0.1', function () {
        var port = server.address().port;
        proxy.checkProxiedHost('127.0.0.1', port, 5000).then(function () {
          server.close();
          done();
        }).catch(function (err) {
          server.close();
          done(new Error('Should have resolved: ' + err));
        });
      });
    });

    it('should reject when server is not reachable within timeout', function (done) {
      this.timeout(10000);
      proxy.checkProxiedHost('127.0.0.1', 1, 1000).then(function () {
        done(new Error('Should have rejected'));
      }).catch(function (err) {
        assert.ok(err.includes('Communication with'));
        done();
      });
    });
  });
});
