'use strict';
const { expect } = require('chai');
const path = require('path');

const util = require('../../lib/util');

describe('util.js — deep architectural tests', function () {

  describe('getHostAndPortFromUrl', function () {
    const getHostAndPort = util.getHostAndPortFromUrl;

    it('should parse https URL with port', function () {
      const result = getHostAndPort('https://example.com:7554/api');
      expect(result.host).to.equal('example.com');
      expect(result.port).to.equal('7554');
    });

    it('should parse http URL with port', function () {
      const result = getHostAndPort('http://example.com:8080/path');
      expect(result.host).to.equal('example.com');
      expect(result.port).to.equal('8080');
    });

    it('should default to 443 for https without port', function () {
      const result = getHostAndPort('https://example.com/path');
      expect(result.host).to.equal('example.com');
      expect(result.port).to.equal(443);
    });

    it('should default to 80 for http without port', function () {
      const result = getHostAndPort('http://example.com/path');
      expect(result.host).to.equal('example.com');
      expect(result.port).to.equal(80);
    });

    it('should return undefined for invalid URL (no protocol)', function () {
      expect(getHostAndPort('example.com:8080')).to.be.undefined;
    });

    it('should handle URL with no path', function () {
      const result = getHostAndPort('https://example.com:443');
      expect(result.host).to.equal('example.com');
      expect(result.port).to.equal('443');
    });

    it('should handle IPv6 address with port', function () {
      const result = getHostAndPort('https://[::1]:7554/path');
      expect(result.host).to.equal('::1');
      expect(result.port).to.equal('7554');
    });

    it('FLAW: port is returned as string, not number', function () {
      const result = getHostAndPort('http://host:8080/path');
      expect(typeof result.port).to.equal('string');
    });

    it('FLAW: does not validate port is numeric', function () {
      const result = getHostAndPort('http://host:notaport/path');
      expect(result.port).to.equal('notaport');
    });

    it('should handle URL with credentials', function () {
      const result = getHostAndPort('http://user:pass@host:3000/path');
      expect(result.port).to.equal('3000');
    });

    it('should handle empty path after port', function () {
      const result = getHostAndPort('https://host:443/');
      expect(result.port).to.equal('443');
    });
  });

  describe('makeOptionsObject', function () {
    it('should merge options over defaults', function () {
      const defaults = { a: 1, b: 2 };
      const input = { b: 3, c: 4 };
      const result = util.makeOptionsObject(defaults, input);
      expect(result.a).to.equal(1);
      expect(result.b).to.equal(3);
    });

    it('should seal the result (no new properties)', function () {
      const result = util.makeOptionsObject({ a: 1 }, {});
      expect(() => { result.newProp = 'x'; }).to.throw(TypeError);
    });
  });

  describe('clone', function () {
    it('should deep clone an object', function () {
      const obj = { a: { b: { c: 1 } } };
      const cloned = util.clone(obj);
      cloned.a.b.c = 999;
      expect(obj.a.b.c).to.equal(1);
    });

    it('FLAW: silently drops undefined values', function () {
      const obj = { a: undefined, b: 1 };
      const cloned = util.clone(obj);
      expect(cloned).to.not.have.property('a');
    });

    it('FLAW: silently drops function values', function () {
      const obj = { fn: () => {}, b: 1 };
      const cloned = util.clone(obj);
      expect(cloned).to.not.have.property('fn');
    });

    it('FLAW: converts Date objects to strings', function () {
      const obj = { d: new Date('2024-01-01') };
      const cloned = util.clone(obj);
      expect(typeof cloned.d).to.equal('string');
    });

    it('FLAW: throws on circular references', function () {
      const obj = { a: 1 };
      obj.self = obj;
      expect(() => util.clone(obj)).to.throw();
    });

    it('should handle arrays', function () {
      const arr = [1, [2, 3], { a: 4 }];
      const cloned = util.clone(arr);
      cloned[1][0] = 99;
      expect(arr[1][0]).to.equal(2);
    });

    it('should handle null and empty object', function () {
      expect(util.clone(null)).to.be.null;
      expect(util.clone({})).to.deep.equal({});
    });
  });

  describe('deepFreeze', function () {
    it('should freeze an object deeply', function () {
      const obj = { a: { b: { c: 1 } } };
      util.deepFreeze(obj);
      expect(Object.isFrozen(obj)).to.be.true;
      expect(Object.isFrozen(obj.a)).to.be.true;
      expect(Object.isFrozen(obj.a.b)).to.be.true;
    });

    it('should handle circular references without stack overflow', function () {
      const obj = { a: 1 };
      obj.self = obj;
      expect(() => util.deepFreeze(obj)).to.not.throw();
      expect(Object.isFrozen(obj)).to.be.true;
    });

    it('should handle null properties', function () {
      const obj = { a: null, b: { c: null } };
      util.deepFreeze(obj);
      expect(Object.isFrozen(obj)).to.be.true;
    });

    it('should freeze arrays', function () {
      const obj = { arr: [1, { nested: true }] };
      util.deepFreeze(obj);
      expect(Object.isFrozen(obj.arr)).to.be.true;
      expect(Object.isFrozen(obj.arr[1])).to.be.true;
    });
  });

  describe('readOnlyProxy', function () {
    it('should allow reading properties', function () {
      const obj = { a: 1, b: 'hello' };
      const proxy = util.readOnlyProxy(obj);
      expect(proxy.a).to.equal(1);
      expect(proxy.b).to.equal('hello');
    });

    it('FLAW: set/delete are NOT blocked — proxy is not truly read-only', function () {
      const obj = { a: 1 };
      const proxy = util.readOnlyProxy(obj);
      proxy.a = 999;
      expect(obj.a).to.equal(999);
      delete proxy.a;
      expect(obj.a).to.be.undefined;
    });
  });

  describe('getOrInit', function () {
    it('should return existing value', function () {
      const obj = { key: 'existing' };
      expect(util.getOrInit(obj, 'key', 'default')).to.equal('existing');
    });

    it('should set and return default when key is missing', function () {
      const obj = {};
      const result = util.getOrInit(obj, 'key', 'default');
      expect(result).to.equal('default');
      expect(obj.key).to.equal('default');
    });

    it('FLAW: treats 0, empty string, false as missing (uses !value)', function () {
      const obj = { count: 0, flag: false, name: '' };
      expect(util.getOrInit(obj, 'count', 99)).to.equal(99);
      expect(util.getOrInit(obj, 'flag', true)).to.equal(true);
      expect(util.getOrInit(obj, 'name', 'default')).to.equal('default');
    });
  });

  describe('resolveRelativePaths', function () {
    it('should resolve ../ prefixed paths', function () {
      const root = { certPath: '../certs/server.pem', name: 'test' };
      util.resolveRelativePaths(root, path.resolve, '/app/config');
      expect(path.isAbsolute(root.certPath)).to.be.true;
    });

    it('should not touch non-relative strings', function () {
      const root = { path: '/absolute/path', num: 42 };
      util.resolveRelativePaths(root, path.resolve, '/base');
      expect(root.path).to.equal('/absolute/path');
    });

    it('should recurse into nested objects', function () {
      const root = { nested: { deep: { val: '../up/file.txt' } } };
      util.resolveRelativePaths(root, path.resolve, '/base');
      expect(path.isAbsolute(root.nested.deep.val)).to.be.true;
    });

    it('should skip null values in objects', function () {
      const root = { a: null, b: '../file.txt' };
      expect(() => util.resolveRelativePaths(root, path.resolve, '/base')).to.not.throw();
    });

    it('FLAW: no circular reference guard — will stack overflow', function () {
      const root = { a: 1 };
      root.self = root;
      expect(() => util.resolveRelativePaths(root, path.resolve, '/base')).to.throw(RangeError);
    });
  });

  describe('makeErrorObject', function () {
    it('should merge details into error template', function () {
      const err = util.makeErrorObject({
        messageTemplate: 'Custom error',
        returnCode: '42'
      });
      expect(err._objectType).to.equal('org.zowe.zlux.error');
      expect(err.messageTemplate).to.equal('Custom error');
      expect(err.returnCode).to.equal('42');
    });

    it('should throw if _objectType is specified', function () {
      expect(() => util.makeErrorObject({ _objectType: 'custom' })).to.throw(/ZWED0049E/);
    });

    it('should throw if _metaDataVersion is specified', function () {
      expect(() => util.makeErrorObject({ _metaDataVersion: '2.0' })).to.throw(/ZWED0049E/);
    });

    it('should not mutate errorProto', function () {
      util.makeErrorObject({ messageTemplate: 'override' });
      const err2 = util.makeErrorObject({});
      expect(err2.messageTemplate).to.equal('An error occurred');
    });
  });

  describe('concatIterables', function () {
    it('should concatenate multiple iterables', function () {
      const result = [...util.concatIterables([1, 2], [3, 4], [5])];
      expect(result).to.deep.equal([1, 2, 3, 4, 5]);
    });

    it('should handle empty iterables', function () {
      const result = [...util.concatIterables([], [1], [])];
      expect(result).to.deep.equal([1]);
    });

    it('should handle zero arguments', function () {
      const result = [...util.concatIterables()];
      expect(result).to.deep.equal([]);
    });

    it('should work with Sets', function () {
      const result = [...util.concatIterables(new Set([1, 2]), new Set([3]))];
      expect(result).to.deep.equal([1, 2, 3]);
    });
  });

  describe('formatErrorStatus', function () {
    it('should format error with description lookup', function () {
      const err = { status: 'MISSING', key: 'value' };
      const descriptions = { MISSING: 'Not found' };
      const result = util.formatErrorStatus(err, descriptions);
      expect(result).to.include('Not found');
      expect(result).to.include('key: value');
    });

    it('should use raw status when no description', function () {
      const err = { status: 'UNKNOWN' };
      const result = util.formatErrorStatus(err, {});
      expect(result).to.include('UNKNOWN');
    });
  });

  describe('normalizePath', function () {
    it('should resolve relative path against relativeTo', function () {
      const result = util.normalizePath('./config', '/app/server');
      expect(path.isAbsolute(result)).to.be.true;
    });

    it('should not change absolute paths', function () {
      const abs = path.resolve('/absolute/path');
      const result = util.normalizePath(abs, '/other');
      expect(result).to.contain('absolute');
    });

    it('should strip trailing separator', function () {
      const result = util.normalizePath('./dir/', '/base');
      expect(result.endsWith(path.sep)).to.be.false;
    });

    it('should default relativeTo to cwd', function () {
      const result = util.normalizePath('./test');
      expect(result.startsWith(process.cwd())).to.be.true;
    });
  });

  describe('timeout', function () {
    it('should resolve after specified ms', async function () {
      const start = Date.now();
      await util.timeout(50);
      const elapsed = Date.now() - start;
      expect(elapsed).to.be.at.least(40);
    });

    it('should return a thenable (bluebird Promise)', function () {
      const result = util.timeout(1);
      expect(result).to.have.property('then');
      expect(typeof result.then).to.equal('function');
    });
  });

  describe('getCookieName', function () {
    it('should prefix with connect.sid.', function () {
      expect(util.getCookieName('myapp')).to.equal('connect.sid.myapp');
    });

    it('should handle empty identifier', function () {
      expect(util.getCookieName('')).to.equal('connect.sid.');
    });
  });

  describe('getLoopbackAddress', function () {
    it('should return 127.0.0.1 for null/empty', function () {
      expect(util.getLoopbackAddress(null)).to.equal('127.0.0.1');
      expect(util.getLoopbackAddress([])).to.equal('127.0.0.1');
    });

    it('should return 127.0.0.1 for 0.0.0.0', function () {
      expect(util.getLoopbackAddress(['0.0.0.0'])).to.equal('127.0.0.1');
    });

    it('should detect loopback addresses', function () {
      expect(util.getLoopbackAddress(['127.0.0.1'])).to.equal('127.0.0.1');
    });

    it('should fallback to first address if no loopback found', function () {
      expect(util.getLoopbackAddress(['10.0.0.1', '10.0.0.2'])).to.equal('10.0.0.1');
    });

    it('should handle IPv6 loopback', function () {
      expect(util.getLoopbackAddress(['::1'])).to.equal('::1');
    });
  });

  describe('isHaMode', function () {
    it('should return a boolean', function () {
      expect(typeof util.isHaMode()).to.equal('boolean');
    });
  });

  describe('getPrefixForService', function () {
    it('should format service prefix with defaults', function () {
      expect(util.getPrefixForService('myService')).to.equal('/myService/api/v1');
    });

    it('should use provided type and version', function () {
      expect(util.getPrefixForService('svc', 'ws', '2')).to.equal('/svc/ws/v2');
    });
  });

  describe('getRemoteIframeTemplate', function () {
    it('should insert URL into template', function () {
      const html = util.getRemoteIframeTemplate('https://example.com');
      expect(html).to.include('https://example.com');
    });

    it('FLAW: does not escape URL — XSS if URL is attacker-controlled', function () {
      const malicious = '"><script>alert(1)</script>';
      const html = util.getRemoteIframeTemplate(malicious);
      expect(html).to.include('<script>alert(1)</script>');
    });
  });
});
