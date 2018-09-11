function extractBasicAuthCredentials(request) {
  const headers = request.headers;
  const authorizationHeader = headers['authorization'];
  console.log('Login request handler saw request on url: '
      + request.originalUrl);
  if (!authorizationHeader) {
    console.log('Bad request for url: ' + request.originalUrl
        + ', headers: ' + JSON.stringify(headers, null, 2));
    return null;
  }
  // the original auth looks like "Basic Y2hhcmxlczoxMjM0NQ==" 
  const tmp = authorizationHeader.split(' ');  
  const buf = new Buffer(tmp[1], 'base64');  
  const plain_auth = buf.toString();         
  const creds = plain_auth.split(':');       
  if (creds.length <= 1) {
    return null;
  } 
  return creds;
}

function TrivialAuthenticator(pluginDef, pluginConf, serverConf) {
  this.authPluginID = 'com.rs.auth.trivialAuth'
}

TrivialAuthenticator.prototype = {

  getStatus(sessionState) {
    return {  
      authenticated: true 
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
    sessionState.username = request.body.username;
    console.log('sessionState.username: ', sessionState.username);
    return Promise.resolve({ success: true });
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
    console.log('sessionState.username: ', sessionState.username);
    if (sessionState.username) {
      return Promise.resolve({  authenticated: true, authorized: true });
    }
    const creds = extractBasicAuthCredentials(request);
    if (!creds) {
      return Promise.resolve({
        authenticated: false,
        authorized: false,
        message: "Missing username or password"
      });
    }
    const username = creds[0];
    const password = creds[1];
    if (!(username && password)) {
      return Promise.resolve({
        authenticated: !!username,
        authorized: false,
        message: "Missing username or password"
      });
    }
    return Promise.resolve({  authenticated: true, authorized: true });
  }, 
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


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
