/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

const https = require('https');
const fs = require('fs');
const Promise = require('bluebird');
const ipaddr = require('ipaddr.js');
const url = require('url');
const zssHandlerFactory = require('./zssHandler');
const apimlHandlerFactory = require('./apimlHandler');

function doesApimlExist(serverConf) {
  return ((serverConf.node.mediationLayer !== undefined)
    && (serverConf.node.mediationLayer.server !== undefined)
    && (serverConf.node.mediationLayer.server.hostname !== undefined)
    && (serverConf.node.mediationLayer.server.gatewayPort !== undefined)
    && (serverConf.node.mediationLayer.server.port !== undefined)
    && (serverConf.node.mediationLayer.enabled == true))
}

/*
  TODO technically not all agents are zss, but currently that is true, 
       and it's assumed that all agents follow some api standard,
       so it is possible our auth logic will work for other agents, as long as they do SAF
*/
function doesZssExist(serverConf) {
  return (serverConf.agent !== undefined)
    && (serverConf.agent.host !== undefined)
    && (serverConf.agent.http !== undefined)
    && (serverConf.agent.http.port !== undefined)
}


function cleanupSessionGeneric(sessionState) {
  sessionState.authenticated = false;
  delete sessionState.username;
  delete sessionState.sessionExpTime;
}

function SsoAuthenticator(pluginDef, pluginConf, serverConf, context) {
  this.usingApiml = doesApimlExist(serverConf);
  this.usingZss = doesZssExist(serverConf);
  //TODO this seems temporary, will need to unconditionally say usingApiml=usingSso when sso support is complete
  this.apimlSsoEnabled = process.env['APIML_ENABLE_SSO'] == 'true';
  //Sso here meaning just authenticate to apiml, and handle jwt
  this.usingSso = this.apimlSsoEnabled && this.usingApiml;

  this.pluginConf = pluginConf;
  this.instanceID = serverConf.instanceID;
  this.authPluginID = pluginDef.identifier;
  this.logger = context.logger;
  this.categories = ['saf'];
  if (this.usingApiml) {
    this.apimlHandler = apimlHandlerFactory(pluginDef, pluginConf, serverConf, context);
    this.categories.push('apiml');
  }

  if (this.usingZss) {
    this.zssHandler = zssHandlerFactory(pluginDef, pluginConf, serverConf, context);
    this.categories.push('zss');
  }

  this.capabilities = {
    "canGetStatus": true,
    "canGetCategories": true,
    //when zosmf cookie becomes invalid, we can purge zss cookie even if it is valid to be consistent
    "canRefresh": this.usingApiml ? false : true, 
    "canAuthenticate": true,
    "canAuthorize": true,
    "canLogout": true,
    "canResetPassword": this.usingZss ? true : false,
    "proxyAuthorizations": true,
    //TODO do we need to process proxy headers for both?
    "processesProxyHeaders": this.usingZss ? true: false
  };
}

SsoAuthenticator.prototype = {

  getCategories() {
    return this.categories;
  },

  getCapabilities(){
    return this.capabilities;
  },

  getStatus(sessionState) {
    const expms = sessionState.sessionExpTime - Date.now();
    if (expms <= 0 || sessionState.sessionExpTime === undefined) {
      if (this.usingApiml) {
        this.apimlHandler.cleanupSession(sessionState);
      }
      if (this.usingZss) {
        this.zssHandler.cleanupSession(sessionState);
      }
      cleanupSessionGeneric(sessionState);
      return { authenticated: false };
    }
    return this._insertHandlerStatus({
      authenticated: !!sessionState.authenticated,
      username: sessionState.username,
      expms: sessionState.sessionExpTime ? expms : undefined
    });
  },

  logout(request, sessionState) {
    return new Promise((resolve, reject)=> {
      if (this.usingSso || !this.usingZss) {
        this.apimlHandler.logout(request, sessionState).then((result)=> {
          this.apimlHandler.cleanupSession(sessionState);
          resolve(this._insertHandlerStatus(result));
        }).catch((e) => {
          resolve(this._insertHandlerStatus({success: false, reason: e.message}));
        });
      } else {
        this.zssHandler.logout(request, sessionState).then((zssResult)=> {
          this.zssHandler.cleanupSession(sessionState);
          if (this.usingApiml) {
            this.apimlHandler.logout(request, sessionState).then((apimlResult)=> {
              this.apimlHandler.cleanupSession(sessionState);
              resolve(this._insertHandlerStatus({success: (zssResult.success && apimlResult.success)}));
            }).catch((e) => {
              resolve(this._insertHandlerStatus({success: false, reason: e.message}));
            });
          }
        }).catch((e) => {
          resolve(this._insertHandlerStatus({success: false, reason: e.message}));
        });
      }
    });
  },

  _insertHandlerStatus(response) {
    response.apiml = this.usingApiml;
    response.zss = this.usingZss;
    response.canChangePassword = this.usingZss;
    response.sso = this.usingSso;
    return response;
  },
  
  /*
    When JWT SSO is present, auth only to apiml to reduce latency and point of failure
    When not present, OK to auth to both, but must return messages about partial failure if present
  */
  authenticate(request, sessionState) {
    return new Promise((resolve, reject)=> {
      if (this.usingSso || !this.usingZss) {
        //case 1: apiml present and with sso that zss can understand, if present too
        //case 2: zss not present, therefore apiml must be
        this.apimlHandler.authenticate(request, sessionState).then((apimlResult)=> {
          if (apimlResult.success) {
            sessionState.sessionExpTime = Date.now() + apimlResult.expms;
          } else {
            this.apimlHandler.cleanupSession(sessionState);
            cleanupSessionGeneric(sessionState);
          }
          sessionState.authenticated = apimlResult.success;
          resolve(this._insertHandlerStatus(apimlResult));
        }).catch((e)=> {
          this.apimlHandler.cleanupSession(sessionState);
          cleanupSessionGeneric(sessionState);
          reject(e);
        });
      } else {
        //case 3: zss present, and maybe apiml also
        this.zssHandler.authenticate(request, sessionState).then((zssResult)=> {
          if (this.usingApiml) {
            this.apimlHandler.authenticate(request, sessionState).then((apimlResult)=> {
              resolve(this._mergeAuthenticate(zssResult, apimlResult, sessionState));
            }).catch((e)=> {
              this.apimlHandler.cleanupSession(sessionState);
              this.zssHandler.cleanupSession(sessionState);
              cleanupSessionGeneric(sessionState);
              reject(e);
            });
          } else {
            if (zssResult.success) {
              sessionState.sessionExpTime = Date.now() + zssResult.expms;
              sessionState.authenticated = true;
            }
            resolve(this._insertHandlerStatus(zssResult));
          }
        }).catch((e)=> {
          this.zssHandler.cleanupSession(sessionState);
          cleanupSessionGeneric(sessionState);
          reject(e);
        });
      }
    });
  },
  
  _mergeAuthenticate(zss, apiml, sessionState) {
    const now = Date.now();
    //mixed success = failure, complete success = figure out expiration
    if (!apiml.success || !zss.success) {
      this.apimlHandler.cleanupSession(sessionState);
      this.zssHandler.cleanupSession(sessionState);
      cleanupSessionGeneric(sessionState);
      return this._insertHandlerStatus(!apiml.success ? apiml : zss);
    } else {
      sessionState.authenticated = true;
      let shortestExpms = Math.min(zss.expms, apiml.expms);
      sessionState.sessionExpTime = sessionState.sessionExpTime
        ? Math.min(sessionState.sessionExpTime, now+shortestExpms)
        : now+shortestExpms;
      let cookies = undefined;
      if (zss.cookies) {
        cookies = zss.cookies;
      }
      if (apiml.cookies) {
        if (!cookies) {
          cookies = apiml.cookies;
        } else {
          cookies = cookies.concat(apiml.cookies);
        }
      }
      return this._insertHandlerStatus({
        success: true,
        username: sessionState.username,
        expms: shortestExpms,
        cookies: cookies
      });
    }
  },

  passwordReset(request, sessionState) {
    if (this.usingZss) {
      return this.zssHandler.passwordReset(request, sessionState);
    } else {
      return Promise.reject(new Error('Password reset not yet supported through APIML'));
    }
  },

  refreshStatus(request, sessionState) {
    return new Promise((resolve, reject) => {
      if (this.usingZss) {
        this.zssHandler.refreshStatus(request, sessionState).then((result)=> {
          const now = Date.now();          
          if (result.success) {
            if (this.usingApiml) {
              sessionState.sessionExpTime = sessionState.sessionExpTime
                ? Math.min(sessionState.sessionExpTime, now+result.expms)
                : now+result.expms;
            } else {
              sessionState.sessionExpTime = now+result.expms;
            }
            
          }
          /* if failure, dont un-auth or delete cookie... perhaps this was a network error. 
             Let session expire naturally if no success
          */
          resolve(this._insertHandlerStatus(result));
        }).catch((e)=> {
          this.logger.warn(e);
          return this._insertHandlerStatus({success:false});
        });
      } else {
        resolve(this._insertHandlerStatus({success: false}));
      }
    });
  },

  authorized(request, sessionState, options) {
    //prefer ZSS here because it can do RBAC the way the app fw expects
    if (!this.usingZss) {
      return this.apimlHandler.authorized(request, sessionState, options);
    } else {
      return this.zssHandler.authorized(request, sessionState, options);
    }
  },
  
  addProxyAuthorizations(req1, req2Options, sessionState) {
    if (this.usingApiml) {
      this.apimlHandler.addProxyAuthorizations(req1, req2Options, sessionState, this.usingSso);
    }
    if (this.usingZss && !this.usingSso) {
      this.zssHandler.addProxyAuthorizations(req1, req2Options, sessionState);
    }
  },

  processProxiedHeaders(req, headers, sessionState) {
    if (this.usingZss) {
      headers = this.zssHandler.processProxiedHeaders(req, headers, sessionState);
    }
    //TODO does apiml need this too?
    return headers;
  }
};

module.exports = function (pluginDef, pluginConf, serverConf, context) {
  return Promise.resolve(new SsoAuthenticator(pluginDef, pluginConf, serverConf, context));
}
