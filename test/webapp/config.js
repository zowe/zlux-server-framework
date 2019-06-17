/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

// start with uncommenting these once a test fails 
global.COM_RS_COMMON_LOGGER.setLogLevelForComponentPattern("_zsf.install", 0);
global.COM_RS_COMMON_LOGGER.setLogLevelForComponentPattern("_zsf.utils", 0);
global.COM_RS_COMMON_LOGGER.setLogLevelForComponentPattern("_zsf.bootstrap", 0);

exports.webAppOptions = {
    sessionTimeoutMs: 60  * 60 * 1000,
    httpPort: 31337,
    // this will break things because callService() will try HTTPS if is't
    // present and in this test env we only have an HTTP listener 
//   httpsPort: 31338,
    productCode: 'XXX',
    productDir: process.cwd(),
    proxiedHost: "localhost",
    proxiedPort: 12345,
    allowInvalidTLSProxy: true,
    rootRedirectURL: "",
    rootServices: [],
    serverConfig: {
      node: {
        https: {},
        http: { port: 31337 }
      }
    },
    staticPlugins: {
      list: [],
      pluginMap: {},
      ng2: {}
    },
    newPluginHandler: (pluginDef) => {},
    auth: { 
      doLogin() {},
      getStatus() {},
      doLogout() {},
      refreshStatus() {},
      middleware(r, re, next) { next() }
    }
};
