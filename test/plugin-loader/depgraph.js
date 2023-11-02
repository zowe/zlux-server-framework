/*
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 */

import { strict as assert } from 'assert';
import Depgraph from '../../lib/depgraph';
import type { depTestData } from './depgraph-test-data';
//const pd = "..\..\..\\zlux-app-server\\deploy\\product"
  
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
      dg.processImports();
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
