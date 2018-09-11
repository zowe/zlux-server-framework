
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';
const util = require('util');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const os = require('os');
const assert = require('assert');
const toposort = require('toposort');
const requireFromString = require('require-from-string');
const EventEmitter = require('events');
const zluxUtil = require('./util');
const jsonUtils = require('./jsonUtils.js');
const configService = require('../plugins/config/lib/configService.js');
const pluginDefinitionValidation = require('./pluginDefinitionValidation.js')

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
  serverConfig: null
}

var uniquePluginIdentifiers = []

function ExternalImports() {
  this.map = {};
}

ExternalImports.prototype = {
  constructor: ExternalImports,
  /**
   * A plugin import table in the opposite direction. 
   * Shows who imports us, rather than whom we import.
   *   
   *   <plugin id>: {
   *     <service name>: [
   *       ...,
   *       {
   *         "toPlugin": the id of a plugin that imports the service from the plugin
   *         "alias": the target alias of the service
   *       },
   *       ...
   *     ]
   *   }
   */
  map: null, 
  
  /**
   * Register a newly obtained plugin definition's dependencies to the table
   */
  registerAsImporterOfAs(destPlugin, sourcePlugin, sourceName, localName) {
    let sourcePluginEntry = this.map[sourcePlugin];
    if (!sourcePluginEntry) {
      sourcePluginEntry = this.map[sourcePlugin] = {};
    }
    let sourceServiceRefs = sourcePluginEntry[sourceName];
    if (!sourceServiceRefs) {
      sourceServiceRefs = sourcePluginEntry[sourceName] = [];
    }
    sourceServiceRefs.push({
      toPlugin: destPlugin.identifier,
      alias: localName
    });
  },
  
  /**
   * Ensure that none of the `plugins` contains unsatisfied imports.
   * 
   * Every service of every plugin from `plugins` cancels out the corresponding
   * records from the table.
   * 
   * Updates every imported data service's externalRefs
   * 
   * Returns true if the table ends up being empty, false otherwise
   */
  allImportsResolved(plugins) {
    let success = true;
    for (const plugin of plugins) {
      const externalImports = this.map[plugin.identifier];
      if (externalImports) {
        if (plugin.dataServices) {
          for (const dataservice of plugin.dataServices) {
            dataservice.externalRefs = externalImports[dataservice.name];
            delete externalImports[dataservice.name];
          }
        }
        const missingServices = Object.keys(externalImports);
        if (missingServices.length > 0) {
          success = false;
        }
        delete this.map[plugin.identifier];
      }
    }
    const missingPlugins = Object.keys(this.map);
    if (missingPlugins.length > 0) {
      success = false;
    }
    return success;
  },
   
  /*
   * TODO recursively mark broken the dependents of a broken plugin
   */
  getBrokenPlugins() {
    let report = {};
    for (const plugin of Object.keys(this.map)) {
      const serviceMap = this.map[plugin]
      for (const service of Object.keys(serviceMap)) {
        const imports = serviceMap[service];
        for (const im of imports) {
          let p = report[im.toPlugin];
          if (!p) {
            p = report[im.toPlugin] = {};
          }
          p[im.alias] = true;
        }
      }
    }
    return report;
  },
  
  reset() {
    this.map = {};
  }
};

function Service(def, configuration, plugin) {
  this.configuration = configuration;
  //don't do this here: avoid circular structures:
  //this.plugin = plugin; 
  Object.assign(this, def);
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
}
ExternalService.prototype = {
  constructor: ExternalService,
  __proto__:  Service.prototype
}

function makeDataService(def, plugin, context) {
  const configuration = configService.getServiceConfiguration(plugin.identifier,
      def.name, context.config, context.productCode);
  let dataservice;
  if (def.type == "external") {
    dataservice = new ExternalService(def, configuration, plugin);
  } else {
    dataservice = new Service(def, configuration, plugin);
  }
  return dataservice;
}

function Plugin(def, configuration, location) {
  Object.assign(this, def);
  this.configuration = configuration;
  this.location = location;
}
Plugin.prototype = {
  constructor: Plugin,
  identifier: null,
  apiVersion: null,
  pluginVersion: null,
  pluginType: null,
  webContent: null,
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
    bootstrapLogger.warn(this.identifier
        + `: "${this.pluginType}" plugins not yet implemented`);
  },
  
  exportDef() {
    return {
      identifier: this.identifier,
      pluginVersion: this.pluginVersion,
      apiVersion: this.apiVersion,
      pluginType: this.pluginType,
      //TODO move these to the appropraite plugin type(s)
      webContent: this.webContent, 
      configurationData: this.configurationData,
      dataServices: this.dataServices
    };
  },
  
  initStaticWebDependencies() {
    if (this.webContent) {
      let contentPath = path.join(this.location, "web");
      if (!fs.existsSync(contentPath)) {
        bootstrapLogger.warn(`plugin ${this.identifier} has web content but `
            + `no web directory under ${this.location}`);
      } else {
        bootstrapLogger.info(`plugin ${this.identifier} `
            + `will serve static files from ${contentPath}`);
        this.webContent.path = contentPath;
      }
    }
  },
  
  initWebServiceDependencies(unresolvedImports, context) {
    if (this.dataServices) {
      this.dataServicesGrouped = {
        router: [],
        import: [],
        node: [],
        proxy: [],
        external: []
      };
      for (const dataServiceDef of this.dataServices) {
        const dataservice = makeDataService(dataServiceDef, this, context);
        if (dataservice.type == "service") {          
          this.dataServicesGrouped.proxy.push(dataservice);
          bootstrapLogger.info(`${this.identifier}: `
              + `found proxied service '${dataservice.name}'`);
        } else   if (dataservice.type === 'import') {
          this.dataServicesGrouped.import.push(dataservice);
          unresolvedImports.registerAsImporterOfAs(this, dataservice.sourcePlugin,
              dataservice.sourceName, dataservice.localName);
          bootstrapLogger.info(`${this.identifier}:`
              + ` importing service '${dataservice.sourceName}'`
              + ` from ${dataservice.sourcePlugin}`
              + ` as '${dataservice.localName}'`);
        } else if ((dataservice.type == 'nodeService')
            || (dataservice.type === 'router')) {
          if ((dataservice.serviceLookupMethod == 'internal')
              || !dataservice.dependenciesIncluded) {
            bootstrapLogger.warn(`${this.identifier}:`
                + ` loading dataservice ${dataservice.name} failed, declaration invalid`);
            continue;
          }
          if (dataservice.type === 'router') {
            bootstrapLogger.info(`${this.identifier}: `
                + `found router '${dataservice.name}'`);
            this.dataServicesGrouped.router.push(dataservice);
          } else {
            bootstrapLogger.info(`${this.identifier}: `
                + `found legacy node service '${dataservice.name}'`);
            this.dataServicesGrouped.node.push(dataservice);
          }
          if (this.dynamicallyCreated) {
            const nodeModule = requireFromString(dataservice.source);
            dataservice.nodeModule = nodeModule;
          } else {
            const fileLocation = path.join(this.location, 'lib', dataservice.filename);
            const nodeModule = require(fileLocation);
            dataservice.nodeModule = nodeModule;
          }
        } else if (dataservice.type == 'external') {
          this.dataServicesGrouped.external.push(dataservice);
          bootstrapLogger.info(`${this.identifier}: `
              + `found external service '${dataservice.name}'`);
        } else {
          bootstrapLogger.warn(`${this.identifier}: `
              + `invalid service type '${dataservice.name}'`);
        }
      }
    }
  }
};

function LibraryPlugIn(def, configuration, location) {
  Plugin.call(this, def, configuration, location);
}
LibraryPlugIn.prototype = {
  __proto__: Plugin.prototype,
  constructor: LibraryPlugIn,
  
  init(context) {
    assert(this.pluginType === "library");
    if (!fs.existsSync(this.location)) {
      bootstrapLogger.log(bootstrapLogger.WARNING,
        `${def.identifier}: library path ${this.location} does not exist`);
      return;
    }
    bootstrapLogger.log(bootstrapLogger.INFO,
      `Plugin ${this.identifier} will serve library data from directory ${this.location}`);
  }
};

function ApplicationPlugIn(def, configuration, location) {
  Plugin.call(this, def, configuration, location);
}
ApplicationPlugIn.prototype = {
  __proto__: Plugin.prototype,
  constructor: ApplicationPlugIn,
};

function WindowManagerPlugIn(def, configuration, location) {
  Plugin.call(this, def, configuration, location);
}
WindowManagerPlugIn.prototype = {
  constructor: WindowManagerPlugIn,
  __proto__: Plugin.prototype,
};

function BootstrapPlugIn(def, configuration, location) {
  Plugin.call(this, def, configuration, location);
}
BootstrapPlugIn.prototype = {
  constructor: BootstrapPlugIn,
  __proto__: Plugin.prototype,
};

function DesktopPlugIn(def, configuration, location) {
  Plugin.call(this, def, configuration, location);
}
DesktopPlugIn.prototype = {
  constructor: DesktopPlugIn,
  __proto__: Plugin.prototype,
};

function NodeAuthenticationPlugIn(def, configuration, location) {
  Plugin.call(this, def, configuration, location);
}
NodeAuthenticationPlugIn.prototype = {
  constructor: NodeAuthenticationPlugIn,
  __proto__: Plugin.prototype,
  authenticationCategory: null,
  filename: null,
  
  isValid(context) {
    if (!(super.isValid(context) && this.filename 
        && this.authenticationCategory)) {
      return false;
    }
    //we should not load authentication types that are 
    //not requested by the administrator
    if (!context.authManager.authPluginRequested(this.identifier,
      this.authenticationCategory)) {
      bootstrapLogger.warn("Authentication plugin was found which was not requested in "
          + "the server configuration file's dataserviceAuthentication object. "
          + "Skipping load of this plugin");
      return false;
    }
    return true;
  },
  
  exportDef() {
    return Object.assign(super.exportDef(), {
      filename: this.filename,
      authenticationCategory: this.authenticationCategory
    });
  },
  
  init(context) {
    const filepath = path.join(this.location, 'lib', this.filename);
    bootstrapLogger.log(bootstrapLogger.INFO,
      `Auth plugin ${this.identifier}: loading auth handler module ${filepath}`)
    this.authenticationModule = require(filepath);
    context.authManager.registerAuthenticator(this);
  }
};

function ProxyConnectorPlugIn(def, configuration, location) {
  Plugin.call(this, def, configuration, location);
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
    //we should not load authentication types that are 
    //not requested by the administrator
    if (!context.authManager.authPluginRequested(this.identifier,
      this.authenticationCategory)) {
      bootstrapLogger.warn("Authentication plugin was found which was not requested in "
          + "the server configuration file's dataserviceAuthentication object. "
          + "Skipping load of this plugin");
      return false;
    }
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

function makePlugin(def, pluginConfiguration, basePath) {
  const pluginConstr = plugInConstructorsByType[def.pluginType];
  if (!pluginConstr) {
    throw new Error(`${def.identifier}: pluginType ${def.pluginType} is unknown`); 
  }
  // one can think in terms of Java: `def` is a JSON-serialized instance of the
  // "class" referred to by `proto`. Create an instance and inject the
  // de-serialized instance data there.
  // (We don't need an extra indirection level, e.g. self.definition = def)
  const self = new pluginConstr(def, pluginConfiguration, basePath);
  return self;
};

function PluginLoader(options) {
  EventEmitter.call(this);
  this.options = zluxUtil.makeOptionsObject(defaultOptions, options);
  this.ng2 = null;
  this.plugins = null;
  this.pluginMap = {};
  this.unresolvedImports = new ExternalImports();
};
PluginLoader.prototype = {
  constructor: PluginLoader,
  __proto__: EventEmitter.prototype,
  options: null,
  ng2: null,
  plugins: null,
  pluginMap: null,
  unresolvedImports: null,
  
  _readPluginDef(pluginDescriptorFilename) {
    bootstrapLogger.info(`Processing plugin reference ${pluginDescriptorFilename}...`);
    const pluginPtrPath = path.join(this.options.pluginsDir, pluginDescriptorFilename);
    if (!fs.existsSync(pluginPtrPath)) {
      throw new Error(`${pluginPtrPath} is missing`);
    }
    const pluginPtrDef = jsonUtils.parseJSONWithComments(pluginPtrPath);
    bootstrapLogger.log(bootstrapLogger.FINER, util.inspect(pluginPtrDef));
    let pluginBasePath = pluginPtrDef.pluginLocation;
    if (!fs.existsSync(pluginBasePath)) {
      throw new Error(`${pluginDescriptorFilename}: No plugin directory found at`
        + `${pluginPtrDef.pluginLocation}`);
     }
    let pluginDefPath = path.join(pluginBasePath, 'pluginDefinition.json');
    if (!fs.existsSync(pluginDefPath)) {
      throw new Error(`${pluginDescriptorFilename}: No pluginDefinition.json `
          + `found at ${pluginBasePath}`);
    }
    let pluginDef = jsonUtils.parseJSONWithComments(pluginDefPath);
    bootstrapLogger.log(bootstrapLogger.FINER,util.inspect(pluginDef));
    if (pluginDef.identifier !== pluginPtrDef.identifier) {
      throw new Error(`${pluginDef.identifier} and ${pluginPtrDef.identifier} `
          + `don't match - plugin ignored`);
    }
    bootstrapLogger.info(`Validating Plugin Definition at ${pluginBasePath}/pluginDefinition.json`)
    pluginDefinitionValidation.validatePluginDef(pluginDef);
    if(uniquePluginIdentifiers.includes(pluginDef.identifier)) {
      throw new Error (`Plugin Identifier ${pluginDef.identifier} is already in use, please choose a unique identifier`)
    }
    uniquePluginIdentifiers.push(pluginDef.identifier)
    const pluginConfiguration = configService.getPluginConfiguration(
      pluginDef.identifier, this.options.serverConfig,
      this.options.productCode);
    bootstrapLogger.debug(`For plugin with id=${pluginDef.identifier}, internal config` 
                          + ` found=\n${JSON.stringify(pluginConfiguration)}`);
    return makePlugin(pluginDef, pluginConfiguration, pluginBasePath, 
      this.options.productCode);
  },

  _generateNg2ModuleTs(plugins) {
    let importStmts = [];
    let modules = ["BrowserModule"];
    plugins.filter(function(def) {
      return def.webContent && 
        ("object" === typeof def.webContent) &&
        (def.webContent.framework === "angular2");
    }).forEach(function (def) {
      let ng2ModuleName = def.webContent.ng2ModuleName;
      let ng2ModuleLocation = def.webContent.ng2ModuleLocation;
      if (!(ng2ModuleName && ng2ModuleLocation)) {
        bootstrapLogger.warn(`Invalid NG2 module: ${def.location}: `
            + "'ng2ModuleName' or 'ng2ModuleLocation' missing");
        return;
      } 
      importStmts.push("import { "+ng2ModuleName+" } from '"+ng2ModuleLocation+"';\n");
      modules.push(ng2ModuleName);
    });
    let ng2 = 
        "import { NgModule } from '@angular/core';\n"+
        "import { BrowserModule } from '@angular/platform-browser';\n"+
        importStmts.join("") +
        "@NgModule({\n"+
        "  imports: ["+modules.join(", ")+"]\n" +
        "})\n" +
        "export class Ng2RootModule {}\n";
    bootstrapLogger.log(bootstrapLogger.FINER,
      "Generated ng2 module:\n" + ng2);
    return ng2;
  },
  
  _toposortPlugins(plugins, pluginMap) {
    const edges = [];
    for (const plugin of plugins) {
      if (!plugin.dataServicesGrouped) {
        continue;
      }
      for (const service of plugin.dataServicesGrouped.import || []) {
        const prereq = pluginMap[service.sourcePlugin];
        //console.log("pushing [", prereq.identifier, ", ", plugin.identifier, "]")
        edges.push([prereq, plugin]);
      }
    }
    const sorted = toposort.array(plugins, edges);
    //console.log("before sort: ", JSON.stringify(plugins, null, 2));
    //console.log("after sort: ", JSON.stringify(sorted, null, 2));
    return sorted;
  },

  loadPlugins() {
    const pluginContext = {
      productCode: this.options.productCode,
      config: this.options.serverConfig,
      plugins: [],
      authManager: this.options.authManager
    };
    bootstrapLogger.log(bootstrapLogger.INFO,
      `Reading plugins dir ${this.options.pluginsDir}`);
    const pluginLocationJSONs = fs.readdirSync(this.options.pluginsDir)
        .filter(function(value){
          return value.match(/.*\.json/);
        });
    bootstrapLogger.log(bootstrapLogger.FINER, util.inspect(pluginLocationJSONs));
    for (const pluginDescriptorFilename of pluginLocationJSONs) {
      try {
        const plugin = this._readPluginDef(pluginDescriptorFilename);
        if (!plugin.isValid(pluginContext)) {
          bootstrapLogger.warn(`${pluginDescriptorFilename} points to an`
              + " invalid plugin definition, skipping");
          continue;
        }
        /*
         * FIXME don't yet do the steps below! Toposort and find broken deps 
         * first! If there's a broken dependency somewhere, the entire subtree of 
         * plugins who indirectly depend on the broken plugin may need to be 
         * skipped, we don't even want to load their stuff.
         */
        plugin.initStaticWebDependencies();
        plugin.initWebServiceDependencies(this.unresolvedImports, pluginContext);
        plugin.init(pluginContext);
        pluginContext.plugins.push(plugin);
        bootstrapLogger.log(bootstrapLogger.INFO,
          `Plugin ${plugin.identifier} at path=${plugin.location} loaded\n`);
        bootstrapLogger.debug(' Content:\n' + plugin.toString());
      } catch (e) {
        console.log(e);
        bootstrapLogger.warn(e)
        bootstrapLogger.log(bootstrapLogger.INFO,
          `Failed to load ${pluginDescriptorFilename}\n`);
      }
    }
    if (!this.unresolvedImports.allImportsResolved(pluginContext.plugins)) {
      //TODO what do we want to do here?
      // stop the server? 
      // chug along with some plugins broken?
      // leave only working plugins and not load the broken ones? 
      const broken = this.unresolvedImports.getBrokenPlugins();
      pluginContext.plugins = pluginContext.plugins.filter(
        (p) => {
          if (broken[p.identifier]) {
            bootstrapLogger.warn(`Could not initialize plugin ${p.identifier}:`
              + " unresolved imports: "
              + Object.keys(broken[p.identifier]).join(', '));
            return false;
          }
          return true;
        });
      this.unresolvedImports.reset();
    }
    this.ng2 = this._generateNg2ModuleTs(pluginContext.plugins);
    for (const plugin of pluginContext.plugins) {
      zluxUtil.deepFreeze(plugin);
      this.pluginMap[plugin.identifier] = plugin;
    }
    this.plugins = this._toposortPlugins(pluginContext.plugins, this.pluginMap);
//    bootstrapLogger.warn('pluginMap empty (plugin-loader.js line530)='
//        + JSON.stringify(this.pluginMap));    
    for (const plugin of this.plugins) {
      this.emit('pluginAdded', {
        data: plugin
      });
    }
  },
  
  addDynamicPlugin(pluginDef) {
    if (this.pluginMap[pluginDef.identifier]) {
      throw new Error('plugin already registered');
    }
    const pluginContext = {
      productCode: this.options.productCode,
      config: this.options.serverConfig,
      plugins: this.plugins,
      authManager: this.options.authManager
    };
    bootstrapLogger.info("Adding dynamic plugin " + pluginDef.identifier);
    const pluginConfiguration = configService.getPluginConfiguration(
      pluginDef.identifier, this.options.serverConfig,
      this.options.productCode);
    const plugin = makePlugin(pluginDef, pluginConfiguration, '/dev/null' /*TODO*/);
    plugin.dynamicallyCreated = true; /* TODO extra security */
    plugin.initWebServiceDependencies(this.unresolvedImports, pluginContext);
    plugin.init(pluginContext);
    if (!this.unresolvedImports.allImportsResolved(pluginContext.plugins)) {
      throw new Error('unresolved dependencies');
      this.unresolvedImports.reset();
    }
    zluxUtil.deepFreeze(plugin);
    this.plugins.push(plugin);
    this.pluginMap[plugin.identifier] = plugin;
    this.emit('pluginAdded', {
      data: plugin
    });
  }
};

module.exports = PluginLoader;

const _unitTest = false;
function unitTest() {
  var configData = {
  "zssPort":31338,
// All paths relative to ZLUX/node or ZLUX/bin
// In real installations, these values will be configured during the install.
  "rootDir":"../deploy",
  "productDir":"../deploy/product",
  "siteDir":"../deploy/site",
  "instanceDir":"../deploy/instance",
  "groupsDir":"../deploy/instance/groups",
  "usersDir":"../deploy/instance/users",
  "pluginsDir":"../deploy/instance/ZLUX/plugins",

  "productCode": 'ZLUX',
  "dataserviceAuthentication": {
    //this specifies the default authentication type for dataservices that didn't specify which type to use. These dataservices therefore should not expect a particular type of authentication to be used.
    "defaultAuthentication": "fallback",
    
    //each authentication type may have more than one implementing plugin. define defaults and fallbacks below as well
    //any types that have no implementers are ignored, and any implementations specified here that are not known to the server are also ignored.
    "implementationDefaults": {
      //each type has an object which describes which implementation to use based on some criteria to find which is best for the task. For now, just "plugins" will
      //be used to state that you want a particular plugin.
      "fallback": {
        "plugins": ["com.rs.auth.trivialAuth"]
      }
    }
  }  
  };
  var pm = new PluginLoader(configData, process.cwd());
  var pl = pm.loadPlugins();
  console.log("plugins: ", pl);
  //console.log(pl.ng2)
}
if (_unitTest) {
  unitTest()
}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

