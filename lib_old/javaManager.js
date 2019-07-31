"use strict";
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = y[op[0] & 2 ? "return" : op[0] ? "throw" : "next"]) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [0, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var path = require("path");
var tomcatManager_1 = require("./tomcatManager");
var jarManager_1 = require("./jarManager");
var utils = require("./util");
var log = utils.loggers.langManager;
var WAR_SERVICE_TYPE_NAME = 'java-war';
var JAR_SERVICE_TYPE_NAME = 'java-jar';
var DEFAULT_GROUPING = 'appserver';
var JavaManager = /** @class */ (function () {
    function JavaManager(config, instanceDir, zluxUrl) {
        this.config = config;
        this.instanceDir = instanceDir;
        this.zluxUrl = zluxUrl;
        this.portPos = 0;
        this.servers = new Array();
        //process at this time, so that startAll() is ready to go
        this.config = config;
        this.processConfig(); //validates & extracts... may throw
    }
    JavaManager.prototype.getSupportedTypes = function () {
        return JavaManager.supportedTypes;
    };
    JavaManager.prototype.startAll = function () {
        return __awaiter(this, void 0, void 0, function () {
            var i;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        i = 0;
                        _a.label = 1;
                    case 1:
                        if (!(i < this.servers.length)) return [3 /*break*/, 4];
                        //start each by each specific manager within
                        return [4 /*yield*/, this.servers[i].manager.start()];
                    case 2:
                        //start each by each specific manager within
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        i++;
                        return [3 /*break*/, 1];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    JavaManager.prototype.stopAll = function () {
        return __awaiter(this, void 0, void 0, function () {
            var i, e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        i = 0;
                        _a.label = 1;
                    case 1:
                        if (!(i < this.servers.length)) return [3 /*break*/, 6];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, this.servers[i].manager.stop()];
                    case 3:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        e_1 = _a.sent();
                        log.warn("Could not stop manager, error=", e_1);
                        return [3 /*break*/, 5];
                    case 5:
                        i++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    JavaManager.prototype.registerPlugins = function (pluginDefs) {
        this.processWarGrouping(pluginDefs);
        //    this.processJars(pluginDefs);
    };
    /**
       Returns info about how to connect to the service, provided the service is known to us
     */
    JavaManager.prototype.getConnectionInfo = function (pluginId, serviceName, serviceType) {
        for (var i = 0; i < this.servers.length; i++) {
            var server = this.servers[i];
            for (var j = 0; j < server.plugins.length; j++) {
                if (server.plugins[j].identifier == pluginId) {
                    /* TODO suppport HTTP, maybe.
                    let port, isHttps;
                    if (server.https) {
                      port = server.https.port;
                      isHttps = true;
                    }
                    else {
                      port = server.http.port;
                      isHttps = false;
                    }
                    */
                    return {
                        url: server.type == 'appserver' ? server.manager.getURL(pluginId, serviceName) : server.url,
                        options: {
                            isHttps: true
                        },
                        port: server.port
                    };
                }
            }
        }
    };
    JavaManager.prototype.containsCompatibleService = function (services, type) {
        var supportedTypes = type ? [type] : JavaManager.supportedTypes;
        if (!services) {
            return false;
        }
        for (var i = 0; i < services.length; i++) {
            if (supportedTypes.indexOf(services[i].type) != -1) {
                return true;
            }
        }
        return false;
    };
    JavaManager.prototype.processPorts = function () {
        var config = this.config;
        if (config.portRange && Array.isArray(config.portRange) && config.portRange.length == 2) {
            var start = config.portRange[0];
            var finish = config.portRange[1];
            if (start < 0 || finish > 65535 || finish < start) {
                throw new Error("JavaManager given port range beyond limits");
            }
            this.ports = new Array(finish - start + 1);
            var j = 0;
            for (var i = start; i < finish + 1; i++) {
                this.ports[j++] = i;
            }
        }
        else if (config.ports && Array.isArray(config.ports) && config.ports.length != 0) {
            this.ports = config.ports;
        }
        else {
            throw new Error("JavaManager not given any ports with which to run servers");
        }
    };
    JavaManager.prototype.processJars = function (pluginDefs) {
        var _this = this;
        var jarRuntimes = this.config.jar.runtimeMapping;
        var remainingPlugins = {};
        var defaultRuntimeName = Object.keys(this.config.runtimes)[0];
        var defaultRuntime = this.config.runtimes[defaultRuntimeName];
        pluginDefs.forEach(function (pluginDef) {
            remainingPlugins[pluginDef.identifier] = pluginDef;
        });
        pluginDefs.forEach(function (plugin) {
            if (plugin.dataServices) {
                plugin.dataServices.forEach(function (service) {
                    if (service.type === JAR_SERVICE_TYPE_NAME) {
                        var runtimeName = jarRuntimes[plugin.identifier];
                        if (!runtimeName) {
                            var id = plugin.identifier + ":" + service.name;
                            runtimeName = jarRuntimes[id];
                            if (!runtimeName) {
                                runtimeName = defaultRuntimeName;
                            }
                        }
                        var port = _this.getPortOrThrow();
                        var manager = _this.makeJarManager(plugin, service.name, port, _this.config.runtimes[runtimeName]);
                        if (manager) {
                            _this.portPos++;
                            _this.servers.push({ type: "microservice", url: manager.getServerInfo().rootUrl,
                                plugins: [plugin], manager: manager, port: port });
                        }
                    }
                });
            }
        });
    };
    /**
       tolerates & warns on missing plugins, warns on plugin referenced without any war service within
    */
    JavaManager.prototype.processWarGrouping = function (pluginDefs) {
        var _this = this;
        var groupingConfig = this.config.war.pluginGrouping;
        var defaultBehavior = this.config.war.defaultGrouping ? this.config.war.defaultGrouping : DEFAULT_GROUPING;
        if (defaultBehavior != 'microservice' && defaultBehavior != 'appserver') {
            throw new Error("Unknown java war grouping default=" + defaultBehavior);
        }
        var remainingPlugins = {};
        pluginDefs.forEach(function (pluginDef) {
            remainingPlugins[pluginDef.identifier] = pluginDef;
        });
        if (groupingConfig && Array.isArray(groupingConfig) && groupingConfig.length > 0) {
            for (var i = 0; i < groupingConfig.length; i++) {
                var group = groupingConfig[i];
                var port = this.getPortOrThrow();
                var server = this.makeServerFromGroup(group, port, remainingPlugins);
                if (server) {
                    this.servers.push(server);
                    this.portPos++;
                }
                else {
                    log.warn("No server returned for group=", group);
                }
            }
        }
        var pluginKeys = Object.keys(remainingPlugins);
        switch (defaultBehavior) {
            case 'microservice':
                pluginKeys.forEach(function (key) {
                    var port = _this.getPortOrThrow();
                    var group = [key];
                    var server = _this.makeServerFromGroup({ plugins: group }, port, remainingPlugins);
                    if (server) {
                        _this.servers.push(server);
                        _this.portPos++;
                    }
                });
                break;
            case 'appserver':
                var port = this.getPortOrThrow();
                var server = this.makeServerFromGroup({ plugins: pluginKeys }, port, remainingPlugins);
                if (server) {
                    this.servers.push(server);
                    this.portPos++;
                }
                break;
            default:
                log.warn("Unknown default behavior=" + defaultBehavior);
        }
    };
    JavaManager.prototype.getPortOrThrow = function () {
        var port = this.ports[this.portPos];
        if (port === undefined) {
            throw new Error("Could not find port to use for configuration, at config position=" + this.portPos);
        }
        return port;
    };
    //TODO how are we getting runtime info down to here, and at the high end should services really be allowed
    //to depend on different runtimes, or is it plugin-wide?
    JavaManager.prototype.makeJarManager = function (plugin, serviceName, port, runtime) {
        if (!plugin.dataServices)
            return undefined;
        var service;
        for (var i = 0; i < plugin.dataServices.length; i++) {
            if (plugin.dataServices[i].name == serviceName) {
                service = plugin.dataServices[i];
            }
        }
        if (service) {
            var config = {
                port: port,
                plugin: plugin,
                serviceName: serviceName,
                runtime: runtime,
                tempDir: 'TODO',
                zluxUrl: this.zluxUrl
            };
            return new jarManager_1.JarManager(config);
        }
        return undefined;
    };
    JavaManager.prototype.makeServerFromGroup = function (group, port, remainingPlugins) {
        var java = group.java;
        if (!java) {
            //TODO should this really be a map... for this reason?
            java = Object.keys(this.config.runtimes)[0];
        }
        ;
        var runtime = this.config.runtimes[java];
        if (!runtime) {
            throw new Error("Could not find runtime to satisfy group: " + java);
        }
        var plugins = group.plugins;
        if (Array.isArray(plugins) && plugins.length > 0) {
            var groupArray = [];
            for (var j = 0; j < plugins.length; j++) {
                var plugin = remainingPlugins[plugins[j]];
                if (plugin) {
                    if (this.containsCompatibleService(plugin.dataServices, WAR_SERVICE_TYPE_NAME)) {
                        groupArray.push(plugin);
                    }
                    remainingPlugins[plugins[j]] = undefined;
                }
                else {
                    log.warn("Services in plugin=" + plugins[j] + " war grouping skipped. "
                        + "Plugin missing or already grouped");
                }
            }
            if (groupArray.length > 0) {
                var serverManager = this.makeAppServer(groupArray, runtime, port);
                return { type: "appserver", url: serverManager.getServerInfo().rootUrl,
                    plugins: groupArray, manager: serverManager, port: port };
            }
        }
        else {
            log.warn("Skipping invalid plugin group=", plugins);
        }
    };
    //TODO how do i have type extensions to return something better than any
    //group is composed of plugins. the plugins may contain 0 services that this server can handle. validate within here
    JavaManager.prototype.makeAppServer = function (group, runtime, port) {
        var serverConfigBase = this.config.war.javaAppServer;
        switch (serverConfigBase.type) {
            case 'tomcat':
                var joinedConfig = Object.assign({
                    shutdown: { port: -1 },
                    runtime: runtime,
                    plugins: group,
                }, serverConfigBase);
                joinedConfig.https = Object.assign({ port: port }, joinedConfig.https);
                if (!joinedConfig.appRootDir) {
                    //may need to be created later
                    joinedConfig.appRootDir = path.join(this.instanceDir, 'ZLUX', 'languageManagers', 'java', 'tomcat');
                }
                joinedConfig.zluxUrl = this.zluxUrl;
                return new tomcatManager_1.TomcatManager(joinedConfig);
            default:
                throw new Error("Unknown java app server type=" + serverConfigBase.type + " specified in config. "
                    + "Cannot continue with java loading");
        }
    };
    JavaManager.prototype.processRuntimes = function () {
        var config = this.config;
        if (config.runtimes) {
            return; //TODO what more validation should we do here
        }
        else {
            //find from path
            var JAVA_HOME = process.env.ZOWE_JAVA_HOME ? process.env.ZOWE_JAVA_HOME : process.env.JAVA_HOME;
            if (!JAVA_HOME) {
                throw new Error("Java runtimes not specified, and no JAVA_HOME set");
            }
            this.config.runtimes = { "default": { "home": JAVA_HOME } };
        }
    };
    JavaManager.prototype.processConfig = function () {
        var config = this.config;
        this.processRuntimes();
        if (config.war) {
            if (!config.war.javaAppServer) {
                throw new Error("Java app server not defined in config");
            }
        }
        else if (!config.war && !config.jar) {
            throw new Error("JavaManager not given either war or jar configuration options, nothing to do");
        }
        this.processPorts();
    };
    JavaManager.supportedTypes = [WAR_SERVICE_TYPE_NAME, JAR_SERVICE_TYPE_NAME];
    return JavaManager;
}());
exports.JavaManager = JavaManager;
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
//# sourceMappingURL=javaManager.js.map