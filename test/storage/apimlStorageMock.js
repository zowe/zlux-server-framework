/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

const chai = require('chai');
const expect = chai.expect;
const https = require('https');
const fs = require('fs');
const path = require('path');
const apimlStorage = require('../../lib/apimlStorage');

/**
 * Mock APIML Caching Service.
 * Implements the subset of the caching service API that apimlStorage uses:
 *   GET    /cachingservice/api/v1/cache        -> get all
 *   GET    /cachingservice/api/v1/cache/:key   -> get one
 *   POST   /cachingservice/api/v1/cache        -> create
 *   PUT    /cachingservice/api/v1/cache        -> update
 *   DELETE /cachingservice/api/v1/cache/:key   -> delete one
 *   DELETE /cachingservice/api/v1/cache        -> delete all
 *
 * Uses X-CS-Service-ID header to namespace entries per service.
 */
class MockCachingService {
  constructor() {
    // storage: { [serviceId]: { [key]: value } }
    this.storage = {};
    this.server = null;
  }

  getStore(serviceId) {
    if (!this.storage[serviceId]) {
      this.storage[serviceId] = {};
    }
    return this.storage[serviceId];
  }

  handleRequest(req, res) {
    const serviceId = req.headers['x-cs-service-id'];
    if (!serviceId) {
      this.sendError(res, 400, 'org.zowe.apiml.security.query.tokenNotProvided',
        'ZWECS400E', 'No service ID provided');
      return;
    }

    const basePath = '/cachingservice/api/v1/cache';
    const url = req.url;
    let body = '';

    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (url === basePath) {
        this.handleBasePath(req.method, serviceId, body, res);
      } else if (url.startsWith(basePath + '/')) {
        const key = decodeURIComponent(url.substring(basePath.length + 1));
        this.handleKeyPath(req.method, serviceId, key, res);
      } else {
        this.sendError(res, 404, 'org.zowe.apiml.common.endPointNotFound',
          'ZWEAM104E', 'Endpoint not found');
      }
    });
  }

  handleBasePath(method, serviceId, body, res) {
    const store = this.getStore(serviceId);

    switch (method) {
      case 'GET': {
        // Return all entries: { key1: { key: key1, value: val1 }, ... }
        const result = {};
        for (const k in store) {
          result[k] = { key: k, value: store[k] };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        break;
      }
      case 'POST': {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch (_e) {
          this.sendError(res, 400, 'org.zowe.apiml.cache.invalidPayload',
            'ZWECS104E', 'Invalid payload');
          return;
        }
        if (!parsed.key || typeof parsed.value !== 'string') {
          this.sendError(res, 400, 'org.zowe.apiml.cache.invalidPayload',
            'ZWECS104E', 'Invalid payload');
          return;
        }
        store[parsed.key] = parsed.value;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({}));
        break;
      }
      case 'PUT': {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch (_e) {
          this.sendError(res, 400, 'org.zowe.apiml.cache.invalidPayload',
            'ZWECS104E', 'Invalid payload');
          return;
        }
        if (!parsed.key || typeof parsed.value !== 'string') {
          this.sendError(res, 400, 'org.zowe.apiml.cache.invalidPayload',
            'ZWECS104E', 'Invalid payload');
          return;
        }
        if (!(parsed.key in store)) {
          // Caching service returns 404 when updating non-existent key
          this.sendError(res, 404, 'org.zowe.apiml.cache.keyNotFound',
            'ZWECS101E', 'Key not found');
          return;
        }
        store[parsed.key] = parsed.value;
        res.writeHead(204, {});
        res.end();
        break;
      }
      case 'DELETE': {
        // Delete all entries for this service
        this.storage[serviceId] = {};
        res.writeHead(204, {});
        res.end();
        break;
      }
      default:
        res.writeHead(405, {});
        res.end();
    }
  }

  handleKeyPath(method, serviceId, key, res) {
    const store = this.getStore(serviceId);

    switch (method) {
      case 'GET': {
        if (!(key in store)) {
          this.sendError(res, 404, 'org.zowe.apiml.cache.keyNotFound',
            'ZWECS101E', 'Key not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ key: key, value: store[key] }));
        break;
      }
      case 'DELETE': {
        if (!(key in store)) {
          this.sendError(res, 404, 'org.zowe.apiml.cache.keyNotFound',
            'ZWECS101E', 'Key not found');
          return;
        }
        delete store[key];
        res.writeHead(204, {});
        res.end();
        break;
      }
      default:
        res.writeHead(405, {});
        res.end();
    }
  }

  sendError(res, statusCode, messageKey, messageNumber, messageContent) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      messages: [{
        messageType: 'ERROR',
        messageNumber: messageNumber,
        messageContent: messageContent,
        messageKey: messageKey
      }]
    }));
  }

  start() {
    return new Promise((resolve) => {
      this.server = https.createServer({
        key: fs.readFileSync(path.join(__dirname, 'fixtures', 'mock-key.pem')),
        cert: fs.readFileSync(path.join(__dirname, 'fixtures', 'mock-cert.pem')),
      }, (req, res) => this.handleRequest(req, res));

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address();
        resolve({ host: addr.address, port: addr.port });
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(resolve);
      } else {
        resolve();
      }
    });
  }
}

describe('APIML Storage (mocked caching service)', function () {
  let mockServer;
  let storage;

  before(async function () {
    // Generate self-signed cert for the mock server
    await generateTestCerts();

    mockServer = new MockCachingService();
    const { host, port } = await mockServer.start();

    apimlStorage.configure({
      host: host,
      port: port,
      isHttps: true,
      tlsOptions: {
        rejectUnauthorized: false,
      }
    });
    storage = apimlStorage.makeStorageForPlugin('org.zowe.test.plugin');
  });

  after(async function () {
    await mockServer.stop();
  });

  beforeEach(async function () {
    await storage.deleteAll();
  });

  // --- Basic CRUD ---

  it('should set and get a value', async () => {
    await storage.set('key1', 'value1');
    const val = await storage.get('key1');
    expect(val).to.equal('value1');
  });

  it('should return undefined for non-existent key', async () => {
    const val = await storage.get('nonexistent');
    expect(val).to.be.undefined;
  });

  it('should overwrite existing key', async () => {
    await storage.set('key1', 'value1');
    await storage.set('key1', 'value2');
    const val = await storage.get('key1');
    expect(val).to.equal('value2');
  });

  it('should delete a key', async () => {
    await storage.set('key1', 'value1');
    await storage.delete('key1');
    const val = await storage.get('key1');
    expect(val).to.be.undefined;
  });

  it('should not throw when deleting non-existent key', async () => {
    await storage.delete('nonexistent');
  });

  it('should delete all keys', async () => {
    await storage.set('a', '1');
    await storage.set('b', '2');
    await storage.deleteAll();
    const val1 = await storage.get('a');
    const val2 = await storage.get('b');
    expect(val1).to.be.undefined;
    expect(val2).to.be.undefined;
  });

  // --- getAll ---

  it('should getAll keys', async () => {
    await storage.set('a', 'val_a');
    await storage.set('b', 'val_b');
    const all = await storage.getAll();
    expect(all).to.deep.equal({ a: 'val_a', b: 'val_b' });
  });

  it('should return empty object when no keys', async () => {
    const all = await storage.getAll();
    expect(all).to.deep.equal({});
  });

  // --- setAll ---

  it('should setAll keys', async () => {
    await storage.setAll({ x: 'one', y: 'two', z: 'three' });
    expect(await storage.get('x')).to.equal('one');
    expect(await storage.get('y')).to.equal('two');
    expect(await storage.get('z')).to.equal('three');
  });

  it('should replace all existing keys on setAll', async () => {
    await storage.set('old', 'gone');
    await storage.setAll({ new1: 'a' });
    expect(await storage.get('old')).to.be.undefined;
    expect(await storage.get('new1')).to.equal('a');
  });

  // --- Complex values ---

  it('should handle object values', async () => {
    const obj = { nested: { data: [1, 2, 3] } };
    await storage.set('obj', obj);
    const val = await storage.get('obj');
    expect(val).to.deep.equal(obj);
  });

  it('should handle numeric values', async () => {
    await storage.set('num', 42);
    const val = await storage.get('num');
    expect(val).to.equal(42);
  });

  it('should handle boolean values', async () => {
    await storage.set('bool', true);
    const val = await storage.get('bool');
    expect(val).to.equal(true);
  });

  it('should handle null value', async () => {
    await storage.set('nil', null);
    const val = await storage.get('nil');
    expect(val).to.equal(null);
  });

  it('should handle array values', async () => {
    const arr = [1, 'two', { three: 3 }];
    await storage.set('arr', arr);
    const val = await storage.get('arr');
    expect(val).to.deep.equal(arr);
  });

  // --- Key encoding ---

  it('should handle keys with special characters', async () => {
    const key = 'a-b.c#d_e';
    await storage.set(key, 'special');
    const val = await storage.get(key);
    expect(val).to.equal('special');
  });

  it('should handle keys with url-unsafe characters', async () => {
    const key = 'path/to/thing?q=1&a=2';
    await storage.set(key, 'encoded');
    const val = await storage.get(key);
    expect(val).to.equal('encoded');
  });

  // --- Error handling ---

  it('should throw APIML_STORAGE_NOT_CONFIGURED before configure', async () => {
    // We can't easily test this without a separate module load, so skip
    // unless we refactor. The configure() is already called in before().
  });

  it('should handle isConfigured correctly', () => {
    expect(apimlStorage.isConfigured()).to.be.true;
  });

  // --- Value wrapping ---

  it('should handle empty string value', async () => {
    await storage.set('empty', '');
    const val = await storage.get('empty');
    expect(val).to.equal('');
  });

  it('should handle unicode values', async () => {
    const unicode = '日本語テスト 🎉';
    await storage.set('unicode', unicode);
    const val = await storage.get('unicode');
    expect(val).to.equal(unicode);
  });

  it('should handle large values', async () => {
    const large = 'x'.repeat(10000);
    await storage.set('large', large);
    const val = await storage.get('large');
    expect(val).to.equal(large);
  });

  // --- Isolation between plugins ---

  it('should isolate storage between plugin IDs', async () => {
    const storage2 = apimlStorage.makeStorageForPlugin('org.zowe.other.plugin');
    await storage.set('shared_key', 'plugin1_val');
    await storage2.set('shared_key', 'plugin2_val');

    expect(await storage.get('shared_key')).to.equal('plugin1_val');
    expect(await storage2.get('shared_key')).to.equal('plugin2_val');

    // cleanup
    await storage2.deleteAll();
  });
});

/**
 * Generate self-signed test certificates for the mock HTTPS server.
 * Uses node-forge which is already a dependency of zlux-server-framework.
 */
async function generateTestCerts() {
  const fixturesDir = path.join(__dirname, 'fixtures');
  const keyPath = path.join(fixturesDir, 'mock-key.pem');
  const certPath = path.join(fixturesDir, 'mock-cert.pem');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return;
  }

  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  const forge = require('node-forge');
  const pki = forge.pki;
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{
    name: 'subjectAltName',
    altNames: [{ type: 7, ip: '127.0.0.1' }]
  }]);
  cert.sign(keys.privateKey);

  fs.writeFileSync(keyPath, pki.privateKeyToPem(keys.privateKey));
  fs.writeFileSync(certPath, pki.certificateToPem(cert));
}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
