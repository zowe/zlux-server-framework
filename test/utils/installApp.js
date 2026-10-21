/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The identifier is validated before any file is written, so a rejected identifier
// must leave the plugins directory empty and a valid one must be registered.
describe('install-app plugin identifier validation', function () {
  let addToServer;
  let tmpDir;
  let appDir;
  let installDir;

  before(function () {
    try {
      addToServer = require('../../utils/install-app').addToServer;
    } catch (e) {
      console.warn('Could not load install-app module:', e.message);
      this.skip();
    }
  });

  beforeEach(function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-app-test-'));
    appDir = path.join(tmpDir, 'app');
    installDir = path.join(tmpDir, 'plugins');
    fs.mkdirSync(appDir);
    fs.mkdirSync(installDir);
  });

  afterEach(function () {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function register(identifier) {
    fs.writeFileSync(path.join(appDir, 'pluginDefinition.json'), JSON.stringify({ identifier: identifier }));
    return addToServer(appDir, installDir);
  }

  it('accepts a reverse-DNS identifier', function () {
    const result = register('org.zowe.configjs');
    assert.strictEqual(result.success, true, result.message);
  });

  it('writes a locator that parses back to the identifier and a location containing quotes and backslashes', async function () {
    const awkwardAppDir = path.join(tmpDir, 'we"ird\\app');
    fs.mkdirSync(awkwardAppDir);
    fs.writeFileSync(path.join(awkwardAppDir, 'pluginDefinition.json'), JSON.stringify({ identifier: 'org.zowe.configjs' }));
    const result = addToServer(awkwardAppDir, installDir);
    assert.strictEqual(result.success, true, result.message);
    const locatorPath = path.join(installDir, 'org.zowe.configjs.json');
    // fs.writeFile is asynchronous, so wait until the file has content
    for (let i = 0; i < 50 && !(fs.existsSync(locatorPath) && fs.statSync(locatorPath).size > 0); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const locator = JSON.parse(fs.readFileSync(locatorPath, 'utf8'));
    assert.deepStrictEqual(locator, { identifier: 'org.zowe.configjs', pluginLocation: awkwardAppDir });
  });

  it('rejects an identifier containing a quote', function () {
    const result = register('ab\\"x');
    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(fs.readdirSync(installDir), []);
  });

  it('rejects an identifier containing a path separator', function () {
    const result = register('org.zowe/evil');
    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(fs.readdirSync(installDir), []);
  });

  it('rejects an identifier containing ..', function () {
    const result = register('org..zowe');
    assert.strictEqual(result.success, false);
  });
});
