/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

const fs = require('fs');
const os = require('os');
let keyring_js;

if (!global.COM_RS_COMMON_LOGGER) {
  const loggerFile = require('../../zlux-shared/src/logging/logger.js');
  global.COM_RS_COMMON_LOGGER = new loggerFile.Logger();
  global.COM_RS_COMMON_LOGGER.addDestination(global.COM_RS_COMMON_LOGGER.makeDefaultDestination(true,true,true,true,true));
}
const logger = global.COM_RS_COMMON_LOGGER.makeComponentLogger("_zsf.verify");

try {
  if (os.platform() == 'os390') {
    keyring_js = require('keyring_js');
  }
} catch (e) {
  logger.warn('Could not load zcrypto library, SAF keyrings will be unavailable');
}
const forge = require('node-forge');
const { readFileAsBinaryString } = require('../lib/util');

const argParser = require('./argumentParser');



const CERT_ARGS = [
  new argParser.CLIArgument('certificate', 'c', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('type', 't', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('alias', 'a', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('eku', 'e', argParser.constants.ARG_TYPE_FLAG),
];
const commandArgs = process.argv.slice(2);
const argumentParser = argParser.createParser(CERT_ARGS);
const userInput = argumentParser.parse(commandArgs);

if (!userInput.certificate) {
  logger.severe('ZWED5018E - Missing one or more parameters required to run.\nCertificate file was '+userInput.config);
  process.exit(-1);
}
if (!userInput.certificate) {
  logger.severe('ZWED5018E - Missing one or more parameters required to run.\nCertificate type was '+userInput.type);
  process.exit(-1);
}
if (userInput.type == 'JCERACFKS' && !userInput.alias) {
  logger.severe('ZWED5018E - Missing one or more parameters required to run.\nCertificate alias was '+userInput.alias);
  process.exit(-1);
}


let cert;
if (userInput.type == 'JCERACFKS') {
  logger.debug('Checking keyring');
  if (userInput.certificate.startsWith('safkeyring')) {
    let markerIndex = userInput.certificate.indexOf('://');
    if (markerIndex == -1) {
      logger.severe('Invalid certificate name "'+userInput.certificate+'"');
      process.exit(-1);
    } else {
      let userAndRingname = userInput.certificate.substring(markerIndex+3);
      if (userAndRingname.startsWith('//')) { //get rid of safkeyring:////
        userAndRingname = userAndRingname.substring(2);
      }
      let splitIndex = userAndRingname.indexOf('/');
      if (splitIndex == -1 || splitIndex == 0) {
        logger.severe('Invalid certificate name "'+userInput.certificate+'"');
        process.exit(-1);
      } else {
        let username = userAndRingname.substring(0, splitIndex);
        let ringname = userAndRingname.substring(splitIndex+1);
        let keyringData = keyring_js.getPemEncodedData(username, ringname, userInput.alias).certificate;
    
        cert = forge.pki.certificateFromPem(keyringData);        
      }  
    }
  } else {
    logger.severe('Invalid certificate name "'+userInput.certificate+'"');
    process.exit(-1);
  }
} else if (userInput.type.startsWith('JCE')) {
  logger.info('Will not validate certificate of type='+userInput.type);
  process.exit(0);
} else if (userInput.type == 'PEM') {
  logger.debug('Checking PEM');
  let pem = fs.readFileSync(userInput.certificate, 'utf8');
  cert = forge.pki.certificateFromPem(pem);
} else if (userInput.type == 'PKCS12') {
  logger.debug('Checking PKCS12 for alias '+userInput.alias);
  const p12Content = readFileAsBinaryString(userInput.certificate);
  const p12Asn1 = forge.asn1.fromDer(p12Content);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, process.env.ZWE_zowe_certificate_keystore_password);
  for (let i = 0; i < p12.safeContents.length; i++) {
    let safeContent = p12.safeContents[i];
    for (let j = 0; j < safeContent.safeBags.length; j++) {
      let bag = safeContent.safeBags[j];
      if (bag.type === forge.pki.oids.certBag) { // this can be a certificate OR a CA
        logger.debug('found a cert '+bag.attributes.friendlyName);
        if (bag.attributes.friendlyName == userInput.alias) {
          logger.debug('found an alias match');
          cert = bag.cert;
          break;
        }
      }        
    }
  }
} else {
  logger.info('Will not validate certificate of type='+userInput.type);
  process.exit(0);
}

if (!cert) {
  logger.info('Certificate unhandled, certificate checks skipped.');
  process.exit(0);
}


if (cert != undefined && userInput.eku) {
  let EKU = cert.getExtension('extKeyUsage');
  if (EKU) {
    if (EKU.serverAuth != true) {
      logger.severe('Error: Certificate EKU missing Server Auth 1.3.6.1.5.5.7.3.1 attribute.');
      logger.severe('See https://docs.zowe.org/stable/user-guide/configure-certificates#extended-key-usage');
      logger.severe('Create a new certificate that meets the EKU requirements of Zowe before using Zowe.');
      process.exit(-1);
    } else if (EKU.clientAuth != true) {
      logger.severe('Error: Certificate EKU missing Client Auth 1.3.6.1.5.5.7.3.2 attribute.');
      logger.severe('See https://docs.zowe.org/stable/user-guide/configure-certificates#extended-key-usage');
      logger.severe('Create a new certificate that meets the EKU requirements of Zowe before using Zowe.');
      process.exit(-1);
    } else {
      logger.info('Certificate EKU present with both server and client auth');
    }
  } else {
    logger.info('Certificate auth compatible');
  }
}

let currentTime = Date.now();
if (cert.validity?.notBefore) {
  if (cert.validity.notBefore.getTime() > currentTime) {
    logger.severe('Error: Certificate is not yet valid. Will not be valid until: '+cert.validity.notBefore.toString());
    process.exit(-1);
  }
}
if (cert.validity?.notAfter) {
  if (cert.validity.notAfter.getTime() < currentTime) {
    logger.severe('Error: Certificate has expired at '+cert.validity.notAfter.toString());
    process.exit(-1);
  }
  logger.info('Certificate is valid until '+cert.validity.notAfter.toString());
}
logger.info('Certificate checks complete');
process.exit(0);
