
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
const os = require('os');
const WebServer = require('./webserver');
const PluginLoader = require('./plugin-loader');
const makeWebApp = require('./webapp').makeWebApp;
const ProcessManager = require('./process');
const AuthManager = require('./auth-manager');
const WebAuth = require('./webauth');
const unp = require('./unp-constants');
const ApimlConnector = require('./apiml');
const checkProxiedHost = require('./proxy').checkProxiedHost;
const bootstrapLogger = util.loggers.bootstrapLogger;
const installLogger = util.loggers.installLogger;
const ipaddr = require('ipaddr.js');
const apimlStorage = require('./apimlStorage');

function getInternalURL(zoweConfig, port) {
  let addr, typeString;
  if (util.isServerHttps(zoweConfig)) {
    addr = util.getHttpsListeningAddresses(zoweConfig)[0];
    typeString = 'https://';
  } else {
    addr = util.getHttpListeningAddresses(zoweConfig)[0];
    typeString = 'http://'
  }

  try {
    const address = ipaddr.process(addr);
    if (address.range() == 'multicast') {
      addr = '127.0.0.1';
    }
  } catch (e) {
    bootstrapLogger.debug("IP address binding is not a valid IP. Is it a hostname?",addr);
  }
  
  return typeString+addr+':'+this.port;
}

function getLangManagers(zoweConfig, port) {
  let langManagers = [];
  const componentConfig = zoweConfig.components['app-server'];
  if (componentConfig.languages && componentConfig.languages.java) {
    try {
      const javaManager = require('./javaManager');
      let instance = new javaManager.JavaManager(componentConfig.languages.java, zoweConfig.java?.home, componentConfig.instanceDir, getInternalURL(zoweConfig, port));
      langManagers.push(instance);
    } catch (e) {
      bootstrapLogger.warn(`ZWED0018W`, e.stack); //bootstrapLogger.warn(`Could not initialize Java manager. Java services from Apps will not be able to load\n`,
                           //e.stack);
    }
  }
  return langManagers;
}
 

function Server(zoweConfig, configLocation) {
  this.componentConfig = zoweConfig.components['app-server'];
  util.initLoggerMessages(this.componentConfig.logLanguage);
  this.setLogLevels();
  const productCode = util.getProductCode(zoweConfig); 
  unp.setProductCode(productCode);
  
  this.componentConfig.node.hostname = this.componentConfig.node.hostname ? this.componentConfig.node.hostname : os.hostname();


  this.zoweConfig = zoweConfig;
  this.configLocation = configLocation;
  util.resolveRelativePaths(zoweConfig, util.normalizePath, process.cwd());

  //for non-js code that needs to be included in plugin process
  this.port = util.getBestPort(zoweConfig);

  this.langManagers = getLangManagers(zoweConfig, this.port);
  this.processManager = new ProcessManager(true, this.langManagers);

  
  this.authManager = new AuthManager({
    productCode:  productCode,
    config: this.componentConfig.dataserviceAuthentication,
    sessionTimeoutMs: this.componentConfig.node.session?.timeoutMS || this.componentConfig.node.session?.cookie?.timeoutMS || undefined
  });

  this.pluginLoader = new PluginLoader({
    productCode: productCode,
    authManager: this.authManager,
    pluginsDir: this.componentConfig.pluginsDir,
    serverConfig: zoweConfig,
    langManagers: this.langManagers,
  });

  this.pluginMapRO = util.readOnlyProxy(this.pluginLoader.pluginMap);
  this.webServer = new WebServer();

  this.webApp = null;
  if (process.clusterManager) {
    process.clusterManager.onScanPlugins(function(wi){
      bootstrapLogger.debug('ZWED0293I',wi); //"Handling scan plugin request from worker=%d"
      this.pluginLoader.scanForPlugins();
    }.bind(this));
    process.clusterManager.onAddDynamicPlugin(function(wi, pluginDef) {
      bootstrapLogger.info("ZWED0114I", pluginDef.identifier); //bootstrapLogger.log(bootstrapLogger.INFO, "adding plugin remotely " + pluginDef.identifier);
      this.pluginLoader.addDynamicPlugin(pluginDef);
    }.bind(this));
  }
}
Server.prototype = {
  constructor: Server,
  zoweConfig: null,
  startUpConfig: null,
  configLocation: null,
  pluginManager: null,
  processManager: null,
  webApp: null,
  webServer: null,
  authManager: null,

  setLogLevels: function() {
    const logLevels = this.componentConfig.logLevels;
    if (logLevels && global.COM_RS_COMMON_LOGGER) {
      var logArray = Object.keys(logLevels);
      logArray.forEach(function(logID) {
        var level = logLevels[logID];
        try {
          global.COM_RS_COMMON_LOGGER.setLogLevelForComponentPattern(logID,level);
        } catch (e) {
          bootstrapLogger.warn(`ZWED0019W`, logID, e.stack); //bootstrapLogger.warn(`Exception when setting log level for ID="${logID}". E:\n${e.stack}`);
        }
      });
    }    
  },

  spawnChildProcesses: function() {
    if (this.componentConfig.node.childProcesses) {
      for (const proc of this.componentConfig.node.childProcesses) {
        if (!process.clusterManager || process.clusterManager.getIndexInCluster() == 0 || !proc.once) {
          try {
            this.processManager.spawn(proc); 
          } catch (error) {
            bootstrapLogger.warn(`ZWED0020W`, JSON.stringify(proc), error.message); //bootstrapLogger.warn(`Could not spawn ${JSON.stringify(proc)}: ${error.message}`);
          }  
        } else {
          bootstrapLogger.info("ZWED0115I", process.clusterManager.getIndexInCluster(), proc.path); //bootstrapLogger.log(bootstrapLogger.INFO, `Skip child process spawning on worker ${process.clusterManager.getIndexInCluster()} ${proc.path}\n`);
        }
      }
    }
  },
  
  start: Promise.coroutine(function*() {    
    const firstWorker = !(process.clusterManager && process.clusterManager.getIndexInCluster() != 0);
    if (!firstWorker) {
      this.suppressDuplicateLogging();
    }

    this.spawnChildProcesses();

    const wsConfig = this.componentConfig.node;

    if (!(yield this.webServer.validateAndPreprocessConfig(this.zoweConfig))) {
      const httpsConfig = wsConfig.https;
      const httpConfig = wsConfig.http;
      bootstrapLogger.warn('ZWED0021W',
        (httpConfig? httpConfig.port : null), (httpsConfig? httpsConfig.port : null),
        (httpsConfig? httpsConfig.pfx : null), (httpsConfig? httpsConfig.keys : null),
        (httpsConfig?httpsConfig.certificates : null),
                           (typeof wsConfig) == 'object'? JSON.stringify(wsConfig, null, 2) : wsConfig);
      //"Missing one or more parameters required to run.
      //The server requires either HTTP or HTTPS. HTTP Port given: %s. HTTPS Port given: %s
      //HTTPS requires either a PFX file or Key & Certificate files.\nGiven PFX: %s\nGiven Key: %s\nGiven Certificate: %s\nconfig was: %s
      //All but host server and config file parameters should be defined within the config file in JSON format."          //+ ' JSON format');
      throw new Error("ZWED0028E - Config invalid")
    }

    this.webServer.setConfig(this.zoweConfig);
    this.tlsOptions = this.webServer.getTlsOptions();
    this.pluginLoader.setTlsOptions(this.tlsOptions);
    const proxiedOptions = util.getAgentRequestOptions(this.zoweConfig, this.tlsOptions, false);
    
    const webAppOptions = {
      //networking
      hostname: this.componentConfig.node.hostname,
      port: this.port,
      proxiedHost: this.componentConfig.agent?.host,
      proxiedPort: this.componentConfig.agent?.https?.port || this.componentConfig.agent?.http?.port,
      isProxiedHttps: proxiedOptions?.protocol == 'https:',

      //config
      zoweConfig: this.zoweConfig,
      configLocation: this.configLocation,

      newPluginHandler: (pluginDef) => this.newPluginSubmitted(pluginDef),
      auth: WebAuth(this.authManager, this.componentConfig.cookieIdentifier, util.isServerHttps(this.zoweConfig)),
      pluginLoader: this.pluginLoader,
      langManagers: this.langManagers,
      tlsOptions: this.tlsOptions
    };


    const apimlConfig = this.componentConfig.node.mediationLayer;
    if (apimlConfig.enabled) {
      if (firstWorker) {
        installLogger.debug('ZWED0033I', this.port, JSON.stringify(apimlConfig));
        this.apiml = new ApimlConnector({
          hostName: webAppOptions.hostname,
          port: this.port,
          isHttps: util.isServerHttps(this.zoweConfig),
          discoveryHost: apimlConfig.server.hostname,
          discoveryPort: apimlConfig.server.port,
          tlsOptions: this.tlsOptions,
          eurekaOverrides: apimlConfig.eureka
        });
        yield this.apiml.setBestIpFromConfig(this.componentConfig.node);
        yield this.apiml.registerMainServerInstance();
      }
      
      if (this.componentConfig.agent?.mediationLayer?.enabled
         && this.componentConfig.agent.mediationLayer.serviceName
         && this.componentConfig.node.mediationLayer.server?.gatewayPort) {
        //at this point, we expect zss to also be attached to the mediation layer, so lets adjust.
        webAppOptions.proxiedHost = apimlConfig.server.hostname;
        webAppOptions.proxiedPort = this.componentConfig.node.mediationLayer.server.gatewayPort;
        if (firstWorker) {
          yield this.apiml.checkAgent(this.componentConfig.agent.handshakeTimeout,
                                      this.componentConfig.agent.mediationLayer.serviceName);
        }
      }
    } else if (this.componentConfig.agent) {
      if (firstWorker &&
          (process.platform !== 'os390') &&
          ((webAppOptions.proxiedHost !== undefined) || (webAppOptions.proxiedPort !== undefined))){
          /*
            if either proxiedHost or proxiedPort were specified, then there is intent to connect to an agent.
            However, zlux may be run without one, so if both are undefined then don't check for connection.
          */
          yield checkProxiedHost(webAppOptions.proxiedHost,
                                 webAppOptions.proxiedPort,
                                 this.componentConfig.agent.handshakeTimeout);
      }
    }

    util.deepFreeze(this.zoweConfig);
    this.webApp = makeWebApp(webAppOptions);
    yield this.webServer.startListening(this.webApp);
    this.webApp.init();

    bootstrapLogger.info('ZWED0302I', util.isHaMode() ? 'enabled' : 'disabled'); // "HA mode is %s"
    if (apimlConfig.cachingService?.enabled) {
      this.configureApimlStorage(apimlConfig);
    }

    yield this.loadPlugins();

    yield this.authManager.loadAuthenticators(this.zoweConfig, Object.assign({},this.tlsOptions));
    this.authManager.validateAuthPluginList();

    this.processManager.addCleanupFunction(function() {
      this.webServer.close();
    }.bind(this));

    for (let i = 0; i < this.langManagers.length; i++) {
      yield this.langManagers[i].startAll();
    }
  }),

  loadPlugins: Promise.coroutine(function*() {
    let pluginsLoaded = 0;
    let pluginCount = 0;
    let messageIssued = false;
    const homepage = this.componentConfig.node.mediationLayer.enabled
          ? util.getGatewayUrlForService(this.zoweConfig, 'zlux', 'ui', 1)+'/'
          : `${util.isServerHttps(this.zoweConfig)?'https://':'http://'}${util.getBestHostname(this.zoweConfig)}:${this.port}/`;

    this.pluginLoader.on('pluginFound', util.asyncEventListener(event => {
      pluginCount++;

      const percentComplete = `${Math.round((pluginCount/event.count)*100)}% (${pluginCount}/${event.count})`;
      let percentLoaded = `${Math.round((pluginsLoaded/event.count)*100)}% (${pluginsLoaded}/${event.count})`;
      const masterProcess = !process.clusterManager || process.clusterManager.getIndexInCluster() == 0;
      function handleIfComplete(index) {
        if (pluginCount === event.count) {
          if (!messageIssued) {
            index.pluginLoadingFinished(homepage, Math.round((pluginsLoaded/event.count)*100), pluginsLoaded, event.count);
            messageIssued = true;
          } else {
            index.pluginLoader.issueRefreshFinish();
          }
          pluginCount = 0;
        }
      }


      if (event.data.error) {
        if (masterProcess) {
          installLogger.warn(!messageIssued?`ZWED0027W`:`ZWED0170W`, event.data.identifier, event.data.pluginVersion, event.data.error.message, percentLoaded, percentComplete);
        }
        handleIfComplete(this);
      } else {
        return this.pluginLoaded(event.data).then(() => {
          pluginsLoaded++;
          percentLoaded = `${Math.round((pluginsLoaded/event.count)*100)}% (${pluginsLoaded}/${event.count})`;
          if (masterProcess) {
            installLogger.info(!messageIssued?`ZWED0290I`:`ZWED0292I`, event.data.identifier, event.data.pluginVersion, percentLoaded, percentComplete);
          }
          handleIfComplete(this);
        }, err => {
          if (masterProcess) {
            if (!messageIssued) {
              installLogger.warn(`ZWED0159W`, event.data.identifier, err.message, percentLoaded, percentComplete);
            } else {
              installLogger.warn(`ZWED0170W`, event.data.identifier, event.data.pluginVersion, err.message);
            }
            installLogger.debug(err.stack);
          }
          handleIfComplete(this);
        });
      }
    }, installLogger));
    yield this.pluginLoader.loadPlugins();
  }),
  
  configureApimlStorage(apimlConfig) {
    apimlStorage.configure({
      host: apimlConfig.server.gatewayHostname,
      port: apimlConfig.server.gatewayPort,
      tlsOptions: this.tlsOptions
    });
    bootstrapLogger.info(`ZWED0300I`); // Caching Service configured
  },

  pluginLoadingFinished(adr, percent, loaded, total) {
    if (process.clusterManager && process.clusterManager.getIndexInCluster() != 0) {
      this.restoreWorkerLogging();
    } else {
      installLogger.info(`ZWED0031I`, adr, percent, loaded, total);
      //Server is ready at ${adr}, Plugins successfully loaded: ${percent}% (${loaded}/${total})`);
    }
    this.pluginLoader.enablePluginScanner(this.componentConfig.node.pluginScanIntervalSec);
  },

  suppressDuplicateLogging() {
    global.COM_RS_COMMON_LOGGER.setLogLevelForComponentPattern("_zsf\..*",1);
  },

  restoreWorkerLogging() {
    global.COM_RS_COMMON_LOGGER.setLogLevelForComponentPattern("_zsf\..*",2);
    if (this.componentConfig.logLevels) {
      let keys = Object.keys(this.componentConfig.logLevels);
      keys.forEach((key)=> {
        global.COM_RS_COMMON_LOGGER.setLogLevelForComponentName(key, this.componentConfig.logLevels[key]);
      });
    }
  },

  newPluginSubmitted(pluginDef) {
    installLogger.debug("ZWED0162I", pluginDef); //installLogger.debug("Adding plugin ", pluginDef);
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
          //TODO here, as much as i'd like to clean this up, its part of the plugin api so it would break people.
          app: {
            productCode: util.getProductCode(this.zoweConfig),
            rootRedirectURL: util.getRootRedirectUrl(this.zoweConfig),
          },
          startUp: {
            proxiedHost: this.componentConfig.agent?.host,
            proxiedPort: this.componentConfig.agent?.https?.port || this.componentConfig.agent?.http?.port,
            allowInvalidTLSProxy: !this.tlsOptions.rejectUnauthorized
          },
          user: this.componentConfig,
          all: this.zoweConfig
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

