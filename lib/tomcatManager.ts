/*
catalina.bat start -config \conf\server_test.xml

set "JAVA_OPTS=-Dport.shutdown=8005 -Dport.http=8080"
bin\startup.bat


ideas:
1. make a temp dir for an instance of tomcat to find wars in
2. use symbolic links so that the dir that holds the war contents doesnt actually require any copying
3. tomcat unpacks wars to some temp dir of their own if you allow it to. instead, let's have the zlux app installer
unpack the wars ahead of time, so the symbolic links are the unpacked dirs
4. disable tomcat rest apis for management so that the tomcat we have is secure (no room to add or remove services except by disk)
5. one day, write a zss plugin to tomcat so that its rest apis for management use auth checks against saf through zss

*/

/*
  grouping modes:
1. default for those unspecified
a. all-in-one
b. all-individual

2. for those specified
b. allow for multiple groups
ex.
javaWarGroups: [
  ["com.rs.a"],
  ["com.rs.b","com.rs.c"]
]

a plugin cant be mentioned twice, and you can't split a plugin

port range: upper-level config needs a range of ports. 

*/

import { Path, TomcatConfig, TomcatShutdown, TomcatHttps, JavaServerManager, AppServerInfo } from './javaTypes';
import * as BBPromise from 'bluebird';
import * as fs from 'fs';
import * as path from 'path';

export class TomcatManager implements JavaServerManager {
  private id: number;
  constructor(private config: TomcatConfig) {
    this.id = (Date.now()+Math.random())*10000;//something simple but not ugly for a dir name
  }

  public start() {
    //make folder, make links, start server
  }

  public stop() {
    //stop server, delete links, delete dir
  }

  public getURL(): string {
    return `https://localhost:${this.config.https.port}/`;
  }

  public getServerInfo(): AppServerInfo {
    return {
      status: 'disconnected',
      rootUrl: this.getURL(),
      services: []
    };
  }

  public getId() {
    return this.id;
  }

  /* from given warpath to our appbase dir 
     warpath can be an extracted war dir, or a .war
  */
  private makeLink(warpath: string) {
    let destination = this.config.appRootDir;

    return BBPromise((resolve, reject)=> {
      fs.link(warpath, path.join(destination,path.basename(warpath)), (err)=> {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
