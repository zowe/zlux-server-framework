const Promise = require("bluebird");
const eureka = require('eureka-js-client').Eureka;
const zluxUtil = require('./util');

const log = zluxUtil.loggers.apiml;

const MEDIATION_LAYER_EUREKA_DEFAULTS = {
  "preferSameZone": false,
  "requestRetryDelay": 10000,
  "heartbeatInterval": 3000,
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
    durationInSecs: 10,
    renewalIntervalInSecs: 10
  },
  metadata: {
    "routed-services.1.gateway-url": "/api/v1",
    "routed-services.1.service-url": "/ZLUX",
    "routed-services.2.gateway-url": "/ui/v1",
    "routed-services.2.service-url": "/ZLUX",
    "routed-services.3.gateway-url": "/ws/v1",
    "routed-services.3.service-url": "/ZLUX",
    "routed-services.4.gateway-url": "/v1/api-doc",
    "routed-services.4.service-url": "/ZLUX",

    'mfaas.discovery.catalogUiTile.id': 'zlux',
    'mfaas.discovery.catalogUiTile.title': 'ZLux Proxy Server',
    'mfaas.discovery.catalogUiTile.description': 'The Proxy Server is an '
       + 'HTTP, HTTPS, and Websocket server built upon NodeJS and ExpressJS. '
       + 'This serves static content via "Plugins", and is extensible by '
       + 'REST and Websocket "Dataservices" optionally present within Plugins.',
    'mfaas.discovery.catalogUiTile.version': '1.0.0',

    'mfaas.discovery.service.title': 'ZLux Proxy Server',
    'mfaas.discovery.service.description': 'The Proxy Server is an HTTP, '
      + 'HTTPS, and Websocket server built upon NodeJS and ExpressJS. This '
      + 'serves static content via "Plugins", and is extensible by REST and '
      + 'Websocket "Dataservices" optionally present within Plugins.',

    'mfaas.api-info.apiVersionProperties.v1.title': 'ZLux Proxy Server API',
    'mfaas.api-info.apiVersionProperties.v1.description': 'An API for the ZLux '
      +' Proxy Server',
    'mfaas.api-info.apiVersionProperties.v1.version': '1.0.0'
  }
};

function ApimlConnector({ hostName, ipAddr, httpPort, httpsPort, apimlConfig }) {
  Object.assign(this, { hostName, ipAddr, httpPort, httpsPort, apimlConfig });
  this.vipAddress = hostName;
}

ApimlConnector.prototype = {
  constructor: ApimlConnector,
  
  _makeMainInstanceProperties(overrides) {
    const instance = Object.assign({}, MEDIATION_LAYER_INSTANCE_DEFAULTS);
    Object.assign(instance, overrides);
    const isHttps = this.httpsPort? true : false;
    let port;
    let proto;
    if (false && isHttps) {
      port = this.httpsPort;
      proto = 'https';
    } else {
      port = this.httpPort;
      proto = 'http';
    }
    Object.assign(instance,  {
       instanceId: `${this.hostName}:zlux:${port}`,
       hostName:  this.hostName,
       ipAddr: this.ipAddr,
       vipAddress: "zlux",//this.vipAddress,
       statusPageUrl: `${proto}://${this.hostName}:${port}/application/info`,
       healthCheckUrl: `${proto}://${this.hostName}:${port}/application/health`,
       homePageUrl: `${proto}://${this.hostName}:${port}/`,
       port: {
         "$": Number(port),
         "@enabled": true
       }
     });
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
    const zluxProxyServerInstanceConfig = {
      instance: this._makeMainInstanceProperties(),
      eureka: Object.assign({}, MEDIATION_LAYER_EUREKA_DEFAULTS)
    }
    log.debug("zluxProxyServerInstanceConfig: " 
        + JSON.stringify(zluxProxyServerInstanceConfig, null, 2))
    const proto = this.apimlConfig.server.isHttps? 'https' : 'http';
    const userNameAndPassword = this.apimlConfig.server.username?
        `${this.apimlConfig.server.username}:${this.apimlConfig.server.password}`
          : '';
    zluxProxyServerInstanceConfig.eureka.serviceUrls = {
      'default': [
        `${proto}://${userNameAndPassword}@${this.apimlConfig.server.hostname}`
          + `:${this.apimlConfig.server.port}/eureka/apps`
      ]};
    log.info(`Registering at ${proto}://${this.apimlConfig.server.hostname}:`
        + `${this.apimlConfig.server.port}/eureka/apps...`);
    const zluxServerEurekaClient = new eureka(zluxProxyServerInstanceConfig);
    //zluxServerEurekaClient.logger.level('debug');
    this.zluxServerEurekaClient = zluxServerEurekaClient;
    return new Promise(function (resolve, reject) {
      zluxServerEurekaClient.start(function (error) {
        if (error) {
          log.warn(error);
          reject(error);
        } else {
          log.info('Eureka Client Registered');
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
