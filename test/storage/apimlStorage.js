/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

const chai = require('chai');
const expect = chai.expect;
const apimlStorage = require('../../lib/apimlStorage');
const fs = require('fs');
const { MockCachingService, generateTestCerts } = require('./helpers/mockCachingService');

describe('APIML Storage', function () {
  let storage = null;
  let mockServer = null;

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

    storage = apimlStorage.makeStorageForPlugin(pluginId);
  });

  after(async function () {
    if (mockServer) {
      await mockServer.stop();
    }
  });

  beforeEach(async function () {
    await storage.deleteAll();
  });

  // --- Basic CRUD ---

  it('should set and get a value', async () => {
    await storage.set('key1', 'value1');
    expect(await storage.get('key1')).to.equal('value1');
  });

  it('should return undefined for non-existent key', async () => {
    expect(await storage.get('nonexistent')).to.be.undefined;
  });

  it('should overwrite existing key', async () => {
    await storage.set('key1', 'value1');
    await storage.set('key1', 'value2');
    expect(await storage.get('key1')).to.equal('value2');
  });

  it('should delete a key', async () => {
    await storage.set('key1', 'value1');
    await storage.delete('key1');
    expect(await storage.get('key1')).to.be.undefined;
  });

  it('should not throw when deleting a non-existent key', async () => {
    await storage.delete('nonexistent');
  });

  it('should delete all keys', async () => {
    await storage.set('a', '1');
    await storage.set('b', '2');
    await storage.deleteAll();
    expect(await storage.get('a')).to.be.undefined;
    expect(await storage.get('b')).to.be.undefined;
  });

  // --- getAll / setAll ---

  it('should getAll keys', async () => {
    await storage.set('a', 'val_a');
    await storage.set('b', 'val_b');
    const all = await storage.getAll();
    expect(all).to.deep.equal({ a: 'val_a', b: 'val_b' });
  });

  it('should return empty object from getAll when no keys set', async () => {
    expect(await storage.getAll()).to.deep.equal({});
  });

  it('should setAll keys', async () => {
    await storage.setAll({ x: 'one', y: 'two', z: 'three' });
    expect(await storage.get('x')).to.equal('one');
    expect(await storage.get('y')).to.equal('two');
    expect(await storage.get('z')).to.equal('three');
  });

  it('should replace all prior keys on setAll', async () => {
    await storage.set('old', 'gone');
    await storage.setAll({ new1: 'a' });
    expect(await storage.get('old')).to.be.undefined;
    expect(await storage.get('new1')).to.equal('a');
  });

  // --- Key encoding ---

  it('should handle keys with non-alphanumeric chars', async () => {
    const key = 'a-b.c#d_e';
    await storage.set(key, 'hello world');
    expect(await storage.get(key)).to.equal('hello world');
    await storage.delete(key);
    expect(await storage.get(key)).to.be.undefined;
  });

  it('should handle keys with url-unsafe characters', async () => {
    const key = 'path/to/thing?q=1&a=2';
    await storage.set(key, 'encoded');
    expect(await storage.get(key)).to.equal('encoded');
  });

  // --- Complex values ---

  it('should handle object values', async () => {
    const obj = { nested: { data: [1, 2, 3] } };
    await storage.set('obj', obj);
    expect(await storage.get('obj')).to.deep.equal(obj);
  });

  it('should handle numeric values', async () => {
    await storage.set('num', 42);
    expect(await storage.get('num')).to.equal(42);
  });

  it('should handle boolean values', async () => {
    await storage.set('bool', true);
    expect(await storage.get('bool')).to.equal(true);
  });

  it('should handle null value', async () => {
    await storage.set('nil', null);
    expect(await storage.get('nil')).to.equal(null);
  });

  it('should handle array values', async () => {
    const arr = [1, 'two', { three: 3 }];
    await storage.set('arr', arr);
    expect(await storage.get('arr')).to.deep.equal(arr);
  });

  it('should handle empty string value', async () => {
    await storage.set('empty', '');
    expect(await storage.get('empty')).to.equal('');
  });

  it('should handle unicode values', async () => {
    const unicode = '日本語テスト 🎉';
    await storage.set('unicode', unicode);
    expect(await storage.get('unicode')).to.equal(unicode);
  });

  it('should handle large values', async () => {
    const large = 'x'.repeat(10000);
    await storage.set('large', large);
    expect(await storage.get('large')).to.equal(large);
  });

  // --- Plugin isolation ---

  it('should isolate storage between plugin IDs', async () => {
    const storage2 = apimlStorage.makeStorageForPlugin('com.rs.other.plugin');
    await storage.set('shared_key', 'plugin1_val');
    await storage2.set('shared_key', 'plugin2_val');
    expect(await storage.get('shared_key')).to.equal('plugin1_val');
    expect(await storage2.get('shared_key')).to.equal('plugin2_val');
    await storage2.deleteAll();
  });

});

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
