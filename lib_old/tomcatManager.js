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
var fs = require("graceful-fs");
var path = require("path");
var mkdirp = require("mkdirp");
var child_process = require("child_process");
//import * as xml2js from 'xml2js';
var yauzl = require("yauzl");
var utils = require("./util");
var rimraf = require("rimraf");
var log = utils.loggers.langManager;
var spawn = child_process.spawn;
var FILE_WRITE_MODE = 384;
var DIR_WRITE_MODE = 448;
var TomcatManager = /** @class */ (function () {
    function TomcatManager(config) {
        var _this = this;
        this.config = config;
        this.services = {};
        this.status = "stopped";
        this.id = (Date.now() + Math.random()) * 10000; //something simple but not ugly for a dir name
        this.appdir = path.join(this.config.appRootDir, '' + this.id);
        this.config.plugins.forEach(function (plugin) {
            var services = plugin.dataServices;
            services.forEach(function (service) {
                if (service.type == 'java-war') {
                    var serviceid = plugin.identifier + ':' + service.name;
                    var warpath = path.join(plugin.location, 'lib', service.filename);
                    log.info("Tomcat Manager ID=" + _this.id + " found service=" + serviceid + ", war=" + warpath);
                    _this.services[serviceid] = warpath;
                }
            });
        });
    }
    TomcatManager.prototype.getIdString = function () {
        return "Tomcat PID=" + this.tomcatProcess.pid + ":";
    };
    TomcatManager.prototype.makeRoot = function () {
        var _this = this;
        return new Promise(function (resolve, reject) {
            mkdirp(_this.appdir, { mode: DIR_WRITE_MODE }, function (err) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    };
    TomcatManager.prototype.startViaCatalinaShell = function (DOptionsArray) {
        var opts = '-D' + DOptionsArray.join(' -D');
        var env = { "JAVA_OPTS": opts,
            "CATALINA_BASE": this.config.path,
            "CATALINA_HOME": this.config.path,
            "JRE_HOME": this.config.runtime.home,
            "CATALINA_PID": path.join(this.appdir, 'tomcat.pid'),
            "ZOWE_ZLUX_URL": this.config.zluxUrl };
        var catalina = path.join(this.config.path, 'bin', 'catalina.sh');
        var args = ['run', '-config', this.config.config];
        log.info("Starting tomcat with params:\n"
            + ("Catalina: " + catalina + "\n")
            + ("Args: " + JSON.stringify(args) + "\n")
            + ("Env: " + JSON.stringify(env)));
        return spawn(catalina, args, { env: env });
    };
    TomcatManager.prototype.startViaJava = function (DOptionsArray) {
        var seperator = (TomcatManager.isWindows ? ';' : ':');
        var classPath = "" + path.join(this.config.path, 'bin')
            + seperator
            + ("" + path.join(this.config.path, 'bin', 'bootstrap.jar'))
            + seperator
            + ("" + path.join(this.config.path, 'bin', 'tomcat-juli.jar'));
        DOptionsArray = DOptionsArray.map(function (str) { return '-D' + str; }).concat(['-Djava.util.logging.manager=org.apache.juli.ClassLoaderLogManager',
            '-Djdk.tls.ephemeralDHKeySize=2048',
            '-Djava.protocol.handler.pkgs=org.apache.catalina.webresources',
            '-Dignore.endorsed.dirs=""',
            '-classpath',
            classPath,
            'org.apache.catalina.startup.Bootstrap',
            '-config', this.config.config, 'start']);
        var env = { "CLASSPATH": classPath,
            "CATALINA_BASE": this.config.path,
            "CATALINA_HOME": this.config.path,
            "JRE_HOME": this.config.runtime.home,
            "JAVA_HOME": this.config.runtime.home,
            "ZOWE_ZLUX_URL": this.config.zluxUrl };
        var javaPath = path.join(this.config.runtime.home, 'bin', 'java');
        var cwd = path.join(this.config.path, 'bin');
        log.info("Starting tomcat with params:\n"
            + ("Java=" + javaPath + "\n")
            + ("Options=" + JSON.stringify(DOptionsArray) + "\n")
            + ("Env=" + JSON.stringify(env) + "\n")
            + ("cwd=" + cwd));
        return spawn(javaPath, DOptionsArray, { env: env,
            cwd: cwd
        });
    };
    TomcatManager.prototype.start = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            var successes, keys, i, key, warpath, dir, preextracted, e_1, e_2, servletname, destination, e_3, DOptionsArray, tomcatProcess_1, onClose_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        //make folder, make links, start server
                        log.info("Tomcat Manager with id=" + this.id + " invoked to startup with config=", this.config);
                        return [4 /*yield*/, this.makeRoot()];
                    case 1:
                        _a.sent();
                        successes = 0;
                        keys = Object.keys(this.services);
                        i = 0;
                        _a.label = 2;
                    case 2:
                        if (!(i < keys.length)) return [3 /*break*/, 21];
                        key = keys[i];
                        warpath = this.services[key];
                        dir = void 0;
                        _a.label = 3;
                    case 3:
                        _a.trys.push([3, 11, , 12]);
                        return [4 /*yield*/, this.isExtracted(warpath)];
                    case 4:
                        preextracted = _a.sent();
                        if (!!preextracted) return [3 /*break*/, 9];
                        _a.label = 5;
                    case 5:
                        _a.trys.push([5, 7, , 8]);
                        return [4 /*yield*/, this.extractWar(warpath, key)];
                    case 6:
                        dir = _a.sent();
                        return [3 /*break*/, 8];
                    case 7:
                        e_1 = _a.sent();
                        log.warn("Could not extract war for service=" + key + ", error=", e_1);
                        return [3 /*break*/, 8];
                    case 8: return [3 /*break*/, 10];
                    case 9:
                        dir = warpath.substring(0, warpath.length - path.extname(warpath).length);
                        _a.label = 10;
                    case 10: return [3 /*break*/, 12];
                    case 11:
                        e_2 = _a.sent();
                        log.warn("Could not access files to determine status for service=" + key + ", error=", e_2);
                        return [3 /*break*/, 12];
                    case 12:
                        if (!dir) return [3 /*break*/, 19];
                        _a.label = 13;
                    case 13:
                        _a.trys.push([13, 17, , 18]);
                        servletname = path.basename(dir);
                        log.info("Service=" + key + " has Servlet name=" + servletname);
                        destination = path.join(this.appdir, key.replace(/:/g, '_') + '_' +
                            path.basename(warpath.substring(0, warpath.length - path.extname(warpath).length)));
                        if (!(dir != destination)) return [3 /*break*/, 15];
                        return [4 /*yield*/, this.makeLink(dir, destination)];
                    case 14:
                        _a.sent();
                        return [3 /*break*/, 16];
                    case 15:
                        log.info("Skipping linking for extracted war at dest=" + destination);
                        _a.label = 16;
                    case 16:
                        successes++;
                        return [3 /*break*/, 18];
                    case 17:
                        e_3 = _a.sent();
                        log.warn("Cannot add servlet for service=" + key + ", error=", e_3);
                        return [3 /*break*/, 18];
                    case 18: return [3 /*break*/, 20];
                    case 19:
                        log.warn("Cannot add servlet for service=" + key);
                        _a.label = 20;
                    case 20:
                        i++;
                        return [3 /*break*/, 2];
                    case 21:
                        if (successes > 0) {
                            log.info("About to tomcat, ID=" + this.id + ", URL=" + this.getBaseURL());
                            DOptionsArray = [
                                "shutdown.port=-1",
                                "https.port=" + this.config.https.port,
                                "https.key=" + this.config.https.key,
                                "https.certificate=" + this.config.https.certificate,
                                "appdir=" + this.appdir,
                                "java.io.tmpdir=" + this.appdir
                            ];
                            try {
                                tomcatProcess_1 = this.startViaJava(DOptionsArray);
                            }
                            catch (e) {
                                log.warn("Could not start tomcat, error=", e);
                                return [2 /*return*/];
                            }
                            this.status = "running";
                            this.tomcatProcess = tomcatProcess_1;
                            tomcatProcess_1.stdout.on('data', function (data) {
                                log.info(_this.getIdString() + " stdout=" + data);
                            });
                            tomcatProcess_1.stderr.on('data', function (data) {
                                log.warn(_this.getIdString() + " stderr=" + data);
                            });
                            onClose_1 = function (code) {
                                if (tomcatProcess_1.pid) {
                                    log.info(_this.getIdString() + " closed, code=" + code);
                                }
                                else {
                                    log.warn("Tomcat could not start. Closing. code=" + code);
                                }
                            };
                            tomcatProcess_1.on('close', onClose_1);
                            tomcatProcess_1.on('exit', function (code) {
                                if (tomcatProcess_1.pid) {
                                    log.info(_this.getIdString() + " exited, code=" + code);
                                }
                                else {
                                    log.warn("Tomcat could not start. Exiting. code=" + code);
                                }
                                tomcatProcess_1.removeListener('close', onClose_1);
                                _this.tomcatProcess = null;
                            });
                        }
                        else {
                            log.info("Tomcat for ID=" + this.id + " not starting, no services succeeded loading");
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    TomcatManager.prototype.stopForWindows = function () {
        var _this = this;
        if (this.tomcatProcess) {
            log.info(this.getIdString() + " Manager issuing sigterm");
            this.tomcatProcess.on('error', function (err) {
                log.warn(_this.getIdString() + " Error when stopping, error=" + err);
            });
            this.tomcatProcess.kill('SIGTERM');
        }
    };
    TomcatManager.prototype.stopForUnix = function () {
        var _this = this;
        var stopProcess;
        try {
            stopProcess = spawn(path.join(this.config.path, 'bin', 'catalina.sh'), ['stop', '-config', this.config.config], { env: {
                    "JAVA_OPTS": "-Dshutdown.port=-1 -Dhttps.port=" + this.config.https.port + " "
                        + ("-Dhttps.key=" + this.config.https.key + " ")
                        + ("-Dhttps.certificate=" + this.config.https.certificate + " ")
                        + ("-Dappdir=" + this.appdir),
                    "CATALINA_BASE": this.config.path,
                    "CATALINA_HOME": this.config.path,
                    "JRE_HOME": this.config.runtime.home,
                    "CATALINA_PID": path.join(this.appdir, 'tomcat.pid')
                } });
        }
        catch (e) {
            log.warn("Could not stop tomcat, error=", e);
            return;
        }
        stopProcess.stdout.on('data', function (data) {
            log.info(_this.getIdString() + " stdout=" + data);
        });
        stopProcess.stderr.on('data', function (data) {
            log.warn(_this.getIdString() + " stderr=" + data);
        });
        var onClose = function (code) {
            log.info(_this.getIdString() + " closed, code=" + code);
        };
        stopProcess.on('close', onClose);
        stopProcess.on('exit', function (code) {
            log.info(_this.getIdString() + " exited, code=" + code);
            _this.status = "stopped";
            stopProcess.removeListener('close', onClose);
            stopProcess = null;
        });
    };
    TomcatManager.prototype.stop = function () {
        var _this = this;
        log.info("Tomcat Manager ID=" + this.id + " stopping");
        TomcatManager.isWindows ? this.stopForWindows() : this.stopForUnix();
        return new Promise(function (resolve, reject) {
            rimraf(_this.appdir, function (error) {
                if (error) {
                    reject(error);
                }
                else {
                    log.info("Tomcat Manager ID=" + _this.id + " cleanup successful");
                    resolve();
                }
            });
        });
    };
    TomcatManager.prototype.getBaseURL = function () {
        return "https://localhost:" + this.config.https.port + "/";
    };
    TomcatManager.prototype.getURL = function (pluginId, serviceName) {
        var key = pluginId + ':' + serviceName;
        var warpath = this.services[key];
        if (warpath) {
            return this.getBaseURL() + key.replace(/:/g, "_") + "_" + path.basename(warpath, path.extname(warpath));
        }
        else {
            return null;
        }
    };
    TomcatManager.prototype.getServerInfo = function () {
        return {
            status: this.status,
            rootUrl: this.getBaseURL(),
            services: Object.keys(this.services)
        };
    };
    TomcatManager.prototype.getId = function () {
        return this.id;
    };
    /*
    private getWarName(dir: Path): Promise<string> {
      return new Promise(function(resolve, reject) {
        fs.readFile(path.join(dir, 'WEB-INF', 'web.xml'),function(err,data) {
          if (err) {
            reject(err);
          } else {
            const parser = new xml2js.Parser();
            parser.parseString(data, function(err, result) {
              if (err) {
                reject(err);
              } else {
  //              log.info(`webxml looks like=`,result);
                resolve(result['web-app']['display-name'][0]);
  
              }
            });
          }
        });
      });
    }
    */
    TomcatManager.prototype.extractWar = function (warpath, pluginKey) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var destRoot = _this.appdir;
            yauzl.open(warpath, { autoClose: true, lazyEntries: true }, function (err, zipfile) {
                if (err) {
                    if (zipfile) {
                        zipfile.close();
                    }
                    reject(err);
                }
                else {
                    var error_1 = undefined;
                    var destPath_1 = path.join(destRoot, pluginKey.replace(/:/g, '_') + '_' +
                        path.basename(warpath.substring(0, warpath.length - path.extname(warpath).length)));
                    zipfile.on("close", function () {
                        log.info("Extracted war to " + destPath_1);
                        if (error_1) {
                            reject(error_1);
                        }
                        else {
                            resolve(destPath_1);
                        }
                    });
                    zipfile.readEntry();
                    zipfile.on("entry", function (entry) {
                        if (entry.fileName.endsWith('/')) {
                            //directory
                            mkdirp(path.join(destPath_1, entry.fileName), { mode: DIR_WRITE_MODE }, function (err) {
                                if (err) {
                                    error_1 = err;
                                    zipfile.close();
                                }
                                else {
                                    zipfile.readEntry();
                                }
                            });
                        }
                        else if (entry.fileName == '.') {
                            zipfile.readEntry(); //TODO is it correct to skip this?
                        }
                        else {
                            //file
                            mkdirp(path.join(destPath_1, path.dirname(entry.fileName)), { mode: DIR_WRITE_MODE }, function (err) {
                                if (err) {
                                    error_1 = err;
                                    zipfile.close();
                                }
                                else {
                                    zipfile.openReadStream(entry, function (err, readStream) {
                                        if (err) {
                                            error_1 = err;
                                            zipfile.close();
                                        }
                                        else {
                                            log.debug("Writing: " + entry.fileName + ", Size=" + entry.uncompressedSize);
                                            var writeStream = fs.createWriteStream(path.join(destPath_1, entry.fileName), { mode: FILE_WRITE_MODE });
                                            writeStream.on("close", function () {
                                                log.debug("Wrote: " + entry.fileName);
                                                zipfile.readEntry();
                                            });
                                            readStream.pipe(writeStream);
                                        }
                                    });
                                }
                            });
                        }
                    });
                }
            });
        });
    };
    TomcatManager.prototype.isExtracted = function (warpath) {
        var dir = warpath.substring(0, warpath.length - path.extname(warpath).length);
        return new Promise(function (resolve, reject) {
            fs.stat(dir, function (err, stats) {
                if (err) {
                    if (err.code == 'ENOENT') {
                        return resolve(false);
                    }
                    else {
                        return reject(err);
                    }
                }
                else if (stats.isDirectory()) {
                    fs.stat(path.join(dir, 'WEB-INF', 'web.xml'), function (err, stats) {
                        if (err) {
                            return reject(err);
                        }
                        else if (stats.isFile()) {
                            return resolve(true);
                        }
                        else {
                            resolve(false);
                        }
                    });
                }
                else {
                    resolve(false);
                }
            });
        });
    };
    /* from given dir to our appbase dir
       dir is an extracted war dir
    */
    TomcatManager.prototype.makeLink = function (dir, destination) {
        if (TomcatManager.isWindows) {
            log.info("Making junction from " + dir + " to " + this.appdir);
        }
        else {
            log.info("Making symlink from " + dir + " to " + this.appdir);
        }
        return new Promise(function (resolve, reject) {
            fs.symlink(dir, destination, TomcatManager.isWindows ? 'junction' : 'dir', function (err) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    };
    TomcatManager.isWindows = process.platform === "win32";
    return TomcatManager;
}());
exports.TomcatManager = TomcatManager;
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
//# sourceMappingURL=tomcatManager.js.map