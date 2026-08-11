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
    expect(JSON.stringify(res.body)).to.include('ZWED0145E');
  });

  it('rejects DELETE to site scope with 403 when RBAC is disabled', async function () {
    const app = await makeApp(false);
    const res = await chai.request(app)
      .delete(`/${PLUGIN_ID}/site/settings?name=foo`);
    expect(res).to.have.status(403);
    expect(JSON.stringify(res.body)).to.include('ZWED0145E');
  });

  it('does not block user scope writes when RBAC is disabled', async function () {
    const app = await makeApp(false);
    const res = await chai.request(app)
      .put(`/${PLUGIN_ID}/user/settings?name=foo`)
      .set('Content-Type', 'application/json')
      .send('{}');
    const combined = (res.text || '') + JSON.stringify(res.body || {});
    expect(combined).to.not.include('ZWED0145E');
  });

  it('does not block instance scope writes when RBAC is enabled', async function () {
    const app = await makeApp(true);
    const res = await chai.request(app)
      .put(`/${PLUGIN_ID}/instance/settings?name=foo`)
      .set('Content-Type', 'application/json')
      .send('{}');
    const combined = (res.text || '') + JSON.stringify(res.body || {});
    expect(combined).to.not.include('ZWED0145E');
  });
});
