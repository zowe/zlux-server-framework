/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

const fs = require('fs');
const http = require('http');
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

  function makeContext(rbacEnabled, zoweConfig) {
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
            app: { productCode: 'XXX' },
            all: zoweConfig
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

  async function makeApp(rbacEnabled, zoweConfig) {
    const router = await configService.configRouter(makeContext(rbacEnabled, zoweConfig));
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

  describe('request body decompression', function () {
    const zlib = require('zlib');
    const gzipped = zlib.gzipSync('{}');
    // Sends the raw bytes with fetch: superagent would JSON-encode a Buffer for this content type.
    const putCompressed = async (app, encoding, body) => {
      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/${PLUGIN_ID}/user/settings?name=foo`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding, 'Connection': 'close' },
          body
        });
        return { status: response.status };
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    };

    it('rejects a gzip request body with 415 by default', async function () {
      const app = await makeApp(false);
      const res = await putCompressed(app, 'gzip', gzipped);
      expect(res.status).to.equal(415);
    });

    it('rejects a gzip request body with 415 when inflate is false', async function () {
      const app = await makeApp(false, { components: { 'app-server': { node: { inflate: false } } } });
      const res = await putCompressed(app, 'gzip', gzipped);
      expect(res.status).to.equal(415);
    });

    it('rejects a br request body with 415 by default', async function () {
      const app = await makeApp(false);
      const res = await putCompressed(app, 'br', Buffer.from('{}'));
      expect(res.status).to.equal(415);
    });

    it('accepts a gzip request body when inflate is true', async function () {
      const app = await makeApp(false, { components: { 'app-server': { node: { inflate: true } } } });
      const res = await putCompressed(app, 'gzip', gzipped);
      expect(res.status).to.not.equal(415);
    });

    it('still rejects a br request body when inflate is true', async function () {
      const app = await makeApp(false, { components: { 'app-server': { node: { inflate: true } } } });
      const res = await putCompressed(app, 'br', Buffer.from('{}'));
      expect(res.status).to.equal(415);
    });
  });
});
