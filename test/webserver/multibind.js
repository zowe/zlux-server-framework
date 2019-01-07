const assert = require('assert')
const zluxUtil = require('../../js/util.js')
const pd = "..\..\..\\zlux-example-server\\deploy\\product"
  
describe('uniqueIps', function() {
  
  it('should corectly handle no addresses', function() {
    return zluxUtil.uniqueIps().then(ips => {
      assert.deepEqual(ips, [ '0.0.0.0' ])
    });
  });
  
  it('should corectly handle 127.0.0.1', function() {
    return zluxUtil.uniqueIps([ '127.0.0.1' ]).then(ips => {
      assert.deepEqual(ips, [ '127.0.0.1' ])
    });
  });
  
  it('should corectly handle localhost', function() {
    return zluxUtil.uniqueIps([ 'localhost' ]).then(ips => {
      assert.deepEqual(ips, [ '127.0.0.1' ])
    });
  });
  
  it('should preserve multiple addresses ', function() {
    return zluxUtil.uniqueIps([ '127.0.0.1', '127.0.0.2', '127.0.0.3' ]).then(ips => {
      assert.deepEqual(ips, [ '127.0.0.1', '127.0.0.2', '127.0.0.3' ])
    });
  });
  
  it('should filter out repeating addresses', function() {
    return zluxUtil.uniqueIps([ '127.0.0.1', '127.0.0.1', '127.0.0.2' ]).then(ips => {
      assert.deepEqual(ips, [ '127.0.0.1', '127.0.0.2' ])
    });
  });
  
  it('should filter out synonymous addresses', function() {
    return zluxUtil.uniqueIps([ '127.0.0.1', 'localhost', '127.0.0.2' ]).then(ips => {
      assert.deepEqual(ips, [ '127.0.0.1', '127.0.0.2' ])
    });
  });
  
});

describe('getLoopbackAddress', function() {
  
  it('should return 127.0.0.1 for the empty address', function() {
    assert.equal(zluxUtil.getLoopbackAddress(), '127.0.0.1');
  });
  
  it('should return 127.0.0.1 for 0.0.0.0', function() {
    assert.equal(zluxUtil.getLoopbackAddress([ '0.0.0.0' ]), '127.0.0.1');
  });
  
  it('should return 127.0.0.1 for 127.0.0.1', function() {
    assert.equal(zluxUtil.getLoopbackAddress([ '127.0.0.1' ]), '127.0.0.1');
  });
  
  it('should return the first address when the input doesn\'t have a loopback address', function() {
    assert.equal(zluxUtil.getLoopbackAddress([ '1.1.1.1' ]), '1.1.1.1');
  });
    
});
