/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const { request, Agent } = require('undici');
const { EurekaClient } = require('../../lib/eureka-client');

describe('Eureka Client', function () {
  let eurekaClient = null;
  let discoveryHost;
  let discoveryPort;
  let tlsOptions;
  let dispatcher;
  let appName;
  let instanceId;

  before(function () {
    discoveryHost = process.env['DISCOVERY_HOST'];
    discoveryPort = process.env['DISCOVERY_PORT'];
    const keyFile = process.env['CLIENT_KEY'];
    const certFile = process.env['CLIENT_CER'];
    const caFile = process.env['CLIENT_CA'];

    if (discoveryHost && discoveryPort && certFile && keyFile) {
      tlsOptions = {
        cert: fs.readFileSync(certFile),
        key: fs.readFileSync(keyFile),
        rejectUnauthorized: false,
      };
      if (caFile) {
        tlsOptions.ca = fs.readFileSync(caFile);
      }
      dispatcher = new Agent({ connect: tlsOptions });
      // Use a unique app name per test run to avoid collisions
      appName = 'zlux-test-' + Date.now();
      instanceId = discoveryHost + ':' + appName + ':' + discoveryPort;
    } else {
      console.log('Required environment variables not found. Set these env vars to run tests:');
      console.log('  export DISCOVERY_HOST=<discovery-host>');
      console.log('  export DISCOVERY_PORT=<discovery-port>');
      console.log('  export CLIENT_KEY=<client-key-file>');
      console.log('  export CLIENT_CER=<client-cer-file>');
      console.log('  export CLIENT_CA=<client-ca-file>  (optional)');
      this.skip();
    }
  });

  afterEach(function (done) {
    if (eurekaClient) {
      eurekaClient.stop((err) => {
        eurekaClient = null;
        // Brief delay for discovery to process deregistration
        setTimeout(done, 1000);
      });
    } else {
      done();
    }
  });

  function makeTestInstanceConfig() {
    return {
      instanceId: instanceId,
      app: appName,
      hostName: discoveryHost,
      ipAddr: '127.0.0.1',
      vipAddress: appName,
      status: 'UP',
      port: {
        '$': Number(discoveryPort),
        '@enabled': 'true'
      },
      securePort: {
        '$': Number(discoveryPort),
        '@enabled': 'true'
      },
      healthCheckUrl: 'https://' + discoveryHost + ':' + discoveryPort + '/health',
      statusPageUrl: 'https://' + discoveryHost + ':' + discoveryPort + '/info',
      homePageUrl: 'https://' + discoveryHost + ':' + discoveryPort + '/',
      dataCenterInfo: {
        '@class': 'com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo',
        name: 'MyOwn'
      },
      leaseInfo: {
        durationInSecs: 90,
        renewalIntervalInSecs: 30
      },
      metadata: {
        'apiml.service.title': 'Eureka Client Test',
        'apiml.service.description': 'Test instance for eureka-client integration tests'
      }
    };
  }

  function makeEurekaClient() {
    const serviceUrl = 'https://' + discoveryHost + ':' + discoveryPort + '/eureka/apps';
    const client = new EurekaClient({
      instance: makeTestInstanceConfig(),
      eureka: {
        heartbeatInterval: 30000,
        maxRetries: 3,
        requestRetryDelay: 2000,
        serviceUrls: { default: [serviceUrl] }
      },
      ssl: true,
      tlsOptions: tlsOptions
    });
    return client;
  }

  function queryDiscovery(path) {
    const url = 'https://' + discoveryHost + ':' + discoveryPort + path;
    return request(url, {
      method: 'GET',
      headers: { 'accept': 'application/json' },
      dispatcher: dispatcher
    }).then(async (response) => {
      const body = await response.body.text();
      return {
        statusCode: response.statusCode,
        body: body,
        json: response.statusCode === 200 ? JSON.parse(body) : null
      };
    });
  }

  function deleteInstance(app, instance) {
    const url = 'https://' + discoveryHost + ':' + discoveryPort
      + '/eureka/apps/' + app + '/' + instance;
    return request(url, {
      method: 'DELETE',
      dispatcher: dispatcher
    });
  }

  it('should register with discovery service', function (done) {
    eurekaClient = makeEurekaClient();
    eurekaClient.start((error) => {
      expect(error).to.be.null;
      done();
    });
  });

  it('should be queryable after registration', function (done) {
    eurekaClient = makeEurekaClient();
    eurekaClient.start((error) => {
      expect(error).to.be.null;
      queryDiscovery('/eureka/apps/' + appName).then((response) => {
        expect(response.statusCode).to.equal(200);
        const app = response.json.application;
        expect(app).to.exist;
        const instances = Array.isArray(app.instance) ? app.instance : [app.instance];
        const found = instances.some(
          (inst) => inst.instanceId === instanceId
        );
        expect(found).to.be.true;
        done();
      }).catch(done);
    });
  });

  it('should send heartbeat successfully', function (done) {
    eurekaClient = makeEurekaClient();
    eurekaClient.start((error) => {
      expect(error).to.be.null;
      // Manually trigger a heartbeat renewal
      eurekaClient.renew();
      // Give time for the async heartbeat to complete
      setTimeout(() => {
        // Verify still registered
        queryDiscovery('/eureka/apps/' + appName).then((response) => {
          expect(response.statusCode).to.equal(200);
          done();
        }).catch(done);
      }, 2000);
    });
  });

  it('should deregister on stop', function (done) {
    const client = makeEurekaClient();
    client.start((error) => {
      expect(error).to.be.null;
      client.stop((stopError) => {
        expect(stopError).to.be.null;
        // Give discovery time to process the deregistration
        setTimeout(() => {
          queryDiscovery('/eureka/apps/' + appName).then((response) => {
            // Either 404 (no app) or 200 with no matching instance
            if (response.statusCode === 404) {
              // App fully gone
              expect(response.statusCode).to.equal(404);
              done();
            } else {
              // App exists but our instance should be gone
              const app = response.json.application;
              const instances = Array.isArray(app.instance) ? app.instance : [app.instance];
              const found = instances.some(
                (inst) => inst.instanceId === instanceId
              );
              expect(found).to.be.false;
              done();
            }
          }).catch(done);
        }, 2000);
      });
      // Prevent afterEach from double-stopping
      eurekaClient = null;
    });
  });

  it('should re-register when heartbeat gets 404', function (done) {
    eurekaClient = makeEurekaClient();
    eurekaClient.start((error) => {
      expect(error).to.be.null;
      // Deregister behind the client's back
      deleteInstance(appName, instanceId).then(() => {
        // Brief delay for discovery to process deletion
        setTimeout(() => {
          // Trigger a heartbeat — should get 404 and auto-re-register
          eurekaClient.renew();
          // Wait for re-registration to complete
          setTimeout(() => {
            queryDiscovery('/eureka/apps/' + appName).then((response) => {
              expect(response.statusCode).to.equal(200);
              const app = response.json.application;
              expect(app).to.exist;
              const instances = Array.isArray(app.instance) ? app.instance : [app.instance];
              const found = instances.some(
                (inst) => inst.instanceId === instanceId
              );
              expect(found).to.be.true;
              done();
            }).catch(done);
          }, 3000);
        }, 1000);
      }).catch(done);
    });
  });

  it('should query instances by app id via getInstancesByAppId', function (done) {
    eurekaClient = makeEurekaClient();
    eurekaClient.start((error) => {
      expect(error).to.be.null;
      eurekaClient.getInstancesByAppId(appName, (queryError, application) => {
        expect(queryError).to.be.null;
        expect(application).to.exist;
        expect(application.application).to.exist;
        const instances = Array.isArray(application.application.instance)
          ? application.application.instance
          : [application.application.instance];
        const found = instances.some(
          (inst) => inst.instanceId === instanceId
        );
        expect(found).to.be.true;
        done();
      });
    });
  });

  it('should return undefined application for unregistered app id', function (done) {
    eurekaClient = makeEurekaClient();
    eurekaClient.start((error) => {
      expect(error).to.be.null;
      eurekaClient.getInstancesByAppId('nonexistent-app-' + Date.now(), (queryError, application) => {
        expect(queryError).to.be.null;
        expect(application).to.be.undefined;
        done();
      });
    });
  });
});

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
