
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';
import * as BBPromise from 'bluebird';
import * as util from './util';
import * as os from 'node:os';
import * as tls from 'node:tls';
import * as WebServer from './webserver';
import * as PluginLoader from './plugin-loader';
import { makeWebApp } from './webapp';
import * as ProcessManager from './process';
import * as AuthManager from './auth-manager';
import * as WebAuth from './webauth';
import * as unp from './unp-constants';
import * as ApimlConnector from './apiml';
import { checkProxiedHost } from './proxy';
import * as ipaddr from 'ipaddr.js';
import * as apimlStorage from './apimlStorage';
const bootstrapLogger = util.loggers.bootstrapLogger;
const installLogger = util.loggers.installLogger;

function getInternalURL(zoweConfig, port: number): string {
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

function getLangManagers(zoweConfig, port: number): any[] {
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
 

class Server {
  componentConfig;
  zoweConfig;
  configLocation: string;
  port: number;
  langManagers: any[];
  processManager;
  authManager;
  pluginLoader;
  pluginMapRO: Record<string, any>;
  webServer;
  webApp;
  tlsOptions: tls.ConnectionOptions;
  startUpConfig;
  pluginManager;
  
  constructor(zoweConfig, configLocation: string) {
    this.componentConfig = zoweConfig.components['app-server'];
    util.initLoggerMessages(this.componentConfig.logLanguage);
    this.setLogLevels();
    const productCode = util.getProductCode(zoweConfig); 
    unp.setProductCode(productCode);
  
    util.setZoweVersionFromManifest(zoweConfig); 
    
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
    if ((process as any).clusterManager) {
      (process as any).clusterManager.onScanPlugins(function(wi){
        bootstrapLogger.debug('ZWED0293I',wi); //"Handling scan plugin request from worker=%d"
        this.pluginLoader.scanForPlugins();
      }.bind(this));
      (process as any).clusterManager.onAddDynamicPlugin(function(wi, pluginDef) {
        bootstrapLogger.info("ZWED0114I", pluginDef.identifier); //bootstrapLogger.log(bootstrapLogger.INFO, "adding plugin remotely " + pluginDef.identifier);
        this.pluginLoader.addDynamicPlugin(pluginDef);
      }.bind(this));
    }
  }

  setLogLevels() {
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
  }

  spawnChildProcesses() {
    if (this.componentConfig.node.childProcesses) {
      for (const proc of this.componentConfig.node.childProcesses) {
        if (!(process as any).clusterManager || (process as any).clusterManager.getIndexInCluster() == 0 || !proc.once) {
          try {
            this.processManager.spawn(proc); 
          } catch (error) {
            bootstrapLogger.warn(`ZWED0020W`, JSON.stringify(proc), error.message); //bootstrapLogger.warn(`Could not spawn ${JSON.stringify(proc)}: ${error.message}`);
          }  
        } else {
          bootstrapLogger.info("ZWED0115I", (process as any).clusterManager.getIndexInCluster(), proc.path); //bootstrapLogger.log(bootstrapLogger.INFO, `Skip child process spawning on worker ${(process as any).clusterManager.getIndexInCluster()} ${proc.path}\n`);
        }
      }
    }
  }
  
  start = BBPromise.coroutine(function*() {    
    const firstWorker = !((process as any).clusterManager && (process as any).clusterManager.getIndexInCluster() != 0);
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
    
    const webAppOptions: any = {
      //networking
      hostname: this.componentConfig.node.hostname,
      port: this.port,
      isHttps: util.isServerHttps(this.zoweConfig),
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
    Object.assign(apimlConfig.server, {
      catalogPort: process.env['ZWE_components_api_catalog_port']
    })
    if (apimlConfig.enabled) {
      if (firstWorker) {
        installLogger.debug('ZWED0033I', this.port, JSON.stringify(apimlConfig));
        this.apiml = new ApimlConnector({
          hostName: webAppOptions.hostname,
          port: this.port,
          discoveryUrls: apimlConfig.server.discoveryUrls || [`https://${apimlConfig.server.hostname}:${apimlConfig.server.port}/eureka/`],
          gatewayPort: apimlConfig.server.gatewayPort,
          catalogPort: apimlConfig.server.catalogPort,
          tlsOptions: this.tlsOptions,
          traceTls: apimlConfig.traceTls,
          eurekaOverrides: apimlConfig.eureka,
          isClientAttls: util.isClientAttls(this.zoweConfig)
        });
        yield this.apiml.setBestIpFromConfig(this.componentConfig.node);
        yield this.apiml.registerMainServerInstance();

        webAppOptions.gatewayRedirect = `${this.componentConfig.node.mediationLayer.server.isHttps === false ? 'http' : 'https' }://`
          +`${this.componentConfig.node.mediationLayer.server.gatewayHostname}:${this.componentConfig.node.mediationLayer.server.gatewayPort}`
          +`${util.getPrefixForService('zlux', 'ui', '1')}`;
      }
      
      if (this.componentConfig.agent?.mediationLayer?.enabled
         && this.componentConfig.agent.mediationLayer.serviceName
         && this.componentConfig.node.mediationLayer.server?.gatewayPort) {
        //at this point, we expect zss to also be attached to the mediation layer, so lets adjust.
        webAppOptions.proxiedHost = apimlConfig.server.gatewayHostname;
        webAppOptions.proxiedPort = this.componentConfig.node.mediationLayer.server.gatewayPort;
        if (firstWorker) {
          yield this.apiml.checkAgent(this.componentConfig.agent.handshakeTimeout,
                                      this.componentConfig.agent.mediationLayer.serviceName);
        }
      }
    } else if (this.componentConfig.agent) {
      if (firstWorker &&
          ((process.platform as any) !== 'os390') &&
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
      this.configureApimlStorage(apimlConfig, util.isClientAttls(this.zoweConfig));
    }

    const plugins = yield this.loadPlugins();
    yield this.authManager.loadAuthenticators(this.zoweConfig, Object.assign({},this.tlsOptions), plugins);
    this.authManager.validateAuthPluginList();

    this.processManager.addCleanupFunction(function() {
      this.webServer.close();
    }.bind(this));

    for (let i = 0; i < this.langManagers.length; i++) {
      yield this.langManagers[i].startAll();
    }
  })

  loadPlugins = BBPromise.coroutine(function*() {
    let pluginsLoaded = 0;
    let pluginCount = 0;
    let messageIssued = false;
    const homepage = this.componentConfig.node.mediationLayer.enabled
          ? util.getGatewayUrlForService(this.zoweConfig, true, 'zlux', 'ui', 1)+'/'
          : `${util.isServerHttps(this.zoweConfig)?'https://':'http://'}${util.getBestHostname(this.zoweConfig)}:${this.port}/`;

    this.pluginLoader.on('pluginFound', util.asyncEventListener(event => {
      pluginCount++;

      const percentComplete = `${Math.round((pluginCount/event.count)*100)}% (${pluginCount}/${event.count})`;
      let percentLoaded = `${Math.round((pluginsLoaded/event.count)*100)}% (${pluginsLoaded}/${event.count})`;
      const primaryProcess = !(process as any).clusterManager || (process as any).clusterManager.getIndexInCluster() == 0;
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
        if (primaryProcess) {
          installLogger.warn(!messageIssued?`ZWED0027W`:`ZWED0170W`, event.data.identifier, event.data.pluginVersion, event.data.error.message, percentLoaded, percentComplete);
        }
        handleIfComplete(this);
      } else {
        return this.pluginLoaded(event.data).then(() => {
          pluginsLoaded++;
          percentLoaded = `${Math.round((pluginsLoaded/event.count)*100)}% (${pluginsLoaded}/${event.count})`;
          if (primaryProcess) {
            installLogger.info(!messageIssued?`ZWED0290I`:`ZWED0292I`, event.data.identifier, event.data.pluginVersion, percentLoaded, percentComplete);
          }
          handleIfComplete(this);
        }, err => {
          if (primaryProcess) {
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
    return yield this.pluginLoader.loadPlugins();
  })
  
  configureApimlStorage(apimlConfig, isHttps: boolean) {
    apimlStorage.configure({
      host: apimlConfig.server.gatewayHostname,
      port: apimlConfig.server.gatewayPort,
      tlsOptions: this.tlsOptions,
      isHttps: isHttps
    });
    bootstrapLogger.info(`ZWED0300I`); // Caching Service configured
  }

  pluginLoadingFinished(adr: string, percent, loaded: number, total: number) {
    if ((process as any).clusterManager && (process as any).clusterManager.getIndexInCluster() != 0) {
      this.restoreWorkerLogging();
    } else {
      installLogger.info(`ZWED0031I`, adr, percent, loaded, total);
      //Server is ready at ${adr}, Plugins successfully loaded: ${percent}% (${loaded}/${total})`);
    }
    this.pluginLoader.enablePluginScanner(this.componentConfig.node.pluginScanIntervalSec);
  }

  suppressDuplicateLogging() {
    global.COM_RS_COMMON_LOGGER.setLogLevelForComponentPattern("_zsf\..*",1);
  }

  restoreWorkerLogging() {
    global.COM_RS_COMMON_LOGGER.setLogLevelForComponentPattern("_zsf\..*",2);
    if (this.componentConfig.logLevels) {
      let keys = Object.keys(this.componentConfig.logLevels);
      keys.forEach((key)=> {
        global.COM_RS_COMMON_LOGGER.setLogLevelForComponentName(key, this.componentConfig.logLevels[key]);
      });
    }
  }

  newPluginSubmitted(pluginDef) {
    installLogger.debug("ZWED0162I", pluginDef); //installLogger.debug("Adding plugin ", pluginDef);
    this.pluginLoader.addDynamicPlugin(pluginDef);
    if ((process as any).clusterManager) {
      (process as any).clusterManager.addDynamicPlugin(pluginDef);
    }
  }

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

export = Server;


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

