
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
const http = require('http');
const ApimlConnector = require('./apiml');
const checkProxiedHost = require('./proxy').checkProxiedHost;
const bootstrapLogger = util.loggers.bootstrapLogger;
const installLogger = util.loggers.installLogger;
const ipaddr = require('ipaddr.js');
const apimlStorage = require('./apimlStorage');
const fs = require('fs');

const hostsContext = (webAppOptions) => {
  let hosts = {
    hostname: webAppOptions.hostname,
    httpPort: webAppOptions.httpPort, 
    httpsPort: webAppOptions.httpsPort, 
    agentHost: webAppOptions.proxiedHost,
    agentPort: webAppOptions.proxiedPort,
    isAgentHttps: webAppOptions.isProxiedHttps
  }
  return hosts;
}

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
    langManagers: this.langManagers
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
    let agentPort = undefined;
    if (this.componentConfig.agent) {
      if (!forceHttpForAgent && this.componentConfig.agent.https?.port) {
        this.componentConfig.agent.http = {};
        agentPort = Number(this.componentConfig.agent.https.port);
      } else if (this.componentConfig.agent.http?.port) {
        this.componentConfig.agent.https = {};
        agentPort = Number(this.componentConfig.agent.http.port);
      } else {
        console.warn(`ZWED5006W - Invalid server configuration. Agent specified without http or https port`);
      }
    }

    const webAppOptions = {
      //networking
      hostname: this.componentConfig.node.hostname,
      port: this.port,
      proxiedHost: this.componentConfig.agent?.host,
      proxiedPort: agentPort,
      isProxiedHttps: false,

      //config
      zoweConfig: this.zoweConfig,
      configLocation: this.configLocation,

      //services
      staticPlugins: {
        list: this.pluginLoader.plugins,
        pluginMap: this.pluginLoader.pluginMap
      },
      newPluginHandler: (pluginDef) => this.newPluginSubmitted(pluginDef),
      auth: WebAuth(this.authManager, this.componentConfig.cookieIdentifier, util.isServerHttps(this.zoweConfig)),
      pluginLoader: this.pluginLoader,
      langManagers: this.langManagers,
      tlsOptions: this.webServer.getTlsOptions()
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
          tlsOptions: this.webServer.getTlsOptions(),
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
          ((this.webAppOptions.proxiedHost !== undefined) || (webAppOptions.proxiedPort !== undefined))){
          /*
            if either proxiedHost or proxiedPort were specified, then there is intent to connect to an agent.
            However, zlux may be run without one, so if both are undefined then don't check for connection.
          */
          yield checkProxiedHost(webAppOptions.proxiedHost,
                                 webAppOptions.proxiedPort,
                                 this.componentConfig.agent.handshakeTimeout);
      }
    }

    const proxiedOptions = util.getAgentRequestOptions(this.zoweConfig, webAppOptions.tlsOptions, false);
    webAppOptions.isProxiedHttps = proxiedOptions && proxiedOptions.protocol == 'https:' ? true : false;

    util.deepFreeze(this.zoweConfig);
    this.webApp = makeWebApp(webAppOptions);
    yield this.webServer.startListening(this.webApp);
    this.webApp.init();
    let pluginsLoaded = 0;
    let pluginCount = 0;
    let runningInstances = [];
    let hosts = hostsContext(webAppOptions);

    util.getHttpsListeningAddresses(this.zoweConfig).forEach((ip)=> {
      runningInstances.push("https://" + ip + ':' + httpsPort)
    });    
    util.getHttpListeningAddresses(this.zoweConfig).forEach((ip)=> {
        runningInstances.push("http://" + ip + ':' + httpsPort)
    });

    let messageIssued = false;
    this.pluginLoader.setTlsOptions(this.componentConfig.node.allowInvalidTLSProxy, this.webServer.getTlsOptions());

    if (apimlConfig.cachingService?.enabled) {
      this.configureApimlStorage(apimlConfig);
    }

    this.pluginLoader.on('pluginFound', util.asyncEventListener(event => {
      pluginCount++;
      if (event.data.error) {
        if (!process.clusterManager || process.clusterManager.getIndexInCluster() == 0) {
          if (!messageIssued) {
            installLogger.warn(`ZWED0027W`, event.data.identifier, event.data.pluginVersion, event.data.error.message, 
                               Math.round((pluginsLoaded/event.count)*100), pluginsLoaded, event.count, 
                               Math.round((pluginCount/event.count)*100), pluginCount, event.count);
          } else {
            installLogger.warn(`ZWED0170W`, event.data.identifier, event.data.pluginVersion, event.data.error.message);
          }
        }
        if (pluginCount === event.count) {
          if (!messageIssued) {
            this.pluginLoadingFinished(runningInstances[0], Math.round((pluginsLoaded/event.count)*100), pluginsLoaded, event.count);
            messageIssued = true;
          } else {
            this.pluginLoader.issueRefreshFinish();
          }
          pluginCount = 0;
        }
      } else {
        return this.pluginLoaded(event.data).then(() => {
          pluginsLoaded++;
          if (!process.clusterManager || process.clusterManager.getIndexInCluster() == 0) {
            if (!messageIssued) {
              installLogger.info(`ZWED0290I`, event.data.identifier, event.data.pluginVersion,  
                                 Math.round((pluginsLoaded/event.count)*100), pluginsLoaded, event.count, 
                                 Math.round((pluginCount/event.count)*100), pluginCount, event.count);                  
            } else {
              installLogger.info(`ZWED0292I`, event.data.identifier, event.data.pluginVersion);
            }
          }
          if (pluginCount === event.count) {
            if (!messageIssued) {
              this.pluginLoadingFinished(runningInstances[0], Math.round((pluginsLoaded/event.count)*100), pluginsLoaded, event.count);
              messageIssued = true;
            } else {
              this.pluginLoader.issueRefreshFinish();
            }
            pluginCount = 0;
          }
        }, err => {
          if (!process.clusterManager || process.clusterManager.getIndexInCluster() == 0) {            
            if (!messageIssued) {
              installLogger.warn(`ZWED0159W`, event.data.identifier, err.message, 
                                 Math.round((pluginsLoaded/event.count)*100), pluginsLoaded, event.count,
                                 Math.round((pluginCount/event.count)*100), pluginCount, event.count);
            } else {
              installLogger.warn(`ZWED0170W`, event.data.identifier, event.data.pluginVersion, err.message);
            }
            installLogger.debug(err.stack);
          }
          if (pluginCount === event.count) {
            if (!messageIssued) {
              this.pluginLoadingFinished(runningInstances[0], Math.round((pluginsLoaded/event.count)*100), pluginsLoaded, event.count);
              messageIssued = true;
            } else {
              this.pluginLoader.issueRefreshFinish();
            }
            pluginCount = 0;
          }
        });
      }
    }, installLogger));

    bootstrapLogger.info('ZWED0302I', util.isHaMode() ? 'enabled' : 'disabled'); // "HA mode is %s"
    yield this.pluginLoader.loadPlugins(hosts);
    yield this.authManager.loadAuthenticators(this.zoweConfig, Object.assign({},this.webServer.getTlsOptions()));
    this.authManager.validateAuthPluginList();
    this.processManager.addCleanupFunction(function() {
      this.webServer.close();
    }.bind(this));

    for (let i = 0; i < this.langManagers.length; i++) {
      yield this.langManagers[i].startAll();
    }
  }),

  configureApimlStorage(apimlConfig) {
    apimlStorage.configure({
      host: apimlConfig.server.gatewayHostname,
      port: apimlConfig.server.gatewayPort,
      tlsOptions: this.webServer.getTlsOptions()
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
          user: this.componentConfig,
          all: this.zoweConfig, 
          hosts: hostsContext(this.webApp.options)
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

