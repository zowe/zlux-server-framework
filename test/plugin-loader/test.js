const assert = require('assert')
const Pl = require('plugin-loader')
const data = require('./depgraph-test-data')
const pd = "..\..\..\\zlux-example-server\\deploy\\product"
  
function test(_case, pnum) {
  console.log(' ***')
  const pl = new Pl({serverConfig: {productDir: pd}})
  try {
    pl.installPlugins(_case);
  } catch (e) {
    console.log("caught exception ", e)
  }
  console.log(' *** installed plugins: ', pl.plugins);
  console.log(' ***\n\n')
  assert((pnum === 0) || pl.plugins.length == pnum)
} 

test(data.goodCase, 4)
test(data.brokenProvider, 1)
test(data.versionMismatch, 2)
test(data.cycle, 0)
console.log('*** ok')