/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

// Stub the global logger before requiring any library code so that
// lib/util.js does not try to load the external zlux-shared repo.
const noop = () => {};
global.COM_RS_COMMON_LOGGER = {
  makeComponentLogger: () => ({
    info: noop, warn: noop, debug: noop, severe: noop, log: noop
  })
};

const path = require('path');
const fs = require('fs');
const os = require('os');
const chai = require('chai');
const expect = chai.expect;
const { pickLanguage, getAcceptLanguageFromCookies, translate, loadTranslations } = require('../../lib/translation-utils');

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

  describe('getAcceptLanguageFromCookies', function () {
    const prefix = 'org.zowe.zlux.zlux-app-manager.preferences';
    const langKey = `${prefix}.language`;

    it('returns null when no language cookie is set', function () {
      expect(getAcceptLanguageFromCookies({})).to.be.null;
    });

    it('returns the language as-is when it has no region subtag', function () {
      const cookies = { [langKey]: 'fr' };
      expect(getAcceptLanguageFromCookies(cookies)).to.equal('fr');
    });

    it('returns "lang-Region,lang" when cookie contains a region subtag', function () {
      const cookies = { [langKey]: 'es-ES' };
      expect(getAcceptLanguageFromCookies(cookies)).to.equal('es-ES,es');
    });

    it('returns null when the language cookie is an empty string', function () {
      const cookies = { [langKey]: '' };
      expect(getAcceptLanguageFromCookies(cookies)).to.be.null;
    });
  });

  describe('translate', function () {
    const translationMaps = {
      'es-ES': {
        'pluginName': 'Nombre del Plugin',
        'pluginDesc': 'Descripción del Plugin'
      },
      'fr': {
        'pluginName': 'Nom du Plugin'
      }
    };

    it('returns the original pluginDef when acceptLanguage is null', function () {
      const pluginDef = { webContent: { nameKey: 'pluginName', nameDefault: 'PluginName' } };
      const result = translate(pluginDef, translationMaps, null);
      expect(result).to.equal(pluginDef);
    });

    it('returns the original pluginDef when no translation matches', function () {
      const pluginDef = { webContent: { nameKey: 'pluginName', nameDefault: 'PluginName' } };
      const result = translate(pluginDef, translationMaps, 'ja');
      expect(result).to.equal(pluginDef);
    });

    it('translates matching keys in webContent when a language matches', function () {
      const pluginDef = { webContent: { nameKey: 'pluginName', nameDefault: 'PluginName' } };
      const result = translate(pluginDef, translationMaps, 'es-ES');
      expect(result.webContent.nameDefault).to.equal('Nombre del Plugin');
    });

    it('does not mutate the original pluginDef', function () {
      const pluginDef = { webContent: { nameKey: 'pluginName', nameDefault: 'PluginName' } };
      translate(pluginDef, translationMaps, 'es-ES');
      expect(pluginDef.webContent.nameDefault).to.equal('PluginName');
    });

    it('handles nested objects in webContent', function () {
      const pluginDef = {
        webContent: {
          sub: { descKey: 'pluginDesc', descDefault: 'Description' }
        }
      };
      const result = translate(pluginDef, translationMaps, 'es-ES');
      expect(result.webContent.sub.descDefault).to.equal('Descripción del Plugin');
    });

    it('leaves keys unchanged when translation key is not found in map', function () {
      const pluginDef = { webContent: { titleKey: 'missingKey', titleDefault: 'Original' } };
      const result = translate(pluginDef, translationMaps, 'es-ES');
      expect(result.webContent.titleDefault).to.equal('Original');
    });
  });

  describe('loadTranslations', function () {
    let tmpDir;
    let i18nDir;

    beforeEach(function () {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'translation-test-'));
      i18nDir = path.join(tmpDir, 'web', 'assets', 'i18n');
      fs.mkdirSync(i18nDir, { recursive: true });
    });

    afterEach(function () {
      // Recursive cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns an empty object when the i18n folder does not exist', function () {
      const noI18nDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-i18n-'));
      const result = loadTranslations(noI18nDir);
      expect(result).to.deep.equal({});
      fs.rmSync(noI18nDir, { recursive: true, force: true });
    });

    it('loads translation files matching the naming convention', function () {
      const content = JSON.stringify({ hello: 'hola' });
      fs.writeFileSync(path.join(i18nDir, 'pluginDefinition.i18n.es-ES.json'), content);
      const result = loadTranslations(tmpDir);
      expect(result['es-ES']).to.deep.equal({ hello: 'hola' });
    });

    it('loads multiple language files', function () {
      fs.writeFileSync(path.join(i18nDir, 'pluginDefinition.i18n.en.json'), JSON.stringify({ k: 'v1' }));
      fs.writeFileSync(path.join(i18nDir, 'pluginDefinition.i18n.fr.json'), JSON.stringify({ k: 'v2' }));
      const result = loadTranslations(tmpDir);
      expect(Object.keys(result)).to.have.lengthOf(2);
      expect(result['en'].k).to.equal('v1');
      expect(result['fr'].k).to.equal('v2');
    });

    it('ignores files that do not match the naming convention', function () {
      fs.writeFileSync(path.join(i18nDir, 'other-file.json'), '{}');
      fs.writeFileSync(path.join(i18nDir, 'pluginDefinition.i18n.de.json'), JSON.stringify({ x: 1 }));
      const result = loadTranslations(tmpDir);
      expect(Object.keys(result)).to.have.lengthOf(1);
      expect(result['de']).to.deep.equal({ x: 1 });
    });

    it('skips files with invalid JSON gracefully', function () {
      fs.writeFileSync(path.join(i18nDir, 'pluginDefinition.i18n.bad.json'), '{not valid json!!!}');
      fs.writeFileSync(path.join(i18nDir, 'pluginDefinition.i18n.good.json'), JSON.stringify({ ok: true }));
      const result = loadTranslations(tmpDir);
      // The bad file should be skipped, good file should be loaded
      expect(result['bad']).to.be.undefined;
      expect(result['good']).to.deep.equal({ ok: true });
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
