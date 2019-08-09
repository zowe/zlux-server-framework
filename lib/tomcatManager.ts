
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/


/*
ideas:
3. tomcat unpacks wars to some temp dir of their own if you allow it to. instead, let's have the zlux app installer
unpack the wars ahead of time, so the symbolic links are the unpacked dirs
4. disable tomcat rest apis for management so that the tomcat we have is secure (no room to add or remove services except by disk)
5. one day, write a zss plugin to tomcat so that its rest apis for management use auth checks against saf through zss
*/

import { Path, TomcatConfig, TomcatShutdown, TomcatHttps, JavaServerManager, AppServerInfo } from './javaTypes';
import * as fs from 'graceful-fs';
import * as path from 'path';
import * as mkdirp from 'mkdirp';
import * as child_process from 'child_process';
//import * as xml2js from 'xml2js';
import * as yauzl from 'yauzl';
import * as utils from './util';
import * as rimraf from 'rimraf';

const log = utils.loggers.langManager;
const spawn = child_process.spawn;
const FILE_WRITE_MODE = 0o600;
const DIR_WRITE_MODE = 0o700;

export class TomcatManager implements JavaServerManager {
  private id: number;
  private services: {[name:string]: Path} = {};
  private status: string = "stopped";
  private tomcatProcess: any;
  private static isWindows: boolean = process.platform === `win32`;
  private appdir:string;
  
  constructor(private config: TomcatConfig) {
    this.id = (Date.now()+Math.random())*10000;//something simple but not ugly for a dir name
    this.appdir = path.join(this.config.appRootDir,''+this.id);
    this.config.plugins.forEach((plugin)=> {
      let services = plugin.dataServices;
      services.forEach((service)=> {
        if (service.type == 'java-war') {
          let serviceid = plugin.identifier+':'+service.name;
          let warpath = path.join(plugin.location,'lib',service.filename);
          log.info(`Tomcat Manager ID=${this.id} found service=${serviceid}, war=${warpath}`);
          this.services[serviceid] = warpath;
        }
      });
    });
  }

  private getIdString(): string {
    return `Tomcat PID=${this.tomcatProcess.pid}:`;
  }

  private makeRoot():Promise<void> {
    return new Promise((resolve,reject)=> {
      mkdirp(this.appdir, {mode: DIR_WRITE_MODE}, (err)=> {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  public startViaCatalinaShell(DOptionsArray: Array<string>) {
    const opts = '-D'+DOptionsArray.join(' -D');
    const env = { "JAVA_OPTS": opts,
                  "CATALINA_BASE": this.config.path,
                  "CATALINA_HOME": this.config.path,
                  "JRE_HOME": this.config.runtime.home,
                  "CATALINA_PID": path.join(this.appdir,'tomcat.pid'),
                  "ZOWE_ZLUX_URL": this.config.zluxUrl };
    const catalina = path.join(this.config.path, 'bin', 'catalina.sh');
    const args = [ 'run',  '-config', this.config.config];
    log.info(`Starting tomcat with params:\n`
             + `Catalina: ${catalina}\n`
             + `Args: ${JSON.stringify(args)}\n`
             + `Env: ${JSON.stringify(env)}`); 
    return spawn(catalina,
                 args,
                 {env: env});
  }

  public startViaJava(DOptionsArray: Array<string>) {
    let seperator = (TomcatManager.isWindows ? ';' : ':');
    let classPath = `${path.join(this.config.path, 'bin')}`
      + seperator
      + `${path.join(this.config.path, 'bin', 'bootstrap.jar')}`
      + seperator
      + `${path.join(this.config.path, 'bin', 'tomcat-juli.jar')}`;
    DOptionsArray = DOptionsArray.map(str => '-D'+str).concat(
      [ '-Djava.util.logging.manager=org.apache.juli.ClassLoaderLogManager',
        '-Djdk.tls.ephemeralDHKeySize=2048',
        '-Djava.protocol.handler.pkgs=org.apache.catalina.webresources',
        '-Dignore.endorsed.dirs=""',
        '-classpath',
        classPath,
        'org.apache.catalina.startup.Bootstrap',
        '-config', this.config.config, 'start']);
    const env = { "CLASSPATH": classPath,
                  "CATALINA_BASE": this.config.path,
                  "CATALINA_HOME": this.config.path,
                  "JRE_HOME": this.config.runtime.home,
                  "JAVA_HOME": this.config.runtime.home,
                  "ZOWE_ZLUX_URL": this.config.zluxUrl };
    const javaPath = path.join(this.config.runtime.home, 'bin', 'java');
    const cwd = path.join(this.config.path, 'bin');
    log.info(`Starting tomcat with params:\n`
             + `Java=${javaPath}\n`
             + `Options=${JSON.stringify(DOptionsArray)}\n`
             + `Env=${JSON.stringify(env)}\n`
             + `cwd=${cwd}`);
    return spawn(javaPath,
                 DOptionsArray,
                 {env: env,
                  cwd: cwd
                 });
  }

  public async start() {
    //make folder, make links, start server
    log.info(`Tomcat Manager with id=${this.id} invoked to startup with config=`,this.config);
    await this.makeRoot();
    //TODO should probably extract rather than let tomcat do it, since its a bit dumb with versioning
    //TODO what's the value of knowing the serviceid if the war can have a completely different name?
    //TODO extract WEB-INF/web.xml from war, read display-name tag to find out its runtime name
    
    let successes = 0;
    const keys = Object.keys(this.services);
    for (let i = 0; i < keys.length; i++) {
      let key = keys[i];
      let warpath = this.services[key];
      let dir;
      try {
        let preextracted = await this.isExtracted(warpath);
        if (!preextracted) {
          try {
            dir = await this.extractWar(warpath, key);
          } catch (e) {
            log.warn(`Could not extract war for service=${key}, error=`,e);
          }
        } else {
          dir = warpath.substring(0,warpath.length-path.extname(warpath).length);
        }
      } catch (e) {
        log.warn(`Could not access files to determine status for service=${key}, error=`,e);
      }
      if (dir) {
        try {
          let servletname = path.basename(dir);
          log.info(`Service=${key} has Servlet name=${servletname}`);
          const destination = path.join(this.appdir,
                                        key.replace(/:/g,'_')+'_'+
                                        path.basename(
                                          warpath.substring(0,warpath.length-path.extname(warpath).length)));
          if (dir != destination) {
            await this.makeLink(dir, destination);
          } else {
            log.info(`Skipping linking for extracted war at dest=${destination}`);
          }
          successes++;
        } catch (e) {
          log.warn(`Cannot add servlet for service=${key}, error=`,e);
        }
      } else {log.warn(`Cannot add servlet for service=${key}`);}

    }
    if (successes > 0) {
      log.info(`About to tomcat, ID=${this.id}, URL=${this.getBaseURL()}`);

      let DOptionsArray = [
        `shutdown.port=-1`,
        `https.port=${this.config.https.port}`,
        `https.key=${this.config.https.key}`,
        `https.certificate=${this.config.https.certificate}`,
        `appdir=${this.appdir}`,
        `java.io.tmpdir=${this.appdir}`
      ];
      let tomcatProcess;
      try {
        tomcatProcess = this.startViaJava(DOptionsArray);
      } catch (e) {
        log.warn(`Could not start tomcat, error=`,e);
        return;
      }
      this.status = "running";
      this.tomcatProcess = tomcatProcess;
      tomcatProcess.stdout.on('data', (data)=> {
        log.info(`${this.getIdString()} stdout=${data}`);
      });

      tomcatProcess.stderr.on('data', (data)=> {
        log.warn(`${this.getIdString()} stderr=${data}`);
      });

      let onClose = (code)=> {
	if (tomcatProcess.pid) {
          log.info(`${this.getIdString()} closed, code=${code}`);
        } else {
          log.warn(`Tomcat could not start. Closing. code=${code}`);
        }
      };

      tomcatProcess.on('close', onClose);

      tomcatProcess.on('exit', (code)=> {
	if (tomcatProcess.pid) {
          log.info(`${this.getIdString()} exited, code=${code}`);
        } else {
          log.warn(`Tomcat could not start. Exiting. code=${code}`);
        }
        tomcatProcess.removeListener('close', onClose);
        this.tomcatProcess = null;
      });

     
    } else {
      log.info(`Tomcat for ID=${this.id} not starting, no services succeeded loading`);
    }
  }

  private stopForWindows(){
    if (this.tomcatProcess) {
      log.info(`${this.getIdString()} Manager issuing sigterm`);
      this.tomcatProcess.on('error', (err)=> {
        log.warn(`${this.getIdString()} Error when stopping, error=${err}`);
      });
      this.tomcatProcess.kill('SIGTERM');
    }
  }

  private stopForUnix() {
    let stopProcess;
    try {
      stopProcess = spawn(path.join(this.config.path, 'bin', 'catalina.sh'),
            [ 'stop',  '-config', this.config.config],
            {env: {
              "JAVA_OPTS":
              `-Dshutdown.port=-1 -Dhttps.port=${this.config.https.port} `
                +`-Dhttps.key=${this.config.https.key} `
                +`-Dhttps.certificate=${this.config.https.certificate} `
                +`-Dappdir=${this.appdir}`,
              "CATALINA_BASE": this.config.path,
              "CATALINA_HOME": this.config.path,
              "JRE_HOME": this.config.runtime.home,
              "CATALINA_PID": path.join(this.appdir,'tomcat.pid')
            }});
    } catch (e) {
      log.warn(`Could not stop tomcat, error=`,e);
      return;
    }
    stopProcess.stdout.on('data', (data)=> {
      log.info(`${this.getIdString()} stdout=${data}`);
    });

    stopProcess.stderr.on('data', (data)=> {
      log.warn(`${this.getIdString()} stderr=${data}`);
    });
    
    let onClose = (code)=> {
      log.info(`${this.getIdString()} closed, code=${code}`);
    };
    stopProcess.on('close', onClose);

    stopProcess.on('exit', (code)=> {
      log.info(`${this.getIdString()} exited, code=${code}`);              
      this.status = "stopped";
      stopProcess.removeListener('close', onClose);
      stopProcess = null;
    });

  }

  public stop(): Promise<any> {
    log.info(`Tomcat Manager ID=${this.id} stopping`);
    TomcatManager.isWindows ? this.stopForWindows() : this.stopForUnix();
    return new Promise((resolve, reject) => {
      rimraf(this.appdir, (error)=> {
        if (error) {
          reject(error);
        } else {
          log.info(`Tomcat Manager ID=${this.id} cleanup successful`);
          resolve();
        }
      })
    });
  }

  private getBaseURL(): string {
    return `https://localhost:${this.config.https.port}/`;
  }

  public getURL(pluginId: string, serviceName: string) {
    let key = pluginId+':'+serviceName;
    let warpath = this.services[key];
    if (warpath) {
      return this.getBaseURL()+key.replace(/:/g,"_")+"_"+path.basename(warpath,path.extname(warpath));
    } else {
      return null;
    }
  }

  public getServerInfo(): AppServerInfo {
    return {
      status: this.status,
      rootUrl: this.getBaseURL(),
      services: Object.keys(this.services)
    };
  }

  public getId() {
    return this.id;
  }

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

  private extractWar(warpath: Path, pluginKey: string): Promise<any> {
    return new Promise((resolve,reject)=> {
      const destRoot = this.appdir;

      yauzl.open(warpath, {autoClose: true, lazyEntries: true}, function(err, zipfile) {
        if (err) {
          if (zipfile) {
            zipfile.close();
          }
          reject(err);
        } else {
          let error = undefined;
          const destPath = path.join(destRoot,
                                     pluginKey.replace(/:/g,'_')+'_'+
                                     path.basename(
                                       warpath.substring(0,warpath.length-path.extname(warpath).length)));

          zipfile.on("close", function() {
            log.info(`Extracted war to ${destPath}`);
            if (error) {
              reject(error);
            } else {
              resolve(destPath);
            }
          });  
          zipfile.readEntry();
          zipfile.on("entry", function(entry) {
            if (entry.fileName.endsWith('/')) {
              //directory
              mkdirp(path.join(destPath,entry.fileName), {mode: DIR_WRITE_MODE}, (err)=> {
                if (err) {
                  error = err;                  
                  zipfile.close();
                } else {
                  zipfile.readEntry();
                }
              });
            } else if (entry.fileName == '.') {
              zipfile.readEntry(); //TODO is it correct to skip this?
            } else {
              //file
              mkdirp(path.join(destPath,path.dirname(entry.fileName)), {mode: DIR_WRITE_MODE}, (err)=> {
                if (err) {
                  error = err;
                  zipfile.close();
                } else {
                  zipfile.openReadStream(entry, function(err, readStream) {
                    if (err) {
                      error = err;
                      zipfile.close();
                    } else {
                      log.debug(`Writing: ${entry.fileName}, Size=${entry.uncompressedSize}`);
                      let writeStream = fs.createWriteStream(
                        path.join(destPath,entry.fileName), {mode: FILE_WRITE_MODE});
                      writeStream.on("close", ()=> {
                        log.debug(`Wrote: ${entry.fileName}`);
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
  }

  private isExtracted(warpath: Path): Promise<boolean> {
    let dir = warpath.substring(0,warpath.length-path.extname(warpath).length);
    return new Promise(function(resolve,reject) {
      fs.stat(dir, function(err, stats) {
        if (err) {
          if (err.code == 'ENOENT') {
            return resolve(false); 
          } else {
            return reject(err);
          }
        } else if (stats.isDirectory()) {
          fs.stat(path.join(dir, 'WEB-INF', 'web.xml'), function(err, stats) {
            if (err) {
              return reject(err);
            } else if (stats.isFile()) {
              return resolve(true);
            } else {
              resolve(false);
            }
          })
        } else {
          resolve(false);          
        }
      });
    });
  }

  /* from given dir to our appbase dir 
     dir is an extracted war dir
  */
  private makeLink(dir: Path, destination: string): Promise<void> {
    if (TomcatManager.isWindows) {
      log.info(`Making junction from ${dir} to ${this.appdir}`);
    } else {
      log.info(`Making symlink from ${dir} to ${this.appdir}`);
    }
    return new Promise((resolve, reject)=> {
      fs.symlink(dir, destination,
                 TomcatManager.isWindows ? 'junction' : 'dir', (err)=> {
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
