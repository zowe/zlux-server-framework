/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

import * as https from 'https';
import argParser from '../../utils/argumentParser';
const args = [
  new argParser.CLIArgument('host', 'h', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('port', 'o', argParser.constants.ARG_TYPE_VALUE),
]
const commandArgs = process.argv.slice(2);
const argumentParser = argParser.createParser(args);
const userInput = argumentParser.parse(commandArgs);

if (!userInput.port || !userInput.host) {
  console.warn(`How to use: node ${__filename} -h <host of server> -o <port of server>`);
} else {
  const url = `https://${userInput.host}:${userInput.port}/plugins/`;
  const ZLUX_BOOTSTRAP_IDENTIFIER = 'org.zowe.zlux.bootstrap';

  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0; // If we don't turn this off, Node will complain about self signed certificates

  https.get(url, (resp) => {
    let data = '';

    resp.on('data', (chunk) => {
      data = data + chunk;
    });
    resp.on('end', () => {
      try { // Simple handshake checks that 1. server is running 2. server has 'org.zowe.zlux.bootstrap' plugin
        let pluginDefinitions = JSON.parse(data).pluginDefinitions;
        console.log(typeof plugins);
        for (var plugin in pluginDefinitions) {
          if (pluginDefinitions[plugin].identifier == ZLUX_BOOTSTRAP_IDENTIFIER) {
            console.log("Test passed!");
            process.exit(0);
          }
        }
        console.log("Test failed: " + ZLUX_BOOTSTRAP_IDENTIFIER + " was not found.");
        process.exit(1);
      }
      catch(err) {
        console.log("Test failed: ", err);
        process.exit(1);
      }
    });
  }).on("error", (err) => {
    console.log("Test failed: ", err.message);
    process.exit(1);
  });
}

