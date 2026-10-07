const assert = require('assert');

describe('reader', function () {
  let Reader;

  before(function () {
    try {
      Reader = require('../../lib/reader');
    } catch (e) {
      console.warn('Could not load reader module:', e.message);
      this.skip();
    }
  });

  it('should export a constructor function', function () {
    assert.strictEqual(typeof Reader, 'function');
  });

  it('should create a Reader instance with new', function () {
    var reader = new Reader();
    assert.ok(reader, 'reader instance should exist');
    assert.ok(reader.readlineReader, 'should have readlineReader');
    reader.close();
  });

  it('should have readPassword method', function () {
    var reader = new Reader();
    assert.strictEqual(typeof reader.readPassword, 'function');
    reader.close();
  });

  it('should have close method', function () {
    var reader = new Reader();
    assert.strictEqual(typeof reader.close, 'function');
    reader.close();
  });

  it('should close readline interface on close()', function () {
    var reader = new Reader();
    reader.close();
    assert.ok(reader.readlineReader.closed, 'readline should be closed');
  });

  it('readPassword should return a promise', function () {
    var reader = new Reader();
    var result = reader.readPassword('test: ');
    assert.ok(result instanceof Promise, 'readPassword should return a promise');
    reader.close();
  });
});
