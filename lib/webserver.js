

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';

const Promise = require('bluebird');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const WebSocket = require('ws');
const expressWs = require('@rocketsoftware/express-ws');
const util = require('./util');
const constants = require('./unp-constants');
const reader = require('./reader');
const crypto = require('crypto');

const bootstrapLogger = util.loggers.bootstrapLogger;
const contentLogger = util.loggers.contentLogger;
const childLogger = util.loggers.childLogger;
const networkLogger = util.loggers.network;

const os = require('os');
let keyring_js;
try {
  if (os.platform() == 'os390') {
    keyring_js = require('keyring_js');
  }
} catch (e) {
  bootstrapLogger.warn('Could not load zcrypto library, SAF keyrings will be unavailable');
}

const CRYPTO_CONTENT_CERT=0;
const CRYPTO_CONTENT_KEY=1;
const CRYPTO_CONTENT_CA=2;
const CRYPTO_CONTENT_CRL=3;


function readCiphersFromArray(stringArray) {
  if (stringArray && Array.isArray(stringArray)) {
    let uppercase = [];
    for (let i = 0; i < stringArray.length; i++) {
      if (typeof stringArray[i] != 'string') {
        bootstrapLogger.warn(`ZWED0069W`, stringArray[i]); //bootstrapLogger.warn(`Returning null for cipher array because input had non-string: `,stringArray[i]);
        return null;
      }
      uppercase[i] = stringArray[i].toUpperCase();
    }
    return uppercase.join(':');
  } else {
    return null;
  }
};

function parseSafKeyringAddress(safEntry) {
  const endUserIndex = safEntry.indexOf('/');
  if (endUserIndex == -1) {
    return null;
  } else {
    const userId = safEntry.substring(0,endUserIndex);
    const endNameIndex = safEntry.indexOf('&',endUserIndex+1);
    if (endNameIndex == -1 || endNameIndex == safEntry.length-1) {
      return {
        userId,
        keyringName: safEntry.substring(endUserIndex+1)
      }
    } else {
      return {
        userId,
        keyringName: safEntry.substring(endUserIndex+1,endNameIndex),
        label: safEntry.substring(endNameIndex+1)
      };
    }
  }
}

function getAttributeNameForCryptoType(locationType, cryptoType) {
  switch (locationType) {
  case 'safkeyring':
  default:
    if (cryptoType == CRYPTO_CONTENT_CERT || cryptoType == CRYPTO_CONTENT_CA) {
      return 'certificate';
    } else if (cryptoType == CRYPTO_CONTENT_KEY) {
      return 'key';
    } else {
      return null;
    }
  }
}

function splitCryptoLocationsByType(locations) {
  const locationsByType = {};
  locations.forEach((location)=> {
    const index = location.indexOf('://');
    if (index != -1 && (location.length > index+3)) {
      const type = location.substring(0,index);
      const typeArray = locationsByType[type] || [];
      typeArray.push(location.substring(index+3));
      locationsByType[type] = typeArray;
    }
    else {
      const typeArray = locationsByType['file'] || [];
      typeArray.push(location);
      locationsByType['file'] = typeArray;
    }
  });
  return locationsByType;
}

//  safkeyring://
function loadPem(locations, type, keyrings, pass) {
  const locationsByType = splitCryptoLocationsByType(locations);
  let content = [];
  const saf = locationsByType['safkeyring'];
  if (saf && os.platform() != 'os390') {
    bootstrapLogger.severe('ZWED0145E');//Cannot load SAF keyring content outside of z/OS'
    process.exit(constants.EXIT_NO_SAFKEYRING);
  } else if (saf && keyring_js) {
    saf.forEach((safEntry)=> {
      /*
        In the latest code it's possible the entry could start with
        safkeyring://// instead of safkeyring://, so ignore extra slashes
        TODO: Is this a possibility for other key types also? Keep an eye on this during future enhancements
      */
      const safRingAddress = safEntry.startsWith('//') ? safEntry.substr(2) : safEntry;
      const {userId, keyringName, label} = parseSafKeyringAddress(safRingAddress);
      if (userId && keyringName && label) {
        const cachedKey = 'safkeyring://'+safRingAddress;
        let keyringData = keyrings[cachedKey];
        const attribute = getAttributeNameForCryptoType('safkeyring', type);
        try {
          if (!keyringData) {
            bootstrapLogger.debug(`Cache not found for ${cachedKey}`);
            keyringData = keyring_js.getPemEncodedData(userId, keyringName, label);
            keyrings[cachedKey] = keyringData;
          }
          if (keyringData) {
            if (keyringData[attribute]) {
              content.push(keyringData[attribute]);
            } else {
              //SAF keyring data had no attribute "%s". Attributes=',attribute,Object.keys(keyringData));
              bootstrapLogger.warn('ZWED0146E',attribute,Object.keys(keyringData));
            }
          } else {
            //SAF keyring data was not found for %s',cachedKey);
            bootstrapLogger.warn('ZWED0147E',cachedKey);
          }
        } catch (e) {
          //Exception thrown when reading SAF keyring, e=',e);
          bootstrapLogger.warn('ZWED0148E',e);
        }
      } else {
        //SAF keyring reference missing userId %s, keyringName %s, or label %s',
        bootstrapLogger.warn('ZWED0149E',
                             userId, keyringName, label);
      }
    });
  } else if (saf && !keyring_js) {
    //Cannot load SAF keyring due to missing keyring_js library');
    bootstrapLogger.warn('ZWED0150E');
  }
  const files = locationsByType['file'];
  if (files) {
    //workaround for a bug outside zlux: seems that some yaml files may come in with strings with trailing ',', just strip it.
    content = util.readFilesToArray(files.map(file => file.charAt(file.length-1)==',' ? file.substring(0, file.length-1) : file), 
                                    type, pass).concat(content);
  }
  return {content, keyrings};
}

function readTlsOptionsFromConfig(nodeConfig, httpsOptions, pass) {
  //in case keys and certs can be read from the same keyring, store them here for later retrieval
  let keyrings = {};
  if (nodeConfig.https.pfx) {
    try {
      httpsOptions.pfx = fs.readFileSync(nodeConfig.https.pfx);
      bootstrapLogger.info('ZWED0071I', nodeConfig.https.pfx); //bootstrapLogger.info('Using PFX: '+ nodeConfig.https.pfx);
    } catch (e) {
      bootstrapLogger.warn('ZWED0070W', e.message); //bootstrapLogger.warn('Error when reading PFX. Server cannot continue. Error='
          //+ e.message);
      process.exit(constants.EXIT_PFX_READ);
      throw e;
    }
  } else {
    if (nodeConfig.https.certificates) {
      httpsOptions.cert = loadPem(nodeConfig.https.certificates, CRYPTO_CONTENT_CERT, keyrings, pass).content;
      bootstrapLogger.info('ZWED0072I', nodeConfig.https.certificates); //bootstrapLogger.info('Using Certificate: ' + nodeConfig.https.certificates);
    }
    if (nodeConfig.https.keys) {
      httpsOptions.key = loadPem(nodeConfig.https.keys, CRYPTO_CONTENT_KEY, keyrings, pass).content;
    }
  }
  if (nodeConfig.https.certificateAuthorities) {
    httpsOptions.ca = loadPem(nodeConfig.https.certificateAuthorities, CRYPTO_CONTENT_CA, keyrings, pass).content;
  }
  if (nodeConfig.https.certificateRevocationLists) {
    httpsOptions.crl = loadPem(nodeConfig.https.certificateRevocationLists, CRYPTO_CONTENT_CRL, keyrings, pass).content;
  }
}
  
function WebServer() {
  this.config = null;
}
WebServer.prototype = {
  constructor: WebServer,
  config: null,
  httpOptions: null,
  httpsOptions: null,
  httpsServers: [],
  httpServers: [],
  expressWsHttps: [],
  expressWsHttp: [],

  _setErrorLogger(server, type, ipAddress, port) {
    //the server object will not tell the ipAddr & port unless it has successfully connected,
    //making logging poor unless passed
    server.on('error',(e)=> {
      switch (e.code) {
      case 'EACCES':
        networkLogger.severe(`ZWED0158E`, ipAddress, port); //Could not listen on address %s:%s. Insufficient permissions to perform port bind.
        process.exit(constants.EXIT_HTTPS_LOAD);
        break;
      case 'EADDRINUSE':
        networkLogger.severe(`ZWED0004E`, ipAddress, port); //networkLogger.severe(`Could not listen on address ${ipAddress}:${port}. It is already in use by another process.`);
        process.exit(constants.EXIT_HTTPS_LOAD);
        break;
      case 'ENOTFOUND':
      case 'EADDRNOTAVAIL':
        networkLogger.severe(`ZWED0005E`, ipAddress, port); //networkLogger.severe(`Could not listen on address ${ipAddress}:${port}. Invalid IP for this system.`);
        process.exit(constants.EXIT_HTTPS_LOAD);
        break;
      default:
        networkLogger.warn(`ZWED0071W`, ipAddress, port, e.message, e.stack); //networkLogger.warn(`Unexpected error on server ${ipAddress}:${port}. E=${e}. Stack trace follows.`);
        //networkLogger.warn(e.stack);
      }
    });

  },
  
  getTlsOptions() {
    return this.httpsOptions;
  },

  validateAndPreprocessConfig: Promise.coroutine(function *validateAndPreprocessConfig(zoweConfig) {
    const config = zoweConfig.components['app-server'].node;
    let canRun = false;
    if (config.http?.port) {
      const uniqueIps = yield util.uniqueIps(config.http.ipAddresses);
      if (uniqueIps.length > 0) {
        canRun = true;
        networkLogger.info('ZWED0073I', uniqueIps); //networkLogger.info('HTTP config valid, will listen on: ' + uniqueIps);
      }
      config.http.ipAddresses = uniqueIps;
    } 
    /* TODO this 'canRun' logic has long been here, but I'm wondering if is's
     * adequate: I think we might want to make sure that everything 
     * the user requested is doable, not just something. If either HTTP or HTTPS
     * was requested and we couldn't start it, then we might want to signal an
     * error, rather than trying to chug along somehow... */
    if (config.https?.port) {
      const uniqueIps =  yield util.uniqueIps(config.https.ipAddresses);
      if (uniqueIps.length > 0 && config.https.certificates && config.https.keys) {
        canRun = true;
        networkLogger.info('ZWED0075I', uniqueIps); //networkLogger.info('HTTPS config valid, will listen on: ' + uniqueIps);
      }
      config.https.ipAddresses = uniqueIps;
      if(keyring_js && config.https.certificateAuthorities) {
        let newEntries = [];
        const locationsByType = splitCryptoLocationsByType(config.https.certificateAuthorities);
        if (locationsByType.safkeyring) {
          locationsByType.safkeyring.forEach((keyringLocation)=> {

            const {userId, keyringName, label} = parseSafKeyringAddress(keyringLocation.startsWith('//') ? keyringLocation.substring(2) : keyringLocation);
            let certificateList;
            if(userId && keyringName) {
              try {
                certificateList = keyring_js.listKeyring(userId, keyringName);
              } catch(e) {
                bootstrapLogger.warn('ZWED0179W', keyringName, userId, e);
              }
            }
            if(certificateList) {
              for(let i = 0; i < certificateList.length; i++) {
                if(certificateList[i].usage === 'CERTAUTH') {
                  let safKeyring = `safkeyring:////${userId}/${keyringName}&${certificateList[i].label}`;
                  if(config.https.certificateAuthorities.indexOf(safKeyring) === -1) {
                    newEntries.push(safKeyring);
                  }
                }
              }
            }
          });
        }
        if (locationsByType.file) {
          locationsByType.file.forEach((fileLocation)=> {
            newEntries.push(fileLocation);
          });
        }
        config.https.certificateAuthorities = newEntries;
      }
    }
    return canRun;
  }),

  setConfig(zoweConfig) {
    const nodeConfig = zoweConfig.components['app-server'].node;
    this.config = nodeConfig;
    if (nodeConfig.http && nodeConfig.http.port) {
      this.httpOptions = {};
    }
    if (nodeConfig.https && nodeConfig.https.port) {
      let options = nodeConfig.https;
      this.httpsOptions = {};
      if (typeof nodeConfig.allowInvalidTLSProxy == 'boolean') {
        this.httpsOptions.rejectUnauthorized = !nodeConfig.allowInvalidTLSProxy;
      }
      if (process.env.ZWE_zowe_verifyCertificates == 'NONSTRICT') {
        this.httpsOptions.checkServerIdentity = function(hostname, cert) { return undefined; } 
      }
      //secureOptions and secureProtocol documented here: 
      //https://nodejs.org/api/tls.html#tls_tls_createsecurecontext_options
      if (typeof options.secureOptions == 'number') {
        //the numbers you want here actually come from openssl, and are likely 
        //in this file: https://github.com/openssl/openssl/blob/master/include/openssl/ssl.h
        this.httpsOptions.secureOptions = options.secureOptions;
      } else if (typeof options.secureProtocol == 'string') {
        this.httpsOptions.secureProtocol = options.secureProtocol;
      } else {
        let consts = crypto.constants;
        //tls 1.3 was released in 2018, and tls 1.2 should be in this blacklist list when it has widespread support
        this.httpsOptions.secureOptions = consts.SSL_OP_NO_SSLv2 | 
          consts.SSL_OP_NO_SSLv3 | consts.SSL_OP_NO_TLSv1 | consts.SSL_OP_NO_TLSv1_1;
      }
      
      let ciphers = readCiphersFromArray(options.ciphers);
      if (ciphers == null || ciphers.length==0) {
        ciphers = readCiphersFromArray(constants.HTTPS_DEFAULT_CIPHERS);
      }
      if (ciphers != 'NODEJS') {//for using nodejs defaults - very unlikely to overlap as a reserved word
        this.httpsOptions.ciphers = ciphers;
      }
      bootstrapLogger.debug('Using tls ciphers:',this.httpsOptions.ciphers);
      if (options.enableTrace) {
        this.httpsOptions.enableTrace = true;
      }
      bootstrapLogger.debug('TLS trace:', this.httpsOptions.enableTrace ? 'enabled' : 'disabled');
      readTlsOptionsFromConfig(nodeConfig, this.httpsOptions, zoweConfig.zowe?.certificate?.keystore?.password);
    }
  },  

  startListening: Promise.coroutine(function* (webapp) {
    if (this.config.https && this.config.https.port) {
      const port = this.config.https.port;
      for (let ipAddress of this.config.https.ipAddresses) {
        let listening = false;
        let httpsServer;
        const httpsOptions = this.getTlsOptions();
        while (!listening) {
          try {
            httpsServer = https.createServer(httpsOptions, webapp.expressApp);
            this._setErrorLogger(httpsServer, 'HTTPS', ipAddress, port);
            this.httpsServers.push(httpsServer);
            webapp.expressWs = expressWs(webapp.expressApp, httpsServer, {maxPayload: 50000});
            this.expressWsHttps.push(webapp.expressWs);
            listening = true;
          } catch (e) {
            if (e.message == 'mac verify failure') {
              const r = reader();
              try {
                this.httpsOptions.passphrase = yield reader.readPassword(
                  'HTTPS key or PFX decryption failure. Please enter passphrase: ');
              } finally {
                r.close();
              }
            } else {
              throw e;
            }
          }
        }
        this.callListen(httpsServer, 'https', 'HTTPS', ipAddress, port);
      }
    }
    if (this.config.http && this.config.http.port) {
      const port = this.config.http.port;
      for (let ipAddress of this.config.http.ipAddresses) {
        let httpServer = http.createServer(webapp.expressApp);
        this._setErrorLogger(httpServer, 'HTTP', ipAddress, port);
        this.httpServers.push(httpServer);
        webapp.expressWs = expressWs(webapp.expressApp, httpServer, {maxPayload: 50000});
        this.expressWsHttp.push(webapp.expressWs);
        this.callListen(httpServer, 'http', 'HTTP', ipAddress, port);
      }
    }
  }),

  callListen(methodServer, methodName, methodNameForLogging, ipAddress, port) {
    const addressForLogging = `${ipAddress}:${port}`;
    const logFunction = function () {
      networkLogger.info("ZWED0129I", methodNameForLogging, addressForLogging); //networkLogger.log(bootstrapLogger.INFO,`(${methodNameForLogging})  `
          //+ `Listening on ${addressForLogging}`)
    };
    networkLogger.info("ZWED0130I", methodNameForLogging, addressForLogging); //networkLogger.log(bootstrapLogger.INFO, `(${methodNameForLogging})  `
        //+ `About to start listening on ${addressForLogging}`);
    methodServer.listen(port, ipAddress, logFunction);
  },

  close() {
    this.httpServers.forEach((server)=> {
      let info = server.address();
      if (info) {
        //could be undefined if there was an error binding, yet close() still works
        networkLogger.info(`ZWED0076I`, `${info.address}:${info.port}`); //networkLogger.info(`(HTTP) Closing server ${info.address}:${info.port}`);
      }
      server.close();      
    });
    this.httpsServers.forEach((server)=> {
      let info = server.address();
      if (info) {
        //could be undefined if there was an error binding, yet close() still works
        networkLogger.info(`ZWED0077I`, `${info.address}:${info.port}`); //networkLogger.info(`(HTTPS) Closing server ${info.address}:${info.port}`);
      }
      server.close();      
    });
  }
};

module.exports = WebServer;
module.exports.readTlsOptionsFromConfig = readTlsOptionsFromConfig;

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

