const assert = require('assert')
const http = require('http');
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const should = chai.should();
const PluginLoader = require('plugin-loader')
const makePlugin = PluginLoader.makePlugin
const makeWebApp = require('webapp').makeWebApp;

global.COM_RS_COMMON_LOGGER.setLogLevelForComponentPattern("_unp.install", 0);
global.COM_RS_COMMON_LOGGER.setLogLevelForComponentPattern("_unp.utils", 0);
global.COM_RS_COMMON_LOGGER.setLogLevelForComponentPattern("_unp.bootstrap", 0);

const webAppOptions = {
    sessionTimeoutMs: 60  * 60 * 1000,
    httpPort: 31337,
    httpsPort: 31338,
    productCode: 'XXX',
    productDir: process.cwd(),
    proxiedHost: "localhost",
    proxiedPort: 12345,
    allowInvalidTLSProxy: true,
    rootRedirectURL: "",
    rootServices: [],
    serverConfig: {
    },
    staticPlugins: {
      list: [],
      pluginMap: {},
      ng2: {}
    },
    newPluginHandler: (pluginDef) => {},
    auth: { 
      doLogin() {},
      getStatus() {},
      doLogout() {},
      middleware(r, re, next) { next() }
    }
};

const pl = new PluginLoader({ pluginsDir: process.cwd() });
const def = pl._readPluginDef("com.rs.testplugin.json");
const plugin = makePlugin(def, {}, {
    productCode: "XXX",
    config: {},
    authManager: {}
  }, false);
const pluginContext = {
    pluginDef: plugin,
    server: {
      config: {
        app: {},
        user: {},
        startUp: {}
      },
      state: {
        pluginMap: {}
      }
    }
};

describe('WebApp', function() {
  
  describe('#installPlugin()', function() {
    let webApp;
    let server;
   
    beforeEach(function()  {
      webApp = null;
      webApp = makeWebApp(webAppOptions);
      return webApp.installPlugin(pluginContext);
    }) 
    
    beforeEach(function(done)  {
      try {
       // console.log("webApp", webApp)
        server = http.createServer(webApp.expressApp)
       // console.log("server", server)
        let x = server.listen(webAppOptions.httpPort, "localhost")
        //console.log("x", x)
        //console.log("server.address()", server.address())
        server.on('listening', _ => done());
        server.on('error', e => done(e));
      } catch (e) {
        console.log(e)
        //throw e
      }
    }) 
    
    describe('versioning', function() {
      it('should install test-service v1.3.0', function()  {
        const url = '/XXX/plugins/com.rs.testplugin'
            + '/services/test-service/1.3.0'
        return chai.request(server)
          .get(url)
          .then(function (res) {
            //console.log(res)
            res.should.have.status(200);
            res.body.should.be.a('object');
            res.body.should.deep.equal(
              {
                "plugin": "com.rs.testplugin",
                "service": "test-service",
                "version": "1.3.0"
              });
          })
      })
      
     it('should install test-service v2.1.0', function()  {
        const url = '/XXX/plugins/com.rs.testplugin'
            + '/services/test-service/2.1.0'
        return chai.request(server)
          .get(url)
          .then(function (res) {
            res.should.have.status(200);
            res.body.should.be.a('object');
            console.log(res.body)
            res.body.should.deep.equal(
              {
                "plugin": "com.rs.testplugin",
                "service": "test-service",
                "version": "2.1.0"
              });
          })
      })
    
      it('should point the _current version of test-service to v2.1.0', function()  {
        const url = '/XXX/plugins/com.rs.testplugin'
            + '/services/test-service/_current'
        return chai.request(server)
          .get(url)
          .then(function (res) {
            res.should.have.status(200);
            res.body.should.be.a('object');
            console.log(res.body)
            res.body.should.deep.equal(
              {
                "plugin": "com.rs.testplugin",
                "service": "test-service",
                "version": "2.1.0"
              });
          })
      })
      
      it('should call the highest version by default', function()  {
        const url = '/XXX/plugins/com.rs.testplugin'
            + '/services/caller/_current'
        const req = chai.request(server).get(url)
        return req.then(function (res) {
            res.should.have.status(200);
            res.body.should.be.a('object');
            console.log(res.body)
            res.body.should.deep.equal({
                "plugin": "com.rs.testplugin",
                "service": "caller",
                "test-service response": {
                  "plugin": "com.rs.testplugin",
                  "service": "test-service",
                  "version": "2.1.0"
                }
              });
          })//.catch(e => console.log(e))
      })
      
      it('should respect local service version requirements', function()  {
        const url = '/XXX/plugins/com.rs.testplugin'
            + '/services/caller-with-requirements/_current'
        const req = chai.request(server).get(url)
        //console.log(req)
        return req.then(function (res) {
            res.should.have.status(200);
            res.body.should.be.a('object');
            console.log(res.body)
            res.body.should.deep.equal({
                "plugin": "com.rs.testplugin",
                "service": "caller",
                "test-service response": {
                  "plugin": "com.rs.testplugin",
                  "service": "test-service",
                  "version": "1.3.0"
                }
              });
          })
      })
    })
  
    after(() => {
      process.exit(0)
    })
  })
});