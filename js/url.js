
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/


function makePluginURL(productCode, pluginID) {
  return `/${productCode}/plugins/${pluginID}`;
}

function makeServiceSubURL(service) {
  let nameForURL;
  if (service.type === 'import') {
    nameForURL = service.localName;
  } else {
    nameForURL = service.name;
  }
  return `/services/${nameForURL}`;
}

function join(baseUrl, relativePath) {
  //TODO a better implementation
  return baseUrl + relativePath;
}

module.exports = {
  makePluginURL,
  makeServiceSubURL,
  join
}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
