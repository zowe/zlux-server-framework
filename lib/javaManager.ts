
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

import * as BBPromise from 'bluebird';
import * as path from 'path';
import { TomcatManager } from './tomcatManager';
import { Path, JavaConfig, WarConfig, AppServer, HttpsConfig, TomcatConfig, TomcatShutdown, TomcatHttps, JavaServerManager, ServerRef, JavaGroup, JavaDefinition } from './javaTypes';
import { JarManager } from './jarManager';
import * as utils from './util';

const log = utils.loggers.langManager;

const WAR_SERVICE_TYPE_NAME = 'java-war';
const JAR_SERVICE_TYPE_NAME = 'java-jar';

const DEFAULT_GROUPING = 'appserver';


export class JavaManager {
  private ports: Array<number>;
  private portPos: number = 0;
  private servers: Array<any> = new Array<any>();
  private static supportedTypes: Array<string> = [WAR_SERVICE_TYPE_NAME, JAR_SERVICE_TYPE_NAME];
  constructor(private config: JavaConfig, private instanceDir: Path, private zluxUrl: string) {
    //process at this time, so that startAll() is ready to go
    this.config = config;
    this.processConfig();//validates & extracts... may throw
  }

  public getSupportedTypes() : Array<string> {
    return JavaManager.supportedTypes;
  }
  
  public async startAll() {
    for (let i = 0; i < this.servers.length; i++) {
      //start each by each specific manager within
      await this.servers[i].manager.start();
    }
  }

  public async stopAll() {
    for (let i = 0; i < this.servers.length; i++) {
      try {
        await this.servers[i].manager.stop();
      } catch (e) {
        log.warn(`Could not stop manager, error=`,e);
      }
    }
  }

  public registerPlugins(pluginDefs: any) {
    this.processWarGrouping(pluginDefs);
//    this.processJars(pluginDefs);
  }

  /**
     Returns info about how to connect to the service, provided the service is known to us
   */
  public getConnectionInfo(pluginId: string, serviceName: string, serviceType: string) {

    for (let i = 0; i < this.servers.length; i++) {
      let server = this.servers[i];
      for (let j = 0; j < server.plugins.length; j++) {
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
  }

  private containsCompatibleService(services: Array<any>|undefined, type?:string): boolean {
    const supportedTypes = type ? [type] : JavaManager.supportedTypes;
    if (!services) {
      return false;
    }
    for (let i = 0; i < services.length; i++) {
      if (supportedTypes.indexOf(services[i].type) !=-1) {
        return true;
      }
    }
    return false;
  }

  private processPorts() {
    const config = this.config;
    if (config.portRange && Array.isArray(config.portRange) && config.portRange.length == 2) {
      const start = config.portRange[0];
      const finish = config.portRange[1];
      if (start < 0 || finish > 65535 || finish < start) {
        throw new Error(`JavaManager given port range beyond limits`);
      }
      this.ports = new Array(finish-start+1);
      let j = 0;
      for (let i = start; i < finish+1; i++) {
        this.ports[j++] = i;
      }
    } else if (config.ports && Array.isArray(config.ports) && config.ports.length != 0) {
      this.ports = config.ports;
    } else {
      throw new Error(`JavaManager not given any ports with which to run servers`);
    }
  }

  private processJars(pluginDefs: any) {
    let jarRuntimes = this.config.jar.runtimeMapping;
    let remainingPlugins = {};
    const defaultRuntimeName = Object.keys(this.config.runtimes)[0];
    const defaultRuntime = this.config.runtimes[defaultRuntimeName];
    pluginDefs.forEach((pluginDef) => {
      remainingPlugins[pluginDef.identifier] = pluginDef;
    });
    pluginDefs.forEach((plugin)=> {
      if (plugin.dataServices) {
        plugin.dataServices.forEach((service)=> {
          if (service.type === JAR_SERVICE_TYPE_NAME) {
            let runtimeName = jarRuntimes[plugin.identifier];
            if (!runtimeName) {
              const id = `${plugin.identifier}:${service.name}`;
              runtimeName = jarRuntimes[id];
              if (!runtimeName) {
                runtimeName = defaultRuntimeName;
              }
            }
            const port = this.getPortOrThrow();
            const manager = this.makeJarManager(plugin, service.name, port,
                                                this.config.runtimes[runtimeName]);
            if (manager) {
              this.portPos++;
              this.servers.push({type:"microservice", url: manager.getServerInfo().rootUrl,
                                plugins: [plugin], manager: manager, port: port});
            }
          }
        });
      }
    });
  }

  /**
     tolerates & warns on missing plugins, warns on plugin referenced without any war service within
  */
  private processWarGrouping(pluginDefs: any) {
    const groupingConfig = this.config.war.pluginGrouping;
    let defaultBehavior = this.config.war.defaultGrouping ? this.config.war.defaultGrouping :  DEFAULT_GROUPING;
    if (defaultBehavior != 'microservice' && defaultBehavior != 'appserver') {
      throw new Error(`Unknown java war grouping default=${defaultBehavior}`);
    }

    let remainingPlugins = {};
    pluginDefs.forEach((pluginDef) => {
      remainingPlugins[pluginDef.identifier] = pluginDef;
    });
    
    if (groupingConfig && Array.isArray(groupingConfig) && groupingConfig.length > 0) {
      for (let i = 0; i < groupingConfig.length; i++) {
        const group = groupingConfig[i];
        const port = this.getPortOrThrow();
        const server = this.makeServerFromGroup(group, port, remainingPlugins);
        if (server) {
          this.servers.push(server);
          this.portPos++;
        } else {
          log.warn(`No server returned for group=`,group);
        }
      }
    }

    let pluginKeys = Object.keys(remainingPlugins);
    switch (defaultBehavior) {
    case 'microservice':
      pluginKeys.forEach((key) => {
        const port = this.getPortOrThrow();
        const group = [key];
        const server = this.makeServerFromGroup({plugins:group}, port, remainingPlugins);
        if (server) {
          this.servers.push(server);
          this.portPos++;
        }    
      });
      break;
    case 'appserver':
      const port = this.getPortOrThrow();
      const server = this.makeServerFromGroup({plugins:pluginKeys}, port, remainingPlugins);
      if (server) {
        this.servers.push(server);
        this.portPos++;
      }    
      break;
    default:
      log.warn(`Unknown default behavior=${defaultBehavior}`);
    }
  }

  private getPortOrThrow() {
    const port = this.ports[this.portPos];
    if (port === undefined) {
      throw new Error(`Could not find port to use for configuration, at config position=${this.portPos}`);
    }
    return port;
  }

  //TODO how are we getting runtime info down to here, and at the high end should services really be allowed
  //to depend on different runtimes, or is it plugin-wide?
  private makeJarManager(plugin: any, serviceName: string,
                         port: number, runtime: JavaDefinition): JavaServerManager {
    if (!plugin.dataServices) return undefined;

    let service;
    for (let i = 0; i < plugin.dataServices.length; i++) {
      if (plugin.dataServices[i].name == serviceName) {
        service = plugin.dataServices[i];
       }
    }
    
    if (service) {
      let config = {
        port: port,
        plugin: plugin,
        serviceName: serviceName,
        runtime: runtime,
        tempDir: 'TODO',
        zluxUrl: this.zluxUrl
      }
      return new JarManager(config);
    }
    return undefined;
  }

  private makeServerFromGroup(group: JavaGroup, port: number, remainingPlugins: any): ServerRef | undefined {
    let java = group.java;
    if (!java) {
      //TODO should this really be a map... for this reason?
      java = Object.keys(this.config.runtimes)[0];
    };
    let runtime = this.config.runtimes[java];
    if (!runtime) {
      throw new Error(`Could not find runtime to satisfy group: ${java}`);
    }
    let plugins = group.plugins;
    if (Array.isArray(plugins) && plugins.length > 0) {
      let groupArray = [];
      for (let j = 0; j < plugins.length; j++) {
        let plugin = remainingPlugins[plugins[j]];
        if (plugin) {
          if (this.containsCompatibleService(plugin.dataServices, WAR_SERVICE_TYPE_NAME)) {
            groupArray.push(plugin);
          }
          remainingPlugins[plugins[j]] = undefined;
        } else {
          log.warn(`Services in plugin=${plugins[j]} war grouping skipped. `
                       + `Plugin missing or already grouped`);
        }
      }
      if (groupArray.length > 0) {
        let serverManager = this.makeAppServer(groupArray, runtime, port);
        return {type:"appserver", url: serverManager.getServerInfo().rootUrl,
                plugins: groupArray, manager:serverManager, port: port};
      }
    } else {
      log.warn(`Skipping invalid plugin group=`,plugins);
    }
  }

  //TODO how do i have type extensions to return something better than any
  //group is composed of plugins. the plugins may contain 0 services that this server can handle. validate within here
  private makeAppServer(group: Array<any>, runtime: any, port: number): JavaServerManager {
    const serverConfigBase = this.config.war.javaAppServer;
    switch (serverConfigBase.type) {
    case 'tomcat':
      let joinedConfig: any = Object.assign({
        shutdown: {port: -1},
        runtime: runtime,
        plugins: group,
      }, serverConfigBase);
      joinedConfig.https = Object.assign({port: port}, joinedConfig.https);
      if (!joinedConfig.appRootDir) {
        //may need to be created later
        joinedConfig.appRootDir = path.join(this.instanceDir, 'ZLUX', 'languageManagers', 'java', 'tomcat');
      }
      joinedConfig.zluxUrl = this.zluxUrl;
      return new TomcatManager(joinedConfig);
    default:
      throw new Error(`Unknown java app server type=${serverConfigBase.type} specified in config. `
                      + `Cannot continue with java loading`);
    }
  }

  private processRuntimes() {
    const config = this.config;
    if (config.runtimes) {
      return; //TODO what more validation should we do here
    } else {
      //find from path
      let JAVA_HOME = process.env.ZOWE_JAVA_HOME ? process.env.ZOWE_JAVA_HOME : process.env.JAVA_HOME;
      if (!JAVA_HOME) {
        throw new Error(`Java runtimes not specified, and no JAVA_HOME set`);
      }
      this.config.runtimes = {"default": {"home": JAVA_HOME}};
    }
  }
  
  private processConfig() {
    const config = this.config;
    this.processRuntimes();
    if (config.war) {
      if (!config.war.javaAppServer) {
        throw new Error(`Java app server not defined in config`);
      }      
    } else if (!config.war && !config.jar) {
      throw new Error(`JavaManager not given either war or jar configuration options, nothing to do`);
    }
    this.processPorts();
  }
}


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
