/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

const Promise = require('bluebird');
const https = require('https');

const TOKEN_NAME = 'apimlAuthenticationToken';
const TOKEN_LENGTH = TOKEN_NAME.length;

function TrivialAuthenticator(pluginDef, pluginConf, serverConf) {
  this.apimlConf = serverConf.node.mediationLayer.server;    
  this.gatewayUrl = `https://${this.apimlConf.hostname}:${this.apimlConf.gatewayPort}`;
  this.authPluginID = pluginDef.identifier;
  this.capabilities = {
    "canGetStatus": true,
    "canRefresh": true,
    "canAuthenticate": true,
    "canAuthorize": true,
    "proxyAuthorizations": false,
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
      return Promise.resolve({ success: true });
    } else if (request.cookies && request.cookies[TOKEN_NAME]) {
      return this.authenticateViaCookie(request, sessionState);
    } else {
      return Promise.resolve({ success: false });
    }
  },

  makeOptions(path, method, cookie, dataLength) {
    let headers = undefined;
    if (cookie) {
      headers = {'cookie': cookie};
    }
    if (dataLength) {
      if (!headers) {headers = {};}
      headers['Content-Type']= 'application/json';
      headers['Content-Length']= dataLength;
    }
    
    return {
      hostname: this.apimlConf.hostname,
      port: this.apimlConf.gatewayPort,
      path: path,
      method: method,
      headers: headers,
      agent: this.httpsAgent
    };
  },

    /**
     Data in the form of
     {
     "domain": "PRODUCTION",
     "userId": "DAVE",
     "creation": 1497030118362,
     "expiration": 1497116518362
     }
     Or, creation and expiration may be a timezone string like:
     "2020-03-21T15:44:27.000+0000"
  **/
     queryToken(token) {
      return new Promise((resolve, reject) => {
        const options = this.makeOptions('/api/v1/gateway/auth/query',
                                         'GET',
                                         TOKEN_NAME+'='+token);
        
        let data = [];
        const req = https.request(options, (res) => {
          res.on('data', (chunk) => data.push(chunk));
          res.on('end', () => {
            if (res.statusCode == 200) {
              if (data.length > 0) {
                try {
                  const dataJson = JSON.parse(Buffer.concat(data).toString());
                  resolve(dataJson);
                } catch (e) {
                  reject(new Error('Could not parse body as JSON'));
                }
              } else {
                reject(new Error('No body in response'));
              }
            } else {
              reject(new Error('Status code:'+res.statusCode));
            }
          });
        });
  
        req.on('error', (error) => {
          reject(error);
        });
        req.end();
      });
    },

    doLogin(request, sessionState) {
      return new Promise((resolve, reject) => {
        const gatewayUrl = this.gatewayUrl;
        const data = JSON.stringify({
          username: request.body.username,
          password: request.body.password
        });
        const options = this.makeOptions('/api/v1/gateway/auth/login','POST', undefined, data.length);
  
        const req = https.request(options, (res) => {
          res.on('data', (d) => {});
          res.on('end', () => {
            let token;
            if (res.statusCode == 204) {
              if (typeof res.headers['set-cookie'] === 'object') {
                for (const cookie of res.headers['set-cookie']) {
                  const content = cookie.split(';')[0];
                  let index = content.indexOf(TOKEN_NAME);
                  if (index >= 0) {
                    token = content.substring(index+1+TOKEN_LENGTH);
                  }
                }
              }
            }
            if (token) {
              this.queryToken(token).then(data=> {
                let expiration;
                const expirationDate = new Date(data.expiration);
                const creationDate = new Date(data.creation);
                if (creationDate.getTime() > expirationDate.getTime()) {
                  expiration = -1;
                } else {
                  const now = new Date();
                  expiration = expirationDate.getTime() - now.getTime();
                }
                if (expiration > 0) {
                  sessionState.username = data.userId;
                  sessionState.authenticated = true;
                  resolve({ success: true, username: sessionState.username, expms: expiration,
                            cookies: [{name:TOKEN_NAME, value:token, options: {httpOnly: true, secure: true}}]});
                } else {
                  resolve({ success: false, reason: 'Unknown'});
                }
              }).catch(e=> {
                reject({ success: false, reason: 'Unknown', error: {message:e.message.toString()}});
              });
              return;
            } else {
              let response = {
                success: false,
                reason: 'Unknown',
                error: {
                  message: `APIML ${res.statusCode} ${res.statusMessage}`
                }
              };
              //Seems that when auth is first called, it may not be loaded yet, so you get a 405.
              if (res.statusCode == 405) {
                response.reason = 'TryAgain';
              }
              resolve(response);
              return;
            }
          });
        });
  
        req.on('error', (error) => {
          var details = error.message;
          if ((error.response !== undefined) && (error.response.data !== undefined)) {
            details = error.response.data;
          }
          resolve({
            success: false,
            reason: 'Unknown',
            error: { message: `APIML ${details}`}
          });
          return;
        });
  
        req.write(data);
        req.end();
      });
    },

  authenticateViaCookie(request, sessionState) {
    return new Promise((resolve, reject)=> {
      this.queryToken(request.cookies[TOKEN_NAME]).then(data=> {
        let expiration;
        const expirationDate = new Date(data.expiration);
        const creationDate = new Date(data.creation);
        if (creationDate.getTime() > expirationDate.getTime()) {
          expiration = -1;
        } else {
          const now = new Date();
          expiration = expirationDate.getTime() - now.getTime();
        }
        if (expiration < 1) {
          this.doLogin(request, sessionState).then(result=> resolve(result))
            .catch(e => reject(e));
        } else {
          sessionState.username = data.userId;
          sessionState.authenticated = true;
          resolve({success: true, username: sessionState.username, expms: expiration});
        }
      }).catch(e=> {
        this.doLogin(request, sessionState).then(result=> resolve(result))
          .catch(e => reject(e));
      });
    });
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
    return; //trivially, adds no new authorization
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
