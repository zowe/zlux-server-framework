const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const YAWN = require('yawn-yaml/cjs');
const mergeUtils = require('./mergeUtils');

function normalize(key) {
  return key.replace(/[^a-zA-Z0-9]/g, char => '_x' + char.charCodeAt(0).toString(16));
}

function flattenObject(obj, prefix) {
  const result = {};
  const path = prefix;
  flattenObject2(obj, path, result);
  return result;

  function flattenObject2(obj, path, result) {
    for (const key of Object.keys(obj)) {
      const normalizedKey = normalize(key);
      const newPath = path ? `${path}_${normalizedKey}` : normalizedKey;
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

function convert (obj) {
  return flattenObject(obj, 'ZWED');
}

convertToSource = function convertToSource (obj) {
  const env = convert(obj);
  return Object.keys(env).map(key => `export ${key}="${env[key]}"`).join('\n');
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
  return mergeUtils.deepAssign(componentLevelConfig, instanceLevelConfig ? instanceLevelConfig : {});
}

function getZssConfig(yawn, haInstanceId) {
  const config = getComponentConfig(yawn, 'zss', haInstanceId);
  return omitCommonConfigKeys(config);
}

function getAppServerConfig(yawn, haInstanceId) {
  const config = getComponentConfig(yawn, 'app-server', haInstanceId);
  return omitCommonConfigKeys(config);
}

function loadConfigs() {
  const haInstanceId = getHaInstanceId();
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
  if (!yawn) {
    return;
  }
  zssConfig = getZssConfig(yawn, haInstanceId);
  appServerConfig = getAppServerConfig(yawn, haInstanceId);
  if (zssConfig) {
    zssEnvSource = convertToSource(zssConfig);
  }
  if (appServerConfig) {
    appServerEnvSource = convertToSource(appServerConfig);
  }
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

let zssConfig;
let appServerConfig;
let zssEnvSource = '';
let appServerEnvSource = '';

exports.getAppServerConfig = function () {
  return appServerConfig;
};

exports.getZssConfig = function () {
  return zssConfig;
}

loadConfigs();

if (require.main === module && process.argv.length == 3) {
  const component = process.argv[2];
  if (component === 'zss') {
    console.log(zssEnvSource);
  } else if (component === 'app-server') {
    console.log(appServerEnvSource);
  }
}
