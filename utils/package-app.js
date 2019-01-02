/*
 This program and the accompanying materials are
 made available under the terms of the Eclipse Public License v2.0 which accompanies
 this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
 
 SPDX-License-Identifier: EPL-2.0
 
 Copyright Contributors to the Zowe Project.
*/

const yazl = require("yazl");
const fs = require('graceful-fs');
const Promise = require('bluebird');
const path = require('path');
const packagingUtils = require('./packaging-utils');
const logger = packagingUtils.coreLogger.makeComponentLogger("package-app"); //should only need one for this program

const argParser = require('../js/argumentParser.js');
const usage = 'Usage: --inputDir | -i INPUTDIRECTORY [--outputPath | -o OUTPUTPATH]';

const OPTION_ARGS = [
  new argParser.CLIArgument('inputDir', 'i', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('outputPath', 'o', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('includeSource', 's', argParser.constants.ARG_TYPE_FLAG),
  new argParser.CLIArgument('verbose', 'v', argParser.constants.ARG_TYPE_FLAG),
];

const commandArgs = process.argv.slice(2);
const argumentParser = argParser.createParser(OPTION_ARGS);
const userInput = argumentParser.parse(commandArgs);

if (!userInput.inputDir) {
  logger.severe(usage);
  process.exit(1);
}

if (userInput.verbose) {
  packagingUtils.coreLogger.setLogLevelForComponentName('package-app', logger.FINE);
}
userInput.inputDir = packagingUtils.normalizePath(userInput.inputDir);

class YazlArchiver {
  constructor(baseDir, destination) {
    this.zipfile = new yazl.ZipFile();
    this.pipe = this.zipfile.outputStream.pipe(fs.createWriteStream(destination+'.temp'));
    this.baseDir = baseDir;
    this.filesAdded = 0;
    this.dirsAdded = 0;
    this.archiveSize = -1;
    this.destination = destination;
    this.finished = false;
  }

  addFile(filePath) {
    //filepath is absolute, zippath is relative to starting folder
    logger.debug(`AddFile: ${filePath}`);
    this.zipfile.addFile(filePath, this.getZipPath(filePath), {mode:0o600});
    this.filesAdded++;
  }
  
  addDirectory(filePath) {
    logger.debug(`AddDir: ${filePath}`);
    logger.log(logger.FINER,`Adding directories explicitly isn't needed for yazl library`);
    this.dirsAdded++;
  }
  
  getZipPath(filePath) {
    // /foo/bar/baz becomes /bar/baz in archive if inputDir=foo
    return filePath.substring(this.baseDir.length+1);
  }
  
  finalizeArchive() {
    return new Promise((resolve, reject)=> {
      this.pipe.on('close', ()=> {
        try {
          let destStat;
          try {
            destStat = fs.statSync(this.destination);
          } catch (e) {
            if (e.code != 'ENOENT') {
              throw e;
            }
          }
          if (!destStat) {
            //file didnt exist, good to go
          } else {
            fs.unlinkSync(this.destination);
          }
          fs.renameSync(this.destination+'.temp', this.destination);
          this.finished = true;
          resolve();
        } catch (e) {
          endWithMessage(`Could not rename temp file to final destination (${this.destination}), Error=${e.message}`);
        }
      });
      //finalSize can be given before pipe close, but may be -1 safely due to circumstances (read yazl doc)
      this.zipfile.end({},(finalSize)=> {
        this.archiveSize = finalSize;
      });
    });
  }

  //on failure, remove any temp files
  failureCleanup() {
    return new Promise((resolve, reject)=> {
      logger.info(`Performing cleanup of temp file (${this.destination+'.temp'})`);
      this.pipe.on('close',()=> {
        try {
          fs.unlinkSync(this.destination+'.temp');
          resolve();
        } catch (e) {
          endWithMessage(`Could not perform cleanup of temp file (${this.destination+'.temp'}), Error=${e.message}`);
        }
      });      
      this.zipfile.end();
    });
  }

  getSummary() {
    return {
      filesAdded: this.filesAdded,
      dirsAdded: this.dirsAdded,
      destinaton: this.destination,
      finished: this.finished,
      archiveSize: this.archiveSize
    }
  }
}

function normalizeDestination(pluginID, requestedOutputPath) {
  if (!requestedOutputPath) {
    return path.join(process.cwd(),pluginID+'.zapp');
  } else {
    requestedOutputPath = packagingUtils.normalizePath(requestedOutputPath);
  }
  try {
    let stat = fs.statSync(requestedOutputPath);
    if (stat.isDirectory()) {
      let newPath = path.join(requestedOutputPath,pluginID+'.zapp');
      logger.info(`Output path given (${requestedOutputPath}) is a directory. Setting destination as ${newPath}`);
      requestedOutputPath = newPath;
    } else {
      logger.info(`Output will overwrite existing file ${requestedOutputPath}`);
    }
  } catch (e) {
    //doesn't exist? check if parent does
    //TODO end when error isnt non-existence
    try {
      //does the parent folder exist?
      let parentStat = fs.statSync(path.dirname(requestedOutputPath));
      if (!parentStat.isDirectory()) {
        endWithMessage(`Output destination ${requestedOutputPath} is invalid, `
                       +`${path.dirname(requestedOutputPath)} is a file`);
      } else {
        return requestedOutputPath;
      }
    } catch (e) {
      endWithMessage(`Output path contains missing directory, ${path.dirname(requestedOutputPath)}`);
    }
  }
  return requestedOutputPath;
}

/* 
   a series of checks to validate the plugin: is this a directory, does it have a plugin def,
   if it says it has dataservices, does it? if it says it has web content, does it?
   this should really be done by json schema.
*/
const pluginDefinition = validatePluginInDirectory(userInput.inputDir);
compressApp(pluginDefinition, userInput);


function endWithMessage(message) {
  logger.severe(message);
  process.exit(1);
}

/*
  post validation: we should be able to package according to a scheme now
*/
function compressApp(pluginDefinition, userInput) {
  let archiver = new YazlArchiver(userInput.inputDir, userInput.outputPath);
  if (userInput.includeSource) {
    //package everything
    packageRecursively(userInput.inputDir, archiver).then(()=> {
      archiver.finalizeArchive().then(()=> {
        done(archiver);
      });
    }).catch((err)=> {
      archiver.failureCleanup().then(()=> {
        endWithMessage(`Error processing dir=${userInput.inputDir}, Error=${err.message}`);
      });
    });
  } else {
    /*

      package the app based on what it proclaims:
      if you have webContent, you have /web
      if you have dataservices, you have /lib
      docs go in /docs
      /build can contain a deploy script, but i suspect this will change since /build is a poor name for that.
      
      open question: what should be enforced for config packaging? we have some content in the root
      and this gets handled by /build deployment.

      we could allow files in the root to be packaged (except dotfiles & package*.json for sanity)
      or, we could allow a /config folder to exist instead
      ... lets do both for now to keep our options open.


      important factor: how does install-time setup take place uniformly?
      I imagine a UI for end-user first-time setup as being optional
      but admin setup needs a framework too.
      a wizard that populates configservice defaults, based on script invokation & user prompting

    */
    let packageLib = function() {
      if (pluginDefinition.dataServices) {
        let needLib = false;
        for (let i = 0; i < pluginDefinition.dataServices.length; i++) {
          let type = pluginDefinition.dataServices[i].type;
          if (type != 'import' && type != 'external') {
            //a dataservice which needs content to be packaged is found
            needLib = true;
            break;
          }
        }
        
        if (needLib) {
          packageRecursively(path.join(userInput.inputDir, '/lib'), archiver).then(()=> { //for web apis
            archiver.finalizeArchive().then(()=> {
              done(archiver);
            });
          }).catch((err)=> {
            archiver.failureCleanup().then(()=> {
              endWithMessage(`Required /lib folder couldn't be read or missing. Error=${err.message}`);
            });
          });
        } else {
          archiver.finalizeArchive().then(()=> {
            done(archiver);
          });
        }
      } else {
        archiver.finalizeArchive().then(()=> {
          done(archiver);
        });
      }
    };

    let packageWeb = function() {
      if (pluginDefinition.webContent) { 
        packageRecursively(path.join(userInput.inputDir, '/web'), archiver).then(()=> { //for hosted content
          packageLib();
        }).catch((err)=>{
          archiver.failureCleanup().then(()=> {
            endWithMessage(`Required /web folder couldn't be read or missing. Error=${err.message}`);
          });
        });
      } else {
        packageLib();
      }
    };
    
    let packageConfig = function() {
      packageRecursively(path.join(userInput.inputDir, '/config'), archiver).then(()=> { //next home of deploy stuff?
        packageWeb();
      }).catch((err)=> {
        //optional.
        logger.warn(`Optional /config folder couldn't be read or missing. Error=${err.message}`);        
        packageWeb();
      });
    };

    let packageBuild = function() {
      packageRecursively(path.join(userInput.inputDir, '/build'), archiver).then(()=> { //home of deploy script
        packageConfig();
      }).catch((err)=> {
        //optional.
        logger.warn(`Optional /build folder couldn't be read or missing. Error=${err.message}`);
        packageConfig();
      });
    };
    
    packageRoot(userInput.inputDir, archiver).then(()=> {
      packageRecursively(path.join(userInput.inputDir, '/doc'), archiver).then(()=> { //for docs, swagger
        packageBuild();
      }).catch((err)=>{
        //optional, but recommended
        logger.warn(`Recommended /doc folder couldn't be read or missing. Error=${err.message}`);
        packageBuild();
      }).catch((err)=> {
        //this shouldn't happen, can't continue
        endWithMessage(`App root directory ${userInput.inputDir} couldn't be read or missing. Error=${err.message}`);
      });
    });
  }
}

//print some statistics
function done(archiver) {
  let summary = archiver.getSummary();
  logger.info(`Processed ${summary.filesAdded} files in ${summary.dirsAdded} directories `
              +`into output ${userInput.outputPath}`);
  logger.info('Packaging complete.');
  process.exit(0);
}

//topDirectory must be an absolute path
function packageRecursively(topDirectory, archiver) {
  let stop = false;

  return new Promise((resolve, reject)=> {
    let innerLoop = function(directory, successCallback) {
      fs.readdir(directory,(err, files)=> {
        if (err) {
          //maybe dir doesnt exist, bubble up
          reject(err);
        } else {
          if (files.length == 0) {
            if (directory == topDirectory) {
              reject(new Error(`No files in requested directory (${topDirectory}`));
            } else {
              successCallback();
            }
          } else {
            let filesComplete = 0;
            files.forEach((file)=> {
              if (!stop) {
                //this will be a full path
                let filePath = path.join(directory,file);
                fs.stat(filePath,(err,stats)=> {
                  if (err) {
                    stop = true;
                    reject(err);
                  } else {
                    if (stats.isDirectory()) {
                      //loop
                      logger.log(logger.FINER,'Descending into path for adding. Path='+filePath);
                      archiver.addDirectory(filePath);
                      innerLoop(filePath,()=> {
                        logger.log(logger.FINER,'Finished adding files in path='+filePath);
                        filesComplete++;
                        if (filesComplete == files.length) {
                          if (directory == topDirectory) {
                            resolve();
                          } else {
                            successCallback();
                          }
                        }
                      });
                    } else {
                      archiver.addFile(filePath);
                      filesComplete++;
                      if (filesComplete == files.length) {
                        if (directory == topDirectory) {
                          resolve();
                        }
                        else {
                          successCallback();
                        }
                      }
                      /*
                      if (err) {
                        stop = true;
                        reject (err);
                      }
                      */
                    }
                  }
                });
              }
            });
          }        
        }
      });
    };

    
    innerLoop(topDirectory, ()=> {resolve();});
  });
}

/*
  Packages all files in root except .files and package*.json. Are there other obvious ones to exclude?
*/
function packageRoot(directory, archiver) {
  return new Promise((resolve, reject) => {
    fs.readdir(directory, (err, files)=> {
      if (err) {
        reject(err);
      } else {
        //files must exist as a result of earlier validation
        let stop = false;
        let filesComplete = 0;
        files.forEach((file)=> {
          if (!stop) {
            let filePath = path.join(directory, file);
            fs.stat(filePath, (err, stats)=> {
              if (err) {
                stop = true;
                reject(err);
              } else {
                if (!stats.isDirectory()) {
                  if (!file.startsWith('.') && file != 'package.json'
                      && !file.startsWith('package-lock') && file != 'sonar-project.properties') {
                    archiver.addFile(filePath);
                    filesComplete++;
                  } else { //skip file we dont want to package
                    filesComplete++;
                  }
                } else {
                  filesComplete++; //skip
                }
                if (filesComplete == files.length) {
                  resolve();
                }
              }
            });
          }
        });
      }
    });
  });
}

function validatePluginInDirectory() {
  try {
    let inputStats = fs.statSync(userInput.inputDir); //no need to make code messy with async here
    if (!inputStats.isDirectory()) {
      endWithMessage('Input must be a directory');
    }
  } catch (e) {
    endWithMessage(`Couldnt open input directory, ${userInput.inputDir}, e=${e}`);
  }
  let pluginDefinition;
  try {
    let pluginDefPath = path.join(userInput.inputDir,'pluginDefinition.json');
    let pluginStat = fs.statSync(pluginDefPath); //no need to make code messy with async here
    if (pluginStat.isDirectory()) {
      endWithMessage(`pluginDefinition.json cannot be a directory`);
    }
    pluginDefinition = JSON.parse(fs.readFileSync(pluginDefPath));
    //TODO much more validation needed.
  } catch (e) {
    endWithMessage(`Couldn't read pluginDefinition.json within ${userInput.inputDir}, e=${e}`);
  }
  userInput.outputPath = normalizeDestination(pluginDefinition.identifier, userInput.outputPath);
  return pluginDefinition;
};

/*
 This program and the accompanying materials are
 made available under the terms of the Eclipse Public License v2.0 which accompanies
 this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
 
 SPDX-License-Identifier: EPL-2.0
 
 Copyright Contributors to the Zowe Project.
*/