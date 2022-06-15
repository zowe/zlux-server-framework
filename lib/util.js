
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
const forge = require('node-forge');

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
  storeLogger: global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.store")
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

//maybe better in apiml.js but there would be a circular dependency around the logger init.
function getPrefixForService(serviceName, type, version) {
  let typePath = type || 'api';
  let versionPath = version || '1';
  return `/${serviceName}/${typePath}/v${versionPath}`;
};

module.exports.getAgentRequestOptions = function(serverConfig, tlsOptions, includeCert, path) {
  if (serverConfig && serverConfig.node && serverConfig.agent && (serverConfig.agent.https || serverConfig.agent.http)) {
    const agentConfig = serverConfig.agent;
    const useApiml = !!(agentConfig.mediationLayer &&
                        agentConfig.mediationLayer.enabled &&
                        serverConfig.node.mediationLayer &&
                        serverConfig.node.mediationLayer.server);
    
    const isHttps = useApiml ||
          (agentConfig.https && agentConfig.https.port) ||
          (agentConfig.http && agentConfig.http.port && agentConfig.http.attls);
    if (isHttps && !tlsOptions) {
      return undefined;
    }
    let options;
    if (useApiml) {
      const apimlPrefix = getPrefixForService(agentConfig.mediationLayer.serviceName)
      options = {
        host: serverConfig.node.mediationLayer.server.gatewayHostname,
        port: serverConfig.node.mediationLayer.server.gatewayPort,
        protocol: isHttps ? 'https:' : 'http:',
        rejectUnauthorized: !serverConfig.node.allowInvalidTLSProxy,
        apimlPrefix: apimlPrefix,
        path: path ? apimlPrefix + path : undefined,
        requestProcessingOptions: {
          headersToRemove: [ 'origin' ] // fixes issue with CORS in APIML
        }
      }
    } else {
      options = {
        host: agentConfig.host,
        port: agentConfig.https && agentConfig.https.port ? agentConfig.https.port : agentConfig.http.port,
        protocol: isHttps ? 'https:' : 'http:',
        rejectUnauthorized: !serverConfig.node.allowInvalidTLSProxy,
        path: path
      }
    }
    if ((typeof tlsOptions == 'object') && isHttps) {
      options = Object.assign(options, tlsOptions);
      delete options.key;
      if (!includeCert) {
        delete options.cert;
      }
      return options;
    }
    if (options.port && options.host) {
      return options;
    }
  }
  return undefined;
}

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

module.exports.readFilesToArray = function(fileList, type) {
  var contentArray = [];
  fileList.forEach(function(filePath) {
    try {
      let extension = filePath.split('.').pop();
      let content = fs.readFileSync(filePath);
      if(extension == 'p12' || extension == 'pfx'){
        let p12Der = forge.util.decode64(content.toString('base64'));
        let p12Asn1 = forge.asn1.fromDer(p12Der);
        let p12;
        try {
          p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, process.env.KEYSTORE_PASSWORD || "password");
        } catch (e1) {
          loggers.bootstrapLogger.warn("ZWED0173W", e1.message);
          p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, "");
        }
        const certData = p12.getBags({bagType: forge.pki.oids.certBag})[forge.pki.oids.certBag];
        const keyData = p12.getBags({bagType: forge.pki.oids.pkcs8ShroudedKeyBag})[forge.pki.oids.pkcs8ShroudedKeyBag];
        if(certData != undefined && type != 1 && type != 3){ //CRLs not currently supported by node forge
          for(let i = 0; i < certData.length; i++){
            let certObj = certData[i];
            contentArray.push(Buffer.from(forge.pki.certificateToPem(certObj.cert), 'utf8'));
          }
        }
        if(keyData != undefined && type == 1){
          for(let i = 0; i < keyData.length; i++){
            const rsaPrivateKey = forge.pki.privateKeyToAsn1(keyData[i].key);
            const privateKeyInfo = forge.pki.wrapRsaPrivateKey(rsaPrivateKey);
            let privateKeyPem = forge.pki.privateKeyInfoToPem(privateKeyInfo);
            var buf = Buffer.from(privateKeyPem, 'utf8');
            contentArray.push(buf);
          }
        }
      } else {
        if(!content.toString().includes('-----BEGIN')){
          let der = forge.util.decode64(content.toString('base64'));
          let derAsn1 = forge.asn1.fromDer(der);
          if(type == 1){
            let privateKeyInfo = forge.pki.wrapRsaPrivateKey(derAsn1);
            let privateKeyPem = forge.pki.privateKeyInfoToPem(privateKeyInfo);
            contentArray.push(Buffer.from(privateKeyPem, 'utf8'));
          } else {
            let asn1Cert = forge.pki.certificateFromAsn1(derAsn1);
            let pem = forge.pki.certificateToPem(asn1Cert);
            contentArray.push(Buffer.from(pem, 'utf8'));
          }
        } else {
          contentArray.push(content);
        }
      }
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

function normalizePath(oldPath, relativeTo) {
  let normalized = oldPath;
  if (!relativeTo) { relativeTo = process.cwd();}
  if (!path.isAbsolute(oldPath)) {
    normalized = path.normalize(path.join(relativeTo,oldPath));
  }
  if (normalized.endsWith(path.sep)) {
    normalized = normalized.substring(0,normalized.length-1);
  }
  loggers.utilLogger.debug(`ZWED0051I`, oldPath, normalized);   //loggers.utilLogger.info(`Resolved path: ${oldPath} -> ${normalized}`);  
  return normalized;
}
module.exports.normalizePath = normalizePath;

const defaultRemoteAppTemplate = fs.readFileSync(path.join(__dirname,'default-remote-app-template.html'),"utf-8");
module.exports.getRemoteIframeTemplate = function(remoteUrl) {
  return defaultRemoteAppTemplate.replace('${remoteUrl}', remoteUrl);
}

module.exports.makeRemoteUrl = function(destination, req, serverConfig) {
  let referer = req.get('Referer');
  let hostname = !referer ? '' : new URL(referer).hostname;
  loggers.utilLogger.debug(`referer: ${referer}`);

  let zoweExternalHost;
  let zoweExternalPort;

  if(destination.includes('ZOWE_EXTERNAL_HOST') || destination.includes('ZWE_EXTERNAL_HOST')) {
    if( hostname > '') {
      zoweExternalHost = hostname; 
    } else if (process.env.ZWE_EXTERNAL_HOST) {
      zoweExternalHost = process.env.ZWE_EXTERNAL_HOST;
    } else if (process.env.ZOWE_EXTERNAL_HOST) {
      zoweExternalHost = process.env.ZOWE_EXTERNAL_HOST;
    } else {
      zoweExternalHost = process.env.ZWE_zowe_externalDomains_0;
    }
  }
  if (destination.includes('ZWE_EXTERNAL_PORT')) {
    if (process.env.ZWE_zowe_externalPort) {
      zoweExternalPort = process.env.ZWE_zowe_externalPort;
    } else if (process.env.ZWE_EXTERNAL_PORT) {
      zoweExternalPort = process.env.ZWE_EXTERNAL_PORT;
    } else if (serverConfig.node.mediationLayer && serverConfig.node.mediationLayer.server && serverConfig.node.mediationLayer.server.gatewayPort) {
      zoweExternalPort = serverConfig.node.mediationLayer.server.gatewayPort;
    } else if (serverConfig.node.https.port) {
      zoweExternalPort = serverConfig.node.https.port;
    } else {
      zoweExternalPort = serverConfig.node.http.port;
    }
  }

  return destination
          .replace('${ZOWE_EXTERNAL_HOST}', zoweExternalHost)
          .replace('${ZWE_EXTERNAL_HOST}', zoweExternalHost)
          .replace('${GATEWAY_PORT}', process.env.GATEWAY_PORT)
          .replace('${ZWE_EXTERNAL_PORT}', zoweExternalPort);
}

module.exports.isPluginExternal = (plugin) => {
  return plugin.dataServices && plugin.dataServices.length>0 && plugin.dataServices[0].constructor.name === 'ExternalService'
}

module.exports.timeout = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports.serverSwaggerPluginId = 'org.zowe.zlux'
module.exports.agentSwaggerPluginId = 'org.zowe.zlux.agent';

module.exports.getCookieName = (cookieIdentifier) => {
  return 'connect.sid.' + cookieIdentifier;
}

const isHaMode = module.exports.isHaMode = function () {
  const haInstanceCount = +process.env['ZWE_HA_INSTANCES_COUNT'];
  return (!isNaN(haInstanceCount) && haInstanceCount > 1);
}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

