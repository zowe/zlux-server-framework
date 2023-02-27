"use strict";
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var _ = require("lodash");
var YAML = require("yaml");
var mergeUtils = require("./mergeUtils");
var RESOLVE_ATTEMPTS_MAX = 5;
function getCurrentHaInstanceId() {
    return process.env['ZWE_haInstance_id'];
}
exports.getCurrentHaInstanceId = getCurrentHaInstanceId;
function getDefaultZoweDotYamlFile() {
    var zoweDotYamlFile = process.env['ZWE_CLI_PARAMETER_CONFIG'];
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
exports.getDefaultZoweDotYamlFile = getDefaultZoweDotYamlFile;
//may throw yaml parse or fs error
function parseZoweDotYaml(zoweDotYamlFile, haInstanceIdOrUndefined) {
    var config;
    // console.log('parsing zowe yaml file.');
    var yamlText = fs.readFileSync(zoweDotYamlFile).toString();
    // console.log("Loaded file as=\n",yamlText);
    yamlText = yamlText.replace(/std.getenv(.*)/g, function (match) { return 'process.env[' + match.substring(11, match.length - 1) + ']'; });
    yamlText = yamlText.replace(/os\.platform/g, 'os.platform()');
    //    yamlText = yamlText.replaceAll(/\${{\s.*\s}}/g, (match)=> {return match.substring(3, match.length-2);}); 
    config = YAML.parse(yamlText);
    // console.log("Parsed as=\n",config);
    if (haInstanceIdOrUndefined) {
        var instanceLevelConfig = void 0;
        if (haInstanceIdOrUndefined) {
            instanceLevelConfig = _.get(config, ['haInstances', haInstanceIdOrUndefined]);
        }
        var mergedConfig = mergeUtils.deepAssign(config, instanceLevelConfig ? instanceLevelConfig : {});
        config = mergedConfig;
        // console.log("Merged HA instance as=\n",config);
    }
    var resolveTries = 0;
    while (resolveTries < RESOLVE_ATTEMPTS_MAX) {
        var resolveResult = resolveTemplates(config, config);
        config = resolveResult.property;
        if (resolveResult.templates) {
            resolveTries++;
        }
        else {
            return config;
        }
    }
    return config;
}
exports.parseZoweDotYaml = parseZoweDotYaml;
function resolveTemplates(property, topObj) {
    var templateFound = false;
    var result = property;
    var topObjKeys = Object.keys(topObj);
    var evalGlobalString = '';
    topObjKeys.forEach(function (key) {
        evalGlobalString += "var " + key + " = topObj." + key + "; ";
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
        var parts = property.split("${{ ");
        result = '';
        for (var i = 0; i < parts.length; i++) {
            var partParts = parts[i].split(' }}');
            if (partParts.length > 1) {
                templateFound = true;
                var count = 0;
                var trimmed = partParts[0];
                if (trimmed.startsWith("__ZOWE_UNRESOLVED_")) {
                    count = Number(partParts[0].charAt(18));
                    trimmed = partParts[0].substring(19);
                }
                //        console.log('trimmed='+trimmed);
                try {
                    partParts[0] = eval("\n                              'use strict';\n                              " + evalGlobalString + "\n                              " + trimmed + ";\n                              ");
                }
                catch (e) {
                    partParts[0] = undefined;
                    //template likely resolved to undefined, continue.
                }
                if (!partParts[0]) {
                    count++;
                    if (count >= RESOLVE_ATTEMPTS_MAX) {
                        console.log("Template " + trimmed + " could not be resolved, setting as undefined.");
                        partParts[0] = undefined;
                    }
                    else {
                        partParts[0] = "${{ __ZOWE_UNRESOLVED_" + count + trimmed + " }}";
                    }
                }
                //dont mix objects and strings or you'll get useless stuff. one or the other.
                if (typeof partParts[0] == 'object') {
                    result = partParts[0];
                }
                else if (partParts[0]) {
                    result += partParts.join('');
                }
                else {
                    result = undefined;
                }
            }
            else {
                result += parts[i];
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
    }
    else if (typeof property == 'object') {
        if (Array.isArray(property)) {
            // console.log('iterate');
            result = property;
            for (var i = 0; i < property.length; i++) {
                var item = resolveTemplates(property[i], topObj);
                // console.log(`resolved ${property[i]} as ${item.property}`); 
                property[i] = item.property;
                templateFound = templateFound || item.templates;
            }
        }
        else {
            // console.log('decend');
            result = property;
            var keys = Object.keys(property);
            keys.forEach(function (key) {
                // console.log('key='+key);
                var value = property[key];
                var update = resolveTemplates(value, topObj);
                property[key] = update.property;
                templateFound = templateFound || update.templates;
            });
        }
    }
    return { property: result, templates: templateFound };
}
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
//# sourceMappingURL=yamlConfig.js.map