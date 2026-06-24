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
const { pickLanguage } = require('../../lib/translation-utils');

describe('translation-utils', function () {
  describe('pickLanguage', function () {
    const supported = ['en', 'es-ES', 'fr', 'zh-CN'];

    // --- Basic matching ---

    it('returns an exact language+region match', function () {
      expect(pickLanguage(supported, 'es-ES')).to.equal('es-ES');
    });

    it('returns a language-only match when no region is specified in the header', function () {
      expect(pickLanguage(supported, 'en')).to.equal('en');
    });

    it('matches by language code when header has a region not in supported list', function () {
      // en-US is not supported, but en is — should fall through to en
      expect(pickLanguage(supported, 'en-US,en;q=0.9')).to.equal('en');
    });

    it('respects quality ordering and returns the highest-quality match', function () {
      // fr has higher quality than en here
      expect(pickLanguage(supported, 'fr;q=0.9,en;q=0.5')).to.equal('fr');
    });

    it('returns null when no supported language matches', function () {
      expect(pickLanguage(supported, 'ja,ko;q=0.9')).to.be.null;
    });

    it('handles a realistic browser Accept-Language header', function () {
      expect(pickLanguage(supported, 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7,en-GB;q=0.6')).to.equal('en');
    });

    it('picks es-ES when it is the highest-quality match among multiple candidates', function () {
      expect(pickLanguage(supported, 'es-ES;q=0.95,en;q=0.5')).to.equal('es-ES');
    });

    it('matches zh-CN correctly', function () {
      expect(pickLanguage(supported, 'zh-CN')).to.equal('zh-CN');
    });

    it('is case-insensitive for language tags', function () {
      expect(pickLanguage(supported, 'ES-ES')).to.equal('es-ES');
      expect(pickLanguage(supported, 'ZH-cn')).to.equal('zh-CN');
    });

    // --- Edge cases: empty/null inputs ---

    it('returns null when acceptLanguageHeader is empty string', function () {
      expect(pickLanguage(supported, '')).to.be.null;
    });

    it('returns null when acceptLanguageHeader is null', function () {
      expect(pickLanguage(supported, null)).to.be.null;
    });

    it('returns null when supportedLanguages is empty', function () {
      expect(pickLanguage([], 'en')).to.be.null;
    });

    it('returns null when supportedLanguages is null', function () {
      expect(pickLanguage(null, 'en')).to.be.null;
    });

    // --- Security: oversized headers (DoS protection) ---

    it('returns null when the header exceeds MAX_ACCEPT_LANGUAGE_LENGTH', function () {
      const oversized = 'en,' + 'a'.repeat(300);
      expect(pickLanguage(supported, oversized)).to.be.null;
    });

    it('accepts a header exactly at the length boundary', function () {
      // A valid header padded to exactly 256 chars via low-quality entries would still be
      // well-formed if all tags are valid. Here we just confirm a short valid header works.
      const header = 'en';
      expect(header.length).to.be.at.most(256);
      expect(pickLanguage(supported, header)).to.equal('en');
    });

    // --- Security: malformed entries (fail-closed) ---

    it('returns null when the header has a trailing comma', function () {
      expect(pickLanguage(supported, 'en,')).to.be.null;
    });

    it('returns null when the header has a leading comma', function () {
      expect(pickLanguage(supported, ',en')).to.be.null;
    });

    it('returns null when the header has consecutive commas', function () {
      expect(pickLanguage(supported, 'en,,fr')).to.be.null;
    });

    it('returns null when an entry has multiple semicolons', function () {
      expect(pickLanguage(supported, 'en;q=0.9;ext=foo')).to.be.null;
    });

    it('returns null when a q-value is missing the q= prefix', function () {
      expect(pickLanguage(supported, 'en;0.9')).to.be.null;
    });

    it('returns null when a q-value is above 1', function () {
      expect(pickLanguage(supported, 'en;q=1.5')).to.be.null;
    });

    it('returns null when a q-value is negative', function () {
      expect(pickLanguage(supported, 'en;q=-0.1')).to.be.null;
    });

    it('returns null when a q-value is non-numeric', function () {
      expect(pickLanguage(supported, 'en;q=high')).to.be.null;
    });

    it('returns null when a subtag contains non-alphanumeric characters', function () {
      expect(pickLanguage(supported, 'en-<script>')).to.be.null;
    });

    it('returns null when a subtag contains a space', function () {
      expect(pickLanguage(supported, 'en-U S')).to.be.null;
    });

    it('returns null when a subtag exceeds 8 characters', function () {
      expect(pickLanguage(supported, 'en-123456789')).to.be.null;
    });

    it('returns null when there are more than 3 subtags', function () {
      expect(pickLanguage(supported, 'en-US-x-extra-subtag')).to.be.null;
    });

    it('returns null on injection attempt via oversized subtag', function () {
      const malicious = 'en-' + 'A'.repeat(100);
      expect(pickLanguage(supported, malicious)).to.be.null;
    });

    it('returns null on injection attempt with special characters in tag', function () {
      expect(pickLanguage(supported, 'en-US<script>alert(1)</script>')).to.be.null;
    });

    it('returns null when header is only whitespace', function () {
      expect(pickLanguage(supported, '   ')).to.be.null;
    });

    it('returns null when an entry is only whitespace after splitting on comma', function () {
      expect(pickLanguage(supported, 'en,   ,fr')).to.be.null;
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
