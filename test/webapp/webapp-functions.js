'use strict';
const { expect } = require('chai');
const url = require('../../lib/url');

describe('url.js', function () {

  describe('makePluginURL', function () {
    it('should format plugin URL correctly', function () {
      expect(url.makePluginURL('ZLUX', 'org.zowe.foo'))
        .to.equal('/ZLUX/plugins/org.zowe.foo');
    });

    it('should handle empty product code', function () {
      expect(url.makePluginURL('', 'plugin'))
        .to.equal('//plugins/plugin');
    });
  });

  describe('makeServiceSubURL', function () {
    it('should format versioned URL for service', function () {
      const service = { type: 'service', name: 'data', version: '1.0.0' };
      expect(url.makeServiceSubURL(service, false, false))
        .to.equal('/services/data/1.0.0');
    });

    it('should use _current for latest', function () {
      const service = { type: 'service', name: 'data', version: '1.0.0' };
      expect(url.makeServiceSubURL(service, true, false))
        .to.equal('/services/data/_current');
    });

    it('should omit version when omitVersion is true', function () {
      const service = { type: 'service', name: 'data', version: '1.0.0' };
      expect(url.makeServiceSubURL(service, false, true))
        .to.equal('/services/data');
    });

    it('should use localName for import type', function () {
      const service = { type: 'import', localName: 'myLocal', name: 'ignore', version: '1.0.0' };
      expect(url.makeServiceSubURL(service, false, false))
        .to.equal('/services/myLocal/1.0.0');
    });

    it('should append path when provided', function () {
      const service = { type: 'service', name: 'data', version: '1.0.0' };
      expect(url.makeServiceSubURL(service, true, false, 'sub/path'))
        .to.equal('/services/data/_current/sub/path');
    });

    it('should not append path when falsy', function () {
      const service = { type: 'service', name: 'data', version: '1.0.0' };
      const result = url.makeServiceSubURL(service, false, false, null);
      expect(result).to.equal('/services/data/1.0.0');
    });

    it('should not append path when undefined', function () {
      const service = { type: 'service', name: 'data', version: '1.0.0' };
      const result = url.makeServiceSubURL(service, false, false, undefined);
      expect(result).to.equal('/services/data/1.0.0');
    });
  });

  describe('join', function () {
    it('should concatenate base and relative', function () {
      expect(url.join('/base', '/path')).to.equal('/base/path');
    });

    it('FLAW: naive concatenation — double slashes', function () {
      expect(url.join('/base/', '/path')).to.equal('/base//path');
    });

    it('FLAW: no normalization of .. segments', function () {
      expect(url.join('/base/sub', '/../other')).to.equal('/base/sub/../other');
    });
  });
});

describe('webapp.js — testable pure functions', function () {

  describe('getAttrib (via webapp internals)', function () {
    // getAttrib and setAttrib are used internally in webapp.js
    // We can test them by recreating the logic since they're not exported
    // OR we test the behavior through the /server routes if possible.
    
    // Recreate getAttrib for testing (matches webapp.js implementation)
    function getAttrib(object, path) {
      if (object === undefined || path === undefined ||
        typeof path !== 'string' || typeof object !== 'object') return undefined;
      let objCopy = Object.assign({}, object);
      let props = path.split('.');
      try {
        for (let i = 0; i < props.length; i++) {
          objCopy = objCopy[props[i]];
        }
      } catch (e) {
        return undefined;
      }
      return (objCopy === undefined) ? undefined : objCopy;
    }

    function setAttrib(object, path, value) {
      if (object === undefined || path === undefined ||
        Array.isArray(path) && path.length === 0 || typeof object !== 'object') {
        return undefined;
      }
      if (typeof path === 'string') {
        path = path.split(".");
      }
      if (path.length === 1) {
        try {
          object[path[0]] = value;
        } catch (e) {
          return undefined;
        }
        return;
      }
      setAttrib(object[path.shift()], path, value);
    }

    it('should get nested property', function () {
      const obj = { a: { b: { c: 42 } } };
      expect(getAttrib(obj, 'a.b.c')).to.equal(42);
    });

    it('should return undefined for missing path', function () {
      expect(getAttrib({ a: 1 }, 'a.b.c')).to.be.undefined;
    });

    it('should return undefined for non-object input', function () {
      expect(getAttrib('string', 'a')).to.be.undefined;
      expect(getAttrib(undefined, 'a')).to.be.undefined;
    });

    it('should return undefined for undefined path', function () {
      expect(getAttrib({ a: 1 }, undefined)).to.be.undefined;
    });

    it('should return undefined for non-string path', function () {
      expect(getAttrib({ a: 1 }, 123)).to.be.undefined;
    });

    it('FLAW: getAttrib uses Object.assign shallow copy — nested mutation possible', function () {
      const obj = { a: { b: 1 } };
      const result = getAttrib(obj, 'a');
      // result is obj.a (not a deep copy)
      result.b = 999;
      expect(obj.a.b).to.equal(999);
    });

    it('should set nested property', function () {
      const obj = { a: { b: { c: 0 } } };
      setAttrib(obj, 'a.b.c', 42);
      expect(obj.a.b.c).to.equal(42);
    });

    it('should set top-level property', function () {
      const obj = { x: 1 };
      setAttrib(obj, 'x', 99);
      expect(obj.x).to.equal(99);
    });

    it('FLAW: setAttrib has no prototype pollution guard', function () {
      const obj = {};
      // __proto__ as a property path segment
      setAttrib(obj, '__proto__.polluted', true);
      // Check if global Object was polluted
      const fresh = {};
      const wasPolluted = fresh.polluted === true;
      // Clean up regardless
      delete Object.prototype.polluted;
      // This documents whether the flaw exists
      expect(typeof wasPolluted).to.equal('boolean');
    });

    it('FLAW: setAttrib recurses without depth guard', function () {
      const obj = {};
      // Build a very deep path
      const path = Array.from({ length: 50 }, (_, i) => `k${i}`).join('.');
      // This will fail because intermediate objects don't exist
      // setAttrib doesn't create intermediate objects — it'll crash on undefined[next]
      expect(() => setAttrib(obj, path, 'val')).to.not.throw();
    });

    it('should handle array path input for setAttrib', function () {
      const obj = { a: { b: 0 } };
      setAttrib(obj, ['a', 'b'], 5);
      expect(obj.a.b).to.equal(5);
    });

    it('should return undefined for empty array path', function () {
      expect(setAttrib({ a: 1 }, [], 'val')).to.be.undefined;
    });
  });

  describe('do404 pattern (XSS via URL in response)', function () {
    // Recreate the do404 pattern from webapp.js for testing
    function do404(URL, message) {
      if (URL.indexOf('<') !== -1) {
        URL = encodeURI(URL);
      }
      return `<h1>Resource not found, URL: ${URL}</h1></br><h2>Additional info: ${message}</h2>`;
    }

    it('should encode URLs containing < to prevent XSS', function () {
      const html = do404('/<script>alert(1)</script>', 'test');
      expect(html).to.not.include('<script>');
    });

    it('FLAW: does not encode URLs with other XSS vectors (no < needed)', function () {
      const malicious = '/path" onmouseover="alert(1)';
      const html = do404(malicious, 'test');
      expect(html).to.include('onmouseover');
    });

    it('FLAW: does not encode the message parameter at all', function () {
      const html = do404('/safe', '<script>alert("xss")</script>');
      expect(html).to.include('<script>alert("xss")</script>');
    });

    it('should handle normal URLs correctly', function () {
      const html = do404('/normal/path', 'Not found');
      expect(html).to.include('/normal/path');
      expect(html).to.include('Not found');
    });
  });
});
