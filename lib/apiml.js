
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
const Promise = require("bluebird");
const eureka = require('eureka-js-client').Eureka;
const zluxUtil = require('./util');
const https = require('https');

const log = zluxUtil.loggers.apiml;

const DEFAULT_AGENT_CHECK_TIMEOUT = 30000;
const AGENT_CHECK_RECONNECT_DELAY = 5000;


const MEDIATION_LAYER_EUREKA_DEFAULTS = {
  "preferSameZone": false,
  "maxRetries": 100,
  "requestRetryDelay": 10000,
  "heartbeatInterval": 30000,
  "registryFetchInterval": 10000,
  "fetchRegistry": false,
  "availabilityZones": {
    "defaultZone": ["defaultZone"]
  }, 
};


const MEDIATION_LAYER_INSTANCE_DEFAULTS = {
  instanceId: "localhost:zowe-zlux:8543",
  app: "zlux",
  hostName: "localhost",
  ipAddr: "127.0.0.1", 
  vipAddress: "localhost",
  status: "UP",
  dataCenterInfo: {
    '@class': 'com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo',
    name: 'MyOwn'
  },
  leaseInfo: {
    durationInSecs: 90, // 3 * heartbeatInterval
    renewalIntervalInSecs: 30 // heartbeatInterval
  },
  metadata: {
    "routed-services.1.gateway-url": "/api/v1",
    "routed-services.1.service-url": "/",
    "routed-services.2.gateway-url": "/ui/v1",
    "routed-services.2.service-url": "/",
    "routed-services.3.gateway-url": "/ws/v1",
    "routed-services.3.service-url": "/",
    "routed-services.4.gateway-url": "/v1/api-doc",
    "routed-services.4.service-url": "/",

    'mfaas.discovery.catalogUiTile.id': 'zlux',
    'mfaas.discovery.catalogUiTile.title': 'Zowe Application Server',
    'mfaas.discovery.catalogUiTile.description': 'The Proxy Server is an '
       + 'HTTP, HTTPS, and Websocket server built upon NodeJS and ExpressJS. '
       + 'This serves static content via "Plugins", and is extensible by '
       + 'REST and Websocket "Dataservices" optionally present within Plugins.',
    'mfaas.discovery.catalogUiTile.version': '1.0.0',

    'mfaas.discovery.service.title': 'Zowe Application Server',
    'mfaas.discovery.service.description': 'The Proxy Server is an HTTP, '
      + 'HTTPS, and Websocket server built upon NodeJS and ExpressJS. This '
      + 'serves static content via "Plugins", and is extensible by REST and '
      + 'Websocket "Dataservices" optionally present within Plugins.',

    'mfaas.api-info.apiVersionProperties.v1.title': 'Zowe Application Server API',
    'mfaas.api-info.apiVersionProperties.v1.description': 'An API for the ZLux '
      +' Proxy Server',
    'mfaas.api-info.apiVersionProperties.v1.version': '1.0.0'
  }
};

function ApimlConnector({ hostName, httpPort, httpsPort, apimlHost,
    apimlPort, tlsOptions, eurekaOverrides }) {
  Object.assign(this, { hostName, httpPort, httpsPort, apimlHost,
    apimlPort, tlsOptions, eurekaOverrides });
  this.vipAddress = hostName;
}

ApimlConnector.prototype = {
  constructor: ApimlConnector,

  setBestIpFromConfig: Promise.coroutine(function *getBaseIpFromConfig(nodeConfig) {
    const nodeIps = yield zluxUtil.uniqueIps(nodeConfig.https && nodeConfig.https.ipAddresses ? nodeConfig.https.ipAddresses : nodeConfig.http.ipAddresses);
    const eurekaIp = yield zluxUtil.uniqueIps([nodeConfig.mediationLayer.server.hostname]);
    if (nodeIps.includes(eurekaIp)) {
      this.ipAddr = zluxUtil.getLoopbackAddress(nodeIps);
      return this.ipAddr;
    } else {
      for (let i = 0; i < nodeIps.length; i++) {
        if (nodeIps[i] != '0.0.0.0') {
          this.ipAddr = nodeIps[i];
          return this.ipAddr;
        }
      }
      this.ipAddr = zluxUtil.getLoopbackAddress(nodeIps);
      return this.ipAddr;
    }
  }),

  
  checkAgent(timeout, serviceName) {
    let timer = timeout ? timeout : DEFAULT_AGENT_CHECK_TIMEOUT;
    const end = Date.now() + timer;
    
    return new Promise((resolve, reject) => {
      const options = Object.assign({
        host: this.apimlHost,
        port: this.apimlPort,
        method: 'GET',
        path: `/eureka/apps/${serviceName}`,
        headers: {'accept':'application/json'}
      }, this.tlsOptions);
      //dont need client auth, apiml will reject if these are unknown to apiml anyway.
      delete options.cert;
      delete options.key;

      
      const issueRequest = () => {
        if (Date.now() > end) {
          log.warn(`ZWED0045`, this.apimlHost, this.apimlPort);
          return reject(new Error(`Call timeout when fetching agent status from APIML`));
        }
        
        let data = [];
        
        const req = https.request(options, (res) => {
          res.on('data', (chunk) => data.push(chunk));
          res.on('end', () => {
            log.debug(`Query rc=`,res.statusCode);
            if (res.statusCode == 200) {
              resolve();
            } else {
              let dataJson;
              try {
                if (data.length > 0) {
                  dataJson = JSON.parse(Buffer.concat(data).toString());
                }
              } catch (e) {
                //leave undefined
              }
              log.warn(`Could not find agent on APIML. Trying again in ${AGENT_CHECK_RECONNECT_DELAY}ms. Code=${res.statusCode}. Body=${dataJson}`);
              setTimeout(issueRequest, AGENT_CHECK_RECONNECT_DELAY);
            }
          });
        });
        req.setTimeout(timer,()=> {
          reject(new Error(`Call timeout when fetching agent status from APIML`));
        });
        req.on('error', (error) => {
          log.warn("APIML query error:", error.message);
          setTimeout(issueRequest, AGENT_CHECK_RECONNECT_DELAY);
        });
        req.end();
      };
      
      issueRequest();
    });
  },
  
  _makeMainInstanceProperties(overrides) {
    const instance = Object.assign({}, MEDIATION_LAYER_INSTANCE_DEFAULTS);
    Object.assign(instance, overrides);

    const protocolObject = {
      httpPort: this.httpPort,
      httpsPort: this.httpsPort,
      httpEnabled: false,
      httpsEnabled: false
    };

    let mlHttpPort;
    if(this.httpPort) {
      protocolObject.httpEnabled = true;
      mlHttpPort = Number(this.httpPort);
    } else {
      protocolObject.httpEnabled = false;
      // This is a workaround for routing issues in the API ML
      // If the HTTP port is set to 0 then the API ML doesn't load zlux
      mlHttpPort = Number(this.httpsPort);
    }

    let proto, port;
    if(this.httpsPort) {
      protocolObject.httpsEnabled = true;
      proto = 'https';
      port = this.httpsPort;
    } else {
      protocolObject.httpsEnabled = false;
      proto = 'http';
      port = this.httpsPort;
    }

    log.debug("ZWED0141I", proto, port); //log.debug("Protocol:", proto, "Port", port);
    log.debug("ZWED0142I", JSON.stringify(protocolObject)); //log.debug("Protocol Object:", JSON.stringify(protocolObject));
    
    Object.assign(instance,  {
       instanceId: `${this.hostName}:zlux:${port}`,
       hostName:  this.hostName,
       ipAddr: this.ipAddr,
       vipAddress: "zlux",//this.vipAddress,
       statusPageUrl: `${proto}://${this.hostName}:${port}/server/eureka/info`,
       healthCheckUrl: `${proto}://${this.hostName}:${port}/server/eureka/health`,
       homePageUrl: `${proto}://${this.hostName}:${port}/`,
       port: {
         "$": mlHttpPort, // This is a workaround for the mediation layer
         "@enabled": ''+protocolObject.httpEnabled
       },
       securePort: {
         "$": Number(protocolObject.httpsPort),
         "@enabled": ''+protocolObject.httpsEnabled
       }
     });

     log.debug("ZWED0143I", JSON.stringify(instance)); //log.debug("API ML registration settings:", JSON.stringify(instance));

    return instance;
  },

  /*
   * TODO: commented out as this is a stretch goal
  _makeServiceInstanceProperties(appId) {
    return  {
      instanceId: `${this.zluxHostName}:${appId}:${this.zluxPort}`,
      app: appId,
      hostName: this.zluxHostName,
      ipAddr: this.zluxIpAddr,
      status: 'UP',
      port: {
        '$': this.zluxPort,
        '@enabled': true
      },
      vipAddress: this.zluxVipAddress,
      dataCenterInfo: {
        '@class': 'com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo',
        name: 'MyOwn'
      },
      leaseInfo: {
        durationInSecs: 10,
        renewalIntervalInSecs: 10
      },
      metadata: {}
    };
  },*/
  
  registerMainServerInstance() {
    const overrideOptions = this.tlsOptions.rejectUnauthorized === false
          ? {rejectUnauthorized: false} : this.tlsOptions;
    const zluxProxyServerInstanceConfig = {
      instance: this._makeMainInstanceProperties(),
      eureka: Object.assign({}, MEDIATION_LAYER_EUREKA_DEFAULTS, this.eurekaOverrides),
      requestMiddleware: function (requestOpts, done) {
        done(Object.assign(requestOpts, overrideOptions));
      }
    }
    log.debug("ZWED0144I", JSON.stringify(zluxProxyServerInstanceConfig, null, 2)); //log.debug("zluxProxyServerInstanceConfig: " 
        //+ JSON.stringify(zluxProxyServerInstanceConfig, null, 2))
    const url = `https://${this.apimlHost}:${this.apimlPort}/eureka/apps`
    zluxProxyServerInstanceConfig.eureka.serviceUrls = {
      'default': [
        url
      ]};
      log.info(`ZWED0020I`, url); //log.info(`Registering at ${url}...`);
      log.debug("ZWED0145I", JSON.stringify(zluxProxyServerInstanceConfig)); //log.debug(`zluxProxyServerInstanceConfig ${JSON.stringify(zluxProxyServerInstanceConfig)}`)
    const zluxServerEurekaClient = new eureka(zluxProxyServerInstanceConfig);
    //zluxServerEurekaClient.logger.level('debug');
    this.zluxServerEurekaClient = zluxServerEurekaClient;
    const ipAddr = this.ipAddr;
    const appServerUrl = `https://${this.apimlHost}:${this.apimlPort}/ui/v1/${zluxProxyServerInstanceConfig.instance.app}/`;
    return new Promise(function (resolve, reject) {
      zluxServerEurekaClient.start(function (error) {
        if (error) {
          log.warn('ZWED0005W', error); //log.warn(error);
          reject(error);
        } else {
          log.info('ZWED0021I', ipAddr, appServerUrl); //log.info('Eureka Client Registered from %s. Available at %s');
          resolve();
        }
      });
    });
  },
  
  /*
   * TODO: commented out as this is a stretch goal
  registerServiceInstances(plugin) {
    for (let service of plugin.dataServices) {
      const name = (service.type === 'import')? service.localName : service.name;
      const appId = `${plugin.identifier}::${name}`;
      const eurekaOptions = {
        eureka: MEDIATION_LAYER_EUREKA_DEFAULTS,
        instance: this._makeServiceInstanceProperties(appId)
      };
      const metadata = eurekaOptions.instance.metadata;
      metadata['mfaas.discovery.catalogUiTile.id'] = 
        plugin.identifier;
      metadata['mfaas.discovery.catalogUiTile.title'] = 
        `ZLUX Plugin ${plugin.identifier}`;
      metadata['mfaas.discovery.catalogUiTile.description'] = 
        `ZLUX Plugin ${plugin.identifier} v${plugin.version}`;
      metadata['mfaas.discovery.catalogUiTile.version'] = plugin.version;
      metadata['mfaas.discovery.service.title'] = appId;
      metadata['mfaas.discovery.service.description'] = 
        `ZLUX Plugin ${plugin.identifier} service ${name}`;
      metadata['mfaas.api-info.apiVersionProperties.v1.title'] = name;
      metadata['mfaas.api-info.apiVersionProperties.v1.description'] =
        `ZLUX Plugin ${plugin.identifier} service ${name}`;
      metadata['mfaas.api-info.apiVersionProperties.v1.version'] = 
        service.version;
    }
    
  }*/
}

module.exports = ApimlConnector;

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
