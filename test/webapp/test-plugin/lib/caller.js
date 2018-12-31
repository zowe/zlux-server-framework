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