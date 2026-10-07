/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

const chai = require('chai');
const expect = chai.expect;
const pluginStorage = require('../../lib/pluginStorage');
const apimlStorage = require('../../lib/apimlStorage');
const fs = require('fs');
const utilLog = require('../../lib/util').loggers.utilLogger;
const { MockCachingService, generateTestCerts } = require('./helpers/mockCachingService');

describe('APIML Storage via Unified interface', function () {
  let storage = null;
  let mockServer = null;
  const location = 'ha';

  before(async function () {
    const pluginId = 'com.rs.plugin.id';
    const gatewayHost = process.env['GATEWAY_HOST'];
    const gatewayPort = +process.env['GATEWAY_PORT'];
    const keyFile = process.env['CLIENT_KEY'];
    const certFile = process.env['CLIENT_CER'];

    if (gatewayHost && gatewayPort && certFile && keyFile) {
      console.log(`Running against real APIML gateway: ${gatewayHost}:${gatewayPort}`);
      apimlStorage.configure({
        host: gatewayHost,
        port: gatewayPort,
        isHttps: true,
        tlsOptions: {
          cert: fs.readFileSync(certFile),
          key: fs.readFileSync(keyFile),
          rejectUnauthorized: false,
        }
      });
    } else {
      console.log('GATEWAY_HOST/PORT/CLIENT_KEY/CLIENT_CER not set — using mock caching service.');
      await generateTestCerts();
      mockServer = new MockCachingService();
      const { host, port } = await mockServer.start();
      apimlStorage.configure({
        host: host,
        port: port,
        isHttps: true,
        tlsOptions: { rejectUnauthorized: false }
      });
    }

    storage = pluginStorage.PluginStorageFactory(pluginId, utilLog);
  });

  after(async function () {
    if (mockServer) {
      await mockServer.stop();
    }
  });

  beforeEach(async function () {
    await storage.deleteAll(location);
  });

  // --- Basic CRUD ---

  it('should set and get a value', async () => {
    await storage.set('key1', 'value1', location);
    expect(await storage.get('key1', location)).to.equal('value1');
  });

  it('should return undefined for non-existent key', async () => {
    expect(await storage.get('nonexistent', location)).to.be.undefined;
  });

  it('should overwrite existing key', async () => {
    await storage.set('key1', 'value1', location);
    await storage.set('key1', 'value2', location);
    expect(await storage.get('key1', location)).to.equal('value2');
  });

  it('should delete a key', async () => {
    await storage.set('key1', 'value1', location);
    await storage.delete('key1', location);
    expect(await storage.get('key1', location)).to.be.undefined;
  });

  it('should not throw when deleting a non-existent key', async () => {
    await storage.delete('nonexistent', location);
  });

  it('should delete all keys', async () => {
    await storage.set('a', '1', location);
    await storage.set('b', '2', location);
    await storage.deleteAll(location);
    expect(await storage.get('a', location)).to.be.undefined;
    expect(await storage.get('b', location)).to.be.undefined;
  });

  // --- setAll ---

  it('should setAll keys', async () => {
    const obj = { a: 'b', b: 'c', c: 'd' };
    await storage.setAll(obj, location);
    for (const key in obj) {
      expect(await storage.get(key, location)).to.equal(obj[key]);
    }
  });

  // --- Key encoding ---

  it('should handle keys with non-alphanumeric chars', async () => {
    const key = 'a-b.c#d_e';
    await storage.set(key, 'hello world', location);
    expect(await storage.get(key, location)).to.equal('hello world');
    await storage.delete(key, location);
    expect(await storage.get(key, location)).to.be.undefined;
  });

});

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
