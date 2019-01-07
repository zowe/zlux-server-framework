
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';

if (!global.COM_RS_COMMON_LOGGER) {
  const loggerFile = require('../../zlux-shared/src/logging/logger.js');
  global.COM_RS_COMMON_LOGGER = new loggerFile.Logger();
  global.COM_RS_COMMON_LOGGER.addDestination(global.COM_RS_COMMON_LOGGER.makeDefaultDestination(true,true,true));
}

const path = require('path');
const fs = require('fs');
const Promise = require('bluebird');
const ipaddr = require('ipaddr.js');

function compoundPathFragments(left, right) {
  return path.join(left, right).normalize();
}

const loggers = {
  bootstrapLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_unp.bootstrap"),
  authLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_unp.auth"),
  contentLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_unp.static"),
  childLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_unp.child"),
  utilLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_unp.utils"),
  proxyLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_unp.proxy"),
  installLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_unp.install"),
  apiml: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_unp.apiml"),
  routing: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_unp.routing")
};

module.exports.loggers = loggers;

module.exports.resolveRelativePaths = function resolveRelativePaths(currentPath, root) {
  for (const key of Object.keys(root)) {
    const value = root[key];
    const valueType = typeof value;
    if (valueType == 'object') {
      resolveRelativePaths(currentPath, value);
    } else if ((valueType == 'string') && value.startsWith('../')) {
      loggers.utilLogger.info(`Resolved path: ${value} -> ${compoundPathFragments(currentPath, value)}`);
      root[key] = compoundPathFragments(currentPath, value);
    }
  }
};

module.exports.makeOptionsObject = function (defaultOptions, optionsIn) {
  const o = Object.create(defaultOptions);
  Object.assign(o, optionsIn);
  return Object.seal(o);
};

module.exports.clone = function(obj) {
  return JSON.parse(JSON.stringify(obj));
};

module.exports.deepFreeze = function deepFreeze(obj, seen) {
  if (!seen) {
    seen = new Map();
  }
  if (seen.get(obj)) {
    return;
  }
  seen.set(obj, true);
  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const prop = obj[name];
    if (typeof prop == 'object' && prop !== null) {
      deepFreeze(prop, seen);
    }
  }
  return Object.freeze(obj);
};

module.exports.readOnlyProxy = function readOnlyProxy(obj) {
  return new Proxy(obj, {
    get: function(target, property) {
      return target[property];
    }
  });  
};

module.exports.getOrInit = function(obj, key, dflt) {
  let value = obj[key];
  if (!value) {
    value = obj[key] = dflt;
  }
  return value;
};

module.exports.readFilesToArray = function(fileList) {
  var contentArray = [];
  fileList.forEach(function(filePath) {
    try {
      contentArray.push(fs.readFileSync(filePath));
    } catch (e) {
      loggers.bootstrapLogger.warn('Error when reading file='+filePath+'. Error='+e.message);
    }
  });
  if (contentArray.length > 0) {
    return contentArray;
  } else {
    return null;
  }
};

const errorProto = {
    "_objectType": "org.zowe.zlux.error",
    "_metaDataVersion": "1.0.0",
    "returnCode": "1",
    "messageID": "ZOE000E",
    "messageTemplate": "An error occurred",
    "messageParameters": {},
    "messageDetails": "An error occurred when processing the request"
  };

module.exports.makeErrorObject = function makeError(details) {
  if ((details._objectType !== undefined) 
      || (details._metaDataVersion !== undefined)) {
    throw new Error("can't specify error metadata");
  }
  const err = {};
  Object.assign(err, errorProto);
  Object.assign(err, details);
  return err;
}

module.exports.concatIterables = function* concatIterables() {
  for (let i=0; i < arguments.length; i++) {
    yield *arguments[i];
  }
}

/**
 * Makes sure that the invocations of an asynchronous event handler are properly
 * queued. Creates an event listener that wraps the asynchronous `listenerFun`
 * 
 * `listenerFun` should return a promise
 */
module.exports.asyncEventListener = function(listenerFun, logger) {
  //the handler for the most recent event: when this is resolved,
  //another event can be handled
  let promise = Promise.resolve();
  
  return function(event) {
    promise = promise.then(() => {
      return listenerFun(event);
    }, err => {
      if (logger) {
        logger.warn("Event handler failed: " + err);
      }
    });
  }
}

/**
   Extracts what listening address is closest to loopback. Returns 127.0.0.1 or equivalent
   Ideally, or first hostname/IP in listening list otherwise.

   Will throw if given an invalid config.
*/
module.exports.getLoopbackFromConfig = function(webappOptions) {
  //if this isn't here, throw
  let nodeConfig = webappOptions.serverConfig.node;

  let getPreferredAddress = function(addresses) {
    if (!addresses) {
      return '127.0.0.1';
    }
    for (let i = 0; i < addresses.length; i++) {
      let address = addresses[i];
      if (address == 'localhost' || address == '0.0.0.0') {
        return '127.0.0.1';
      } else if (address == '::'
                 //actual madmen
                 || address == '0000:0000:0000:0000:0000:0000:0000:0000') {
        return '::1';
      } else {
        try {
          //ipaddr is not made for hostnames
          if (ipaddr.process(address).range() == 'loopback') {
            return '127.0.0.1';
          } 
        } catch (e) {
          loggers.utilLogger.debug(`Couldn't process ${address} as IP`);
        }
      }
    }
    loggers.utilLogger.warn(`Loopback calls: localhost equivalent address not found in list`,addresses,
                            `. Using first address (${addresses[0]}); Verify firewall will allow this.`);
    return addresses[0];
  }
  
  if (nodeConfig.https) {
    return {
      port: nodeConfig.https.port,
      isHttps: true,
      host: getPreferredAddress(nodeConfig.https.ipAddresses)
    }
  } else {
    return {
      port: nodeConfig.http.port,
      isHttps: false,
      host: getPreferredAddress(nodeConfig.http.ipAddresses)
    }
  }
}


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

