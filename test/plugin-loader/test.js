const assert = require('assert')
const Pl = require('plugin-loader')
const depTestData = require('./depgraph-test-data')
const pd = "..\..\..\\zlux-example-server\\deploy\\product"
  
describe('PluginLoader', function() {
  let pl;
  
  beforeEach(function () {
    pl = new Pl({serverConfig: {productDir: pd}})
  });
  
  describe('#installPlugins()', function() {
    it('should correctly install plugins with valid deps', function() {
      pl.installPlugins(depTestData.goodCase);
      assert.equal(pl.plugins.length, 4) 
    });
    
    it('should reject all dependents of an invalid plugin', function() {
      pl.installPlugins(depTestData.brokenProvider);
      assert.equal(pl.plugins.length, 1) 
    });
    
    it('should detect a version mismtach', function() {
      pl.installPlugins(depTestData.versionMismatch);
      assert.equal(pl.plugins.length, 2) 
    });
    
    it('should fail on a circular dependency', function() {
      assert.throws(() => { pl.installPlugins(depTestData.cycle) }); 
    });
  });
});