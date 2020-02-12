

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

exports.constants = {
  ARG_TYPE_FLAG: 1,
  ARG_TYPE_VALUE: 2,
  ARG_TYPE_JSON: 3
};

function CLIArgument(longName, shortName, type) {
  if ((type != exports.constants.ARG_TYPE_FLAG
       && type != exports.constants.ARG_TYPE_VALUE
       && type != exports.constants.ARG_TYPE_JSON)) {
    console.log("ZWED0153W - WARNING: CLI Argument missing name or has unsupported type="+type);
    return null;
  }
  var longMatch = longName ? '--'+longName : null;
  var shortMatch = shortName ? '-'+shortName : null;
  var argName = longName ? longName : shortName;
  var argType = type;

  var getMatch = function(string, nextString) {
    if (longMatch && string.startsWith(longMatch)) {
      if (argType === exports.constants.ARG_TYPE_FLAG) {
        return {arg: argName, value: true};
      }
      else if (string.length > longMatch.length && argType === exports.constants.ARG_TYPE_JSON) {
        let index = string.indexOf('=');
        if (index != -1) {
          return {arg: argName, value: string.substr(index+1), jsonName: string.substr(longMatch.length, index-2)};
        } else {
          return {arg: argName, value: nextString, jsonName: string.substr(longMatch.length)};
        }                
      }
      else if (string.length > longMatch.length && (string.charAt(longMatch.length)== '=')) {
        return {arg: argName, value: string.substr(longMatch.length+1),
                isJson: !!exports.constants.ARG_TYPE_JSON};
      }
      else if (string.length == longMatch.length) {
        return {arg: argName, value: nextString,
                isJson: !!exports.constants.ARG_TYPE_JSON};
      }
    }
    else if (shortMatch && string.startsWith(shortMatch)) {
      if (argType === exports.constants.ARG_TYPE_FLAG) {
        return {arg: argName, value: true};
      }
      else if (string.length > shortMatch.length && argType === exports.constants.ARG_TYPE_JSON) {
        let index = string.indexOf('=');
        if (index != -1) {
          return {arg: argName, value: string.substr(index+1), jsonName: string.substr(shortMatch.length, index-2)};
        } else {
          return {arg: argName, value: nextString, jsonName: string.substr(shortMatch.length)};
        }                
      }
      else if (string.length > shortMatch.length && (string.charAt(shortMatch.length)== '=')) {
        return {arg: argName, value: string.substr(shortMatch.length+1)};
      }
      else if (string.length == shortMatch.length) {
        return {arg: argName, value: nextString};
      }
    }
    return null;
  };
  return {
    getMatch: getMatch
  };
};
exports.CLIArgument = CLIArgument;

/*
  This intentionally does not try to solve problems pertaining to overlap.
  If one assignment results in a number and another tries to set an array index value on that number,
  This will result in unexpected behavior as it is end-user error.
  

  Other limitations:
   - Treats strings that start with [, end with ] to be arrays
   - Arrays cannot have strings with ',' within them

  TODO: support array insertion
*/
function resolveJson(argumentsObj, matchObj) {
  const matchParts = matchObj.jsonName.split('.');
  let returnVal = argumentsObj[matchObj.arg];
  if (!returnVal) {
    returnVal = {};
  }
  let currentLevel = returnVal;
  let currentIndex = -1;
  const partLen = matchParts.length-1;
  try {
    for (let i = 0; i < partLen; i++) {
      let part = matchParts[i];
      /* TODO work on array index support if anyone cares
      let lBracket = part.indexOf('[');
      let rBracket = part.indexOf('[');
      if (lBracket != -1 && rBracket != -1 && lBracket < rBracket && rBracket == part.length-1) {
        let index = Number(part.substring(lBracket+1,rBracket));
        if (Number.isInteger(index) && index > -1) {
          let attr = part.substring(0,lBracket);
          if (Array.isArray(currentLevel[attr]) && currentLevel[attr].length >= index) {
            currentLevel = currentLevel[attr];
            currentIndex = index;
          } else if (!currentLevel[attr]) {
            currentLevel[attr] = [];
            currentLevel = currentLevel[attr][0];
          }
        }
      } else {
      */
      if (currentLevel[part] === undefined) {
        currentLevel[part]={};
      }
      currentLevel = currentLevel[part];
  //    }
    }
    currentLevel[matchParts[matchParts.length-1]] = stringToValue(matchObj.value);
  } catch (e) {
    console.log("ZWED0007E - SEVERE: Exception occurred trying to generate object from input:",e);
    process.exit(1);
  }
  return returnVal;    
}

function ArgumentParser(validArgs, argArray) {
  var validArguments = validArgs;
  var args = argArray;

  var parse = function(args) {
    var argumentValues = {};
    var arg;
    var validArg;
    for (var i = 0; i < args.length; i++) {
      var found = false;
      arg = args[i];
      for (var j = 0; j < validArguments.length; j++) {
        validArg = validArguments[j];
        if (validArg) {
          var result = validArguments[j].getMatch(arg, (i < (args.length-1)) ? args[i+1] : null);
          if (result && result.arg && result.value) {
            if (result.jsonName) {
              argumentValues[result.arg] = resolveJson(argumentValues, result);
              found = true;
              break;
            } else {
              argumentValues[result.arg] = result.value;
              if (result.value == args[i+1]) {
                i++;
              }
              found = true;
              break;
            }
          }
        }
      }
      if (!found) {
        console.log("ZWED0154W - WARNING: Unrecognized command: "+arg);
      }    
    }
    return argumentValues;
  };
  return {parse: parse};
}
exports.createParser = function(stringArray) {
  return new ArgumentParser(stringArray);
};

/*
  Prefix can be undefined if desired
  Limitations exist due to small set of allowed characters for env var names.
  Everything is case sensitive.
  Characters other than A-Z, a-z, 0-9, _ . - are not allowed in the object attribute names.
  Single leading and trailing _ are not manipulated because leading and trailing '.' would not process correctly.
  Env _ will be mapped to .
  Env __ will be mapped to _
  Env ___ will be mapped to -
  So, _ and - are discouraged key names for use within the object
*/

function EnvironmentVarsToObject(prefix, env) {
  let keys;
  let envVars = env ? env : process.env
  if (!prefix) {
    keys = Object.keys(envVars);
  } else {
    const toLower = prefix.toLowerCase();
    const toUpper = prefix.toUpperCase();
    keys = Object.keys(envVars).filter((key) => {
                                         return key.startsWith(toLower) || key.startsWith(toUpper)
                                       });
  }
  
  let obj = {};
  let prefixLen = prefix ? prefix.length : 0;
  keys.forEach(function(key) {
    let value = stringToValue(envVars[key],true);
    let decodedKey = key.substr(prefixLen).replace(/___/g, '-')
        .replace(/[^_]_[A-Za-z0-9]/g, function(match){
          return match.replace(/_/g,'.');
        })
        .replace(/__/g, '_')
    let keyParts = decodedKey.split('.')

    if (keyParts.length>1) {
      if (typeof obj[keyParts[0]] != 'object') {
        obj[keyParts[0]] = {};
      }
      let currentObj = obj[keyParts[0]];
      for (let i = 1; i < keyParts.length-1; i++) {
        let part = keyParts[i];
        if (!currentObj[part]) {
          currentObj[part] = {};
        }
        currentObj = currentObj[part];
      }
      currentObj[keyParts[keyParts.length-1]] = value;
    } else {
      obj[keyParts[0]] = value;
    }
    
  });
  return obj;
}
exports.environmentVarsToObject = EnvironmentVarsToObject;


/**
Does not handle boolean strings like False or FALSE, only false.
Does not handle number strings like One, one, or ONE, but does handle 1, -1, 1.1 and so on.
**/
function stringToValue(stringVal, csvAsArray) {
  if (stringVal == 'false') {
    return false;
  }  else if (stringVal == 'true') {
    return true;
  } else if (stringVal == 'null') {
    return null;
  } else if (stringVal == 'undefined') {
    return undefined;
  } else if (stringVal.indexOf(',') != -1
             && stringVal.indexOf('[') == 0
             && stringVal.indexOf(']') == stringVal.length-1) {
    return stringVal.substring(1,stringVal.length-1)
      .split(',')
      .filter(function(value){return value.length > 0;})
      .map(entry => stringToValue(entry));
  } else if (stringVal.indexOf(',') != -1
             && csvAsArray == true) {
    return stringVal.split(',')
      .filter(function(value){return value.length > 0;})
      .map(entry => stringToValue(entry));
  } else {
    let num = Number(stringVal);
    if (!isNaN(num)) {
      return num;
    } else {
      return stringVal;
    }
  }
}
exports.stringToValue = stringToValue;


function testEnv() {
  let input = {ABC:1,
               ABC_123: 2,
               ABC__123: 3,
               ABC___123: 4,
               _ABC: 5,
               _ABC_123: 6,
               _ABC__123: 7,
               _ABC___123: 8,
               __ABC: 9,
               __ABC_123: 10,
               __ABC__123: 11,
               __ABC___123: 12,
               ___ABC: 13,
               ___ABC_123: 14,
               ___ABC__123: 15,
               ___ABC___123: 16,
               ABC_: 17,
               ABC_123_: 18,
               ABC__123_: 19,
               ABC___123_: 20,
               ABC__: 21,
               ABC_123__: 22,
               ABC__123__: 23,
               ABC___123__: 24,
               ABC___: 25,
               ABC_123___: 26,
               ABC__123___: 27,
               ABC___123___: 28,
               _ABC_: 29,
               _ABC_123_: 30,
               _ABC__123_: 31,
               _ABC___123_: 32,
               __ABC_: 33,
               __ABC_123_: 34,
               __ABC__123_: 35,
               __ABC___123_: 36,
               ___ABC_: 37,
               ___ABC_123_: 38,
               ___ABC__123_: 39,
               ___ABC___123_: 40,
               ___ABC__: 41,
               ___ABC_123__: 42,
               ___ABC__123__: 43,
               ___ABC___123__: 44,
               ___ABC___: 45,
               ___ABC_123___: 46,
               ___ABC__123___: 47,
               ___ABC___123___: 48,
               ____ABC____123____: 49,
               _____ABC_____123_____: 50,
               ______ABC______123______: 51,

               aBC:61,
               aBC_123: 62,
               aBC__123: 63,
               aBC___123: 64,
               _aBC: 65,
               _aBC_123: 66,
               _aBC__123: 67,
               _aBC___123: 68,
               __aBC: 69,
               __aBC_123: 70,
               __aBC__123: 71,
               __aBC___123: 72,
               ___aBC: 73,
               ___aBC_123: 74,
               ___aBC__123: 75,
               ___aBC___123: 76,
               aBC_: 87,
               aBC_123_: 88,
               aBC__123_: 89,
               aBC___123_: 90,
               aBC__: 91,
               aBC_123__: 92,
               aBC__123__: 93,
               aBC___123__: 94,
               aBC___: 95,
               aBC_123___: 96,
               aBC__123___: 97,
               aBC___123___: 98,
               _aBC_: 99,
               _aBC_123_: 100,
               _aBC__123_: 101,
               _aBC___123_: 102,
               __aBC_: 103,
               __aBC_123_: 104,
               __aBC__123_: 105,
               __aBC___123_: 106,
               ___aBC_: 107,
               ___aBC_123_: 108,
               ___aBC__123_: 109,
               ___aBC___123_: 110,
               ___aBC__: 111,
               ___aBC_123__: 112,
               ___aBC__123__: 113,
               ___aBC___123__: 114,
               ___aBC___: 115,
               ___aBC_123___: 116,
               ___aBC__123___: 117,
               ___aBC___123___: 118,
               ____aBC____123____: 119,
               _____aBC_____123_____: 120,
               ______aBC______123______: 121,
               _______aBC_______123_______: 122
              };
  console.log('ZWED0139I - Input = '+JSON.stringify(input, null, 2));
  let output = EnvironmentVarsToObject(undefined, input);
  console.log('ZWED0140I - Output = '+JSON.stringify(output, null, 2));
}
exports.envUnitTest = testEnv;
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

