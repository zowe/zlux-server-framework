/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('install-app addToServer', function () {
  let installApp;
  let tmpRoot;
  let installDir;
  let savedInstanceDir;

  before(function () {
    try {
      installApp = require('../../utils/install-app');
    } catch (e) {
      console.warn('Could not load install-app module:', e.message);
      this.skip();
    }
  });

  beforeEach(function () {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'install-app-'));
    installDir = path.join(tmpRoot, 'plugins');
    fs.mkdirSync(installDir);
    savedInstanceDir = process.env.ZWED_instanceDir;
    process.env.ZWED_instanceDir = path.join(tmpRoot, 'instance');
  });

  afterEach(function () {
    if (savedInstanceDir === undefined) {
      delete process.env.ZWED_instanceDir;
    } else {
      process.env.ZWED_instanceDir = savedInstanceDir;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeApp(identifier, dirName) {
    const appDir = path.join(tmpRoot, dirName || 'app');
    fs.mkdirSync(appDir);
    fs.writeFileSync(path.join(appDir, 'pluginDefinition.json'),
      JSON.stringify({ identifier, pluginVersion: '1.0.0', pluginType: 'application' }));
    return appDir;
  }

  // addToServer writes the locator asynchronously after returning.
  async function readLocator(identifier) {
    const file = path.join(installDir, identifier + '.json');
    for (let i = 0; i < 100; i++) {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    throw new Error('locator file was not written: ' + file);
  }

  [
    'org.zowe.configjs',
    'org.zowe.zlux.auth.trivial',
    'com.rs.internalAuth',
    'org.zowe.explorer-ip',
    'org.zowe.terminal.tn3270'
  ].forEach((identifier) => {
    it(`registers the valid identifier ${identifier}`, async function () {
      const appDir = makeApp(identifier);
      const result = installApp.addToServer(appDir, installDir);
      assert.deepStrictEqual(result, { success: true, message: identifier });
      assert.deepStrictEqual(await readLocator(identifier), { identifier, pluginLocation: appDir });
    });
  });

  [
    ['backslash followed by a slash', 'abc\\/xy'],
    ['backslash followed by a quote', 'abc\\"xy'],
    ['backslash followed by a letter', 'org\\xzowe'],
    ['a path separator', 'org/zowe.app'],
    ['a parent directory segment', 'org.zowe..app'],
    ['a leading parent directory', '../org.zowe'],
    ['a quote', 'org.zowe"app'],
    ['no dot', 'orgzowe'],
    ['a segment ending in a hyphen', 'org.zowe-'],
    ['an empty string', ''],
    ['a non-string', 42]
  ].forEach(([label, identifier]) => {
    it(`rejects an identifier with ${label}`, function () {
      const appDir = makeApp(identifier);
      const result = installApp.addToServer(appDir, installDir);
      assert.strictEqual(result.success, false);
      assert.match(result.message, /plugin identifier is missing or invalid/);
      assert.deepStrictEqual(fs.readdirSync(installDir), []);
    });
  });

  it('writes a locator that preserves an app directory containing quotes', async function () {
    if (process.platform === 'win32') {
      this.skip(); // '"' is not allowed in Windows file names
    }
    const appDir = makeApp('org.zowe.quoted', 'app", "pluginLocation": "/elsewhere');
    installApp.addToServer(appDir, installDir);
    assert.deepStrictEqual(await readLocator('org.zowe.quoted'),
      { identifier: 'org.zowe.quoted', pluginLocation: appDir });
  });
});
