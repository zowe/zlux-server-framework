/*
 This program and the accompanying materials are
 made available under the terms of the Eclipse Public License v2.0 which accompanies
 this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
 
 SPDX-License-Identifier: EPL-2.0
 
 Copyright Contributors to the Zowe Project.
*/

const fs = require('graceful-fs');
const Promise = require('bluebird');
const path = require('path');
const packagingUtils = require('./packaging-utils');
const serverUtils = require('../lib/util');
const jsonUtils = require('../lib/jsonUtils');
const rmrf = require('rimraf');

//assuming that this is file isnt being called from another that is already using the logger... else expect strange logs
const logger = packagingUtils.coreLogger.makeComponentLogger("install-app"); //should only need one for this program

const argParser = require('../lib/argumentParser');
const usage = 'Usage: --inputApp | -i INPUTAPP --pluginsDir | -p PLUGINSDIR '
      + '--zluxConfig | -c ZLUXCONFIGPATH [--verbose | -v]';

//TODO if plugins get extracted read-only, then how would we go about doing upgrades? read-write for now!
const FILE_WRITE_MODE = 0o600;
const DIR_WRITE_MODE = 0o700;

const OPTION_ARGS = [
  new argParser.CLIArgument('inputApp', 'i', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('pluginsDir', 'p', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('zluxConfig', 'c', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('verbose', 'v', argParser.constants.ARG_TYPE_FLAG)
];

const commandArgs = process.argv.slice(2);
const argumentParser = argParser.createParser(OPTION_ARGS);
const userInput = argumentParser.parse(commandArgs);

if (!userInput.inputApp || !(!userInput.pluginsDir ^ !userInput.zluxConfig)) {
  logger.severe(usage);
  process.exit(1);
}

if (userInput.verbose) {
  packagingUtils.coreLogger.setLogLevelForComponentName('install-app', logger.FINE);
}

userInput.inputApp = serverUtils.normalizePath(userInput.inputApp);

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

function isFile(path) {
  try {
    let stat = fs.statSync(path);
    return !stat.isDirectory();
  } catch (e) {
    packagingUtils.endWithMessage(`Could not stat destination or temp folder ${path}. Error=${e.message}`);
  }
  return false;
}

function cleanup() {
  logger.warn(`Cleanup not yet implemented`);
}

function addToServer(appDir) {
  try {
    let pluginDefinition = JSON.parse(fs.readFileSync(path.join(appDir,'pluginDefinition.json')));
    logger.info(`Registering App (ID=${pluginDefinition.identifier}) with App Server`);
    let locatorJSONString =
        `{\n"identifier": "${pluginDefinition.identifier}",\n"pluginLocation": "${appDir.replace(/\\/g,'\\\\')}"\n}`;
    let destination = path.join(pluginsDir, pluginDefinition.identifier+'.json');
    logger.debug(`Writing plugin locator file to ${destination}, contents=\n${locatorJSONString}`);
    fs.writeFile(destination, locatorJSONString, {mode: FILE_WRITE_MODE}, (err)=> {
      if (err) {
        packagingUtils.endWithMessage(
          `App extracted but not registered to App Server due to write fail. Error=${err.message}`);
      }
      logger.info(`App ${pluginDefinition.identifier} installed to ${appDir} and registered with App Server`);
      process.exit(0);
    });
  } catch (e) {
    packagingUtils.endWithMessage(
      `Could not find pluginDefinition.json file in App (dir=${appDir}). Error=${e.message}`);
  }
}

if (isFile(pluginsDir)) {
  packagingUtils.endWithMessage(`App Server plugins directory location given (${pluginsDir}) is not a directory.`);
}

if (!isFile(userInput.inputApp)) {
  const pluginDefinition = packagingUtils.validatePluginInDirectory(userInput.inputApp);
  addToServer(userInput.inputApp);  
} else {
  packagingUtils.endWithMessage(`App given was not a directory. Not yet implemented: Package extraction`);
}

/*
 This program and the accompanying materials are
 made available under the terms of the Eclipse Public License v2.0 which accompanies
 this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
 
 SPDX-License-Identifier: EPL-2.0
 
 Copyright Contributors to the Zowe Project.
*/
