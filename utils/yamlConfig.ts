
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import * as mergeUtils from './mergeUtils';

let debugLog:boolean = false;

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
      if (debugLog===true) {console.log("Loaded file as=\n",yamlText);}
      
      //this gives us a little compatibility between quickjs functions and nodejs functions 
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
export function parseZoweDotYaml(zoweYamlPaths:string, haInstanceIdOrUndefined?: string, debug?:boolean) {
  debugLog=debug;
  let config:any = getJsonForYamls(zoweYamlPaths);
  if (debugLog===true){ console.log("Parsed as=\n",config); }
  if (haInstanceIdOrUndefined) {
    let instanceLevelConfig;
    if (haInstanceIdOrUndefined && config.haInstances) {
      instanceLevelConfig = config.haInstances[haInstanceIdOrUndefined];
    }
    const mergedConfig = mergeUtils.deepAssign(config, instanceLevelConfig ? instanceLevelConfig : {});
    config = mergedConfig;
    if (debugLog===true) {console.log("Merged HA instance as=\n",config)};
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

/*
  This function recurses down the zowe config object.
  At each level, if there's a string, it inspects the string to see if it is a template within (as in, ${{ }})
  If there's one or more templates in the string, each template is resolved by a sandboxed eval which is given
  The 'zowe' and 'components' object, plus 'process' and 'os'.
  If the template cant be resolved, such as when there's a template that references another template that isnt resolved yet,
  Then the template will be resolved to the string ${{ __ZOWE_UNRESOLVED_num_original }} where num is the attempt count
  And original is just the original template.
  The code will attempt to resolve each template a maximum of 5 times, such that the resolver will loop over the config 5 times
  And allowing templates that are 5 references deep. If the template never resolves, it is replaced with undefined.
*/
function resolveTemplates(property: any, topObj: any): {property: any, templates: boolean} {
  let templateFound: boolean = false;
  let result = property;
  let topObjKeys = Object.keys(topObj);
  let evalGlobalString = `var os = require('os'); `;
  topObjKeys.forEach((key)=> {
    evalGlobalString+=`var ${key} = topObj.${key}; `
  });

  if (typeof property == 'string') {
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
        if (partParts[0]===undefined) {
          count++;
          if (count >= RESOLVE_ATTEMPTS_MAX) {
            if (debugLog === true) {
              console.log("Template "+trimmed+" could not be resolved, setting as undefined.");
            }
            partParts[0] = undefined;
          } else {
            partParts[0] = "${{ __ZOWE_UNRESOLVED_"+count+trimmed+" }}";
          }
        }

        //dont mix objects and strings or you'll get useless stuff. one or the other.
        if (typeof partParts[0] == 'object') {
          result = partParts[0];
        } else if (partParts[0]!==undefined) {
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
  } else if (typeof property == 'object') {
    if (Array.isArray(property)) {
      // console.log('iterate');
      result = property;
      for (let i = 0; i < property.length; i++) {
        let item = resolveTemplates(property[i], topObj);
        if (debugLog===true && (item.property != property[i])) {
          console.log(`resolved ${JSON.stringify(property[i])} as ${JSON.stringify(item.property,null,2)}`);
        }
        property[i] = item.property;
        templateFound = templateFound || item.templates;
      }
    } else if (property) {
      if (debugLog === true) {
        console.log('decend on '+JSON.stringify(property).substring(0,40));
      }
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
