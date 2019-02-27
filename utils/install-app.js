/*
 This program and the accompanying materials are
 made available under the terms of the Eclipse Public License v2.0 which accompanies
 this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
 
 SPDX-License-Identifier: EPL-2.0
 
 Copyright Contributors to the Zowe Project.
*/

const yauzl = require('yauzl');
const fs = require('graceful-fs');
const Promise = require('bluebird');
const path = require('path');
const packagingUtils = require('./packaging-utils');
const serverUtils = require('../lib/util');
const jsonUtils = require('../lib/jsonUtils');
const rmrf = require('rimraf');

//assuming that this is file isnt being called from another that is already using the logger... else expect strange logs
const logger = packagingUtils.coreLogger.makeComponentLogger("unpackage-app"); //should only need one for this program

const argParser = require('../lib/argumentParser');
const usage = 'Usage: --inputApp | -i INPUTAPP --outputDir | -o OUTPUTDIR --pluginsDir | -p PLUGINSDIR '
      + '--zluxConfig | -c ZLUXCONFIGPATH [--verbose | -v] [--overwrite | -w]';

//TODO if plugins get extracted read-only, then how would we go about doing upgrades? read-write for now!
const FILE_WRITE_MODE = 0o600;
const DIR_WRITE_MODE = 0o700;

const OPTION_ARGS = [
  new argParser.CLIArgument('inputApp', 'i', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('outputDir', 'o', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('pluginsDir', 'p', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('zluxConfig', 'c', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('verbose', 'v', argParser.constants.ARG_TYPE_FLAG),
  new argParser.CLIArgument('overwrite', 'w', argParser.constants.ARG_TYPE_FLAG)
];

const commandArgs = process.argv.slice(2);
const argumentParser = argParser.createParser(OPTION_ARGS);
const userInput = argumentParser.parse(commandArgs);

if (!userInput.inputApp || !userInput.outputDir ||
    !(!userInput.pluginsDir ^ !userInput.zluxConfig)) {
  logger.severe(usage);
  process.exit(1);
}

if (userInput.verbose) {
  packagingUtils.coreLogger.setLogLevelForComponentName('unpackage-app', logger.FINE);
}

userInput.inputApp = serverUtils.normalizePath(userInput.inputApp);
userInput.outputDir = serverUtils.normalizePath(userInput.outputDir);

function endWithMessage(message) {
  logger.severe(message);
  process.exit(1);
}

let pluginsDir;
if (userInput.pluginsDir) {
  pluginsDir = serverUtils.normalizePath(userInput.pluginsDir); 
} else {
  userInput.zluxConfig = serverUtils.normalizePath(userInput.zluxConfig);
  const zluxConfig = jsonUtils.parseJSONWithComments(userInput.zluxConfig);
  pluginsDir = serverUtils.normalizePath(
    zluxConfig.pluginsDir,
    process.cwd());
  if (!path.isAbsolute(pluginsDir)){
    //zluxconfig paths relative to whereever that file is
    path.normalize(userInput.zluxConfig,pluginsDir);
  }
}

try {
  let stat = fs.statSync(pluginsDir);
  if (!stat.isDirectory()) {
    endWithMessage(`App Server plugins directory location given (${pluginsDir}) is not a directory.`);
  }
} catch (e) {
  endWithMessage(`App Server plugins directory ${pluginsDir} could not be read. Error=${e.message}`);
}

let appDirName = path.basename(userInput.inputApp);
let extensionPos = appDirName.lastIndexOf('.');
if (extensionPos != -1) {
  appDirName = appDirName.substring(0,extensionPos);
}
const appDir = path.join(userInput.outputDir,appDirName);

function checkDestinationFolder(dir, overwrite) {
  try {
    fs.statSync(dir);
    if (!overwrite) {
      endWithMessage(`Destination or temp folder ${dir} exists. To overwrite for upgrade, run with flag --overwrite`);
    }
  } catch (e) {
    if (e.code != 'ENOENT') {
      endWithMessage(`Could not stat destination or temp folder ${dir}. Error=${e.message}`);
    }
    //otherwise, not existing is what we want
  }
}

checkDestinationFolder(appDir, userInput.overwrite);
checkDestinationFolder(appDir+'.temp', true); //which will be renamed upon completion


function cleanup() {
  logger.warn(`Cleanup not yet implemented`);
}

function done(pluginDefinition) {
  logger.info(`App ${pluginDefinition.identifier} installed to ${appDir} and registered with App Server`);
  process.exit(0);
}

function addToServer() {
  try {
    let pluginDefinition = JSON.parse(fs.readFileSync(path.join(appDir,'pluginDefinition.json')));
    logger.info(`Registering App (ID=${pluginDefinition.identifier}) with App Server`);
    let locatorJSONString = `{\n"identifier": "${pluginDefinition.identifier}",\n"pluginLocation": "${appDir.replace(/\\/g,'\\\\')}"\n}`;
    let destination = path.join(pluginsDir, pluginDefinition.identifier+'.json');
    logger.debug(`Writing plugin locator file to ${destination}, contents=\n${locatorJSONString}`);
    fs.writeFile(destination, locatorJSONString, {mode: FILE_WRITE_MODE}, (err)=> {
      if (err) {
        endWithMessage(`App extracted but not registered to App Server due to write fail. Error=${err.message}`);
      }
      done(pluginDefinition);
    });
  } catch (e) {
    endWithMessage(`Could not find pluginDefinition.json file in App (dir=${appDir}). Error=${e.message}`);
  }
}

yauzl.open(userInput.inputApp, {lazyEntries: true}, function(err, zipfile) {
  if (err) {
    endWithMessage(`Could not open App ${userInput.inputApp}. Error=${err.message}`);
  }
  zipfile.on("close", function() {
    try {
      rmrf(appDir, (err)=> {
        if (err) {
          cleanup();
          endWithMessage(`Could not remove old App for upgrade, in folder ${appDir}. Error=${err.message}`);
        }
        fs.renameSync(appDir+'.temp',appDir);
        logger.info(`Extracted App to ${appDir}`);
        addToServer();        
      });
    } catch (e) {
      endWithMessage(`Could not rename temp folder ${appDir+'.temp'} to ${appDir}. Error=${e.message}`);
    }
  });  
  zipfile.readEntry();
  zipfile.on("entry", function(entry) {
    if (entry.fileName.endsWith('/')) {
      //directory
      packagingUtils.mkdirp(path.join(appDir+'.temp',entry.fileName), {mode: DIR_WRITE_MODE}).then(()=> {
        zipfile.readEntry();
      }).catch((err)=> {
        cleanup();
        endWithMessage(`App could not be installed, extraction failed during directory creation. Error=${err}`);
      });
    } else {
      //file
      packagingUtils.mkdirp(path.join(appDir+'.temp',path.dirname(entry.fileName)), {mode: DIR_WRITE_MODE}).then(()=> {
        zipfile.openReadStream(entry, function(err, readStream) {
          if (err) {
            cleanup();
            endWithMessage(`App could not be installed, extraction failed during archived file read. Error=${err}`);
          }
          logger.debug(`Writing: ${entry.fileName}, Size=${entry.uncompressedSize}`);
          let writeStream = fs.createWriteStream(path.join(appDir+'.temp',entry.fileName), {mode: FILE_WRITE_MODE});
          writeStream.on("close", ()=> {
            logger.debug(`Wrote: ${entry.fileName}`);
            zipfile.readEntry();
          });
          readStream.pipe(writeStream);
        });        
      });
    }
  });
});

/*
 This program and the accompanying materials are
 made available under the terms of the Eclipse Public License v2.0 which accompanies
 this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
 
 SPDX-License-Identifier: EPL-2.0
 
 Copyright Contributors to the Zowe Project.
*/
