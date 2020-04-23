
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
  global.COM_RS_COMMON_LOGGER.addDestination(global.COM_RS_COMMON_LOGGER.makeDefaultDestination(true,true,true,true,true));
}

const path = require('path');
const fs = require('fs');
const Promise = require('bluebird');
const ipaddr = require('ipaddr.js');
const dns = require('dns');
const dnsLookup = Promise.promisify(dns.lookup);
const mergeUtils = require('../utils/mergeUtils');

const loggers = {
  bootstrapLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.bootstrap"),
  authLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.auth"),
  contentLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.static"),
  childLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.child"),
  utilLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.utils"),
  proxyLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.proxy"),
  installLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.install"),
  apiml: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.apiml"),
  routing: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.routing"),
  network: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.network"),
  langManager: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.lang"),
  clusterLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.cluster"),
  storeLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.store"),
  syncLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.sync"),
  raftLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.raft"),
};

module.exports.loggers = loggers;

module.exports.initLoggerMessages = function initLoggerMessages(logLanguage) {
  var messages;
  let lang = logLanguage ? logLanguage : 'en';
  try { // Attempt to get a log message for a language a user may have specified
    var logFile = require(`./assets/i18n/log/messages_${lang}.json`);
    messages = logFile;

    if (lang != 'en') {
      let logFileEN = require(`./assets/i18n/log/messages_en.json`);
      messages = Object.assign(logFileEN, messages); // Merge the two, with the language-specific file
      // overwriting the non-English one (so English messages get preserved even if no translations exist)
    }

  } catch (err) { // If we encountered an error...
    console.log("ZWED0156W - 1 function initLoggerMessages - ERROR - ", err);
      try {
        if (messages) { // and 'messages' exist, then these messages came from a language file,
          // but the EN language file lookup failed (that is why we are in this catch), so we are all done here.
        } 
        else if (lang != 'en') { // If 'messages' does not exist, then the first 'logFile' lookup failed and put us here,
          let logFileEN = require(`./assets/i18n/log/messages_en.json`); // so let's try English.
          messages = logFileEN;
        }
      }
      catch (err) { // If all else fails, create loggers without specified messages.
        console.log("ZWED0157W - 2 function initLoggerMessages - ERROR - ", err);
        messages = undefined;
      }
  }

  if (messages) {
    loggers.bootstrapLogger._messages = messages;
    loggers.authLogger._messages = messages;
    loggers.contentLogger._messages = messages;
    loggers.childLogger._messages = messages;
    loggers.utilLogger._messages = messages;
    loggers.proxyLogger._messages = messages;
    loggers.installLogger._messages = messages;
    loggers.apiml._messages = messages;
    loggers.routing._messages = messages;
    loggers.network._messages = messages;
    loggers.langManager._messages = messages;
    loggers.clusterLogger._messages = messages;
    loggers.storeLogger._messages = messages;
  }
};

module.exports.resolveRelativePaths = function resolveRelativePaths(root, resolver, relativeTo) {
  for (const key of Object.keys(root)) {
    const value = root[key];
    const valueType = typeof value;
    if (valueType == 'object') {
      resolveRelativePaths(value, resolver, relativeTo);
    } else if ((valueType == 'string') && value.startsWith('../')) {
      const old = root[key];
      root[key] = resolver(value, relativeTo);
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
      loggers.bootstrapLogger.warn("ZWED0052W", filePath, e.message); //loggers.bootstrapLogger.warn('Error when reading file='+filePath+'. Error='+e.message);
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
    throw new Error("ZWED0049E - Can't specify error metadata");
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
        logger.warn("ZWED0053W", err); //logger.warn("Event handler failed: " + err);
      }
    });
  }
}

module.exports.uniqueIps = Promise.coroutine(function *uniqueIps(hostnames) {
  if (hostnames == null) {
    loggers.network.debug("ZWED0184I"); //loggers.network.debug("uniqueIps: no addresses specified, returning 0.0.0.0");
    return [ '0.0.0.0' ];
  }
  let set = new Set();
  for (let hostname of hostnames) {
    if (typeof hostname == 'string') { //really... dnsLookup would not throw on a non-string such as false
      try {
        const ipAddress = yield dnsLookup(hostname);
        set.add(ipAddress);
      } catch (e) {
        loggers.network.warn(`ZWED0054W`, hostname); //loggers.network.warn(`Skipping invalid listener address=${hostname}`);
      }
    } else {
      loggers.network.warn(`ZWED0055W`, hostname); //loggers.network.warn(`Skipping invalid listener address=${hostname}`);
    }
  }
  const arr = Array.from(set)
  loggers.network.debug("ZWED0185I", arr); //loggers.network.debug("uniqueIps: " + arr);
  return arr;
})

module.exports.getLoopbackAddress = function getLoopbackAddress(listenerAddresses) {
  if (listenerAddresses == null || listenerAddresses.length === 0) {
    loggers.network.debug("ZWED0186I"); //loggers.network.debug("getLoopbackAddress: no addresses specified, "
        //+ "loopback address is 127.0.0.1");
    return '127.0.0.1';
  }
  for (let addressString of listenerAddresses) {
    try {
      const address = ipaddr.process(addressString);
      if (address.range() == 'loopback') {
        const result = address.toString();
        loggers.network.debug(`ZWED0187I`, result); //loggers.network.debug(`found loopback address ${result}`);
        return result;
      } else if (address.toNormalizedString() == '0.0.0.0') {
        loggers.network.debug("ZWED0188I"); //loggers.network.debug("getLoopbackAddress: will listen on 0.0.0.0, "
            //+ "loopback address is 127.0.0.1");
        return '127.0.0.1';
      }
    } catch (e) {
      loggers.network.warn(`ZWED0056W`, addressString); //loggers.network.warn(`Couldn't process ${addressString} as IP`);
    }
  }
  loggers.network.warn("ZWED0057W", listenerAddresses, listenerAddresses[0]);
      //`Loopback calls: localhost equivalent address not found in list ${listenerAddresses}. `
      //+ `Using first address (${listenerAddresses[0]}); Verify firewall will allow this.`);
  return listenerAddresses[0];
}

module.exports.formatErrorStatus = function formatErrorStatus(err, descriptions) {
  const description = (descriptions[err.status] || err.status) + ": ";
  const keywords = [];
  
  for (let key of Object.keys(err)) {
    if (key == "status") {
      continue;
    } 
    keywords.push(`${key}: ${err[key]}`);
  }
  return description + keywords.join(', ');
}

module.exports.normalizePath = function(oldPath, relativeTo) {
  let normalized = oldPath;
  if (!relativeTo) { relativeTo = process.cwd();}
  if (!path.isAbsolute(oldPath)) {
    normalized = path.normalize(path.join(relativeTo,oldPath));
  }
  if (normalized.endsWith(path.sep)) {
    normalized = normalized.substring(0,normalized.length-1);
  }
  loggers.utilLogger.info(`ZWED0051I`, oldPath, normalized);   //loggers.utilLogger.info(`Resolved path: ${oldPath} -> ${normalized}`);  
  return normalized;
}

module.exports.DataserviceStorage = function(id) {
  return new DataserviceStorage(id);
}

function DataserviceStorage(id) {
  this.storageDict = {};
  
  if (id) {
    this.pluginId = id;
    this.storageDict[id] = {};
  }

  this.get = function (key, pluginId) {
    const identifier = pluginId || this.pluginId;

    if (this.storageDict[identifier]) { // If plugin storage exists
      if (this.storageDict[identifier][key]) { // and if the value, from key, exists
        return this.storageDict[identifier][key]; // return the value.
      } else {
        return null;
      }
    }
    return null;
  }

  this.getAll = function (pluginId) {
    if (pluginId === undefined) {
      if (this.pluginId) { // This was set previously above
        return this.storageDict[this.pluginId];
      } else {
        return this.storageDict;
      }
    }

    if (this.storageDict[pluginId]) { // However, this we need to check if exists
      return this.storageDict[pluginId];
    }

    /* Otherwise, return an empty set. This isn't null because null breaks things in the top-most layer (i.e. webapp, cluster)*/
    return {};
  }

  this.set = function (key, value, pluginId) {
    const identifier = pluginId || this.pluginId;

    if (identifier) {
      // Are we attempting to put something inside storage that doesn't exist?
      if (this.storageDict[identifier] === undefined) {
        this.storageDict[identifier] = {}; // So then make the storage
      }

      this.storageDict[identifier][key] = value;
    } else {
      console.warn("No specified plugin identifier to set storage value");
    }
  }

  this.setAll = function (dict, pluginId) {
    const identifier = pluginId || this.pluginId;

    if (identifier) {
      this.storageDict[identifier] = dict; // Set the whole storage object
    } else {
      console.warn("No specified plugin identifier to set storage value");
    }
  }

  this.delete = function (key, pluginId) {
    const identifier = pluginId || this.pluginId;

    if (this.storageDict[identifier]) { // If plugin storage exists
      if (this.storageDict[identifier][key]) { // and if the value, from key, exists
        delete this.storageDict[identifier][key]; // remove as desired.
      } else {
        console.warn("Storage for key '" + key + "' doesn't exist or has been already deleted");
      }
    } else {
      console.warn("Storage for id '" + identifier + "' doesn't exist or has been already deleted");
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

