
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
const YAML = require('yaml');
const mergeUtils = require('./mergeUtils');

function encodeKey(key) {
  return key.replace(/[^a-zA-Z0-9]/g, char => '_x' + char.charCodeAt(0).toString(16));
}

function flattenEnvObject(obj, prefix) {
  const result = {};
  const path = prefix;
  flattenEnvObjectInternal(obj, path, result);
  return result;

  function flattenEnvObjectInternal(obj, path, result) {
    for (const key of Object.keys(obj)) {
      const encodedKey = encodeKey(key);
      const newPath = path ? `${path}_${encodedKey}` : encodedKey;
      const val = obj[key];
      if (typeof val === 'object') {
        flattenEnvObjectInternal(val, newPath, result);
      } else if (Array.isArray(val)) {
        result[newPath] = val.join(',') + ',';
      } else {
        result[newPath] = String(val);
      }
    }
  }
}

function convertConfigToEnvObj(config) {
  return flattenEnvObject(config, 'ZWED');
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

function getComponentConfig(zoweConfig, component, haInstanceId) {
  const componentLevelConfig = _.get(zoweConfig, ['components', component]);
  const instanceLevelConfig = _.get(zoweConfig, ['haInstances', haInstanceId, 'components', component]);
  const config = mergeUtils.deepAssign(componentLevelConfig, instanceLevelConfig ? instanceLevelConfig : {});
  return omitCommonConfigKeys(config);
}

function getYamlConfig(zoweConfig, haInstanceId) {
  let mergedConfig;
  const componentOrder = ['zss', 'app-server']; // from lower to higher priority
  for (const comp of componentOrder) {
    const compConfig = getComponentConfig(zoweConfig, comp, haInstanceId);
    if (!compConfig) {
      continue;
    }
    if (typeof mergedConfig === 'object') {
      mergedConfig = mergeUtils.deepAssign(mergedConfig, compConfig);
    } else {
      mergedConfig = compConfig;
    }
  }
  return mergedConfig;
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
    // zowe.zoweConfig not found
    return;
  }
  const zoweConfig = parseZoweDotYaml(zoweDotYamlFile);
  return zoweConfig;
}

function parseZoweDotYaml(zoweDotYamlFile) {
  let zoweConfig;
  try {
    const yamlText = fs.readFileSync(zoweDotYamlFile).toString();
    zoweConfig = YAML.parse(yamlText);
  } catch (e) {
  }
  return zoweConfig;
}


function getConfig() {
  const zoweConfig = loadZoweDotYaml();
  if (!zoweConfig) {
    return;
  }
  const haInstanceId = getHaInstanceId();
  return getYamlConfig(zoweConfig, haInstanceId);
};

exports.getConfig = getConfig;

if (require.main === module) {
  const config = getConfig();
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
