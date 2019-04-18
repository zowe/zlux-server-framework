"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
            + ' Proxy Server',
        'mfaas.api-info.apiVersionProperties.v1.version': '1.0.0'
    }
};
class ApimlConnector {
    constructor({ hostName, ipAddr, httpPort, httpsPort, apimlHost, apimlPort, tlsOptions }) {
        Object.assign(this, { hostName, ipAddr, httpPort, httpsPort, apimlHost, apimlPort, tlsOptions });
        this.vipAddress = hostName;
    }
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
        if (this.httpPort) {
            protocolObject.httpEnabled = true;
            mlHttpPort = Number(this.httpPort);
        }
        else {
            protocolObject.httpEnabled = false;
            // This is a workaround for routing issues in the API ML
            // If the HTTP port is set to 0 then the API ML doesn't load zlux
            mlHttpPort = Number(this.httpsPort);
        }
        let proto, port;
        if (this.httpsPort) {
            protocolObject.httpsEnabled = true;
            proto = 'https';
            port = this.httpsPort;
        }
        else {
            protocolObject.httpsEnabled = false;
            proto = 'http';
            port = this.httpsPort;
        }
        log.debug("Protocol:", proto, "Port", port);
        log.debug("Protocol Object:", JSON.stringify(protocolObject));
        Object.assign(instance, {
            instanceId: `${this.hostName}:zlux:${port}`,
            hostName: this.hostName,
            ipAddr: this.ipAddr,
            vipAddress: "zlux",
            statusPageUrl: `${proto}://${this.hostName}:${port}/server/eureka/info`,
            healthCheckUrl: `${proto}://${this.hostName}:${port}/server/eureka/health`,
            homePageUrl: `${proto}://${this.hostName}:${port}/`,
            port: {
                "$": mlHttpPort,
                "@enabled": protocolObject.httpEnabled
            },
            securePort: {
                "$": Number(protocolObject.httpsPort),
                "@enabled": protocolObject.httpsEnabled
            }
        });
        log.debug("API ML registration settings:", JSON.stringify(instance));
        return instance;
    }
    registerMainServerInstance() {
        const zluxProxyServerInstanceConfig = {
            instance: this._makeMainInstanceProperties(),
            eureka: Object.assign({}, MEDIATION_LAYER_EUREKA_DEFAULTS),
            requestMiddleware: (requestOpts, done) => {
                const { pfx, ca, cert, key, passphrase } = this.tlsOptions;
                Object.assign(requestOpts, { pfx, ca, cert, key, passphrase });
                done(requestOpts);
            }
        };
        log.debug("zluxProxyServerInstanceConfig: "
            + JSON.stringify(zluxProxyServerInstanceConfig, null, 2));
        const url = `https://${this.apimlHost}:${this.apimlPort}/eureka/apps`;
        zluxProxyServerInstanceConfig.eureka.serviceUrls = {
            'default': [
                url
            ]
        };
        log.info(`Registering at ${url}...`);
        log.debug(`zluxProxyServerInstanceConfig ${JSON.stringify(zluxProxyServerInstanceConfig)}`);
        const zluxServerEurekaClient = new eureka(zluxProxyServerInstanceConfig);
        //zluxServerEurekaClient.logger.level('debug');
        this.zluxServerEurekaClient = zluxServerEurekaClient;
        return new BBPromise(function (resolve, reject) {
            zluxServerEurekaClient.start(function (error) {
                if (error) {
                    log.warn(error);
                    reject(error);
                }
                else {
                    log.info('Eureka Client Registered');
                    resolve();
                }
            });
        });
    }
}
exports.ApimlConnector = ApimlConnector;
module.exports = ApimlConnector;
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
//# sourceMappingURL=apiml.js.map