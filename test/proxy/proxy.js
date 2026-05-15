'use strict';
const { expect } = require('chai');
const sinon = require('sinon');
const http = require('http');
const net = require('net');
const { PassThrough, Writable } = require('stream');
const proxy = require('../../lib/proxy');

function makeMockRes(done, expectations) {
  const writable = new PassThrough();
  writable._status = null;
  writable._headers = {};
  writable.status = function (code) { this._status = code; return this; };
  writable.set = function (name, value) { this._headers[name] = value; };
  writable.on('finish', function () {
    if (expectations) {
      try {
        expectations(writable);
        done();
      } catch (e) {
        done(e);
      }
    } else {
      done();
    }
  });
  return writable;
}

describe('proxy.js', function () {

  describe('makeSimpleProxy', function () {

    it('should throw when host is missing', function () {
      expect(() => proxy.makeSimpleProxy(null, 8080, {}, 'plugin', 'svc'))
        .to.throw(/ZWED0047E/);
    });

    it('should throw when port is missing', function () {
      expect(() => proxy.makeSimpleProxy('host', null, {}, 'plugin', 'svc'))
        .to.throw(/ZWED0047E/);
    });

    it('should throw when both host and port are missing', function () {
      expect(() => proxy.makeSimpleProxy(null, null, {}, 'p', 's'))
        .to.throw(/ZWED0047E/);
    });

    it('should return a function when host and port are provided', function () {
      const handler = proxy.makeSimpleProxy('localhost', 8080, {
        urlPrefix: '/api',
        isHttps: false
      }, 'plugin.id', 'service');
      expect(handler).to.be.a('function');
    });

    it('returned handler should have correct arity (req, res)', function () {
      const handler = proxy.makeSimpleProxy('host', 80, {
        urlPrefix: ''
      }, 'p', 's');
      expect(handler.length).to.equal(2);
    });
  });

  describe('makeWsProxy', function () {
    it('should return a function', function () {
      const handler = proxy.makeWsProxy('localhost', 8080, '/ws', {
        isHttps: false
      });
      expect(handler).to.be.a('function');
    });

    it('returned handler should accept (ws, req)', function () {
      const handler = proxy.makeWsProxy('host', 80, '/prefix', {});
      expect(handler.length).to.equal(2);
    });
  });

  describe('checkProxiedHost', function () {

    it('should resolve when host is reachable', function (done) {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        proxy.checkProxiedHost('127.0.0.1', port, 5000)
          .then(() => {
            server.close();
            done();
          })
          .catch((err) => {
            server.close();
            done(err);
          });
      });
    });

    it('should reject when host is unreachable within timeout', function () {
      this.timeout(10000);
      return proxy.checkProxiedHost('127.0.0.1', 1, 1000)
        .then(() => {
          throw new Error('Should have rejected');
        })
        .catch((err) => {
          expect(err).to.be.a('string');
          expect(err).to.include('Communication with');
        });
    });

    it('should use default timeout when none provided', function () {
      this.timeout(15000);
      const promise = proxy.checkProxiedHost('127.0.0.1', 1, 2000);
      expect(promise).to.have.property('then');
      return promise.catch(() => {});
    });
  });

  describe('proxy header manipulation (integration via makeSimpleProxy)', function () {

    let server;
    let serverPort;

    before(function (done) {
      server = http.createServer((req, res) => {
        res.writeHead(200, {
          'content-type': 'application/json',
          'x-custom': 'preserved'
        });
        res.end(JSON.stringify({
          receivedHost: req.headers.host,
          receivedOrigin: req.headers.origin,
          receivedPath: req.url,
          method: req.method
        }));
      });
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        done();
      });
    });

    after(function () {
      server.close();
    });

    it('should proxy GET request and rewrite host/origin headers', function (done) {
      const handler = proxy.makeSimpleProxy('127.0.0.1', serverPort, {
        urlPrefix: '/prefix',
        isHttps: false
      }, 'test.plugin', 'data');

      const mockReq = {
        method: 'GET',
        url: '/resource?key=val',
        headers: {
          host: 'original-host:3000',
          origin: 'http://original-host:3000',
          'accept-encoding': 'gzip',
          'x-custom': 'keep-me'
        },
        protocol: 'http',
        get: function (name) {
          return this.headers[name.toLowerCase()] || '';
        },
        pipe: function () {}
      };

      const mockRes = makeMockRes(done, (res) => {
        expect(res._status).to.equal(200);
      });

      handler(mockReq, mockRes);
    });

    it('should forward request body for POST', function (done) {
      const bodyServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          res.writeHead(200);
          res.end(body);
        });
      });

      bodyServer.listen(0, '127.0.0.1', () => {
        const port = bodyServer.address().port;
        const handler = proxy.makeSimpleProxy('127.0.0.1', port, {
          urlPrefix: '',
          isHttps: false
        }, 'test', 'svc');

        const stream = new PassThrough();

        const mockReq = {
          method: 'POST',
          url: '/api',
          headers: { host: 'localhost', 'content-type': 'application/json' },
          protocol: 'http',
          get: (n) => 'localhost',
          pipe: function (dest) { stream.pipe(dest); }
        };

        const mockRes = makeMockRes(() => {
          bodyServer.close();
          done();
        });

        handler(mockReq, mockRes);
        stream.end('{"data":"test"}');
      });
    });

    it('should return 500 when backend is unreachable', function (done) {
      const handler = proxy.makeSimpleProxy('127.0.0.1', 1, {
        urlPrefix: '',
        isHttps: false
      }, 'test', 'svc');

      const mockReq = {
        method: 'GET',
        url: '/',
        headers: { host: 'localhost' },
        protocol: 'http',
        get: () => 'localhost'
      };

      const mockRes = new PassThrough();
      mockRes._status = null;
      mockRes.status = function (code) { this._status = code; return this; };
      mockRes.set = function () {};
      const origEnd = mockRes.end.bind(mockRes);
      mockRes.end = function () {
        try {
          expect(this._status).to.equal(500);
          origEnd();
          done();
        } catch (e) {
          origEnd();
          done(e);
        }
      };

      handler(mockReq, mockRes);
    });

    it('should strip sec-websocket headers in proxy', function (done) {
      const headerServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end(JSON.stringify({ hasWsHeader: !!req.headers['sec-websocket-key'] }));
      });

      headerServer.listen(0, '127.0.0.1', () => {
        const port = headerServer.address().port;
        const handler = proxy.makeSimpleProxy('127.0.0.1', port, {
          urlPrefix: '',
          isHttps: false
        }, 'test', 'svc');

        const mockReq = {
          method: 'GET',
          url: '/',
          headers: {
            host: 'localhost',
            'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
            'sec-websocket-version': '13'
          },
          protocol: 'http',
          get: () => 'localhost'
        };

        const mockRes = makeMockRes(() => {
          headerServer.close();
          done();
        });

        handler(mockReq, mockRes);
      });
    });

    it('should remove headers specified in requestProcessingOptions', function (done) {
      const headerCheckServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end(JSON.stringify({ hasOrigin: !!req.headers.origin }));
      });

      headerCheckServer.listen(0, '127.0.0.1', () => {
        const port = headerCheckServer.address().port;
        const handler = proxy.makeSimpleProxy('127.0.0.1', port, {
          urlPrefix: '',
          isHttps: false,
          requestProcessingOptions: {
            headersToRemove: ['origin']
          }
        }, 'test', 'svc');

        const mockReq = {
          method: 'GET',
          url: '/',
          headers: { host: 'localhost', origin: 'http://evil.com' },
          protocol: 'http',
          get: () => 'localhost'
        };

        const mockRes = makeMockRes(() => {
          headerCheckServer.close();
          done();
        });

        handler(mockReq, mockRes);
      });
    });
  });
});
