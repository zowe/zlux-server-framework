/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const assert = require('assert');
const zluxUtil = require('../../lib/util');

describe('util', function() {

  describe('getHostAndPortFromUrl', function() {
    it('should parse HTTP URL with explicit port', function() {
      const result = zluxUtil.getHostAndPortFromUrl('http://myhost:8080/path');
      assert.deepStrictEqual(result, { host: 'myhost', port: '8080' });
    });

    it('should parse HTTPS URL with explicit port', function() {
      const result = zluxUtil.getHostAndPortFromUrl('https://myhost:8443/path');
      assert.deepStrictEqual(result, { host: 'myhost', port: '8443' });
    });

    it('should return port 80 for HTTP URL with no port', function() {
      const result = zluxUtil.getHostAndPortFromUrl('http://myhost/path');
      assert.deepStrictEqual(result, { host: 'myhost', port: 80 });
    });

    it('should return port 443 for HTTPS URL with no port', function() {
      const result = zluxUtil.getHostAndPortFromUrl('https://myhost/path');
      assert.deepStrictEqual(result, { host: 'myhost', port: 443 });
    });

    it('should parse HTTP URL with no path', function() {
      const result = zluxUtil.getHostAndPortFromUrl('http://myhost:9999');
      assert.deepStrictEqual(result, { host: 'myhost', port: '9999' });
    });

    it('should strip brackets from IPv6 host', function() {
      const result = zluxUtil.getHostAndPortFromUrl('https://[::1]:8443/path');
      assert.deepStrictEqual(result, { host: '::1', port: '8443' });
    });

    it('should return undefined for a string with no protocol separator', function() {
      assert.strictEqual(zluxUtil.getHostAndPortFromUrl('notaurl'), undefined);
    });
  });

  describe('getPrefixForService', function() {
    it('should build a versioned service prefix with all arguments', function() {
      assert.strictEqual(zluxUtil.getPrefixForService('myservice', 'api', '2'), '/myservice/api/v2');
    });

    it('should default type to "api" and version to "1" when omitted', function() {
      assert.strictEqual(zluxUtil.getPrefixForService('myservice'), '/myservice/api/v1');
    });

    it('should default version to "1" when type is given but version is not', function() {
      assert.strictEqual(zluxUtil.getPrefixForService('myservice', 'ui'), '/myservice/ui/v1');
    });
  });

  describe('clone', function() {
    it('should produce a deep copy', function() {
      const original = { a: 1, b: { c: 2 } };
      const copy = zluxUtil.clone(original);
      assert.deepStrictEqual(copy, original);
    });

    it('mutating the clone should not affect the original', function() {
      const original = { a: { b: 1 } };
      const copy = zluxUtil.clone(original);
      copy.a.b = 99;
      assert.strictEqual(original.a.b, 1);
    });
  });

  describe('deepFreeze', function() {
    it('should freeze an object so properties cannot be reassigned', function() {
      const obj = { x: 1 };
      zluxUtil.deepFreeze(obj);
      assert.throws(() => { 'use strict'; obj.x = 2; }, TypeError);
    });

    it('should freeze nested objects', function() {
      const obj = { inner: { y: 42 } };
      zluxUtil.deepFreeze(obj);
      assert.throws(() => { 'use strict'; obj.inner.y = 0; }, TypeError);
    });
  });

  describe('makeOptionsObject', function() {
    it('should merge overrides onto defaults', function() {
      const defaults = { a: 1, b: 2 };
      const result = zluxUtil.makeOptionsObject(defaults, { b: 99, c: 3 });
      assert.strictEqual(result.a, 1);
      assert.strictEqual(result.b, 99);
      assert.strictEqual(result.c, 3);
    });

    it('should return a sealed object', function() {
      const result = zluxUtil.makeOptionsObject({ a: 1 }, {});
      assert.ok(Object.isSealed(result));
    });
  });

  describe('getOrInit', function() {
    it('should return the existing value when present', function() {
      const obj = { key: 'existing' };
      const val = zluxUtil.getOrInit(obj, 'key', 'default');
      assert.strictEqual(val, 'existing');
    });

    it('should initialize and return the default when the key is absent', function() {
      const obj = {};
      const val = zluxUtil.getOrInit(obj, 'missing', 'default');
      assert.strictEqual(val, 'default');
      assert.strictEqual(obj.missing, 'default');
    });
  });

  describe('resolveRelativePaths', function() {
    it('should resolve "../"-prefixed values using the provided resolver', function() {
      const root = { path: '../some/file.json' };
      const resolver = (value, relativeTo) => `/resolved/${relativeTo}/${value}`;
      zluxUtil.resolveRelativePaths(root, resolver, 'base');
      assert.strictEqual(root.path, '/resolved/base/../some/file.json');
    });

    it('should leave non-relative paths unchanged', function() {
      const root = { path: '/absolute/path' };
      zluxUtil.resolveRelativePaths(root, () => 'SHOULD_NOT_BE_CALLED', 'base');
      assert.strictEqual(root.path, '/absolute/path');
    });

    it('should recurse into nested objects', function() {
      const root = { nested: { path: '../file' } };
      const resolver = (value) => `/resolved/${value}`;
      zluxUtil.resolveRelativePaths(root, resolver, 'base');
      assert.strictEqual(root.nested.path, '/resolved/../file');
    });
  });

  describe('getZoweVersion', function() {
    it('should return the default version string before any manifest is loaded', function() {
      // Default is "0.0.0" — reading from a manifest requires a file on disk
      const version = zluxUtil.getZoweVersion();
      assert.ok(typeof version === 'string');
      assert.ok(version.length > 0);
    });
  });

  describe('makeErrorObject', function() {
    it('should build an error object with provided details', function() {
      const err = zluxUtil.makeErrorObject({ returnCode: '42', messageDetails: 'something went wrong' });
      assert.strictEqual(err._objectType, 'org.zowe.zlux.error');
      assert.strictEqual(err.returnCode, '42');
      assert.strictEqual(err.messageDetails, 'something went wrong');
    });

    it('should throw when _objectType is specified in details', function() {
      assert.throws(() => {
        zluxUtil.makeErrorObject({ _objectType: 'illegal' });
      });
    });

    it('should throw when _metaDataVersion is specified in details', function() {
      assert.throws(() => {
        zluxUtil.makeErrorObject({ _metaDataVersion: '1.0.0' });
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
