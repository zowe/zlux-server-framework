/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'fixtures');
const KEY_PATH = path.join(FIXTURES_DIR, 'mock-key.pem');
const CERT_PATH = path.join(FIXTURES_DIR, 'mock-cert.pem');

/**
 * Mock APIML Caching Service.
 *
 * Implements the subset of the caching service API used by apimlStorage:
 *
 *   GET    /cachingservice/api/v1/cache         get all for service
 *   GET    /cachingservice/api/v1/cache/:key    get one
 *   POST   /cachingservice/api/v1/cache         create
 *   PUT    /cachingservice/api/v1/cache         update
 *   DELETE /cachingservice/api/v1/cache/:key    delete one
 *   DELETE /cachingservice/api/v1/cache         delete all for service
 *
 * Namespaces entries per the X-CS-Service-ID header, matching real APIML behavior.
 */
class MockCachingService {
  constructor() {
    // { [serviceId]: { [key]: wrappedValueString } }
    this.storage = {};
    this.server = null;
  }

  _getStore(serviceId) {
    if (!this.storage[serviceId]) {
      this.storage[serviceId] = {};
    }
    return this.storage[serviceId];
  }

  _handleRequest(req, res) {
    const serviceId = req.headers['x-cs-service-id'];
    if (!serviceId) {
      this._sendError(res, 400, 'org.zowe.apiml.security.query.tokenNotProvided',
        'ZWECS400E', 'No service ID provided');
      return;
    }

    const basePath = '/cachingservice/api/v1/cache';
    const url = req.url;
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (url === basePath) {
        this._handleBasePath(req.method, serviceId, body, res);
      } else if (url.startsWith(basePath + '/')) {
        const key = decodeURIComponent(url.substring(basePath.length + 1));
        this._handleKeyPath(req.method, serviceId, key, res);
      } else {
        this._sendError(res, 404, 'org.zowe.apiml.common.endPointNotFound',
          'ZWEAM104E', 'Endpoint not found');
      }
    });
  }

  _handleBasePath(method, serviceId, body, res) {
    const store = this._getStore(serviceId);
    switch (method) {
      case 'GET': {
        const result = {};
        for (const k in store) {
          result[k] = { key: k, value: store[k] };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        break;
      }
      case 'POST': {
        const parsed = this._parseBody(body);
        if (!parsed || !parsed.key || typeof parsed.value !== 'string') {
          this._sendError(res, 400, 'org.zowe.apiml.cache.invalidPayload',
            'ZWECS104E', 'Invalid payload');
          return;
        }
        store[parsed.key] = parsed.value;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({}));
        break;
      }
      case 'PUT': {
        const parsed = this._parseBody(body);
        if (!parsed || !parsed.key || typeof parsed.value !== 'string') {
          this._sendError(res, 400, 'org.zowe.apiml.cache.invalidPayload',
            'ZWECS104E', 'Invalid payload');
          return;
        }
        if (!(parsed.key in store)) {
          this._sendError(res, 404, 'org.zowe.apiml.cache.keyNotFound',
            'ZWECS101E', 'Key not found');
          return;
        }
        store[parsed.key] = parsed.value;
        res.writeHead(204, {});
        res.end();
        break;
      }
      case 'DELETE': {
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

  _handleKeyPath(method, serviceId, key, res) {
    const store = this._getStore(serviceId);
    switch (method) {
      case 'GET': {
        if (!(key in store)) {
          this._sendError(res, 404, 'org.zowe.apiml.cache.keyNotFound',
            'ZWECS101E', 'Key not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ key: key, value: store[key] }));
        break;
      }
      case 'DELETE': {
        if (!(key in store)) {
          this._sendError(res, 404, 'org.zowe.apiml.cache.keyNotFound',
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

  _parseBody(body) {
    try {
      return JSON.parse(body);
    } catch (_e) {
      return null;
    }
  }

  _sendError(res, statusCode, messageKey, messageNumber, messageContent) {
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
    return new Promise((resolve, reject) => {
      this.server = https.createServer({
        key: fs.readFileSync(KEY_PATH),
        cert: fs.readFileSync(CERT_PATH),
      }, (req, res) => this._handleRequest(req, res));
      this.server.on('error', reject);
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

/**
 * Generate a self-signed certificate for the mock HTTPS server using node-forge,
 * which is already a dependency of zlux-server-framework. Certs are written to
 * test/storage/fixtures/ and reused across test runs.
 */
async function generateTestCerts() {
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    return;
  }
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
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
  fs.writeFileSync(KEY_PATH, pki.privateKeyToPem(keys.privateKey));
  fs.writeFileSync(CERT_PATH, pki.certificateToPem(cert));
}

module.exports = { MockCachingService, generateTestCerts };

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
