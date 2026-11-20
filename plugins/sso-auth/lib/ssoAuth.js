/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

const fs = require('fs');
const Promise = require('bluebird');
const ipaddr = require('ipaddr.js');
const url = require('url');
const zssHandlerFactory = require('./zssHandler');
const apimlHandlerFactory = require('./apimlHandler');
const gatewayApiHandlerFactory = require('./gatewayApiHandler');
const localJwt = require('./localJwt');

function doesApimlExist(serverConf) {
  return ((serverConf.node.mediationLayer !== undefined)
    && (serverConf.node.mediationLayer.server !== undefined)
    && (serverConf.node.mediationLayer.server.gatewayHostname !== undefined)
    && (serverConf.node.mediationLayer.server.gatewayPort !== undefined)
    && (serverConf.node.mediationLayer.server.port !== undefined)
    && (serverConf.node.mediationLayer.enabled == true))
}

function doesZosmfExist(zoweConf) {
  return !!(zoweConf && zoweConf.zOSMF && zoweConf.zOSMF.host && zoweConf.zOSMF.port);
}

/*
  TODO technically not all agents are zss, but currently that is true, 
       and it's assumed that all agents follow some api standard,
       so it is possible our auth logic will work for other agents, as long as they do SAF
*/
function doesZssExist(serverConf) {
   if (typeof serverConf.agent !== 'object') {
    return false;
   }
   if (typeof serverConf.agent.host !== 'string') {
     return false;
   }
   if (typeof serverConf.agent.https === 'object' && typeof serverConf.agent.https.port === 'number') {
     return true;
   }
   if (typeof serverConf.agent.http === 'object' && typeof serverConf.agent.http.port === 'number') {
     return true;
   }
   return false;
}


function cleanupSessionGeneric(sessionState) {
  sessionState.authenticated = false;
  delete sessionState.username;
  delete sessionState.sessionExpTime;
  delete sessionState.localJwtToken;
  delete sessionState.localJwtExpMs;
}

function SsoAuthenticator(pluginDef, pluginConf, serverConf, context, zoweConf) {
  this.usingApiml = doesApimlExist(serverConf);
  this.usingZss = doesZssExist(serverConf);

  //Sso here meaning just authenticate to apiml
  this.usingSso = this.usingApiml;

  this.pluginConf = pluginConf;
  this.instanceID = serverConf.instanceID;
  this.authPluginID = pluginDef.identifier;
  this.logger = context.logger;
  this.categories = ['saf'];
  if (this.usingApiml) {
    this.apimlHandler = apimlHandlerFactory(pluginDef, pluginConf, serverConf, context, zoweConf);
    this.categories.push('apiml');
  }

  if (this.usingZss) {
    this.zssHandler = zssHandlerFactory(pluginDef, pluginConf, serverConf, context);
    this.categories.push('zss');
  }

  this.usingZosmf = !this.usingApiml && doesZosmfExist(zoweConf);
  if (this.usingZosmf) {
    this.gatewayApiHandler = gatewayApiHandlerFactory(pluginDef, pluginConf, serverConf, context, zoweConf);
    this.categories.push('zosmf');
  }

  /*
   * Used for JWT generation in the circumstance that both APIML and zOSMF are unavailable.
   */
  this.keyMaterial = (!this.usingApiml && !this.usingZosmf && this.usingZss)
    ? localJwt.extractTlsKeyMaterial(this.logger, context.tlsOptions)
    : null;

  this.capabilities = {
    "canGetStatus": true,
    "canGetCategories": true,
    //when zosmf cookie becomes invalid, we can purge zss cookie even if it is valid to be consistent
    "canRefresh": (this.usingZss && !this.usingSso) ? true : false,
    "canAuthenticate": true,
    "canAuthorize": true,
    "canLogout": true,
    "canResetPassword": this.usingZss ? true : false,
    "proxyAuthorizations": true,
    "processesProxyHeaders": false,
    "haCompatible": this.usingSso,
    "canGenerateHaSessionId": this.usingSso,
    "canIssueJWT": !this.usingApiml && (this.usingZosmf || this.usingZss),
    "canIssuePasstickets": this.usingZss,
    "jwtCookieName": "apimlAuthenticationToken",
  };

  this.logger.info(`SSO=${this.usingSso ? 'enabled' : 'disabled'}, APIML=${this.usingApiml}, ZSS=${this.usingZss}`);
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
      if (this.usingZosmf) {
        this.gatewayApiHandler.logout(request, sessionState).then((result)=> {
          this.gatewayApiHandler.cleanupSession(sessionState);
          if (this.usingZss) {
            this.zssHandler.logout(request, sessionState).then((zssResult)=> {
              this.zssHandler.cleanupSession(sessionState);
              const cookies = this._mergeCookies(zssResult, result);
              resolve(this._insertHandlerStatus({ success: result.success, cookies }));
            }).catch(() => {
              resolve(this._insertHandlerStatus(result));
            });
          } else {
            resolve(this._insertHandlerStatus(result));
          }
        }).catch((e) => {
          resolve(this._insertHandlerStatus({ success: false, reason: e.message }));
        });
      } else if (this.usingSso || !this.usingZss) {
        this.apimlHandler.logout(request, sessionState).then((result)=> {
          this.apimlHandler.cleanupSession(sessionState);
          resolve(this._insertHandlerStatus(result));
        }).catch((e) => {
          resolve(this._insertHandlerStatus({success: false, reason: e.message}));
        });
      } else {
        this.zssHandler.logout(request, sessionState).then((zssResult)=> {
          // Revoke the locally-issued JWT before clearing the session
          // since that's the only place it was tracked.
          const localToken = sessionState.localJwtToken;
          const localExpMs = sessionState.localJwtExpMs || (Date.now() + localJwt.DEFAULT_EXPIRATION_MS);
          const revoked = localToken
            ? localJwt.revokeToken(localToken, localExpMs, this.logger)
            : Promise.resolve();
          revoked.then(() => {
            this.zssHandler.cleanupSession(sessionState);
            if (this.usingApiml) {
              this.apimlHandler.logout(request, sessionState).then((apimlResult)=> {
                this.apimlHandler.cleanupSession(sessionState);
                const cookies = this._mergeCookies(zssResult, apimlResult);
                resolve(this._insertHandlerStatus({success: (zssResult.success && apimlResult.success),
                                                   cookies: cookies}));
              }).catch((e) => {
                resolve(this._insertHandlerStatus({success: false, reason: e.message}));
              });
            } else { //only zss?
              resolve(this._insertHandlerStatus({success: (zssResult.success), cookies: zssResult.cookies}));
            }
          });
        }).catch((e) => {
          resolve(this._insertHandlerStatus({success: false, reason: e.message}));
        });
      }
    });
  },

  _insertHandlerStatus(response) {
    response.apiml = this.usingApiml;
    response.zss = this.usingZss;
    response.sso = this.usingSso;
    response.zosmf = this.usingZosmf;
    response.canChangePassword = this.usingZss;
    return response;
  },
  
  /*
    When JWT SSO is present, auth only to apiml to reduce latency and point of failure
    When not present, OK to auth to both, but must return messages about partial failure if present
  */
  authenticate(request, sessionState) {
    return new Promise((resolve, reject)=> {
      if (this.usingZosmf) {
        // case 0: APIML unavailable but z/OSMF is configured; authenticate
        // directly against z/OSMF and issue a locally-managed JWT.
        this.gatewayApiHandler.authenticate(request, sessionState).then((zosmfResult)=> {
          if (zosmfResult.success) {
            sessionState.sessionExpTime = Date.now() + zosmfResult.expms;
          } else {
            this.gatewayApiHandler.cleanupSession(sessionState);
            cleanupSessionGeneric(sessionState);
          }
          sessionState.authenticated = zosmfResult.success;
          if (this.usingZss && zosmfResult.success) {
            // Also authenticate to ZSS for RBAC authorization support.
            this.zssHandler.authenticate(request, sessionState).then((zssResult)=> {
              // _mergeAuthenticate already calls _insertHandlerStatus internally.
              resolve(this._mergeAuthenticate(zssResult, zosmfResult, sessionState));
            }).catch(()=> {
              // ZSS failure is non-fatal when z/OSMF already succeeded.
              resolve(this._insertHandlerStatus(zosmfResult));
            });
          } else {
            resolve(this._insertHandlerStatus(zosmfResult));
          }
        }).catch((e)=> {
          this.gatewayApiHandler.cleanupSession(sessionState);
          cleanupSessionGeneric(sessionState);
          reject(e);
        });
      } else if (this.usingSso || !this.usingZss) {
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
              /*
               * ZSS-only path: issue a local RS256 JWT so ZSS can work with it.
               * The JWT is returned as an additional cookie alongside the ZSS session
               * cookie already in zssResult.cookies.
               */
              const jwt = localJwt.createLocalJwt(
                sessionState.username,
                zssResult.expms || localJwt.DEFAULT_EXPIRATION_MS,
                this.keyMaterial
              );
              sessionState.localJwtToken = jwt;
              sessionState.localJwtExpMs = Date.now() + (zssResult.expms || localJwt.DEFAULT_EXPIRATION_MS);
              const jwtCookie = {
                name: localJwt.TOKEN_NAME,
                value: jwt,
                options: localJwt.TOKEN_COOKIE_OPTIONS
              };
              const merged = Object.assign({}, zssResult, {
                cookies: (zssResult.cookies || []).concat([jwtCookie])
              });
              this.logger.debug('Issued local JWT for ZSS-authenticated user %s', sessionState.username);
              resolve(this._insertHandlerStatus(merged));
              return;
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

  _mergeCookies(zss, apiml) {
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
    return cookies;
  },
  
  _mergeAuthenticate(zss, apiml, sessionState) {
    const now = Date.now();
    //mixed success = failure, complete success = figure out expiration
    if (!apiml.success || !zss.success) {
      this.apimlHandler.cleanupSession(sessionState);
      this.zssHandler.cleanupSession(sessionState);
      cleanupSessionGeneric(sessionState);
      // TODO: Modify the reason below depending upon the message sent from the zssHandler for the case of expired password
      if(zss.reason && zss.reason.includes('Expired Password')) {
        return this._insertHandlerStatus(zss);
      }
      return this._insertHandlerStatus(!apiml.success ? apiml : zss);
    } else {
      sessionState.authenticated = true;
      let shortestExpms = Math.min(zss.expms, apiml.expms);
      sessionState.sessionExpTime = sessionState.sessionExpTime
        ? Math.min(sessionState.sessionExpTime, now+shortestExpms)
        : now+shortestExpms;
      const cookies = this._mergeCookies(zss, apiml);
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
      if (this.usingZosmf) {
        return this.gatewayApiHandler.authorized(request, sessionState, options);
      }
      return this.apimlHandler.authorized(request, sessionState, options);
    } else {
      return this.zssHandler.authorized(request, sessionState, options);
    }
  },
  
  addProxyAuthorizations(req1, req2Options, sessionState) {
    if (this.usingApiml) {
      this.apimlHandler.addProxyAuthorizations(req1, req2Options, sessionState, this.usingSso);
    }
    // zssHandler must run before gatewayApiHandler: zssHandler seeds the cookie header
    // with req1.headers['cookie'] via assignment; gatewayApiHandler then *appends* the
    // z/OSMF native cookie to whatever is already there.  Running gatewayApiHandler
    // first and zssHandler second would overwrite the appended cookie.
    if (this.usingZss && !this.usingSso) {
      this.zssHandler.addProxyAuthorizations(req1, req2Options, sessionState);
    }
    if (this.usingZosmf) {
      this.gatewayApiHandler.addProxyAuthorizations(req1, req2Options, sessionState);
    }
  },

  restoreSessionState(request, sessionState) {
    if (this.usingSso) {
      return this.apimlHandler.restoreSessionState(request, sessionState);
    }
    if (this.usingZosmf) {
      return this.gatewayApiHandler.restoreSessionState(request, sessionState);
    }
    return Promise.resolve();
  },

  generateHaSessionId (request) {
    const TOKEN_NAME = 'apimlAuthenticationToken';
    if (request.cookies && request.cookies[TOKEN_NAME]) {
      return request.cookies[TOKEN_NAME];
    }
    return;
  },

  /*
   * Validates an apimlAuthenticationToken JWT and returns its claims.
   *
   * @param {string} token - the raw JWT string
   * @returns {Promise<{userId: string, creation: number, expiration: number}>}
   */
  queryJWT(token) {
    if (this.usingZosmf && this.gatewayApiHandler) {
      return this.gatewayApiHandler.queryToken(token);
    }
    if (this.keyMaterial) {
      return new Promise((resolve, reject) => {
        const payload = localJwt.verifyLocalJwt(token, this.keyMaterial);
        if (!payload || !payload.sub) {
          reject(new Error('Invalid or tampered zlux-local JWT'));
          return;
        }
        localJwt.isTokenRevoked(token, this.logger).then((revoked) => {
          if (revoked) {
            reject(new Error('Token has been revoked'));
            return;
          }
          const now = Date.now();
          const creation   = payload.iat ? payload.iat * 1000 : now;
          const expiration = payload.exp * 1000;
          if (expiration <= now) {
            reject(new Error('Token has expired'));
            return;
          }
          resolve({ userId: payload.sub, creation, expiration });
        });
      });
    }
    return Promise.reject(new Error('No JWT-capable handler available in this configuration'));
  },

  /*
   * Returns a JWK Set ({ keys: [...] }) containing the RSA public key(s)
   */
  getJwkSet() {
    if (this.usingZosmf && this.gatewayApiHandler) {
      return this.gatewayApiHandler.getJwkSet();
    }
    if (this.keyMaterial) {
      return Promise.resolve({ keys: [localJwt.derivePublicJwk(this.keyMaterial)] });
    }
    return Promise.reject(new Error('No JWK-capable handler available in this configuration'));
  },

  generatePassTicket(request, sessionState, applicationName) {
    if (!this.usingZss) {
      return Promise.reject(new Error('ZWED0210E - No PassTicket-capable handler available'));
    }
    return this.zssHandler.requestPassTicket(request, sessionState, applicationName);
  }
};

module.exports = function (pluginDef, pluginConf, serverConf, context, zoweConf) {
  return Promise.resolve(new SsoAuthenticator(pluginDef, pluginConf, serverConf, context, zoweConf));
}
