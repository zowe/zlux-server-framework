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

/*
 This program and the accompanying materials are
 made available under the terms of the Eclipse Public License v2.0 which accompanies
 this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
 
 SPDX-License-Identifier: EPL-2.0
 
 Copyright Contributors to the Zowe Project.
*/
