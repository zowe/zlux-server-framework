

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

//"use strict";
const fs = require('fs');
const jStreamer = require('./jsonStreamer.js');
const pathModule = require('path');
const jsonUtils = require('../../../lib/jsonUtils.js');
const proxyUtils = require('../../../lib/util.js');
const express = require('express');
const Promise = require('bluebird');
const bodyParser = require('body-parser');
const obfuscator = require ('../../../../zlux-shared/src/obfuscator/htmlObfuscator.js');

const htmlObfuscator = new obfuscator.HtmlObfuscator();

//Buffer comes from node global.

ConfigService.pluginId = '';

var logger = global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.bootstrap.config"); //replaced after startup
var accessLogger;

const AGGREGATION_POLICY_NONE = 0;
const AGGREGATION_POLICY_OVERRIDE = 1;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_NO_CONTENT = 204;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;
const HTTP_STATUS_METHOD_NOT_FOUND = 405;
const HTTP_STATUS_NOT_IMPLEMENTED = 501;

const CONFIG_SCOPE_USER = 1;
const CONFIG_SCOPE_GROUP = 2;
const CONFIG_SCOPE_INSTANCE = 3;
const CONFIG_SCOPE_SITE = 4;
const CONFIG_SCOPE_PRODUCT = 5;

const PERMISSION_DEFAULT_FORBID = 0;
const PERMISSION_DEFAULT_ALLOW = 1;

const CURRENT_JSON_VERSION = "0.8.6";

//a file
const MSG_TYPE_RESOURCE = "org.zowe.configjs.resource";
//contents of a folder
const MSG_TYPE_RESOURCESET = "org.zowe.configjs.resourceset";
//names of contents in folder
const MSG_TYPE_RESOURCESET_LISTING = "org.zowe.configjs.resourceset.listing";
//names of folders
const MSG_TYPE_SUBRESOURCE_LISTING = "org.zowe.configjs.subresource.listing";

const MSG_TYPE_ERROR = "org.zowe.configjs.error";
const MSG_TYPE_UPDATE = "org.zowe.configjs.resource.update";
const MSG_TYPE_DELETE = "org.zowe.configjs.delete";





const jsonFileReadOptions = {
  encoding: 'utf8', //TODO but it wouldnt be on zos probably.
  "flag" : 'r'
};

function respondWithJsonError(response,error,code,resourceID) {
  let jsonObj = proxyUtils.makeErrorObject({
    messageTemplate: error,
    messageParameters: {
      resourceID
    },
    messageDetails: error
  });
  response.status(code).json(jsonObj);
}

function respondWithError(response,code,statusMessage) {
  response.status(code).send(statusMessage);
}

function finishResponse(response) {
  response.end();
}

function htCreate() {
  return {};
}

function htGet(table,key) {
  return table[key];
}

function htPut(table,key,value) {
  table[key] = value;
  return table;
}

function percentEncode(value){
  if (typeof value != 'string') {
    logger.warn(`Cannot percent encode non-string value`);
    return null;
  }
  if (ConfigService.directoryTrace && ConfigService.traceLevel > 1) {
    logger.debug("Percent encode for value="+value);
  }
  var i;
  var pos = 0;
  var buffer = '';

  for (i=0; i<value.length; i++){
    var c = value.charAt(i);
    switch(c) {
      case ' ':
        buffer+= '%';
        buffer+= '2';
        buffer+= '0';
        break;
      case '!':
        buffer+= '%';
        buffer+= '2';
        buffer+= '1';
        break;
      case '"':
        buffer+= '%';
        buffer+= '2';
        buffer+= '2';
        break;
      case '#':
        buffer+= '%';
        buffer+= '2';
        buffer+= '3';
        break;
      case '%':
        buffer+= '%';
        buffer+= '2';
        buffer+= '5';
        break;
      case '&':
        buffer+= '%';
        buffer+= '2';
        buffer+= '6';
        break;
      case '\'':
        buffer+= '%';
        buffer+= '2';
        buffer+= '7';
        break;
      case '*':
        buffer+= '%';
        buffer+= '2';
        buffer+= 'A';
        break;
      case '+':
        buffer+= '%';
        buffer+= '2';
        buffer+= 'B';
        break;
      case ',':
        buffer+= '%';
        buffer+= '2';
        buffer+= 'C';
        break;
      case ':':
        buffer+= '%';
        buffer+= '3';
        buffer+= 'A';
        break;
      case ';':
        buffer+= '%';
        buffer+= '3';
        buffer+= 'B';
        break;
      case '<':
        buffer+= '%';
        buffer+= '3';
        buffer+= 'C';
        break;
      case '=':
        buffer+= '%';
        buffer+= '3';
        buffer+= 'D';
        break;
      case '>':
        buffer+= '%';
        buffer+= '3';
        buffer+= 'E';
        break;
      case '?':
        buffer+= '%';
        buffer+= '3';
        buffer+= 'F';
        break;
      case '[':
        buffer+= '%';
        buffer+= '5';
        buffer+= 'B';
        break;
      case '\\':
        buffer+= '%';
        buffer+= '5';
        buffer+= 'C';
        break;
      case ']':
        buffer+= '%';
        buffer+= '5';
        buffer+= 'D';
        break;
      case '^':
        buffer+= '%';
        buffer+= '5';
        buffer+= 'E';
        break;
      case '`':
        buffer+= '%';
        buffer+= '6';
        buffer+= '0';
        break;
      case '{':
        buffer+= '%';
        buffer+= '7';
        buffer+= 'B';
        break;
      case '|':
        buffer+= '%';
        buffer+= '7';
        buffer+= 'C';
        break;
      case '}':
        buffer+= '%';
        buffer+= '7';
        buffer+= 'D';
        break;
      default:
        buffer+= c;
        break;
    }
  }
  return buffer;
}

function tableMap(table, visitor, visitorArgument) {
  var keyArray = Object.keys(table);
  var key;
  for (var i = 0; i < keyArray.length; i++) {
    key = keyArray[i];
    visitor(visitorArgument,key, table[key]);
  }
}

function tableMapForAsyncVisitor(table, visitor, visitorArgument, callback) {
  var keyArray = Object.keys(table);
  if (keyArray.length == 0) {
    callback(-1);
  }
  var index = 0;  
  var key = keyArray[index];
  let results = {};
  var execute = function() {
    visitor(visitorArgument,key,table[key],(result)=> {
      index++;
      if (result) {results.key = result;}
      if (index == keyArray.length) {
        callback(results);
      }
      else {
        key = keyArray[index];
        execute();
      }
    });
  };
  execute();
}


function jsonObjectGetObject(parent, name) {
  var property = parent[name];
  if ((typeof property) == 'object') {
    return property;
  }
  return null;
}

function jsonObjectGetFirstProperty(jsonObject) {
  if (jsonObject) {
    var keyArray = Object.keys(jsonObject);
    if (keyArray.length > 0) {
      return jsonObject[keyArray[0]];
    }
    return null;
  }
  return null;
}

function jsonObjectGetBoolean(jsonObject,name) {
  var value = jsonObject[name];
  if ((typeof value) == 'boolean') {
    return value;
  }
  return false;
}

function jsonObjectGetString(jsonObject,name) {
  var value = jsonObject[name];
  if ((typeof value) == 'string') {
    return value;
  }
  return null;
}

function getUserId(request){
  var userId = request.query.userId;
  if (userId != null){
    return userId;
  }else{
    logger.log(logger.FINER,"UserId not specified as part of the HttpRequest ");
  }
  return null;
};

function getPluginId(request) {
  var pluginId = request.query.pluginId;
  if (pluginId != null){
    return pluginId;
  }else{
    logger.log(logger.FINER,"pluginId not specified as part of the HttpRequest ");
  }
  return null;
};

function getFileName(request){
  var fileName = request.query.fileName;
  if (fileName != null){
    if( fileName.indexOf('/') == -1 ){
      return fileName;
    }else{
      logger.debug("fileName cannot have '/' special character ");
    }
  }else{
    logger.debug("fileName not specified as part of the HttpRequest ");
  }
  return null;
}

function getPlugin(webPluginList, pluginId){
  var webPlugins = webPluginList;
  var plugin;
  while (webPlugins) {
    if(webPlugins.plugin.identifier === pluginId){
      plugin = webPlugins.plugin;
      break;
    }
    webPlugins = webPlugins.next;
  }
  return plugin;
}

//TODO what is sane here?
//note use strict cant handle octal literals except in harmony mode. 488=0o700 unix permission.
var unixPermissionMode = 488;


function createMissingFolder(resourcePath, scopeDirectory){
  var pathName = null;
  if (resourcePath) {
    pathName = scopeDirectory+'/'+resourcePath;
  }
  else {
    pathName = scopeDirectory;
  }
  
  //Note: node recommends not checking for the existence of a directory or file, and instead just attempting to create it and handling the error if it already exists.
  logger.debug('About to call mkdir on path='+pathName);
  try {
    fs.mkdirSync(pathName,unixPermissionMode);
    logger.debug(`Directory ${pathName} created `);
  }
  catch (e) {
    if (e.code != 'EEXIST') {//disregard existing folder error, it is expected
      logger.warn('Could not create directory, error='+e.message);
    }
  }
}

function createMissingFolderAsync(resourcePath, scopeDirectory, callback){
  var pathName = null;
  if (resourcePath) {
    pathName = scopeDirectory+'/'+resourcePath;
  }
  else {
    pathName = scopeDirectory;
  }
  
  //Note: node recommends not checking for the existence of a directory or file, and instead just attempting to create it and handling the error if it already exists.
  logger.debug('About to call mkdir on path='+pathName);

  fs.mkdir(pathName,unixPermissionMode,(err)=>{
    if (!err) {
      logger.debug(`Directory ${pathName} created `);
    }
    else {
      if (err.code != 'EEXIST') {//its expected for a folder to exist. its fine
        logger.warn('Could not create directory, error='+err);
      }
    }
    callback();    
  });
}


function encodeDirectoryName(inputName){
  var resourceLength = inputName.length;
  var percentEncodedResource = percentEncode(inputName,percentEncodedResource,resourceLength);

  return percentEncodedResource;
}

function createMissingFolders(lastPath, pluginID, currentResource, resourceRequested, directories){
  logger.debug('Creating missing folders. Path='+lastPath+'.');
  logger.log(logger.FINER,'Creating missing folders. Directories Object='+JSON.stringify(directories));
  var locationType = currentResource.locationType;//jsonObjectGetString(currentResource, "locationType");
  if (locationType) {
    if (locationType.toLowerCase() === "absolute") {
      logger.warn("Absolute path for configuration folders not yet handled, will use relative pathing");
      //TODO handle locationtype relative.
    }
  }

  var encodedResourceName = encodeDirectoryName(resourceRequested);
  var newPath = null;
  var newPathLen = 0;
  if (!lastPath) {
    var encodedPluginName = encodeDirectoryName(pluginID);
    if (directories.usersDir) {
      createMissingFolder(encodedPluginName,directories.usersDir);
    }
    createMissingFolder(encodedPluginName,directories.instanceDir);
    createMissingFolder(encodedPluginName,directories.siteDir);

    newPath = encodedPluginName+'/'+encodedResourceName;
  }
  else {
    newPath = lastPath+'/'+encodedResourceName;
  }
  logger.debug("Set path to "+lastPath);
  if (directories.usersDir) {
    createMissingFolder(newPath,directories.usersDir);
  }
  if (directories.groupsDir) {
    createMissingFolder(newPath,directories.groupsDir);
  }

  createMissingFolder(newPath,directories.instanceDir);
  createMissingFolder(newPath,directories.siteDir);
  //do not create a product directory folder.

  return newPath;
}

function fdCloseOnError(err, fd, path, callback) {
  if (err.code != 'ENOENT') {
    logger.warn('Exception when reading file. File='+path+'. Error='+err.message);
    callback(null);
  } else {
    logger.debug('Exception when reading file. File='+path+'. Error='+err.message);
    if (fd !== undefined) {
      fs.close(fd,(err)=> {
        callback(null);
      });
    } else {
      callback(null);
    }
  }
};

function createMissingFoldersAsync(lastPath, pluginID, currentResource, resourceRequested, directories, callback){
  logger.debug('Creating missing folders. Path='+lastPath+'.');
  logger.log(logger.FINER,'Creating missing folders. Directories Object='+JSON.stringify(directories));

  var locationType = currentResource.locationType;
  if (locationType) {
    if (locationType.toLowerCase() === "absolute") {
      logger.warn("Absolute path for configuration folders not yet handled, will use relative pathing");
      //TODO handle locationtype relative.
    }
  }

  var encodedResourceName = encodeDirectoryName(resourceRequested);
  var newPath = null;
  var newPathLen = 0;

  var createInstanceAndSite = function() {
    createMissingFolderAsync(encodedPluginName,directories.instanceDir,()=> {
      createMissingFolderAsync(encodedPluginName,directories.siteDir,()=> {
        newPath = encodedPluginName+'/'+encodedResourceName;
        if (directories.usersDir) {
          createUserDirectory();
        }
        else {
          createGroupDirectory(createNewInstanceAndSite);
        }
      });
    });
  };

  var createGroupDirectory = function(nextFunction) {
    if (directories.groupsDir) {
      createMissingFolderAsync(newPath,directories.groupsDir,nextFunction);
    }
    else {
      nextFunction();
    }
  };

  var createUserDirectory = function() {
    logger.debug("Set lastPath to "+lastPath);
    if (directories.usersDir) {
      createMissingFolderAsync(newPath,directories.usersDir,()=> {createGroupDirectory(createNewInstanceAndSite);});
    }
    else {
      createGroupDirectory(createNewInstanceAndSite);
    }
  };

  var createNewInstanceAndSite = function() {
    createMissingFolderAsync(newPath,directories.instanceDir,()=>{
      createMissingFolderAsync(newPath,directories.siteDir,()=>{
        //do not create a product directory folder.
        callback(newPath);
      });
    });
  };
  
  if (!lastPath) {
    var encodedPluginName = encodeDirectoryName(pluginID);
    if (directories.usersDir) {
      createMissingFolderAsync(encodedPluginName,directories.usersDir,()=> {
        createGroupDirectory(createInstanceAndSite);
      });
    }
    else {
      createGroupDirectory(createInstanceAndSite);
    }
  }
  else {
    newPath = lastPath+'/'+encodedResourceName;
    createUserDirectory();
  }
  //TODO skipping group for now because we will need a way to extract the group the user is associated with
  //createMissingFolder(newPath,directories.groupsDir,directories.groupsDirLen,slh);
}



function getResourceDefinitionJsonOrFailInner(parentJson, resourceName,errorCallback){
  var resourceDefinition = null;
  var returnCode;
  if (!parentJson) {
    if (errorCallback) {errorCallback(1);}
    return null;
  }
  if (resourceName.startsWith('.')) {
    if (errorCallback) {errorCallback(5);}
    return null;
  }  

  resourceDefinition = jsonObjectGetObject(parentJson, resourceName);
  if (!resourceDefinition) {//if we dont find it, the first child better be variable. check below.
    var variableDefinition = jsonObjectGetFirstProperty(parentJson);
    if (variableDefinition) {
      if ((typeof variableDefinition) == 'object') {
        var variableObject = variableDefinition;
        var isVariable = jsonObjectGetBoolean(variableObject,"variable");
        if (!isVariable) {
          if (errorCallback) {errorCallback(2);}
          return null;
        }
        else {
          resourceDefinition = variableObject;
        }
      }
      else {
        if (errorCallback) {errorCallback(3);}
        return null;
      }
    }
    else {
      if (errorCallback) {errorCallback(4);}
      return null;
    }
  }
  return resourceDefinition;  
}

function getResourceDefinitionJsonOrFail(response, parentJson, resourceName) {
  let safeResourceName = htmlObfuscator.findAndReplaceHTMLEntities(resourceName);
  var errorCallback = function(returnCode) {
    if (returnCode == 1) {
      respondWithJsonError(response,`Error in plugin configuration definition or resource (${safeResourceName}) not found`,HTTP_STATUS_BAD_REQUEST);
    }
    else if (returnCode == 2) {
      respondWithJsonError(response,`Resource (${safeResourceName}) not found in plugin`,HTTP_STATUS_NOT_FOUND);
    }
    else if (returnCode == 3) {
      respondWithJsonError(response,`Error in plugin configuration definition for resource (${safeResourceName})`,HTTP_STATUS_INTERNAL_SERVER_ERROR);
    }
    else if (returnCode == 4) {
      respondWithJsonError(response,`Resource (${safeResourceName}) not found in plugin`,HTTP_STATUS_NOT_FOUND);
    }
    else if (returnCode == 5) {
      respondWithJsonError(response,`Resource (${safeResourceName}) name invalid`,HTTP_STATUS_BAD_REQUEST);
    }    
  };
  var resourceDefinition = getResourceDefinitionJsonOrFailInner(parentJson,resourceName,errorCallback);
  return resourceDefinition;
}



function getAggregationPolicy(resource) {
  var policy = jsonObjectGetString(resource, "aggregationPolicy");
  if (policy === 'override'){
    return AGGREGATION_POLICY_OVERRIDE;
  }

  return AGGREGATION_POLICY_NONE;
}

function getPathForScope(lastPath, filename, scope, directories){
  var path = null;
  var hasFilename = (filename && filename.length > 0);
  switch (scope) {

  case CONFIG_SCOPE_USER:
    if (hasFilename) {
      path = directories.usersDir+'/'+lastPath+'/'+filename;
    }
    else {
      path = directories.usersDir+'/'+lastPath;
    }
    break;
  case CONFIG_SCOPE_GROUP:
    if (hasFilename) {
      path = directories.groupsDir+'/'+lastPath+'/'+filename;
    }
    else {
      path = directories.groupsDir+'/'+lastPath;
    }
    break;
  case CONFIG_SCOPE_INSTANCE:
    if (hasFilename) {
      path = directories.instanceDir+'/'+lastPath+'/'+filename;
    }
    else {
      path = directories.instanceDir+'/'+lastPath;
    }
    break;
  case CONFIG_SCOPE_SITE:
    if (hasFilename) {
      path = directories.siteDir+'/'+lastPath+'/'+filename;
    }
    else {
      path = directories.siteDir+'/'+lastPath;
    }
    break;
  case CONFIG_SCOPE_PRODUCT:
    if (hasFilename) {
      path = directories.productDir+'/'+lastPath+'/'+filename;
    }
    else {
      path = directories.productDir+'/'+lastPath;
    }
    break;
  default:
    logger.warn(`getpathforscope: Warning, invalid scope of ${scope}`);
  }
  return path;
}

/*
Methods to transition down the chain of P.S.I.G.U
*/
//TODO group unhandled for now.
function getNextBroadestScope(scope) {
  switch (scope) {

  case CONFIG_SCOPE_USER:
    return CONFIG_SCOPE_INSTANCE;
  case CONFIG_SCOPE_INSTANCE:
    return CONFIG_SCOPE_SITE;
  case CONFIG_SCOPE_SITE:
    return CONFIG_SCOPE_PRODUCT;
  case CONFIG_SCOPE_PRODUCT:
    return 0;
  default:
    logger.warn(`Scope=${scope} not found`);
  }
  return 0;
}
//TODO: group unhandled for now.
function getNextNarrowestScope(scope) {
  switch (scope) {

  case CONFIG_SCOPE_USER:
    return 0;
  case CONFIG_SCOPE_INSTANCE:
    return CONFIG_SCOPE_USER;
  case CONFIG_SCOPE_SITE:
    return CONFIG_SCOPE_INSTANCE;
  case CONFIG_SCOPE_PRODUCT:
    return CONFIG_SCOPE_SITE;
  default:
    logger.warn(`Scope=${scope} not found`);
  }
  return 0;
}

function overrideJsonProperties(originalObject, overrideObject) {
  var overrideTable = {};
  var property = null;
  var keyArray = Object.keys(overrideObject);
  var key = null;
  for (let i = 0; i < keyArray.length; i++) {
    key = keyArray[i];
    property = overrideObject[key];
    htPut(overrideTable,key,property);
  }

  var overrideProperty = null;
  keyArray = Object.keys(originalObject);
  for (let i = 0; i < keyArray.length; i++) {
    key = keyArray[i];
    property = originalObject[key];
    overrideProperty = htGet(overrideTable,key);
    if (!overrideProperty) {
      overrideObject[key] = property;
    }
  }
  return overrideObject;
}

/**
   Returns the contents of a JSON file and the timestamp of the file
   @returns object  An object containing data attributes (the json file contents), and timestamp attribute for the timestamp of the file.
*/
function getJSONFromFile(path) {
  logger.debug('Opening JSON file. Path='+path);
  try {
    let fd = fs.openSync(path,'r');
    let stats = fs.fstatSync(fd);
    let maccess = -1;
    if (stats.mtimeMs) {
      maccess = stats.mtimeMs;
    } else if (stats.mtime) {
      maccess = new Date(stats.mtime).getTime();
    }
    let buffer = Buffer.alloc(stats.size);
    let bytesRead = fs.readSync(fd,buffer,0,buffer.length,null);
    let data = buffer.toString('utf8',0,buffer.length);
    let fileJson = null;
    try {
      fileJson = JSON.parse(data);
    }
    catch (parseEx) {
      logger.warn('Exception when parsing JSON. File='+path+'. Error='+parseEx);
    }
    fs.closeSync(fd);
    return {data:fileJson, maccess: maccess};
  }
  catch (e) {
    if (e.code != 'ENOENT') {
      logger.warn('Exception when reading file. File='+path+'. Error='+e.message);
    } else {
      logger.debug('Exception when reading file. File='+path+'. Error='+e.message);
    }
  }
  return null;
}

/**
   Returns the contents of a JSON file and the timestamp of the file
   @returns callback A callback containing two arguments: the JSON data, and the timestamp on the file
*/
function getJSONFromFileAsync(path, callback) {
  logger.debug('Opening JSON file. Path='+path);  
  fs.open(path,'r',(err,fd)=> {
    if (err) fdCloseOnError(err,fd,path,callback);
    else {
      fs.fstat(fd, (err, stats)=> {
        if (err) fdCloseOnError(err,fd,path,callback);
        else {
          if (stats.isDirectory()) {
            callback(-1);
          }
          else {
            let maccess = -1;
            if (stats.mtimeMs) {
              maccess = stats.mtimeMs;
            } else if (stats.mtime) {
              maccess = new Date(stats.mtime).getTime();
            }
            let buffer = Buffer.alloc(stats.size);
            setTimeout(()=> {
              fs.read(fd, buffer, 0, buffer.length, null, (err, bytesRead, buffer)=> {
                if (err) fdCloseOnError(err,fd,path,callback);
                else {
                  fs.close(fd, (err) => {
                    //TODO error could exist here but there's not much we can do?
                    let data = buffer.toString('utf8',0,buffer.length);
                    let fileJson = null;
                    try {
                      fileJson = JSON.parse(data);
                    }
                    catch (parseEx) {
                      logger.warn('Exception when parsing JSON. File='+path+'. Error='+parseEx);
                    }
                    callback({data:fileJson, maccess: maccess});
                  });
                }
              });
            },0);//allow for GC
          }
        }
      });
    }
  });
}


function startConfigDirectoryJson(resourceLocation, streamer,listing) {
  jStreamer.jsonStart(streamer);
  listing ? jStreamer.jsonAddString(streamer,"_objectType",MSG_TYPE_RESOURCESET_LISTING) :
            jStreamer.jsonAddString(streamer,"_objectType",MSG_TYPE_RESOURCESET);
  jStreamer.jsonAddString(streamer,"_metadataVersion", CURRENT_JSON_VERSION);
  jStreamer.jsonAddString(streamer,"resourceID",resourceLocation);
  return streamer;
}

function startResponseForConfigDirectory(response, statusCode, statusString, resourceLocation,listing) {
  response.status(statusCode);
  var streamer = jStreamer.respondWithJsonStreamer(response);
  return startConfigDirectoryJson(resourceLocation, streamer,listing);
}

function startConfigFileJson(resourceLocation, streamer) {
  if (streamer) {
    jStreamer.jsonStart(streamer);
    jStreamer.jsonAddString(streamer,"_objectType",MSG_TYPE_RESOURCE);
    jStreamer.jsonAddString(streamer,"_metadataVersion", CURRENT_JSON_VERSION);
    jStreamer.jsonAddString(streamer,"resourceID",resourceLocation);
  }
  return streamer;
}

function startResponseForConfigFile(response, statusCode, statusString, resourceLocation) {
  response.status(statusCode);//TODO statusString not handled.
  var streamer = jStreamer.respondWithJsonStreamer(response);
  return startConfigFileJson(resourceLocation, streamer);
}

function getJsonForAggregationNone(lastPath, filename, directories, scope) {
  var path = getPathForScope(lastPath,filename,scope,directories);
  var result = getJSONFromFile(path);
  while (!result && scope) {
    scope = getNextBroadestScope(scope);
    path = getPathForScope(lastPath,filename,scope,directories);
    result = getJSONFromFile(path);
  }
  return result;
}

function getJsonForAggregationNoneAsync(lastPath, filename, directories, scope, callback) {
  var path = getPathForScope(lastPath,filename,scope,directories);
  var getJsonAtNextScope = function() {
    getJSONFromFileAsync(path,(result)=> {
      if (!result) {
        scope = getNextBroadestScope(scope);
        if (scope) {
          path = getPathForScope(lastPath,filename,scope,directories);
          getJsonAtNextScope();
        }
        else {
          callback(null);
        }
      }
      else {
        callback(result);
      }
    });
  };
  getJsonAtNextScope(path);
}


function getJsonLocal(lastPath, filename, directories, scope, resource) {
  var policy = getAggregationPolicy(resource);
  switch (policy) {
  case AGGREGATION_POLICY_NONE:
    {
      var result = getJsonForAggregationNone(lastPath, filename, directories, scope);
      if (result) {
        var fileJsonObject = result.data;
        return fileJsonObject;
      }
      return null;
    }
    break;
  case AGGREGATION_POLICY_OVERRIDE:
    {
      return getOverrideJson(lastPath,filename,directories,scope);
    }
    break;
  default:
    logger.warn(`Aggregation policy type=${policy} unhandled`);
  }
  return null;
}

function respondWithConfigFile(response, filename, resource, directories, scope, lastPath, location) {
  var policy = getAggregationPolicy(resource);
  switch (policy) {

  case AGGREGATION_POLICY_NONE:
    {
      getJsonForAggregationNoneAsync(lastPath, filename, directories, scope,(result)=> {
        if (result) {
          var fileJsonObject = result.data;
          var streamer = startResponseForConfigFile(response,200,"OK",location);
          jStreamer.jsonAddInt(streamer,result.maccess,"maccessms");
          jStreamer.jsonStartObject(streamer,"contents");
          jStreamer.jsonPrintObject(streamer,fileJsonObject);
          jStreamer.jsonEndObject(streamer);
          jStreamer.jsonEnd(streamer);
          finishResponse(response);
          logger.debug(`Configuration service request complete. Resource=${location}`);
        }
        else {
          respondWithJsonError(response,"Resource not yet defined",HTTP_STATUS_NO_CONTENT,location);
        }
      });
    }
    break;
  case AGGREGATION_POLICY_OVERRIDE:
    {
      getOverrideJsonAsync(lastPath,filename,directories,scope,(result)=> {
        if (result) {
          var streamer = startResponseForConfigFile(response,200,"OK",location);
          jStreamer.jsonAddInt(streamer,result.maccess,"maccessms");
          jStreamer.jsonStartObject(streamer,"contents");
          jStreamer.jsonPrintObject(streamer,result.data);
          jStreamer.jsonEndObject(streamer);
          jStreamer.jsonEnd(streamer);
          finishResponse(response);
          logger.debug(`Configuration service request complete. Resource=${location}`);
        }
        else {
          respondWithJsonError(response,"Resource not yet defined",HTTP_STATUS_NO_CONTENT,location);
        }
      });
    }
    break;
  default:
    {
      var msg = "Aggregation policy type="+policy+" unhandled";
      respondWithJsonError(response,msg,HTTP_STATUS_BAD_REQUEST,"Bad Request",location);
      logger.warn(msg);
    }
  }
}

function getOverrideJson(relativePath, filename, directories, scope) {
  var currentScope = CONFIG_SCOPE_PRODUCT;

  var path = getPathForScope(relativePath,filename,currentScope,directories);
  var result = getJSONFromFile(path);
  while (!result && currentScope) {
    currentScope = getNextNarrowestScope(currentScope);    
    path = getPathForScope(relativePath,filename,currentScope,directories);
    result = getJSONFromFile(path);
    if (currentScope == scope) {
      break;
    }
  }
  if (result) {
    var returnJsonObject = result.data;
    var overridingJsonObject = null;
    if (currentScope != scope) {
      currentScope = getNextNarrowestScope(currentScope);
      while (currentScope) {
        path = getPathForScope(relativePath,filename,currentScope,directories);
        result = getJSONFromFile(path);
        if (result) {
          overridingJsonObject = result.data;
          returnJsonObject = overrideJsonProperties(returnJsonObject, overridingJsonObject);
        }
        if (currentScope == scope) {
          break;
        }
        currentScope = getNextNarrowestScope(currentScope);
      }
    }
    return returnJsonObject;
  }
  return null;
}

function getOverrideJsonAsync(relativePath, filename, directories, scope, callback) {
  var currentScope = CONFIG_SCOPE_PRODUCT;

  var path = getPathForScope(relativePath,filename,currentScope,directories);
  var getJsonAtNextScope = function() {
    getJSONFromFileAsync(path,(result)=> {
      if ((!result && currentScope) && (currentScope != scope)) {
        currentScope = getNextNarrowestScope(currentScope);    
        path = getPathForScope(relativePath,filename,currentScope,directories);
        getJsonAtNextScope();
      }
      else {
        foundFirstJson(result);
      }
    });
  };

  var foundFirstJson = function (firstJson) {    
    if (firstJson) {
      let latestTime = firstJson.maccess;
      var returnJsonObject = firstJson.data;
      var overridingJsonObject = null;
      if (currentScope != scope) {
        var getOverrideJsonAtNextScope = function() {
          path = getPathForScope(relativePath,filename,currentScope,directories);
          getJSONFromFileAsync(path,(result)=> {
            if (result) {
              if (result.maccess > latestTime) { latestTime = result.maccess; }
              overridingJsonObject = result.data;
              returnJsonObject = overrideJsonProperties(returnJsonObject, overridingJsonObject);
            }
            if (currentScope == scope) {
              callback({data:returnJsonObject, maccess:latestTime});
            }
            else {
              currentScope = getNextNarrowestScope(currentScope);
              getOverrideJsonAtNextScope();
            }
          });
        };
        
        currentScope = getNextNarrowestScope(currentScope);
        getOverrideJsonAtNextScope();
      }
      else {
        callback({data:returnJsonObject, maccess:latestTime});
      }
    }
    else {
      callback(null);
    }
  };

  getJsonAtNextScope();
}



function configFileInternalVisitor(hashtable, keyVoid, valueVoid) {
  var jsonTable = hashtable;
  var fileName = keyVoid;
  var directory = valueVoid;
  var fullPath = directory+'/'+fileName;
  var result = getJSONFromFile(fullPath);
  var jsonObject = result ? result.data : null;
  htPut(jsonTable, fileName, jsonObject);
}


function configFileVisitor(streamer, key, value) {
  var fileName = key;
  var directory = value;
  var fullPath = directory+'/'+fileName;
  var result = getJSONFromFile(fullPath);
  var jsonObject = result ? result.data : null;

  jStreamer.jsonPrintObject2(streamer,jsonObject,fileName);
}


function configFileVisitorAsync(streamer, key, value, callback) {
  var fileName = key;
  var directory = value;
  var fullPath = directory+'/'+fileName;
  getJSONFromFileAsync(fullPath,(result)=> {
    if (result) {
      var jsonObject = result.data;
      jStreamer.jsonPrintObject2(streamer,jsonObject,fileName);
      callback(result.maccess);
    } else {
      callback(-1);//Gives indication of failure
    }
  });
}

function resourceItemListingVisitor(streamer,key,value) {
  var fileName = key;
  jStreamer.jsonAddString(streamer,null,fileName);
}

  
function configFileOverrideInternalVisitor(hashtable, keyVoid, valueVoid) {
  var jsonTable = hashtable;
  var fileName = keyVoid;
  var pathList = valueVoid;//TODO oh no, its a string list... just make it an array already.
  var listLength = pathList.length;
  var returnJsonObject = null;
  var overridingJsonObject = null;
  var fileJson = null;
  var fullPath = null;
  if (listLength != 0) {
    var currentPath = null;
    for (var i = 0; i < listLength; i++) {
      currentPath = pathList[i];
      fullPath = currentPath+'/'+fileName;
      fileJson = getJSONFromFile(fullPath);
      if (fileJson) {
        if (returnJsonObject == null) {
          returnJsonObject = fileJson;
        }
        else {
          overridingJsonObject = fileJson;
          returnJsonObject = overrideJsonProperties(returnJsonObject, overridingJsonObject);
        }
      }
    }
    if (returnJsonObject) {
      htPut(jsonTable, fileName, returnJsonObject);
    }
  }
}

function configFileOverrideVisitor(streamer, key, value) {
  var fileName = key;
  var pathList = value;//now an array, not a string list.
  var listLength = pathList.length;
  var returnJsonObject = null;
  var overridingJsonObject = null;
  var fileJson = null;
  var fullPath = null;
  if (listLength != 0) {
    var currentPath = null;
    for (var i = 0; i < listLength; i++) {
      currentPath = pathList[i];
      fullPath = currentPath+'/'+fileName;
      fileJson = getJSONFromFile(fullPath);
      if (fileJson) {
        if (returnJsonObject == null) {
          returnJsonObject = fileJson;
        }
        else {
          overridingJsonObject = fileJson;
          returnJsonObject = overrideJsonProperties(returnJsonObject, overridingJsonObject);
        }
      }
    }
    if (returnJsonObject) {
      jStreamer.jsonPrintObject2(streamer,returnJsonObject,fileName);
    }
  }

}

//TODO: this is not finished, where i left off with making async commands.
function configFileOverrideVisitorAsync(streamer, key, value, callback) {
  var fileName = key;
  var pathList = value;//now an array, not a string list.
  var listLength = pathList.length;
  var returnJsonObject = null;
  var overridingJsonObject = null;
  var fileJson = null;
  var fullPath = null;
  if (listLength != 0) {
    var currentPath = null;
    for (var i = 0; i < listLength; i++) {
      currentPath = pathList[i];
      fullPath = currentPath+'/'+fileName;
      fileJson = getJSONFromFile(fullPath);
      if (fileJson) {
        if (returnJsonObject == null) {
          returnJsonObject = fileJson;
        }
        else {
          overridingJsonObject = fileJson;
          returnJsonObject = overrideJsonProperties(returnJsonObject, overridingJsonObject);
        }
      }
    }
    if (returnJsonObject) {
      jStreamer.jsonPrintObject2(streamer,returnJsonObject,fileName);
    }
  }
}


function getFileListing(fileTable, startScope, endScope, relativePath, filename, directories, overridePath) {
  var path = null;
  var currentScope = startScope;

  while (currentScope) {
    path = getPathForScope(relativePath,filename,currentScope,directories);

    try {
      var files = fs.readdirSync(path,{encoding:'utf8'});
      if (files) {
        logger.debug("Directory files found="+files.length);
      }

      var directoriesRead = files.length;
      for (var i = 0; i < directoriesRead; i++) {
        //NOTE: . and .. are not included, thankfully.
        var name = files[i];
        if (overridePath == true) {
          htPut(fileTable,name,path);//will replace older paths
        }
        else {
          var pathList = htGet(fileTable,name);
          if (pathList) {
            logger.debug("Existing path list for file="+JSON.stringify(pathList));
          }
          if (!pathList) {
            pathList = [];
            htPut(fileTable,name,pathList);
          }
          pathList.push(path);
        }
      }
    }
    catch (e) {
      if (e.code == 'ENOENT') {
        logger.debug('Config service could not find directory='+path);
      }
      else {
        logger.warn("Error when getting file listing. Directory="+path+". Error="+e.message);
      }
    }
    

    if (currentScope == endScope) {
      break;
    }
    currentScope = getNextNarrowestScope(currentScope);
  }
}

function getFileListingAsync(fileTable, startScope, endScope, relativePath, filename, directories, overridePath) {
  return new Promise((resolve,reject)=> {
    var path = null;
    var currentScope = startScope;

    var loopOverScope = function() {
      if (currentScope) {
        path = getPathForScope(relativePath,filename,currentScope,directories);

        fs.readdir(path,{encoding:'utf8'},(e,files)=> {
          if (e) {
            if (e.code == 'ENOENT') {
              logger.debug('Config service could not find directory='+path);
            }
            else {
              logger.warn("Error when getting file listing. Directory="+path+". Error="+e.message);
              reject(e);
              return;
            }          
          }
          else {
            if (files) {
              logger.debug("Directory files found="+files.length);
            }

            var directoriesRead = files.length;
            for (var i = 0; i < directoriesRead; i++) {
              //NOTE: . and .. are not included, thankfully.
              var name = files[i];
              if (overridePath == true) {
                htPut(fileTable,name,path);//will replace older paths
              }
              else {
                var pathList = htGet(fileTable,name);
                if (pathList) {
                  logger.debug("Existing path list for file="+JSON.stringify(pathList));
                }
                if (!pathList) {
                  pathList = [];
                  htPut(fileTable,name,pathList);
                }
                pathList.push(path);
              }
            }
          }

          if (currentScope == endScope) {
            resolve();
          }
          else {
            currentScope = getNextNarrowestScope(currentScope);
            loopOverScope();
          }          
        });
      } else {
        resolve();
      }
    };

    if (currentScope) {
      loopOverScope();
    }
    else {
      resolve();
    }
  });
}


function getFilesInDirectory(resource, subresourceList, directories, scope, relativePath) {
  /* here: consider just sending back a hashtable. this way we preserve filename . filecontents. but also, we dont have to mess around with jsonprinter. */

  var policy = getAggregationPolicy(resource);
  var fileTable = {};
  var jsonTable = {};

  switch (policy) {

  case AGGREGATION_POLICY_NONE:
  /*
  because we dont know what files can belong in a folder, even if the policy is NONE,
  we still want to start from the top, just allowing for replacement of files with lower levels.
  */
  {
    let startScope = CONFIG_SCOPE_PRODUCT;
    getFileListing(fileTable,startScope,scope,relativePath,null,directories,true);
    logger.debug("File table before mapping="+JSON.stringify(fileTable));
    tableMap(fileTable,configFileInternalVisitor,jsonTable);
    break;
  }
  case AGGREGATION_POLICY_OVERRIDE:
  {
    let startScope = CONFIG_SCOPE_PRODUCT;
    getFileListing(fileTable,startScope,scope,relativePath,null,directories,false);
    logger.debug("File table before mapping="+JSON.stringify(fileTable));
    tableMap(fileTable,configFileOverrideInternalVisitor,jsonTable);
    break;
  }
  default:
  {
    logger.warn(`Aggregation policy type=${policy} unhandled`);
  }
  }
  return jsonTable;
}

function respondWithFilenamesInDirectory(response, filename, resource, subresourceList, directories,
                                         scope, relativePath, location) {
  var policy = getAggregationPolicy(resource);
  var fileTable = {};
  switch (policy) {

  case AGGREGATION_POLICY_NONE:
  case AGGREGATION_POLICY_OVERRIDE:
    var startScope = CONFIG_SCOPE_PRODUCT;
    var streamer = startResponseForConfigDirectory(response,200,"OK",location,true);
    jStreamer.jsonStartArray(streamer,"contents");
    getFileListing(fileTable,startScope,scope,relativePath,filename,directories,true);
    tableMap(fileTable,resourceItemListingVisitor,streamer);
    jStreamer.jsonEndArray(streamer);
    jStreamer.jsonEnd(streamer);
    finishResponse(response);
    break;
  }
}

function respondWithFilesInDirectory(response, filename, resource, subresourceList,
                                     directories, scope, relativePath,
                                     location){


  if (filename && filename.length>0) {
    var subresource = jsonObjectGetObject(subresourceList,filename);
    if (!subresource) {
      var msg = "Subresource '"+filename+"' not found within resource";
      respondWithJsonError(response,msg,HTTP_STATUS_NOT_FOUND,location);
      return;
    }
    resource = subresource;
  }

  var policy = getAggregationPolicy(resource);
  var fileTable = {};
  switch (policy) {

  case AGGREGATION_POLICY_NONE:
  /*
  because we dont know what files can belong in a folder, even if the policy is NONE,
  we still want to start from the top, just allowing for replacement of files with lower levels.
  */
  {
    let startScope = CONFIG_SCOPE_PRODUCT;
    getFileListingAsync(fileTable,startScope,scope,relativePath,filename,directories,true).then(()=> {
      if (Object.keys(fileTable).length != 0) {
        var streamer = startResponseForConfigDirectory(response,200,"OK",location,false);
        jStreamer.jsonStartObject(streamer,"contents");
        //for every key in arg1, call arg2 and provide it with arg3
        logger.debug("File table before mapping="+JSON.stringify(fileTable));
        tableMapForAsyncVisitor(fileTable,configFileVisitorAsync,streamer,(results)=> {
          jStreamer.jsonEndObject(streamer);
          jStreamer.jsonPrintObject2(streamer,results,"maccessms");
          jStreamer.jsonEnd(streamer);
          finishResponse(response);
          logger.debug(`Configuration service request complete. Resource=${location}`);
        });
      } else {
        respondWithJsonError(response,"Resource not yet defined",HTTP_STATUS_NO_CONTENT,location);
      }
    });
    break;
  }
  case AGGREGATION_POLICY_OVERRIDE:
  {
    let startScope = CONFIG_SCOPE_PRODUCT;
    getFileListingAsync(fileTable,startScope,scope,relativePath,filename,directories,false).then(()=> {
      if (Object.keys(fileTable).length != 0) {
        var streamer = startResponseForConfigDirectory(response,200,"OK",location,false);
        jStreamer.jsonStartObject(streamer,"contents");
        logger.debug("File table before mapping="+JSON.stringify(fileTable));
        tableMap(fileTable,configFileOverrideVisitor,streamer);
        jStreamer.jsonEndObject(streamer);
        jStreamer.jsonEnd(streamer);
        finishResponse(response);
        logger.debug(`Configuration service request complete. Resource=${location}`);
      } else {
        respondWithJsonError(response,"Resource not yet defined",HTTP_STATUS_NO_CONTENT,location);
      }
    });
    break;
  }
  default:
    {
      var msg = "Aggregation policy type="+policy+" unhandled";   
      respondWithJsonError(response,msg,HTTP_STATUS_BAD_REQUEST,location);
      logger.warn(msg);
    }
  }
}

/*
NOTE: this function is not yet implemented, and should be avoided until then
*/
function replaceOrCreateDirectoryFiles(response, resource, directories, scope, relativePath,
                                          location, content, contentLength) {

  var path = getPathForScope(relativePath,null,scope,directories);
  var contentJson = JSON.parse(content);
  if (contentJson) {
    var contentObject = contentJson;
    if (contentObject) {
      var keyArray = Object.keys(contentObject);
      var key;
      var property;
      for (var i = 0; i < keyArray.length; i++) {
        key = keyArray[i];
        property = contentObject[key];
        if ((typeof property) == 'object') {
          //TODO: find out how to write json to a file
        }
      }
    }
  }
}

function replaceOrCreateFile(response, filename, directories, scope, relativePath,
                             location, content, contentLength) {

  var path = getPathForScope(relativePath,filename,scope,directories);
  var mode = 0700; //TODO is 700 good for us?
  //mode is for if the file is created.
  //w means create if doesnt exist, and open for writing

  
  fs.open(path,'w',mode,function(error, fd) {
    if (!error) {
      var offset = 0;
      var contentLength = content.length;
      var buff = Buffer.from(content,'utf8');
      var writeCallback = function(err,writtenLength,buffer) {
        contentLength -= writtenLength;
        offset += writtenLength;
        if (contentLength == 0) {
          var handleException = function(e) {
            respondWithJsonError(response,"Failed to close written item.",HTTP_STATUS_INTERNAL_SERVER_ERROR,location);
            logger.warn('Error occurred while closing file. File='+path+'. Error='+e.message);
            return;
          };
          try {
            fs.fstat(fd,(err,stats)=> {
              if (err) {
                respondWithJsonError(response,"Failed to stat item.",HTTP_STATUS_INTERNAL_SERVER_ERROR,location);
              } else {
                let maccess = -1;
                if (stats.mtimeMs) {
                  maccess = stats.mtimeMs;
                } else if (stats.mtime) {
                  maccess = new Date(stats.mtime).getTime();
                }
                fs.close(fd,(exception)=>{
                  if (exception) {
                    handleException(exception);
                  }
                  else {
                    response.status(201);
                    var streamer = jStreamer.respondWithJsonStreamer(response);
                    jStreamer.jsonStart(streamer);
                    jStreamer.jsonAddString(streamer,"_objectType",MSG_TYPE_UPDATE);
                    jStreamer.jsonAddString(streamer,"_metadataVersion", CURRENT_JSON_VERSION);
                    jStreamer.jsonAddString(streamer,"resourceID",location);
                    jStreamer.jsonAddInt(streamer,maccess,"maccessms");                  
                    jStreamer.jsonAddString(streamer,"result","Replaced item.");
                    jStreamer.jsonEnd(streamer);
                    finishResponse(response);
                    logger.debug(`Configuration service request complete. Resource=${location}`);
                  }
                });
              }
            });
          }
          catch (e) {
            handleException(e);
          }
        }
        else if (writtenLength < 0 || err) {
          logger.warn("Error occurred while writing file. File="+path+". Error="+err);
          respondWithJsonError(response,"Failed to write item.",HTTP_STATUS_INTERNAL_SERVER_ERROR,location);
          fs.close(fd,function(){
            logger.debug('file closed');
          });
          return;  
        }
        else {
          fs.write(fd,buff,offset,contentLength,writeCallback);
        }
      };
      fs.write(fd,buff,offset,contentLength,writeCallback);
    }
    else {
      logger.warn('Exception when opening file for writing. File='+path+'. Error='+error.message);
      respondWithJsonError(response,"Failed to open item for writing.",HTTP_STATUS_INTERNAL_SERVER_ERROR,location);
    }
  });
    /*
    NOTE: Created sounds counter-intuitive if a file is replaced instead, but is common for this type of REST call
          And seen on other REST interfaces
    */
}

/*
  filesystems track if any files within a folder have been modified by changing the folder's modification timestamp.
  this is the case for windows, unix, and Z. So, lets not check files, just folders.
*/
function checkResourceModifiedTimestamp(filename, directories, scope, relativePath,
                                        timestamp, skipMissing){
  return new Promise((resolve,reject)=> {
    if (!timestamp) {
      resolve();
      return;
    }
    var path = getPathForScope(relativePath,filename,scope,directories);
    
    checkFolderModifiedTimestamp(path,timestamp,skipMissing).then(()=> {
      resolve();
    },(error)=> {
      reject(error);
    });
  });
}

/*
  fail if any timestamp is newer than the given one, or skipMissing === false and topDirectory is missing
*/
function checkFolderModifiedTimestamp(topDirectory,timestamp,skipMissing){
  return new Promise((resolve,reject)=>{
    var stop = false;
    var innerLoop = function(directory, successCallback) {
      fs.access(directory,fs.constants.F_OK,(err)=> {
        if (err) {
          //doesnt exist from our point of view
          if (skipMissing) {
            successCallback();
          } else {
            reject(err);
          }
        }
        else {
          fs.readdir(directory,(err,files)=> {
            if (err) {
              reject(err);
            }
            else {
              if (files.length == 0) {
                successCallback();
              }
              else {
                var filesComplete = 0;
                files.forEach((file)=> {
                  if (!stop) {
                    var filePath = pathModule.join(directory,file);
                    fs.stat(filePath,(err,stats)=> {
                      if (err) {
                        stop = true;
                        reject(err);
                      }
                      else {
                        if (stats.isDirectory()) {
                          //loop
                          let mtimems = -1;
                          if (stats.mtimeMs) {
                            mtimems = stats.mtimeMs;
                          } else if (stats.mtime) {
                            mtimems = new Date(stats.mtime).getTime();
                          }

                          if (timestamp < mtimems) {
                            stop = true;
                            logger.warn(`Timestamp mismatch on file=${filePath}`);
                            reject(new Error(`Timestamp mismatch`));
                          }
                          else { 
                            logger.debug('Configuration service descending into path for timestamp check. Path='+filePath);
                            innerLoop(filePath,()=> {
                              logger.debug('Configuration service finished timestamp check in path='+filePath);
                              filesComplete++;
                              if (filesComplete == files.length) {
                                if (directory == topDirectory) {
                                  resolve();
                                }
                                else {
                                  successCallback();
                                }
                              }
                            });
                          }
                        } else {
                          filesComplete++;
                          if (filesComplete == files.length) {
                            if (directory == topDirectory) {
                              resolve();
                            }
                            else {
                              successCallback();
                            }
                          }
                        }
                      }
                    });
                  }
                });
              }
            }
          });
        }
      });
    };


    fs.stat(topDirectory,(err,stats)=> {
      if (err) {
        if (err.code == 'ENOENT' && skipMissing) {
          resolve();
        } else {
          reject(err);
        }
      }
      else {
        if (stats.isDirectory()) {
          let maccess = -1;
          if (stats.mtimeMs) {
            maccess = stats.mtimeMs;
          } else if (stats.mtime) {
            maccess = new Date(stats.mtime).getTime();
          }
          
          if (timestamp < maccess) {
            reject(new Error(`Timestamp of dir=${topDirectory} was more recent than given timestamp`));
          } else {
            innerLoop(topDirectory,()=> {resolve();});
          }
        } else {
          reject(new Error(`Path given was not a directory`));
        }
      }
    });
  });
}

function restCheckModifiedTimestamp(filename, directories, scope, relativePath, timestamp){
  return new Promise((resolve,reject)=>{
    if (!timestamp) {
      resolve();
      return;
    }

    var path = getPathForScope(relativePath,filename,scope,directories);

    let existingTimestamp = -1;
    fs.open(path,'r',(err,fd)=> {
      if (err && err.code != 'ENOENT') {
        logger.warn('Exception when reading file. File='+path+'. Error='+err.message);
        fs.close(fd,(err)=> {
          reject(err);
        });
      } else if (!err) {
        fs.fstat(fd,(err,stats)=> {
          if (err) {
            fdCloseOnError(err,fd,path,()=> {
              reject(err);
            });
          } else {
            existingTimestamp = stats.mtimeMs;
            fs.close(fd,(err)=> {
              if (err) {
                reject(err);
              }
              else if (timestamp == existingTimestamp) {
                resolve();
              } else {
                reject(new Error('Timestamp mismatch'));
              }
            });
          }
        });
      } else {
        //file didnt exist, go ahead
        resolve();
      }
    });
  });
}

function deleteResourceSuccess(response,location) {
  response.status(200);
  var streamer = jStreamer.respondWithJsonStreamer(response);
  jStreamer.jsonStart(streamer);
  jStreamer.jsonAddString(streamer,"_objectType",MSG_TYPE_DELETE);
  jStreamer.jsonAddString(streamer,"_metadataVersion", CURRENT_JSON_VERSION);
  jStreamer.jsonAddString(streamer,"resourceID",location);
  jStreamer.jsonAddString(streamer,"result","Resource deleted.");
  jStreamer.jsonEnd(streamer);
  finishResponse(response);
  logger.debug(`Configuration service request complete. Resource=${location}`);
}

function handleDeleteFolderRequest(response, filename, resource, directories, scope, relativePath, location) {
  var path = getPathForScope(relativePath,filename,scope,directories);
  /*
    start at root
    any errors must callback to top level

    if file, delete file
    if folder, decend

    when no more folders found, callback success. else recurse
  */
  deleteFilesInFolder(path,()=> {
    deleteResourceSuccess(response,location);    
  },(error)=> {
    respondWithJsonError(response,"Failed to delete resource.",HTTP_STATUS_INTERNAL_SERVER_ERROR,location);
  });
};

function deleteFilesInFolder(topDirectory,success,fail) {
  var stop = false;
  var innerLoop = function(directory, successCallback) {
    fs.access(directory,fs.constants.F_OK,(err)=> {
      if (err) {
        //doesnt exist from our point of view
        successCallback();
      }
      else {
        fs.readdir(directory,(err,files)=> {
          if (err) {
            fail(err);
          }
          else {
            if (files.length == 0) {
              successCallback();
            }
            else {
              var filesComplete = 0;
              files.forEach((file)=> {
                if (!stop) {
                  var filePath = pathModule.join(directory,file);
                  fs.stat(filePath,(err,stats)=> {
                    if (err) {
                      stop = true;
                      fail(err);
                    }
                    else {
                      if (stats.isDirectory()) {
                        //loop
                        logger.debug('Configuration service descending into path for deleting. Path='+filePath);
                        innerLoop(filePath,()=> {
                          logger.debug('Configuration service finished deleting files in path='+filePath);
                          filesComplete++;
                          if (filesComplete == files.length) {
                            if (directory == topDirectory) {
                              success();
                            }
                            else {
                              successCallback();
                            }
                          }
                        });
                      }
                      else {
                        deleteFile(filePath,()=> {
                          logger.debug('Configuration service deleted file. Path='+filePath);
                          filesComplete++;
                          if (filesComplete == files.length) {
                            if (directory == topDirectory) {
                              success();
                            }
                            else {
                              successCallback();
                            }
                          }
                        },(err)=> {
                          stop = true;
                          fail(err);
                        });
                      }
                    }
                  });
                }
              });
            }
          }
        });
      }
    });
  };

  innerLoop(topDirectory,success);  
}

function deleteFile(path,success,fail) {
  fs.access(path,fs.constants.F_OK,(err)=> {
    if (err) {
      success();
    }
    else {
      fs.unlink(path,(err)=> {
        if (err) {
          fail(err);
        }
        else {
          success();
        }
      });
    }
  });
}

function handleDeleteFileRequest(response, filename, resource, directories, scope, relativePath, location) {
  var path = getPathForScope(relativePath,filename,scope,directories);
  deleteFile(path,()=> {
    deleteResourceSuccess(response,location);
  },(error)=> {
    respondWithJsonError(response,"Failed to delete resource.",HTTP_STATUS_INTERNAL_SERVER_ERROR,location);    
  });
};

function makeConfigurationDirectoriesStruct(directoryConfig, productCode, user) {
  return makeConfigurationDirectoriesStructInner(directoryConfig,productCode,user);
}

function makeUserConfigurationDirectories(serverSettings, productCode, user) {
  var pluginDir = productCode+'/'+"pluginStorage";

  var usersDir = jsonObjectGetString(serverSettings, "usersDir");
  var userDir = usersDir+'/'+user;
  /*user and group may not be made from the start, create folders if needed*/
  createMissingFolder(null,userDir);
  
  var userProductDir = userDir + '/' + productCode;
  createMissingFolder(null,userProductDir);
  
  var fullusersDir = userDir+'/'+pluginDir;
  createMissingFolder(null,fullusersDir);
  return fullusersDir;
}


function makeConfigurationDirectoriesStructInner(serverSettings, productCode, user) {
  var pluginDir = productCode+'/'+"pluginStorage";

  var directories = {};
  var productDir = jsonObjectGetString(serverSettings, "productDir");
  var fullProductDir = productDir+'/'+pluginDir;
  directories.productDir = fullProductDir;

  var siteDir = jsonObjectGetString(serverSettings, "siteDir");
  var fullsiteDir = siteDir+'/'+pluginDir;
  directories.siteDir = fullsiteDir;

  var instanceDir = jsonObjectGetString(serverSettings, "instanceDir");
  var fullinstanceDir = instanceDir+'/'+pluginDir;
  directories.instanceDir = fullinstanceDir;

  if (user) {
    directories.usersDir = makeUserConfigurationDirectories(serverSettings,productCode,user);
  }
  logger.debug('Directories = '+JSON.stringify(directories));
  return directories;
}

function respondWithSubDirectoryListing(response, subDirectoriesObject, baseLocation) {
  response.status(200);
  var streamer = jStreamer.respondWithJsonStreamer(response);
  jStreamer.jsonStart(streamer);
  jStreamer.jsonAddString(streamer,"_objectType",MSG_TYPE_SUBRESOURCE_LISTING);
  jStreamer.jsonAddString(streamer,"_metadataVersion", CURRENT_JSON_VERSION);
  jStreamer.jsonAddString(streamer,"resourceID",baseLocation);
  jStreamer.jsonStartObject(streamer,"subResources");
  
  var keyArray = Object.keys(subDirectoriesObject);
  var property;
  var key;
  var location;
  for (var i = 0; i < keyArray.length; i++) {
    key = keyArray[i];
    property = subDirectoriesObject[key];
    jStreamer.jsonStartObject(streamer,key);
    location = baseLocation+'/'+key;
    jStreamer.jsonAddString(streamer,"location",location);
    jStreamer.jsonEndObject(streamer);
  }
  
  jStreamer.jsonEndObject(streamer);
  jStreamer.jsonEnd(streamer);
  finishResponse(response);
}

function findResourceAndPath(path, pluginDefinition, directories) {
  var rc = 0;
  //return lastpath, currentresourceobject
  var configurationData = jsonObjectGetObject(pluginDefinition,"configurationData");
  var pluginID = jsonObjectGetString(pluginDefinition, "identifier");

  var currentResource = null;

  var currentResourceList = jsonObjectGetObject(configurationData, "resource");
  var lastPath = null;
  var currentResourceObject = null;
  var returnObject = {
    path: lastPath,
    resource: currentResourceObject,
    resourceList: currentResourceList
  };

  if (!currentResourceList) {
    logger.warn("Resource definition not found for plugin");
    return returnObject;
  }
  
  var startPos = 0;
  var matchPos = 0;
  while (matchPos != -1) {
    matchPos = path.indexOf('/',startPos);
    var matchLen = 0;
    if (matchPos == -1) {
      matchLen = path.length;
    }
    else {
      matchLen = matchPos - startPos;
    }
    if (matchLen > 0) {
      var pathPart = path.slice(startPos,startPos+matchLen);

      var currentResourceObject = getResourceDefinitionJsonOrFailInner(currentResourceList,pathPart);
      if (!currentResourceObject) {
        logger.warn("Failed to get resource definition json.");
        return returnObject;
      }
      else {
        lastPath = createMissingFolders(lastPath, pluginID, currentResourceObject, pathPart, directories);
      }
      currentResourceList = jsonObjectGetObject(currentResourceObject, "subResources");
    }
    startPos = matchPos+1;
  }
  return returnObject;
}

function getDirectoriesFromServiceSettings(service, username) {
  if(service == null){
    logger.warn("Failed to get deployment directories from service object. Service is null.");
    return null;
  }
  
  var directories = makeConfigurationDirectoriesStruct(service.manager,username);  
  if (!directories.productDir || !directories.siteDir || !directories.instanceDir || !directories.groupsDir || !directories.usersDir) {
    logger.warn("Deployment directories object is missing or incomplete.");
    return null;
  }

  return directories;
}

/* if you didnt have pluginDefinition, you could use pluginID, a path, and an aggregation type as overrides for actually checking */
function getConfigFilesInPath(service, username, path, scope, pluginDefinition) {
  var directories = getDirectoriesFromServiceSettings(service, username);
  if (directories != null) {
    var resourceObject = null;
    var resourceList = null;
    var lastPath = null;
    if (resourceObject != null && lastPath != null && resourceList != null) {
      var returnObject = findResourceAndPath(path,pluginDefinition,directories);
      lastPath = returnObject.path;
      resourceObject = returnObject.resource;
      resourceList = returnObject.resourceList;
      var jsonTable = getFilesInDirectory(resourceObject,resourceList,directories,scope,lastPath);
      return jsonTable;
    }
  }
  return null;
}

function addJSONFilesToJSON(startingPath,json) {
  if (!json) {
    json = {};
  }
  try {
    var fileNames = fs.readdirSync(startingPath);
    fileNames.forEach(function (filename) {
      var filepath = pathModule.join(startingPath,filename);
      if (fs.statSync(filepath).isFile()) {
        let contents = jsonUtils.parseJSONWithComments(filepath);
        if (contents) {
          json[filename] = {"_objectType": 'org.zowe.configjs.internal.file', "contents":contents};
        }
      }
      else {
        let contents = addJSONFilesToJSON(filepath,null);//TODO does this result in proper recursion
        if (contents) {
          json[filename] = {"_objectType": 'org.zowe.configjs.internal.folder', "contents":contents};
        }
      }
    });
  } catch (e) {
    if (e.code == 'ENOENT') {
      logger.debug('Config service could not find directory='+startingPath);
    }
    else {
      logger.warn('Exception on reading JSON files in folder. Folder path='+startingPath+'. Error='+e.message);
    }
    return null;
  }
  return json;
}

function getScopeRootPath(scope,directories) {
  var path;
  switch (scope) {
  case CONFIG_SCOPE_PRODUCT:
    path = directories.productDir;
    break;
  case CONFIG_SCOPE_SITE:
    path = directories.siteDir;
    break;
  case CONFIG_SCOPE_INSTANCE:
    path = directories.instanceDir;
    break;
  case CONFIG_SCOPE_GROUP:
    path = directories.groupsDir;
    break;
  case CONFIG_SCOPE_USER:
    path = directories.usersDir;
    break;
  default:
    logger.warn('Error getting path for scope. Unknown scope='+scope);
  }
  return path;
}

function InternalConfiguration(jsonStructure) {
  this.contents = jsonStructure;
}

/*
takes in an array that drills into the attribute tree
ex: [foo, bar, baz] would return the contents of foo.bar.baz
*/
InternalConfiguration.prototype.getContents = function(attributeArray) {
  if (!this.contents) {
    return null;
  }
  var currentJSON = this.contents;
  for (let i = 0; i < attributeArray.length; i++) {
    currentJSON = currentJSON[attributeArray[i]];
    if (!currentJSON) {
      return null;
    }
  }
  return currentJSON.contents;
};

/*
  aggregation policy none at the moment
  relativeLocation excluses the scope path
*/
function getJSONFromLocation(relativeLocation,directories,startScope,endScope) {
  var scope = startScope;
  var configuration = {};
  while (scope) {
    var rootPath = pathModule.join(getScopeRootPath(scope,directories),relativeLocation);
    var updatedConfiguration = addJSONFilesToJSON(rootPath,configuration);
    if (updatedConfiguration) {
      logger.debug("Configuration is now = "+JSON.stringify(updatedConfiguration));
      var filesFound = Object.keys(updatedConfiguration);
      for (var i = 0; i < filesFound; i++) {
        configuration[filesFound[i]] = updatedConfiguration[filesFound[i]];
      }
    }
    if (scope === endScope) {
      break;
    }
    scope = getNextNarrowestScope(scope);
  }
  return configuration;
}

function getServiceConfiguration(pluginIdentifier,serviceName,serverSettings,productCode) {
  var policy = AGGREGATION_POLICY_NONE;
  var directories = makeConfigurationDirectoriesStructInner(serverSettings,productCode);
  var relativeLocation = pluginIdentifier+'/_internal/services/'+serviceName;
  var configuration = getJSONFromLocation(relativeLocation,directories,CONFIG_SCOPE_PRODUCT,CONFIG_SCOPE_INSTANCE);
  return new InternalConfiguration(configuration);
}
exports.getServiceConfiguration = getServiceConfiguration;

//reserved folder _internal
//may contain services and plugin
function getPluginConfiguration(identifier,serverSettings,productCode) {
  var policy = AGGREGATION_POLICY_NONE;
  var directories = makeConfigurationDirectoriesStructInner(serverSettings,productCode);
  var relativeLocation = identifier+'/_internal/plugin';
  var configuration = getJSONFromLocation(relativeLocation,directories,CONFIG_SCOPE_PRODUCT,CONFIG_SCOPE_INSTANCE);
  return new InternalConfiguration(configuration);
};
exports.getPluginConfiguration = getPluginConfiguration;

function getConfigFileForPath(service, username, path, filename, scope, pluginDefinition) {
  var directories = getDirectoriesFromServiceSettings(service, username);
  if (directories != null) {
    var returnObject = findResourceAndPath(path,pluginDefinition,directories);
    var lastPath = returnObject.path;
    var resourceObject = returnObject.resource;
    var resourceList = returnObject.resourceList;
    
    if (resourceObject != null && lastPath != null) {
      var itemName = (filename ? filename : "");

      var fileJson = getJsonLocal(lastPath,itemName,directories,scope,resourceObject);
      return fileJson;
    }
  }
  return null;
}

function ConfigService(context) {
  this.serviceDefinition = context.serviceDefinition;
  this.context = context;
  this.directoryConfig = context.plugin.server.config.user;
  this.productConfig = context.plugin.server.config.app;
  logger = context.logger;
  accessLogger = context.makeSublogger('access');
  this.pluginDefs = context.plugin.server.state.pluginMap;
  const nonuserDirectories = makeConfigurationDirectoriesStruct(this.directoryConfig,this.productConfig.productCode,null);

  //req.session should contain authData???
  //const authPluginSession = getAuthPluginSession(req, authPluginID);
  //const result = yield handler.authorized(req, authPluginSession);
  
  let router = express.Router();
  router.use((request,response,next)=> {
    let authData = {username:request.username};
    
    accessLogger.debug('Configuration service requested. Path='+request.path+'. Name Query='+request.query.name);
    var uri = request.path;
    accessLogger.debug('Query object='+JSON.stringify(request.query)+'. Looking up resource='+uri);
    if (request.query.name && ((request.query.name.indexOf('/') != -1) || (request.query.name == '.') || (request.query.name == '..'))) {
      logger.warn("Attempt to access arbitrary filesystem location. Path="+request.path+", offset="+request.query.name);
      respondWithJsonError(response,"Resource cannot begin with relative path",HTTP_STATUS_BAD_REQUEST);
      return;
    }
    request.resourceURL = '';
    request.scope = 0;
    var primaryResource = null;
    var userGroups = null;
    var groupName = null;
    var lastPath = null;
    var username = null;
    if (authData && authData.username) {
      username = percentEncode(authData.username);
      if (username === null) {
        logger.warn("Username encoding error. Username=${username}");
        respondWithJsonError(response,"Username invalid format",HTTP_STATUS_INTERNAL_SERVER_ERROR);
        return;
      }
    }

    if(this.pluginDefs == null || this.context.plugin.server == null){
      logger.warn("Configuration service error. Plugin list null.");
      respondWithJsonError(response,"Could not find server plugin listing",HTTP_STATUS_INTERNAL_SERVER_ERROR);
      return;
    }
    if(this.context.plugin.server == null){
      logger.warn("Configuration service error. Server object null.");
      respondWithJsonError(response,"Could not find server configuration",HTTP_STATUS_INTERNAL_SERVER_ERROR);
      return;
    }
    

    var directories = Object.assign({usersDir:makeUserConfigurationDirectories(this.directoryConfig,this.productConfig.productCode,username)}, nonuserDirectories);
    if (!directories.productDir || !directories.siteDir || !directories.instanceDir) {
      respondWithJsonError(response,"Could not find installation directory entries in server configuration",HTTP_STATUS_INTERNAL_SERVER_ERROR);
      return;
    }
    request.directories = directories;
    next();
  });
  
  router.param('pluginID', (request,response,next, id) => {
    request.resourceURL+=id;
    request.plugin = this.pluginDefs[id];
    if (!request.plugin) {
      respondWithJsonError(response,"Plugin that was specified was not found",HTTP_STATUS_BAD_REQUEST);
      return;
    }
    var pluginDefinition = request.plugin;
    var configurationData = jsonObjectGetObject(pluginDefinition,"configurationData");
    if (!configurationData) {
      respondWithJsonError(response,"Plugin did not have a definition for the configuration service", HTTP_STATUS_INTERNAL_SERVER_ERROR);
      return;
    }
    else {
      request.currentResourceList = jsonObjectGetObject(configurationData, "resources");
      if (!request.currentResourceList) {
        respondWithJsonError(response, "Plugin did not have configuration resources defined", HTTP_STATUS_INTERNAL_SERVER_ERROR);
        return;
      }
    }
    next();
  });

  router.use(bodyParser.text({type:'application/json'}));
  router.use(bodyParser.text({type:'text/plain'}));
  router.use(bodyParser.text({type:'text/html'}));
  
  context.addBodyParseMiddleware(router);
  
  router.get('/:pluginID/product/:resource*',(request, response)=> {
    request.scope = CONFIG_SCOPE_PRODUCT;
    request.resourceURL+='/product';
    let parts = getResourcePartsOrFail(request,response);
    if (!parts) {
      return;
    }
    determineResource(null,parts,0,request,response);
  });
  router.all('/:pluginID/site/:resource*',(request, response)=> {
    request.scope = CONFIG_SCOPE_SITE;
    request.resourceURL+='/site';
    let parts = getResourcePartsOrFail(request,response);
    if (!parts) {
      return;
    }
    determineResource(null,parts,0,request,response);
  });
  router.all('/:pluginID/instance/:resource*',(request, response)=> {
    request.scope = CONFIG_SCOPE_INSTANCE;
    request.resourceURL+='/instance';
    let parts = getResourcePartsOrFail(request,response);
    if (!parts) {
      return;
    }
    determineResource(null,parts,0,request,response);
  });
  router.all('/:pluginID/user/:resource*',(request, response)=> {
    request.scope = CONFIG_SCOPE_USER;
    request.resourceURL+='/user';    
    if (!request.username) {
      respondWithJsonError(response,"Requested user scope without providing username",HTTP_STATUS_BAD_REQUEST);
      return;
    }
    let parts = getResourcePartsOrFail(request,response);
    if (!parts) {
      return;
    }
    determineResource(null,parts,0,request,response);
  });

  /*extra level*/
  /*
  router.all('/:pluginID/group/:groupname/:resource*',(request, response)=> {
    request.scope = CONFIG_SCOPE_GROUP;
    request.resourceURL+='/group';
    let authData = request.session;//TODO
    var groupValid = false;
    if (authData.roles) {
      for (let j = 0; j < authData.roles.length; j++) {
        if (authData.roles[j] == request.params.groupname) {
          groupValid = true;
          break;
        }
      }
    }
    if (!groupValid) {
      respondWithJsonError(response,"Invalid group given",HTTP_STATUS_BAD_REQUEST);
      return;
    }
    var namedScope = percentEncode(request.params.groupname);
    determineResourceForNamedScope(request,response,namedScope);
  });

  router.all('/:pluginID/users/:username/:resource*',(request, response)=> {
    request.scope = CONFIG_SCOPE_USER;
    request.resourceURL+='/users';
    var namedScope = percentEncode(request.params.username);
    determineResourceForNamedScope(request,response,namedScope);    
  });
  */

  var dispatchByMethod = function(request, response, lastPath) {
    /* HERE:
       we have lastPath=full path to folder we want, as well as a good(ish?) name for the resource to return.
       currentResource =last resource name
       scope=the place we stop at, in upper case
       groupname=the group asked for, if scope is group
       pluginid = the plugin requested
       webplugin = the webplugin for that id, if we needed it again
       currentResourceList = subresources for last object
       resourceurl = current path to resource for giving a listing
    */    
    switch (request.method) {
    case 'GET':
      return handleGet(request,response,lastPath);
    case 'POST':
      return handlePost(request,response,lastPath);
    case 'PUT':
      return handlePut(request,response,lastPath);
    case 'DELETE':
      return handleDelete(request,response,lastPath);
    default:
      logger.warn("Unhandled method type requested. Method="+request.method);
      respondWithJsonError(response,"Method not allowed",HTTP_STATUS_METHOD_NOT_FOUND,request.resourceURL);
      return 1;
    }
  };

  var determineResourceForNamedScope = function(request, response, name) {
    var directoryConfig = this.directoryConfig;
    var productCode = this.productConfig.productCode;

    var scopeDir = (request.scope == CONFIG_SCOPE_GROUP) ? jsonObjectGetString(directoryConfig, "groupsDir") :
      jsonObjectGetString(directoryConfig, "usersDir");
    var namedPath = scopeDir + '/' + name;
    var productCodePath = namedPath + '/' + productCode;
    var fullNamedPath = productCodePath + '/pluginStorage';
    if (request.scope == CONFIG_SCOPE_GROUP) {
      request.directories.groupsDir = fullNamedPath;
    } else {
      request.directories.usersDir = fullNamedPath;
    }

    createMissingFolderAsync(null,namedPath,()=> {
      createMissingFolderAsync(null,productCodePath,()=> {
        createMissingFolderAsync(null,fullNamedPath,()=> {
          request.resourceURL+='/'+name;
          let parts = getResourcePartsOrFail(request,response);
          if (!parts) {
            return;
          }
          determineResource(null,parts,0,request,response);
        });
      });
    });
  };

  var getResourcePartsOrFail = function(request, response) {
    let first = request.params.resource;
    if (!first) {
      respondWithJsonError(response,"URL too short for scope given. Username, group, or resource not provided.",HTTP_STATUS_BAD_REQUEST);
      return null;
    }
    let params = request.params[0].split("/");
    let parts = [first];
    let i = 1;
    let part;
    while ((part = params[i++])) {
      parts.push(part);
    }
    return parts;
  };
  
  var determineResource = function(lastPath, uriParts, partsIndex, request, response) {
    if (partsIndex >= uriParts.length) {
      dispatchByMethod(request, response, lastPath);
    }
    else {
      let currentResource = uriParts[partsIndex];
      if (!currentResource) {
        respondWithJsonError(response,`Resource missing from request or malformed`,HTTP_STATUS_BAD_REQUEST);
        return 1;
      }
      request.resourceURL+='/'+currentResource;

      request.currentResourceObject = getResourceDefinitionJsonOrFail(response,request.currentResourceList,currentResource);
      if (!request.currentResourceObject) {
        return 1;
      }
      createMissingFoldersAsync(lastPath, request.params.pluginID, request.currentResourceObject, currentResource, request.directories,(lastPath)=> {
        request.currentResourceList = jsonObjectGetObject(request.currentResourceObject, "subResources");
        determineResource(lastPath,uriParts,partsIndex+1,request,response);
      });
    }
    return 0;
  };  

  var handleGet = function(request,response,lastPath) {
    //if ?name is specified, return an individual file
    //else, concat all files in this location.
    //if not a leaf, return a json with list of subresources
    //if not a leaf but has ?name, return that next level
    let itemName = request.query.name ? percentEncode(request.query.name) : '';
    if (itemName === null) {
      respondWithJsonError(response,`Invalid value for query parameter name`,HTTP_STATUS_BAD_REQUEST);
      return 1;
    }
    let b64 = request.query.b64;
    let isB64 = b64 ? (b64.toLowerCase() == 'true') : false;
    logger.debug("Reached the GET case. lastPath="+lastPath+". itemName="+itemName);
    if (!request.currentResourceList && itemName.length>0) {
      //respond with one file
      accessLogger.debug(`Configuration service handling request for element. Resource${request.resourceURL}, Element=${itemName}, Scope=${request.scope}.`);
      respondWithConfigFile(response,itemName,request.currentResourceObject,request.directories,request.scope,lastPath,request.resourceURL);
    }
    else if (request.currentResourceList && itemName.length===0) {
      //give us a listing of sub resources
      accessLogger.debug(`Configuration service handling resource listing request. Resource=${request.resourceURL}.`);
      respondWithSubDirectoryListing(response, request.currentResourceList,request.resourceURL);
    }
    else {
      let listing = request.query.listing ? (request.query.listing.toLowerCase() == 'true') : false;
      accessLogger.debug(`Configuration service responding with elements in resource. Resource=${request.resourceURL}, Element=${itemName}, Scope=${request.scope}. ListingOnly=${listing}.`);
      if (!listing) {
        //give us a collection of all files in this folder            
        respondWithFilesInDirectory(response,itemName,request.currentResourceObject,request.currentResourceList,request.directories,
                                    request.scope,lastPath,request.resourceURL);
      } else {
        respondWithFilenamesInDirectory(response,itemName,request.currentResourceObject,request.currentResourceList,request.directories,
                                        request.scope,lastPath,request.resourceURL);
      }
      
    }
  };

  var handlePost = function(request,response,lastPath) {
    respondWithJsonError(response,"POST method unhandled",HTTP_STATUS_BAD_REQUEST,request.resourceURL);
    return 1;
  };

  var handleDelete = function(request,response,lastPath) {
    //if ?name is specified, delete an individual file
    //else, delete all files in this location.
    //if not a leaf, return warning unless ?recursive=true
    //if not a leaf but has ?name, delete that next level
    let itemName = request.query.name ? percentEncode(request.query.name) : '';
    if (itemName === null) {
      respondWithJsonError(response,`Invalid value for query parameter name`,HTTP_STATUS_BAD_REQUEST);
      return 1;
    }
    let timestamp = request.query.lastmod;
    let recursive = request.query.recursive;
    let isRecursive = recursive ? (recursive.toLowerCase() == 'true') : false;
    logger.debug("Reached the DELETE case. lastPath="+lastPath+". itemName="+itemName);
    if (!request.currentResourceList && itemName.length>0) {
      //delete one file
      accessLogger.debug(`Configuration service handling element deletion request. Resource=${request.resourceURL}, Element=${itemName}, Scope=${request.scope}.`);
      restCheckModifiedTimestamp(itemName,request.directories,request.scope,lastPath,timestamp).then(()=> {
        handleDeleteFileRequest(response,itemName,request.currentResourceObject,request.directories,request.scope,lastPath,request.resourceURL);
      }, (err)=> {
        if (err && err.message === 'Timestamp mismatch'){
          logger.warn(`Could not delete resource (${request.resourceURL}/${itemName}) due to timestamp mismatch`);
          respondWithJsonError(response,`Timestamp mismatch`,HTTP_STATUS_BAD_REQUEST,request.resourceURL);
        } else {  
          logger.warn(`Failed to check resource timestamp. Resource=${request.resourceURL}, Element=${itemName}, Err=${err.stack}`);
          respondWithJsonError(response,`Timestamp check failure`,HTTP_STATUS_INTERNAL_SERVER_ERROR,request.resourceURL);
        }
      });
    }
    else if (request.currentResourceList && itemName.length===0) {
      //delete folder if recursive set
      if (isRecursive) {
        accessLogger.debug(`Configuration service handling resource deletion request. Resource=${request.resourceURL}, Scope=${request.scope}.`);
        checkResourceModifiedTimestamp(itemName,request.directories,request.scope,lastPath,timestamp,true).then(()=> {
          handleDeleteFolderRequest(response,itemName,request.currentResourceObject,request.directories,request.scope,lastPath,request.resourceURL);
        }, (err) => {
          if (err && err.message === 'Timestamp mismatch'){
            logger.warn(`Could not delete resource (${request.resourceURL}) due to timestamp mismatch`);
            respondWithJsonError(response,`Timestamp mismatch`,HTTP_STATUS_BAD_REQUEST,request.resourceURL);
          } else {
            logger.warn(`Failed to check resource timestamp. Resource=${request.resourceURL}, Err=${err.stack}`);
            respondWithJsonError(response,`Timestamp check failure`,HTTP_STATUS_INTERNAL_SERVER_ERROR,request.resourceURL);
          }
        });
      }
      else {
        respondWithJsonError(response,"Cannot delete non-leaf resource without recursive=true",HTTP_STATUS_BAD_REQUEST,request.resourceURL);
      }
    }
    else {
      //delete folder
      accessLogger.debug(`Configuration service handling resource deletion request. Resource=${request.resourceURL}, Element=${itemName}, Scope=${request.scope}.`);
      handleDeleteFolderRequest(response,itemName,request.currentResourceObject,request.directories,request.scope,lastPath,request.resourceURL);          
    }
    return 0;
  };

  var handlePut = function(request,response,lastPath) {
    //replace or create an element, or replace entire collection with another collection
    let itemName = request.query.name ? percentEncode(request.query.name) : '';
    if (itemName === null) {
      respondWithJsonError(response,`Invalid value for query parameter name`,HTTP_STATUS_BAD_REQUEST);
      return 1;
    }
    logger.debug("Reached the PUT case. lastPath="+lastPath+". itemName="+itemName);
    if (request.currentResourceList && itemName.length<=0) {
      //Not a leaf, reject
      respondWithJsonError(response,"Cannot update a non-leaf resource",HTTP_STATUS_BAD_REQUEST,request.resourceURL);
      return 1;
    }

    if (typeof request.body !== 'string') {
      respondWithJsonError(response,"Could not access PUT body.",HTTP_STATUS_BAD_REQUEST,request.resourceURL);
      return 1;
    }
    try {
      //We only support JSON storage for now.
      //If we attempt to write out a string that isnt JSON, retrieval will be broken.
      //This also handles the case in which body was just empty...
      const bodyTest = JSON.parse(request.body);
    } catch (e) {
      respondWithJsonError(response,"PUT body is not JSON.",HTTP_STATUS_BAD_REQUEST,request.resourceURL);
      return 1;
    }
    
    let b64 = request.query.b64;
    let isB64 = b64 ? (b64.toLowerCase() == 'true') : false;
    let timestamp = request.query.lastmod;
    /* NOTE: here, scope only indicates where to place the files. aggregation policy is ignored */
    if (!request.currentResourceList && itemName.length>0) {
      //Replace or create one file
      accessLogger.debug(`Configuration service handling element write request. `
                         +`Resource=${request.resourceURL}, Element=${itemName}, Scope=${request.scope}.`);
      restCheckModifiedTimestamp(itemName,request.directories,request.scope,lastPath,timestamp).then(()=> {
        replaceOrCreateFile(response, itemName, request.directories,
                            request.scope,lastPath, request.resourceURL, request.body, request.body.length);
      }, (err)=> {
        if (err && err.message === 'Timestamp mismatch'){
          logger.warn(`Could not delete resource due to timestamp mismatch. `
                      +`Resource=${request.resourceURL}, Element=${itemName}`);
          respondWithJsonError(response,`Timestamp mismatch`,HTTP_STATUS_BAD_REQUEST,request.resourceURL);
        } else {  
          logger.warn(`Failed to check resource timestamp. Resource=${request.resourceURL}, `
                      +`Element=${itemName}, Err=${err.stack}`);
          respondWithJsonError(response,`Timestamp check failure`,
                               HTTP_STATUS_INTERNAL_SERVER_ERROR,request.resourceURL);
        }
      });
    }
    else {
      //this also means deleting files that were previously there and not listed.
      respondWithJsonError(response,"Response type not implemented.",
                           HTTP_STATUS_NOT_IMPLEMENTED,request.resourceURL);
      /*
        replaceOrCreateDirectoryFiles(response,itemName,request.currentResourceObject,
        request.currentResourceList,request.directories,
        request.scope,lastPath,request.resourceURL);
      */
    }        
    return 0;
  };
  this.router = router;
};

ConfigService.prototype.getRouter = function() {
  return this.router;
};

exports.configRouter = function(context) {
  return new Promise(function(resolve,reject) {
    let dataservice =  new ConfigService(context);
    resolve(dataservice.getRouter());
  });
};


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

