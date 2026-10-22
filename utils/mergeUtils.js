/*
 This program and the accompanying materials are
 made available under the terms of the Eclipse Public License v2.0 which accompanies
 this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
 
 SPDX-License-Identifier: EPL-2.0
 
 Copyright Contributors to the Zowe Project.
*/

function isTerminalPolicyPath(propertyPath) {
  const componentPath = propertyPath[0] === 'haInstances' ? propertyPath.slice(2) : propertyPath;
  return componentPath.length === 3 && componentPath[0] === 'components' &&
    ['tn3270-ng2', 'tn5250-ng2', 'vt-ng2'].includes(componentPath[1]) &&
    ['allowList', 'allowPorts'].includes(componentPath[2]);
}

function isTerminalConfigSectionPath(propertyPath) {
  const componentPath = propertyPath[0] === 'haInstances' ? propertyPath.slice(2) : propertyPath;
  return componentPath[0] === 'components' && (componentPath.length === 1 ||
    (componentPath.length === 2 && ['tn3270-ng2', 'tn5250-ng2', 'vt-ng2'].includes(componentPath[1])));
}


function deepAssign(target, source, propertyPath = []) {
  var retVal = {}
  if (Array.isArray(target)) {
	  retVal = target;
  } else if (typeof target === 'object' && target) {
    Object.keys(target).forEach(function (key) {
      retVal[key] = target[key];
    })
  } 
  Object.keys(source).forEach(function (key) {
    const childPath = propertyPath.concat(key);
    // Policy overrides replace the entire value so validation can reject empty or malformed lists.
    if (isTerminalPolicyPath(childPath) ||
        (isTerminalConfigSectionPath(childPath) && (!isConfigMapping(source[key]) || !isConfigMapping(target[key])))) {
      retVal[key] = source[key];
    } else if (typeof source[key] !== 'object' || !target[key]) {
      if (typeof target == 'string') {
        retVal = source;
      } else {
        retVal[key] = source[key];
      }
    } else {
      retVal[key] = deepAssign(target[key], source[key], childPath);
    }
  })
  return retVal;
}
exports.deepAssign = deepAssign;
