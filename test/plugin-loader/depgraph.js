const assert = require('assert')
const Depgraph = require('depgraph')
const depTestData = require('./depgraph-test-data')
const pd = "..\..\..\\zlux-example-server\\deploy\\product"
  
describe('degpraph', function() {
  it('should correctly install plugins with valid deps', function() {
    const dg = new Depgraph(depTestData.goodCase);
    const p = dg.processImports();
    assert.equal(p.plugins.length, 4) 
    assert.equal(p.rejects.length, 0) 
  });
  
  it('should reject all dependents of an invalid plugin', function() {
    const dg = new Depgraph(depTestData.brokenProvider);
    const p = dg.processImports();
    assert.equal(p.plugins.length, 1) 
    assert.equal(p.rejects.length, 3) 
  });
  
  it('should detect a version mismtach', function() {
    const dg = new Depgraph(depTestData.versionMismatch);
    const p = dg.processImports();
    assert.equal(p.plugins.length, 2) 
    assert.equal(p.rejects.length, 2) 
  });
  
  it('should fail on a circular dependency', function() {
    assert.throws(() => {
      const dg = new Depgraph(depTestData.cycle);
      const p = dg.processImports();
    }); 
  });
});
