import * as BBPromise from 'bluebird';
import * as path from 'path';
import { TomcatManager } from './tomcatManager';
import { Path, JavaConfig, WarConfig, AppServer, HttpsConfig, TomcatConfig, TomcatShutdown, TomcatHttps, JavaServerManager, ServerRef, JavaGroup } from './javaTypes';

const WAR_SERVICE_TYPE_NAME = 'java-war';
const JAR_SERVICE_TYPE_NAME = 'java-jar';

const DEFAULT_GROUPING = 'appserver';

export class JavaManager {
  private ports: Array<number>;
  private servers: Array<any>;
  constructor(private config: JavaConfig, private instanceDir: Path) {
    //process at this time, so that startAll() is ready to go
    this.config = config;
    this.processConfig();//validates & extracts... may throw
  }
  
  public async startAll() {
    for (let i = 0; i < this.servers.length; i++) {
      //start each by each specific manager within
      this.servers[i].start();
    }
  }

  public async stopAll() {
    for (let i = 0; i < this.servers.length; i++) {
      this.servers[i].stop();
    }
  }

  public registerPlugins(pluginDefs: any) {
    this.processWarGrouping(pluginDefs);
  }

  /**
     Returns info about how to connect to the service, provided the service is known to us
   */
  public getConnectionInfo(pluginId: string, serviceName: string) {

    for (let i = 0; i < this.servers.length; i++) {
      let server = this.servers[i];
      for (let j = 0; j < server.plugins.length; j++) {
        if (server.plugins[j].identifier == pluginId) {
          /*
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
            port: server.https.port
          };

        }
      }
    }
    //TODO
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
    
    this.servers = [];
    let portPos = 0;
    if (groupingConfig && Array.isArray(groupingConfig) && groupingConfig.length > 0) {
      for (let i = 0; i < groupingConfig.length; i++) {
        const group = groupingConfig[i];
        const port = this.getPortOrThrow(portPos);
        const server = this.makeServerFromGroup(group, port, remainingPlugins);
        if (server) {
          console.info(`TEST: server info=`,server.manager.getServerInfo());
          this.servers.push(server);
          portPos++;
        } else {
          console.warn(`No server returned for group=`,group);
        }
      }
    }

    let pluginKeys = Object.keys(remainingPlugins);
    switch (defaultBehavior) {
    case 'microservice':
      pluginKeys.forEach((key) => {
        const port = this.getPortOrThrow(portPos);
        const group = [remainingPlugins[key]];
        const server = this.makeServerFromGroup({plugins:group}, port, remainingPlugins);
        if (server) {
          this.servers.push(server);
          portPos++;
        } else {
          console.warn(`No server returned for group=`,group);
        }      
      });
      break;
    case 'appserver':
      let group = [];
      pluginKeys.forEach((key) => {
        group.push(remainingPlugins[key]);
      });
      const port = this.getPortOrThrow(portPos);
      const server = this.makeServerFromGroup({plugins:group}, port, remainingPlugins);
      if (server) {
        this.servers.push(server);
        portPos++;
      } else {
        console.warn(`No server returned for group=`,group);
      }      
      break;
    default:
      console.warn(`Unknown default behavior=${defaultBehavior}`);
    }
  }

  private getPortOrThrow(pos: number) {
    const port = this.ports[pos];
    if (port === undefined) {
      throw new Error(`Could not find port to use for configuration, at config position=${pos}`);
    }
    return port;
  }

  private makeServerFromGroup(group: JavaGroup, port: number, remainingPlugins: any): ServerRef | undefined {
    //Big TODO: whats the behavior of our throws... we should allow plugins to succeed if they are unaffected
    //by other plugins
    if (!group.java) {
      //TODO should this really be a map... for this reason?
      group.java = Object.keys(this.config.runtimes)[0];
    };
    let runtime = this.config.runtimes[group.java];
    if (!runtime) {
      throw new Error(`Could not find runtime to satisfy group: ${group.java}`);
    }
    let plugins = group.plugins;
    if (Array.isArray(plugins) && plugins.length > 0) {
      let groupArray = [];
      for (let j = 0; j < plugins.length; j++) {
        let plugin = remainingPlugins[plugins[j]];
        if (plugin) {
          groupArray.push(plugin);
          remainingPlugins[plugins[j]] = undefined;
        } else {
          console.warn(`Services for plugin=${plugins[j]} could not be included in war grouping. `
                       + `Plugin missing or already grouped`);          
        }
      }
      if (groupArray.length > 0) {
        let serverManager = this.makeAppServer(groupArray, runtime, port);
        return {type:"appserver", url: serverManager.getServerInfo().rootUrl,
                plugins: groupArray, manager:serverManager};
      }
    } else {
      console.warn(`Skipping invalid plugin group=`,plugins);
    }
  }

  //TODO how do i have type extensions to return something better than any
  //group is composed of plugins. the plugins may contain 0 services that this server can handle. validate within here
  private makeAppServer(group: Array<any>, runtime: any, port: number): JavaServerManager {
    const serverConfigBase = this.config.war.javaAppServer;
    switch (serverConfigBase.type) {
    case 'tomcat':
      let joinedConfig = (Object as any).assign({
        shutdown: {port: -1},
        runtime: runtime,
        plugins: group,
      }, serverConfigBase);
      joinedConfig.https.port = port;
      if (!joinedConfig.appRootDir) {
        //may need to be created later
        joinedConfig.appRootDir = path.join(this.instanceDir, 'ZLUX', 'languageManagers', 'java', 'tomcat');
      }
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
      let JAVA_HOME = process.env.JAVA_HOME;
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

