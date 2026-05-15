/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';
const chai = require('chai');
const expect = chai.expect;
const url = require('../../lib/url');

describe('lib/url', function () {

  describe('makePluginURL', function () {
    it('returns a URL with the product code and plugin ID', function () {
      expect(url.makePluginURL('ZLUX', 'org.zowe.myplugin'))
        .to.equal('/ZLUX/plugins/org.zowe.myplugin');
    });

    it('handles empty product code', function () {
      expect(url.makePluginURL('', 'org.zowe.myplugin'))
        .to.equal('//plugins/org.zowe.myplugin');
    });

    it('handles empty plugin ID', function () {
      expect(url.makePluginURL('ZLUX', ''))
        .to.equal('/ZLUX/plugins/');
    });
  });

  describe('makeServiceSubURL', function () {
    it('returns versioned URL for a non-import service', function () {
      const service = { type: 'service', name: 'data', version: '1.0.0' };
      expect(url.makeServiceSubURL(service, false, false))
        .to.equal('/services/data/1.0.0');
    });

    it('uses localName for import-type services', function () {
      const service = { type: 'import', localName: 'myAlias', name: 'original', version: '2.0.0' };
      expect(url.makeServiceSubURL(service, false, false))
        .to.equal('/services/myAlias/2.0.0');
    });

    it('uses _current as version when latest is true', function () {
      const service = { type: 'service', name: 'data', version: '1.0.0' };
      expect(url.makeServiceSubURL(service, true, false))
        .to.equal('/services/data/_current');
    });

    it('omits version segment when omitVersion is true', function () {
      const service = { type: 'service', name: 'data', version: '1.0.0' };
      expect(url.makeServiceSubURL(service, false, true))
        .to.equal('/services/data');
    });

    it('appends path when provided', function () {
      const service = { type: 'service', name: 'data', version: '1.0.0' };
      expect(url.makeServiceSubURL(service, false, false, 'sub/resource'))
        .to.equal('/services/data/1.0.0/sub/resource');
    });

    it('does not append path when path is undefined', function () {
      const service = { type: 'service', name: 'data', version: '1.0.0' };
      expect(url.makeServiceSubURL(service, false, false, undefined))
        .to.equal('/services/data/1.0.0');
    });

    it('combines omitVersion and path correctly', function () {
      const service = { type: 'service', name: 'data', version: '1.0.0' };
      expect(url.makeServiceSubURL(service, false, true, 'foo'))
        .to.equal('/services/data/foo');
    });
  });

  describe('join', function () {
    it('concatenates baseUrl and relativePath', function () {
      expect(url.join('/base', '/path')).to.equal('/base/path');
    });

    it('handles empty relativePath', function () {
      expect(url.join('/base', '')).to.equal('/base');
    });

    it('handles empty baseUrl', function () {
      expect(url.join('', '/path')).to.equal('/path');
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
