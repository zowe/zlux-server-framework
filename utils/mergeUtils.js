/*
 This program and the accompanying materials are
 made available under the terms of the Eclipse Public License v2.0 which accompanies
 this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
 
 SPDX-License-Identifier: EPL-2.0
 
 Copyright Contributors to the Zowe Project.
*/

function deepAssign(target, source) {
  var retVal = {}
  if (Array.isArray(target)) {
	  retVal = target;
  } else if (typeof target === 'object') {
    Object.keys(target).forEach(function (key) {
      retVal[key] = target[key];
    })
  } 
  Object.keys(source).forEach(function (key) {
    if (typeof source[key] !== 'object' || !target[key]) {
      retVal[key] = source[key];
    } else {
      retVal[key] = deepAssign(target[key], source[key]);
    }
  })
  return retVal;
}
exports.deepAssign = deepAssign;
