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
//TO DO - Sean - bootstrap logger
const logger = packagingUtils.coreLogger.makeComponentLogger("install-app"); //should only need one for this program

var messages;
try { // Attempt to get a log message for a language a user may have specified
  messages = require(`../lib/assets/i18n/log/messages_en.json`);
} catch (err) { // If we encountered an error...
  messages = undefined;
}
logger._messages = messages;

const argParser = require('./argumentParser');
//const usage = 'Usage: --inputApp | -i INPUTAPP --pluginsDir | -p PLUGINSDIR '
//      + '--zluxConfig | -c ZLUXCONFIGPATH [--verbose | -v]';

//TODO if plugins get extracted read-only, then how would we go about doing upgrades? read-write for now!
const FILE_WRITE_MODE = 0o660;
const DIR_WRITE_MODE = 0o770;

const OPTION_ARGS = [
  new argParser.CLIArgument('inputApp', 'i', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('pluginsDir', 'p', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('zluxConfig', 'c', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('verbose', 'v', argParser.constants.ARG_TYPE_FLAG)
];

const calledViaCLI = (require.main === module);
let userInput;
let pluginsDir;

if(calledViaCLI){
  const commandArgs = process.argv.slice(2);
  const argumentParser = argParser.createParser(OPTION_ARGS);
  userInput = argumentParser.parse(commandArgs);

  if (!userInput.inputApp || !(!userInput.pluginsDir ^ !userInput.zluxConfig)) {
    logger.severe(`ZWED0006E`); //logger.severe(usage);
    process.exit(1);
  }

  if (userInput.verbose) {
    packagingUtils.coreLogger.setLogLevelForComponentName('install-app', logger.FINE);
  }

  userInput.inputApp = serverUtils.normalizePath(userInput.inputApp);

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
  if (isFile(pluginsDir)) {
    packagingUtils.endWithMessage(`App Server plugins directory location given (${pluginsDir}) is not a directory.`);
  }
}

function isFile(path) {
  try {
    let stat = fs.statSync(path);
    return !stat.isDirectory();
  } catch (e) {
    if(calledViaCLI){
      packagingUtils.endWithMessage(`Could not stat destination or temp folder ${path}. Error=${e.message}`);
    } else {
      logger.warn(`ZWED0146W`, path, e.message); //logger.warn(`Could not stat destination or temp folder ${path}. Error=${e.message}`);
      return true;
    }
  }
  return false;
}

function cleanup() {
  logger.warn(`ZWED0147W`); //logger.warn(`Cleanup not yet implemented`);
}

function addToServer(appDir, installDir) {
  try {
    let pluginDefinition = JSON.parse(fs.readFileSync(path.join(appDir,'pluginDefinition.json')));
    logger.info(`ZWED0109I`, pluginDefinition.identifier); //logger.info(`Registering App (ID=${pluginDefinition.identifier}) with App Server`);
    let locatorJSONString =
        `{\n"identifier": "${pluginDefinition.identifier}",\n"pluginLocation": "${appDir.replace(/\\/g,'\\\\')}"\n}`;
    let destination;
    if(calledViaCLI){
      destination = path.join(pluginsDir, pluginDefinition.identifier+'.json');
    } else {
      destination = path.join(installDir, pluginDefinition.identifier+'.json');
    }
    logger.debug('ZWED0286I', destination, locatorJSONString); //logger.debug(`Writing plugin locator file to ${destination}, contents=\n${locatorJSONString}`);
    fs.writeFile(destination, locatorJSONString, {mode: FILE_WRITE_MODE}, (err)=> {
      if(err){
        let errMsg = `App extracted but not registered to App Server due to write fail. Error=${err.message}`;
        if(calledViaCLI){
          packagingUtils.endWithMessage(errMsg);
        } else {
          logger.warn(`ZWED0148W`, err.message); //logger.warn(errMsg);
        return {success: false, message: errMsg};
        }
      }
      logger.info(`ZWED0110I`, pluginDefinition.identifier, appDir); //logger.info(`App ${pluginDefinition.identifier} installed to ${appDir} and registered with App Server`);
      if(calledViaCLI){
        process.exit(0);
      }
    });
    copyRecognizers(appDir, pluginDefinition.identifier, pluginDefinition.pluginVersion);
    copyActions(appDir, pluginDefinition.identifier, pluginDefinition.pluginVersion);
    return {success: true, message: pluginDefinition.identifier};
  } catch (e) {
    if(calledViaCLI){
      packagingUtils.endWithMessage(
      `Could not find pluginDefinition.json file in App (dir=${appDir}). Error=${e.message}`);
    }
    logger.warn(`ZWED0149W`, appDir, e.message); //logger.warn(`Could not find pluginDefinition.json file in App (dir=${appDir}). Error=${e.message}`)
    return {success: false, message: `Could not find pluginDefinition.json file in App (dir=${appDir}). Error=${e.message}`};
  }
}

function copyRecognizers(appDir, appId, appVers) {
  let recognizers;
  let recognizersKeys;
  let configRecognizers;
  let configLocation;

  if (process.env.INSTANCE_DIR) {
    configLocation = path.join(process.env.INSTANCE_DIR, "workspace/app-server/ZLUX/pluginStorage/org.zowe.zlux.ng2desktop/");
  } else {
    try {
      let instanceDir = JSON.parse(fs.readFileSync(userInput.zluxConfig)).instanceDir;
      configLocation = path.join(instanceDir, "/ZLUX/pluginStorage/org.zowe.zlux.ng2desktop/");
    } catch (e) {
      logger.error('ZWED0152E'); //logger.error('Unable to locate server config instance location and INSTANCE_DIR environment variable does not exist.')
    }
  }

  try { // Get recognizers in a plugin's appDir/config/xxx location
    fs.readdirSync(path.join(appDir, "config/recognizers")).forEach(filename => {
      const filepath = path.resolve(path.join(appDir, "config/recognizers"), filename);
      const filepathConfig = path.resolve(path.join(configLocation, "recognizers", filename));
      const stat = fs.statSync(filepath);
      
      if (stat.isFile()) {
        recognizers = JSON.parse(fs.readFileSync(filepath)).recognizers;
        recognizersKeys = Object.keys(recognizers)
        for (const key of recognizersKeys) { // Add metadata for plugin version & plugin identifier of origin (though objects don't have to be plugin specific)
          recognizers[key].pluginVersion = appVers;
          recognizers[key].pluginIdentifier = appId;
          recognizers[key].key = appId + ":" + key + ":" + recognizers[key].id; // pluginid_that_provided_it:index(or_name)_in_that_provider:actionid
        }

        try { // Get pre-existing recognizers in config, if any
          configRecognizers = JSON.parse(fs.readFileSync(filepathConfig)).recognizers;
          const configRecognizersKeys = Object.keys(configRecognizers);
          for (const configKey of configRecognizersKeys) { // Traverse config recognizers
            for (const key of recognizerKeys) { // Traverse plugin recognizers
              if (configRecognizers[configKey].key && recognizers[key].key && configRecognizers[configKey].key == recognizers[key].key) { // TODO: Need to implement real keys for Recognizers
                configRecognizers[configKey] = recognizers[key]; // Choose the recognizers originating from plugin
              }
            }
          }
          recognizers = Object.assign(configRecognizers, recognizers); // // If found, combine the ones found in config with ones found in plugin
          logger.debug('ZWED0296I', appId); //logger.debug("Found recognizers in config for '" + appId + "'");
        } catch (e) {
          logger.debug('ZWED0297I', appId); //logger.debug("No existing recognizers were found in config for '" + appId + "'");
        }
      
        if (recognizers) { // Attempt to copy recognizers over to config location for Desktop access later
          try { //TODO: Doing recognizers.recognizers is redundant. We may want to consider refactoring in the future
            fs.writeFileSync(filepathConfig, '{ "recognizers":' + JSON.stringify(recognizers) + '}');
            logger.debug('ZWED0298I', recognizers.length, appId); //logger.info("Successfully loaded " + recognizers.length + " recognizers for '" + appId + "' into config");
          } catch (e) {
            logger.debug('ZWED0299I', appId); //logger.debug("Unable to load recognizers for '" + appId + "' into config");
          }
        }
      }
    });
    logger.debug('ZWED0294I', appId); //logger.debug("Found recognizers inside '" + appId + "'");
  } catch (e) {
    logger.debug('ZWED0295I', (path.join(appDir, "config/recognizers")), appId); //logger.debug("Could not find recognizers in '" + (path.join(appDir, "config/recognizers")) + "'");
  }
}

function copyActions(appDir, appId, appVers) {
  let actions;
  let actionsKeys;
  let configLocation;

  try { // Get actions in a plugin's appDir/config/xxx location
    actions = JSON.parse(fs.readFileSync(path.join(appDir, "config/actions", appId))).actions;
    actionsKeys = Object.keys(actions)
    for (const key of actionsKeys) { // Add metadata for plugin version & plugin identifier of origin (though objects don't have to be plugin specific)
      actions[key].pluginVersion = appVers;
      actions[key].pluginIdentifier = appId;
    }
    logger.debug('ZWED0300I', appId); //logger.debug("Found actions for '" + appId + "'");
  } catch (e) {
    logger.debug('ZWED0301I', path.join(appDir, "config/actions", appId)); //logger.debug("Could not find actions in '" + (path.join(appDir, "config/actions", appId)) + "'");
  }

  if (process.env.INSTANCE_DIR) {
    configLocation = path.join(process.env.INSTANCE_DIR, "workspace/app-server/ZLUX/pluginStorage/org.zowe.zlux.ng2desktop/");
  } else {
    try {
      let instanceDir = JSON.parse(fs.readFileSync(userInput.zluxConfig)).instanceDir;
      configLocation = path.join(instanceDir, "/ZLUX/pluginStorage/org.zowe.zlux.ng2desktop/");
    } catch (e) {
      logger.error('ZWED0152E'); //logger.error("Unable to locate server config instance location and INSTANCE_DIR environment variable does not exist.")"
    }
  }

  if (actions) { // Attempt to copy actions over to config location for Desktop access later
    try { //TODO: Doing actions.actions is redundant. We may want to consider refactoring in the future
      fs.writeFileSync(path.join(configLocation, "actions", appId), '{ "actions":' + JSON.stringify(actions) + '}');
      logger.info('ZWED0304I', actions.length, appId); //logger.info("Successfully loaded " + actions.length + " actions for '" + appId + "' into config");
    } catch (e) {
      logger.debug('ZWED0305I', appId); //logger.debug("Unable to load actions for '" + appId + "' into config");
    }
  }
}

if(calledViaCLI){
  if (!isFile(userInput.inputApp)) {
    const pluginDefinition = packagingUtils.validatePluginInDirectory(userInput.inputApp);
    addToServer(userInput.inputApp);  
  } else {
    packagingUtils.endWithMessage(`App given was not a directory. Not yet implemented: Package extraction`);
  }
}

module.exports.addToServer = addToServer;
module.exports.isFile = isFile;

/*
 This program and the accompanying materials are
 made available under the terms of the Eclipse Public License v2.0 which accompanies
 this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
 
 SPDX-License-Identifier: EPL-2.0
 
 Copyright Contributors to the Zowe Project.
*/
