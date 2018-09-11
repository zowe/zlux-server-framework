

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';

const Promise = require('bluebird');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const WebSocket = require('ws');
const expressWs = require('express-ws');
const util = require('./util');
const reader = require('./reader');

const bootstrapLogger = util.loggers.bootstrapLogger;
const contentLogger = util.loggers.contentLogger;
const childLogger = util.loggers.childLogger;

function WebServer() {
  this.config = null;
}
WebServer.prototype = {
  constructor: WebServer,
  config: null,
  httpOptions: null,
  httpsOptions: null,
  
  _loadHttpsKeyData() {
    if (this.config.https.pfx) {
      try {
        this.httpsOptions.pfx = fs.readFileSync(this.config.https.pfx);
        bootstrapLogger.info('Using PFX: '+ this.config.https.pfx);
      } catch (e) {
        bootstrapLogger.warn('Error when reading PFX. Server cannot continue. Error='+e.message);
        //        process.exit(UNP_EXIT_PFX_READ_ERROR);
        throw e;
      }
    } else {
      if (this.config.https.certificates) {
        this.httpsOptions.cert = util.readFilesToArray(
            this.config.https.certificates);
        bootstrapLogger.info('Using Certificate: '
            + this.config.https.certificates);
      }
      if (this.config.https.keys) {
        this.httpsOptions.key = util.readFilesToArray(this.config.https.keys);
      }
    }
    if (this.config.https.certificateAuthorities) {
      this.httpsOptions.ca = util.readFilesToArray(this.config.https.certificateAuthorities);
    }
    if (this.config.https.certificateRevocationLists) {
      this.httpsOptions.crl = util.readFilesToArray(this.config.https.certificateRevocationLists);
    };
  },

  isConfigValid(config) {
    let canRun = false;
    if (config.http && config.http.port) {
      canRun = true;
    } else if (config.https && config.https.port) {
      if (config.https.pfx) {
        canRun = true;
      } else if (config.https.cert && config.https.key) {
        canRun = true;
      }
    }
    return canRun;
  },

  setConfig(config) {
    this.config = config;
    if (this.config.http && this.config.http.port) {
      this.httpOptions = {};
    }
    if (this.config.https && this.config.https.port) {
      this.httpsOptions = {};
    }
  },

  startListening: Promise.coroutine(function* (app) {
    let t = this;
    if (this.config.https && this.config.https.port) {
      let listening = false;
      this._loadHttpsKeyData();
      while (!listening) {
        try {
          this.httpsServer = https.createServer(this.httpsOptions, app);
          this.expressWsHttps = expressWs(app, this.httpsServer, {maxPayload: 50000});
          listening = true;
        } catch (e) {
          if (e.message == 'mac verify failure' && !noPrompt) {
            const r = reader();
            try {
              httpsOptions.passphrase = yield reader.readPassword(
                'HTTPS key or PFX decryption failure. Please enter passphrase: ');
            } finally {
              r.close();
            }
          } else {
            throw e;
          }
        }
      }
      this.callListen(this.httpsServer, 'https', 'HTTPS');
    }
    if (this.config.http && this.config.http.port) {
      this.httpServer = http.createServer(app);
      this.expressWsHttp = expressWs(app, this.httpServer);
      this.callListen(this.httpServer, 'http', 'HTTP');
    }
  }),

  callListen(methodServer, methodName, methodNameForLogging) {
    var methodConfig = this.config[methodName];
    var addressForLogging = methodConfig.hostname ? methodConfig.hostname : "*";
    addressForLogging += ":" + methodConfig.port;

    var logFunction = function () {
      bootstrapLogger.log(bootstrapLogger.INFO,`(${methodNameForLogging})  listening on ${addressForLogging}`)
    };
    bootstrapLogger.log(bootstrapLogger.INFO,`(${methodNameForLogging})  about to start listening on ${addressForLogging}`);

    if (methodConfig.hostname) {
      methodServer.listen(methodConfig.port, logFunction);
    } else {
      methodServer.listen(methodConfig.port, methodConfig.hostname, logFunction);
    }
  },

  close() {
    if (this.httpServer) {
      bootstrapLogger.log(bootstrapLogger.INFO,'Closing http server');
      this.httpServer.close();
    }
    if (this.httpsServer) {
      bootstrapLogger.log(bootstrapLogger.INFO,'Closing https server');
      this.httpsServer.close();
    }
  }
};

module.exports = WebServer;

const _unitTest = false;
function unitTest() {
  const config = {
    "node": {
      "http": {
        "port": 31339,
        "hostname": "127.0.0.1"
      },
      "https": {
        "port": 31340,
        "keys": ["../deploy/product/MVD/serverConfig/server.key"],
        "certificates": ["../deploy/product/MVD/serverConfig/server.cert"]
      }
    }
  };
  const webServer = makeWebServer();
  if (webServer.isConfigValid(config)) {
    bootstrapLogger.info("Config valid");
    webServer.setConfig(config);
    const express = require('express');
    webServer.startListening(express());
  } else {
     bootstrapLogger.warn("Config invalid");
  }
}
if (_unitTest) {
  unitTest();
}
  
  
  


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

