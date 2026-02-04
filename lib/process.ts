
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';

import { spawn } from 'node:child_process';
import * as util from './util';
import * as constants from './unp-constants';
const bootstrapLogger = util.loggers.bootstrapLogger;
const childLogger = util.loggers.childLogger;
const langLogger = util.loggers.langManager;


class ProcessManager {
  childProcesses = [];
  exitOnException: boolean;
  cleanupFunctions: any[] = [];

  constructor(exitOnException:boolean, langManagers) {
    this.exitOnException = exitOnException;
  
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
  }

   endChildren(signal: number|string): void {
     for (const childProcess of this.childProcesses) {
       if (childProcess.pid) { //nothing to kill if no pid
         childProcess.kill(signal);
       }
     }
   }

   addCleanupFunction(func) {
     this.cleanupFunctions.push(func);
   }

   performCleanup() {
     for (const cleanupFunction of this.cleanupFunctions) {
       try {
         cleanupFunction.call();
       } catch (err) {
        bootstrapLogger.warn('ZWED0039W', err.stack); //bootstrapLogger.warn('Exception at server cleanup function:\n'+err.stack); 
       }
     }
   }

  endServer(signal: number|string, langManagers) {
    langLogger.info(`ZWED0049I`); //langLogger.info(`Stopping managers`);
    let i = 0;
    let t = this;
    function stopManager(i: number) {
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

export = ProcessManager;

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

