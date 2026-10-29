/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

const fs = require('fs');
const os = require('os');
const path = require('path');
const chai = require('chai');
const chaiHttp = require('chai-http');
const express = require('express');

chai.use(chaiHttp);
const expect = chai.expect;

// Regression tests for the config-service scope authorization fix. Prior to the
// fix, when RBAC was disabled (the shipped default) any authenticated user could
// PUT/DELETE `instance`- and `site`-scope plugin configuration. These tests
// assert that such writes are now rejected with 403 (ZWED0145E) unless RBAC is
// enabled, while `user`-scope writes remain allowed.
describe('configService scope authorization', function () {
  let configService;
  let tmpDir;
  const PLUGIN_ID = 'org.zowe.testplugin';

  before(function () {
    try {
      configService = require('../../plugins/config/lib/configService');
    } catch (e) {
      console.warn('Could not load configService module:', e.message);
      this.skip();
      return;
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgsvc-test-'));
  });

  after(function () {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) { /* best effort cleanup */ }
    }
  });

  function makeContext(rbacEnabled) {
    const logger = global.COM_RS_COMMON_LOGGER.makeComponentLogger('_zsf.test.config');
    return {
      serviceDefinition: { name: 'data' },
      logger,
      makeSublogger: (name) =>
        global.COM_RS_COMMON_LOGGER.makeComponentLogger('_zsf.test.config.' + name),
      addBodyParseMiddleware: () => {},
      plugin: {
        server: {
          config: {
            user: {
              productDir: tmpDir,
              siteDir: tmpDir,
              instanceDir: tmpDir,
              usersDir: tmpDir,
              dataserviceAuthentication: { rbac: rbacEnabled }
            },
            app: { productCode: 'XXX' }
          },
          state: {
            pluginMap: {
              [PLUGIN_ID]: {
                location: tmpDir,
                configurationData: { resources: { settings: { aggregationPolicy: 'override' } } }
              }
            }
          }
        }
      }
    };
  }

  async function makeApp(rbacEnabled) {
    const router = await configService.configRouter(makeContext(rbacEnabled));
    const app = express();
    app.use((req, res, next) => { req.username = 'TESTUSER'; next(); });
    app.use('/', router);
    return app;
  }

  it('rejects PUT to instance scope with 403 when RBAC is disabled', async function () {
    const app = await makeApp(false);
    const res = await chai.request(app)
      .put(`/${PLUGIN_ID}/instance/settings?name=foo`)
      .set('Content-Type', 'application/json')
      .send('{}');
    expect(res).to.have.status(403);
    expect(JSON.stringify(res.body)).to.include('ZWED0160E');
  });

  it('rejects DELETE to site scope with 403 when RBAC is disabled', async function () {
    const app = await makeApp(false);
    const res = await chai.request(app)
      .delete(`/${PLUGIN_ID}/site/settings?name=foo`);
    expect(res).to.have.status(403);
    expect(JSON.stringify(res.body)).to.include('ZWED0160E');
  });

  it('does not block user scope writes when RBAC is disabled', async function () {
    const app = await makeApp(false);
    const res = await chai.request(app)
      .put(`/${PLUGIN_ID}/user/settings?name=foo`)
      .set('Content-Type', 'application/json')
      .send('{}');
    const combined = (res.text || '') + JSON.stringify(res.body || {});
    expect(combined).to.not.include('ZWED0160E');
  });

  it('does not block instance scope writes when RBAC is enabled', async function () {
    const app = await makeApp(true);
    const res = await chai.request(app)
      .put(`/${PLUGIN_ID}/instance/settings?name=foo`)
      .set('Content-Type', 'application/json')
      .send('{}');
    const combined = (res.text || '') + JSON.stringify(res.body || {});
    expect(combined).to.not.include('ZWED0160E');
  });
});

// Express decodes %2F in route parameters, so the first resource segment of a
// config-service URL can carry '/'. For a plugin whose first resource is
// "variable" (accepts any name), a name like "x/../../.." used to escape the
// user's pluginStorage directory on GET, PUT and DELETE.
describe('configService resource name traversal', function () {
  let configService;
  let tmpDir, outsideDir;
  const PLUGIN_ID = 'org.zowe.vartest';
  // From <usersDir>/TESTUSER/XXX/pluginStorage/org.zowe.vartest/x, six '..' reach tmpDir.
  const TRAVERSAL = encodeURIComponent('x/../../../../../../outside');

  before(function () {
    try {
      configService = require('../../plugins/config/lib/configService');
    } catch (e) {
      console.warn('Could not load configService module:', e.message);
      this.skip();
      return;
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgsvc-traversal-'));
    for (const dir of ['product', 'site', 'instance', 'users']) {
      fs.mkdirSync(path.join(tmpDir, dir));
    }
    outsideDir = path.join(tmpDir, 'outside');
  });

  after(function () {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) { /* best effort cleanup */ }
    }
  });

  beforeEach(function () {
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  async function makeApp() {
    const logger = global.COM_RS_COMMON_LOGGER.makeComponentLogger('_zsf.test.config');
    const router = await configService.configRouter({
      serviceDefinition: { name: 'data' },
      logger,
      makeSublogger: (name) =>
        global.COM_RS_COMMON_LOGGER.makeComponentLogger('_zsf.test.config.' + name),
      addBodyParseMiddleware: () => {},
      plugin: {
        server: {
          config: {
            user: {
              productDir: path.join(tmpDir, 'product'),
              siteDir: path.join(tmpDir, 'site'),
              instanceDir: path.join(tmpDir, 'instance'),
              usersDir: path.join(tmpDir, 'users'),
              dataserviceAuthentication: { rbac: false }
            },
            app: { productCode: 'XXX' }
          },
          state: {
            pluginMap: {
              [PLUGIN_ID]: {
                location: path.join(tmpDir, 'product'),
                configurationData: { resources: { notes: { variable: true, aggregationPolicy: 'override' } } }
              }
            }
          }
        }
      }
    });
    const app = express();
    app.use((req, res, next) => { req.username = 'TESTUSER'; next(); });
    app.use('/', router);
    return app;
  }

  async function putFile(app, resource, name) {
    return chai.request(app)
      .put(`/${PLUGIN_ID}/user/${resource}?name=${name}`)
      .set('Content-Type', 'application/json')
      .send('{"written":true}');
  }

  it('still reads and writes a variable resource with an ordinary name', async function () {
    const app = await makeApp();
    expect(await putFile(app, 'x', 'foo.json')).to.have.status(201);
    const res = await chai.request(app).get(`/${PLUGIN_ID}/user/x?name=foo.json`);
    expect(res).to.have.status(200);
    expect(JSON.stringify(res.body)).to.include('written');
  });

  it('rejects a PUT whose variable resource name contains an encoded /', async function () {
    const app = await makeApp();
    await putFile(app, 'x', 'foo.json');
    const res = await putFile(app, TRAVERSAL, 'pwned.json');
    expect(fs.existsSync(path.join(outsideDir, 'pwned.json'))).to.equal(false);
    expect(res).to.have.status(400);
  });

  it('rejects a variable resource named ..', async function () {
    const app = await makeApp();
    const res = await putFile(app, '%2E%2E', 'pwned.json');
    expect(fs.existsSync(path.join(tmpDir, 'users', 'TESTUSER', 'XXX', 'pluginStorage', 'pwned.json'))).to.equal(false);
    expect(res).to.have.status(400);
    expect(JSON.stringify(res.body)).to.include('ZWED0062E');
  });

  it('keeps a variable resource name containing \\ inside the user storage', async function () {
    const app = await makeApp();
    await putFile(app, 'x', 'foo.json');
    await putFile(app, encodeURIComponent('x\\..\\..\\..\\..\\..\\..\\outside'), 'pwned.json');
    await putFile(app, 'x', encodeURIComponent('..\\..\\..\\..\\..\\..\\outside\\pwned2.json'));
    expect(fs.existsSync(path.join(outsideDir, 'pwned.json'))).to.equal(false);
    expect(fs.existsSync(path.join(tmpDir, 'pwned2.json'))).to.equal(false);
    expect(fs.existsSync(path.join(outsideDir, 'pwned2.json'))).to.equal(false);
  });

  it('rejects a GET whose variable resource name contains an encoded /', async function () {
    const app = await makeApp();
    await putFile(app, 'x', 'foo.json');
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(path.join(outsideDir, 'secret.json'), '{"secret":"leaked"}');
    const res = await chai.request(app).get(`/${PLUGIN_ID}/user/${TRAVERSAL}?name=secret.json`);
    expect(res.text).to.not.include('leaked');
    expect(res).to.have.status(400);
  });

  it('rejects a recursive DELETE whose variable resource name contains an encoded /', async function () {
    const app = await makeApp();
    await putFile(app, 'x', 'foo.json');
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(path.join(outsideDir, 'keep.json'), '{}');
    const res = await chai.request(app).delete(`/${PLUGIN_ID}/user/${TRAVERSAL}?recursive=true`);
    expect(fs.existsSync(path.join(outsideDir, 'keep.json'))).to.equal(true);
    expect(res).to.have.status(400);
  });
});
