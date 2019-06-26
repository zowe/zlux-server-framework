/*
 This program and the accompanying materials are
 made available under the terms of the Eclipse Public License v2.0 which accompanies
 this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
 
 SPDX-License-Identifier: EPL-2.0
 
 Copyright Contributors to the Zowe Project.
*/

const path = require('path');
const Promise = require('bluebird');
const fs = require('graceful-fs');
//assuming that this is file isnt being called from another that is already using the logger... else expect strange logs
const logging = require('../../zlux-shared/src/logging/logger.js');
const coreLogger = new logging.Logger();
//simple program, no need for logger names to be displayed
coreLogger.addDestination(coreLogger.makeDefaultDestination(true,false,false));

let logger;

exports.coreLogger = coreLogger;
exports.setComponentLogger = function(componentLogger) {
  logger = componentLogger;
}

function mkdirp(dir, options) {
  return new Promise((resolve, reject) => {
    if (dir == '.') {
      resolve();
    } else {
      fs.stat(dir, (err, stats)=> {
        if (!err) {
          //exists
          resolve();
        } else {
          let parentDir = path.dirname(dir);
          mkdirp(parentDir).then(()=> {
            fs.mkdir(dir,options,(err)=> {
              if (err) {
                reject();
              } else {
                resolve();
              }
            });
          }).catch((err)=> {
            reject();
          });
        }
      });
    }
  });
}
exports.mkdirp = mkdirp;

function validatePluginInDirectory(inputDir) {
  try {
    let inputStats = fs.statSync(inputDir); //no need to make code messy with async here
    if (!inputStats.isDirectory()) {
      endWithMessage('Input must be a directory');
    }
  } catch (e) {
    endWithMessage(`Couldnt open input directory, ${inputDir}, e=${e}`);
  }
  let pluginDefinition;
  try {
    let pluginDefPath = path.join(inputDir,'pluginDefinition.json');
    let pluginStat = fs.statSync(pluginDefPath); //no need to make code messy with async here
    if (pluginStat.isDirectory()) {
      endWithMessage(`pluginDefinition.json cannot be a directory`);
    }
    pluginDefinition = JSON.parse(fs.readFileSync(pluginDefPath));
    //TODO much more validation needed.
  } catch (e) {
    endWithMessage(`Couldn't read pluginDefinition.json within ${inputDir}, e=${e}`);
  }
  return pluginDefinition;
};
exports.validatePluginInDirectory = validatePluginInDirectory;

function endWithMessage(message) {
  console.error(message);
  process.exit(1);
}
exports.endWithMessage = endWithMessage;

/*
 This program and the accompanying materials are
 made available under the terms of the Eclipse Public License v2.0 which accompanies
 this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
 
 SPDX-License-Identifier: EPL-2.0
 
 Copyright Contributors to the Zowe Project.
*/
