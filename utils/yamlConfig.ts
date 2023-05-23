
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

import * as fs from 'fs';
import * as path from 'path';
import * as _ from 'lodash';
import * as YAML from 'yaml';
import * as mergeUtils from './mergeUtils';

const RESOLVE_ATTEMPTS_MAX=5;

export function getCurrentHaInstanceId() {
  return process.env['ZWE_haInstance_id'];
}

export function getDefaultZoweDotYamlFile() {
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

// formats either /my/zowe.yaml or FILE(/my/zowe.yaml):FILE(/my/defaults.yaml)
function getJsonForYamls(configYamls: string) {
  let configs = [];
  let yamls = configYamls.split('FILE(');
  yamls.forEach((yaml:string)=> {
    if (yaml.length>0) {
      if (yaml.endsWith(')')) {
        yaml = yaml.substring(0, yaml.length-1);
      } else if (yaml.endsWith('):')) {
        yaml = yaml.substring(0, yaml.length-2);
      }

      // console.log('parsing zowe yaml file.');
      let yamlText = fs.readFileSync(yaml).toString();
      // console.log("Loaded file as=\n",yamlText);
      yamlText = yamlText.replace(/std.getenv(.*)/g, (match)=> {return 'process.env['+match.substring(11,match.length-1)+']';});
      yamlText = yamlText.replace(/os\.platform/g, 'os.platform()');
      //    yamlText = yamlText.replaceAll(/\${{\s.*\s}}/g, (match)=> {return match.substring(3, match.length-2);}); 
      configs.push(YAML.parse(yamlText));
    }
  });

  let finalConfig = {};
  for (let i = configs.length-1; i >= 0; i--) {
    let config = configs[i];
    finalConfig = mergeUtils.deepAssign(finalConfig, config);
  }
  return finalConfig;
}


//may throw yaml parse or fs error
export function parseZoweDotYaml(zoweYamlPaths:string, haInstanceIdOrUndefined?: string) {
  let config = getJsonForYamls(zoweYamlPaths);
  // console.log("Parsed as=\n",config);
  if (haInstanceIdOrUndefined) {
    let instanceLevelConfig;
    if (haInstanceIdOrUndefined) {
      instanceLevelConfig = _.get(config, ['haInstances', haInstanceIdOrUndefined]);
    }
    const mergedConfig = mergeUtils.deepAssign(config, instanceLevelConfig ? instanceLevelConfig : {});
    config = mergedConfig;
    // console.log("Merged HA instance as=\n",config);
  }

  let resolveTries = 0;
  while (resolveTries < RESOLVE_ATTEMPTS_MAX) {
    let resolveResult = resolveTemplates(config, config);
    config = resolveResult.property;
    if (resolveResult.templates) {
      resolveTries++;
    } else {
      return config;
    }
  }
  
  return config;
}

function resolveTemplates(property: any, topObj: any): {property: any, templates: boolean} {
  let templateFound: boolean = false;
  let result = property;
  let topObjKeys = Object.keys(topObj);
  let evalGlobalString = `var os = require('os'); `;
  topObjKeys.forEach((key)=> {
    evalGlobalString+=`var ${key} = topObj.${key}; `
  });

  if (typeof property == 'string') {
    /*
    let nextSearch = "${{ "
    let previousIndex = 0;
    let index = property.indexOf(nextSearch, 0);
    while (index != -1) {
      if (nextSearch == "${{ ") {
        nextSearch = " }}";
      } else {
        nextSearch = "${{ ";
      }
    }
    */
    //'a/${{ one }}/b/${{ two }}'.split("${{ ")
    //Array(3) [ "a/", "one }}/b/", "two }}" ]
    
    let parts = property.split("${{ ");
    result = '';
    for (let i = 0; i < parts.length; i++) {
      let partParts = parts[i].split(' }}');
      if (partParts.length > 1) {
        templateFound = true;
        let count = 0;
        var trimmed = partParts[0];
        if (trimmed.startsWith("__ZOWE_UNRESOLVED_")) {
          count = Number(partParts[0].charAt(18));
          trimmed = partParts[0].substring(19);
        }
//        console.log('trimmed='+trimmed);

        try {
          partParts[0] = eval(`
                              'use strict';
                              ${evalGlobalString}
                              ${trimmed};
                              `);
        } catch (e) {
          partParts[0] = undefined;
          //template likely resolved to undefined, continue.
        }
        if (!partParts[0]) {
          count++;
          if (count >= RESOLVE_ATTEMPTS_MAX) {
            console.log("Template "+trimmed+" could not be resolved, setting as undefined.");
            partParts[0] = undefined;
          } else {
            partParts[0] = "${{ __ZOWE_UNRESOLVED_"+count+trimmed+" }}";
          }
        }

        //dont mix objects and strings or you'll get useless stuff. one or the other.
        if (typeof partParts[0] == 'object') {
          result = partParts[0];
        } else if (partParts[0]) {
          result += partParts.join('');
        } else {
          result = undefined;
        }
      } else {
        result+=parts[i];
      }
    }
    if (templateFound) {
      let asNumber = Number(result);
      if (!Number.isNaN(asNumber)) {
        result = asNumber;
      } else if (result === 'false') {
        result = false;
      } else if (result === 'true') {
        result = true;
      }
    }
    /*
    if (property.startsWith("${{ ") && property.endsWith(" }}")) {
      templateFound = true;
      let count = 0;
      var trimmed = property.substring(4, property.length-3).trim();
      if (trimmed.startsWith("__ZOWE_UNRESOLVED_")) {
        count = Number(property.charAt(18));
        trimmed = property.substring(19);
      }
      try {
        result = eval(`
                      'use strict';
                      topObj.${trimmed};
                      `);
      } catch (e) {
        result = undefined;
        //template likely resolved to undefined, continue.
      }
      if (!result) {
        count++;
        if (count >= RESOLVE_ATTEMPTS_MAX) {
          console.log("Template "+trimmed+" could not be resolved, setting as undefined.");
          result = undefined;
        } else {

          result = "${{ __ZOWE_UNRESOLVED_1"+trimmed+" }}";
        }
      } 
      }
      */
  } else if (typeof property == 'object') {
    if (Array.isArray(property)) {
      // console.log('iterate');
      result = property;
      for (let i = 0; i < property.length; i++) {
        let item = resolveTemplates(property[i], topObj);
        // console.log(`resolved ${property[i]} as ${item.property}`); 
        property[i] = item.property;
        templateFound = templateFound || item.templates;
      }
    } else {
      // console.log('decend');
      result = property;
      const keys: string[] = Object.keys(property);    
      keys.forEach((key:string)=> {
        // console.log('key='+key);
        let value = property[key];
        let update = resolveTemplates(value, topObj);
        property[key] = update.property;
        templateFound = templateFound || update.templates;
      });
    }
  }
  return {property: result, templates: templateFound};
}


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
