

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';
const express = require('express');
const util = require('util');
const url = require('url');
const expressWs = require('express-ws');
const path = require('path');
const Promise = require('bluebird');
const http = require('http');
const bodyParser = require('body-parser');
const session = require('express-session');
const zluxUtil = require('./util');
const configService = require('../plugins/config/lib/configService.js');
const proxy = require('./proxy');
const zLuxUrl = require('./url');
const makeSwaggerCatalog = require('./swagger-catalog');
const UNP = require('./unp-constants');

/**
 * Sets up an Express application to serve plugin data files and services  
 */

const DEFAULT_SESSION_TIMEOUT_MS = 60 /* min */ * 60 * 1000;

const SERVICE_TYPE_NODE = 0;
const SERVICE_TYPE_PROXY = 1;
const PROXY_SERVER_CONFIGJS_URL = '/plugins/com.rs.configjs/services/data/';
//TODO: move this (and other consts) to a commonly accessible constants file when moving to typescript
const WEBSOCKET_CLOSE_INTERNAL_ERROR = 4999; 
const WEBSOCKET_CLOSE_BY_PROXY = 4998;
const WEBSOCKET_CLOSE_CODE_MINIMUM = 3000;
const DEFAULT_READBODY_LIMIT = process.env.ZLUX_DEFAULT_READBODY_LIMIT || 102400;//100kb

var contentLogger = zluxUtil.loggers.contentLogger;
var bootstrapLogger = zluxUtil.loggers.bootstrapLogger;
var installLog = zluxUtil.loggers.installLogger;
var utilLog = zluxUtil.loggers.utilLogger;

const jsonParser = bodyParser.json()
const urlencodedParser = bodyParser.urlencoded({ extended: false })

function DataserviceContext(serviceDefinition, serviceConfiguration, 
    pluginContext) {
  this.serviceDefinition = serviceDefinition;
  this.serviceConfiguration = serviceConfiguration;
  this.plugin = pluginContext;
  this.logger = global.COM_RS_COMMON_LOGGER.makeComponentLogger(
    pluginContext.pluginDef.identifier + "." + serviceDefinition.name);
}
DataserviceContext.prototype = {
  makeSublogger(name) {
    return makeSubloggerFromDefinitions(this.plugin.pluginDef,
        this.serviceDefinition, name);
  },
  addBodyParseMiddleware(router) {
    router.use(bodyParser.json({type:'application/json'}));
    router.use(bodyParser.text({type:'text/plain'}));
    router.use(bodyParser.text({type:'text/html'}));
  }
};

function do404(URL, res, message) {
  contentLogger.debug("404: "+message+", url="+URL);
  res.statusMessage = message;
  res.status(404).send("<h1>"+message+"</h1>");
}

function sendAuthenticationFailure(res, authType) {
  res.status(401).json({
    'error':'unauthorized',
    'plugin':pluginDefinition.identifier,
    'service':serviceDefinition.name,
    'authenticationType':authType
  });
};
function sendAuthorizationFailure(res, authType, resource) {
  res.status(403).json({
    'error':'forbidden',
    'plugin':pluginDefinition.identifier,
    'service':serviceDefinition.name,
    'authenticationType':authType,
    'resource':resource
  });
};

const staticHandlers = {
  ng2TypeScript: function(ng2Ts) { 
    return function(req, res) {
      contentLogger.log(contentLogger.FINER,"generated ng2 module:\n"+util.inspect(ng2Ts));
      res.setHeader("Content-Type", "text/typescript");
      res.setHeader("Server", "jdmfws");
      res.status(200).send(ng2Ts);
    }
  },

  plugins: function(plugins) {
    return function(req, res) {
      let parsedRequest = url.parse(req.url, true);
      if (!parsedRequest.query) {
        do404(req.url, res, "A plugin query must be specified");
        return;
      }
      let type = parsedRequest.query["type"];
      /*
        Note: here, we query for installed plugins using a filter of either 'all' or a specific pluginType.
        But, some plugins do not have pluginTypes currently. People can forget to include that information.
        In our code, we've been assuming that plugins that do not declare a type are of type 'application',
        but this should be enforced somehow in the future.
      */
      if (!type) {
        do404(req.url, res, "A plugin type must be specified");
        return;
      }
      const pluginDefs = plugins.map(p => p.exportDef());
      const response = {
        //TODO type/version
        pluginDefinitions: null 
      };
      contentLogger.debug('Type requested ='+type);
      if (type == "all") {
        response.pluginDefinitions = pluginDefs;
      } else {
        response.pluginDefinitions = pluginDefs.filter(def => {
          if (def.pluginType != null) {
            contentLogger.debug('Returning true if type matches, type='
                + def.pluginType);
            return def.pluginType === type;
          } else if (type == 'application') {
            contentLogger.debug('Returning true because type is application');
            return true;
          } else {
            contentLogger.debug('Returning false because type did not match');
            return false;
          }
        });
      }
      res.json(response);
    }
  },
  
  //TODO unify '/plugins' and '/apiManagement/plugins'
  apiManagement(webApp) {
    const r = express.Router();
    r.post('/plugins', jsonParser, function api(req, res) {
      const pluginDef = req.body;
      Promise.resolve().then(() => webApp.options.newPluginHandler(pluginDef))
        .then(() => {
          res.status(200).send('plugin added');
        }, (err) => {
          res.status(400).send('failed to add the plugin: ' + err.message);
          console.warn(err);
        });
    });
    return r;
  }
};

/**
 *  This is passed to every other service of the plugin, so that 
 *  the service can be called by other services under the plugin
 */
function WebServiceHandle(urlPrefix, port) {
  this.urlPrefix = urlPrefix;
  this.port = port;
}
WebServiceHandle.prototype = {
  constructor: WebServiceHandle,
  //This is currently suboptimal: it makes an HTTP call
  //to localhost for every service call. We could instead just call
  //the corresponding router directly with mock request and
  //response objects, but that's tricky, so let's do that
  //later.

  //  router: null,
  port: 0,
  urlPrefix: null,

  call(path, options, originalRequest) {
    return new Promise((resolve, reject) => {
      if (typeof path === "object") {
        options = path;
        path = "";
      }
      options = options || {};
      let url = this.urlPrefix;
      if (path) {
        url += '/' + path;
      }
      const requestOptions = {
        hostname: "localhost",
        port: this.port,
        method: options.method || "GET",
        protocol: 'http:',
        path: url,
        auth: options.auth
      };
      const headers = {};
      if (originalRequest) {
        var cookie = originalRequest.get('cookie');
        if (cookie) {
          headers["Cookie"] = cookie;
        }
      }
      Object.assign(headers, options.headers);
      if (options.body) {
        if (typeof options.body === "string") {
          if (options.contentType) {
            headers["Content-Type"] = options.contentType;
          } else {
            headers["Content-Type"] = "application/json";
          }
          headers["Content-Length"] =  options.body.length;
        } else {
          headers["Content-Type"] = "application/json";
          const json = JSON.stringify(options.body)
          headers["Content-Length"] =  json.length;
          options.body = json;
        }
      }
      //console.log("headers: ", headers)
      if (Object.getOwnPropertyNames(headers).length > 0) {
        requestOptions.headers = headers;
      }
      //console.log('http request', requestOptions);
      const request = http.request(requestOptions, (response) => {
        var chunks = [];
        response.on('data',(chunk)=> {
          utilLog.debug('Callservice: Data received');
          chunks.push(chunk);
        });
        response.on('end',() => {
          utilLog.debug('Callservice: Service call completed.');
          response.body = Buffer.concat(chunks).toString();
          resolve(response);
        });
      }
      );
      request.on('error', (e) => {
        utilLog.warn('Callservice: Service call failed.');
        reject(e);
      });
      if (options.body) {
        request.write(options.body);
      }
      utilLog.debug('Callservice: Issuing request to service');
      request.end();
    }
    );
  }
};


const commonMiddleware = {
  /**
   * Initializes the req.mvdData (or whatever the name of the project at the moment is)
   *
   * The request object is cached in the closure scope here, so that a service
   * making a call to another service doesn't have to bother about passing the  
   * authentication data on: we'll do that
   */
  
  addAppSpecificDataToRequest(globalAppData) {
    return function addAppSpecificData(req, res, next) {
      const appData = Object.create(globalAppData);
      if (!req[`${UNP.APP_NAME}Data`]) {
        req[`${UNP.APP_NAME}Data`] = appData; 
      }
      appData.makeErrorObject = zluxUtil.makeErrorObject; 
      if (!appData.webApp) {
        appData.webApp = {};
      } else {
      	appData.webApp = Object.create(appData.webApp);
      }
      appData.webApp.callRootService = function callRootService(name, url, 
          options) {
        return this.rootServices[name].call(url, options, req);
      }
      if (!appData.plugin) {
        appData.plugin = {};
      } else {
      	appData.plugin = Object.create(appData.plugin);
      }
      appData.plugin.callService = function callService(name, url, options) {
        try {
          return this.services[name].call(url, options, req);
        } catch (e) {
          return Promise.reject(e);
        }
      }
      if (!appData.service) {
        appData.service = {};
      } else {
        appData.service = Object.create(appData.service);
      }
      next();
    }
  },
  
  injectPluginDef(pluginDef) {
    return function(req, res, next) {
      req[`${UNP.APP_NAME}Data`].plugin.def = pluginDef;
      next();
    }
  },
  
  injectServiceDef(serviceDef) {
    return function _injectServiceDef(req, res, next) {
      req[`${UNP.APP_NAME}Data`].service.def = serviceDef;
      next();
    }
  },


  /**
   * Injects the service handles to the request so that a service can
   * call other serivces - root services or services created or imported
   * by the plugin, by reading 
   *   req.mvdData.plugin.services[serviceName] 
   * or
   *   req.mvdData.webApp.rootServices[serviceName] 
   *
   * It's context-sensitive, the behaviour depends on the plugin
   */
  injectServiceHandles(serviceHandles, isRoot) {
    if (isRoot) {
      return function injectRoot(req, res, next) {
        //console.log('injecting services: ', Object.keys(serviceHandles))
        req[`${UNP.APP_NAME}Data`].webApp.rootServices = serviceHandles;
        next();
      }
    } else {
      return function inject(req, res, next) {
       // console.log('injecting services: ', Object.keys(serviceHandles))
        req[`${UNP.APP_NAME}Data`].plugin.services = serviceHandles;
        next();
      }
    }
  },
  
  /**
   * A pretty crude request body reader
   */
  readBody() {
    return function readBody(req, res, next) {
      if (req.body) {
        next()
        return;
      }
      var bodyLen = 0;
      const body = [];
      const contentType = req.get('Content-Type');
      if ((req.method != 'POST') && (req.method != 'PUT')) {
        next();
        return;
      }
      var onData = function(chunk) {
        body.push(chunk);
        bodyLen += chunk.length;
        if (bodyLen > DEFAULT_READBODY_LIMIT) {
          req.removeListener('data', onData); 
          req.removeListener('end', onEnd);
          res.send(413, 'content too large');
        }
      };
      var onEnd = function() {
        req.body = Buffer.concat(body).toString();
        next();
        return;
      };
      req.on('data', onData).on('end', onEnd);
    }
  },
}

function makeSubloggerFromDefinitions(pluginDefinition, serviceDefinition, name) {
  return global.COM_RS_COMMON_LOGGER.makeComponentLogger(pluginDefinition.identifier
      + "." + serviceDefinition.name + '.' + name);
}

const defaultOptions = {
  httpPort: 0,
  productCode: null,
  productDir: null,
  proxiedHost: null,
  proxiedPort: 0,
  rootRedirectURL: null,
  rootServices: null,
  staticPlugins: null,
  newPluginHandler: null
};

function WebApp(options){
  this.expressApp = express();
  let sessionTimeoutMs = DEFAULT_SESSION_TIMEOUT_MS;
  if (options.sessionTimeoutMs) {
    sessionTimeoutMs = options.sessionTimeoutMs;
  }
  this.expressApp.use(session({
    //TODO properly generate this secret
    secret: process.env.expressSessionSecret ? process.env.expressSessionSecret : 'whatever',
    store: require("./sessionStore").sessionStore,
    resave: true, saveUninitialized: false,
    cookie: {
      maxAge: sessionTimeoutMs
    }
  }));
  this.options = zluxUtil.makeOptionsObject(defaultOptions, options);
  this.auth = options.auth;
  expressWs(this.expressApp);
  this.expressApp.serverInstanceUID = Date.now(); // hack
  this.pluginRouter = express.Router();
  this.routers = {};
  this.appData = {
    webApp: {
      proxiedHost: options.proxiedHost,
    }, 
    plugin: {

    }
    //more stuff can be added
  };
  this.plugins = [];
  //hack for pseudo-SSO
  this.authServiceHandleMaps = {};
}
WebApp.prototype = {
  constructor: WebApp,
  options: null,
  expressApp: null,
  routers: null,
  appData: null,
  //hack for pseudo-SSO
  authServiceHandleMaps: null,

  toString() {
    return `[WebApp product: ${this.options.productCode}]`
  },
  
  makeProxy(urlPrefix, noAuth) {
    const r = express.Router();
    r.use(proxy.makeSimpleProxy(this.options.proxiedHost, this.options.proxiedPort, 
    {
      urlPrefix, 
      isHttps: false, 
      addProxyAuthorizations: (noAuth? null : this.auth.addProxyAuthorizations) 
    }));
    r.ws('/', proxy.makeWsProxy(this.options.proxiedHost, this.options.proxiedPort, 
        urlPrefix, false))
    return r;
  },
  
  makeExternalProxy(host, port, urlPrefix, isHttps, noAuth) {
    const r = express.Router();
    installLog.info(`Setting up proxy to ${host}:${port}/${urlPrefix}`);
    r.use(proxy.makeSimpleProxy(host, port, {
      urlPrefix, 
      isHttps, 
      addProxyAuthorizations: (noAuth? null : this.auth.addProxyAuthorizations),
      allowInvalidTLSProxy: this.options.allowInvalidTLSProxy
    }));
    return r;
  },
  
  installStaticHanders() {
    this.expressApp.get(
      `/${this.options.productCode}/plugins/com.rs.mvd/services/com.rs.mvd.ng2.module.ts`,
      staticHandlers.ng2TypeScript(this.options.staticPlugins.ng2));
    const webdir = path.join(path.join(this.options.productDir,
      this.options.productCode), 'web');
    const rootPage = this.options.rootRedirectURL? this.options.rootRedirectURL 
        : '/';
    if (rootPage != '/') {
      this.expressApp.get('/', function(req,res) {
        res.redirect(rootPage);
      });
    }
    this.expressApp.use(rootPage, express.static(webdir));
  },

  installCommonMiddleware() {
    this.expressApp.use(commonMiddleware.addAppSpecificDataToRequest(
        this.appData));
  },

  installRootServices() {
    const serviceHandleMap = {};
    for (const proxiedRootService of this.options.rootServices || []) {
      const name = proxiedRootService.name || proxiedRootService.url.replace("/", "");
      installLog.info(`installing root service proxy at ${proxiedRootService.url}`);
      //note that it has to be explicitly false. other falsy values like undefined
      //are treated as default, which is true
      if (proxiedRootService.requiresAuth === false) {
        const proxyRouter = this.makeProxy(proxiedRootService.url, true);
        this.expressApp.use(proxiedRootService.url,
            proxyRouter);
      } else {
        const proxyRouter = this.makeProxy(proxiedRootService.url);
        this.expressApp.use(proxiedRootService.url,
            this.auth.middleware,
            proxyRouter);
      }
      serviceHandleMap[name] = new WebServiceHandle(proxiedRootService.url, 
          this.options.httpPort);
    }
    this.expressApp.use(commonMiddleware.injectServiceHandles(serviceHandleMap,
        true));
    this.expressApp.post('/auth',
        jsonParser,
        (req, res, next) => {
          //hack for pseudo-SSO
          req[`${UNP.APP_NAME}Data`].webApp.authServiceHandleMaps = 
            this.authServiceHandleMaps;
          next();
        },
        this.auth.doLogin); 
    this.expressApp.get('/auth',
        jsonParser,
        (req, res, next) => {
          //hack for pseudo-SSO
          req[`${UNP.APP_NAME}Data`].webApp.authServiceHandleMaps = 
            this.authServiceHandleMaps;
          next();
        },
        this.auth.getStatus); 
    this.expressApp.post('/auth-logout',
        jsonParser,
        (req, res, next) => {
          //hack for pseudo-SSO
          req[`${UNP.APP_NAME}Data`].webApp.authServiceHandleMaps = 
            this.authServiceHandleMaps;
          next();
        },
        this.auth.doLogout); 
    this.expressApp.get('/auth-logout',
        jsonParser,
        (req, res, next) => {
          //hack for pseudo-SSO
          req[`${UNP.APP_NAME}Data`].webApp.authServiceHandleMaps = 
            this.authServiceHandleMaps;
          next();
        },
        this.auth.doLogout); 
    serviceHandleMap['auth'] = new WebServiceHandle('/auth', 
        this.options.httpPort);
    this.expressApp.get('/plugins', 
        //this.auth.middleware, 
        staticHandlers.plugins(this.plugins));
    serviceHandleMap['plugins'] = new WebServiceHandle('/plugins', 
        this.options.httpPort);
    this.expressApp.get('/echo/*', 
      this.auth.middleware, 
      (req, res) =>{
        contentLogger.log(contentLogger.INFO, 'echo\n' + util.inspect(req));
        res.json(req.params);
      });
    serviceHandleMap['echo'] = new WebServiceHandle('/echo', 
        this.options.httpPort);
    this.expressApp.get('/echo/*',  
      this.auth.middleware, 
      (req, res) =>{
        contentLogger.log(contentLogger.INFO, 'echo\n' + util.inspect(req));
        res.json(req.params);
      });
    serviceHandleMap['echo'] = new WebServiceHandle('/echo', 
        this.options.httpPort);
    this.expressApp.use('/apiManagement/', 
        this.auth.middleware, 
        staticHandlers.apiManagement(this));
    serviceHandleMap['apiManagement'] = new WebServiceHandle('/apiManagement', 
        this.options.httpPort);
  },
  
  _makeRouterForLegacyService(pluginContext, service) {
    const plugin = pluginContext.pluginDef;
    const subUrl = zLuxUrl.makeServiceSubURL(service);
    installLog.debug(plugin.identifier + ": service " + subUrl);
    const constructor = service.nodeModule[service.handlerInstaller];
    const router = express.Router();
    const urlSpec = "/" + this.options.productCode + "/plugins/" 
      + plugin.identifier + "/services/" + service.name + "/";
    const manager = {
      serverConfig:pluginContext.server.config.user,
      plugins:pluginContext.server.state.pluginMap,
      productCode:this.options.productCode
    };
    const handleWebsocketException = function(e, ws) {
      logException(e);
      try {
        ws.close(WEBSOCKET_CLOSE_INTERNAL_ERROR,JSON.stringify({ 
          error: 'Internal Server Error'
        }));
      } catch (closeEx) {
        logException(closeEx);
      }
    };
    const logException = function(e) {
      utilLog.warn(toString()+' Exception caught. Message='+e.message);
      utilLog.warn("Stack trace follows\n"+e.stack);
    };
    const toString = function() {
      return '[Service URL: '+urlSpec+']';
    };
    const legacyDataserviceAttributes = {
      logger: global.COM_RS_COMMON_LOGGER.makeComponentLogger(plugin.identifier
          + "." + service.name),
      toString: toString,
      urlSpec: urlSpec,
      makeSublogger(name) {
        return makeSubloggerFromDefinitions(plugin,service,name);
      },
      pluginDefinition: plugin,
      serviceDefinition: service,
      manager: manager
    };
    const handler = new constructor(service, service.methods, manager,
      legacyDataserviceAttributes);
    for (const methodUC of service.methods || []) {
      const method = methodUC.toLowerCase();
      if (!/^(get|post|put|delete|ws)$/.exec(method)) {
        installLog.warn(plugin.identifier + ": invalid method " + method);
        continue;
      }
      if (method === 'ws') {
        installLog.info(plugin.identifier + ": installing websocket service");
        router.ws('/',(ws,req) => {
          var session;
          try {
            session = handler.createSession(req);
          } catch (e) {
            handleWebsocketException(e,ws);
          }
          ws.on('message', function(msg) {
            try {
              session.handleWebsocketMessage(msg,ws);
            } catch (e) {
              handleWebsocketException(e,ws);
            }
          });
          
          ws.on('close', function(code, reason) {
            try {
              session.handleWebsocketClosed(ws, code, reason);
            } catch (e) {
              handleWebsocketException(e,ws);            
            }
          });
          
          if (session.handleWebsocketConnect) {
            session.handleWebsocketConnect(ws);
          }
        });
      } else {
        for (const route of [router.route('/'), router.route('/*')]) {
          if (method === "post" || method === "put") {
            route[method](commonMiddleware.readBody());
          }
          installLog.debug(`${plugin.identifier}: ${method} ${route.path} `
                           +` handled by ${service.handlerInstaller}`);
          route[method]((req, res) => {
            handler.handleRequest(req, res, req.body, req.path.substring(1));
          });
        }
      }
    }
    return router;
  },

  _installDataServices: function*(pluginContext, urlBase) {
    const plugin = pluginContext.pluginDef;
    if (!plugin.dataServicesGrouped) {
      return;
    }
    const serviceHandleMap = {};
    for (const service of plugin.dataServices) {
      const name = (service.type === "import")? service.localName : service.name;
      const handle = new WebServiceHandle(urlBase + "/services/" + name,
        this.options.httpPort);
      serviceHandleMap[name] = handle;
    }
    if (plugin.pluginType === 'nodeAuthentication') {
      //hack for pseudo-SSO
      this.authServiceHandleMaps[plugin.identifier] = serviceHandleMap;
    }
    const pluginChain = [
      commonMiddleware.injectPluginDef(plugin),
      commonMiddleware.injectServiceHandles(serviceHandleMap),
    ];
    let pluginRouters = this.routers[plugin.identifier];
    if (!pluginRouters) {
      pluginRouters = this.routers[plugin.identifier] = {};
    }
    if (plugin.dataServicesGrouped.proxy.length > 0) {
      for (const proxiedService of plugin.dataServicesGrouped.proxy) {
        const subUrl = urlBase + zLuxUrl.makeServiceSubURL(proxiedService);
        const proxyRouter = this.makeProxy(subUrl);
        const serviceRouterWithMiddleware = pluginChain.slice();
        serviceRouterWithMiddleware.push(commonMiddleware.injectServiceDef(
            proxiedService));
        serviceRouterWithMiddleware.push(this.auth.middleware);
        serviceRouterWithMiddleware.push(proxyRouter);
        installLog.info(`${plugin.identifier}: installing proxy at ${subUrl}`);
        this.pluginRouter.use(subUrl, serviceRouterWithMiddleware);
        pluginRouters[proxiedService.name] = serviceRouterWithMiddleware;
        //console.log(`service: ${plugin.identifier}[${proxiedService.name}]`);
      }
    }
    if (plugin.dataServicesGrouped.router.length > 0) {
      for (const routerService of plugin.dataServicesGrouped.router) {
        const subUrl = urlBase + zLuxUrl.makeServiceSubURL(routerService);
        const serviceConfiguration = configService.getServiceConfiguration(
          plugin.identifier,  routerService.name, 
          pluginContext.server.config.app, this.options.productCode);
        let router;
        let dataserviceContext = new DataserviceContext(routerService, 
            serviceConfiguration, pluginContext);
        if (typeof  routerService.nodeModule === "function") {
          router = yield routerService.nodeModule(dataserviceContext);
          installLog.info("Loaded Router for plugin=" + plugin.identifier 
              + ", service="+routerService.name + ". Router="+router);          
        } else {
          router = 
            yield routerService.nodeModule[routerService.routerFactory](
              dataserviceContext);
          installLog.info("Loaded Router from factory for plugin=" 
                          + plugin.identifier + ", service=" + routerService.name
                          + ". Factory="+routerService.routerFactory);
        }
        const serviceRouterWithMiddleware = pluginChain.slice();
        serviceRouterWithMiddleware.push(commonMiddleware.injectServiceDef(
            routerService));
        serviceRouterWithMiddleware.push(this.auth.middleware);
        serviceRouterWithMiddleware.push(router);
        installLog.info(`${plugin.identifier}: installing node router at ${subUrl}`);
        this.pluginRouter.use(subUrl, serviceRouterWithMiddleware);
        pluginRouters[routerService.name] = serviceRouterWithMiddleware;
        //console.log(`service: ${plugin.identifier}[${routerService.name}]`);
      }
    }
    if (plugin.dataServicesGrouped.node.length > 0) {
      for (const legacyService of plugin.dataServicesGrouped.node) {
        const subUrl = urlBase + zLuxUrl.makeServiceSubURL(legacyService);
        const serviceConfiguration = configService.getServiceConfiguration(
          plugin.identifier,  legacyService.name, 
          pluginContext.server.config.app, this.options.productCode);
        const serviceRouterWithMiddleware = pluginChain.slice();
        serviceRouterWithMiddleware.push(commonMiddleware.injectServiceDef(
            legacyService));
        serviceRouterWithMiddleware.push(this.auth.middleware);
        serviceRouterWithMiddleware.push(this._makeRouterForLegacyService(
            pluginContext, legacyService));
        installLog.info(
          `${plugin.identifier}: installing legacy service router at ${subUrl}`);
        this.pluginRouter.use(subUrl, serviceRouterWithMiddleware);
        pluginRouters[legacyService.name] = serviceRouterWithMiddleware;
       // console.log(`service: ${plugin.identifier}[${legacyService.name}]`);
      }
    }
    if (plugin.dataServicesGrouped.external.length > 0) {
      for (const externalService of plugin.dataServicesGrouped.external) {
        const subUrl = urlBase + zLuxUrl.makeServiceSubURL(externalService);
        const serviceRouterWithMiddleware = pluginChain.slice();
        serviceRouterWithMiddleware.push(commonMiddleware.injectServiceDef(
            externalService));
        serviceRouterWithMiddleware.push(this.auth.middleware);
        serviceRouterWithMiddleware.push(this.makeExternalProxy(
            externalService.host, externalService.port,
            externalService.urlPrefix, externalService.isHttps));
        installLog.info(`${plugin.identifier}: installing proxy at ${subUrl}`);
        this.pluginRouter.use(subUrl, serviceRouterWithMiddleware);
        pluginRouters[externalService.name] = serviceRouterWithMiddleware;
        //console.log(`service: ${plugin.identifier}[${externalService.name}]`);
      }
    }
  },

  _resolveImports(plugin, urlBase) {
    if (plugin.dataServicesGrouped  
        && plugin.dataServicesGrouped.import.length > 0) {
      for (const importedService of plugin.dataServicesGrouped.import) {
        const subUrl = urlBase 
          + zLuxUrl.makeServiceSubURL(importedService);
        const importedRouter = this.routers[importedService.sourcePlugin]
          [importedService.sourceName];
        if (!importedRouter) {
          throw new Error(
            `Import ${importedService.sourcePlugin}:${importedService.sourceName}`
            + " can't be satisfied");
        }
        installLog.info(`${plugin.identifier}: installing import`
           + ` ${importedService.sourcePlugin}:${importedService.sourceName} at ${subUrl}`);
        this.pluginRouter.use(subUrl, importedRouter);
      }
    }
  },

  _installPluginStaticHandlers(plugin, urlBase) {
    installLog.info(`${plugin.identifier}: installing static file handlers...`);
    if (plugin.webContent && plugin.webContent.path) {
      let url = `${urlBase}/web`;
      installLog.info(`${plugin.identifier}: serving static files at ${url}`);
      //console.log(url, plugin.webContent.path);
      this.pluginRouter.use(url, express.static(plugin.webContent.path));
    }
    if (plugin.pluginType === "library") {
      let url = `/lib/${plugin.identifier}/${plugin.libraryVersion}`;
      installLog.info(`${plugin.identifier}: serving library files at ${url}`);
      this.pluginRouter.use(url, express.static(plugin.location));
    }
  },
  
  _installSwaggerCatalog(plugin, urlBase) {
    const router = makeSwaggerCatalog(plugin, 
        this.options.productCode);
    this.pluginRouter.use(zLuxUrl.join(urlBase, '/catalogs/swagger'),
        router);
  },

  injectPluginRouter() {
    this.expressApp.use(this.pluginRouter);
  },
  
  installPlugin: Promise.coroutine(function*(pluginContext) {
    const plugin = pluginContext.pluginDef;
    installLog.debug(
      `${plugin.identifier}: ${plugin.dataServicesGrouped? 'has' : 'does not have'}`
      + ' services')
    const urlBase = zLuxUrl.makePluginURL(this.options.productCode, 
        plugin.identifier);
    this._installSwaggerCatalog(plugin, urlBase);
    this._installPluginStaticHandlers(plugin, urlBase);
    try {
      yield *this._installDataServices(pluginContext, urlBase);
    } catch (e) {
      installLog.warn(e.stack);
    }
    this._resolveImports(plugin, urlBase);
    this.plugins.push(plugin);
  }),

  installErrorHanders() {
    this.expressApp.use((req, res, next) => {
      do404(req.url, res, this.options.productCode
          + ": unknown resource requested");
    });
//      if (!next) {
//        // TODO how was this tested? I'd say it never happens: `next` is always 
//        // there - it's Express's wrapper, not literally the next user middleware
//        // piece, as one might think (note that you call it without params, not like
//        // next(req, res, ...))
//
//      } else {
//        return next();
//      }
  }
};

module.exports.makeWebApp = function (options) {
  const webApp = new WebApp(options);
  webApp.installCommonMiddleware();
  webApp.installStaticHanders();
  webApp.installRootServices();
  webApp.injectPluginRouter();
  webApp.installErrorHanders();
  return webApp;
};

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

