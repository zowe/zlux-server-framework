/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

import { expect } from 'chai';
//import * as chai from 'chai';
import { pluginStorage } from '../../lib/pluginStorage';
import { apimlStorage } from '../../lib/apimlStorage';
import fs from 'fs';
import { loggers } from '../../lib/util';

describe('APIML Storage via Unified interface', function () {
  let storage = null;
  const location = 'ha';

  before(function () {
    const pluginId = 'com.rs.plugin.id';
    const gatewayHost = process.env['GATEWAY_HOST'];
    const gatewayPort = +process.env['GATEWAY_PORT'];
    const keyFile = process.env['CLIENT_KEY'];
    const certFile = process.env['CLIENT_CER'];

    if (gatewayHost && gatewayPort && certFile && keyFile) {
      const settings = {
        host: gatewayHost,
        port: gatewayPort,
        tlsOptions: {
          cert: fs.readFileSync(certFile),
          key: fs.readFileSync(keyFile),
          rejectUnauthorized: false,
        }
      };
      apimlStorage.configure(settings);
      const utilLog = loggers.utilLogger;
      storage = pluginStorage.PluginStorageFactory(pluginId, utilLog);
    } else {
      console.log(`Required environment variables not found. Set these env vars to run tests:`);
      console.log(`  export GATEWAY_HOST=<gateway-host>`);
      console.log(`  export GATEWAY_PORT=<gateway-port>`);
      console.log(`  export CLIENT_KEY=<client-key-file>`);
      console.log(`  export CLIENT_CER=<client-cer-file>`);
      this.skip();
    }
  });

  beforeEach(async () => {
    await storage.deleteAll(location);
  });

  it('should set new key', async () => {
    const key = 'a';
    const val = 'b';
    await storage.set(key, val, location);
    const newVal = await storage.get(key, location);
    expect(newVal).to.equal(val);
  });

  it('should set and remove new key', async () => {
    const key = 'a';
    const val = 'b';
    await storage.set(key, val, location);
    await storage.delete(key, location);
    const newVal = await storage.get(key, location);
    expect(newVal).to.be.undefined;
  });

  it('should set all keys', async () => {
    const obj = {
      a: 'b',
      b: 'c',
      c: 'd'
    };
    await storage.setAll(obj, location);
    for (const key in obj) {
      const val = await storage.get(key, location);
      expect(val).to.equal(obj[key]);
    }
  });

  it('should set/get/delete key with non-alphanumeric chars', async () => {
    const key = "a-b.c#d_e";
    const val = 'hello world';
    await storage.set(key, val, location);
    const newVal = await storage.get(key, location);
    expect(newVal).to.equal(val);
    await storage.delete(key, location);
    const newVal2 = await storage.get(key, location);
    expect(newVal2).to.be.undefined;
  });

});

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
