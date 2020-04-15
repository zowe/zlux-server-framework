
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

const log = zluxUtil.loggers.apiml;

const MEDIATION_LAYER_EUREKA_DEFAULTS = {
  "preferSameZone": false,
  "requestRetryDelay": 10000,
  "heartbeatInterval": 3000,
  "registryFetchInterval": 3000,
  "fetchRegistry": true,
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
    durationInSecs: 10,
    renewalIntervalInSecs: 10
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

function ApimlConnector({ hostName, ipAddr, httpPort, httpsPort, apimlHost, 
    apimlPort, tlsOptions, eurekaOverrides }) {
  Object.assign(this, { hostName, ipAddr, httpPort, httpsPort, apimlHost, 
    apimlPort, tlsOptions, eurekaOverrides });
  this.vipAddress = hostName;
}

ApimlConnector.prototype = {
  constructor: ApimlConnector,
  
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
    return new Promise(function (resolve, reject) {
      zluxServerEurekaClient.start(function (error) {
        if (error) {
          log.warn('ZWED0005W', error); //log.warn(error);
          reject(error);
        } else {
          log.info('ZWED0021I'); //log.info('Eureka Client Registered');
          resolve();
        }
      });
    });
  },
  
  getZluxInstances() {
    const eurekaClient = this.zluxServerEurekaClient;
    return new Promise((resolve, reject) => {
      eurekaClient.once('registryUpdated', () => {
        const zluxInstances = eurekaClient.getInstancesByVipAddress('ZLUX');
        log.info(`registry updated, zluxInstances ${JSON.stringify(zluxInstances, null, 2)}`);
        resolve(zluxInstances);
      });
    });
  },

  takeIntoService() {
    log.info(`takeIntoService`);
    return this._deleteOverriddenStatus();
  },
  
  takeOutOfService() {
    log.info(`takeOutOfservice`);
    return this._overrideStatus('OUT_OF_SERVICE');
  },
  
  takeInstanceOutOfService(instanceId) {
    log.info(`takeInstanceOutOfService ${instanceId}`);
    return this._overrideStatusForInstance(instanceId, 'OUT_OF_SERVICE');
  },
  
  _overrideStatus(status) {
    return this._overrideStatusForInstance(this.zluxServerEurekaClient.instanceId, status);
  },
  
  _overrideStatusForInstance(instanceId, status) {
    return new Promise((resolve, reject) => {
      this.zluxServerEurekaClient.eurekaRequest({
        method: 'PUT',
        uri: `${this.zluxServerEurekaClient.config.instance.app}/${instanceId}/status?value=${status}`
      }, (err) => {
        if (err) {
          console.log(`_overrideStatus error ${JSON.stringify(err)}`);
          reject(err);
        } else {
          resolve();
        }
      })
    })
  },
  
  _deleteOverriddenStatus() {
    return new Promise((resolve, reject) => {
      this.zluxServerEurekaClient.eurekaRequest({
        method: 'DELETE',
        uri: `${this.zluxServerEurekaClient.config.instance.app}/${this.zluxServerEurekaClient.instanceId}/status`
      }, (err) => {
        if (err) {
          console.log(`_deleteOverriddenStatus error ${JSON.stringify(err)}`);
          reject(err);
        } else {
          resolve();
        }
      })
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
