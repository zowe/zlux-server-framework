
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/


/*
Ideas: 
- springboot can be started with arguments and configuration file (yaml)
- need a way to know where the server is starting, so that we can talk to it
- peek into args and config file to determine the values we can set/use for connecting

substitutable and non-substitutable arguments to use when running the jar
      "args": [],

subsitutable and non-substitutable arguments to use when running the jar
      "env": {},

name of the config file (as seen from config service _internal)
      "configFile": "server.yaml",

parameter name for finding config file... if configfile given, configname could be set to it
      "configName": "server.config",

parameter name for inputting the port we will use
      "portName": "server.port",

parameter name to tell US if the config is defaulting to security on/off
      "isHttps": true,

parameter name to tell us how options we set should be set
can be "arg", "env", "java_opts", or "config"
      "optionsType": "arg",


THE BIG IDEA:
we just need to be able to reach the server, not care about its security settings.
we can try both HTTP & HTTPS to autodetect at the port we expect
we can retry for up to a minute in case the jar takes a while to start via
      "startupWaitSec": 60,
which uses 5 second intervals for the check


other idea:
we can peer into the jar to determine if the xmls have the signature of spring or some other known server type






unused ideas (if we are to do fine-grained control):

parameter name for setting security on
      "tlsName": "server.ssl",

parameter name for setting level of security. if it matches tlsname, tlsname will be used instead
      "tlsLevelName": "server.ssl"

parameter name for setting good ciphers
      "ciphersName": "server.ciphers",

parameter name for setting server cert
      "certName": "server.cert",

parameter name for setting server key
      "keyName": "server.key",


*/

import { Path, JarConfig, JavaServerManager, AppServerInfo } from './javaTypes';
//import * as xml2js from 'xml2js';

export class JarManager implements JavaServerManager {
  private url: string;
  private status: string = 'stopped';
  private id: number;
  private process: any;
  private static isWindows: boolean = process.platform === `win32`;
  private service: any;
  constructor(private config: JarConfig) {
    this.id = (Date.now()+Math.random())*10000;//something simple but not ugly for a dir name
    
    for (let i = 0; i < this.config.plugin.dataServices.length; i++) {
      if (this.config.plugin.dataServices[i] == this.config.serviceName) {
        this.service = this.config.plugin.dataServices[i];
        break;
      }
    }
    
    if (this.service.isHttps !== undefined) {
      this.url = this.service.isHttps === true ? `https://localhost:${this.config.port}/`
        : `http://localhost:${this.config.port}/`;
    } else {
      this.url = `https://localhost:${this.config.port}/`; //but we need to confirm ASAP
    }
    this.processServiceParams();
  }

  getId(): number {
    return this.id;
  }

  start(): Promise<any> {
    console.log(`JarMgr with id=${this.id} invoked to startup with config=`,this.config);
    let needTlsConfirmation = this.service.isHttps === undefined;
    return new Promise((resolve,reject)=> {
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
  }

  stop(): Promise<any> {
    return new Promise((resolve,reject)=> {
      
    });
  }

  getURL(pluginId, serviceName):string {
    if (pluginId != this.config.plugin.identifier || serviceName != this.service.name) {
      return '';
    } else {
      return this.url;
    }
  }

  getServerInfo(): AppServerInfo {
    return {
      status: this.status,
      rootUrl: this.url,
      services: [`${this.config.plugin.identifier}:${this.service.name}`]
    };
  }

  private processServiceParams() {
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
  }
}


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
