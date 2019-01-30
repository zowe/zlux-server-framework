
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
const assert = require('assert')
const zluxUtil = require('../../lib/util.js')
const pd = "..\..\..\\zlux-app-server\\deploy\\product"
  
global.COM_RS_COMMON_LOGGER.setLogLevelForComponentPattern("_zsf.network", 5);

describe('uniqueIps', function() {
  
  it('should corectly handle no addresses', function() {
    return zluxUtil.uniqueIps().then(ips => {
      assert.deepEqual(ips, [ '0.0.0.0' ])
    });
  });
  
  it('should support IPv6', function() {
    return zluxUtil.uniqueIps([ '::' ]).then(ips => {
      assert.deepEqual(ips, [ '::' ])
    });
  });
  
  it('should corectly handle 127.0.0.1', function() {
    return zluxUtil.uniqueIps([ '127.0.0.1' ]).then(ips => {
      assert.deepEqual(ips, [ '127.0.0.1' ])
    });
  });
  
  it('should resolve hostnames', function() {
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
  
// ipaddr.js fails this
//  it('can even handle oddly formatted addresses', function() {
//    return zluxUtil.uniqueIps([ '127.000.000.001' ]).then(ips => {
//      assert.deepEqual(ips, [ '127.0.0.1' ])
//    });
//  });
  
});

describe('getLoopbackAddress', function() {
  
  it('should return 127.0.0.1 for the empty address', function() {
    assert.equal(zluxUtil.getLoopbackAddress(), '127.0.0.1');
  });
  
  it('should return 127.0.0.1 for 0.0.0.0', function() {
    assert.equal(zluxUtil.getLoopbackAddress([ '0.0.0.0' ]), '127.0.0.1');
  });
  
  it('should return 127.0.0.1 if the input contains 0.0.0.0', function() {
    assert.equal(zluxUtil.getLoopbackAddress([ '1.1.1.1', '0.0.0.0' ]), '127.0.0.1');
  });
  
  it('should return 127.0.0.1 for 127.0.0.1', function() {
    assert.equal(zluxUtil.getLoopbackAddress([ '127.0.0.1' ]), '127.0.0.1');
  });
  
  it('should return the first address when the input doesn\'t have a loopback address',
    function() {
      assert.equal(zluxUtil.getLoopbackAddress([ '1.1.1.1' ]), '1.1.1.1');
    });
  
  it('should support IPv6', function() {
    assert.equal(zluxUtil.getLoopbackAddress([ '::1' ]), '::1');
    assert.equal(zluxUtil.getLoopbackAddress([ '1.1.1.1', '::1'  ]), '::1');
  });
  
  it('should correctly preserve a non-default loopback address', function() {
    assert.equal(zluxUtil.getLoopbackAddress([ '127.0.0.2' ]), '127.0.0.2');
  });
    
});

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
