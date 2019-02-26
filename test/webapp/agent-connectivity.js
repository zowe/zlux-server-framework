
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/


/*
agent connectivity is without a handshake at this time, but
when this changes, tests should exist here to test handshake
*/

const assert = require('assert')
const path = require('path');
const http = require('http');
const https = require('https');
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const should = chai.should();
const PluginLoader = require('../../lib/plugin-loader')
const makePlugin = PluginLoader.makePlugin
const makeWebApp = require('../../lib/webapp').makeWebApp;
const config = require('./config');
const express = require('express');
const fs = require('fs');
const util = require('../../lib/util');
const Promise = require('bluebird');

let webAppOptions = config.webAppOptions;

function makeFakeAgent(options) {
  return new Promise((resolve, reject)=> {
    let expressApp = express();
    let port = options.http ? options.http.port : options.https.port;
    let agent = null;
    if (options.http && !options.http.attls) {
      agent = http.createServer(expressApp);
    } else {
      let serverOptions = undefined;
      if (options.https) {
        serverOptions = {
          cert: util.readFilesToArray(options.https.certificates),
          key: util.readFilesToArray(options.https.keys)
        }
      }
      agent = https.createServer(serverOptions, expressApp);
    }
    expressApp.get('/plugins', (req, res)=> {
      res.status(200).json({pluginDefinitions:
                            [JSON.parse(fs.readFileSync('../test-plugin/pluginDefinition.json'))]});
    });

    
    agent.listen(port, "localhost");
    agent.on('listening', _ => resolve(agent));
    agent.on('error', e => reject(e));
  });
}

describe('Agent', function() {
  let webApp;
  let server;
  let agent;

  describe('connectivity-http', function() {
    webAppOptions.serverConfig.agent = {
      host: 'localhost',
      http: { port: 31338 }
    }
    
    before(function(done) {
      try {
        webApp = makeWebApp(webAppOptions);
        server = http.createServer(webApp.expressApp)

        server.on('listening', _ => makeFakeAgent(webAppOptions.serverConfig.agent).then(result=>{
          agent = result;
          done()
        }).catch(e=>done(e)));
        server.on('error', e => done(e));
        let x = server.listen(webAppOptions.httpPort, "localhost")
      } catch (e) {
        console.log(e)
        done(e);
      }
    });
    
    it('should be able to get plugins over HTTP', function() {
      const url = '/plugins?type=all';
      return chai.request(server)
        .get(url)
        .then(function (res) {
          res.should.have.status(200);
          res.body.should.be.a('object');
        });
    })
  })

  describe('connectivity-https-attls', function() {
    webAppOptions.serverConfigagent = {
      host: 'localhost',
      http: { port: 31338, attls: true },
      https: { //likely not what is done in attls keyring config
               certificates: ['../https/server.cer'],
               keys: ['../https/server.key']}

    }
    
    before(function(done) {
      try {
        webApp = makeWebApp(webAppOptions);
        server = http.createServer(webApp.expressApp)

        server.on('listening', _ => makeFakeAgent(webAppOptions.serverConfig.agent).then(result=>{
          agent = result;
          done()
        }).catch(e=>done(e)));
        server.on('error', e => done(e));
        let x = server.listen(webAppOptions.httpPort, "localhost")
      } catch (e) {
        console.log(e)
        done(e);
      }
    });
    
    it('should be able to get plugins over HTTPS (ATTLS)', function() {
      const url = '/plugins?type=all';
      return chai.request(server)
        .get(url)
        .then(function (res) {
          res.should.have.status(200);
          res.body.should.be.a('object');
        });
    })
  })


  describe('connectivity-https', function() {
    webAppOptions.serverConfig.agent = {
      host: 'localhost',
      https: { port: 31338,
               certificates: ['../https/server.cer'],
               keys: ['../https/server.key']}
    }
    
    before(function(done) {
      try {
        webApp = makeWebApp(webAppOptions);
        server = http.createServer(webApp.expressApp)

        server.on('listening', _ => makeFakeAgent(webAppOptions.serverConfig.agent).then(result=>{
          agent = result;
          done()
        }).catch(e=>done(e)));        
        server.on('error', e => done(e));
        let x = server.listen(webAppOptions.httpPort, "localhost")
      } catch (e) {
        console.log(e)
        done(e);
      }
    });
    
    it('should be able to get plugins over HTTPS', function() {
      const url = '/plugins?type=all';
      return chai.request(server)
        .get(url)
        .then(function (res) {
          res.should.have.status(200);
          res.body.should.be.a('object');
        });
    })

  })
  afterEach(function(done) {
    server.close(_=>{
      agent.close(result=>{done()});
    });
  })
  
})
