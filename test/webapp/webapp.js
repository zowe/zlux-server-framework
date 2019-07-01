
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
const assert = require('assert')
const path = require('path');
const http = require('http');
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const should = chai.should();
const PluginLoader = require('../../lib/plugin-loader')
const makePlugin = PluginLoader.makePlugin
const makeWebApp = require('../../lib/webapp').makeWebApp;
const config = require('./config');

let webAppOptions = config.webAppOptions;

const pl = new PluginLoader({ 
  pluginsDir: path.join(process.cwd(), 'test/webapp'),
  relativePathResolver(p) {
    return path.join(process.cwd(), 'test/webapp', p);
  }
});
const def = pl._readPluginDef("org.zowe.testplugin.json");
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
        user: {
          node: {
            http: {
              port: 8543
            }
          }
        },
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
      try {
        webApp = null;
        webApp = makeWebApp(webAppOptions);
        return webApp.installPlugin(pluginContext);
      } catch (e) {
        console.log(e);
        throw e;
      } 
    }) 
    
    beforeEach(function(done)  {
      try {       
        server = http.createServer(webApp.expressApp)
       // console.log("server", server)
        let x = server.listen(webAppOptions.httpPort, "localhost")
        //console.log("x", x)
        //console.log("server.address()", server.address())
        server.on('listening', _ => done());
        server.on('error', e => done(e));
      } catch (e) {
        console.log(e)
        done(e);
      }
    })
    
    describe('versioning', function() {
      it('should install test-service v1.3.0', function()  {
        const url = '/XXX/plugins/org.zowe.testplugin'
            + '/services/test-service/1.3.0'
        return chai.request(server)
          .get(url)
          .then(function (res) {
            //console.log(res)
            res.should.have.status(200);
            res.body.should.be.a('object');
            res.body.should.deep.equal(
              {
                "plugin": "org.zowe.testplugin",
                "service": "test-service",
                "version": "1.3.0"
              });
          })
      })
      
     it('should install test-service v2.1.0', function()  {
        const url = '/XXX/plugins/org.zowe.testplugin'
            + '/services/test-service/2.1.0'
        return chai.request(server)
          .get(url)
          .then(function (res) {
            res.should.have.status(200);
            res.body.should.be.a('object');
            console.log(res.body)
            res.body.should.deep.equal(
              {
                "plugin": "org.zowe.testplugin",
                "service": "test-service",
                "version": "2.1.0"
              });
          })
      })
    
      it('should point the _current version of test-service to v2.1.0', function()  {
        const url = '/XXX/plugins/org.zowe.testplugin'
            + '/services/test-service/_current'
        return chai.request(server)
          .get(url)
          .then(function (res) {
            res.should.have.status(200);
            res.body.should.be.a('object');
            console.log(res.body)
            res.body.should.deep.equal(
              {
                "plugin": "org.zowe.testplugin",
                "service": "test-service",
                "version": "2.1.0"
              });
          })
      })
      
      it('should call the highest version by default', function()  {
        const url = '/XXX/plugins/org.zowe.testplugin'
            + '/services/caller/_current'
        const req = chai.request(server).get(url)
        return req.then(function (res) {
            res.should.have.status(200);
            res.body.should.be.a('object');
            console.log(res.body)
            res.body.should.deep.equal({
                "plugin": "org.zowe.testplugin",
                "service": "caller",
                "test-service response": {
                  "plugin": "org.zowe.testplugin",
                  "service": "test-service",
                  "version": "2.1.0"
                }
              });
          })//.catch(e => console.log(e))
      })
      
      it('should respect local service version requirements', function()  {
        const url = '/XXX/plugins/org.zowe.testplugin'
            + '/services/caller-with-requirements/_current'
        const req = chai.request(server).get(url)
        //console.log(req)
        return req.then(function (res) {
            res.should.have.status(200);
            res.body.should.be.a('object');
            console.log(res.body)
            res.body.should.deep.equal({
                "plugin": "org.zowe.testplugin",
                "service": "caller",
                "test-service response": {
                  "plugin": "org.zowe.testplugin",
                  "service": "test-service",
                  "version": "1.3.0"
                }
              });
          })
      })
    })
  
    after(() => {
      //process.exit(0)
    })
  })
});
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
