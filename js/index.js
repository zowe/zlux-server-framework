
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';
const Promise = require('bluebird');
const util = require('./util');
const WebServer = require('./webserver');
const PluginLoader = require('./plugin-loader');
const makeWebApp = require('./webapp').makeWebApp;
const ProcessManager = require('./process');
const AuthManager = require('./auth-manager');
const WebAuth = require('./webauth');
const unp = require('./unp-constants');
const http = require('http');
const ApimlConnector = require('./apiml');

const bootstrapLogger = util.loggers.bootstrapLogger;
const installLogger = util.loggers.installLogger;

function Server(appConfig, userConfig, startUpConfig) {
  this.userConfig = userConfig;
  this.setLogLevels(userConfig.logLevels);
  this.appConfig = appConfig;
  unp.setProductCode(appConfig.productCode);
  util.deepFreeze(appConfig);
  util.resolveRelativePaths(process.cwd(), userConfig);
  util.deepFreeze(userConfig);
  this.startUpConfig = startUpConfig;
  util.deepFreeze(startUpConfig);
  this.processManager = new ProcessManager(true);
  this.authManager = new AuthManager({
    config: userConfig.dataserviceAuthentication,
    productCode:  appConfig.productCode
  });
  this.pluginLoader = new PluginLoader({
    productCode: appConfig.productCode,
    authManager: this.authManager,
    pluginsDir: userConfig.pluginsDir,
    serverConfig: userConfig
  });
  this.pluginMapRO = util.readOnlyProxy(this.pluginLoader.pluginMap);
  this.webServer = new WebServer();
  this.webApp = null;
  if (process.clusterManager) {
    process.clusterManager.onAddDynamicPlugin(function(wi, pluginDef) {
      bootstrapLogger.log(bootstrapLogger.INFO, "adding plugin remotely " + pluginDef.identifier);
      this.pluginLoader.addDynamicPlugin(pluginDef);
    }.bind(this));
  }
}
Server.prototype = {
  constructor: Server,
  appConfig: null,
  userConfig: null,
  startUpConfig: null,
  pluginManager: null,
  processManager: null,
  webApp: null,
  webServer: null,
  authManager: null,

  setLogLevels: function(logLevels) {
    if (logLevels && global.COM_RS_COMMON_LOGGER) {
      var logArray = Object.keys(logLevels);
      logArray.forEach(function(logID) {
        var level = logLevels[logID];
        try {
          global.COM_RS_COMMON_LOGGER.setLogLevelForComponentPattern(logID,level);
        } catch (e) {
          bootstrapLogger.warn(`Exception when setting log level for ID="${logID}". E:\n${e.stack}`);
        }
      });
    }    
  },
  
  start: Promise.coroutine(function*() {
    if (this.userConfig.node.childProcesses) {
      for (const proc of this.userConfig.node.childProcesses) {
        if (!process.clusterManager || process.clusterManager.getIndexInCluster() == 0 || !proc.once) {
          try {
            this.processManager.spawn(proc); 
          } catch (error) {
            bootstrapLogger.warn(`Could not spawn ${JSON.stringify(proc)}: ${error.message}`);
          }  
        } else {
          bootstrapLogger.log(bootstrapLogger.INFO, `Skip child process spawning on worker ${process.clusterManager.getIndexInCluster()} ${proc.path}\n`);
        }
      }
    }
    const wsConfig = this.userConfig.node;
    if (!this.webServer.isConfigValid(wsConfig)) {
      const httpsConfig = wsConfig.https;
      const httpConfig = wsConfig.http;
      bootstrapLogger.warn('Missing one or more parameters required to run.');
      bootstrapLogger.warn('The server requires either HTTP or HTTPS.'
        + ' HTTP Port given: ' + (httpConfig? httpConfig.port : null)
        + '. HTTPS Port given: ' + (httpsConfig? httpsConfig.port : null));
      bootstrapLogger.warn('HTTPS requires either a PFX file or Key & Certificate files.');
      bootstrapLogger.warn('Given PFX: '+ (httpsConfig? httpsConfig.pfx : null));
      bootstrapLogger.warn('Given Key: '+ (httpsConfig? httpsConfig.keys : null));
      bootstrapLogger.warn('Given Certificate: '+ (httpsConfig?
          httpsConfig.certificates : null));
      if ((typeof wsConfig) == 'object') {
        bootstrapLogger.warn('config was: '+JSON.stringify(wsConfig, null, 2));
      } else {
        bootstrapLogger.warn('config was: '+wsConfig);
      }
      bootstrapLogger.warn('All but host server and config file parameters'
          + ' should be defined within the config file in'
          + ' JSON format');
      throw new Error("config invalid")
    }
    this.webServer.setConfig(wsConfig);
    const webauth = WebAuth(this.authManager);
    let sessionTimeoutMs = null;
    try { 
      //TODO a better configuration infrastructure that supports 
      //deeply nested structures and default values on all levels 
      sessionTimeoutMs = wsConfig.session.cookie.timeoutMS;
    } catch (nullReferenceError) { /* ignore */ }
    const webAppOptions = {
      sessionTimeoutMs: sessionTimeoutMs,
      httpPort: wsConfig.http ? wsConfig.http.port : undefined,
      httpsPort: wsConfig.https ? wsConfig.https.port : undefined,
      productCode: this.appConfig.productCode,
      productDir: this.userConfig.productDir,
      proxiedHost: this.startUpConfig.proxiedHost,
      proxiedPort: this.startUpConfig.proxiedPort,
      allowInvalidTLSProxy: this.startUpConfig.allowInvalidTLSProxy,
      rootRedirectURL: this.appConfig.rootRedirectURL,
      rootServices: this.appConfig.rootServices,
      serverConfig: this.userConfig,
      staticPlugins: {
        list: this.pluginLoader.plugins,
        pluginMap: this.pluginLoader.pluginMap
      },
      newPluginHandler: (pluginDef) => this.newPluginSubmitted(pluginDef),
      auth: webauth
    };
    this.apiml = new ApimlConnector({
      hostName: 'localhost',
      ipAddr: '127.0.0.1',
      httpPort: webAppOptions.httpPort, 
      httpsPort: webAppOptions.httpsPort, 
      apimlConfig: this.userConfig.node.mediationLayer
    });
    this.webApp = makeWebApp(webAppOptions);
    this.webServer.startListening(this.webApp.expressApp);
    let pluginsLoaded = [];
    // Add the plugin and add it to the count
    this.pluginLoader.on('pluginAdded', event => {
      this.pluginLoaded(event.data).then(() => {
        installLogger.info('Installed plugin: ' + event.data.identifier);
      }, err => {
        installLogger.warn('Failed to install plugin: ' 
                           + event.data.identifier);
        console.log(err);
      });
    });
    this.pluginLoader.loadPlugins();
    yield this.authManager.loadAuthenticators(this.userConfig);
    this.authManager.validateAuthPluginList();
    this.processManager.addCleanupFunction(function() {
      this.webServer.close();
    }.bind(this));
    yield this.apiml.registerMainServerInstance();
  }),

  newPluginSubmitted(pluginDef) {
    installLogger.debug("Adding plugin ", pluginDef);
    this.pluginLoader.addDynamicPlugin(pluginDef);
    if (process.clusterManager) {
      process.clusterManager.addDynamicPlugin(pluginDef);
    }
  },

  pluginLoaded(pluginDef) {
    const pluginContext = {
      pluginDef,
      server: {
        config: {
          app: this.appConfig,
          user: this.userConfig,
          startUp: this.startUpConfig
        },
        state: {
          pluginMap: this.pluginMapRO
        }
      }
    };
    return this.webApp.installPlugin(pluginContext);
  }
};

module.exports = Server;


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

