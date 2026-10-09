/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
import * as BBPromise from 'bluebird';
import { EurekaClient } from './eureka-client';
import * as zluxUtil from './util';
import * as http from 'node:http';
import * as https from 'node:https';
import * as express from 'express';

// No type declarations available for this package; use require to suppress errors.
const eureka = require('@rocketsoftware/eureka-js-client').Eureka;
const proxy = require('./proxy');

const log = zluxUtil.loggers.apiml;

const DEFAULT_AGENT_CHECK_TIMEOUT = 300000;
const AGENT_CHECK_RECONNECT_DELAY = 5000;
const TOKEN_NAME = 'apimlAuthenticationToken';
const TOKEN_LENGTH = TOKEN_NAME.length;

// Client-supplied identity headers that must never reach the backend as-is: the
// real credential is always re-derived server-side (see addProxyAuthorizations
// in gatewayApiHandler.js/zssHandler.js), so any client-set copy is either inert
// or a forgery attempt.
const UNSAFE_INBOUND_PROXY_HEADERS = ['authorization'];
// z/OSMF's native cookie is fully reconstructed from session state (see
// gatewayApiHandler.addProxyAuthorizations), so the client's raw Cookie header
// is redundant here and only widens exposure -- unlike ZSS, which still needs
// specific cookies picked out of it (see zssHandler.addProxyAuthorizations).
const UNSAFE_INBOUND_ZOSMF_PROXY_HEADERS = UNSAFE_INBOUND_PROXY_HEADERS.concat(['cookie']);


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


const MEDIATION_LAYER_INSTANCE_DEFAULTS = (zluxProto: string, zluxHostname: string, zluxPort: number) => {
  const ipv6CompatHostname = zluxHostname.includes(':') ? '[' + zluxHostname + ']' : zluxHostname;
  
  return {
    
  instanceId: "localhost:zowe-zlux:7556",
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
    "apiml.apiInfo.0.swaggerUrl": `${zluxProto}://${ipv6CompatHostname}:${zluxPort}/api-docs/server`,
    "apiml.apiInfo.0.version": "1.0.0",

    "apiml.catalog.tile.id": "zlux",
    "apiml.catalog.tile.title": "App Server",
    "apiml.catalog.tile.description": "Zowe's App Server is the component of Zowe which serves the Zowe Desktop. It is an extensible webserver for HTTPS and Websocket APIs written using ExpressJS. Extensions are delivered as 'App Framework Plugins', and several are included by default.",
    "apiml.catalog.tile.version": zluxUtil.getZoweVersion(),


    "apiml.service.title": "App Server",
    "apiml.service.description": "This list includes core APIs for management of plugins, management of the server itself, and APIs brought by plugins and the app server agent, ZSS. Plugins that do not bring their own API documentation are shown here as stubs.",

    "apiml.authentication.sso": "true",

    'apiml.authentication.scheme': 'zoweJwt'
  }
}};

class ApimlConnector {
  isGatewayClientAttls: boolean;
  isApiCatalogClientAttls: boolean;
  vipAddress: string;
  isClientAttls: boolean;
  hostName: string;
  port: number;
  gatewayPort: number;
  catalogPort: number;
  tlsOptions: any;
  traceTls: boolean;
  discoveryUrls: string[];
  eurekaClient: EurekaClient;
  eurekaOverrides: Record<string, any>;
  ipAddr: string;

  constructor({ hostName, port, discoveryUrls, catalogPort, gatewayPort, tlsOptions, eurekaOverrides, isClientAttls, traceTls }) {
    Object.assign(this, { hostName, port, discoveryUrls, catalogPort, gatewayPort, tlsOptions, eurekaOverrides, isClientAttls, traceTls });
    //TODO config should never be checked through env var, but is temporarily needed to temporarily read gateway's ATTLS state to provide it with Eureka info it can work with.
    const clientGlobalAttls = process.env['ZWE_zowe_network_client_tls_attls'];
    const serverGlobalAttls = process.env['ZWE_zowe_network_server_tls_attls'] == 'true';

    const clientGatewayAttls = process.env['ZWE_components_gateway_zowe_network_client_tls_attls'];
    const clientAGAttls = (clientGlobalAttls == 'true') || (clientGatewayAttls == 'true');
    this.isGatewayClientAttls = false;
    if ((clientGlobalAttls === undefined) && (clientGatewayAttls === undefined)) {
      // If client attls env vars are not set, have client follow server attls variable. it simplifies common case in which users want both.
      const serverGatewayAttls = process.env['ZWE_components_gateway_zowe_network_server_tls_attls'] == 'true';
      this.isGatewayClientAttls = serverGlobalAttls || serverGatewayAttls;
    } else {
      this.isGatewayClientAttls = clientAGAttls;
    }


    //TODO config should never be checked through env var, but is temporarily needed to temporarily read apiCatalog's ATTLS state to provide it with Eureka info it can work with.
    const clientApiCatalogAttls = process.env['ZWE_components_api_catalog_zowe_network_client_tls_attls'];
    const clientACAttls = (clientGlobalAttls == 'true') || (clientApiCatalogAttls == 'true');
    this.isApiCatalogClientAttls = false;
    if ((clientGlobalAttls === undefined) && (clientApiCatalogAttls === undefined)) {
      // If client attls env vars are not set, have client follow server attls variable. it simplifies common case in which users want both.
      const serverApiCatalogAttls = process.env['ZWE_components_api_catalog_zowe_network_server_tls_attls'] == 'true';
      this.isApiCatalogClientAttls = serverGlobalAttls || serverApiCatalogAttls;
    } else {
      this.isApiCatalogClientAttls = clientACAttls;
    }


    this.vipAddress = hostName;
  }

  setBestIpFromConfig = BBPromise.coroutine(function *getBaseIpFromConfig(this: ApimlConnector, nodeConfig) {
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
  })

  checkAgent(timeout: number, serviceName: string) {
    let timer = timeout ? timeout : DEFAULT_AGENT_CHECK_TIMEOUT;
    const end = Date.now() + timer;

    return new BBPromise((resolve, reject) => {
      const issueRequest = () => {
        if (Date.now() > end) {
          log.warn(`ZWED0045W`, this.hostName, this.port);
          return reject(new Error(`Call timeout when fetching agent status from APIML`));
        }

        this.eurekaClient.getInstancesByAppId(serviceName, (error, application) => {
          if (error) {
            log.warn("ZWED0180W", 'discovery', '', error.message);
            setTimeout(issueRequest, AGENT_CHECK_RECONNECT_DELAY);
            return;
          }
          if (application && application.application) {
            resolve();
          } else {
            log.debug(`Could not find agent on APIML. Trying again in ${AGENT_CHECK_RECONNECT_DELAY}ms.`);
            setTimeout(issueRequest, AGENT_CHECK_RECONNECT_DELAY);
          }
        });
      };

      issueRequest();
    });
  }

  private _makeMainInstanceProperties(overrides?) {
    const protocolObject = {
      // http port is specified no matter what
      // as a workaround for routing issues in the API ML
      // If the HTTP port is set to 0 then the API ML doesn't load zlux
      httpPort: Number(this.port),
      httpsPort: Number(this.port),
      // TODO while the server should always be HTTPS for security,
      // When AT-TLS is used, programs need to know when AT-TLS will add TLS to their traffic
      // To align with the correct amount of TLS (Avoid no TLS and double TLS)
      // It seems the gateway wants to be told app-server is 'http' when client TLS is set on it
      // So this eureka object will be based upon that setting.
      // This may change in the future, revisit.
      httpEnabled: this.isGatewayClientAttls,
      httpsEnabled: !this.isGatewayClientAttls
    };

    log.debug("ZWED0141I", 'https', this.port); //"Protocol:", proto, "Port", port);
    log.debug("ZWED0142I", JSON.stringify(protocolObject)); //"Protocol Object:", JSON.stringify(protocolObject));

    //TODO this.isApiCatalogClientAttls is a workaround of an APIML bug in which it does not respect ATTLS when making client requests
    const zluxProto = this.isApiCatalogClientAttls === true ? 'http' : 'https';
    const ipv6CompatHostname = this.hostName.includes(':') ? '[' + this.hostName + ']' : this.hostName;
    const instance = Object.assign({}, MEDIATION_LAYER_INSTANCE_DEFAULTS(zluxProto, this.hostName, this.port));
    Object.assign(instance, overrides);

    Object.assign(instance,  {
      instanceId: `${ipv6CompatHostname}:zlux:${this.port}`,
      hostName:  this.hostName,
      ipAddr: this.ipAddr,
      vipAddress: "zlux",//this.vipAddress,
      statusPageUrl: `${zluxProto}://${ipv6CompatHostname}:${this.port}/server/info`,
      healthCheckUrl: `${zluxProto}://${ipv6CompatHostname}:${this.port}/server/health`,
      secureHealthCheckUrl: `https://${ipv6CompatHostname}:${this.port}/server/health`,
      homePageUrl: `${zluxProto}://${ipv6CompatHostname}:${this.port}/`,
      port: {
        "$": protocolObject.httpPort, // This is a workaround for the mediation layer
        "@enabled": ''+protocolObject.httpEnabled
      },
      securePort: {
        "$": protocolObject.httpsPort,
        "@enabled": ''+protocolObject.httpsEnabled
      }
    });
    // TODO: replace this with a single variable for detecting AT-TLS?
    if (this.isGatewayClientAttls) {
      let allowedOrigins = `https://${this.hostName}:${this.gatewayPort}`;
      if (this.catalogPort != null && `${this.catalogPort}`.trim().length > 0) {
        allowedOrigins = `${allowedOrigins},https://${this.hostName}:${this.catalogPort}`
      }
      Object.assign(instance.metadata, {
        "apiml.corsEnabled": "true",
        "apiml.corsAllowedOrigins": allowedOrigins
      })
    }

    log.debug("ZWED0143I", JSON.stringify(instance)); //log.debug("API ML registration settings:", JSON.stringify(instance));

    return instance;
  }
  
  registerMainServerInstance() {
    const overrideOptions = this.isClientAttls
          ? {}
    //Use server's own TLS options except for TLS tracing.
          : Object.assign(Object.assign({},this.tlsOptions), {enableTrace: this.traceTls ? true : false});
    
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
      },
      tlsOptions: overrideOptions,
      ssl: !this.isClientAttls,
      logger: log
    }
    log.debug("ZWED0144I", JSON.stringify(zluxProxyServerInstanceConfig, null, 2)); //log.debug("zluxProxyServerInstanceConfig: " 
        //+ JSON.stringify(zluxProxyServerInstanceConfig, null, 2))
    const serviceUrls = this.getServiceUrls();
    zluxProxyServerInstanceConfig.eureka.serviceUrls = { default: serviceUrls };
    log.info(`ZWED0020I`, serviceUrls.join(',')); //log.info(`Registering at ${url}...`);
    log.debug("ZWED0145I", JSON.stringify(zluxProxyServerInstanceConfig)); //log.debug(`zluxProxyServerInstanceConfig ${JSON.stringify(zluxProxyServerInstanceConfig)}`)
    const eurekaClient = new EurekaClient(zluxProxyServerInstanceConfig as any);
    this.eurekaClient = eurekaClient;
    const ipAddr = this.ipAddr;
    return new BBPromise((resolve, reject) => {
      eurekaClient.start((error) => {
        if (error) {
          log.warn('ZWED0005W', error); //log.warn(error);
          reject(error);
        } else {
          log.info('ZWED0021I', ipAddr);
          resolve();
        }
      });
    });
  }

  getServiceUrls(): string[] {
    let urls = this.discoveryUrls.map(url => url + (url.endsWith('/') ? '' : '/') + 'apps');
    if (this.isClientAttls) {
      return urls.map(url => url.replaceAll('https', 'http'));
    } else {
      return urls;
    }
  }

  getRequestOptionsArray(method, path) {
    return this.discoveryUrls.map((url)=>{
      //in the form of https://host:port/eureka/, trim from https:// and following slash.
      // the url may have brackets for ipv6, which must be removed.
      let hostAndPort = zluxUtil.getHostAndPortFromUrl(url);
      const options = Object.assign({
        host: hostAndPort.host,
        port: hostAndPort.port,
        method: method,
        path: path,
        headers: {'accept':'application/json'}
      }, this.tlsOptions);

      if (!this.tlsOptions.rejectUnauthorized) {
        //Keeping these certs causes an openssl error 46, unknown cert error in a dev environment
        delete options.cert;
        delete options.key;
      } //else, apiml expects a cert and will give a 403.
      return options;
    });
  }

  /**
   * The URL path prefix at which the z/OSMF fallback proxy is mounted.
   */
  static readonly ZOSMF_PROXY_PATH = '/ibmzosmf/api/v1';

  /**
   * The URL path prefix at which the ZSS fallback proxy is mounted.
   */
  static readonly ZSS_PROXY_PATH = '/zss/api/v1';

  static isApimlAvailable(zoweConfig: any): boolean {
    const mediationLayerEnabled =
      zoweConfig?.components?.['app-server']?.node?.mediationLayer?.enabled;
    if (!mediationLayerEnabled) {
      return false;
    }
    if (zoweConfig?.components?.apiml?.enabled === false) {
      if (zoweConfig?.components?.gateway?.enabled === false) {
        return false;
      }
      if (zoweConfig?.components?.discovery?.enabled === false) {
        return false;
      }
    }
    return true;
  }

  /**
   * Conditionally installs a direct reverse proxy from /ibmzosmf/api/v1 to
   * the z/OSMF server configured in the Zowe YAML.  No-op when APIML is
   * available (the gateway already exposes the ibmzosmf route).
   *
   * @param authMiddleware - Express middleware (normally auth.middleware)
   *   that must authenticate the caller before the request reaches z/OSMF.
   *   Required: without it this proxy would be reachable anonymously.
   */
  static installZosmfProxy(
    expressApp: express.Application,
    zoweConfig: any,
    tlsOptions: https.AgentOptions,
    auth: { addProxyAuthorizations: (req: any, options: any) => void } | undefined,
    authMiddleware: express.RequestHandler
  ): void {
    if (ApimlConnector.isApimlAvailable(zoweConfig)) {
      log.debug('skipping direct z/OSMF proxy setup at %s.', ApimlConnector.ZOSMF_PROXY_PATH);
      return;
    }

    const zosmf = zoweConfig?.zOSMF;
    if (!zosmf || !zosmf.host || !zosmf.port) {
      log.debug('z/OSMF host or port not configured in Zowe config. Cannot set up direct z/OSMF proxy at %s.', ApimlConnector.ZOSMF_PROXY_PATH);
      return;
    }

    if (!authMiddleware) {
      log.warn('ZWED0185W', ApimlConnector.ZOSMF_PROXY_PATH);
      return;
    }

    const useAttls = zluxUtil.isClientAttls(zoweConfig);
    const isHttps = !useAttls;
    const allowInvalidTls = !!(zoweConfig?.components?.['app-server']?.node?.allowInvalidTLSProxy);

    let proxyTlsOptions: any = {};
    if (isHttps && tlsOptions) {
      proxyTlsOptions = Object.assign({}, tlsOptions);
      delete proxyTlsOptions.key;
      delete proxyTlsOptions.cert;
    }

    log.info('ZWED0307I', ApimlConnector.ZOSMF_PROXY_PATH, isHttps ? 'https' : 'http', zosmf.host, zosmf.port);

    const router = express.Router();
    // Gate every request on the normal zlux session before it can reach z/OSMF.
    router.use(authMiddleware);
    const proxyHandler = proxy.makeSimpleProxy(
      zosmf.host,
      zosmf.port,
      {
        urlPrefix: '',
        isHttps,
        addProxyAuthorizations: auth ? auth.addProxyAuthorizations.bind(auth) : null,
        processProxiedHeaders: null,
        allowInvalidTLSProxy: allowInvalidTls,
        tlsOptions: proxyTlsOptions,
        requestProcessingOptions: { headersToRemove: UNSAFE_INBOUND_ZOSMF_PROXY_HEADERS }
      },
      'ibmzosmf',
      'api/v1'
    );
    router.use(proxyHandler);
    expressApp.use(ApimlConnector.ZOSMF_PROXY_PATH, router);
  }

  /**
   * Conditionally installs a direct reverse proxy from /zss/api/v1 to the
   * ZSS agent configured in the Zowe YAML.   
   *
   * @param authMiddleware - Express middleware (normally auth.middleware)
   *   that must authenticate the caller before the request reaches ZSS.
   *   Required: without it this proxy would be reachable anonymously.
   */
  static installZssProxy(
    expressApp: express.Application,
    zoweConfig: any,
    tlsOptions: https.AgentOptions,
    auth: { addProxyAuthorizations: (req: any, options: any) => void; processProxiedHeaders: (req: any, headers: any) => any } | undefined,
    authMiddleware: express.RequestHandler
  ): void {
    if (ApimlConnector.isApimlAvailable(zoweConfig)) {
      log.debug('skipping direct ZSS proxy setup at %s.', ApimlConnector.ZSS_PROXY_PATH);
      return;
    }

    const agentConfig = zoweConfig?.components?.['app-server']?.agent;
    const port = agentConfig?.https?.port || agentConfig?.http?.port;
    if (!agentConfig || !agentConfig.host || !port) {
      log.debug('ZSS agent host or port not configured in Zowe config. Cannot set up direct ZSS proxy at %s.', ApimlConnector.ZSS_PROXY_PATH);
      return;
    }

    if (!authMiddleware) {
      log.warn('ZWED0185W', ApimlConnector.ZSS_PROXY_PATH);
      return;
    }

    const useAttls = zluxUtil.isClientAttls(zoweConfig);
    // Deliberately does not reuse util.getAgentRequestOptions: its useApiml
    // branch would route through the (absent) gateway instead of straight to ZSS.
    const isHttps = !useAttls;
    const allowInvalidTls = !!(zoweConfig?.components?.['app-server']?.node?.allowInvalidTLSProxy);

    // Unlike the z/OSMF proxy, ZSS expects mTLS from the app-server, so the
    // client cert/key are kept rather than stripped.
    let proxyTlsOptions: any = {};
    if (isHttps && tlsOptions && !allowInvalidTls) {
      proxyTlsOptions = tlsOptions;
    }

    log.info('ZWED0307I', ApimlConnector.ZSS_PROXY_PATH, isHttps ? 'https' : 'http', agentConfig.host, port);

    const router = express.Router();
    // Gate every request on the normal zlux session before it can reach ZSS.
    router.use(authMiddleware);
    const proxyHandler = proxy.makeSimpleProxy(
      agentConfig.host,
      port,
      {
        urlPrefix: '',
        isHttps,
        addProxyAuthorizations: auth ? auth.addProxyAuthorizations.bind(auth) : null,
        processProxiedHeaders: auth ? auth.processProxiedHeaders.bind(auth) : null,
        allowInvalidTLSProxy: allowInvalidTls,
        tlsOptions: proxyTlsOptions,
        requestProcessingOptions: { headersToRemove: UNSAFE_INBOUND_PROXY_HEADERS }
      },
      'zss',
      'api/v1'
    );
    router.use(proxyHandler);
    expressApp.use(ApimlConnector.ZSS_PROXY_PATH, router);
  }

  /**
   * When APIML is unavailable, installs a GET /gateway/api/v1/auth/query
   * fallback route that decodes the apimlAuthenticationToken cookie locally
   * and returns { domain, userId, creation, expiration }.
   *
  * @param getAuthPlugin - Resolves the loaded auth plugin that advertises
  *   canIssueJWT===true. Token validation is delegated to its queryJWT()
  *   method. When no plugin is available, the route returns 501.
   */
  static installGatewayAuthQueryRoute(
    expressApp: express.Application,
    zoweConfig: any,
    getAuthPlugin: () => { jwtCookieName: string; queryJWT(token: string): Promise<{ userId: string; creation: number; expiration: number; domain?: string | null }> } | undefined
  ): void {
    if (ApimlConnector.isApimlAvailable(zoweConfig)) { return; }
    const zosmfPresent = !!(zoweConfig?.zOSMF?.host && zoweConfig?.zOSMF?.port);
    if (!zosmfPresent) { return; }

    const handler = (req: express.Request, res: express.Response) => {
      const authPlugin = getAuthPlugin();
      if (!authPlugin) {
        return res.status(501).json({ messages: [{ messageNumber: 'ZWED0170E', messageContent: 'Cannot handle message' }] });
      }
      const cookieName: string = authPlugin.jwtCookieName || TOKEN_NAME;
      // Cookie takes precedence; Authorization: Bearer is the fallback for
      // non-browser API clients that cannot store cookies.
      const cookieToken: string | undefined  = (req as any).cookies && (req as any).cookies[cookieName];
      const authHeader: string | undefined   = req.headers['authorization'] as string | undefined;
      const bearerToken: string | undefined  = (!cookieToken && authHeader && authHeader.startsWith('Bearer '))
        ? (authHeader.slice(7).trim() || undefined)
        : undefined;
      const token = cookieToken || bearerToken;
      if (!token) {
        return res.status(401).json({ messages: [{ messageNumber: 'ZWED0167E', messageContent: 'No authentication token present' }] });
      }
      authPlugin.queryJWT(token).then((data) => {
        const now = Date.now();
        if (data.expiration <= now) {
          return res.status(401).json({ messages: [{ messageNumber: 'ZWED0168E', messageContent: 'Token invalid' }] });
        }
        return res.status(200).json({
          domain:     data.domain ?? null,
          userId:     data.userId,
          creation:   data.creation,
          expiration: data.expiration
        });
      }).catch((e: Error) => {
        log.debug('/gateway/api/v1/auth/query token validation failed: %s', e.message);
        return res.status(401).json({ messages: [{ messageNumber: 'ZWED0169E', messageContent: 'Token invalid' }] });
      });
    };

    /*
     * Both /gateway/ and /zaas/ prefixes are registered for every auth route.
     */
    for (const prefix of ['/gateway/api/v1/auth', '/zaas/api/v1/auth']) {
      expressApp.get(`${prefix}/query`, handler);
    }
  }

  /**
   * Routes installed:
   *   GET /gateway/api/v1/auth/keys/public/current   – current signing key as JWK Set; used by ZSS (zss.c:1014)
   *   GET /gateway/api/v1/auth/keys/public/all       – union of all keys as JWK Set (same here; no rotation)
   *   And zaas aliases
   *
   * Note: the bare /keys/public path (no suffix) is intentionally NOT
   * registered.
   *
  * @param getJwkPlugin - Resolves the loaded plugin with canIssueJWT===true.
  *   When no plugin is available, the routes return 501.
   */
  static installGatewayAuthKeysRoutes(
    expressApp: express.Application,
    zoweConfig: any,
    getJwkPlugin: () => { getJwkSet(): Promise<{ keys: object[] }> } | undefined
  ): void {
    if (ApimlConnector.isApimlAvailable(zoweConfig)) {
      return;
    }
    const zosmfPresent = !!(zoweConfig?.zOSMF?.host && zoweConfig?.zOSMF?.port);
    if (!zosmfPresent) { return; }

    const handler = (req: express.Request, res: express.Response) => {
      const jwkPlugin = getJwkPlugin();
      if (!jwkPlugin) {
        return res.status(501).json({ messages: [{ messageNumber: 'ZWED0208E', messageContent: 'No JWK-capable auth plugin is registered' }] });
      }
      jwkPlugin.getJwkSet().then((jwkSet) => {
        return res.status(200).json(jwkSet);
      }).catch((e: Error) => {
        log.severe('ZWED0161E', e.message);
        return res.status(500).json({ messages: [{ messageNumber: 'ZWED0161E', messageContent: 'Failed to retrieve JWK Set' }] });
      });
    };

    // Both /gateway/ and /zaas/ prefixes — see installGatewayAuthQueryRoute for rationale.
    for (const prefix of ['/gateway/api/v1/auth', '/zaas/api/v1/auth']) {
      expressApp.get(`${prefix}/keys/public/current`, handler);
      expressApp.get(`${prefix}/keys/public/all`, handler);
    }
  }

  static installGatewayAuthTicketRoute(
    expressApp: express.Application,
    zoweConfig: any,
    auth: { doPassTicket(req: any, res: any, responseFormatter?: any): any }
  ): void {
    if (ApimlConnector.isApimlAvailable(zoweConfig)) {
      return;
    }
  }

  /**
   * Wraps auth.doPassTicket with a gateway-format responseFormatter.
   */
  static createGatewayTicketHandler(auth: {
    doPassTicket(req: any, res: any, responseFormatter?: any): any;
  }): (req: express.Request, res: express.Response) => any {
    const formatter = ApimlConnector.createGatewayTicketFormatter();
    return function ticketHandler(req, res) {
      return auth.doPassTicket(req, res, formatter);
    };
  }

  /**
   * Creates a response-formatter for the gateway /auth/ticket endpoint.
   */
  static createGatewayTicketFormatter(): {
    sendPassTicketResult(res: express.Response, result: any): void;
    sendPassTicketError(res: express.Response, statusCode: number, error: any): void;
  } {
    return {
      sendPassTicketResult(res, result) {
        return res.status(200).json({
          token: (res.req as any).cookies?.apimlAuthenticationToken || null,
          userId: result.userId,
          applicationName: result.applicationName,
          ticket: result.ticket
        });
      },
      sendPassTicketError(res, statusCode, error) {
        const messageContent = error.error || error.message || 'Unknown error';
        return res.status(statusCode).json({
          messages: [{ messageNumber: 'ZWED0212E', messageContent }]
        });
      }
    };
  }

  static getUserId(apimlTkn: string): string {
    let base64UrlToBase64 = (input: string): string => {
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

    let userid: string;
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

  /**
   * Extracts credentials from a gateway-format login request.
   * Tries JSON body {username, password} first, then falls back to
   * Authorization: Basic header.
   */
  static parseGatewayCredentials(req: any): { username: string; password: string } | null {
    if (req.body && req.body.username && req.body.password !== undefined) {
      return { username: req.body.username, password: req.body.password };
    }
    const authHeader: string | undefined = req.headers && req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const colonIndex = decoded.indexOf(':');
      if (colonIndex !== -1) {
        return { username: decoded.slice(0, colonIndex), password: decoded.slice(colonIndex + 1) };
      }
    }
    return null;
  }

  /**
   * Creates a response-formatter object that knows how to translate a generic
   * zlux auth result into the APIML-compatible format.
   */
  static createGatewayResponseFormatter(): {
    sendAuthResult(res: express.Response, result: any, wasExpiredPassword: boolean): void;
    sendAuthException(res: express.Response, error: Error): void;
    sendLogoutResult(res: express.Response, result: any): void;
    sendRateLimitError(res: express.Response, retryAfterSec: number): void;
  } {
    return {
      sendAuthResult(res, result, wasExpiredPassword) {
        if (wasExpiredPassword) {
          return res.status(401).json({ messages: [{ messageNumber: 'ZWED0310E', messageContent: 'Password expired' }] });
        }
        if (result.success) {
          return res.status(204).end();
        }
        return res.status(401).json({ messages: [{ messageNumber: 'ZWED0311E', messageContent: 'Authentication failed' }] });
      },
      sendAuthException(res, error) {
        return res.status(500).json({ messages: [{ messageNumber: 'ZWED0312E', messageContent: error.message }] });
      },
      sendLogoutResult(res, _result) {
        return res.status(204).end();
      },
      sendRateLimitError(res, retryAfterSec) {
        return res.status(429).json({ messages: [{ messageNumber: 'ZWED0314E', messageContent: `Too many failed login attempts. Retry after ${retryAfterSec} seconds.` }] });
      }
    };
  }

  static createGatewayAuthHandlers(auth: {
    doLogin(req: any, res: any, responseFormatter?: any): any;
    doLogout(req: any, res: any, responseFormatter?: any): any;
    doRefresh(req: any, res: any, responseFormatter?: any): any;
  }): {
    login(req: express.Request, res: express.Response): any;
    logout(req: express.Request, res: express.Response): any;
    refresh(req: express.Request, res: express.Response): any;
  } {
    const formatter = ApimlConnector.createGatewayResponseFormatter();
    return {
      login(req, res) {
        const creds = ApimlConnector.parseGatewayCredentials(req);
        if (!creds) {
          return res.status(400).json({ messages: [{ messageNumber: 'ZWED0313E', messageContent: 'No credentials provided. Supply username/password in the request body or as an Authorization: Basic header' }] });
        }
        (req as any).body = Object.assign({}, (req as any).body, { username: creds.username, password: creds.password });
        return auth.doLogin(req, res, formatter);
      },
      logout(req, res) {
        return auth.doLogout(req, res, formatter);
      },
      refresh(req, res) {
        return auth.doRefresh(req, res, formatter);
      }
    };
  }
}

export = ApimlConnector;

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
