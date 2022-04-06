
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';
const util = require('util');
const Promise = require('bluebird');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const os = require('os');
const assert = require('assert');
const requireFromString = require('require-from-string');
const EventEmitter = require('events');
const semver = require('semver');
const zluxUtil = require('./util');
const jsonUtils = require('./jsonUtils.js');
const configService = require('../plugins/config/lib/configService.js');
const DependencyGraph = require('./depgraph');
const translationUtils = require('./translation-utils.js');
const makeSwaggerCatalog = require('./swagger-catalog');

/**
 * Plugin loader: reads the entire plugin configuration tree
 * 
 *  - resolves plugin refs
 *  - reads plugin definition files
 *  - loads any supplemental modules required by plugins
 *  - performs some validation 
 * 
 */
const bootstrapLogger = zluxUtil.loggers.bootstrapLogger;

const defaultOptions = {
  productCode: null,
  authManager: null,
  pluginsDir: null,
  serverConfig: null,
  relativePathResolver: zluxUtil.normalizePath
}

/* Describes what components there are and what to check for in them */
const APP_SERVER_COMP_ID = 'app-server';
    
const AGENT_COMP_ID = 'zss';

const APIML_GATEWAY_COMP_ID = 'gateway';

const compsToCheck = {
  [APP_SERVER_COMP_ID]: {
    name: "App server",
    id: APP_SERVER_COMP_ID, // ES5 means we cannot use object names as string literals, so we need id
    
    // Things to check
    os: true,
    cpu: true,
    version: false, // Not implemented
    endpoints: false // Not implemented
  },
  [AGENT_COMP_ID]: {
    name: "Agent", 
    id: AGENT_COMP_ID,
    
    os: true,
    cpu: true,
    version: true,
    endpoints: true
  },
  [APIML_GATEWAY_COMP_ID]: {
    name: "Gateway", 
    id: APIML_GATEWAY_COMP_ID,
    
    os: true,
    cpu: false,
    version: true,
    endpoints: false
  }
};

/* Stores environment information received for the components */
let envComps = {};
let zluxHosts = {};

function Service(def, configuration, plugin) {
  this.configuration = configuration;
  //don't do this here: avoid circular structures:
  //this.plugin = plugin; 
  Object.assign(this, def);
}
Service.prototype = {
  constructor: Service,
  
  validate() {
    if (!semver.valid(this.version)) {
      throw new Error(`ZWED0007E - ${this.name}: invalid version "${this.version}"`)
    }
    if (this.versionRequirements) {
      for (let serviceName of Object.keys(this.versionRequirements)) {
        if (!semver.validRange(this.versionRequirements[serviceName])) {
          throw new Error(`ZWED0008E - ${this.localName}: invalid version range ` +
              `${serviceName}: ${this.versionRequirements[serviceName]}`)
        }
      }
    }
  }
}

function Import(def, configuration, plugin) {
  Service.call(this, def, configuration, plugin);
}
Import.prototype = {
  constructor: Import,
  __proto__:  Service.prototype,
  
  validate() {
    if (!semver.validRange(this.versionRange)) {
      throw new Error(`ZWED0009E - ${this.localName}: invalid version range "${this.versionRange}"`)
    }
  }
}

function NodeService(def, configuration, plugin) {
  Service.call(this, def, configuration, plugin);
}
NodeService.prototype = {
  constructor: NodeService,
  __proto__:  Service.prototype,
  
  loadImplementation(dynamicallyCreated, location) {
    if (dynamicallyCreated) {
      const nodeModule = requireFromString(this.source);
      this.nodeModule = nodeModule;
    } else {
      // Quick fix before MVD-947 is merged
      var fileLocation = ""
      var serverModuleLocation = ""
      var clientModuleLocation = ""
      if (this.filename) {
        fileLocation = path.join(location, 'lib', this.filename);
	
      } else if (this.fileName) {
        fileLocation = path.join(location, 'lib', this.fileName);
      } else {
        throw new Error(`ZWED0010E - No file name for data service`)
      
      }
      
      serverModuleLocation = path.join(location, 'nodeServer', 'node_modules' );
      clientModuleLocation = path.join(location, 'lib', 'node_modules');

      var nodePathStore = process.env.NODE_PATH;
      var nodePathAdd = process.env.NODE_PATH;
      var operatingSystem = process.platform;
      var osDelim = operatingSystem === "win32" ? ";" : ":"; 

      bootstrapLogger.debug("ZWED0116I", serverModuleLocation, clientModuleLocation); //bootstrapLogger.log(bootstrapLogger.INFO,
        //`The LOCATIONS are ${serverModuleLocation} and ${clientModuleLocation}`);
      nodePathAdd = `${process.env.NODE_PATH}${serverModuleLocation}${osDelim}${clientModuleLocation}${osDelim}.`
      process.env.NODE_PATH = nodePathAdd;
      require("module").Module._initPaths();    
      bootstrapLogger.debug("ZWED0117I", fileLocation); //bootstrapLogger.log(bootstrapLogger.INFO, `The fileLocation is ${fileLocation}`);

      bootstrapLogger.debug("ZWED0118I", process.env.NODE_PATH); //bootstrapLogger.log(bootstrapLogger.INFO,
        //`The NODE_PATH is ${process.env.NODE_PATH}`);

      const nodeModule = require(fileLocation);
      this.nodeModule = nodeModule;
      process.env.NODE_PATH = nodePathStore;
      require("module").Module._initPaths(); 
    }
  }
}

//first checks if the parent plugin has a host and port 
//and if not, looks them up in the config
function ExternalService(def, configuration, plugin) {
  Service.call(this, def, configuration, plugin);
  if (!this.host) {
    this.host = plugin.host;
  }
  if (!this.port) {
    this.port = plugin.port;
  }
  const remoteConfig = configuration.getContents(["remote.json"]);
  if (remoteConfig) {
    if (!this.host) {
      this.host = remoteConfig.host;
    }
    if (!this.port) {
      this.port = remoteConfig.port;
    }
  }

  if(this.host == 'agent') {
    this.host = zluxHosts.agentHost;
    this.port = zluxHosts.agentPort;
    this.isHttps = zluxHosts.isAgentHttps;
  }

  if(this.host == 'zlux') {
    this.host = zluxHosts.hostname;
    this.port = zluxHosts.httpsPort;
    this.isHttps = true;
  }
}
ExternalService.prototype = {
  constructor: ExternalService,
  __proto__:  Service.prototype
}

function makeDataService(def, plugin, context) {
  const configuration = configService.getServiceConfiguration(plugin.identifier, plugin.location,
      def.name, context.config, context.productCode);
  let dataservice;
  if (def.type == "external") {
    dataservice = new ExternalService(def, configuration, plugin);
  } else if (def.type == "import") {
    dataservice = new Import(def, configuration, plugin);
  } else if ((def.type == 'nodeService')
        || (def.type === 'router')) {
    dataservice = new NodeService(def, configuration, plugin);
  } else {
    dataservice = new Service(def, configuration, plugin);
  }
  dataservice.validate();
  return dataservice;
}

function Plugin(def, configuration) {
  Object.assign(this, def);
  this.definition = Object.assign({},def);
  delete this.definition.location;
  delete this.definition.nodeModule;
  this.configuration = configuration;
  if (!this.location) {
    this.location = process.cwd();
  }
  this.translationMaps = {};
}
Plugin.prototype = {
  constructor: Plugin,
  identifier: null,
  apiVersion: null,
  pluginVersion: null,
  pluginType: null,
  webContent: null,
  copyright:null,
  location: null,
  dataServices: null,
  dataServicesGrouped: null,
  configuration: null,
  //...
  
  toString() {
    return `[Plugin ${this.identifier}]`
  },
  
  isValid() {
    //TODO detailed diagnostics
    return this.identifier && (typeof this.identifier === "string")
      && this.pluginVersion && (typeof this.pluginVersion === "string")
      && this.apiVersion && (typeof this.apiVersion === "string")
      //this might cause some pain, but I guess it's better to
      //leave it here and make everyone tidy up their plugin defs:
      && this.pluginType && (typeof this.pluginType === "string")
      ;
  },
  
  init(context) {
    //Nothing here anymore: startup checks for validity will be superceeded by 
    //https://github.com/zowe/zlux-server-framework/pull/18 and initialization 
    //concept has not manifested for many plugin types, so a warning is not needed.
  },
  
  exportDef() {
    return this.definition;
  },

  exportTranslatedDef(acceptLanguage) {
    const def = this.exportDef();
    if (typeof this.webContent === 'object') {
      return translationUtils.translate(def, this.translationMaps, acceptLanguage);
    }
    return def;
  },

  loadTranslations() {
    if (typeof this.webContent === 'object') {
      this.translationMaps = translationUtils.loadTranslations(this.location);
    }
  },
  
  verifyStaticWebContent() {
    if (this.webContent) {
      let contentPath = path.join(this.location, "web");
      if (!fs.existsSync(contentPath)) {
        throw new Error(`ZWED0011E - Plugin ${this.identifier} has web content but `
            + `no web directory under ${this.location}`); 
      } else {
        bootstrapLogger.info(`ZWED0036I`, this.identifier, contentPath); //bootstrapLogger.info(`plugin ${this.identifier} ` + `will serve static files from ${contentPath}`);
      }
    }
  },
  
  initDataServices(context, langManagers) {
    function addService(service, name, container) {
      let group = container[name];
      if (!group) {
        group = container[name] = {
          name,
          highestVersion: null,
          versions: {},
        };
      }
      if (!group.highestVersion 
          || semver.gt(service.version, group.highestVersion)) {
        group.highestVersion = service.version;
      }
      group.versions[service.version] = service;
    }
    
    if (!this.dataServices) {
      return;
    }
    this.dataServicesGrouped = {};
    this.importsGrouped = {};
    const filteredDataServices = [];
    for (const dataServiceDef of this.dataServices) {
      const dataservice = makeDataService(dataServiceDef, this, context);
      if (dataservice.type == "service") {          
        addService(dataservice, dataservice.name, this.dataServicesGrouped);
        bootstrapLogger.info(`ZWED0037I`, this.identifier, dataservice.name); //bootstrapLogger.info(`${this.identifier}: ` + `found proxied service '${dataservice.name}'`);
        filteredDataServices.push(dataservice);
      } else   if (dataservice.type === 'import') {
        bootstrapLogger.info(`ZWED0038I`, this.identifier, dataservice.sourceName, dataservice.sourcePlugin, dataservice.localName); //bootstrapLogger.info(`${this.identifier}:` + ` importing service '${dataservice.sourceName}'` + ` from ${dataservice.sourcePlugin}` + ` as '${dataservice.localName}'`);
        addService(dataservice, dataservice.localName, this.importsGrouped);
        filteredDataServices.push(dataservice);
      } else if ((dataservice.type == 'nodeService')
          || (dataservice.type === 'router')) {
        //TODO what is this? Why do we need it?
//        if ((dataservice.serviceLookupMethod == 'internal')
//            || !dataservice.dependenciesIncluded) {
//          bootstrapLogger.warn(`${this.identifier}:`
//              + ` loading dataservice ${dataservice.name} failed, declaration invalid`);
//          continue;
//        }
        dataservice.loadImplementation(this.dynamicallyCreated, this.location);
        if (dataservice.type === 'router') {
          bootstrapLogger.info(`ZWED0039I`, this.identifier, dataservice.name); //bootstrapLogger.info(`${this.identifier}: ` + `found router '${dataservice.name}'`);
          addService(dataservice, dataservice.name, this.dataServicesGrouped);
        } else {
          bootstrapLogger.info(`ZWED0040I`, this.identifier, dataservice.name); //bootstrapLogger.info(`${this.identifier}: ` + `found legacy node service '${dataservice.name}'`);
          addService(dataservice, dataservice.name, this.dataServicesGrouped);
        }
        filteredDataServices.push(dataservice);
      } else if (dataservice.type == 'external') {
        addService(dataservice, dataservice.name, this.dataServicesGrouped);
        bootstrapLogger.info(`ZWED0041I`, this.identifier, dataservice.name); //bootstrapLogger.info(`${this.identifier}: ` + `found external service '${dataservice.name}'`);
        filteredDataServices.push(dataservice);
      } else {
        addService(dataservice, dataservice.name, this.dataServicesGrouped);
        bootstrapLogger.info(`ZWED0042I`, this.identifier, dataservice.type, dataservice.name); //bootstrapLogger.info(`${this.identifier}: ` + `found ${dataservice.type} service '${dataservice.name}'`);
        filteredDataServices.push(dataservice);            
        /*
          maybe a lang manager knows how to handle this...
          don't error out here if no valid lang manager. webapp.js will do the check later.
        */
      }
    }
    this.dataServices = filteredDataServices;
    this._validateLocalVersionRequirements()
  },
  
  _validateLocalVersionRequirements() {
    for (let service of this.dataServices) {
      if (!service.versionRequirements) {
        continue;
      }
      for (let serviceName of Object.keys(service.versionRequirements)) {
        const allVersions = this.dataServicesGrouped[serviceName] 
            || this.importsGrouped[serviceName];
        if (!allVersions) {
          throw new Error(`ZWED0012E - ${this.identifier}::${service.name} `
              + "Required local service missing: " + serviceName)
        }
        const requiredVersion = service.versionRequirements[serviceName];
        let found = null;
        for (let availableVersion of Object.keys(allVersions.versions)) {
          if (semver.satisfies(availableVersion, requiredVersion)) {
            found = availableVersion;
            break;
          }
        }
        if (!found) {
          throw new Error(`ZWED0013E - ${this.identifier}::${service.name} `
              + `Could not find a version to satisfy local dependency `
              + `${serviceName}@${requiredVersion}`)
        } else {
          bootstrapLogger.debug(`ZWED0163I`, this.identifier, service.name, `${serviceName}@${found}`); //bootstrapLogger.debug(`${this.identifier}::${service.name}: found `
              //+ `${serviceName}@${found}`)
          //replace the mask in the def with an actual version to make the life 
          // simpler
          service.versionRequirements[serviceName] = found;
        }
      }
    }
  },
  
  getApiCatalog(productCode, nodeContext) {
    return makeSwaggerCatalog(this, productCode, nodeContext);
  }
  
};

function LibraryPlugIn(def, configuration) {
  Plugin.call(this, def, configuration);
}
LibraryPlugIn.prototype = {
  __proto__: Plugin.prototype,
  constructor: LibraryPlugIn,
  
  init(context) {
    assert(this.pluginType === "library");
    if (!fs.existsSync(this.location)) {
      bootstrapLogger.warn("ZWED0150W", def.identifier, this.location); //bootstrapLogger.log(bootstrapLogger.WARNING,
        //`${def.identifier}: library path ${this.location} does not exist`);
      return;
    }
    bootstrapLogger.info("ZWED0119I", this.identifier, this.location); //bootstrapLogger.log(bootstrapLogger.INFO,
      //`Plugin ${this.identifier} will serve library data from directory ${this.location}`);
  }
};

function ApplicationPlugIn(def, configuration) {
  Plugin.call(this, def, configuration);
}
ApplicationPlugIn.prototype = {
  __proto__: Plugin.prototype,
  constructor: ApplicationPlugIn,
};

function WindowManagerPlugIn(def, configuration) {
  Plugin.call(this, def, configuration);
}
WindowManagerPlugIn.prototype = {
  constructor: WindowManagerPlugIn,
  __proto__: Plugin.prototype,
};

function BootstrapPlugIn(def, configuration) {
  Plugin.call(this, def, configuration);
}
BootstrapPlugIn.prototype = {
  constructor: BootstrapPlugIn,
  __proto__: Plugin.prototype,
};

function DesktopPlugIn(def, configuration) {
  Plugin.call(this, def, configuration);
}
DesktopPlugIn.prototype = {
  constructor: DesktopPlugIn,
  __proto__: Plugin.prototype,
};

function NodeAuthenticationPlugIn(def, configuration) {
  Plugin.call(this, def, configuration);
}
NodeAuthenticationPlugIn.prototype = {
  constructor: NodeAuthenticationPlugIn,
  __proto__: Plugin.prototype,
  authenticationCategory: null,
  filename: null,
  
  isValid(context) {
    if (!(super.isValid(context) && this.filename 
          && (this.authenticationCategory || this.authenticationCategories))) {
      return false;
    }
    //we should not load authentication types that are 
    //not requested by the administrator
    if (!context.authManager.authPluginRequested(this.identifier,
      this.authenticationCategory)) {
        bootstrapLogger.warn("ZWED0029W"); //bootstrapLogger.warn("Authentication plugin was found which was not requested in "
          //+ "the server configuration file's dataserviceAuthentication object. "
          //+ "Skipping load of this plugin");
      return false;
    }
    return true;
  },
  
  exportDef() {
    return Object.assign({}, super.exportDef(), {
      filename: this.filename,
      authenticationCategory: this.authenticationCategory
    });
  },
  
  init(context) {
    let filepath = path.join(this.location, 'lib', this.filename);
    // Make the relative path clear. process.cwd() is zlux-app-server/bin/
    if (!path.isAbsolute(filepath)) {
      filepath = path.join(process.cwd(),filepath);
    }
    bootstrapLogger.info("ZWED0120I", this.identifier, filepath); //bootstrapLogger.log(bootstrapLogger.INFO,
      //`Auth plugin ${this.identifier}: loading auth handler module ${filepath}`)
    this.authenticationModule = require(filepath);
    context.authManager.registerAuthenticator(this);
  }
};

function ProxyConnectorPlugIn(def, configuration) {
  Plugin.call(this, def, configuration);
  const remoteConfig = configuration.getContents(["remote.json"]);
  if (remoteConfig) {
    if (!this.host) {
      this.host = remoteConfig.host;
    }
    if (!this.port) {
      this.host = remoteConfig.port;
    }
  }
}
ProxyConnectorPlugIn.prototype = {
  constructor: ProxyConnectorPlugIn,
  __proto__: Plugin.prototype,
  
  isValid(context) {
    if (!(super.isValid(context) && this.host && this.port)) {
      return false;
    }
//    //we should not load authentication types that are 
//    //not requested by the administrator
//    if (!context.authManager.authPluginRequested(this.identifier,
//      this.authenticationCategory)) {
//      bootstrapLogger.warn("Authentication plugin was found which was not requested in "
//          + "the server configuration file's dataserviceAuthentication object. "
//          + "Skipping load of this plugin");
//      return false;
//    }
    return true;
  },
};

const plugInConstructorsByType = {
  "library": LibraryPlugIn,
  "application": ApplicationPlugIn,
  "windowManager": WindowManagerPlugIn,
  "bootstrap": BootstrapPlugIn,
  "desktop": DesktopPlugIn,
  "nodeAuthentication": NodeAuthenticationPlugIn,
  "proxyConnector": ProxyConnectorPlugIn
};

function makePlugin(def, pluginConfiguration, pluginContext, dynamicallyCreated, langManagers) {
  const pluginConstr = plugInConstructorsByType[def.pluginType];
  if (!pluginConstr) {
    throw new Error(`ZWED0020E - ${def.identifier}: pluginType ${def.pluginType} is unknown`); 
  }
  // one can think in terms of Java: `def` is a JSON-serialized instance of the
  // "class" referred to by `proto`. Create an instance and inject the
  // de-serialized instance data there.
  // (We don't need an extra indirection level, e.g. self.definition = def)
  const self = new pluginConstr(def, pluginConfiguration);
  self.dynamicallyCreated = dynamicallyCreated;
  if (!self.isValid(pluginContext)) {
    if (def.pluginType == 'nodeAuthentication' && !pluginContext.authManager.authPluginRequested(self.identifier,
      self.authenticationCategory)) {
        bootstrapLogger.info(`ZWED0043I`, self.identifier); //bootstrapLogger.info(`Plugin ${self.identifier} is not requested skipping without error`);
      return null;
    } else {
      bootstrapLogger.warn(`ZWED0030W`, def.location); //bootstrapLogger.warn(`${def.location} points to an`
        //+ " invalid plugin definition, skipping");
      throw new Error(`ZWED0014E - Plugin ${def.identifier} invalid`);
    }
  }
  self.initDataServices(pluginContext, langManagers);
  if (!dynamicallyCreated) {
    self.verifyStaticWebContent();
  }
  self.init(pluginContext);
  self.loadTranslations();
  return self;
};

function PluginLoader(options) {
  EventEmitter.call(this);
  this.options = zluxUtil.makeOptionsObject(defaultOptions, options);
  this.plugins = [];
  this.pluginMap = {};
  this.tlsOptions = null;
};
PluginLoader.prototype = {
  constructor: PluginLoader,
  __proto__: EventEmitter.prototype,
  options: null,
  plugins: null,
  pluginMap: null,

  _readPluginDef(pluginDescriptorFilename) {
    const pluginPtrPath = this.options.relativePathResolver(pluginDescriptorFilename,
                                                 this.options.pluginsDir);
    bootstrapLogger.debug(`ZWED0044I`, pluginPtrPath); //bootstrapLogger.info(`Processing plugin reference ${pluginPtrPath}...`);
    if (!fs.existsSync(pluginPtrPath)) {
      throw new Error(`ZWED0021E - ${pluginPtrPath} is missing`);
    }
    const pluginPtrDef = jsonUtils.parseJSONWithComments(pluginPtrPath);
    bootstrapLogger.debug("ZWED0121I", util.inspect(pluginPtrDef)); //bootstrapLogger.log(bootstrapLogger.FINER, util.inspect(pluginPtrDef));
    let pluginBasePath = pluginPtrDef.pluginLocation;
    if (!path.isAbsolute(pluginBasePath)) {
      let relativeTo = process.cwd();
      if (typeof pluginPtrDef.relativeTo == 'string') {
        if (pluginPtrDef.relativeTo.startsWith('$')) {
          const envVar = process.env[pluginPtrDef.relativeTo.substr(1)];
          if (envVar) {
            relativeTo = envVar;
          } else {
            return {location: pluginBasePath,
                    identifier: pluginPtrDef.identifier,
                    error: new Error(`ZWED0151E - Env var ${pluginPtrDef.relativeTo} not found`)};
          }
        } else {
          relativeTo = pluginPtrDef.relativeTo;
        }
      }
      pluginBasePath = this.options.relativePathResolver(pluginBasePath, relativeTo);
    }
    if (!fs.existsSync(pluginBasePath)) {
      return {location: pluginBasePath,
              identifier: pluginPtrDef.identifier,
              error: new Error(`ZWED0015E - No plugin directory found at ${pluginPtrDef.pluginLocation}`)};
     }
    let pluginDefPath = path.join(pluginBasePath, 'pluginDefinition.json');
    if (!fs.existsSync(pluginDefPath)) {
      return {location: pluginBasePath,
              identifier: pluginPtrDef.identifier,
              error: new Error(`ZWED0016E - No pluginDefinition.json found at ${pluginBasePath}`)};
    }
    let pluginDef = jsonUtils.parseJSONWithComments(pluginDefPath);
    bootstrapLogger.debug("ZWED0122I", util.inspect(pluginDef)); //bootstrapLogger.log(bootstrapLogger.FINER,util.inspect(pluginDef));
    if (pluginDef.identifier !== pluginPtrDef.identifier) {
      return {location: pluginBasePath,
              identifier: pluginPtrDef.identifier,
              error: new Error(`ZWED0017E - Identifier doesn't match one found in pluginDefinition: ${pluginDef.identifier}`)};
    }
    if (!pluginDef.pluginType) {
      return {location: pluginBasePath,
              identifier: pluginPtrDef.identifier,
              error: new Error(`ZWED0018E - No plugin type found, skipping`)};
    }
    bootstrapLogger.info(`ZWED0214I`, pluginBasePath, pluginDef.identifier, pluginDef.pluginType); //bootstrapLogger.info(`Read ${pluginBasePath}: found plugin id = ${pluginDef.identifier}, `
        //+ `type = ${pluginDef.pluginType}`);
    pluginDef.location = pluginBasePath;
    return pluginDef;
  },

  _readPluginDefAsync(pluginDescriptorFilename) {
    return new Promise((resolve, reject)=> {
      const pluginPtrPath = this.options.relativePathResolver(pluginDescriptorFilename,
                                                              this.options.pluginsDir);
      bootstrapLogger.info(`Processing plugin reference ${pluginPtrPath}...`);
      jsonUtils.readJSONFileWithCommentsAsync(pluginPtrPath).then((pluginPtrDef)=> {
        bootstrapLogger.log(bootstrapLogger.FINER, util.inspect(pluginPtrDef));
        let pluginBasePath = pluginPtrDef.pluginLocation;
        if (!path.isAbsolute(pluginBasePath)) {
          let relativeTo = process.cwd();
          if (typeof pluginPtrDef.relativeTo == 'string') {
            if (pluginPtrDef.relativeTo.startsWith('$')) {
              const envVar = process.env[pluginPtrDef.relativeTo.substr(1)];
              if (envVar) {
                relativeTo = envVar;
              } else {
                return {location: pluginBasePath,
                        identifier: pluginPtrDef.identifier,
                        error: new Error(`ZWED0151E - Env var ${pluginPtrDef.relativeTo} not found`)};
              }
            } else {
              relativeTo = pluginPtrDef.relativeTo;
            }
          }
          pluginBasePath = this.options.relativePathResolver(pluginBasePath, relativeTo);
        }
        let pluginDefPath = path.join(pluginBasePath, 'pluginDefinition.json');
        jsonUtils.readJSONFileWithCommentsAsync(pluginDefPath).then(function(pluginDef){
          bootstrapLogger.log(bootstrapLogger.FINER,util.inspect(pluginDef));
          if (pluginDef.identifier !== pluginPtrDef.identifier) {
            return reject({location: pluginBasePath,
                     identifier: pluginPtrDef.identifier,
                     error: new Error(`Identifier doesn't match one found in pluginDefinition: ${pluginDef.identifier}`)});
          }
          if (!pluginDef.pluginType) {
            return reject({location: pluginBasePath,
                           identifier: pluginPtrDef.identifier,
                           error: new Error(`No plugin type found, skipping`)});
          }
          bootstrapLogger.info(`Read ${pluginBasePath}: found plugin id = ${pluginDef.identifier}, `
                               + `type = ${pluginDef.pluginType}`);
          pluginDef.location = pluginBasePath;
          resolve(pluginDef);
        }).catch((e)=> {
        reject({location: pluginBasePath,
                identifier: pluginPtrDef.identifier,
                error: e});
        });
      }).catch((e)=> {
        reject({error: e});
      });
    });
  },
  
  readPluginDefs() {
    const defs = [];
    bootstrapLogger.info(`ZWED0045I`, this.options.pluginsDir); //bootstrapLogger.log(bootstrapLogger.INFO, `Reading plugins dir ${this.options.pluginsDir}`);
    const pluginLocationJSONs = fs.readdirSync(this.options.pluginsDir)
      .filter(function(value){
        return value.match(/.*\.json/);
      });
      bootstrapLogger.debug("ZWED0123I", util.inspect(pluginLocationJSONs)); //bootstrapLogger.log(bootstrapLogger.FINER, util.inspect(pluginLocationJSONs));
    for (const pluginDescriptorFilename of pluginLocationJSONs) {
      try {
        const plugin = this._readPluginDef(pluginDescriptorFilename);
        defs.push(plugin);
      } catch (e) {
        bootstrapLogger.warn("ZWED0031W", e) //bootstrapLogger.warn(e)
        bootstrapLogger.warn("ZWED0032W", pluginDescriptorFilename); //bootstrapLogger.warn(bootstrapLogger.INFO,
          //`Failed to load ${pluginDescriptorFilename}\n`);
      }
    }

    //move server swagger plugin to very end
    //defs.push(defs.splice(defs.findIndex(elm => elm == zluxUtil.serverSwaggerPluginId),1)[0]);
    return defs;
  },

  readNewPluginDefs() {
    const defs = [];
    bootstrapLogger.debug(`Scanning for new plugins in ${this.options.pluginsDir}`);
    return new Promise((resolve, reject)=> {
      fs.readdir(this.options.pluginsDir, (err, results)=> {
        if (!err) {
          const pluginLocationJSONs = results.filter((value)=>{
            if (value.endsWith('.json')) {
              return !this.pluginMap[value.substr(0,value.length-5)];
            } else {
              return false;
            }
          });
          let counter = 0;
          if (pluginLocationJSONs.length === 0) {
            return resolve(pluginLocationJSONs);
          }
          for (const pluginDescriptorFilename of pluginLocationJSONs) {
            const plugin = this._readPluginDefAsync(pluginDescriptorFilename).then((plugin)=> {
              defs.push(plugin);
              counter++;
              if (counter == pluginLocationJSONs.length) {
                resolve(defs);
              }
            }).catch(function(e) {
              counter++;
              bootstrapLogger.log(bootstrapLogger.INFO,
                                  `Failed to load ${pluginDescriptorFilename}\n`);
              bootstrapLogger.warn(e)
              if (counter == pluginLocationJSONs.length) {
                resolve(defs);
              }
            });
          }
        } else {
          bootstrapLogger.warn('Could not read plugins dir, e=',err);
        }
      });
    });
  },
  
  loadPlugins: Promise.coroutine(function*(hosts) {
    zluxHosts = hosts;
    const defs = this.readPluginDefs();
    yield this.installPlugins(defs);
  }),

  scanForPlugins() {
    this.readNewPluginDefs().then((defs)=> {
      this.installPlugins(defs);
    });
  },

  enablePluginScanner(intervalSec) {
    if (intervalSec >= 1) {
      this.intervalScanner = setInterval(()=> {
        this.scanForPlugins();
      },intervalSec*1000);
    }
  },
  
  installPlugins: Promise.coroutine(function*(pluginDefs) {
    const pluginContext = {
      productCode: this.options.productCode,
      config: this.options.serverConfig,
      authManager: this.options.authManager
    };
    let newPlugins = [];
    let successCount = 0;
    const depgraph = new DependencyGraph(this.plugins);
    if (Object.keys(envComps).length === 0) {
      yield this.getComponentCapabilities(pluginContext.config); // Gets the environment and server information
    }
      for (const pluginDef of pluginDefs) {
        if (pluginDef.error) {
          //downstream will pick up error
          newPlugins.push(pluginDef);
        } else {
          /* This intetional sloppy second check is meant such that, if a plugin has an error prior to the plugin installation process, 
          we want that error to be caught down stream. If it proceeds, and catches another error from unsatisfied requirements, the original
          error would get overwritten */
          this.checkPluginRequirements(pluginDef); // Checks that the environment and server satisfies the plugin req's
          if (pluginDef.error) {
            newPlugins.push(pluginDef);
          } else {
            depgraph.addPlugin(pluginDef);
          }
        }
      }
      const sortedAndRejectedPlugins = depgraph.processImports();
      sortedAndRejectedPlugins.plugins = sortedAndRejectedPlugins.plugins.filter((plugin)=> {
        return !this.pluginMap[plugin.identifier];
      });
      for (const rejectedPlugin of sortedAndRejectedPlugins.rejects) {
        const rejectionError = zluxUtil.formatErrorStatus(rejectedPlugin.validationError, DependencyGraph.statuses);
        bootstrapLogger.warn(`ZWED0033W`, rejectedPlugin.pluginId, rejectionError); //bootstrapLogger.warn(`Could not initialize plugin` 
            //+ ` ${rejectedPlugin.pluginId}: `  
            //+ zluxUtil.formatErrorStatus(rejectedPlugin.validationError, 
                //DependencyGraph.statuses));
        newPlugins.push(Object.assign(rejectedPlugin, {error: rejectionError}));
      }
  
      let isFirstRun = Object.keys(this.pluginMap).length === 0;
      
      for (const pluginDef of sortedAndRejectedPlugins.plugins) { 
        try {
          if (this.pluginMap[pluginDef.identifier]) {
            bootstrapLogger.warn(`ZWED0034W`, plugin.identifier); //bootstrapLogger.warn(`Skipping install of plugin due to existing plugin with same id=${plugin.identifier}`);
  
             continue;
          }
          const pluginConfiguration = configService.getPluginConfiguration(
            pluginDef.identifier, pluginDef.location,
            this.options.serverConfig, this.options.productCode);
            bootstrapLogger.debug("ZWED0165I", pluginDef.identifier, JSON.stringify(pluginConfiguration)); //bootstrapLogger.debug(`For plugin with id=${pluginDef.identifier}, internal config` 
                                  //+ ` found=\n${JSON.stringify(pluginConfiguration)}`);
  
          const plugin = makePlugin(pluginDef, pluginConfiguration, pluginContext,
                                    false, this.options.langManagers);
          if (plugin) {
            bootstrapLogger.debug("ZWED0124I", plugin.identifier, plugin.location); //bootstrapLogger.log(bootstrapLogger.INFO,
              //`Plugin ${plugin.identifier} at path=${plugin.location} loaded.\n`);
              bootstrapLogger.debug("ZWED0164I", plugin.toString()); //bootstrapLogger.debug(' Content:\n' + plugin.toString());
            let frozen = zluxUtil.deepFreeze(plugin);
            this.plugins.push(frozen);
            newPlugins.push(frozen);
            this.pluginMap[plugin.identifier] = plugin;
            successCount++;
          } else {
            bootstrapLogger.info("ZWED0125I", pluginDef.identifier); //bootstrapLogger.log(bootstrapLogger.INFO,
              //`Plugin ${pluginDef.identifier} not loaded`);
            this.pluginMap[pluginDef.identifier] = {}; //mark it as having failed so it will not be retried
          }
        } catch (e) {
          bootstrapLogger.warn("ZWED0035W", pluginDef.identifier, e);
          //downstream will pick up error
          newPlugins.push(Object.assign(pluginDef, {error:e}));
        }
      }
      this.registerStaticPluginsWithManagers(sortedAndRejectedPlugins.plugins);
      for (const plugin of newPlugins) {
        this.emit('pluginFound', {
          data: plugin,
          count: newPlugins.length
        });
      }
  }),

  // Note - Not to be confused with auth capabilities, that describe what an auth plugin can do
  getComponentCapabilities(config) {
    return new Promise((complete, fail)=> {
      let appServerComp = {};
      let agentComp = {};
      let gatewayComp = {};
      const requestOptions = zluxUtil.getAgentRequestOptions(config, this.tlsOptions, false);

      appServerComp.os = process.platform; // Operating system
      appServerComp.cpu = process.arch; // CPU architecture

      if (!requestOptions) {
        complete();
      } else {
        const httpApi = requestOptions.protocol == 'https:' ? https : http;
        requestOptions.path = '/server/agent/environment';
        return new Promise((resolve, reject) => { /* Obtains and stores environment information from agent */
          httpApi.get(requestOptions, (res) => {
            const { statusCode } = res; // TODO: Check status code for bad status
            const contentType = res.headers['content-type'];

            res.setEncoding('utf8');
            let rawData = '';
            res.on('data', (chunk) => { rawData += chunk; });
            res.on('end', () => {
              try {
                const parsedData = JSON.parse(rawData);
                if (parsedData.agentVersion) {
                  agentComp.version = parsedData.agentVersion;
                }
                if (parsedData.arch) {
                  agentComp.cpu = parsedData.arch;
                }
                if (parsedData.os == undefined && parsedData.hardwareIdentifier && parsedData.osRelease) {
                  agentComp.os = "zos";
                  agentComp.osRelease = parsedData.osRelease;
                  agentComp.hardwareIdentifier = parsedData.hardwareIdentifier;
                } else {
                  agentComp.os = parsedData.os;
                }
                resolve();
              } catch (e) {
                bootstrapLogger.severe(e.message);
                resolve(); // We don't want to reject here. Error gets caught down stream
              }
            });
          }).on('error', (e) => {
            bootstrapLogger.severe(e.message);
            resolve();
          });
          
        }).then(() => {
          requestOptions.path = '/server/agent/services';
          return new Promise((resolve, reject) => {
            httpApi.get(requestOptions, (res) => {
              const { statusCode } = res; // TODO: Check status code for bad status
              const contentType = res.headers['content-type'];
              
              res.setEncoding('utf8');
              let rawData = '';
              res.on('data', (chunk) => { rawData += chunk; });
              res.on('end', () => {
                try {
                  const parsedData = JSON.parse(rawData);
                  if (parsedData.services) {
                    agentComp.endpoints = [];
                    for (let i = 0; i < parsedData.services.length; i++) {
                      if (parsedData.services[i].urlMask) {
                        agentComp.endpoints.push(parsedData.services[i].urlMask);
                      }
                    }
                  }
                  resolve();
                } catch (e) {
                  bootstrapLogger.severe(e.message);
                  resolve(); // We don't want to reject here. Error gets caught down stream
                }
              });
            }).on('error', (e) => {
              bootstrapLogger.severe(e.message);
              resolve(); // We don't want to reject here. Error gets caught down stream
            });
          })
        }).then(() => { /* Obtains and stores the endpoints exposed by the agent */
          requestOptions.path = '/application/info';
          if(config.node.mediationLayer &&
            config.node.mediationLayer.enabled &&
            config.node.mediationLayer.server){
              requestOptions.host = config.node.mediationLayer.server.gatewayHostname
              requestOptions.port = config.node.mediationLayer.server.gatewayPort
            }
          return new Promise((resolve, reject) => { 
            let timer = process.env.APIML_GATEWAY_TIMEOUT_MILLIS || 600000;
            const end = Date.now() + GATEWAY_TIMEOUT_MILLIS;
            return new Promise((resolve, reject) => {

              const gatewayCheck = () => {
                if (Date.now() > end) {
                  log.warn(`ZWED0045`, this.apimlHost, this.apimlPort);
                  return reject(new Error(`Call timeout when fetching gateway status from APIML`));
                }
  
                let req = httpApi.request(requestOptions, (res) => {
                  res.setEncoding('utf8');
                  let rawData = '';
                  res.on('data', (chunk) => { rawData += chunk; });
                  res.on('end', () => {
                    try {
                      const parsedData = JSON.parse(rawData);
                      if (parsedData.services) {
                        agentComp.endpoints = [];
                        for (let i = 0; i < parsedData.services.length; i++) {
                          if (parsedData.services[i].urlMask) {
                            agentComp.endpoints.push(parsedData.services[i].urlMask);
                          }
                        }
                      } else {
                        setTimeout(gatewayCheck, GATEWAY_TIMEOUT_MILLIS);
                      }
                      resolve();
                    } catch (e) {
                      bootstrapLogger.severe(e.message);
                      resolve(); // We don't want to reject here. Error gets caught down stream
                    }
                  });
                }).on('error', (e) => {
                  bootstrapLogger.severe(e.message);
                  setTimeout(gatewayCheck, GATEWAY_TIMEOUT_MILLIS);
                  resolve(); // We don't want to reject here. Error gets caught down stream
                });
                req.setTimeout(timer, () => {
                  reject(new Error(`Call timeout when fetching gateway status from APIML`));
                })
                req.end();
            } })
          }).then(() => {
            /* TODO: before checking if dependencies are met, we must learn about the components that exist. doing this is not formalized
               currently, so we currently have a block per component to learn about their capabilities, version, environment, etc. perhaps in the 
               future zowe components could have metadata files and/or expected URLs for querying.*/
            envComps[AGENT_COMP_ID] = agentComp;
            envComps[APP_SERVER_COMP_ID] = appServerComp;
            envComps[APIML_GATEWAY_COMP_ID] = gatewayComp;
            complete();
          }).catch((e)=> {fail(e);});
        }).catch((e)=>{fail(e);});
      }
    });
  },

  checkPluginRequirements(plugin) {
    if (plugin.requirements) {
      const requiredComponents = plugin.requirements.components;
      if (requiredComponents) {
        for (let componentToCheck in compsToCheck) { // For all components that we have templates for,
          let id = componentToCheck;
          if (envComps[id]) { // ...if there exists a component the server could get environment information for,
            let environmentComponent = envComps[id];
            if (requiredComponents[id]) { //...and that component is one of the components a plugin has requirements for, check them.
              let requiredComponent = requiredComponents[id];
              let requiredOS = requiredComponent.os;
              let requiredCPU = requiredComponent.cpu;
              let requiredVersion = requiredComponent.version;
              let requiredEndpoints = requiredComponent.endpoints;
              let name = compsToCheck[id].name;

              if (environmentComponent.os && requiredOS && requiredOS.length > 0 && environmentComponent.os) { // Plugin has manually required their OS support
                if (requiredOS.includes(environmentComponent.os)) {
                  bootstrapLogger.debug("ZWED0296I", environmentComponent.os, name, plugin.identifier); //(`(${environmentComponent.os}) is a supported platform for ${name} to install (${plugin.identifier}).`);
                } 
                else if (requiredOS.includes("!"+environmentComponent.os)) {
                  plugin.error = new Error(`ZWED0153E - (${environmentComponent.os}) is not a supported platform for ${name}. Skipping (${plugin.identifier})... Supported: ${requiredOS}`);
                }
                else {
                  bootstrapLogger.warn("ZWED0174W", name, environmentComponent.os, plugin.identifier); //`(${name} could not verify (${environmentComponent.os}) as a supported platform to install (${plugin.identifier}). Proceeding anyway...`);
                }
              }
              
              if (environmentComponent.cpu && requiredCPU && requiredCPU.length > 0 && environmentComponent.cpu) { // Manually required arch
                if (requiredCPU.includes(environmentComponent.cpu)) {
                  bootstrapLogger.debug("ZWED0297I", environmentComponent.cpu, name, plugin.identifier);//(`(${environmentComponent.cpu}) is a supported architecture for ${name} to install (${plugin.identifier}).`);
                } else if (requiredCPU.includes("!"+environmentComponent.cpu)) {
                  plugin.error = new Error(`ZWED0154E - (${environmentComponent.cpu}) is not a supported architecture for ${name}. Skipping (${plugin.identifier})... Supported: ${requiredCPU}`);
                }
                else {
                  bootstrapLogger.warn("ZWED0175W", name, environmentComponent.cpu, plugin.identifier);//(`${name} could not verify (${environmentComponent.cpu}) as a supported architecture to install (${plugin.identifier}). Proceeding anyway...`);
                }
              }
              // TODO: Implement better url checking by checking for URL masks
              if (requiredEndpoints && requiredEndpoints.length > 0 && environmentComponent.endpoints) { // Manually required endpoints
                for (let i = 0; i < requiredEndpoints.length; i++) {
                  if (!environmentComponent.endpoints.includes(requiredEndpoints[i])) {
                    plugin.error = new Error(`ZWED0155E - (${requiredEndpoints[i]}) is not a supported endpoint for ${name}. Skipping (${plugin.identifier})... Supported: ${environmentComponent.endpoints}`);
                  } else {
                    bootstrapLogger.debug("ZWED0298I", requiredEndpoints[i], name, plugin.identifier);//g(`(${requiredEndpoints[i]}) is a supported endpoint for ${name} to install (${plugin.identifier}).`);
                  }
                }
              }

              //TODO: Implement complex version verification with checks for "!" "<" "<=" ">" ">="
              
            }
          }
        }
      }
    }
  },
  
  setTlsOptions: function (allowInvalidTLSProxy, tlsOptions) {
    this.tlsOptions = {rejectUnauthorized: !allowInvalidTLSProxy};
    Object.assign(this.tlsOptions, tlsOptions);
  },
  
  issueRefreshFinish() {
    this.emit('refreshFinish', {});
  },

  /**
     Language managers that need to know about all plugins in advance should be informed here.
     These managers may or may not support dynamic addition as well.
   */
  registerStaticPluginsWithManagers(pluginDefs) {
    if (this.options.langManagers) {
      for (let i = 0; i < this.options.langManagers.length; i++) {
        this.options.langManagers[i].registerPlugins(pluginDefs);
      }
    }
  },
  
  addDynamicPlugin(pluginDef) {
    if (this.pluginMap[pluginDef.identifier]) {
      throw new Error('ZWED0019E - Plugin already registered');
    }
    const pluginContext = {
      productCode: this.options.productCode,
      config: this.options.serverConfig,
      authManager: this.options.authManager
    };
    //
    //TODO resolving dependencies correctly
    //see also: the FIXME note at the end of installPlugins()
    //
    bootstrapLogger.info("ZWED0046I", pluginDef.identifier); //bootstrapLogger.info("Adding dynamic plugin " + pluginDef.identifier);
    const pluginConfiguration = configService.getPluginConfiguration(
      pluginDef.identifier, pluginDef.location,
      this.options.serverConfig, this.options.productCode);
    const plugin = makePlugin(pluginDef, pluginConfiguration, pluginContext,
        true);
//    if (!this.unresolvedImports.allImportsResolved(pluginContext.plugins)) {
//      throw new Error('unresolved dependencies');
//      this.unresolvedImports.reset();
//    }
    zluxUtil.deepFreeze(plugin);
    this.plugins.push(plugin);
    this.pluginMap[plugin.identifier] = plugin;
    this.emit('pluginAdded', {
      data: plugin
    });
  }
};

module.exports = PluginLoader;
PluginLoader.makePlugin = makePlugin;

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

