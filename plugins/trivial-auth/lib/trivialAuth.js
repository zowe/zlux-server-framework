/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

const apiml = require('../../../lib/apiml.js');
const TOKEN_NAME = 'apimlAuthenticationToken';

function TrivialAuthenticator(pluginDef, pluginConf, serverConf) {
  this.authPluginID = pluginDef.identifier;
  this.capabilities = {
    "canGetStatus": true,
    "canRefresh": true,
    "canAuthenticate": true,
    "canAuthorize": true,
    "proxyAuthorizations": true,
    "canResetPassword": false
  };
}

TrivialAuthenticator.prototype = {

  getCapabilities(){
    return this.capabilities;
  },

  getStatus(sessionState) {
    return {
      username: sessionState.username,
      authenticated: !!sessionState.username
    };
  },
    
  /**
   * Should be called e.g. when the users enters credentials
   * 
   * Supposed to change the state of the client-server session. NOP for 
   * stateless authentication (e.g. HTTP basic). 
   * 
   * `request` must be treated as read-only by the code. `sessionState` is this
   * plugin's private storage within the session (if stateful)
   * 
   * If auth doesn't fail, should return an object containing at least 
   * { success: true }. Should not reject the promise.
   */ 
  authenticate(request, sessionState) {
    if (request.body && request.body.username) {
      sessionState.username = request.body.username;
      sessionState.authenticated = true;
      // Store credentials for proxy auth to ZSS (dev/test only)
      // ZSS in single-user mode expects uppercase credentials in the auth blob
      if (request.body.password) {
        sessionState._basicAuth = Buffer.from(
          request.body.username.toUpperCase() + ':' + request.body.password.toUpperCase()
        ).toString('base64');
      }
      return Promise.resolve({ success: true });
    } else if (request.cookies && request.cookies[TOKEN_NAME]) {
      try{
        sessionState.username = apiml.getUserId(request.cookies[TOKEN_NAME]);
      } catch (e) {
        return Promise.resolve({ success: false });
      }
      sessionState.authenticated = true;
      return Promise.resolve({ success: true })
    } else {
      return Promise.resolve({ success: false });
    }
  },
  
  refreshStatus(request, sessionState) {
    const result = !!sessionState.username;
    sessionState.authenticated = result;
    return Promise.resolve({ success: result });
  },  

  /**
   * Invoked for every service call by the middleware.
   * 
   * Checks if the session is valid in a stateful scheme, or authenticates the
   * request in a stateless scheme. Then checks if the user can access the
   * resource. Modifies the request if necessary.
   * 
   * `sessionState` is this plugin's private storage within the session (if
   *  stateful)
   * 
   * The promise should resolve to an object containing, at least, 
   * { authorized: true } if everything is fine. Should not reject the promise.
   */
  authorized(request, sessionState) {
    if (sessionState.username) {
      request.username = sessionState.username;
      return Promise.resolve({  authenticated: true, authorized: true });
    }
    return Promise.resolve({
      authenticated: false,
      authorized: false,
      message: "Missing username or password"
    });
  },

  addProxyAuthorizations(req1, req2Options, sessionState) {
    // Forward Basic auth credentials to ZSS for proxied requests
    if (sessionState && sessionState._basicAuth) {
      if (!req2Options.headers) {
        req2Options.headers = {};
      }
      req2Options.headers['Authorization'] = 'Basic ' + sessionState._basicAuth;
    }
  }
};

module.exports = function(pluginDef, pluginConf, serverConf) {
  return Promise.resolve(new TrivialAuthenticator(pluginDef, pluginConf, 
      serverConf));
}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
