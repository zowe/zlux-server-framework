
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/


import * as Promise from 'bluebird';
export type Path = string;


export type JavaConfig = {
  war?: WarConfig
  jar?: any //no idea what goes here if anything... should just utilize global and java configs
  //will assign war ports before jar.
  portRange?: Array<number>; //[2000,2100] gives 2000 through 2100
  ports?: Array<number>; //[2000, 2002] gies 2000 and 2002 but not 2001
  //must have EITHER portRange OR ports. Will prefer portRange if both found.
  //will use env vars if not specified...
  runtimes?: { [name: string]: JavaDefinition };
}

export type JavaDefinition = {
  home: Path;
  //bin
  //lib
}

export type JarConfig = {
  port: number;
  plugin: any; //whole plugindef needed for name, version, location
  serviceName: string; //plugin needs to be sliced up
  serviceSettings?: any; //from configservice _internal
  runtime: JavaDefinition;
  tempDir: Path; //for writing out config files if needed
  zluxUrl: string; //set by server at runtime
}

export type WarConfig = {
  javaAppServer: AppServer;
  defaultGrouping?: string; // 'microservice', 'appserver'... determines 1-for-1 or many-for-1 tomcat grouping
  pluginGrouping?: Array<JavaGroup>; //extract JavaGroup for an individual tomcat server to act upon
}

export type JavaGroup = {
  //if not specified, first list is used. if no list given, env vars are used
  java?: string;
  plugins: Array<string>;
}

export type AppServer = {
  type: string; //right now... tomcat
  path: Path; //default: path to zowe bundled tomcat
  config: Path; //path to server config file... config.xml for tomcat for example
  https: HttpsConfig;
  //POSSIBLY need to determine shutdown port here. Open question on if we need this ability of tomcat or can disable it. Starting with disabling it.
  zluxUrl: string; //set by server at runtime
}

export type HttpsConfig = {
  key: Path;
  certificate?: Path;
  certificateChain?: Path; //Is this PFX?
}

export type TomcatConfig = {
  path: Path; //path to a tomcat... if not the one zowe includes
  config: Path; //path to a config.xml for tomcat.... this COULD be written in JSON and transformed into XML, but...
  logProperties: Path;
  https: TomcatHttps;
  shutdown: TomcatShutdown;
  appRootDir: Path; //the dir in which "appBase" dirs will be made on the fly
  //list given by zlux app server already having determined
  plugins: Array<any>;//pluginDefinitions with location included
  runtime: JavaDefinition;
  zluxUrl: string; //set by server at runtime
}

export type TomcatShutdown = {
  port: number; //-1 means disable. If unspecified, we will default to -1.
}

export type TomcatHttps = {
  port: number;
  key: Path;
  certificate?: Path;
  certificateChain?: Path;
}

export type ServerRef = {
  type: string; //appserver, microservice
  url: string;
  port: number;
  plugins: Array<any>; //which plugins were requested to be within? single for microservice
  manager: JavaServerManager;
}

//jar manager or app service manager
export interface JavaServerManager {
  getId(): number;
  start(): Promise<any>;
  stop(): Promise<any>;
  getURL(pluginId: string, serviceName: string): string;
  getServerInfo(): AppServerInfo;
}

export type AppServerInfo = {
  status: string;
  rootUrl: string;
  //format: pluginid:servicename, as zlux does
  services: Array<string>;
}

export interface LangManager {
  startAll(): Promise<any>;
  stopAll(): Promise<any>;
  registerPlugins(pluginDefs: any);
  getConnectionInfo(pluginId: string, serviceName: string, serviceType: string): any;
  getSupportedTypes(): Array<string>;
  /* Future ideas
  addPlugin();
  removePlugin();
  start();
  stop();
  */  
}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
