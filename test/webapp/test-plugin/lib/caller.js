
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
/**
 * 
 */
const express = require('express');

module.exports = pluginContext => {
  const r = express.Router();
  r.get('/', (req, res) => {
    req.zluxData.plugin.callService('test-service').then(
        callResponse => {
          res.status(callResponse.statusCode).json({
            "plugin": "org.zowe.testplugin",
            "service": "caller",
            "test-service response": JSON.parse(callResponse.body)
          })
        }).catch(e => {
          console.log(e)
          res.status(400).json({
            "plugin": "org.zowe.testplugin",
            "service": "caller",
            "error": e
          })
        })
  })
  
  return {
    then(f) {
      f(r);
    }
  }
};
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
