/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const assert = require('assert');
const url = require('../../lib/url');

describe('url', function() {

  describe('makePluginURL', function() {
    it('should build a slash-separated plugin URL', function() {
      assert.strictEqual(url.makePluginURL('ZLUX', 'org.zowe.foo'), '/ZLUX/plugins/org.zowe.foo');
    });

    it('should use the productCode as provided', function() {
      assert.strictEqual(url.makePluginURL('myproduct', 'org.test.bar'), '/myproduct/plugins/org.test.bar');
    });
  });

  describe('makeServiceSubURL', function() {
    const routerService = { type: 'router', name: 'myService', version: '1.2.3' };
    const importService  = { type: 'import', localName: 'localAlias', name: 'ignored', version: '2.0.0' };

    it('should build a versioned URL for a router service', function() {
      assert.strictEqual(url.makeServiceSubURL(routerService, false, false), '/services/myService/1.2.3');
    });

    it('should use localName for an import service', function() {
      assert.strictEqual(url.makeServiceSubURL(importService, false, false), '/services/localAlias/2.0.0');
    });

    it('should use _current when latest=true', function() {
      assert.strictEqual(url.makeServiceSubURL(routerService, true, false), '/services/myService/_current');
    });

    it('should omit the version when omitVersion=true', function() {
      assert.strictEqual(url.makeServiceSubURL(routerService, false, true), '/services/myService');
    });

    it('should append path when provided', function() {
      assert.strictEqual(
        url.makeServiceSubURL(routerService, false, false, 'data/items'),
        '/services/myService/1.2.3/data/items'
      );
    });

    it('should append path when omitVersion=true', function() {
      assert.strictEqual(
        url.makeServiceSubURL(routerService, false, true, 'status'),
        '/services/myService/status'
      );
    });

    it('should return only the base URL when path is undefined', function() {
      assert.strictEqual(url.makeServiceSubURL(routerService, false, false, undefined), '/services/myService/1.2.3');
    });
  });

  describe('join', function() {
    it('should concatenate base URL and relative path', function() {
      assert.strictEqual(url.join('/base', '/relative'), '/base/relative');
    });

    it('should work with empty relative path', function() {
      assert.strictEqual(url.join('/base', ''), '/base');
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
