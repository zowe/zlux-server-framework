/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

const Promise = require('bluebird');
const https = require('https');
const fs = require('fs');

/*495 minutes default session length for zosmf
 * TODO: This is the session length of a zosmf session according to their documentation.
 * However, it is not clear if that is configurable or if APIML may use a different value under other circumstances
 */
const DEFAULT_EXPIRATION_MS = 29700000;

function readUtf8FilesToArray(fileArray) {
  var contentArray = [];
  for (var i = 0; i < fileArray.length; i++) {
    const filePath = fileArray[i];
    try {
      var content = fs.readFileSync(filePath);
      if (content.indexOf('-BEGIN CERTIFICATE-') > -1) {
        contentArray.push(content);
      }
      else {
        content = fs.readFileSync(filePath, 'utf8');
        if (content.indexOf('-BEGIN CERTIFICATE-') > -1) {
          contentArray.push(content);
        }
        else {
          this.logger.warn('Error: file ' + filePath + ' is not a certificate')
        }
      }
    } catch (e) {
      this.logger.warn('Error when reading file=' + filePath + '. Error=' + e.message);
    }
  }

  if (contentArray.length > 0) {
    return contentArray;
  } else {
    return null;
  }
}


class ApimlHandler {
  constructor(pluginDef, pluginConf, serverConf, context) {
    this.logger = context.logger;    
    this.apimlConf = serverConf.node.mediationLayer.server;    
    this.gatewayUrl = `https://${this.apimlConf.hostname}:${this.apimlConf.gatewayPort}`;

    if (serverConf.node.https.certificateAuthorities === undefined) {
      this.logger.warn("This server is not configured with certificate authorities, so it will not validate certificates with APIML");
      this.httpsAgent = new https.Agent({
        rejectUnauthorized: false
      });
    } else {
      this.httpsAgent = new https.Agent({
        rejectUnauthorized: true,
        ca: readUtf8FilesToArray(serverConf.node.https.certificateAuthorities)
      });
    }
  }

  logout(request, sessionState) {
    return new Promise((resolve, reject) => {
      const gatewayUrl = this.gatewayUrl;
      const options = {
        hostname: this.apimlConf.hostname,
        port: this.apimlConf.gatewayPort,
//TODO uncertainty about using apicatalog route instead of something part of the gateway itself
        path: '/api/v1/apicatalog/auth/logout',
        method: 'POST',
        headers: {
          'apimlAuthenticationToken': sessionState.apimlToken
        },
        agent: this.httpsAgent
      }

      const req = https.request(options, (res) => {
        res.on('data', (d) => {});
        res.on('end', () => {
          let apimlCookie;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true });
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
        this.logger.warn("APIML logout has failed:");
        this.logger.warn(error);
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
      req.end();
    });
  }

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
    return new Promise((resolve, reject) => {
      const gatewayUrl = this.gatewayUrl;
      const data = JSON.stringify({
        username: request.body.username,
        password: request.body.password
      });
      const options = {
        hostname: this.apimlConf.hostname,
        port: this.apimlConf.gatewayPort,
        path: '/api/v1/apicatalog/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        },
        agent: this.httpsAgent
      }

      const req = https.request(options, (res) => {
        res.on('data', (d) => {});
        res.on('end', () => {
          let apimlCookie;
          if (res.statusCode == 204) {
            if (typeof res.headers['set-cookie'] === 'object') {
              for (const cookie of res.headers['set-cookie']) {
                const content = cookie.split(';')[0];
                if (content.indexOf('apimlAuthenticationToken') >= 0) {
                  apimlCookie = content;
                }
              }
            }
          }

          if (apimlCookie) {
            sessionState.username = request.body.username;
            sessionState.apimlCookie = apimlCookie;
            sessionState.apimlToken = apimlCookie.split("=")[1];
            resolve({ success: true, username: sessionState.username, expms: DEFAULT_EXPIRATION_MS });
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
        this.logger.warn("APIML login has failed:");
        this.logger.warn(error);
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
  }

  cleanupSession(sessionState) {
    delete sessionState.apimlToken;
    delete sessionState.apimlCookie;
  }

  /**
   * Invoked for every service call by the middleware.
   *
   * Checks if the session is valid in a stateful scheme, or authenticates the
   * request in a stateless scheme. Then checks if the user can access the
   * resource.  Modifies the request if necessary.
   *
   * `sessionState` is this plugin's private storage within the session (if
   * stateful)
   *
   * The promise should resolve to an object containing, at least,
   * { authorized: true } if everything is fine. Should not reject the promise.
   */
  authorized(request, sessionState) {
    if (sessionState.authenticated) {
      request.username = sessionState.username;
      request.ssoToken = sessionState.apimlToken;
      return Promise.resolve({ authenticated: true, authorized: true });
    } else {
      return Promise.resolve({ authenticated: false, authorized: false });
    }
  }

  addProxyAuthorizations(req1, req2Options, sessionState, usingSso) {
    if (!sessionState.apimlCookie) {
      return;
    }
    //apimlToken vs apimlAuthenticationToken ???
    req2Options.headers['apimlToken'] = sessionState.apimlToken;
    if (this.usingSso) {
      req2Options.headers['Authorization'] = 'Bearer '+sessionState.apimlToken;
    }
  }  
}

module.exports = function(pluginDef, pluginConf, serverConf, context) {
  return new ApimlHandler(pluginDef, pluginConf, serverConf, context);
}
