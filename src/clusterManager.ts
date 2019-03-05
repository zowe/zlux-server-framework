
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
/*
Starts additional node processes if CPU usage is above 80% and kill extra processes if usage below 20%.
Assumes all node processes loaded at same level. Load balanced by cluster. 
*/
'use strict';

const MessageTypes = {
  reportCpuUsage : "reportCpuUsage",
  reportInitialized : "reportInitialized",
  callClusterMethod : "callClusterMethod",
  notify: "notify",
};

const Notifications = {
  initOnce : "initOnce",
  addDynamicPlugin : "addDynamicPlugin",
};

const events = require('events');
const cluster = require('cluster');
const os = require("os");
const cpuCount = os.cpus().length;

const highCPU = process.env.highCPU || 0.8;
const lowCPU = process.env.lowCPU || 0.2;

const minWorkers = process.env.minWorkers || 1;
const maxWorkers = process.env.maxWorkers || cpuCount;
const workerChangeDecisionDelay: any = process.env.workerChangeDecisionDelay || 4;

export class ClusterManagerTest {
  public isMaster: any;
  public messageIndex: any;
  public workersNum: any;
  public workers: any;
  public ts: any;
  public cpuUsage: any;
  public stoppingProcess: any;
  public workerResourceRequests: any;
  public nodeStates: any;
  public secret: any;
  public appConfig: any;
  public configJSON: any;
  public startUpConfig: any;
  
  constructor() {
    this.isMaster = cluster.isMaster;
    this.messageIndex = 0;
    this.workersNum = minWorkers;
    this.workers = [];
    events.EventEmitter.call(this);

    //Don't think this is right
    if (this.isMaster) {
      this.stoppingProcess = false;
      process.once('SIGINT', function() {
        this.stoppingProcess = true;
      });
    }
  }

  __proto__ = events.EventEmitter.prototype;

  onError(reason: any) {
    console.log("Error: " + reason);
  }

  getCpuUsagePercent() {
    var usagePercent;
    if (this.ts !== undefined && this.cpuUsage !== undefined) {
      var usedTicks = process.cpuUsage(this.cpuUsage);
      var totalTicks = process.hrtime(this.ts);
      var totalTicksMCS = (totalTicks[0]*1000000 + totalTicks[1]/1000);//microseconds
      usagePercent = (usedTicks.user + usedTicks.system)/totalTicksMCS;
    }
    this.ts = process.hrtime();
    this.cpuUsage = process.cpuUsage();
    return usagePercent;
  }
  
}

export class ClusterManagerMaster extends ClusterManagerTest {
  
  initSecret(errorHandler: any, completeHandler: any) {
    var crypto = require('crypto');
    crypto.randomBytes(16, function(crypto_err: any, buffer: any) {
      if (crypto_err) {
        return errorHandler(crypto_err);
      }
      this.secret = buffer.toString('hex');
      //console.log('secret: ' + this.secret);
      completeHandler();
    }.bind(this));
  }
  
  initializing(completeHandler: any) {
    var inits: any = [];
    inits.push(this.initSecret.bind(this));
  
    var stopOnError = function(err: any) {
      console.error(err);
      process.exit(-1);
    }
    var nextInit = function() {
      var initializer = inits.pop();
      if (initializer) {
        initializer(stopOnError, nextInit);
      } else {
        completeHandler();
      }
    }.bind(this);
    nextInit();
  }
  
  startWorker(wi: any) {
    console.log("Fork worker " + wi);
    var thatClusterManager = this;
    this.workers[wi] = cluster.fork({index : wi, expressSessionSecret: this.secret});
    this.workers[wi].on('exit', function(code: any, signal: any) {
    if (this.stoppingProcess) {
        return;
      }
      if (wi >= thatClusterManager.workersNum) {
        //console.log('do not restart worker ' + wi);//closed legally
        return;
      }
      if (thatClusterManager.workers[wi].__workerInitialized !== true) {
        console.log("Initializing was not complete for worker " + wi);
        return;
      }
      console.log('restart worker ' + wi);
      thatClusterManager.startWorker(wi);
    });
    this.workers[wi].on('message', function(message: any) {
      thatClusterManager.handleMessageFromWorker(message);
    });
    this.workers[wi].process.stdout.on('data', function(chunk: any) {
      var lines = String(chunk).split('\n');
      lines.forEach(function(line) {
        if (line) {
          console.log('[' + thatClusterManager.workers[wi].process.pid + '] ' + line);
        }
      });
    });
    this.workers[wi].process.stderr.on('data', function(chunk: any) {
      var lines = String(chunk).split('\n');
      lines.forEach(function(line) {
        if (line) {
          console.error('[' + thatClusterManager.workers[wi].process.pid + '] ' + line);
        }
      });
    });
  }
  
  startWorkers() {
    console.log("Fork " + this.workersNum + " workers.");
    cluster.setupMaster({ silent: true });//workers[wi].process.stdout is null without this line
    for (let i = 0; i < this.workersNum; i++) {
      var wi = i%this.workersNum;
      this.startWorker(wi);
    }
    this.workerResourceRequests = this.getWorkerResourceRequestsQueue(function(workerRR: any) {
      var summ = 0;
      workerRR.forEach(function(number: any) {
        summ += number;
      });
      //console.log('workerResourceRequests workerRR=' + JSON.stringify(workerRR) + ' length=' + workerRR.length + ' summ=' + summ);
      if (summ >= workerRR.length && this.workersNum < maxWorkers) {//all workers requested for help
        this.moreWorker();
      } else if (summ <= -workerRR.length && this.workersNum > minWorkers) {//all workers underloaded
        this.lessWorker();
      }
    }.bind(this));
  }
  
  getWorkerResourceRequestsQueue(shiftHandler: any) {
    var array = new Array();
    array.push = function () {
        var requestsThreshold = this.workersNum * workerChangeDecisionDelay;
        var result = Array.prototype.push.apply(array,arguments);
        if (array.length > requestsThreshold) {
          while(array.length > requestsThreshold) {
            array.shift();
          }
          if (shiftHandler) {
            shiftHandler(array);
          }
        }
        return result;
    }.bind(this);
    return array;
  }
  
  moreWorker() {
    let wi = this.workersNum++;
    this.startWorker(wi);
  }
  
  lessWorker() {
    if (this.workersNum > 1) {
      let wi = --this.workersNum;
      console.log("Close worker " + wi);
      this.workers[wi].kill();
    } else {
      //console.log("Last worker should be alive");
    }
  }
    
  callFunction(f: any, that: any, argsArray: any, resultHandler: any, workerIndex: any) {
    argsArray[argsArray.length] = resultHandler;
    argsArray[argsArray.length] = workerIndex;
    f.apply(that, argsArray);
  }
  
  handleMessageFromWorker(message: any) {
    if (message.type) {
      if (message.type == MessageTypes.reportCpuUsage) {
        var usagePercent = message.percent;
        //console.log("Worker " + message.index + " CPU usage: " + usagePercent + " highCPU: " + highCPU + " lowCPU: " + lowCPU);
        if (usagePercent > highCPU) {
          this.workerResourceRequests.push(1);
        } else if (usagePercent < lowCPU) {
          this.workerResourceRequests.push(-1);
        } else {
          this.workerResourceRequests.push(0);
        }
      } else if (message.type == MessageTypes.reportInitialized) {
        var wi = message.index;
        this.workers[wi].__workerInitialized = true;
        if (wi == 0) {
          this.notifyWorker(this.workers[wi], Notifications.initOnce, null, wi);//subscriber can start separate processes with port listeners
        }
        this.restoreNodeState(this.workers[wi]);
      } else if (message.type == MessageTypes.callClusterMethod) {
        var wi = message.index;
        var thatClusterManager = this;
        this.callClusterMethodLocal(wi, message.moduleName, message.importedName, message.methodName, message.args, function() {
          try {
            if (arguments[0] instanceof Error) {
              thatClusterManager.workers[wi].send({type: MessageTypes.callClusterMethod, index : -1, messageIndex: message.messageIndex, methodName : message.methodName, error : arguments[0].message});
            } else {
              thatClusterManager.workers[wi].send({type: MessageTypes.callClusterMethod, index : -1, messageIndex: message.messageIndex, methodName : message.methodName, result : arguments});
            }
          } catch (err) {
            console.error(err);
          }
        });
      } else if (message.type == MessageTypes.notify) {
        this.notifyWorkers(message.notifyName, message.args, message.index);
      }
    }
  }
    
  callClusterMethodLocal(wi: any, moduleName: any, exportedName: any, methodName: any, args: any, resultHandler: any) {
    var exported;
    var mod;
    if (moduleName) {
      try {
        mod = require(moduleName);
      } catch (e) {
        resultHandler(e);
      }
      if (!mod) {
        resultHandler(new Error("module not found " + moduleName));
        return;
      }
    } else {
      mod = module.exports;
    }
    exported = mod[exportedName];
    if (exported && methodName) {
      if (exported[methodName]) {
        try {
          var f = exported[methodName];
          this.callFunction(f, exported, args, resultHandler, wi);
        } catch (e) {
          resultHandler(e);
        }
      } else {
        resultHandler(new Error("method not implemented " + methodName));
      }
    } else if (exported) {
      try {
        var f = exported;
        this.callFunction(f, exported, args, resultHandler, wi);
      } catch (e) {
        resultHandler(e);
      }
    } else {
      resultHandler(new Error("object not exported " + exportedName));
    }
  }
    
  notifyWorker(worker: any, notifyName: any, args: any, indexInCluster: any) {
    try {
      worker.send({type: MessageTypes.notify, index : indexInCluster, notifyName : notifyName, args : args});
    } catch (err) {
      console.error(err);
    }
  }
    
  notifyWorkers(notifyName: any, args: any, indexInCluster: any) {
    this.workers.forEach(function(worker: any, index: any) {
      if (index != indexInCluster) {
        this.notifyWorker(worker, notifyName, args, indexInCluster);
      }
    });
  }
  
  notifyWorkersForAddingPlugin(pluginDef: any, resultHandler: any, indexInCluster: any) {
    this.rememberNodeState(Notifications.addDynamicPlugin, pluginDef);
    this.notifyWorkers(Notifications.addDynamicPlugin, pluginDef, indexInCluster);
    resultHandler(true);
  }
  
  rememberNodeState(type: any, object: any) {
    if (!this.nodeStates) {
      this.nodeStates = new Map();
    }
    var nodeState = this.nodeStates.get(type);
    if (!nodeState) {
      nodeState = this.createNodeStateFor(type);
    }
    this.nodeStates.set(type, nodeState);
    nodeState.remember(object);
  }
  
  restoreNodeState(worker: any) {
    if (this.nodeStates) {
      Array.from(this.nodeStates.values()).forEach(function(nodeState: any) {
        nodeState.restore(worker);
      });
    }
  }
  
  createNodeStateFor(type: any) {
    if (Notifications.addDynamicPlugin === type) {
      return {
        pluginDefsMap: new Map(),
        remember: function(pluginDef: any){
          if ("identifier" in pluginDef) {
            this.pluginDefsMap.set(pluginDef.identifier, pluginDef);
          }
        },
        restore: function(worker: any) {
          Array.from(this.pluginDefsMap.values()).forEach(function(pluginDef: any) {
            this.notifyWorker(worker, Notifications.addDynamicPlugin, pluginDef, -1);
          });
        }
      };
    } else {
      return {
        remember: function(){},
        restore: function(){}
      };
    }
  }
  
  start(appConfig: any, configJSON: any, startUpConfig: any) {
    this.appConfig = appConfig;
    this.configJSON = configJSON;
    this.startUpConfig = startUpConfig;
    console.log(`Master ${process.pid} is running.`);
    this.initializing(function() {
      this.startWorkers();
    }.bind(this));
  }

  callClusterMethod(moduleName: any, importedName: any, methodName: any, argsArray: any, callback: any, onerror = this.onError, timeout = 1000) {
      return this.callClusterMethodLocal(-1, moduleName, importedName, methodName, argsArray, callback);
  }

  notifyOthers(notifyName: any, args: any, callback: any, onerror = this.onError) {
    return this.notifyWorkers(notifyName, args, -1);
  }
}

export class ClusterManagerNotMaster extends ClusterManagerTest {
  getIndexInCluster() {
    return process.env.index;
  }
    
  reportCpuUsage(percent: any) {
    process.send({type : MessageTypes.reportCpuUsage, index : this.getIndexInCluster(), percent : percent});
  }

  reportInitialized() {
    process.send({type : MessageTypes.reportInitialized, index : this.getIndexInCluster()});
  }
  
  handleMessageFromMaster(message: any) {
    if (message.type) {
      if (message.type == MessageTypes.notify) {
        //console.log("Notification from " + message.index + ": " + message.notifyName);
        (this as any).emit(message.notifyName, message.index, message.args);
      }
    }
  }
  
  createProxyServerWorker() {
    const ProxyServer = require('./index');
    const proxyServer = new ProxyServer(this.appConfig, this.configJSON, this.startUpConfig);
    proxyServer.start();
    this.reportInitialized();
    var thatClusterManager = this;
    setInterval(function() {
      var usagePercent = thatClusterManager.getCpuUsagePercent();
      if (usagePercent !== undefined) {
        thatClusterManager.reportCpuUsage(usagePercent);
      }
    }, 10000).unref();
    process.on('message', function(message) {
      thatClusterManager.handleMessageFromMaster(message);
    });
  }
  
  getMessageIndex() {
    return this.messageIndex++;
  }
  
  callClusterMethodRemote(moduleName: any, importedName: any, methodName: any, args: any, callback: any, onerror = this.onError, timeout = 1000) {
    var promise = new Promise((resolve, reject) => {
      var thisMessageIndex = this.getMessageIndex();
      var messageListener = function(message: any) {
        if (message.type) {
          if (message.type == MessageTypes.callClusterMethod && message.messageIndex == thisMessageIndex) {
            process.removeListener('message', messageListener);
            clearTimeout(timeoutTimer);
            if (message.error) {
              reject(message.error);
            } else {
              resolve(message.result);
              //resolve.apply(this, message.result);
            }
          }
        }
      }
      process.on('message', messageListener);
      process.send({type : MessageTypes.callClusterMethod, index : this.getIndexInCluster(), messageIndex : thisMessageIndex, moduleName : moduleName, importedName : importedName, methodName : methodName, args : args});
      var timeoutTimer = setTimeout(function() {
        process.removeListener('message', messageListener);
        reject("Timeout call " + moduleName + "/" + importedName + "/" + methodName);
      }, timeout);
      timeoutTimer.unref();
    });
    return promise.then(callback, onerror);
  }
  
  notifyCluster(notifyName: any, args: any, indexInCluster: any, callback: any, onerror = this.onError) {
    var promise = new Promise((resolve, reject) => {
      process.send({type : MessageTypes.notify, index : indexInCluster, notifyName : notifyName, args : args}, function() {
        resolve(true);
      });
    });
    return promise.then(callback, onerror);
  }

  initOnce(handler: any) {
    (this as any).once(Notifications.initOnce, handler);
  }

  onAddDynamicPlugin(handler: any) {
    (this as any).on(Notifications.addDynamicPlugin, handler);
  }

  addDynamicPlugin(pluginDef: any) {
    this.callClusterMethodRemote(null, "clusterManager", "notifyWorkersForAddingPlugin", [pluginDef],
      function() {
      },
      function(e: any) {
        console.log("Error adding plugin: " + e);
      }
    );
  }

  start(appConfig: any, configJSON: any, startUpConfig: any) {
    this.appConfig = appConfig;
    this.configJSON = configJSON;
    this.startUpConfig = startUpConfig;
    console.log(`Worker ${this.getIndexInCluster()} pid ${process.pid}`);
    this.createProxyServerWorker();
  }

  callClusterMethod(moduleName: any, importedName: any, methodName: any, argsArray: any, callback: any, onerror = this.onError, timeout = 1000) {
    return this.callClusterMethodRemote(moduleName, importedName, methodName, argsArray, callback, onerror, timeout);
  }

  notifyOthers(notifyName: any, args: any, callback: any, onerror = this.onError) {
    return this.notifyCluster(notifyName, args, this.getIndexInCluster(), callback, onerror);
  }
}



// var ClusterManager = function() {
//   this.isMaster = cluster.isMaster;
//   this.messageIndex = 0;
//   this.workersNum = minWorkers;
//   this.workers = [];
//   events.EventEmitter.call(this);
// }

// ClusterManager.prototype.__proto__ = events.EventEmitter.prototype;

// ClusterManager.prototype.onError = function (reason: any) {
//   console.log("Error: " + reason);
// }

// ClusterManager.prototype.getCpuUsagePercent = function() {
//   var usagePercent;
//   if (this.ts !== undefined && this.cpuUsage !== undefined) {
//     var usedTicks = process.cpuUsage(this.cpuUsage);
//     var totalTicks = process.hrtime(this.ts);
//     var totalTicksMCS = (totalTicks[0]*1000000 + totalTicks[1]/1000);//microseconds
//     usagePercent = (usedTicks.user + usedTicks.system)/totalTicksMCS;
//   }
//   this.ts = process.hrtime();
//   this.cpuUsage = process.cpuUsage();
//   return usagePercent;
// }

// if (cluster.isMaster) {
//   var stoppingProcess = false;
//   process.once('SIGINT', function() {
//     stoppingProcess = true;
//   });

//   ClusterManager.prototype.initSecret = function(errorHandler: any, completeHandler: any) {
//     var crypto = require('crypto');
//     crypto.randomBytes(16, function(crypto_err: any, buffer: any) {
//       if (crypto_err) {
//         return errorHandler(crypto_err);
//       }
//       this.secret = buffer.toString('hex');
//       //console.log('secret: ' + this.secret);
//       completeHandler();
//     }.bind(this));
//   }

//   ClusterManager.prototype.initializing = function(completeHandler: any) {
//     var inits: any = [];
//     inits.push(this.initSecret.bind(this));

//     var stopOnError = function(err: any) {
//       console.error(err);
//       process.exit(-1);
//     }
//     var nextInit = function() {
//       var initializer = inits.pop();
//       if (initializer) {
//         initializer(stopOnError, nextInit);
//       } else {
//         completeHandler();
//       }
//     }.bind(this);
//     nextInit();
//   }

//   ClusterManager.prototype.startWorker = function(wi: any) {
//     console.log("Fork worker " + wi);
//     var thatClusterManager = this;
//     this.workers[wi] = cluster.fork({index : wi, expressSessionSecret: this.secret});
//     this.workers[wi].on('exit', function(code: any, signal: any) {
//       if (stoppingProcess) {
//         return;
//       }
//       if (wi >= thatClusterManager.workersNum) {
//         //console.log('do not restart worker ' + wi);//closed legally
//         return;
//       }
//       if (thatClusterManager.workers[wi].__workerInitialized !== true) {
//         console.log("Initializing was not complete for worker " + wi);
//         return;
//       }
//       console.log('restart worker ' + wi);
//       thatClusterManager.startWorker(wi);
//     });
//     this.workers[wi].on('message', function(message: any) {
//       thatClusterManager.handleMessageFromWorker(message);
//     });
//     this.workers[wi].process.stdout.on('data', function(chunk: any) {
//       var lines = String(chunk).split('\n');
//       lines.forEach(function(line) {
//         if (line) {
//           console.log('[' + thatClusterManager.workers[wi].process.pid + '] ' + line);
//         }
//       });
//     });
//     this.workers[wi].process.stderr.on('data', function(chunk: any) {
//       var lines = String(chunk).split('\n');
//       lines.forEach(function(line) {
//         if (line) {
//           console.error('[' + thatClusterManager.workers[wi].process.pid + '] ' + line);
//         }
//       });
//     });
//   }

//   ClusterManager.prototype.startWorkers = function() {
//     console.log("Fork " + this.workersNum + " workers.");
//     cluster.setupMaster({ silent: true });//workers[wi].process.stdout is null without this line
//     for (let i = 0; i < this.workersNum; i++) {
//       var wi = i%this.workersNum;
//       this.startWorker(wi);
//     }
//     this.workerResourceRequests = this.getWorkerResourceRequestsQueue(function(workerRR: any) {
//       var summ = 0;
//       workerRR.forEach(function(number: any) {
//         summ += number;
//       });
//       //console.log('workerResourceRequests workerRR=' + JSON.stringify(workerRR) + ' length=' + workerRR.length + ' summ=' + summ);
//       if (summ >= workerRR.length && this.workersNum < maxWorkers) {//all workers requested for help
//         this.moreWorker();
//       } else if (summ <= -workerRR.length && this.workersNum > minWorkers) {//all workers underloaded
//         this.lessWorker();
//       }
//     }.bind(this));
//   }

//   ClusterManager.prototype.getWorkerResourceRequestsQueue = function(shiftHandler: any) {
//     var array = new Array();
//     array.push = function () {
//         var requestsThreshold = this.workersNum * workerChangeDecisionDelay;
//         var result = Array.prototype.push.apply(array,arguments);
//         if (array.length > requestsThreshold) {
//           while(array.length > requestsThreshold) {
//             array.shift();
//           }
//           if (shiftHandler) {
//             shiftHandler(array);
//           }
//         }
//         return result;
//     }.bind(this);
//     return array;
//   }

//   ClusterManager.prototype.moreWorker = function() {
//     let wi = this.workersNum++;
//     this.startWorker(wi);
//   }

//   ClusterManager.prototype.lessWorker = function() {
//     if (this.workersNum > 1) {
//       let wi = --this.workersNum;
//       console.log("Close worker " + wi);
//       this.workers[wi].kill();
//     } else {
//       //console.log("Last worker should be alive");
//     }
//   }
  
//   var callFunction = function(f: any, that: any, argsArray: any, resultHandler: any, workerIndex: any) {
//     argsArray[argsArray.length] = resultHandler;
//     argsArray[argsArray.length] = workerIndex;
//     f.apply(that, argsArray);
//   }

//   ClusterManager.prototype.handleMessageFromWorker = function(message: any) {
//     if (message.type) {
//       if (message.type == MessageTypes.reportCpuUsage) {
//         var usagePercent = message.percent;
//         //console.log("Worker " + message.index + " CPU usage: " + usagePercent + " highCPU: " + highCPU + " lowCPU: " + lowCPU);
//         if (usagePercent > highCPU) {
//           this.workerResourceRequests.push(1);
//         } else if (usagePercent < lowCPU) {
//           this.workerResourceRequests.push(-1);
//         } else {
//           this.workerResourceRequests.push(0);
//         }
//       } else if (message.type == MessageTypes.reportInitialized) {
//         var wi = message.index;
//         this.workers[wi].__workerInitialized = true;
//         if (wi == 0) {
//           notifyWorker(this.workers[wi], Notifications.initOnce, null, wi);//subscriber can start separate processes with port listeners
//         }
//         this.restoreNodeState(this.workers[wi]);
//       } else if (message.type == MessageTypes.callClusterMethod) {
//         var wi = message.index;
//         var thatClusterManager = this;
//         this.callClusterMethodLocal(wi, message.moduleName, message.importedName, message.methodName, message.args, function() {
//           try {
//             if (arguments[0] instanceof Error) {
//               thatClusterManager.workers[wi].send({type: MessageTypes.callClusterMethod, index : -1, messageIndex: message.messageIndex, methodName : message.methodName, error : arguments[0].message});
//             } else {
//               thatClusterManager.workers[wi].send({type: MessageTypes.callClusterMethod, index : -1, messageIndex: message.messageIndex, methodName : message.methodName, result : arguments});
//             }
//           } catch (err) {
//             console.error(err);
//           }
//         });
//       } else if (message.type == MessageTypes.notify) {
//         this.notifyWorkers(message.notifyName, message.args, message.index);
//       }
//     }
//   }
  
//   ClusterManager.prototype.callClusterMethodLocal = function(wi: any, moduleName: any, exportedName: any, methodName: any, args: any, resultHandler: any) {
//     var exported;
//     var mod;
//     if (moduleName) {
//       try {
//         mod = require(moduleName);
//       } catch (e) {
//         resultHandler(e);
//       }
//       if (!mod) {
//         resultHandler(new Error("module not found " + moduleName));
//         return;
//       }
//     } else {
//       mod = module.exports;
//     }
//     exported = mod[exportedName];
//     if (exported && methodName) {
//       if (exported[methodName]) {
//         try {
//           var f = exported[methodName];
//           callFunction(f, exported, args, resultHandler, wi);
//         } catch (e) {
//           resultHandler(e);
//         }
//       } else {
//         resultHandler(new Error("method not implemented " + methodName));
//       }
//     } else if (exported) {
//       try {
//         var f = exported;
//         callFunction(f, exported, args, resultHandler, wi);
//       } catch (e) {
//         resultHandler(e);
//       }
//     } else {
//       resultHandler(new Error("object not exported " + exportedName));
//     }
//   }
  
//   var notifyWorker = function(worker: any, notifyName: any, args: any, indexInCluster: any) {
//     try {
//       worker.send({type: MessageTypes.notify, index : indexInCluster, notifyName : notifyName, args : args});
//     } catch (err) {
//       console.error(err);
//     }
//   }
  
//   ClusterManager.prototype.notifyWorkers = function (notifyName: any, args: any, indexInCluster: any) {
//     this.workers.forEach(function(worker: any, index: any) {
//       if (index != indexInCluster) {
//         notifyWorker(worker, notifyName, args, indexInCluster);
//       }
//     });
//   }

//   ClusterManager.prototype.notifyWorkersForAddingPlugin = function(pluginDef: any, resultHandler: any, indexInCluster: any) {
//     this.rememberNodeState(Notifications.addDynamicPlugin, pluginDef);
//     this.notifyWorkers(Notifications.addDynamicPlugin, pluginDef, indexInCluster);
//     resultHandler(true);
//   }

//   ClusterManager.prototype.rememberNodeState = function(type: any, object: any) {
//     if (!this.nodeStates) {
//       this.nodeStates = new Map();
//     }
//     var nodeState = this.nodeStates.get(type);
//     if (!nodeState) {
//       nodeState = this.createNodeStateFor(type);
//     }
//     this.nodeStates.set(type, nodeState);
//     nodeState.remember(object);
//   }

//   ClusterManager.prototype.restoreNodeState = function(worker: any) {
//     if (this.nodeStates) {
//       Array.from(this.nodeStates.values()).forEach(function(nodeState: any) {
//         nodeState.restore(worker);
//       });
//     }
//   }

//   ClusterManager.prototype.createNodeStateFor = function(type: any) {
//     if (Notifications.addDynamicPlugin === type) {
//       return {
//         pluginDefsMap: new Map(),
//         remember: function(pluginDef: any){
//           if ("identifier" in pluginDef) {
//             this.pluginDefsMap.set(pluginDef.identifier, pluginDef);
//           }
//         },
//         restore: function(worker: any) {
//           Array.from(this.pluginDefsMap.values()).forEach(function(pluginDef: any) {
//             notifyWorker(worker, Notifications.addDynamicPlugin, pluginDef, -1);
//           });
//         }
//       };
//     } else {
//       return {
//         remember: function(){},
//         restore: function(){}
//       };
//     }
//   }
// } else {
//   //Worker code
  
//   var getIndexInCluster = function() {
//     return process.env.index;
//   }
  
//   ClusterManager.prototype.getIndexInCluster = getIndexInCluster;
  
//   ClusterManager.prototype.reportCpuUsage = function(percent: any) {
//     process.send({type : MessageTypes.reportCpuUsage, index : this.getIndexInCluster(), percent : percent});
//   }

//   ClusterManager.prototype.reportInitialized = function() {
//     process.send({type : MessageTypes.reportInitialized, index : this.getIndexInCluster()});
//   }
  
//   ClusterManager.prototype.handleMessageFromMaster = function(message: any) {
//     if (message.type) {
//       if (message.type == MessageTypes.notify) {
//         //console.log("Notification from " + message.index + ": " + message.notifyName);
//         this.emit(message.notifyName, message.index, message.args);
//       }
//     }
//   }
  
//   ClusterManager.prototype.createProxyServerWorker = function() {
//     const ProxyServer = require('./index');
//     const proxyServer = new ProxyServer(this.appConfig, this.configJSON, this.startUpConfig);
//     proxyServer.start();
//     this.reportInitialized();
//     var thatClusterManager = this;
//     setInterval(function() {
//       var usagePercent = thatClusterManager.getCpuUsagePercent();
//       if (usagePercent !== undefined) {
//         thatClusterManager.reportCpuUsage(usagePercent);
//       }
//     }, 10000).unref();
//     process.on('message', function(message) {
//       thatClusterManager.handleMessageFromMaster(message);
//     });
//   }
  
//   ClusterManager.prototype.getMessageIndex = function () {
//     return this.messageIndex++;
//   }
  
//   ClusterManager.prototype.callClusterMethodRemote = function (moduleName: any, importedName: any, methodName: any, args: any, callback: any, onerror = this.onError, timeout = 1000) {
//     var promise = new Promise((resolve, reject) => {
//       var thisMessageIndex = this.getMessageIndex();
//       var messageListener = function(message: any) {
//         if (message.type) {
//           if (message.type == MessageTypes.callClusterMethod && message.messageIndex == thisMessageIndex) {
//             process.removeListener('message', messageListener);
//             clearTimeout(timeoutTimer);
//             if (message.error) {
//               reject(message.error);
//             } else {
//               resolve(message.result);
//               //resolve.apply(this, message.result);
//             }
//           }
//         }
//       }
//       process.on('message', messageListener);
//       process.send({type : MessageTypes.callClusterMethod, index : this.getIndexInCluster(), messageIndex : thisMessageIndex, moduleName : moduleName, importedName : importedName, methodName : methodName, args : args});
//       var timeoutTimer = setTimeout(function() {
//         process.removeListener('message', messageListener);
//         reject("Timeout call " + moduleName + "/" + importedName + "/" + methodName);
//       }, timeout);
//       timeoutTimer.unref();
//     });
//     return promise.then(callback, onerror);
//   }
  
//   ClusterManager.prototype.notifyCluster = function (notifyName: any, args: any, indexInCluster: any, callback: any, onerror = this.onError) {
//     var promise = new Promise((resolve, reject) => {
//       process.send({type : MessageTypes.notify, index : indexInCluster, notifyName : notifyName, args : args}, function() {
//         resolve(true);
//       });
//     });
//     return promise.then(callback, onerror);
//   }

//   ClusterManager.prototype.initOnce = function (handler: any) {
//     this.once(Notifications.initOnce, handler);
//   }

//   ClusterManager.prototype.onAddDynamicPlugin = function(handler: any) {
//     this.on(Notifications.addDynamicPlugin, handler);
//   }

//   ClusterManager.prototype.addDynamicPlugin = function(pluginDef: any) {
//     this.callClusterMethodRemote(null, "clusterManager", "notifyWorkersForAddingPlugin", [pluginDef],
//       function() {
//       },
//       function(e: any) {
//         console.log("Error adding plugin: " + e);
//       }
//     );
//   }
// }

// ClusterManager.prototype.start = function(appConfig: any, configJSON: any, startUpConfig: any) {
//   this.appConfig = appConfig;
//   this.configJSON = configJSON;
//   this.startUpConfig = startUpConfig;
//   if (cluster.isMaster) {
//     console.log(`Master ${process.pid} is running.`);
//     this.initializing(function() {
//       this.startWorkers();
//     }.bind(this));
//   } else {
//     console.log(`Worker ${this.getIndexInCluster()} pid ${process.pid}`);
//     this.createProxyServerWorker();
//   }
// }

// ClusterManager.prototype.callClusterMethod = function (moduleName: any, importedName: any, methodName: any, argsArray: any, callback: any, onerror = this.onError, timeout = 1000) {
//   if (cluster.isMaster) {
//     return this.callClusterMethodLocal(-1, moduleName, importedName, methodName, argsArray, callback);
//   } else {
//     return this.callClusterMethodRemote(moduleName, importedName, methodName, argsArray, callback, onerror, timeout);
//   }
// }

// ClusterManager.prototype.notifyOthers = function (notifyName: any, args: any, callback: any, onerror = this.onError) {
//   if (cluster.isMaster) {
//     return this.notifyWorkers(notifyName, args, -1);
//   } else {
//     return this.notifyCluster(notifyName, args, this.getIndexInCluster(), callback, onerror);
//   }
// }


/*
Do check here about if master or not

*/
if(cluster.isMaster) {
  var clusterManager = new (ClusterManagerMaster as any)();
}  else {
  var clusterManager = new (ClusterManagerNotMaster as any)();
}
(process as any).clusterManager = clusterManager;

module.exports.clusterManager = clusterManager;
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
