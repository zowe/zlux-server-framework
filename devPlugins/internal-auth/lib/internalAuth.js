

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';
const fs = require('fs');
var jsonUtils = require('../../../lib/jsonUtils.js');
const encryption = require('../../../lib/encryption.js');
const internalKey = "kGk3CfvnbqkIEyPEnrNe6fDllVByfneolThLZ47PRwgKLB";

/*
TODO: have an encrypted or unencrypted config file for specifying the priviledges of users
userRoles.json
{
  'mike': ['instanceAdmin','scopeAdmin']
}

Then have a file that defines these roles:
roleDefinitions.json
{
  'instanceAdmin' : {
    instance: ['PUT', 'DELETE']
  }
}
*/


function internalAuthenticator(pluginDef, pluginConf, serverConf) {
  this.pluginDefinition = pluginDef;
  this.serverConfiguration = serverConf;
  if (pluginConf) {
    this.pluginConfiguration = pluginConf;    
    this.authConfig = {
      userRoles: pluginConf.getContents(['userRoles.json']),
      roleDefinitions: pluginConf.getContents(['roleDefinitions.json']),
      resources: pluginConf.getContents(['resources.json'])
    };
  }
  this.capabilities = {
    "canGetStatus": false,
    "canRefresh": false,
    "canAuthenticate": true,
    "canAuthorize": true,
    "proxyAuthorizations": false
  };
}

internalAuthenticator.prototype.getCapabilities = () => {return this.capabilities};

/*access requested is one of GET,PUT,POST,DELETE*/
internalAuthenticator.prototype.authorized = function(override,userName,resourceName,success,failure) {
  if (userName) {
    var userRoles = this.authConfig.userRoles[userName];
    var resourceAccess = this.authConfig.resources[resourceName];
    if (resourceAccess) {
      let roles = resourceAccess.roles;
      if (roles) {
        //sort to optimize later
        for (let i = 0; i < roles.length; i++) { 
          if (roles[i] == '*') {
            return success();
          }
          else if (userRoles) {
            for (let j = 0; j < userRoles.length; j++) {
              if (roles[i] == userRoles[j]) {
                return success();
              }
            }
          }
        }
      }
      let users = resourceAccess.users;
      if (users) {
        //sort to optimize later
        for (let i = 0; i < users.length; i++) {
          if (users[i] == userName) {
            return success();
          }
          else if (users[i] == '*') {
            return success();
          }
        }          
      }
    }
    else {
      return failure('Resource was not found');
    }
  }
  else {
    return failure('User was not found');
  }
  return failure('');
};

/*
here: pluginconf or override can have information about what user has write access to what scopes.
if not present, they only have access to their own user.

i think i need plugin config because:
1. location overrides for files
2. defaults


i think i need the override because:
1. someone requests account creation
2. account creation requires a certain level of access
3. basic authentication only covers if your credentials are what you claim they are
4. override can say what level of access is needed for the command to be used
*/
internalAuthenticator.prototype.authenticate = function(override, request, body, success, failure) {  
  var headers = request.headers;
  var authorizationHeader = headers['authorization'];
  var configuration = this.authConfig;
  console.log('Login request handler saw request on url: '+request.originalUrl+', with body: '+body);
  if(authorizationHeader){
   
    var tmp = authorizationHeader.split(' ');   // Split on a space, the original auth looks like  "Basic Y2hhcmxlczoxMjM0NQ==" and we  
    
    var buf = new Buffer(tmp[1], 'base64'); // create a buffer and tell it the data coming in is base64
        
    var plain_auth = buf.toString();        // read it back out as a string
         
  
    var creds = plain_auth.split(':');      // split on a ':'
    var username = creds[0];
    var password = creds[1];
    
    var defaultCredentialLocation = this.serverConfiguration.usersDir + '/' + username + '/' + this.serverConfiguration.productCode + '/account/login.json';
    //default could be overriden via plugin config perhaps
    var userLoginDataFile = defaultCredentialLocation;
    if(fs.existsSync(userLoginDataFile)){
      
      var userLoginData = jsonUtils.parseJSONWithComments(userLoginDataFile);
      if(userLoginData && userLoginData.username && userLoginData.authentication && userLoginData.iv && userLoginData.salt){
        if (userLoginData.username === username) {
          try {
            let iv = encryption.decryptWithKey(userLoginData.iv,internalKey);
            let salt = encryption.decryptWithKey(userLoginData.salt,internalKey);
            encryption.getKeyFromPassword(password,salt,32,(key)=>{
              try {
                let result = encryption.decryptWithKeyAndIV(userLoginData.authentication,key,iv);
                if (result === password) {
                  var authInfo = {
                    username: username
                  };
                  if (configuration.userRoles) {
                    var userRoles = configuration.userRoles[username];
                    if (userRoles && userRoles.length > 0) {
                      authInfo.roles = userRoles;
                    }
                  }
                  success(authInfo);
                }else{
                  failure();
                }
              } catch (e) {
                failure();
              }
            });
          } catch (e) {
            failure();
          }
        }else{
          failure();
        }
      }else{
        failure(); //user does not exist
      }
    }else{
      failure(); //user does not exist
    }
  }else{
    failure();
  }
};

exports.internalAuthInstaller = function(pluginDefinition, pluginConfiguration, serverConfiguration) {
  return new internalAuthenticator(pluginDefinition, pluginConfiguration, serverConfiguration);
};


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

