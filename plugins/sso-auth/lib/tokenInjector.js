const express = require('express');

module.exports = pluginContext => {
  const r = express.Router();
  try {
    const apimlConfig = pluginContext.plugin.server.config.user.node.mediationLayer.server;
    const gatewayUrl = `https://${this.apimlConfig.hostname}:${this.apimlConfig.gatewayPort}`;
    r.get('/**', (req, res) => {
      const apimlSession = req.session.authPlugins['org.zowe.zlux.auth.safsso'];
      if (apimlSession === undefined) {
        res.status(401).send("Missing APIML authentication token in zLUX session");
      }
      else {
        const token = apimlSession.apimlToken;
        const newUrl = gatewayUrl + req.url.replace("1.0.0/", "") + "?apimlAuthenticationToken=" + token;
        res.redirect(newUrl);
      }
    })
  } catch (e) {
    r.get('/**', (req, res) => {
      res.status(500).send("Missing APIML configuration");
    })
  }

  return {
    then(f) {
      f(r);
    }
  }
};
