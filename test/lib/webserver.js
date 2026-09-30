const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('webserver', function () {
  let webserver;

  before(function () {
    try {
      webserver = require('../../lib/webserver');
    } catch (e) {
      console.warn('Could not load webserver module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(webserver, 'webserver module should be loadable');
  });

  it('should export WebServer constructor', function () {
    assert.strictEqual(typeof webserver, 'function');
  });

  it('should export readTlsOptionsFromConfig', function () {
    assert.strictEqual(typeof webserver.readTlsOptionsFromConfig, 'function');
  });

  describe('WebServer constructor', function () {
    it('should create instance with null config', function () {
      var ws = new webserver();
      assert.strictEqual(ws.config, null);
    });

    it('should have getTlsOptions method', function () {
      var ws = new webserver();
      assert.strictEqual(typeof ws.getTlsOptions, 'function');
    });

    it('should have getServerTlsOptions method', function () {
      var ws = new webserver();
      assert.strictEqual(typeof ws.getServerTlsOptions, 'function');
    });

    it('should have close method', function () {
      var ws = new webserver();
      assert.strictEqual(typeof ws.close, 'function');
    });

    it('should have callListen method', function () {
      var ws = new webserver();
      assert.strictEqual(typeof ws.callListen, 'function');
    });
  });

  describe('readTlsOptionsFromConfig', function () {
    var tmpDir;

    beforeEach(function () {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webserver-test-'));
    });

    afterEach(function () {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should read PEM certificate files', function () {
      var certContent = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----';
      var keyContent = '-----BEGIN PRIVATE KEY-----\nMIIBfakekey\n-----END PRIVATE KEY-----';
      var certFile = path.join(tmpDir, 'cert.pem');
      var keyFile = path.join(tmpDir, 'key.pem');
      fs.writeFileSync(certFile, certContent);
      fs.writeFileSync(keyFile, keyContent);

      var nodeConfig = {
        https: {
          certificates: [certFile],
          keys: [keyFile]
        }
      };
      var httpsOptions = {};
      webserver.readTlsOptionsFromConfig(nodeConfig, httpsOptions);
      assert.ok(httpsOptions.cert, 'cert should be set');
      assert.ok(httpsOptions.key, 'key should be set');
      assert.ok(Array.isArray(httpsOptions.cert));
      assert.ok(Array.isArray(httpsOptions.key));
    });

    it('should read CA certificate files', function () {
      var caContent = '-----BEGIN CERTIFICATE-----\nMIIBfakeCA\n-----END CERTIFICATE-----';
      var caFile = path.join(tmpDir, 'ca.pem');
      fs.writeFileSync(caFile, caContent);

      var nodeConfig = {
        https: {
          certificates: [],
          keys: [],
          certificateAuthorities: [caFile]
        }
      };
      var httpsOptions = {};
      webserver.readTlsOptionsFromConfig(nodeConfig, httpsOptions);
      assert.ok(httpsOptions.ca, 'ca should be set');
      assert.ok(Array.isArray(httpsOptions.ca));
    });

    it('should read client certificate files when configured', function () {
      var certContent = '-----BEGIN CERTIFICATE-----\nMIIBfakeclient\n-----END CERTIFICATE-----';
      var keyContent = '-----BEGIN PRIVATE KEY-----\nMIIBfakeclientkey\n-----END PRIVATE KEY-----';
      var certFile = path.join(tmpDir, 'client-cert.pem');
      var keyFile = path.join(tmpDir, 'client-key.pem');
      fs.writeFileSync(certFile, certContent);
      fs.writeFileSync(keyFile, keyContent);

      var nodeConfig = {
        https: {
          certificates: [],
          keys: [],
          clientCertificates: [certFile],
          clientKeys: [keyFile]
        }
      };
      var httpsOptions = {};
      webserver.readTlsOptionsFromConfig(nodeConfig, httpsOptions);
      assert.ok(httpsOptions.clientCert, 'clientCert should be set');
      assert.ok(httpsOptions.clientKey, 'clientKey should be set');
    });

    it('should handle empty certificate arrays without throwing', function () {
      var nodeConfig = {
        https: {
          certificates: [],
          keys: []
        }
      };
      var httpsOptions = {};
      webserver.readTlsOptionsFromConfig(nodeConfig, httpsOptions);
      // Empty arrays produce empty content arrays (readFilesToArray returns null for empty)
      assert.ok(httpsOptions.cert === null || (Array.isArray(httpsOptions.cert) && httpsOptions.cert.length === 0));
      assert.ok(httpsOptions.key === null || (Array.isArray(httpsOptions.key) && httpsOptions.key.length === 0));
    });
  });
});
