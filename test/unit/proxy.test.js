/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

// Bootstrap the global logger before requiring proxy (which requires util)
require('../../lib/util');

const assert = require('assert');
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const proxy = require('../../lib/proxy');

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Start an http.Server on a random port and resolve with { server, port }. */
function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/** Close a server and resolve when done. */
function closeServer(server) {
  return new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
}

/** Make an HTTP request, return { status, headers, body }. */
function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

// ─── makeSimpleProxy ─────────────────────────────────────────────────────────

describe('proxy', function() {

  describe('makeSimpleProxy argument validation', function() {
    it('should throw when host is missing', function() {
      assert.throws(() => {
        proxy.makeSimpleProxy(null, 8080, {}, 'org.test', 'svc');
      }, /Host & Port for proxy destination are required/);
    });

    it('should throw when port is missing', function() {
      assert.throws(() => {
        proxy.makeSimpleProxy('localhost', null, {}, 'org.test', 'svc');
      }, /Host & Port for proxy destination are required/);
    });

    it('should return a function when host and port are valid', function() {
      const handler = proxy.makeSimpleProxy('localhost', 8080, {}, 'org.test', 'svc');
      assert.strictEqual(typeof handler, 'function');
    });
  });

  describe('makeSimpleProxy HTTP proxying', function() {
    let backendServer, backendPort;
    let proxyServer, proxyPort;

    beforeEach(async function() {
      // --- backend: a simple express app that the proxy talks to ---
      const backend = express();
      backend.use(bodyParser.text({ type: '*/*' }));

      backend.get('/api/hello', (req, res) => {
        res.status(200).json({ msg: 'hello' });
      });

      backend.get('/api/echo-headers', (req, res) => {
        // Echo back the headers we received so tests can inspect them
        res.status(200).json(req.headers);
      });

      backend.post('/api/echo-body', (req, res) => {
        res.status(201).send(req.body);
      });

      backend.get('/api/redirect', (req, res) => {
        res.status(302).set('location', '/some/path').end();
      });

      backend.get('/api/redirect-zlux', (req, res) => {
        // location already starts with the ZLUX pattern — should not be rewritten
        res.status(302).set('location', 'http://host/ZLUX/plugins/org.test/services/svc').end();
      });

      backend.get('/api/custom-headers', (req, res) => {
        res.set('x-custom', 'from-backend').status(200).end();
      });

      backend.get('/api/error', (req, res) => {
        // just hang briefly then the test will stop the backend server
        // (we test backend connectivity errors by making the backend unreachable instead)
        res.status(500).end();
      });

      const b = await startServer(backend);
      backendServer = b.server;
      backendPort = b.port;

      // --- proxy front-end ---
      const proxyApp = express();
      const proxyHandler = proxy.makeSimpleProxy('127.0.0.1', backendPort, {
        urlPrefix: '',
        isHttps: false,
      }, 'org.test.plugin', 'myservice');
      proxyApp.use(proxyHandler);

      const p = await startServer(proxyApp);
      proxyServer = p.server;
      proxyPort = p.port;
    });

    afterEach(async function() {
      await closeServer(proxyServer);
      await closeServer(backendServer);
    });

    it('should forward a GET request and return the response body and status', async function() {
      const result = await makeRequest({ host: '127.0.0.1', port: proxyPort, path: '/api/hello' });
      assert.strictEqual(result.status, 200);
      const body = JSON.parse(result.body);
      assert.strictEqual(body.msg, 'hello');
    });

    it('should forward a POST request body to the backend', async function() {
      const result = await makeRequest(
        {
          host: '127.0.0.1', port: proxyPort,
          path: '/api/echo-body', method: 'POST',
          headers: { 'content-type': 'text/plain', 'content-length': Buffer.byteLength('hello post') }
        },
        'hello post'
      );
      assert.strictEqual(result.status, 201);
      assert.strictEqual(result.body, 'hello post');
    });

    it('should rewrite the host header to the backend host:port', async function() {
      const result = await makeRequest({ host: '127.0.0.1', port: proxyPort, path: '/api/echo-headers' });
      const received = JSON.parse(result.body);
      assert.strictEqual(received.host, `127.0.0.1:${backendPort}`);
    });

    it('should strip headers listed in requestProcessingOptions.headersToRemove', async function() {
      // Create a separate proxy instance with headersToRemove
      const proxyApp2 = express();
      const proxyHandler2 = proxy.makeSimpleProxy('127.0.0.1', backendPort, {
        urlPrefix: '',
        isHttps: false,
        requestProcessingOptions: { headersToRemove: ['x-remove-me'] }
      }, 'org.test', 'svc');
      proxyApp2.use(proxyHandler2);
      const { server: ps2, port: pp2 } = await startServer(proxyApp2);

      try {
        const result = await makeRequest({
          host: '127.0.0.1', port: pp2, path: '/api/echo-headers',
          headers: { 'x-remove-me': 'secret', 'x-keep-me': 'visible' }
        });
        const received = JSON.parse(result.body);
        assert.ok(!('x-remove-me' in received), 'x-remove-me should have been stripped');
        assert.strictEqual(received['x-keep-me'], 'visible');
      } finally {
        await closeServer(ps2);
      }
    });

    it('should call addProxyAuthorizations and include the added header at the backend', async function() {
      const proxyApp3 = express();
      const proxyHandler3 = proxy.makeSimpleProxy('127.0.0.1', backendPort, {
        urlPrefix: '',
        isHttps: false,
        addProxyAuthorizations: (req1, reqOptions) => {
          reqOptions.headers['x-injected-auth'] = 'token123';
        }
      }, 'org.test', 'svc');
      proxyApp3.use(proxyHandler3);
      const { server: ps3, port: pp3 } = await startServer(proxyApp3);

      try {
        const result = await makeRequest({ host: '127.0.0.1', port: pp3, path: '/api/echo-headers' });
        const received = JSON.parse(result.body);
        assert.strictEqual(received['x-injected-auth'], 'token123');
      } finally {
        await closeServer(ps3);
      }
    });

    it('should call processProxiedHeaders and apply the transformed headers to the response', async function() {
      const proxyApp4 = express();
      const proxyHandler4 = proxy.makeSimpleProxy('127.0.0.1', backendPort, {
        urlPrefix: '',
        isHttps: false,
        processProxiedHeaders: (req1, headers) => {
          const modified = Object.assign({}, headers);
          modified['x-processed'] = 'yes';
          return modified;
        }
      }, 'org.test', 'svc');
      proxyApp4.use(proxyHandler4);
      const { server: ps4, port: pp4 } = await startServer(proxyApp4);

      try {
        const result = await makeRequest({ host: '127.0.0.1', port: pp4, path: '/api/custom-headers' });
        assert.strictEqual(result.headers['x-processed'], 'yes');
        assert.strictEqual(result.headers['x-custom'], 'from-backend');
      } finally {
        await closeServer(ps4);
      }
    });

    it('should rewrite a relative location header to a ZLUX plugin URL', async function() {
      const result = await makeRequest({ host: '127.0.0.1', port: proxyPort, path: '/api/redirect' });
      assert.strictEqual(result.status, 302);
      const location = result.headers['location'];
      assert.ok(location, 'location header should be present');
      // Should be rewritten: starts with protocol + host + /ZLUX/plugins/...
      assert.ok(location.includes('/ZLUX/plugins/org.test.plugin/services/myservice/_current/some/path'),
        `Expected ZLUX-rewritten location, got: ${location}`);
    });

    it('should not rewrite a location header that already contains a ZLUX plugins path', async function() {
      const result = await makeRequest({ host: '127.0.0.1', port: proxyPort, path: '/api/redirect-zlux' });
      assert.strictEqual(result.status, 302);
      // When the location already matches the ZLUX pattern, the proxy code neither
      // rewrites nor forwards it (the header is intentionally dropped).
      assert.strictEqual(result.headers['location'], undefined);
    });

    it('should return 500 when the backend is unreachable', async function() {
      // close the backend so nothing is listening on backendPort
      await closeServer(backendServer);
      backendServer = null; // prevent double-close in afterEach

      const result = await makeRequest({ host: '127.0.0.1', port: proxyPort, path: '/api/hello' });
      assert.strictEqual(result.status, 500);

      // re-open a dummy backend so afterEach closeServer doesn't throw
      const dummy = await startServer((req, res) => res.end());
      backendServer = dummy.server;
    });
  });

  // ─── checkProxiedHost ──────────────────────────────────────────────────────

  describe('checkProxiedHost', function() {
    it('should resolve when the host is reachable (TCP connection accepted)', async function() {
      const { server, port } = await startServer((req, res) => res.end());
      try {
        await proxy.checkProxiedHost('127.0.0.1', port, 2000);
      } finally {
        await closeServer(server);
      }
    });

    it('should reject when nothing is listening on the port', async function() {
      // Grab a free port, close it, then try to connect
      const { server, port } = await startServer((req, res) => res.end());
      await closeServer(server);

      await assert.rejects(
        proxy.checkProxiedHost('127.0.0.1', port, 500),
        /Communication with 127.0.0.1/
      );
    });
  });

});

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
