/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

const ZOWE_PROFILE_NAME_LEN = 246;
const DEFAULT_INSTANCE_ID = "0";

function partsUpToTotalLength(parts, maxLen) {
  let curLen = 0;
  const outParts = [];
  
  for (let p of parts) {
    curLen += p.length;
    if (curLen > maxLen) {
      break;
    }
    curLen++;  //account for the separator
    outParts.push(p);
  }
  return outParts;
}

function rootServiceProfileName(parms){
  if (parms.productCode == null) {
    throw new Error("productCode missing");
  }
  if (parms.instanceID == null) {
    throw new Error("instanceID missing");
  }
  if (parms.rootServiceName == null) {
    throw new Error("rootServiceName missing");
  }
  if (parms.method == null) {
    throw new Error("method missing");
  }
  return `${parms.productCode}.${parms.instanceID}.COR`
      + `.${parms.method}.${parms.rootServiceName}`;
}

function serviceProfileName(parms) {
  if (parms.productCode == null) {
    throw new Error("productCode missing");
  }
  if (parms.instanceID == null) {
    throw new Error("instanceID missing");
  }
  if (parms.pluginID == null) {
    throw new Error("pluginID missing");
  }
  if (parms.serviceName == null) {
    throw new Error("serviceName missing");
  }
  if (parms.method == null) {
    throw new Error("method missing");
  }
  return `${parms.productCode}.${parms.instanceID}.SVC.${parms.pluginID}`
      + `.${parms.serviceName}.${parms.method}`;
}

function configProfileName(parms) {
  if (parms.productCode == null) {
    throw new Error("productCode missing");
  }
  if (parms.instanceID == null) {
    throw new Error("instanceID missing");
  }
  if (parms.pluginID == null) {
    throw new Error("pluginID missing");
  }
  if (parms.method == null) {
    throw new Error("method missing");
  }
  if (parms.scope == null) {
    throw new Error("scope missing");
  }
  return `${parms.productCode}.${parms.instanceID}.CFG.${parms.pluginID}.`
      + `${parms.method}.${parms.scope}`;
}

function makeProfileName(type, parms) {
  let makeProfileName;
  switch(type){
    case "service":
      makeProfileName = serviceProfileName;
      break;
    case "config":
      makeProfileName = configProfileName;
      break;
    case "core":
      makeProfileName = rootServiceProfileName;
      break;
  }
  let profileName = makeProfileName(parms);
  if (profileName.length > ZOWE_PROFILE_NAME_LEN) {
    throw new Error("SAF resource name too long");
  }
  if (parms.subUrl.length > 0) {
    const usableParts = partsUpToTotalLength(parms.subUrl,
          ZOWE_PROFILE_NAME_LEN - profileName.length - 1);
    if (usableParts.length > 0) {
      profileName += '.' + usableParts.join('.');
    }
  }
  return profileName;
}

function makeProfileNameForRequest(url, method, instanceID) {
  let urlData;
  let type;
  if (!url.match(/^\/[A-Za-z0-9]+\/plugins\//)) {
    url = url.toUpperCase();
    type = "core";
    let splitUrl = url.split('/');
    splitUrl = splitUrl.filter(x => x);
    let productCode = "ZLUX";
    let rootServiceName = splitUrl[0];
    let subUrl = splitUrl.slice(1);
    if (!instanceID) {
      instanceID = DEFAULT_INSTANCE_ID;
    }
    urlData = { productCode, instanceID, rootServiceName, method, subUrl };
  } else {
    url = url.toUpperCase();
    let [_l, productCode, _p, pluginID, _s, serviceName, _v, ...subUrl] = url.split('/');
    if (!instanceID) {
      instanceID = DEFAULT_INSTANCE_ID;
    }
    subUrl = subUrl.filter(x => x);
    if ((pluginID === "ORG.ZOWE.CONFIGJS") && (serviceName === "DATA")) {
      type = "config";
      pluginID = subUrl[0];
      let scope = subUrl[1];
      subUrl = subUrl.slice(2);
      urlData = { productCode, instanceID, pluginID, method, scope, subUrl };
    } else {
      type = "service";
      urlData = { productCode, instanceID, pluginID, serviceName, method, subUrl };
    }
    urlData.pluginID = urlData.pluginID? urlData.pluginID.replace(/\./g, "_") : null;
  }
  return makeProfileName(type, urlData);
};

exports.makeProfileNameForRequest = makeProfileNameForRequest;
exports.ZOWE_PROFILE_NAME_LEN = ZOWE_PROFILE_NAME_LEN;
