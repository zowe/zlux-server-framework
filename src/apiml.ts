
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
const BBPromise = require("bluebird");
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

export class ApimlConnector {
  public hostName: any;
  public ipAddr: any;
  public httpPort: any;
  public httpsPort: any;
  public apimlConfig: any;
  public vipAddress: any;
  public zluxServerEurekaClient: any;

  constructor({ hostName, ipAddr, httpPort, httpsPort, apimlConfig }: any){
    Object.assign(this, { hostName, ipAddr, httpPort, httpsPort, apimlConfig });
    this.vipAddress = hostName;
  }

  _makeMainInstanceProperties(overrides?: any) {
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
       statusPageUrl: `${proto}://${this.hostName}:${port}/server/eureka/info`,
       healthCheckUrl: `${proto}://${this.hostName}:${port}/server/eureka/health`,
       homePageUrl: `${proto}://${this.hostName}:${port}/`,
       port: {
         "$": Number(port),
         "@enabled": true
       }
     });
    return instance;
  }

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
    (zluxProxyServerInstanceConfig.eureka as any).serviceUrls = {
      'default': [
        `${proto}://${userNameAndPassword}@${this.apimlConfig.server.hostname}`
          + `:${this.apimlConfig.server.port}/eureka/apps`
      ]};
    log.info(`Registering at ${proto}://${this.apimlConfig.server.hostname}:`
        + `${this.apimlConfig.server.port}/eureka/apps...`);
    const zluxServerEurekaClient = new eureka(zluxProxyServerInstanceConfig);
    //zluxServerEurekaClient.logger.level('debug');
    this.zluxServerEurekaClient = zluxServerEurekaClient;
    return new BBPromise(function (resolve: any, reject: any) {
      zluxServerEurekaClient.start(function (error: any) {
        if (error) {
          log.warn(error);
          reject(error);
        } else {
          log.info('Eureka Client Registered');
          resolve();
        }
       
      });
    });
  }
}

export{};
module.exports = ApimlConnector;

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
