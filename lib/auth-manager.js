

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';
const Promise = require('bluebird');
const constants = require('./unp-constants');
const configService = require('../plugins/config/lib/configService.js');
const zluxUtil = require('./util');

const bootstrapLogger = zluxUtil.loggers.bootstrapLogger;
const authLog = zluxUtil.loggers.authLogger;

const DEFAULT_SESSION_TIMEOUT_MS = 60 /* min */ * 60 * 1000;

const acceptAllHandler = {
  authorized() {
    return Promise.resolve({ authorized: true });
  }
}

class AuthPluginContext {
  constructor(plugin, tlsOptions) {
    this.logger = global.COM_RS_COMMON_LOGGER.makeComponentLogger(plugin.identifier);
    this.tlsOptions = tlsOptions;
  }
}

/**
 * Authentication manager 
 * - keeps track of loaded authentication plugins
 * - ensures that auth configuration is consistent with the global configuration
 */
function AuthManager(options) {
  if (!AuthManager.prototype.isConfigValid(options.config)) {
    process.exit(constants.EXIT_AUTH);
  }
  Object.assign(this, options);
  Object.assign(this, {
    handlers: {},
    defaultType: options.config.defaultAuthentication,
    authTypes: {},
    pendingPlugins: [],
    rbacEnabled: !!options.config.rbac
  });
  if (!this.sessionTimeoutMs) {
    this.sessionTimeoutMs = DEFAULT_SESSION_TIMEOUT_MS;
  }
  if (!this.rbacEnabled) {
    bootstrapLogger.warn("ZWED0006W"); //bootstrapLogger.warn('RBAC is disabled in the configuration. All authenticated'
        //+ ' users will have access to all servces. Enable RBAC in the configuration'
        //+ " to control users' access to individual services");
  }
}
AuthManager.prototype = {
  constructor: AuthManager,
  //The dataserviceAuthentication section of server configuration
  config: null,
  handlers : null,
  defaultType: null,
  authTypes: null,
  pendingPlugins: null,

  isConfigValid(serviceAuthJSON) {
    if (!serviceAuthJSON || !serviceAuthJSON.defaultAuthentication) {
      bootstrapLogger.warn('ZWED0007W'); //bootstrapLogger.warn('Dataservice authentication definition is not present'
          //+ 'in server configuration file, or malformed.\n Correct the configuration'
          //+' file before restarting the server');
      return false;
    }
    return true;
  },
  
  registerAuthenticator(plugin) {
    this.pendingPlugins.push(plugin);
  },
  
  
  loadAuthenticators: Promise.coroutine(function*(config, tlsOptions) {
    let plugin;
    while ((plugin = this.pendingPlugins.pop()) !== undefined) {
      try {
        const authenticationHandler = yield plugin.authenticationModule(
                                              plugin,
                                              this.configuration,
                                              config,
                                              new AuthPluginContext(plugin, tlsOptions));
        // at this time we should have resolved plugin configuration to have a 
        // nice list of info about what we are using to authenticate against
        if ((typeof authenticationHandler.authenticate) !== 'function') {
          throw new Error("ZWED0025E - .authenticate() missing");
        }
        authenticationHandler.pluginID = plugin.identifier;
        authenticationHandler.pluginDef = plugin;
        this.handlers[plugin.identifier] = authenticationHandler;
        let categories;
        if (authenticationHandler.capabilities && authenticationHandler.capabilities.canGetCategories) {
          categories = authenticationHandler.getCategories();
        } else if (plugin.authenticationCategories) {
          categories = plugin.authenticationCategories;
        } else {
          categories = [plugin.authenticationCategory];
        }
        categories.forEach((category)=> {
          let pluginsByCategory = this.authTypes[category];
          if (!pluginsByCategory) {
            pluginsByCategory = [];
            this.authTypes[category] = pluginsByCategory;
          }
          if (this.config.implementationDefaults && this.config.implementationDefaults[category]) {
            const index = this.config.implementationDefaults[category].plugins.indexOf(plugin.identifier);
            if (index != -1) {
              pluginsByCategory.splice(index, 0, plugin.identifier);
            } else {
              pluginsByCategory.push(plugin.identifier);
            }
          } else {
            pluginsByCategory.push(plugin.identifier);
          }
          bootstrapLogger.info(`ZWED0111I`, plugin.identifier, category); //bootstrapLogger.log(bootstrapLogger.INFO,
          //`Authentication plugin ${plugin.identifier} added to category `
          //+ `${category}`);
        });
      } catch (e) {
        authLog.warn('ZWED0008W', plugin.identifier, e); //authLog.warn(`error loading auth plugin ${plugin.identifier}: ` + e);
      }
    }
  }),
  
  /*
    scans the authJSON to see what plugins were requested but not present. 
    If the default is non-existant, then the server must stop.
  
    if none of a requested type is present, the server must warn.
    
    TODO replace the call to the Node "process" module with a terminate call to 
    our "./process" module that will also shut down child processes if any
  */
  validateAuthPluginList() {
    if (!this.authTypes) {
      bootstrapLogger.severe('ZWED0113E'); //bootstrapLogger.warn('The server found no authentication types. '
          //+ 'Verify that the server configuration file defines server authentication');
      process.exit(constants.EXIT_AUTH);
    }
    const defaultTypeArray = this.authTypes[this.config.defaultAuthentication];
    if (!defaultTypeArray) {
      bootstrapLogger.severe('ZWED0112E', this.config.defaultAuthentication); //bootstrapLogger.warn('The server found no plugins implementing the specified default'
          //+ ' authentication type of '+this.config.defaultAuthentication+'.');
      process.exit(constants.EXIT_AUTH); 
    }
    const defaultHandler = this.handlers[defaultTypeArray[0]];
    if (!defaultHandler) {
      bootstrapLogger.severe('ZWED0114E', this.config.defaultAuthentication); //bootstrapLogger.warn('The server found no plugins implementing the specified'
          //+ ` default authentication type of ${this.config.defaultAuthentication}.`);
      process.exit(constants.EXIT_AUTH);    
    }
  },

  /*
    This forced unneccessary configuration steps on the admin.
    It is easier to say a plugin was requested if it was installed.
  */
  authPluginRequested(pluginID, pluginCategory) {
    return true;
  }, 
  
  getBestAuthenticationHandler(authType, criteria) {
    if (!authType) {
      authType = this.defaultType;
    }
    const handlerIDs = this.authTypes[authType];
    // HERE: we have the handlerID, or null. return a real handler from
    // manager.authenticationhandlers
    let handler = null;
    if (handlerIDs) {
      handler = this.handlers[handlerIDs[0]];
    }
    return handler;
  },
  
  getAllHandlers() {
    return Object.values(this.handlers);
  },
  
  getAuthHandlerForService(authenticationData) {
    if (!authenticationData) {
      return null;
    }
    if (authenticationData.enabled === false) {
      authLog.trace('ZWED0112I'); //authLog.log(authLog.FINEST, 'Auth enabled=false. Auth passthrough.');
      return acceptAllHandler;
    }    
    const authType = authenticationData.authType;
    return this.getBestAuthenticationHandler(authType);
  },
  
  isRbacEnabled() {
    return this.rbacEnabled;
  }
};

module.exports = AuthManager; 


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

