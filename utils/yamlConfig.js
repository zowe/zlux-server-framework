
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const YAWN = require('yawn-yaml/cjs');
const mergeUtils = require('./mergeUtils');

function encodeKey(key) {
  return key.replace(/[^a-zA-Z0-9]/g, char => '_x' + char.charCodeAt(0).toString(16));
}

function flattenObject(obj, prefix) {
  const result = {};
  const path = prefix;
  flattenObject2(obj, path, result);
  return result;

  function flattenObject2(obj, path, result) {
    for (const key of Object.keys(obj)) {
      const encodedKey = encodeKey(key);
      const newPath = path ? `${path}_${encodedKey}` : encodedKey;
      const val = obj[key];
      if (typeof val === 'object') {
        flattenObject2(val, newPath, result);
      } else if (Array.isArray(val)) {
        result[newPath] = val.join(',') + ',';
      } else {
        result[newPath] = String(val);
      }
    }
  }
}

function convertConfigToEnvObj(config) {
  return flattenObject(config, 'ZWED');
}

function convertConfigToEnvSource(config) {
  const envObj = convertConfigToEnvObj(config);
  return Object.keys(envObj).map(key => `export ${key}="${envObj[key]}"`).join('\n');
}

function getHaInstanceId() {
  return process.env['ZWELS_HA_INSTANCE_ID'];
}

function getInstanceDir() {
  return process.env['INSTANCE_DIR'] || '~/.zowe';
}

function omitCommonConfigKeys(config) {
  const commonConfigKeys = [
    'certificate',
    'crossMemoryServerName',
    'enabled',
    'launcher',
    'port',
    'tls'
  ];
  return _.omit(config, commonConfigKeys);
}

function getComponentConfig(yawn, component, haInstanceId) {
  const componentLevelConfig = _.get(yawn.json, ['components', component]);
  const instanceLevelConfig = _.get(yawn.json, ['haInstances', haInstanceId, 'components', component]);
  const config = mergeUtils.deepAssign(componentLevelConfig, instanceLevelConfig ? instanceLevelConfig : {});
  return omitCommonConfigKeys(config);
}

function loadZoweDotYaml() {
  const instanceDir = getInstanceDir();
  const zoweDotYamlFile = path.join(instanceDir, 'zowe.yaml');
  const instanceDotEnvFile = path.join(instanceDir, 'instance.env');
  if (fs.existsSync(instanceDotEnvFile)) {
    // instance.env is higher priority than zowe.yaml
    return;
  }
  if (!fs.existsSync(zoweDotYamlFile)) {
    // zowe.yaml not found
    return;
  }
  const yawn = parseZoweDotYaml(zoweDotYamlFile);
  return yawn;
}

function parseZoweDotYaml(zoweDotYamlFile) {
  let yawn;
  try {
    const yamlText = fs.readFileSync(zoweDotYamlFile).toString();
    yawn = new YAWN(yamlText);
  } catch (e) {
  }
  return yawn;
}

const yawn = loadZoweDotYaml();

exports.getAppServerConfig = function () {
  if (!yawn) {
    return;
  }
  const haInstanceId = getHaInstanceId();
  const appServerConfig = getComponentConfig(yawn, 'app-server', haInstanceId);
  return appServerConfig;
};

exports.getZssConfig = function () {
  if (!yawn) {
    return;
  }
  const haInstanceId = getHaInstanceId();
  const zssConfig = getComponentConfig(yawn, 'zss', haInstanceId);
  return zssConfig;
}

if (require.main === module && process.argv.length == 3 && typeof yawn === 'object') {
  const haInstanceId = getHaInstanceId();
  const component = process.argv[2];
  const config = getComponentConfig(yawn, component, haInstanceId);
  if (config) {
    console.log(convertConfigToEnvSource(config));
  }
}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
