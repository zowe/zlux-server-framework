
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
const assert = require('assert')
const path = require('path')
const PluginLoader = require('../../lib/plugin-loader')
const makePlugin = PluginLoader.makePlugin
  
const PLUGIN_PATH = path.join(process.cwd(), "test/plugin-loader");

describe('Plugin', function() {
  const pluginContext = {
    productCode: "XYZ",
    config: {},
    authManager: {}
  };
  
  describe('makePlugin', function() {
    
    //TODO more tests
    
    it('should correctly process a basic plugin def', function() {
      const testPluginDef = {
        "identifier": "org.zowe.testplugin",
        "apiVersion": "1.0.0",
        "pluginVersion": "1.0.0",
        "pluginType": "application",
      };
      const p = makePlugin(testPluginDef, {}, pluginContext, false);
      assert.equal(p.identifier, "org.zowe.testplugin");
      assert.equal(p.pluginVersion, "1.0.0");
      assert.equal(p.pluginType, "application");
      assert.equal(p.constructor.name, "ApplicationPlugIn");
    }),
    
    it('should complain about a plugin def without an ID', function() {
      /*
       * TODO other invalid combinations
       */
      const testPluginDef = {
        "apiVersion": "1.0.0",
        "pluginVersion": "1.0.0",
        "pluginType": "application",
      };
      assert.throws(() => {
        makePlugin(testPluginDef, {}, pluginContext, false);
      });
    }),
    
    it('should correctly group services', function() {
      const testPluginDef = {
        "identifier": "org.zowe.testplugin",
        "apiVersion": "1.0.0",
        "pluginVersion": "1.0.0",
        "pluginType": "application",
        "dataServices": [
          {
            "type": "router",
            "name": "foo",
            "fileName": "nop-router.js",
            "version": "1.2.3"
          },
          {
            "type": "router",
            "name": "foo",
            "fileName": "nop-router.js",
            "version": "4.5.6"
          },
          {
            "type": "router",
            "name": "bar",
            "fileName": "nop-router.js",
            "version": "4.4.4"
          }
        ],
        "location": PLUGIN_PATH
      };
      const p = makePlugin(testPluginDef, {}, pluginContext, false);
      assert(p.dataServicesGrouped)
      assert(p.dataServicesGrouped['foo'])
      assert.equal(p.dataServicesGrouped['foo'].highestVersion, '4.5.6');
      assert(p.dataServicesGrouped['foo'].versions['1.2.3'])
      assert.equal(p.dataServicesGrouped['foo'].versions['1.2.3'].name, 'foo')
      assert(p.dataServicesGrouped['foo'].versions['4.5.6'])
      assert.equal(p.dataServicesGrouped['foo'].versions['4.5.6'].name, 'foo')
      assert(p.dataServicesGrouped['bar'])
      assert.equal(p.dataServicesGrouped['bar'].highestVersion, '4.4.4');
      assert(p.dataServicesGrouped['bar'].versions['4.4.4'])
      assert.equal(p.dataServicesGrouped['bar'].versions['4.4.4'].name, 'bar')
    }),
    
    it('should correctly group imports', function() {
      const testPluginDef = {
        "identifier": "org.zowe.testplugin",
        "apiVersion": "1.0.0",
        "pluginVersion": "1.0.0",
        "pluginType": "application",
        "dataServices": [
          {
            "type": "import",
            "sourcePlugin": "org.zowe.provider",
            "sourceName": "blah",
            "versionRange": "2.0.0",
            "version": "2.0.0",
            "localName": "blah"
          },
          {
            "type": "import",
            "sourcePlugin": "org.zowe.intermediary",
            "sourceName": "something",
            "versionRange": "1.0.0",
            "version": "1.0.0",
            "localName": "something"
          }
        ],
        "location": PLUGIN_PATH
      };
      const p = makePlugin(testPluginDef, {}, pluginContext, false);
      assert(p.importsGrouped['blah'])
      assert.equal(p.importsGrouped['blah'].highestVersion, '2.0.0');
      assert(p.importsGrouped['blah'].versions['2.0.0'])
      assert(p.importsGrouped['something'])
      assert.equal(p.importsGrouped['something'].highestVersion, '1.0.0');
      assert(p.importsGrouped['something'].versions['1.0.0'])
    }),
    
    it('should correctly check local service version dependencies', function() {
      const twoVersionsOfAService = {
        "identifier": "org.zowe.testplugin",
        "apiVersion": "1.0.0",
        "pluginVersion": "1.0.0",
        "pluginType": "application",
        "dataServices": [
          {
            "type": "router",
            "name": "foo",
            "fileName": "nop-router.js",
            "version": "1.2.3"
          },
          {
            "type": "router",
            "name": "foo",
            "fileName": "nop-router.js",
            "version": "4.5.6"
          },
          {
            "type": "router",
            "name": "bar",
            "fileName": "nop-router.js",
            "version": "1.0.0",
            "versionRequirements" : {
              "foo": "^4.0.0"
            }
          }
        ],
        "location": PLUGIN_PATH
      };
      const twoVersionsOfAnImport = {
          "identifier": "org.zowe.testplugin",
          "apiVersion": "1.0.0",
          "pluginVersion": "1.0.0",
          "pluginType": "application",
          "dataServices": [
            {
              "type": "import",
              "sourcePlugin": "org.zowe.provider",
              "sourceName": "foo",
              "versionRange": "2.0.0",
              "version": "2.0.0",
              "localName": "foo"
            },
            {
              "type": "import",
              "sourcePlugin": "org.zowe.provider",
              "sourceName": "foo",
              "versionRange": "^4.0.0",
              "version": "4.1.1",
              "localName": "foo"
            },
            {
              "type": "router",
              "name": "bar",
              "fileName": "nop-router.js",
              "version": "1.0.0",
              "versionRequirements" : {
                "foo": "^4.0.0"
              }
            }
          ],
          "location": PLUGIN_PATH
        };
      const requiredServiceMissing = {
          "identifier": "org.zowe.testplugin",
          "apiVersion": "1.0.0",
          "pluginVersion": "1.0.0",
          "pluginType": "application",
          "location": PLUGIN_PATH,
          "dataServices": [
            {
              "type": "router",
              "name": "bar",
              "fileName": "nop-router.js",
              "version": "1.0.0",
              "versionRequirements" : {
                "foo": "^4.0.0"
              }
            }
          ]
        };
      const requiredServiceVersionMissing = {
          "identifier": "org.zowe.testplugin",
          "apiVersion": "1.0.0",
          "pluginVersion": "1.0.0",
          "pluginType": "application",
          "location": PLUGIN_PATH,
          "dataServices": [
            {
              "type": "router",
              "name": "foo",
              "fileName": "nop-router.js",
              "version": "1.2.3"
            },
            {
              "type": "router",
              "name": "bar",
              "fileName": "nop-router.js",
              "version": "1.0.0",
              "versionRequirements" : {
                "foo": "^4.0.0"
              }
            }
          ]
        };
      const p = makePlugin(twoVersionsOfAService, {}, pluginContext, false);
      assert.equal(
          p.dataServicesGrouped['bar'].versions['1.0.0'].versionRequirements.foo,
          '4.5.6')
      const p2 = makePlugin(twoVersionsOfAnImport, {}, pluginContext, false);
      assert.equal(
          p2.dataServicesGrouped['bar'].versions['1.0.0'].versionRequirements.foo,
          '4.1.1')
      assert.throws(() => {
        makePlugin(requiredServiceMissing, {}, pluginContext, false);
      }, /Required local service missing/);
      assert.throws(() => {
        makePlugin(requiredServiceVersionMissing, {}, pluginContext, false);
      }, /Could not find a version to satisfy/);
    })
    
  })
})
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
