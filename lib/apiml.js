
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
const Promise = require("bluebird");
const eureka = require('@rocketsoftware/eureka-js-client').Eureka;
const zluxUtil = require('./util');
const https = require('https');

const log = zluxUtil.loggers.apiml;

const DEFAULT_AGENT_CHECK_TIMEOUT = 300000;
const AGENT_CHECK_RECONNECT_DELAY = 5000;
const TOKEN_NAME = 'apimlAuthenticationToken';
const TOKEN_LENGTH = TOKEN_NAME.length;


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


const MEDIATION_LAYER_INSTANCE_DEFAULTS = (zluxProto, zluxHostname, zluxPort) => { return {
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
    "apiml.routes.api__v1.gatewayUrl": "/api/v1",
    "apiml.routes.api__v1.serviceUrl": "/",
    "apiml.routes.ui__v1.gatewayUrl": "/ui/v1",
    "apiml.routes.ui__v1.serviceUrl": "/",
    "apiml.routes.ws__v1.gatewayUrl": "/ws/v1",
    "apiml.routes.ws__v1.serviceUrl": "/",

    "apiml.apiInfo.0.apiId": "org.zowe.zlux",
    "apiml.apiInfo.0.gatewayUrl": "api/v1",
    "apiml.apiInfo.0.swaggerUrl": `${zluxProto}://${zluxHostname}:${zluxPort}/api-docs/server`,
    "apiml.apiInfo.0.version": "1.0.0",

    "apiml.catalog.tile.id": "zlux",
    "apiml.catalog.tile.title": "App Server",
    "apiml.catalog.tile.description": `Zowe's App Server is the component of Zowe which serves the Zowe Desktop. It is an extensible webserver for HTTPS and Websocket APIs written using ExpressJS. Extensions are delivered as 'App Framework Plugins', and several are included by default.`,
    "apiml.catalog.tile.version": zluxUtil.getZoweVersion(),


    "apiml.service.title": "App Server",
    "apiml.service.description": `This list includes core APIs for management of plugins, management of the server itself, and APIs brought by plugins and the app server agent, ZSS. Plugins that do not bring their own API documentation are shown here as stubs.`,

    "apiml.authentication.sso": "true",

    'apiml.authentication.scheme': 'zoweJwt'
  }
}};

function ApimlConnector({ hostName, port, isHttps, discoveryHost,
    discoveryPort, tlsOptions, eurekaOverrides }) {
  Object.assign(this, { hostName, port, isHttps, discoveryHost,
    discoveryPort, tlsOptions, eurekaOverrides });
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
        host: this.discoveryHost,
        port: this.discoveryPort,
        method: 'GET',
        path: `/eureka/apps/${serviceName}`,
        headers: {'accept':'application/json'}
      }, this.tlsOptions);

      if (!this.tlsOptions.rejectUnauthorized) {
        //Keeping these certs causes an openssl error 46, unknown cert error in a dev environment
        delete options.cert;
        delete options.key;
      } //else, apiml expects a cert and will give a 403.
      
      const issueRequest = () => {
        if (Date.now() > end) {
          log.warn(`ZWED0045`, this.discoveryHost, this.discoveryPort);
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
              log.debug(`Could not find agent on APIML. Trying again in ${AGENT_CHECK_RECONNECT_DELAY}ms. Code=${res.statusCode}. Body=${dataJson}`);
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
    const protocolObject = {
      // http port is specified no matter what
      // as a workaround for routing issues in the API ML
      // If the HTTP port is set to 0 then the API ML doesn't load zlux
      httpPort: Number(this.port),
      httpsPort: Number(this.port),
      httpEnabled: !this.isHttps,
      httpsEnabled: this.isHttps
    };
    const proto = this.isHttps? 'https' : 'http';

    log.debug("ZWED0141I", proto, this.port); //"Protocol:", proto, "Port", port);
    log.debug("ZWED0142I", JSON.stringify(protocolObject)); //"Protocol Object:", JSON.stringify(protocolObject));
    
    const instance = Object.assign({}, MEDIATION_LAYER_INSTANCE_DEFAULTS(proto, this.hostName, this.port));
    Object.assign(instance, overrides);
    Object.assign(instance,  {
       instanceId: `${this.hostName}:zlux:${this.port}`,
       hostName:  this.hostName,
       ipAddr: this.ipAddr,
       vipAddress: "zlux",//this.vipAddress,
       statusPageUrl: `${proto}://${this.hostName}:${this.port}/server/eureka/info`,
       healthCheckUrl: `${proto}://${this.hostName}:${this.port}/server/eureka/health`,
       homePageUrl: `${proto}://${this.hostName}:${this.port}/`,
       port: {
         "$": protocolObject.httpPort, // This is a workaround for the mediation layer
         "@enabled": ''+protocolObject.httpEnabled
       },
       securePort: {
         "$": protocolObject.httpsPort,
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
    const overrideOptions = Object.assign({},this.tlsOptions);
    if (!this.tlsOptions.rejectUnauthorized) {
      //Keeping these certs causes an openssl error 46, unknown cert error in a dev environment
      delete overrideOptions.cert;
      delete overrideOptions.key;
    } //else, apiml expects a cert and will give a 403.

    const zluxProxyServerInstanceConfig = {
      instance: this._makeMainInstanceProperties(),
      eureka: Object.assign({}, MEDIATION_LAYER_EUREKA_DEFAULTS, this.eurekaOverrides),
      requestMiddleware: function (requestOpts, done) {
        done(Object.assign(requestOpts, overrideOptions));
      }
    }
    log.debug("ZWED0144I", JSON.stringify(zluxProxyServerInstanceConfig, null, 2)); //log.debug("zluxProxyServerInstanceConfig: " 
        //+ JSON.stringify(zluxProxyServerInstanceConfig, null, 2))
    const defaultUrl = `https://${this.discoveryHost}:${this.discoveryPort}/eureka/apps`;
    const serviceUrls = this.getServiceUrls(defaultUrl);
    zluxProxyServerInstanceConfig.eureka.serviceUrls = { default: serviceUrls };
    log.info(`ZWED0020I`, serviceUrls.join(',')); //log.info(`Registering at ${url}...`);
    log.debug("ZWED0145I", JSON.stringify(zluxProxyServerInstanceConfig)); //log.debug(`zluxProxyServerInstanceConfig ${JSON.stringify(zluxProxyServerInstanceConfig)}`)
    const eurekaClient = new eureka(zluxProxyServerInstanceConfig);
    //this library has a very simple logger that has the same function names as ours, so why not just use ours for better formatting
    eurekaClient.logger = log;
    let errorHandler = log.severe;
    let lastErrorMessage;
    let hideTimingError = (...args) => {
      if (args[0] == 'Problem making eureka request' || args[0] == 'Eureka request failed to endpoint') {
        lastErrorMessage = args;
      } else {
        errorHandler(...args);
      }
    };
    log.error = hideTimingError;
    this.eurekaClient = eurekaClient;
    const ipAddr = this.ipAddr;
    return new Promise((resolve, reject) => {
      eurekaClient.start((error) => {
        //suppress expected errors (due to timing) by substituting logger temporarily, but capture last seen error and log it after restoring error logger on connect
        log.error = errorHandler;
        if (error) {
          log.error(lastErrorMessage);
          log.warn('ZWED0005W', error); //log.warn(error);
          reject(error);
        } else {
          log.info('ZWED0021I', ipAddr);
          resolve();
        }
      });
    });
  },

  getServiceUrls(defaultUrl) {
    const discoveryServiceList = process.env['ZWE_DISCOVERY_SERVICES_LIST'] || '';
    const serviceUrls = discoveryServiceList
      .split(',')
      .map(url => url.trim())
      .filter(url => url.length > 0)
      .map(url => url + (url.endsWith('/') ? '' : '/') + 'apps');
    if (serviceUrls.length === 0) {
      serviceUrls.push(defaultUrl);
    }
    return serviceUrls;
  }
  
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
module.exports.getUserId = (apimlTkn) => {
  let base64UrlToBase64 = (input) => {
    let result = input.replace(/-/g, '+').replace(/_/g, '/');
    const padCount = result.length % 4;
    if (padCount > 0) {
      if (padCount === 1) {
        throw new Error('bad length of base64url string');
      }
      result += new Array(5 - padCount).join('=');
    }
    return result;
  }

  let userid;
  try {
    const payloadBase64Url = apimlTkn.split('.')[1];
    const payloadBase64 = base64UrlToBase64(payloadBase64Url);
    const payloadString = Buffer.from(payloadBase64, 'base64').toString();
    const payloadObject = JSON.parse(payloadString);
    userid = payloadObject.sub;
  } catch (e) {
    throw new Error(`failed to parse APIML token: ${e}`);
  }
  return userid;
}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
