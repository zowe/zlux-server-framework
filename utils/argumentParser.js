

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
    console.log("WARNING: CLI Argument missing name or has unsupported type="+type);
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
    if (matchObj.value.startsWith('[') && matchObj.value.endsWith(']')) {
      if (matchObj.value.length == 2) {
        currentLevel[matchParts.length-1] = [];
      } else {
        const configArray = matchObj.value.substr(1,matchObj.value.length-1).split[',']
              .map(entry => stringToValue(entry));
        currentLevel[matchParts.length-1] = configArray;
      }
    } else {
      currentLevel[matchParts[matchParts.length-1]] = stringToValue(matchObj.value);
    }
  } catch (e) {
    console.log("SEVERE: Exception occurred trying to generate object from input:",e);
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
        console.log("WARNING: Unrecognized command: "+arg);
      }    
    }
    return argumentValues;
  };
  return {parse: parse};
}
exports.createParser = function(stringArray) {
  return new ArgumentParser(stringArray);
};


/**
Does not handle boolean strings like False or FALSE, only false.
Does not handle number strings like One, one, or ONE, but does handle 1, -1, 1.1 and so on.
**/
function stringToValue(stringVal) {
  if (stringVal == 'false') {
    return false;
  }  else if (stringVal == 'true') {
    return true;
  } else if (stringVal == 'null') {
    return null;
  } else if (stringVal == 'undefined') {
    return undefined;
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

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

