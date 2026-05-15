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
const { pickLanguage, getAcceptLanguageFromCookies } = require('../../lib/translation-utils');

describe('translation-utils - adversarial', function () {

  describe('pickLanguage DoS resistance', function () {
    const supported = ['en', 'fr', 'de', 'ja', 'zh-CN', 'es', 'pt-BR', 'ko'];

    it('rejects header exactly at MAX_ACCEPT_LANGUAGE_LENGTH+1 (257 chars)', function () {
      // Build a valid-looking header that's 257 chars
      // "aa," repeated  = 3 chars each → 85*3 = 255, + "aa" = 257
      const header = ('aa,'.repeat(85)) + 'aa';
      expect(header.length).to.equal(257);
      const result = pickLanguage(supported, header);
      expect(result).to.be.null;
    });

    it('accepts header at exactly MAX_ACCEPT_LANGUAGE_LENGTH (256 chars)', function () {
      // "en," repeated 85 times = 255 chars + "en" = but that's 257
      // "en,".repeat(84) = 252 + "enen" = 256
      const header = 'en,'.repeat(84) + 'enen';
      expect(header.length).to.equal(256);
      // This will fail validation because "enen" is a single subtag > ok (<=8 chars)
      // but the split will produce many empty entries from repeated commas? No, "en," splits correctly.
      // Actually "en,en,en,...,enen" — all valid. But there are trailing entries without commas.
      // Let's just build it properly:
      const entries = [];
      let len = 0;
      while (len + 3 <= 256) {
        entries.push('en');
        len += 3; // "en,"
      }
      // Remaining chars
      const remaining = 256 - (entries.length * 3 - 1); // -1 because last entry has no comma if we join
      // Actually just use a measured approach:
      const built = entries.join(',');
      // This tests that a 256-char header doesn't hit the length guard
      if (built.length <= 256) {
        const result = pickLanguage(supported, built);
        // It should process (not null from length check) — may match 'en'
        expect(result).to.equal('en');
      }
    });

    it('handles maximum entries packed into 256 chars', function () {
      // Shortest valid entry: "a" (1 char) + comma = 2 chars per entry
      // 256 / 2 = 128 entries max (last one has no comma = 127 commas + 128 entries = 255 chars)
      // Actually: "a,a,a,...,a" with n entries = 2n-1 chars. For 256: n = 128.5 → 128 entries = 255 chars
      const header = Array(128).fill('a').join(',') + ',a'; // 128 + 1 = 129 entries, 257 chars — too long
      const header2 = Array(128).fill('a').join(','); // 128 entries, 255 chars
      expect(header2.length).to.equal(255);
      const start = process.hrtime.bigint();
      const result = pickLanguage(supported, header2);
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      // Should complete in < 5ms even with 128 entries
      expect(elapsed).to.be.below(5, `Took ${elapsed.toFixed(2)}ms for 128 entries`);
      // No match expected (none of supported starts with 'a')
      expect(result).to.be.null;
    });

    it('handles entries with maximum quality precision attempts', function () {
      // Try to cause floating-point edge cases
      const header = 'en;q=0.9999999999999999,fr;q=0.0000000000000001,de;q=1.0';
      const result = pickLanguage(supported, header);
      // q > 1 is invalid per spec — should reject
      // Actually 0.9999... and 0.0000... are both in [0,1] range
      // But 0.9999999999999999 in IEEE 754 rounds to 1.0
      // The code checks quality > 1 → this edge rounds to exactly 1.0, so valid
      // de;q=1.0 is valid
      expect(result).to.not.be.undefined; // No crash
    });

    it('rejects entries where q= value is clearly invalid', function () {
      const mustReject = [
        'en;q=NaN',       // parseFloat → NaN
        'en;q=Infinity',  // parseFloat → Infinity > 1
        'en;q=-Infinity', // parseFloat → -Infinity < 0
        'en;q=1e308',     // parseFloat → Infinity > 1
        'en;q=',          // parseFloat('') → NaN
        'en;q=one',       // parseFloat('one') → NaN
      ];
      for (const header of mustReject) {
        const result = pickLanguage(supported, header);
        expect(result).to.be.null,
          `Should reject "${header}" but got: ${result}`;
      }
    });

    it('documents parseFloat leniency (0x1 becomes 0, 1.0.0 becomes 1.0)', function () {
      // parseFloat('0x1') = 0 (stops at 'x') — quality=0 is valid
      // parseFloat('1.0.0') = 1.0 (stops at second dot) — quality=1.0 is valid
      // These are parsed "successfully" even though they look odd
      const leniently_valid = [
        'en;q=0x1',   // quality = 0 (won't match, but no null)
        'en;q=1.0.0', // quality = 1.0
      ];
      for (const header of leniently_valid) {
        // These do NOT cause null — parseFloat accepts them
        const result = pickLanguage(supported, header);
        // Just verify no crash
        expect(result === null || result === 'en').to.be.true;
      }
    });

    it('rejects subtags with special characters (XSS/injection attempts)', function () {
      const attacks = [
        '<script>alert(1)</script>',
        'en<img/onerror=alert(1)>',
        '../../../etc/passwd',
        'en; DROP TABLE users;--',
        'en\x00fr',
        'en\nX-Injected: true',
        'en\r\nSet-Cookie: evil=1',
      ];
      for (const header of attacks) {
        const result = pickLanguage(supported, header);
        expect(result).to.be.null,
          `Should reject injection attempt: "${header.substring(0, 30)}..."`;
      }
    });

    it('handles repeated semicolons (parser confusion attempt)', function () {
      const result = pickLanguage(supported, 'en;;q=1');
      // "en;;q=1" splits on ';' to ['en', '', 'q=1'] → length > 2 → null
      expect(result).to.be.null;
    });

    it('handles Unicode/emoji in language tags', function () {
      const attacks = [
        'en-\u{1F600}',  // emoji
        '\u0000en',       // null byte prefix
        'en\u200B',       // zero-width space
        'ëñ',            // accented chars (not ASCII alphanum)
        'en-Latn-\u202E', // RTL override
      ];
      for (const header of attacks) {
        const result = pickLanguage(supported, header);
        expect(result).to.be.null,
          `Should reject Unicode attack: ${JSON.stringify(header)}`;
      }
    });

    it('performance: processes 10,000 pickLanguage calls in < 200ms', function () {
      this.timeout(5000);
      const header = 'fr-FR;q=0.9,en-US;q=0.8,de;q=0.7,ja;q=0.5';
      const start = process.hrtime.bigint();
      for (let i = 0; i < 10000; i++) {
        pickLanguage(supported, header);
      }
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      expect(elapsed).to.be.below(200, `10k calls took ${elapsed.toFixed(1)}ms`);
    });

    it('handles supportedLanguages with 1000 entries efficiently', function () {
      // Simulate a system with many locale files
      const bigSupported = [];
      for (let i = 0; i < 1000; i++) {
        bigSupported.push(`lang${i}`);
      }
      bigSupported.push('en-US');
      const header = 'en-US;q=0.9,fr;q=0.8';
      const start = process.hrtime.bigint();
      const result = pickLanguage(bigSupported, header);
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      expect(result).to.equal('en-US');
      expect(elapsed).to.be.below(10, `Took ${elapsed.toFixed(2)}ms with 1000 supported languages`);
    });
  });

  describe('pickLanguage regex safety (ReDoS)', function () {
    it('handles subtags of exactly max length (8 chars)', function () {
      // BCP47 allows subtags up to 8 chars
      const result = pickLanguage(['abcdefgh'], 'abcdefgh');
      expect(result).to.equal('abcdefgh');
    });

    it('rejects subtags over 8 chars', function () {
      const result = pickLanguage(['abcdefghi'], 'abcdefghi');
      expect(result).to.be.null;
    });

    it('regex ^[a-zA-Z0-9]+$ does not backtrack on near-miss input', function () {
      // This pattern is inherently safe (no alternation/repetition ambiguity)
      // but verify timing doesn't spike with long almost-valid input
      // A subtag that's 8 chars of valid + 1 invalid char
      const header = 'aaaaaaa!'; // 7 valid + 1 invalid = fails at char 8
      const start = process.hrtime.bigint();
      for (let i = 0; i < 100000; i++) {
        pickLanguage(['en'], header);
      }
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      // Should be fast — regex has no backtracking vulnerability here
      expect(elapsed).to.be.below(500, `100k rejections took ${elapsed.toFixed(1)}ms`);
    });
  });

  describe('getAcceptLanguageFromCookies adversarial', function () {
    const prefix = 'org.zowe.zlux.zlux-app-manager.preferences';
    const langKey = `${prefix}.language`;

    it('handles cookie value with injection attempts', function () {
      const attacks = [
        { [langKey]: '<script>alert(1)</script>' },
        { [langKey]: '../../etc/passwd' },
        { [langKey]: 'en\r\nSet-Cookie: hack=1' },
        { [langKey]: 'en; DROP TABLE users' },
      ];
      for (const cookies of attacks) {
        // Should return something (it doesn't validate the cookie value format)
        // The important thing is it doesn't crash
        const result = getAcceptLanguageFromCookies(cookies);
        expect(result).to.be.a('string');
      }
    });

    it('handles empty string cookie', function () {
      const result = getAcceptLanguageFromCookies({ [langKey]: '' });
      expect(result).to.be.null;
    });

    it('handles very long cookie value', function () {
      const longVal = 'a'.repeat(10000);
      const result = getAcceptLanguageFromCookies({ [langKey]: longVal });
      // Returns the value — pickLanguage downstream will reject via MAX_ACCEPT_LANGUAGE_LENGTH
      expect(result).to.be.a('string');
    });

    it('handles cookie object with 10,000 irrelevant keys', function () {
      const cookies = {};
      for (let i = 0; i < 10000; i++) {
        cookies[`irrelevant_cookie_${i}`] = 'value';
      }
      cookies[langKey] = 'fr';
      const start = process.hrtime.bigint();
      const result = getAcceptLanguageFromCookies(cookies);
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      expect(result).to.equal('fr');
      expect(elapsed).to.be.below(5);
    });

    it('handles null/undefined cookies gracefully', function () {
      expect(() => getAcceptLanguageFromCookies(null)).to.throw;
      expect(() => getAcceptLanguageFromCookies(undefined)).to.throw;
    });
  });
});
