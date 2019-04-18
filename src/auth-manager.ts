

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';
const BBPromise = require('bluebird');
const UNP = require('./unp-constants');
const configService = require('../plugins/config/lib/configService.js');
const zluxUtil = require('./util');

const bootstrapLogger = zluxUtil.loggers.bootstrapLogger;
const authLog = zluxUtil.loggers.authLogger;

const acceptAllHandler = {
  authorized() {
    return Promise.resolve({ authorized: true });
  }
}


export class AuthManager {
  public config: any;
  public handlers: any;
  public defaultType: any;
  public authTypes: any;
  public pendingPlugins: any;
  public configuration: any;
  public rbacEnabled: any;

  constructor(options: any) {
    if (!AuthManager.prototype.isConfigValid(options.config)) {
      process.exit(UNP.UNP_EXIT_AUTH_ERROR);
    }
    Object.assign(this, options);
    Object.assign(this, {
      handlers: {},
      defaultType: options.config.defaultAuthentication,
      authTypes: {},
      pendingPlugins: [],
      rbacEnabled: !!options.config.rbac
    });
    if (!this.rbacEnabled) {
      bootstrapLogger.warn('RBAC is disabled in the configuration. All authenticated'
          + ' users will have access to all servces. Enable RBAC in the configuration'
          + " to control users' access to individual services");
    }
  }

  isConfigValid(serviceAuthJSON: any) {
    if (!serviceAuthJSON || !serviceAuthJSON.implementationDefaults
        || !serviceAuthJSON.defaultAuthentication) {
      bootstrapLogger.warn('Dataservice authentication definition is not present'
          + 'in server configuration file, or malformed.\n Correct the configuration'
          +' file before restarting the server');
      return false;
    }
    return true;
  }

  registerAuthenticator(plugin: any) {
    this.pendingPlugins.push(plugin);
  }

  loadAuthenticators = BBPromise.coroutine(function*(config: any) {
    let plugin;
    while ((plugin = this.pendingPlugins.pop()) !== undefined) {
      try {
        const authenticationHandler = yield plugin.authenticationModule(plugin,
                this.configuration, config);
        // at this time we should have resolved plugin configuration to have a 
        // nice list of info about what we are using to authenticate against
        if ((typeof authenticationHandler.authenticate) !== 'function') {
          throw new Error(".authenticate() missing");
        }
        authenticationHandler.pluginID = plugin.identifier;
        authenticationHandler.pluginDef = plugin;
        this.handlers[plugin.identifier] = authenticationHandler;
        let category = this.authTypes[plugin.authenticationCategory];
        if (!category) {
          category = [];
          this.authTypes[plugin.authenticationCategory] = category;
        }
        category.push(plugin.identifier);
        bootstrapLogger.log(bootstrapLogger.INFO,
          `Authentication plugin ${plugin.identifier} added to category `
            + `${plugin.authenticationCategory}`);
        
      } catch (e) {
        authLog.warn(`error loading auth plugin ${plugin.identifier}: ` + e);
      }
    }
  })

  validateAuthPluginList() {
    if (!this.authTypes) {
      bootstrapLogger.warn('The server found no authentication types. '
          + 'Verify that the server configuration file defines server authentication');
      process.exit(UNP.UNP_EXIT_AUTH_ERROR);
    }
    const defaultTypeArray = this.authTypes[this.config.defaultAuthentication];
    if (!defaultTypeArray) {
      bootstrapLogger.warn('The server found no plugins implementing the specified default'
          + ' authentication type of '+this.config.defaultAuthentication+'.');
      process.exit(UNP.UNP_EXIT_AUTH_ERROR); 
    }
    const defaultHandler = this.handlers[defaultTypeArray[0]];
    if (!defaultHandler) {
      bootstrapLogger.warn('The server found no plugins implementing the specified'
          + ` default authentication type of ${this.config.defaultAuthentication}.`);
      process.exit(UNP.UNP_EXIT_AUTH_ERROR);    
    }
  }

  authPluginRequested(pluginID: any, pluginCategory: any) {
    const category = this.config.implementationDefaults[pluginCategory];
    if (!(category && category.plugins)) {
      bootstrapLogger.warn("Implementation defaults for "+pluginCategory+" was not an"
          + " object, or did not contain a plugins attribute. Other criteria for selecting"
          + " authentication implementations is not yet implemented.");
      return false;
    }
    const plugins = category.plugins;
    for (let i = 0; i < plugins.length; i++) {
      if (plugins[i] === pluginID) {
        return true;
      }
    }
    return false;
  }

  getBestAuthenticationHandler(authType: any, criteria: any = null) {
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
  }
  
  getAllHandlers() {
    return Object.values(this.handlers);
  }
  
  getAuthHandlerForService(authenticationData: any) {
    if (!authenticationData) {
      return null;
    }
    if (authenticationData.enabled === false) {
      authLog.log(authLog.FINEST, 'Auth enabled=false. Auth passthrough.');
      return acceptAllHandler;
    }    
    const authType = authenticationData.authType;
    return this.getBestAuthenticationHandler(authType);
  }

   checkAuthorization = 
   BBPromise.coroutine(function*(username: any, resourceName: any, 
     serviceConfig: any) {
   const authHandler = this.getAuthHandlerForService(serviceConfig);
   if (!authHandler) {
     return { authorized: false, status: 
       'Authentication failed because type=' + this.authType + ' is missing'
     };
   }
   for (const resourceNameCheck of this.possibleResourceNameMasks(resourceName)) { 
     authLog.debug('authorize is looping with resourceNameCheck='
       + resourceNameCheck);
     const authResult = yield authHandler.authorized(serviceConfig, username, 
         resourceNameCheck);
     if (authResult.authorized) {
       authLog.log(authLog.FINEST, 'Authorization success for resource='
           + resourceNameCheck + ', username=' + username);            
       return { authorized: true };
     } 
   }
   return { authorized: false, status: 
     'Authorization failure for resource=' + resourceName + ', username='
     + username
   };
 })

 isRbacEnabled() {
  return this.rbacEnabled;
 }
}

export{};
module.exports = AuthManager; 


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

