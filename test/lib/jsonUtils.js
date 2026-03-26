const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('jsonUtils', function () {
  let jsonUtils;
  var tmpDir;

  before(function () {
    try {
      jsonUtils = require('../../lib/jsonUtils');
    } catch (e) {
      console.warn('Could not load jsonUtils module:', e.message);
      this.skip();
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonutils-test-'));
  });

  after(function () {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should export expected functions', function () {
    assert.strictEqual(typeof jsonUtils.parseJSONWithComments, 'function');
    assert.strictEqual(typeof jsonUtils.readJSONFileWithComments, 'function');
    assert.strictEqual(typeof jsonUtils.readJSONFileWithCommentsAsync, 'function');
    assert.strictEqual(typeof jsonUtils.readJSONStringWithComments, 'function');
  });

  describe('readJSONStringWithComments', function () {
    it('should parse simple JSON string', function () {
      var json = '{"key": "value", "num": 42}';
      var result = jsonUtils.readJSONStringWithComments(json, 'test.json');
      assert.deepStrictEqual(result, { key: 'value', num: 42 });
    });

    it('should strip single-line comments', function () {
      var json = '{\n  "key": "value" // this is a comment\n}';
      var result = jsonUtils.readJSONStringWithComments(json, 'test.json');
      assert.deepStrictEqual(result, { key: 'value' });
    });

    it('should not strip // inside quoted strings', function () {
      var json = '{"url": "https://example.com"}';
      var result = jsonUtils.readJSONStringWithComments(json, 'test.json');
      assert.deepStrictEqual(result, { url: 'https://example.com' });
    });

    it('should handle multiple comment lines', function () {
      var json = '{\n// comment1\n  "a": 1,\n// comment2\n  "b": 2\n}';
      var result = jsonUtils.readJSONStringWithComments(json, 'test.json');
      assert.deepStrictEqual(result, { a: 1, b: 2 });
    });

    it('should handle JSON with no comments', function () {
      var json = '{"hello": "world"}';
      var result = jsonUtils.readJSONStringWithComments(json, 'test.json');
      assert.deepStrictEqual(result, { hello: 'world' });
    });

    it('should throw on invalid JSON', function () {
      assert.throws(function () {
        jsonUtils.readJSONStringWithComments('{invalid}', 'bad.json');
      });
    });

    it('should handle empty object', function () {
      var result = jsonUtils.readJSONStringWithComments('{}', 'test.json');
      assert.deepStrictEqual(result, {});
    });

    it('should handle arrays', function () {
      var result = jsonUtils.readJSONStringWithComments('[1, 2, 3]', 'test.json');
      assert.deepStrictEqual(result, [1, 2, 3]);
    });

    it('should handle nested objects with comments', function () {
      var json = '{\n  "outer": {\n    "inner": "val" // nested comment\n  }\n}';
      var result = jsonUtils.readJSONStringWithComments(json, 'test.json');
      assert.deepStrictEqual(result, { outer: { inner: 'val' } });
    });

    it('should handle strings containing escaped quotes', function () {
      var json = '{"key": "say \\"hello\\""}';
      var result = jsonUtils.readJSONStringWithComments(json, 'test.json');
      assert.deepStrictEqual(result, { key: 'say "hello"' });
    });
  });

  describe('readJSONFileWithComments', function () {
    it('should read and parse a JSON file', function () {
      var filePath = path.join(tmpDir, 'test1.json');
      fs.writeFileSync(filePath, '{"name": "test"}');
      var result = jsonUtils.readJSONFileWithComments(filePath);
      assert.deepStrictEqual(result, { name: 'test' });
    });

    it('should read a JSON file with comments', function () {
      var filePath = path.join(tmpDir, 'test2.json');
      fs.writeFileSync(filePath, '{\n  "name": "test" // comment\n}');
      var result = jsonUtils.readJSONFileWithComments(filePath);
      assert.deepStrictEqual(result, { name: 'test' });
    });

    it('should throw on non-existent file', function () {
      assert.throws(function () {
        jsonUtils.readJSONFileWithComments('/non/existent/file.json');
      });
    });
  });

  describe('readJSONFileWithCommentsAsync', function () {
    it('should read and parse a JSON file asynchronously', function (done) {
      var filePath = path.join(tmpDir, 'test3.json');
      fs.writeFileSync(filePath, '{"async": true}');
      jsonUtils.readJSONFileWithCommentsAsync(filePath).then(function (result) {
        assert.deepStrictEqual(result, { async: true });
        done();
      }).catch(done);
    });

    it('should read a JSON file with comments asynchronously', function (done) {
      var filePath = path.join(tmpDir, 'test4.json');
      fs.writeFileSync(filePath, '{\n  "async": true // async comment\n}');
      jsonUtils.readJSONFileWithCommentsAsync(filePath).then(function (result) {
        assert.deepStrictEqual(result, { async: true });
        done();
      }).catch(done);
    });

    it('should reject on non-existent file', function (done) {
      jsonUtils.readJSONFileWithCommentsAsync('/non/existent/file.json').then(function () {
        done(new Error('should have rejected'));
      }).catch(function (err) {
        assert.ok(err, 'should have error');
        done();
      });
    });
  });

  describe('parseJSONWithComments', function () {
    it('should work as alias for readJSONFileWithComments', function () {
      var filePath = path.join(tmpDir, 'test5.json');
      fs.writeFileSync(filePath, '{"alias": true}');
      var result = jsonUtils.parseJSONWithComments(filePath);
      assert.deepStrictEqual(result, { alias: true });
    });
  });
});
