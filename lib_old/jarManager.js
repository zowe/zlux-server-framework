"use strict";
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
Object.defineProperty(exports, "__esModule", { value: true });
//import * as xml2js from 'xml2js';
var JarManager = /** @class */ (function () {
    function JarManager(config) {
        this.config = config;
        this.status = 'stopped';
        this.id = (Date.now() + Math.random()) * 10000; //something simple but not ugly for a dir name
        for (var i = 0; i < this.config.plugin.dataServices.length; i++) {
            if (this.config.plugin.dataServices[i] == this.config.serviceName) {
                this.service = this.config.plugin.dataServices[i];
                break;
            }
        }
        if (this.service.isHttps !== undefined) {
            this.url = this.service.isHttps === true ? "https://localhost:" + this.config.port + "/"
                : "http://localhost:" + this.config.port + "/";
        }
        else {
            this.url = "https://localhost:" + this.config.port + "/"; //but we need to confirm ASAP
        }
        this.processServiceParams();
    }
    JarManager.prototype.getId = function () {
        return this.id;
    };
    JarManager.prototype.start = function () {
        console.log("JarMgr with id=" + this.id + " invoked to startup with config=", this.config);
        var needTlsConfirmation = this.service.isHttps === undefined;
        return new Promise(function (resolve, reject) {
            /*
                  let process;
                  try {
                    if (this.config.service.optionsType === 'env') {
                    process = spawn(path.join(this.config.runtime.home, 'bin', JarManager.isWindows ?
                                              'java.exe' : 'java'), ['-jar', this.config.path],
                                    {env: {
                                      
                                    }});
                    }
                  }
            */
        });
    };
    JarManager.prototype.stop = function () {
        return new Promise(function (resolve, reject) {
        });
    };
    JarManager.prototype.getURL = function (pluginId, serviceName) {
        if (pluginId != this.config.plugin.identifier || serviceName != this.service.name) {
            return '';
        }
        else {
            return this.url;
        }
    };
    JarManager.prototype.getServerInfo = function () {
        return {
            status: this.status,
            rootUrl: this.url,
            services: [this.config.plugin.identifier + ":" + this.service.name]
        };
    };
    JarManager.prototype.processServiceParams = function () {
        //save reading of config file if any for later due to the  sync nature of constructor?
        /*
          TODOs: substitute and merge env
          descend into JAVA_OPTS if needed in env
          return env to use at spawn time
    
          substitute and merge args
          return args to use at spawn time
    
          substitute and merge file contents
          write out file contents to temp location if needed
         */
    };
    JarManager.isWindows = process.platform === "win32";
    return JarManager;
}());
exports.JarManager = JarManager;
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
//# sourceMappingURL=jarManager.js.map