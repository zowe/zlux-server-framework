
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
  scanPlugins: "scanPlugins"
};

const events = require('events');
const cluster = require('cluster');
const os = require("os");
const zluxUtil = require('./util');
const mergeUtils = require('../utils/mergeUtils');
const constants = require('./unp-constants');
const cpuCount = os.cpus().length;

const highCPU = process.env.highCPU || 0.8;
const lowCPU = process.env.lowCPU || 0.2;

const maxWorkers = !isNaN(Number(process.env.ZLUX_MAX_WORKERS))
      ? Math.min(cpuCount*2, Math.max(Number(process.env.ZLUX_MAX_WORKERS), 1))
      : cpuCount;

const minWorkers = !isNaN(Number(process.env.ZLUX_MIN_WORKERS))
      ? Math.min(Math.max(Number(process.env.ZLUX_MIN_WORKERS), 1), maxWorkers)
      : 1;
const workerChangeDecisionDelay = process.env.workerChangeDecisionDelay || 4;

var storageTimeout = 30000; /* Default timeout for how long plugins wait for the cluster storage to finish creation */

var clusterLogger = zluxUtil.loggers.clusterLogger;

// Inserting the Zowe message code inline due to message resource file not loaded yet
clusterLogger.info("ZWED0211I - The number of processors is: " + cpuCount);
if (minWorkers != Number(process.env.ZLUX_MIN_WORKERS)) {
  clusterLogger.info("ZWED0212I - Environmental variable ZLUX_MIN_WORKERS was not a valid number therefore " + minWorkers + " will be used as the minimum workers");
}
if (process.env.ZLUX_MAX_WORKERS && (maxWorkers != Number(process.env.ZLUX_MAX_WORKERS))) {
  clusterLogger.info("ZWED0213I - Environmental variable ZLUX_MAX_WORKERS was not a valid number therefore " + maxWorkers + " will be used as the maximum workers");
}

var ClusterManager = function() {
  this.isMaster = cluster.isMaster;
  this.messageIndex = 0;
  this.workersNum = minWorkers;
  this.workers = [];
  this.overrideFileConfig = true;
  events.EventEmitter.call(this);
  if (this.isMaster) {
    /* We create the storage object at the master cluster. Each cluster will loop through
    and reference this master object, from any cluster */
    this.storage = zluxUtil.DataserviceStorage();
  }
}

ClusterManager.prototype.__proto__ = events.EventEmitter.prototype;

ClusterManager.prototype.onError = function (reason) {
  clusterLogger.severe("ZWED0001E - Error: " + reason);
}

ClusterManager.prototype.getCpuUsagePercent = function() {
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

if (cluster.isMaster) {
  var stoppingProcess = false;
  process.once('SIGINT', function() {
    stoppingProcess = true;
  });

  ClusterManager.prototype.initSecret = function(errorHandler, completeHandler) {
    var crypto = require('crypto');
    crypto.randomBytes(16, function(crypto_err, buffer) {
      if (crypto_err) {
        return errorHandler(crypto_err);
      }
      const secret = buffer.toString('hex');
      if (this.secret) {
        this.loopbackSecret = secret;
      } else {
        this.secret = secret;
      }
      completeHandler();
    }.bind(this));
  }

  ClusterManager.prototype.initializing = function(completeHandler) {
    if (process.env.ZOWE_SESSION_SECRET && process.env.ZOWE_LOOPBACK_SECRET) {
      this.secret = process.env.ZOWE_SESSION_SECRET;
      this.loopbackSecret = process.env.ZOWE_LOOPBACK_SECRET;
      completeHandler();
      return;
    } 
    var inits = [];
    inits.push(this.initSecret.bind(this));
    inits.push(this.initSecret.bind(this));

    var stopOnError = function(err) {
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

  ClusterManager.prototype.startWorker = function(wi) {
    clusterLogger.info("ZWED0022I - Fork worker " + wi);
    var thatClusterManager = this;
    this.workers[wi] = cluster.fork({index : wi,
                                     expressSessionSecret: this.secret,
                                     loopbackSecret: this.loopbackSecret,
                                     overrideFileConfig: this.overrideFileConfig});
    this.workers[wi].on('exit', function(code, signal) {
      if (stoppingProcess) {
        return;
      }
      if (wi >= thatClusterManager.workersNum) {
        //console.log('do not restart worker ' + wi);//closed legally
        return;
      }
      if (code >= constants.EXIT_GENERIC) {
        thatClusterManager.reloadAllWorkers();
        process.exit(code);
        return;
      }
      if (thatClusterManager.workers[wi].__workerInitialized !== true) {
        clusterLogger.warn("ZWED0013W - Initializing was not complete for worker " + wi);
        return;
      }
      clusterLogger.info('ZWED0023I - restart worker ' + wi);
      thatClusterManager.startWorker(wi);
    });
    this.workers[wi].on('message', function(message) {
      thatClusterManager.handleMessageFromWorker(message);
    });
    this.workers[wi].process.stdout.on('data', function(chunk) {
      var lines = String(chunk).split('\n');
      lines.forEach(function(line) {
        if (line) {
          console.log(line); //TODO, DON'T CHANGE THIS LINE
        }
      });
    });
    this.workers[wi].process.stderr.on('data', function(chunk) {
      var lines = String(chunk).split('\n');
      lines.forEach(function(line) {
        if (line) {
          console.error(line);
        }
      });
    });
  }

  ClusterManager.prototype.reloadAllWorkers = function() {
    let workers = Object.assign({},this.workers);
    const workerKeys = Object.keys(workers);
    clusterLogger.info(`ZWED0024I - keys=`,workerKeys);
    workerKeys.forEach((key)=> {
      let worker = workers[key];
      clusterLogger.info('ZWED0025I - Killing worker pid='+worker.process.pid);
      delete workers[key];
      worker.kill();
    });
  }

  ClusterManager.prototype.setOverrideFileConfig = function(override){
    process.env.overrideFileConfig = override;
    this.overrideFileConfig = override;
  }

  /* Having gotten here, we are already at the cluster, but it's safer to validate anyway
    i. e. "if (this.storage) ..." since only the master cluster has storage */
  ClusterManager.prototype.getStorageByKey = function(pluginId, key, resultHandler) {
    return resultHandler(this.storage.get(key, pluginId));
  }

  ClusterManager.prototype.getStorageAll = function(id, resultHandler) {
    return resultHandler(this.storage.getAll(id));
  }

  ClusterManager.prototype.getStorageCluster = function(resultHandler) {
    return resultHandler(this.storage.storageDict);
  }

  ClusterManager.prototype.setStorageByKey = function(pluginId, key, value, resultHandler) {
    this.storage.set(key, value, pluginId);
    return resultHandler(true);
  }

  ClusterManager.prototype.setStorageAll = function(pluginId, dict, resultHandler) {
    this.storage.setAll(dict, pluginId);
    return resultHandler(true);
  }

  ClusterManager.prototype.mergeStorage = function(pluginId, dict, resultHandler) {
    const allStorage = this.storage.getAll(pluginId);

    if (allStorage == null || allStorage == dict) {
      this.storage.setAll(dict, pluginId);
    } else {
      const mergedObjects = mergeUtils.deepAssign(allStorage, dict);
      this.storage.setAll(mergedObjects, pluginId);
    }
    return resultHandler(true);
  }

  ClusterManager.prototype.deleteStorageByKey = function(pluginId, key, resultHandler) {
    this.storage.delete(key, pluginId);
    return resultHandler(true);
  }

  ClusterManager.prototype.notifyWorkersForAddingPlugin = function(resultHandler, indexInCluster) {
    this.notifyWorkers(Notifications.addDynamicPlugin, indexInCluster);
    resultHandler(true);
  }

  ClusterManager.prototype.notifyWorkersForScanningPlugins = function(resultHandler, indexInCluster) {
    this.notifyWorkers(Notifications.scanPlugins, indexInCluster);
    resultHandler(true);
  }


  ClusterManager.prototype.startWorkers = function() {
    clusterLogger.info("ZWED0026I - Fork " + this.workersNum + " workers.");
    cluster.setupMaster({ silent: true });//workers[wi].process.stdout is null without this line
    for (let i = 0; i < this.workersNum; i++) {
      var wi = i%this.workersNum;
      this.startWorker(wi);
    }
    this.workerResourceRequests = this.getWorkerResourceRequestsQueue(function(workerRR) {
      var summ = 0;
      workerRR.forEach(function(number) {
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

  ClusterManager.prototype.getWorkerResourceRequestsQueue = function(shiftHandler) {
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

  ClusterManager.prototype.moreWorker = function() {
    let wi = this.workersNum++;
    this.startWorker(wi);
  }

  ClusterManager.prototype.lessWorker = function() {
    if (this.workersNum > 1) {
      let wi = --this.workersNum;
      clusterLogger.info("ZWED0027I - Close worker " + wi);
      this.workers[wi].kill();
    } else {
      //console.log("Last worker should be alive");
    }
  }
  
  var callFunction = function(f, that, argsArray, resultHandler, workerIndex) {
    argsArray[argsArray.length] = resultHandler;
    argsArray[argsArray.length] = workerIndex;
    f.apply(that, argsArray);
  }

  ClusterManager.prototype.handleMessageFromWorker = function(message) {
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
          notifyWorker(this.workers[wi], Notifications.initOnce, null, wi);//subscriber can start separate processes with port listeners
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
  
  ClusterManager.prototype.callClusterMethodLocal = function(wi, moduleName, exportedName, methodName, args, resultHandler) {
    var exported;
    var mod;
    if (moduleName) {
      try {
        mod = require(moduleName);
      } catch (e) {
        resultHandler(e);
      }
      if (!mod) {
        resultHandler(new Error("ZWED0022E - Module not found " + moduleName));
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
          callFunction(f, exported, args, resultHandler, wi);
        } catch (e) {
          resultHandler(e);
        }
      } else {
        resultHandler(new Error("ZWED0023E - Method not implemented " + methodName));
      }
    } else if (exported) {
      try {
        var f = exported;
        callFunction(f, exported, args, resultHandler, wi);
      } catch (e) {
        resultHandler(e);
      }
    } else {
      resultHandler(new Error("ZWED0024E - Object not exported " + exportedName));
    }
  }
  
  var notifyWorker = function(worker, notifyName, args, indexInCluster) {
    try {
      worker.send({type: MessageTypes.notify, index : indexInCluster, notifyName : notifyName, args : args});
    } catch (err) {
      console.error(err);
    }
  }
  
  ClusterManager.prototype.notifyWorkers = function (notifyName, args, indexInCluster) {
    this.workers.forEach(function(worker, index) {
      if (index != indexInCluster) {
        notifyWorker(worker, notifyName, args, indexInCluster);
      }
    });
  }

  ClusterManager.prototype.notifyWorkersForAddingPlugin = function(pluginDef, resultHandler, indexInCluster) {
    this.rememberNodeState(Notifications.addDynamicPlugin, pluginDef);
    this.notifyWorkers(Notifications.addDynamicPlugin, pluginDef, indexInCluster);
    resultHandler(true);
  }

  ClusterManager.prototype.notifyWorkersForScanningPlugins = function(resultHandler, indexInCluster) {
    this.notifyWorkers(Notifications.scanPlugins, null, indexInCluster);
    resultHandler(true);
  }
  
  ClusterManager.prototype.rememberNodeState = function(type, object) {
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

  ClusterManager.prototype.restoreNodeState = function(worker) {
    if (this.nodeStates) {
      Array.from(this.nodeStates.values()).forEach(function(nodeState) {
        nodeState.restore(worker);
      });
    }
  }

  ClusterManager.prototype.createNodeStateFor = function(type) {
    if (Notifications.addDynamicPlugin === type) {
      return {
        pluginDefsMap: new Map(),
        remember: function(pluginDef){
          if ("identifier" in pluginDef) {
            this.pluginDefsMap.set(pluginDef.identifier, pluginDef);
          }
        },
        restore: function(worker) {
          Array.from(this.pluginDefsMap.values()).forEach(function(pluginDef) {
            notifyWorker(worker, Notifications.addDynamicPlugin, pluginDef, -1);
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
} else {
  //Worker code
  
  var getIndexInCluster = function() {
    return process.env.index;
  }
  
  ClusterManager.prototype.getIndexInCluster = getIndexInCluster;
  
  ClusterManager.prototype.reportCpuUsage = function(percent) {
    process.send({type : MessageTypes.reportCpuUsage, index : this.getIndexInCluster(), percent : percent});
  }

  ClusterManager.prototype.reportInitialized = function() {
    process.send({type : MessageTypes.reportInitialized, index : this.getIndexInCluster()});
  }
  
  ClusterManager.prototype.handleMessageFromMaster = function(message) {
    if (message.type) {
      if (message.type == MessageTypes.notify) {
        //console.log("Notification from " + message.index + ": " + message.notifyName);
        this.emit(message.notifyName, message.index, message.args);
      }
    }
  }
  
  ClusterManager.prototype.createProxyServerWorker = function() {
    const ProxyServer = require('./index');
    const proxyServer = new ProxyServer(this.appConfig, this.configJSON, this.startUpConfig, this.configLocation);
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
  
  ClusterManager.prototype.getMessageIndex = function () {
    return this.messageIndex++;
  }
  
  ClusterManager.prototype.callClusterMethodRemote = function (moduleName, importedName, methodName, args, callback, onerror = this.onError, timeout = 1000) {
    var promise = new Promise((resolve, reject) => {
      var thisMessageIndex = this.getMessageIndex();
      var messageListener = function(message) {
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
  
  ClusterManager.prototype.notifyCluster = function (notifyName, args, indexInCluster, callback, onerror = this.onError) {
    var promise = new Promise((resolve, reject) => {
      process.send({type : MessageTypes.notify, index : indexInCluster, notifyName : notifyName, args : args}, function() {
        resolve(true);
      });
    });
    return promise.then(callback, onerror);
  }

  ClusterManager.prototype.initOnce = function (handler) {
    this.once(Notifications.initOnce, handler);
  }

  ClusterManager.prototype.onScanPlugins = function(handler) {
    this.on(Notifications.scanPlugins, handler);
  }

  ClusterManager.prototype.scanPlugins = function() {
    this.callClusterMethodRemote(null, "clusterManager", "notifyWorkersForScanningPlugins", [],
      function() {
      },
      function(e) {
        clusterLogger.warn("ZWED0014W - Error adding plugin: " + e);
      }
    );
  }
  
  ClusterManager.prototype.onAddDynamicPlugin = function(handler) {
    this.on(Notifications.addDynamicPlugin, handler);
  }

  ClusterManager.prototype.addDynamicPlugin = function(pluginDef) {
    this.callClusterMethodRemote(null, "clusterManager", "notifyWorkersForAddingPlugin", [pluginDef],
      function() {
      },
      function(e) {
        clusterLogger.warn("ZWED0014W - Error adding plugin: " + e);
      }
    );
  }
  
  ClusterManager.prototype.reloadAllWorkers = function() {
    this.callClusterMethodRemote(null, "clusterManager", "reloadAllWorkers", [],
      function() {
      },
      function(e) {
        clusterLogger.warn("ZWED0015W - Error reloading workers: " + e);
      }
    );
  }

  ClusterManager.prototype.setOverrideFileConfig = function(override) {
    this.callClusterMethodRemote(null, "clusterManager", "setOverrideFileConfig", [override],
      function() {
      },
      function(e) {
        clusterLogger.warn("ZWED0016W - Error setting override: " + e);
      }
    );
  }

  ClusterManager.prototype.getStorageByKey = function(pluginId, key) {
    return this.callClusterMethodRemote(null, "clusterManager", "getStorageByKey", [pluginId, key],
    function(resultHandler) { 
      return resultHandler[0]; // Return the first arg (storage object) of getStorage
    },
    function(e) {
      clusterLogger.warn("ZWED0168W - Unable to retrieve storage value from cluster", e);
    }
    );
  }

  ClusterManager.prototype.getStorageAll = function(id) {
    return this.callClusterMethodRemote(null, "clusterManager", "getStorageAll", [id],
      function(resultHandler) {
        return resultHandler[0]; // Return the first arg (storage object) of getStorageAll
      },
      function(errorMsg) {
        if (errorMsg.startsWith('Timeout call')) {
          clusterLogger.severe("ZWED0144E - Cluster storage object timeout." +
                               "\nYou may change the value of '" + storageTimeout + "' ms by setting 'node.cluster.storageTimeout' within the config.");
        } else {
          clusterLogger.severe("ZWED0115E - Unable to retrieve storage object from cluster.",errorMsg);
        }
        process.exit(constants.EXIT_GENERIC);
        return errorMsg;
      }, storageTimeout /* We need to give ample timeout time since this method is used to verify 
      the completion of cluster storage initialization in webapp.js, Default: 30 seconds */
    )
  }

  ClusterManager.prototype.getStorageCluster = function() {
    return this.callClusterMethodRemote(null, "clusterManager", "getStorageCluster", [],
      function(resultHandler) {
        return resultHandler[0]; // Return the first arg (storage object) of getStorageCluster
      },
      function(errorMsg) {
        if (errorMsg.startsWith('Timeout call')) {
          clusterLogger.severe("ZWED0144E - Cluster storage object timeout." +
                               "\nYou may change the value of '" + storageTimeout + "' ms by setting 'node.cluster.storageTimeout' within the config.");
        } else {
          clusterLogger.severe("ZWED0115E - Unable to retrieve storage object from cluster.",errorMsg);
        }
        process.exit(constants.EXIT_GENERIC);
        return errorMsg;
      }, storageTimeout
    )
  }

  /* Though set here can be called like sync, we provide a callback in case we need
  to wait for a response */
  ClusterManager.prototype.setStorageByKey = function(pluginId, key, value) {
    return this.callClusterMethodRemote(null, "clusterManager", "setStorageByKey", [pluginId, key, value],
      function(resultHandler) {
        return resultHandler[0];
      },
      function(e) {
        clusterLogger.warn("ZWED0166W - Error updating the storage: " + e);
      }
    );
  }

  /* Though set here can be called like sync, we provide a callback in case we need
  to wait for a response */
  ClusterManager.prototype.setStorageAll = function(pluginId, dict) {
    return this.callClusterMethodRemote(null, "clusterManager", "setStorageAll", [pluginId, dict],
      function(resultHandler) {
        return resultHandler[0];
      },
      function(e) {
        clusterLogger.warn("ZWED0166W - Error updating the storage: " + e);
      }
    );
  }

  /* Though merge here can be called like sync, we provide a callback in case we need
  to wait for a response */
  ClusterManager.prototype.mergeStorage = function(pluginId, dict) {
    return this.callClusterMethodRemote(null, "clusterManager", "mergeStorage", [pluginId, dict],
      function(resultHandler) {
        return resultHandler[0];
      },
      function(e) {
        clusterLogger.warn("ZWED0167W - Error adding to the storage: " + e);
      }
    );
  }

  /* Though delete here can be called like sync, we provide a callback in case we need
  to wait for a response */
  ClusterManager.prototype.deleteStorageByKey = function(pluginId, key) {
    this.callClusterMethod(null, "clusterManager", "deleteStorageByKey", [pluginId, key],
      function(resultHandler) {
        return resultHandler[0];
      },
      function(e) {
        clusterLogger.warn("ZWED0169W - Error deleting storage with id: " + [key] + " " + e);
      }
    );
  }
}

ClusterManager.prototype.start = function(appConfig, configJSON, startUpConfig, configLocation) {
  this.appConfig = appConfig;
  this.configJSON = configJSON;
  this.startUpConfig = startUpConfig;
  this.configLocation = configLocation;
  if (configJSON && configJSON.node && configJSON.node.cluster) {
    storageTimeout = configJSON.node.cluster.storageTimeout;
  }
  if (cluster.isMaster) {
    clusterLogger.info(`ZWED0028I - Master ${process.pid} is running.`)
    this.initializing(function() {
      this.startWorkers();
    }.bind(this));
  } else {
    clusterLogger.info(`ZWED0029I - Worker ${this.getIndexInCluster()} pid ${process.pid}`);
    this.createProxyServerWorker();
  }
}

ClusterManager.prototype.callClusterMethod = function (moduleName, importedName, methodName, argsArray, callback, onerror = this.onError, timeout = 1000) {
  if (cluster.isMaster) {
    return this.callClusterMethodLocal(-1, moduleName, importedName, methodName, argsArray, callback);
  } else {
    return this.callClusterMethodRemote(moduleName, importedName, methodName, argsArray, callback, onerror, timeout);
  }
}

ClusterManager.prototype.notifyOthers = function (notifyName, args, callback, onerror = this.onError) {
  if (cluster.isMaster) {
    return this.notifyWorkers(notifyName, args, -1);
  } else {
    return this.notifyCluster(notifyName, args, this.getIndexInCluster(), callback, onerror);
  }
}

const clusterManager = new ClusterManager();
process.clusterManager = clusterManager;

module.exports.clusterManager = clusterManager;
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
