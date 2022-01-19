
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

function convertConfigToEnvObj(config, prefix) {
  return flattenEnvObject(config, prefix);
}

function convertConfigToEnvSource(config, prefix) {
  const envObj = convertConfigToEnvObj(config, prefix);
  return Object.keys(envObj).map(key => `export ${key}="${envObj[key]}"`).join('\n');
}

function getCurrentHaInstanceId() {
  return process.env['ZWE_haInstance_id'];
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

function getYamlConfig(zoweConfig, haInstanceId, componentOrder) {
  let mergedConfig;
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

function getDefaultZoweDotYamlFile() {
  const zoweDotYamlFile = process.env['ZWE_CLI_PARAMETER_CONFIG'];
  if (!zoweDotYamlFile) {
    // env var not set
    return;
  }
  if (!fs.existsSync(zoweDotYamlFile)) {
    // zowe.yaml config not found
    return;
  }
  return zoweDotYamlFile;
}

function loadZoweDotYaml(zoweDotYamlFile) {
  if (!zoweDotYamlFile) {
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


function getConfig(zoweDotYamlFile, haInstanceId, componentOrder) {
  const zoweConfig = loadZoweDotYaml(zoweDotYamlFile);
  if (!zoweConfig || !haInstanceId || !Array.isArray(componentOrder)) {
    return;
  }
  return getYamlConfig(zoweConfig, haInstanceId, componentOrder);
};

exports.getConfig = getConfig;
exports.getDefaultZoweDotYamlFile = getDefaultZoweDotYamlFile;
exports.getCurrentHaInstanceId = getCurrentHaInstanceId;

// The module can be called directly like this:
// node path/to/zlux-server-framework/utils/yamlConfig.js --config <path to zowe.yaml> --haInstanceId <HA Instance Id> --prefix <Env Prefix> --components '<comp1 comp2 etc>'
//
// In this case the module converts the config into a set of `export` statements, e.g.
// export PREFIX_node_https_enableTrace=true
// ...
if (require.main === module) {
  const zoweDotYamlFile = getCmdLineOption('--config', getDefaultZoweDotYamlFile());
  const haInstanceId = getCmdLineOption('--haInstanceId', getCurrentHaInstanceId());
  const prefix = getCmdLineOption('--prefix', 'ZWED');
  const componentOrder = getCmdLineOption('--components', 'zss app-server').split(' ');
  const config = getConfig(zoweDotYamlFile, haInstanceId, componentOrder);
  if (config) {
    console.log(convertConfigToEnvSource(config, prefix));
  }
}

function getCmdLineOption(option, defaultValue) {
  let value;
  const args = process.argv;
  const argCount = process.argv.length;
  for (let i = 2; i < argCount - 1; i++) {
    if (args[i] === option) {
      value = args[i + 1];
      break;
    }
  }
  return value || defaultValue;
}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
