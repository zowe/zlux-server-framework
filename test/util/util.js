/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

// Stub the global logger before requiring any library code
const noop = () => {};
global.COM_RS_COMMON_LOGGER = {
  makeComponentLogger: () => ({
    info: noop, warn: noop, debug: noop, severe: noop, log: noop, trace: noop
  })
};

const chai = require('chai');
const expect = chai.expect;
const zluxUtil = require('../../lib/util');

describe('lib/util', function () {

  describe('clone', function () {
    it('creates a deep copy of a simple object', function () {
      const obj = { a: 1, b: { c: 2 } };
      const cloned = zluxUtil.clone(obj);
      expect(cloned).to.deep.equal(obj);
      cloned.b.c = 99;
      expect(obj.b.c).to.equal(2);
    });

    it('handles arrays', function () {
      const arr = [1, [2, 3]];
      const cloned = zluxUtil.clone(arr);
      expect(cloned).to.deep.equal(arr);
      cloned[1][0] = 99;
      expect(arr[1][0]).to.equal(2);
    });

    it('handles null values', function () {
      const obj = { a: null };
      const cloned = zluxUtil.clone(obj);
      expect(cloned.a).to.be.null;
    });
  });

  describe('deepFreeze', function () {
    it('freezes a simple object', function () {
      const obj = { x: 1, y: 2 };
      zluxUtil.deepFreeze(obj);
      expect(Object.isFrozen(obj)).to.be.true;
    });

    it('deeply freezes nested objects', function () {
      const obj = { a: { b: { c: 3 } } };
      zluxUtil.deepFreeze(obj);
      expect(Object.isFrozen(obj)).to.be.true;
      expect(Object.isFrozen(obj.a)).to.be.true;
      expect(Object.isFrozen(obj.a.b)).to.be.true;
    });

    it('handles circular references without infinite loop', function () {
      const obj = { name: 'root' };
      obj.self = obj;
      // Should not throw or loop forever
      zluxUtil.deepFreeze(obj);
      expect(Object.isFrozen(obj)).to.be.true;
    });

    it('does not throw on null nested properties', function () {
      const obj = { a: null, b: 'str' };
      expect(() => zluxUtil.deepFreeze(obj)).to.not.throw();
    });
  });

  describe('makeOptionsObject', function () {
    it('creates an object inheriting defaults with overrides', function () {
      const defaults = { port: 8080, host: 'localhost' };
      const result = zluxUtil.makeOptionsObject(defaults, { port: 9090 });
      expect(result.port).to.equal(9090);
      expect(result.host).to.equal('localhost');
    });

    it('seals the result so new properties cannot be added', function () {
      const defaults = { port: 8080 };
      const result = zluxUtil.makeOptionsObject(defaults, {});
      expect(Object.isSealed(result)).to.be.true;
    });
  });

  describe('getOrInit', function () {
    it('returns existing value if key exists', function () {
      const obj = { key: 'existing' };
      expect(zluxUtil.getOrInit(obj, 'key', 'default')).to.equal('existing');
    });

    it('sets and returns default if key does not exist', function () {
      const obj = {};
      const result = zluxUtil.getOrInit(obj, 'key', 'default');
      expect(result).to.equal('default');
      expect(obj.key).to.equal('default');
    });

    it('sets and returns default if value is falsy (0, empty string)', function () {
      const obj = { a: 0, b: '' };
      expect(zluxUtil.getOrInit(obj, 'a', 999)).to.equal(999);
      expect(zluxUtil.getOrInit(obj, 'b', 'fallback')).to.equal('fallback');
    });
  });

  describe('makeErrorObject', function () {
    it('creates an error object with standard prototype fields', function () {
      const err = zluxUtil.makeErrorObject({ messageDetails: 'custom error' });
      expect(err._objectType).to.equal('org.zowe.zlux.error');
      expect(err._metaDataVersion).to.equal('1.0.0');
      expect(err.messageDetails).to.equal('custom error');
    });

    it('throws if _objectType is specified in details', function () {
      expect(() => zluxUtil.makeErrorObject({ _objectType: 'bad' })).to.throw();
    });

    it('throws if _metaDataVersion is specified in details', function () {
      expect(() => zluxUtil.makeErrorObject({ _metaDataVersion: 'bad' })).to.throw();
    });

    it('merges additional custom fields', function () {
      const err = zluxUtil.makeErrorObject({ customField: 'foo', returnCode: '5' });
      expect(err.customField).to.equal('foo');
      expect(err.returnCode).to.equal('5');
    });
  });

  describe('getHostAndPortFromUrl', function () {
    it('extracts host and port from an https URL', function () {
      const result = zluxUtil.getHostAndPortFromUrl('https://example.com:8544/path');
      expect(result.host).to.equal('example.com');
      expect(result.port).to.equal('8544');
    });

    it('extracts host and port from an http URL', function () {
      const result = zluxUtil.getHostAndPortFromUrl('http://localhost:3000');
      expect(result.host).to.equal('localhost');
      expect(result.port).to.equal('3000');
    });

    it('returns default port 443 for https without explicit port', function () {
      const result = zluxUtil.getHostAndPortFromUrl('https://example.com/path');
      expect(result.host).to.equal('example.com');
      expect(result.port).to.equal(443);
    });

    it('returns default port 80 for http without explicit port', function () {
      const result = zluxUtil.getHostAndPortFromUrl('http://example.com/path');
      expect(result.host).to.equal('example.com');
      expect(result.port).to.equal(80);
    });

    it('returns undefined for a string without :// protocol', function () {
      const result = zluxUtil.getHostAndPortFromUrl('not-a-url');
      expect(result).to.be.undefined;
    });

    it('handles IPv6 addresses in brackets', function () {
      const result = zluxUtil.getHostAndPortFromUrl('https://[::1]:7554/api');
      expect(result.host).to.equal('::1');
      expect(result.port).to.equal('7554');
    });

    it('handles URL without path', function () {
      const result = zluxUtil.getHostAndPortFromUrl('https://host.example.com:443');
      expect(result.host).to.equal('host.example.com');
      expect(result.port).to.equal('443');
    });
  });

  describe('formatErrorStatus', function () {
    it('formats error with status description and keywords', function () {
      const err = { status: 'NOT_FOUND', pluginId: 'org.zowe.test' };
      const descriptions = { 'NOT_FOUND': 'Plugin not found' };
      const result = zluxUtil.formatErrorStatus(err, descriptions);
      expect(result).to.include('Plugin not found');
      expect(result).to.include('org.zowe.test');
    });

    it('uses status string itself when no description matches', function () {
      const err = { status: 'UNKNOWN_ERROR', detail: 'abc' };
      const result = zluxUtil.formatErrorStatus(err, {});
      expect(result).to.include('UNKNOWN_ERROR');
      expect(result).to.include('abc');
    });

    it('handles error with only status field', function () {
      const err = { status: 'EMPTY' };
      const descriptions = { 'EMPTY': 'No data' };
      const result = zluxUtil.formatErrorStatus(err, descriptions);
      expect(result).to.equal('No data: ');
    });
  });

  describe('getPrefixForService', function () {
    it('returns default prefix with api/v1', function () {
      const result = zluxUtil.getPrefixForService('myservice');
      expect(result).to.equal('/myservice/api/v1');
    });

    it('uses custom type and version', function () {
      const result = zluxUtil.getPrefixForService('svc', 'ws', '2');
      expect(result).to.equal('/svc/ws/v2');
    });

    it('uses defaults for undefined type and version', function () {
      const result = zluxUtil.getPrefixForService('svc', undefined, undefined);
      expect(result).to.equal('/svc/api/v1');
    });
  });

  describe('normalizePath', function () {
    it('returns absolute path unchanged (minus trailing separator)', function () {
      const p = process.platform === 'win32' ? 'C:\\Users\\test' : '/home/test';
      const result = zluxUtil.normalizePath(p);
      expect(result).to.equal(p);
    });

    it('resolves relative path using relativeTo', function () {
      const base = process.platform === 'win32' ? 'C:\\base' : '/base';
      const result = zluxUtil.normalizePath('./sub/dir', base);
      expect(result).to.include('sub');
      expect(result).to.include('dir');
    });

    it('strips trailing path separator', function () {
      const sep = require('path').sep;
      const p = process.platform === 'win32' ? 'C:\\Users\\test\\' : '/home/test/';
      const result = zluxUtil.normalizePath(p);
      expect(result.endsWith(sep)).to.be.false;
    });
  });

  describe('readOnlyProxy', function () {
    it('returns a proxy that allows reading properties', function () {
      const obj = { a: 1, b: 'hello' };
      const proxy = zluxUtil.readOnlyProxy(obj);
      expect(proxy.a).to.equal(1);
      expect(proxy.b).to.equal('hello');
    });
  });

  describe('getLoopbackAddress', function () {
    it('returns 127.0.0.1 when no addresses specified', function () {
      expect(zluxUtil.getLoopbackAddress(null)).to.equal('127.0.0.1');
      expect(zluxUtil.getLoopbackAddress([])).to.equal('127.0.0.1');
    });

    it('returns 127.0.0.1 when 0.0.0.0 is in the list', function () {
      expect(zluxUtil.getLoopbackAddress(['0.0.0.0'])).to.equal('127.0.0.1');
    });

    it('returns the loopback address from the list', function () {
      expect(zluxUtil.getLoopbackAddress(['127.0.0.1', '192.168.1.1'])).to.equal('127.0.0.1');
    });

    it('returns first address when no loopback found', function () {
      expect(zluxUtil.getLoopbackAddress(['10.0.0.1', '192.168.1.1'])).to.equal('10.0.0.1');
    });

    it('handles invalid address strings gracefully', function () {
      // Should not throw even with garbage input
      const result = zluxUtil.getLoopbackAddress(['not-an-ip', '10.0.0.1']);
      expect(result).to.be.a('string');
    });
  });

  describe('getCookieName', function () {
    it('returns connect.sid. prefixed with identifier', function () {
      expect(zluxUtil.getCookieName('myapp')).to.equal('connect.sid.myapp');
    });
  });

  describe('isHaMode', function () {
    it('returns a boolean', function () {
      const result = zluxUtil.isHaMode();
      expect(result).to.be.a('boolean');
    });
  });

  describe('resolveRelativePaths', function () {
    it('resolves string values starting with ../', function () {
      const obj = { path: '../foo/bar' };
      zluxUtil.resolveRelativePaths(obj, (val, rel) => '/resolved' + val.substring(2), '/base');
      expect(obj.path).to.equal('/resolved/foo/bar');
    });

    it('leaves non-relative strings unchanged', function () {
      const obj = { path: '/absolute/path' };
      zluxUtil.resolveRelativePaths(obj, () => 'changed', '/base');
      expect(obj.path).to.equal('/absolute/path');
    });

    it('recurses into nested objects', function () {
      const obj = { nested: { path: '../x' } };
      zluxUtil.resolveRelativePaths(obj, (val) => '/resolved', '/base');
      expect(obj.nested.path).to.equal('/resolved');
    });
  });

  describe('concatIterables', function () {
    it('concatenates multiple arrays as iterables', function () {
      const result = Array.from(zluxUtil.concatIterables([1, 2], [3, 4], [5]));
      expect(result).to.deep.equal([1, 2, 3, 4, 5]);
    });

    it('handles empty iterables', function () {
      const result = Array.from(zluxUtil.concatIterables([], [1], []));
      expect(result).to.deep.equal([1]);
    });
  });

  describe('getRemoteIframeTemplate', function () {
    it('substitutes remoteUrl into the template', function () {
      const result = zluxUtil.getRemoteIframeTemplate('https://example.com');
      expect(result).to.include('https://example.com');
    });
  });

  describe('isServerHttps', function () {
    it('returns true when https port is an integer', function () {
      const config = { components: { 'app-server': { node: { https: { port: 7556 } } } } };
      expect(zluxUtil.isServerHttps(config)).to.be.true;
    });

    it('returns false when https port is not set', function () {
      const config = { components: { 'app-server': { node: { http: { port: 7556 } } } } };
      expect(zluxUtil.isServerHttps(config)).to.be.false;
    });

    it('returns false when https port is a string', function () {
      const config = { components: { 'app-server': { node: { https: { port: '7556' } } } } };
      expect(zluxUtil.isServerHttps(config)).to.be.false;
    });
  });

  describe('getBestPort', function () {
    it('returns https port when available', function () {
      const config = { components: { 'app-server': { node: { https: { port: 443 }, http: { port: 80 } } } } };
      expect(zluxUtil.getBestPort(config)).to.equal(443);
    });

    it('returns http port when https is not configured', function () {
      const config = { components: { 'app-server': { node: { http: { port: 80 } } } } };
      expect(zluxUtil.getBestPort(config)).to.equal(80);
    });
  });

  describe('getBestHostname', function () {
    it('returns first external domain', function () {
      const config = { zowe: { externalDomains: ['my.host.com', 'other.host.com'] } };
      expect(zluxUtil.getBestHostname(config)).to.equal('my.host.com');
    });
  });

  describe('getListeningAddresses', function () {
    it('combines https and http addresses without duplicates', function () {
      const config = {
        components: {
          'app-server': {
            node: {
              https: { ipAddresses: ['0.0.0.0'] },
              http: { ipAddresses: ['0.0.0.0', '127.0.0.1'] }
            }
          }
        }
      };
      const result = zluxUtil.getListeningAddresses(config);
      expect(result).to.include('0.0.0.0');
      expect(result).to.include('127.0.0.1');
      // No duplicates
      expect(result.filter(a => a === '0.0.0.0').length).to.equal(1);
    });
  });

  describe('getProductCode', function () {
    it('returns productCode from config', function () {
      const config = { components: { 'app-server': { node: { productCode: 'ZLUX' } } } };
      expect(zluxUtil.getProductCode(config)).to.equal('ZLUX');
    });
  });

  describe('isClientAttls', function () {
    it('returns false when no attls config is set', function () {
      const config = { zowe: { network: {} }, components: { 'app-server': { zowe: {} } } };
      expect(zluxUtil.isClientAttls(config)).to.be.false;
    });

    it('returns true when client local attls is true', function () {
      const config = {
        zowe: { network: {} },
        components: { 'app-server': { zowe: { network: { client: { tls: { attls: true } } } } } }
      };
      expect(zluxUtil.isClientAttls(config)).to.be.true;
    });

    it('falls back to server attls if client is not explicitly set', function () {
      const config = {
        zowe: { network: { server: { tls: { attls: true } } } },
        components: { 'app-server': { zowe: {} } }
      };
      expect(zluxUtil.isClientAttls(config)).to.be.true;
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
