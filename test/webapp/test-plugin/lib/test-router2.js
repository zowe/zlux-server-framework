/**
 * 
 */
const express = require('express');

module.exports = pluginContext => {
  const r = express.Router();
  r.get('/', (req, res) => {
    res.status(200).json({
      "plugin": "org.zowe.testplugin",
      "service": "test-service",
      "version": "2.1.0"
    })
  })
  return {
    then(f) {
      f(r);
    }
  }
};