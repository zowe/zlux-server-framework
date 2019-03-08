
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/


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
import * as fs from 'fs';
import * as path from 'path';
import * as mkdirp from 'mkdirp';
import * as child_process from 'child_process';

const spawn = child_process.spawn;

export class TomcatManager implements JavaServerManager {
  private id: number;
  private services: {[name:string]: Path} = {};
  private status: string = "disconnected";
  constructor(private config: TomcatConfig) {
    this.id = (Date.now()+Math.random())*10000;//something simple but not ugly for a dir name
    this.config.plugins.forEach((plugin)=> {
      let services = plugin.dataServices;
      services.forEach((service)=> {
        if (service.type == 'java-war') {
          let serviceid = plugin.identifier+':'+service.name;
          let warpath = path.join(plugin.location,'lib',service.filename);
          console.log(`Tomcat Manager found service=${serviceid}, war=${warpath}`);
          this.services[serviceid] = warpath;
        }
      });
    });
  }

  public start(): Promise<any> {
    //make folder, make links, start server
    console.log(`Tomcat with id=${this.id} invoked to startup with config=`,this.config);
    return new Promise<any>((resolve, reject) => {
      mkdirp(path.join(this.config.appRootDir,''+this.id), (err)=> {
        if (err) {
          reject();
        } else {
          //TODO should probably extract rather than let tomcat do it, since its a bit dumb with versioning
          //TODO what's the value of knowing the serviceid if the war can have a completely different name?
          //TODO extract WEB-INF/web.xml from war, read display-name tag to find out its runtime name
          Object.keys(this.services).forEach((key)=> {
            await this.makeLink(this.services[key]);
          });
    var initExternalProcess = function() {
      t.writeToLog('About to spawn class=' + TepQueryHandler.javaClassname
          + ', with classpath=' + t.javaClasspath);
      var queryServer = spawn('catalina.bat', [ 'start',  '-config', this.config.config]);
      t.queryServer = queryServer;
      queryServer.stdout.on('data', function(data) {
        if (t.logJava) {
          t.writeToLog('[class='+TepQueryHandler.javaClassname+' stdout]: '+data);
        }
      });

      queryServer.stderr.on('data', function(data) {
        if (t.logJava) {
          t.writeToLog('[class='+TepQueryHandler.javaClassname+' stderr]: '+data);
        }
      });

      queryServer.on('close', function(code) {
        t.writeToLog('[class='+TepQueryHandler.javaClassname+'] exited, code: '+code);
        t.writeToLog('shutting down process');
        t.ready = false;
        //TODO restart?
      });          
        }
      });
    });
  }

  public stop() {
    //stop server, delete links, delete dir
  }

  public getURL(): string {
    return `https://localhost:${this.config.https.port}/`;
  }

  public getServerInfo(): AppServerInfo {
    return {
      status: this.status,
      rootUrl: this.getURL(),
      services: Object.keys(this.services)
    };
  }

  public getId() {
    return this.id;
  }

  /* from given warpath to our appbase dir 
     warpath can be an extracted war dir, or a .war
  */
  private makeLink(warpath: string): Promise<any> {
    let destination = this.config.appRootDir;

    return Promise((resolve, reject)=> {
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

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
