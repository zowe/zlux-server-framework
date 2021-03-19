
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

const defaultOptions = {
  relativePathResolver: util.normalizePath
}

function Server(appConfig, userConfig, startUpConfig, configLocation) {
  util.initLoggerMessages(userConfig.logLanguage);
  this.options = Object.seal(defaultOptions);
  this.userConfig = userConfig;
  this.configLocation = configLocation;
  this.setLogLevels(userConfig.logLevels);
  this.appConfig = appConfig;
  unp.setProductCode(appConfig.productCode);
  util.deepFreeze(appConfig);
  util.resolveRelativePaths(userConfig, this.options.relativePathResolver, process.cwd());
  this.startUpConfig = startUpConfig;
  util.deepFreeze(startUpConfig);
  //for non-js code that needs to be included in plugin process
  let typeString;;
  let addr;
  let port;
  if (userConfig.node.https) {
    addr = userConfig.node.https.ipAddresses[0];
    port = userConfig.node.https.port;
    typeString = 'https://';
  } else {
    addr = userConfig.node.http.ipAddresses[0];    
    port = userConfig.node.http.port;
    typeString = 'http://'
  }
  const address = ipaddr.process(addr);
  if (address.range() == 'multicast') {
    addr = '127.0.0.1';
  }
  let serverUrl = typeString+addr+':'+port;
  let langManagers = [];
  this.langManagers = langManagers;
  if (userConfig.languages && userConfig.languages.java) {
    try {
      const javaManager = require('./javaManager');
      let instance = new javaManager.JavaManager(userConfig.languages.java, userConfig.instanceDir, serverUrl);
      langManagers.push(instance);
    } catch (e) {
      bootstrapLogger.warn(`ZWED0018W`, e.stack); //bootstrapLogger.warn(`Could not initialize Java manager. Java services from Apps will not be able to load\n`,
                           //e.stack);
    }
    
  }

  this.processManager = new ProcessManager(true, langManagers);
  let sessionTimeoutMs = undefined;
  try { 
    //TODO a better configuration infrastructure that supports 
    //deeply nested structures and default values on all levels 
    sessionTimeoutMs = userConfig.node.session.timeoutMS
      ? userConfig.node.session.timeoutMS
    //deprecating due to cookie not having the expiration info
      : userConfig.node.session.cookie.timeoutMS;
  } catch (nullReferenceError) { /* ignore */ }
  this.authManager = new AuthManager({
    config: userConfig.dataserviceAuthentication,
    productCode:  appConfig.productCode,
    sessionTimeoutMs: sessionTimeoutMs
  });

  this.pluginLoader = new PluginLoader({
    productCode: appConfig.productCode,
    authManager: this.authManager,
    pluginsDir: userConfig.pluginsDir,
    serverConfig: userConfig,
    relativePathResolver: this.options.relativePathResolver,
    langManagers: this.langManagers
  });
  this.pluginMapRO = util.readOnlyProxy(this.pluginLoader.pluginMap);
  this.webServer = new WebServer();
  this.webApp = null;
  if (process.clusterManager) {
    process.clusterManager.onScanPlugins(function(wi){
      bootstrapLogger.debug('ZWED0293I',wi);
      //"Handling scan plugin request from worker=%d"
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
  appConfig: null,
  userConfig: null,
  startUpConfig: null,
  configLocation: null,
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
          bootstrapLogger.warn(`ZWED0019W`, logID, e.stack); //bootstrapLogger.warn(`Exception when setting log level for ID="${logID}". E:\n${e.stack}`);
        }
      });
    }    
  },
  
  start: Promise.coroutine(function*() {
    //this parameter has been duplicated all over the code, trying to consolidate.
    const allowInvalidTLSProxy = this.startUpConfig.allowInvalidTLSProxy || this.userConfig.node.allowInvalidTLSProxy;
    this.userConfig.node.allowInvalidTLSProxy = allowInvalidTLSProxy;
    
    const firstWorker = !(process.clusterManager && process.clusterManager.getIndexInCluster() != 0);
    
    if (this.userConfig.node.childProcesses) {
      for (const proc of this.userConfig.node.childProcesses) {
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
    const wsConfig = this.userConfig.node;
    if (!(yield this.webServer.validateAndPreprocessConfig(wsConfig))) {
      const httpsConfig = wsConfig.https;
      const httpConfig = wsConfig.http;
      bootstrapLogger.warn('ZWED0021W',
        (httpConfig? httpConfig.port : null), (httpsConfig? httpsConfig.port : null),
        (httpsConfig? httpsConfig.pfx : null), (httpsConfig? httpsConfig.keys : null),
        (httpsConfig?httpsConfig.certificates : null),
        (typeof wsConfig) == 'object'? JSON.stringify(wsConfig, null, 2) : wsConfig);
      //bootstrapLogger.warn('Missing one or more parameters required to run.');
      //bootstrapLogger.warn('The server requires either HTTP or HTTPS.'
        //+ ' HTTP Port given: ' + (httpConfig? httpConfig.port : null)
        //+ '. HTTPS Port given: ' + (httpsConfig? httpsConfig.port : null));
      //bootstrapLogger.warn('HTTPS requires either a PFX file or Key & Certificate files.');
      //bootstrapLogger.warn('Given PFX: '+ (httpsConfig? httpsConfig.pfx : null));
      //bootstrapLogger.warn('Given Key: '+ (httpsConfig? httpsConfig.keys : null));
      //bootstrapLogger.warn('Given Certificate: '+ (httpsConfig?httpsConfig.certificates : null));
      //if ((typeof wsConfig) == 'object') {
        //bootstrapLogger.warn('config was: '+JSON.stringify(wsConfig, null, 2));
      //} else {
        //bootstrapLogger.warn('config was: '+wsConfig);
      //}
      //bootstrapLogger.warn('All but host server and config file parameters'
          //+ ' should be defined within the config file in'
          //+ ' JSON format');
      throw new Error("ZWED0028E - Config invalid")
    }
    this.webServer.setConfig(wsConfig);
    const httpPort = wsConfig.http ? wsConfig.http.port : undefined;
    const httpsPort = wsConfig.https ? wsConfig.https.port : undefined;
    const cookiePort = httpsPort ? httpsPort : httpPort;
    const webAppOptions = {
      hostname: this.userConfig.node.hostname ? this.userConfig.node.hostname : os.hostname(),
      httpPort: httpPort,
      httpsPort: httpsPort,
      productCode: this.appConfig.productCode,
      productDir: this.userConfig.productDir,
      proxiedHost: this.startUpConfig.proxiedHost,
      proxiedPort: this.startUpConfig.proxiedPort,
      allowInvalidTLSProxy: allowInvalidTLSProxy,
      rootRedirectURL: this.appConfig.rootRedirectURL,
      rootServices: this.appConfig.rootServices,
      serverConfig: this.userConfig,
      configLocation: this.configLocation,
      staticPlugins: {
        list: this.pluginLoader.plugins,
        pluginMap: this.pluginLoader.pluginMap
      },
      newPluginHandler: (pluginDef) => this.newPluginSubmitted(pluginDef),
      auth: WebAuth(this.authManager, cookiePort, cookiePort === httpsPort),
      pluginLoader: this.pluginLoader,
      langManagers: this.langManagers,
      tlsOptions: this.webServer.getTlsOptions()
    };
    if (this.userConfig.node.mediationLayer &&
        this.userConfig.node.mediationLayer.server &&
        !this.userConfig.node.mediationLayer.server.gatewayHostname) {
      this.userConfig.node.mediationLayer.server.gatewayHostname = this.userConfig.node.mediationLayer.server.hostname;
    }   
    let usingApiml = this.userConfig.node.mediationLayer && this.userConfig.node.mediationLayer.enabled;
    if (usingApiml) {
      const apimlConfig = this.userConfig.node.mediationLayer;
      if (firstWorker) {
        let apimlTlsOptions;
        if (apimlConfig.tlsOptions != null) {
          apimlTlsOptions = {};
          WebServer.readTlsOptionsFromConfig(apimlConfig.tlsOptions, apimlTlsOptions); 
        } else {
          apimlTlsOptions = this.webServer.getTlsOptions();
        }
        installLogger.debug('ZWED0033I', JSON.stringify(webAppOptions.httpPort), JSON.stringify(webAppOptions.httpsPort), JSON.stringify(apimlConfig)); //installLogger.info('The http port given to the APIML is: ', webAppOptions.httpPort);
        //installLogger.info('The https port given to the APIML is: ', webAppOptions.httpsPort);
        //installLogger.info('The zlux-apiml config are: ', apimlConfig);
        this.apiml = new ApimlConnector({
          hostName: webAppOptions.hostname,
          httpPort: webAppOptions.httpPort, 
          httpsPort: webAppOptions.httpsPort, 
          apimlHost: apimlConfig.server.hostname,
          apimlPort: apimlConfig.server.port,
          tlsOptions: apimlTlsOptions,
          eurekaOverrides: apimlConfig.eureka
        });
        yield this.apiml.setBestIpFromConfig(webAppOptions.serverConfig.node);
        yield this.apiml.registerMainServerInstance();
      }
      
      if (this.userConfig.agent
         && this.userConfig.agent.mediationLayer
         && this.userConfig.agent.mediationLayer.enabled
         && this.userConfig.agent.mediationLayer.serviceName
         && this.userConfig.node.mediationLayer.server.gatewayPort) {
        //at this point, we expect zss to also be attached to the mediation layer, so lets adjust.
        webAppOptions.proxiedHost = apimlConfig.server.hostname;
        webAppOptions.proxiedPort = this.userConfig.node.mediationLayer.server.gatewayPort;
        if (firstWorker) {
          yield this.apiml.checkAgent(this.userConfig.agent.handshakeTimeout,
                                      this.userConfig.agent.mediationLayer.serviceName);
        }
      } else if (this.userConfig.agent && this.userConfig.agent.mediationLayer) {
        this.userConfig.agent.mediationLayer.enabled = false;
      }
    }
    if (this.userConfig.agent && !usingApiml) {
      if (this.userConfig.agent.mediationLayer && this.userConfig.agent.mediationLayer.enabled) {
        this.userConfig.agent.mediationLayer.enabled = false;
      }
      if (firstWorker &&
          (process.platform !== 'os390') &&
          ((this.startUpConfig.proxiedHost !== undefined) || (this.startUpConfig.proxiedPort !== undefined))){
          /*
            if either proxiedHost or proxiedPort were specified, then there is intent to connect to an agent.
            However, zlux may be run without one, so if both are undefined then don't check for connection.
          */
          yield checkProxiedHost(webAppOptions.proxiedHost,
                                 webAppOptions.proxiedPort,
                                 this.userConfig.agent.handshakeTimeout);
      }
    }
    util.deepFreeze(this.userConfig);
    this.webApp = makeWebApp(webAppOptions);
    yield this.webServer.startListening(this.webApp);
    this.webApp.init();
    let pluginsLoaded = 0;
    let pluginCount = 0;
    let runningInstances = [];
    if (webAppOptions.serverConfig.node.https) {
      for (let ip of webAppOptions.serverConfig.node.https.ipAddresses) {
        runningInstances.push("https://" + ip + ':' + httpsPort)
      }
    }
    if (webAppOptions.serverConfig.node.http) {
      for (let ip of webAppOptions.serverConfig.node.http.ipAddresses) {
        runningInstances.push("http://" + ip + ':' + httpsPort)
      }
    }
    let messageIssued = false;
    this.pluginLoader.setTlsOptions(this.startUpConfig.allowInvalidTLSProxy, this.webServer.getTlsOptions());
    const apimlConfig = this.userConfig.node.mediationLayer;
    if (apimlConfig && !apimlConfig.enabled) {
      this.configureApimlStorage(apimlConfig);
    }
    this.pluginLoader.on('pluginFound', util.asyncEventListener(event => {
      pluginCount++;
      if (event.data.error) {
        if (!process.clusterManager || process.clusterManager.getIndexInCluster() == 0) {
          if (!messageIssued) {
            installLogger.warn(`ZWED0027W`, event.data.identifier, event.data.error.message, 
                               Math.round((pluginsLoaded/event.count)*100), pluginsLoaded, event.count, 
                               Math.round((pluginCount/event.count)*100), pluginCount, event.count);
          } else {
            installLogger.warn(`ZWED0170W`, event.data.identifier, event.data.error.message);
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
              installLogger.info(`ZWED0290I`, event.data.identifier, 
                                 Math.round((pluginsLoaded/event.count)*100), pluginsLoaded, event.count, 
                                 Math.round((pluginCount/event.count)*100), pluginCount, event.count);                  
            } else {
              installLogger.info(`ZWED0292I`, event.data.identifier);
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
              installLogger.warn(`ZWED0170W`, event.data.identifier, err.message);
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
    yield this.pluginLoader.loadPlugins();
    yield this.authManager.loadAuthenticators(this.userConfig, Object.assign({},this.webServer.getTlsOptions()));
    this.authManager.validateAuthPluginList();
    this.processManager.addCleanupFunction(function() {
      this.webServer.close();
    }.bind(this));
    for (let i = 0; i < this.langManagers.length; i++) {
      yield this.langManagers[i].startAll();
    }
  }),
  
  configureApimlStorage(apimlConfig) {
    const { hostname, gatewayPort } = apimlConfig.server;
    // TODO: This is a temporary way to obtain client cert/key,
    // it's going to be fixed as soon get more info
    const clientCertFile = process.env['ZWED_CLIENT_CERT_FILE'];
    const clientKeyFile = process.env['ZWED_CLIENT_KEY_FILE'];
    if (!clientCertFile || !clientKeyFile) {
      return;
    }
    let cert, key;
    try {
      cert = fs.readFileSync(clientCertFile);
      key = fs.readFileSync(clientKeyFile);
    } catch (e) {
      bootstrapLogger.warn(`ZWED0176W`, e.String()) // Failed to load client cert/key pair for APIML (%s)
      return;
    }
    if (key && cert && hostname && gatewayPort) {
      const settings = {
        host: hostname,
        port: gatewayPort,
        tlsOptions: {
          cert: cert,
          key: key,
          rejectUnauthorized: false,
        }
      };
      apimlStorage.configure(settings);
      bootstrapLogger.info(`ZWED0300I`, settings.host, settings.port); // APIML Storage configured, host '%s', port %d
    }
  },

  pluginLoadingFinished(adr, percent, loaded, total) {
    if (!process.clusterManager || process.clusterManager.getIndexInCluster() == 0) {    
      installLogger.info(`ZWED0031I`, adr, percent, loaded, total);
      //Server is ready at ${adr}, Plugins successfully loaded: ${percent}% (${loaded}/${total})`);
    }
    this.pluginLoader.enablePluginScanner(this.userConfig.node.pluginScanIntervalSec);
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

