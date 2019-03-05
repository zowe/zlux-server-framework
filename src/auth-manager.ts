

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

  constructor(options: any) {
    if (!AuthManager.prototype.isConfigValid(options.config)) {
      process.exit(UNP.UNP_EXIT_AUTH_ERROR);
    }
    Object.assign(this, options);
    Object.assign(this, {
      handlers: {},
      defaultType: options.config.defaultAuthentication,
      authTypes: {},
      pendingPlugins: []
    });
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

  loadAuthenticators(){
    BBPromise.coroutine(function*(config: any) {
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
  }

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

  getResourceName(url: any, method: any) {
    const [_l, productCode, _p, pluginID, _s, serviceName, ...subUrl] 
      = url.split('/');
    let resourceName = `${productCode}.${pluginID}_service.${serviceName}.`
      + `${method}.${subUrl.join('.')}`;
    if (resourceName.endsWith('.')) {
      resourceName = resourceName.substring(0, resourceName.length-1);
    }
    //console.log("url, method, resource name:", url, method, resourceName);
    return resourceName;
  }

  *possibleResourceNameMasks(resourceName: any) {
    const resourceNameParts = resourceName.split('.');
    let resourceNameCheck = resourceName;
    yield resourceNameCheck;
    for (let resourceNamePart of resourceNameParts) {
      if (resourceNameCheck == resourceName) {
        resourceNameCheck = resourceNamePart + '.*';
      } else {
        resourceNameCheck = resourceNameCheck.substring(0, 
          resourceNameCheck.length - 1) + resourceNamePart + '.*';
      }
      yield resourceNameCheck;
    }
  }
}

/**
 * Authentication manager 
 * - keeps track of loaded authentication plugins
 * - ensures that auth configuration is consistent with the global configuration
 */
// function AuthManager(options: any) {
//   if (!AuthManager.prototype.isConfigValid(options.config)) {
//     process.exit(UNP.UNP_EXIT_AUTH_ERROR);
//   }
//   Object.assign(this, options);
//   Object.assign(this, {
//     handlers: {},
//     defaultType: options.config.defaultAuthentication,
//     authTypes: {},
//     pendingPlugins: []
//   });
// }
// AuthManager.prototype = {
//   constructor: AuthManager,
//   //The dataserviceAuthentication section of server configuration
//   config: null,
//   handlers : null,
//   defaultType: null,
//   authTypes: null,
//   pendingPlugins: null,

//   isConfigValid(serviceAuthJSON: any) {
//     if (!serviceAuthJSON || !serviceAuthJSON.implementationDefaults
//         || !serviceAuthJSON.defaultAuthentication) {
//       bootstrapLogger.warn('Dataservice authentication definition is not present'
//           + 'in server configuration file, or malformed.\n Correct the configuration'
//           +' file before restarting the server');
//       return false;
//     }
//     return true;
//   },
  
//   registerAuthenticator(plugin: any) {
//     this.pendingPlugins.push(plugin);
//   },
  
  
//   loadAuthenticators: BBPromise.coroutine(function*(config: any) {
//     let plugin;
//     while ((plugin = this.pendingPlugins.pop()) !== undefined) {
//       try {
//         const authenticationHandler = yield plugin.authenticationModule(plugin,
//                 this.configuration, config);
//         // at this time we should have resolved plugin configuration to have a 
//         // nice list of info about what we are using to authenticate against
//         if ((typeof authenticationHandler.authenticate) !== 'function') {
//           throw new Error(".authenticate() missing");
//         }
//         authenticationHandler.pluginID = plugin.identifier;
//         authenticationHandler.pluginDef = plugin;
//         this.handlers[plugin.identifier] = authenticationHandler;
//         let category = this.authTypes[plugin.authenticationCategory];
//         if (!category) {
//           category = [];
//           this.authTypes[plugin.authenticationCategory] = category;
//         }
//         category.push(plugin.identifier);
//         bootstrapLogger.log(bootstrapLogger.INFO,
//           `Authentication plugin ${plugin.identifier} added to category `
//             + `${plugin.authenticationCategory}`);
        
//       } catch (e) {
//         authLog.warn(`error loading auth plugin ${plugin.identifier}: ` + e);
//       }
//     }
//   }),
  
//   /*
//     scans the authJSON to see what plugins were requested but not present. 
//     If the default is non-existant, then the server must stop.
  
//     if none of a requested type is present, the server must warn.
    
//     TODO replace the call to the Node "process" module with a terminate call to 
//     our "./process" module that will also shut down child processes if any
//   */
//   validateAuthPluginList() {
//     if (!this.authTypes) {
//       bootstrapLogger.warn('The server found no authentication types. '
//           + 'Verify that the server configuration file defines server authentication');
//       process.exit(UNP.UNP_EXIT_AUTH_ERROR);
//     }
//     const defaultTypeArray = this.authTypes[this.config.defaultAuthentication];
//     if (!defaultTypeArray) {
//       bootstrapLogger.warn('The server found no plugins implementing the specified default'
//           + ' authentication type of '+this.config.defaultAuthentication+'.');
//       process.exit(UNP.UNP_EXIT_AUTH_ERROR); 
//     }
//     const defaultHandler = this.handlers[defaultTypeArray[0]];
//     if (!defaultHandler) {
//       bootstrapLogger.warn('The server found no plugins implementing the specified'
//           + ` default authentication type of ${this.config.defaultAuthentication}.`);
//       process.exit(UNP.UNP_EXIT_AUTH_ERROR);    
//     }
//   },
  
//   authPluginRequested(pluginID: any, pluginCategory: any) {
//     const category = this.config.implementationDefaults[pluginCategory];
//     if (!(category && category.plugins)) {
//       bootstrapLogger.warn("Implementation defaults for "+pluginCategory+" was not an"
//           + " object, or did not contain a plugins attribute. Other criteria for selecting"
//           + " authentication implementations is not yet implemented.");
//       return false;
//     }
//     const plugins = category.plugins;
//     for (let i = 0; i < plugins.length; i++) {
//       if (plugins[i] === pluginID) {
//         return true;
//       }
//     }
//     return false;
//   }, 
  
//   getBestAuthenticationHandler(authType: any, criteria: any) {
//     if (!authType) {
//       authType = this.defaultType;
//     }
//     const handlerIDs = this.authTypes[authType];
//     // HERE: we have the handlerID, or null. return a real handler from
//     // manager.authenticationhandlers
//     let handler = null;
//     if (handlerIDs) {
//       handler = this.handlers[handlerIDs[0]];
//     }
//     return handler;
//   },
  
//   getAllHandlers() {
//     return Object.values(this.handlers);
//   },
  
//   getAuthHandlerForService(authenticationData: any) {
//     if (!authenticationData) {
//       return null;
//     }
//     if (authenticationData.enabled === false) {
//       authLog.log(authLog.FINEST, 'Auth enabled=false. Auth passthrough.');
//       return acceptAllHandler;
//     }    
//     const authType = authenticationData.authType;
//     return this.getBestAuthenticationHandler(authType);
//   },
  
// //  /*
// //   * a system could specifically allow a resource, or could allow a group of 
// //   * resources in glob format. 
// //   */
// //  checkAuthorization: Promise.coroutine(function*(username, resourceName, 
// //      serviceConfig) {
// //    const authHandler = getAuthHandlerForService(serviceConfig);
// //    if (!authHandler) {
// //      return { authorized: false, status: 
// //        'Authentication failed because type=' + authType + ' is missing'
// //      };
// //    }
// //    for (const resourceNameCheck of possibleResourceNameMasks(resourceName)) { 
// //      authLog.debug('authorize is looping with resourceNameCheck='
// //        + resourceNameCheck);
// //      const authResult = yield authHandler.authorized(serviceConfig, username, 
// //          resourceNameCheck);
// //      if (authResult.authorized) {
// //        authLog.log(authLog.FINEST, 'Authorization success for resource='
// //            + resourceNameCheck + ', username=' + username);            
// //        return { authorized: true };
// //      } 
// //    }
// //    return { authorized: false, status: 
// //      'Authorization failure for resource=' + resourceName + ', username='
// //      + username
// //    };
// //  })
// };

/*
 * The next two functions are RACF-specific
 * 
 * TODO consider moving them to a RACF auth plugin
 */
// (AuthManager as any).getResourceName = function getResourceName(url: any, method: any) {
//   const [_l, productCode, _p, pluginID, _s, serviceName, ...subUrl] 
//     = url.split('/');
//   let resourceName = `${productCode}.${pluginID}_service.${serviceName}.`
//     + `${method}.${subUrl.join('.')}`;
//   if (resourceName.endsWith('.')) {
//     resourceName = resourceName.substring(0, resourceName.length-1);
//   }
//   //console.log("url, method, resource name:", url, method, resourceName);
//   return resourceName;
// };

/**
 * iterator usage example:
 * 
 *  for (const resourceNameMask of AuthManager.possibleResourceNameMasks(
 *    resourceName)) {
 *    ... 
 *    check(resourceNameMask) 
 *    ...
 *  } 
 */
// (AuthManager as any).possibleResourceNameMasks = function *possibleResourceNameMasks(
//     resourceName: any) {
//   const resourceNameParts = resourceName.split('.');
//   let resourceNameCheck = resourceName;
//   yield resourceNameCheck;
//   for (let resourceNamePart of resourceNameParts) {
//     if (resourceNameCheck == resourceName) {
//       resourceNameCheck = resourceNamePart + '.*';
//     } else {
//       resourceNameCheck = resourceNameCheck.substring(0, 
//           resourceNameCheck.length - 1) + resourceNamePart + '.*';
//     }
//     yield resourceNameCheck;
//   }
// };

export{};
module.exports = AuthManager; 


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

