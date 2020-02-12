
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';
const spawn = require('child_process').spawn;
const util = require('./util');
const constants = require('./unp-constants');
const bootstrapLogger = util.loggers.bootstrapLogger;
const childLogger = util.loggers.childLogger;
const langLogger = util.loggers.langManager;


function ProcessManager(exitOnException, langManagers) {
  this.childProcesses = [];
  this.exitOnException = exitOnException;
  this.cleanupFunctions = [];
  process.on('SIGTERM', () => this.endServer('SIGTERM', langManagers));
  process.on('SIGINT', () => this.endServer('SIGINT', langManagers));
  process.on('SIGHUP', () => this.endServer('SIGHUP', langManagers));
  const uncaughtHandler = (err)=> {
    bootstrapLogger.warn('ZWED0036W', err.stack); //bootstrapLogger.warn('Uncaught exception found. Error:\n'+err.stack);  
    if (this.exitOnException) {
      bootstrapLogger.warn('ZWED0037W'); //bootstrapLogger.warn('Ending server process due to uncaught exception.');
      process.removeListener('uncaughtException', uncaughtHandler);      
      this.endServer('SIGQUIT', langManagers);    
    }
  };
  process.on('uncaughtException', uncaughtHandler);
  process.on('unhandledRejection', (err) => {
    console.log('ZWED0151W - unhandledRejection', err);
    bootstrapLogger.warn('ZWED0151W', err);
  });
}
ProcessManager.prototype = {
  constructor: ProcessManager,
  childProcesses: null,
  
  spawn(childProcessConfig) {
    const args = childProcessConfig.args ? childProcessConfig.args : [];
    const childProcess = spawn(childProcessConfig.path, args);
    this.childProcesses.push(childProcess);
    childProcess.stdout.on('data', function(data) {
      childLogger.info('ZWED0047I', childProcessConfig.path, data); //childLogger.info('[Path=' + childProcessConfig.path + ' stdout]: ' + data);
    });
    childProcess.stderr.on('data', function(data) {
      childLogger.warn('ZWED0038W', childProcessConfig.path, data); //childLogger.warn('[Path=' + childProcessConfig.path + ' stderr]: ' + data);
    });
    childProcess.on('close', function(code) {
      childLogger.info('ZWED0048I', childProcessConfig.path, code); //childLogger.info('[Path=' + childProcessConfig.path + '] exited, code: ' + code);
    });
  },

   endChildren(signal) {
     for (const childProcess of this.childProcesses) {
       if (childProcess.pid) { //nothing to kill if no pid
         childProcess.kill(signal);
       }
     }
   },

   addCleanupFunction(func) {
     this.cleanupFunctions.push(func);
   },

   performCleanup() {
     for (const cleanupFunction of this.cleanupFunctions) {
       try {
         cleanupFunction.call();
       } catch (err) {
        bootstrapLogger.warn('ZWED0039W', err.stack); //bootstrapLogger.warn('Exception at server cleanup function:\n'+err.stack); 
       }
     }
   },

  endServer(signal, langManagers) {
    langLogger.info(`ZWED0049I`); //langLogger.info(`Stopping managers`);
    let i = 0;
    let t = this;
    function stopManager(i) {
      if (i == langManagers.length) {
        bootstrapLogger.info('ZWED0050I', signal); //bootstrapLogger.info('Server shutting down, received signal='+signal);
        t.endChildren(signal);
        t.performCleanup();
        process.exit(0);     
      }
      else {
        langManagers[i].stopAll().then(()=> {
          stopManager(++i);
        }).catch((e)=> {
          bootstrapLogger.severe(`ZWED0002E`, langManagers[i].getSupportedTypes()); //bootstrapLogger.severe(`Could not stop language manager for types=${langManagers[i].getSupportedTypes()}`);
          stopManager(++i);
        });
      }
    }
    stopManager(0);
  }
};

module.exports = ProcessManager;

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

