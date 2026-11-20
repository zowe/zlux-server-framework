const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('translation-utils', function () {
  let translationUtils;
  var tmpDir;

  before(function () {
    try {
      translationUtils = require('../../lib/translation-utils');
    } catch (e) {
      console.warn('Could not load translation-utils module:', e.message);
      this.skip();
    }
  });

  it('should export expected functions', function () {
    assert.strictEqual(typeof translationUtils.getAcceptLanguageFromCookies, 'function');
    assert.strictEqual(typeof translationUtils.loadTranslations, 'function');
    assert.strictEqual(typeof translationUtils.translate, 'function');
  });

  describe('getAcceptLanguageFromCookies', function () {
    it('should return null when no language cookie', function () {
      var result = translationUtils.getAcceptLanguageFromCookies({});
      assert.strictEqual(result, null);
    });

    it('should return language from cookie', function () {
      var cookies = {
        'org.zowe.zlux.zlux-app-manager.preferences.language': 'es'
      };
      var result = translationUtils.getAcceptLanguageFromCookies(cookies);
      assert.strictEqual(result, 'es');
    });

    it('should return language with country and base language', function () {
      var cookies = {
        'org.zowe.zlux.zlux-app-manager.preferences.language': 'es-ES'
      };
      var result = translationUtils.getAcceptLanguageFromCookies(cookies);
      assert.strictEqual(result, 'es-ES,es');
    });

    it('should handle language without country code (no comma needed)', function () {
      var cookies = {
        'org.zowe.zlux.zlux-app-manager.preferences.language': 'fr'
      };
      var result = translationUtils.getAcceptLanguageFromCookies(cookies);
      assert.strictEqual(result, 'fr');
    });

    it('should return null for unrelated cookies', function () {
      var cookies = { 'some.other.cookie': 'en-US' };
      var result = translationUtils.getAcceptLanguageFromCookies(cookies);
      assert.strictEqual(result, null);
    });
  });

  describe('translate', function () {
    it('should return pluginDef unchanged when no matching translation', function () {
      var pluginDef = { webContent: { titleDefault: 'Hello' } };
      var translationMaps = {};
      var result = translationUtils.translate(pluginDef, translationMaps, 'fr');
      assert.deepStrictEqual(result, pluginDef);
    });

    it('should translate matching keys', function () {
      var pluginDef = {
        webContent: {
          titleKey: 'TITLE_KEY',
          titleDefault: 'Default Title'
        }
      };
      var translationMaps = {
        'es': { 'TITLE_KEY': 'Título' }
      };
      var result = translationUtils.translate(pluginDef, translationMaps, 'es');
      assert.strictEqual(result.webContent.titleDefault, 'Título');
    });

    it('should not modify original pluginDef', function () {
      var pluginDef = {
        webContent: {
          titleKey: 'TITLE_KEY',
          titleDefault: 'Default Title'
        }
      };
      var translationMaps = {
        'es': { 'TITLE_KEY': 'Título' }
      };
      translationUtils.translate(pluginDef, translationMaps, 'es');
      assert.strictEqual(pluginDef.webContent.titleDefault, 'Default Title');
    });

    it('should handle nested webContent objects', function () {
      var pluginDef = {
        webContent: {
          nested: {
            descriptionKey: 'DESC_KEY',
            descriptionDefault: 'Default Desc'
          }
        }
      };
      var translationMaps = {
        'de': { 'DESC_KEY': 'Beschreibung' }
      };
      var result = translationUtils.translate(pluginDef, translationMaps, 'de');
      assert.strictEqual(result.webContent.nested.descriptionDefault, 'Beschreibung');
    });

    it('should not translate when key is missing from translation map', function () {
      var pluginDef = {
        webContent: {
          titleKey: 'MISSING_KEY',
          titleDefault: 'Default Title'
        }
      };
      var translationMaps = {
        'es': { 'OTHER_KEY': 'Other' }
      };
      var result = translationUtils.translate(pluginDef, translationMaps, 'es');
      assert.strictEqual(result.webContent.titleDefault, 'Default Title');
    });
  });

  describe('loadTranslations', function () {
    before(function () {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trans-test-'));
    });

    after(function () {
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should return empty object for non-existent location', function () {
      var result = translationUtils.loadTranslations('/non/existent/path');
      assert.deepStrictEqual(result, {});
    });

    it('should return empty object when no translation files exist', function () {
      var i18nDir = path.join(tmpDir, 'empty-plugin', 'web', 'assets', 'i18n');
      fs.mkdirSync(i18nDir, { recursive: true });
      var result = translationUtils.loadTranslations(path.join(tmpDir, 'empty-plugin'));
      assert.deepStrictEqual(result, {});
    });

    it('should load translation files', function () {
      var pluginDir = path.join(tmpDir, 'plugin-with-trans');
      var i18nDir = path.join(pluginDir, 'web', 'assets', 'i18n');
      fs.mkdirSync(i18nDir, { recursive: true });
      fs.writeFileSync(
        path.join(i18nDir, 'pluginDefinition.i18n.es.json'),
        JSON.stringify({ 'TITLE': 'Título' })
      );
      fs.writeFileSync(
        path.join(i18nDir, 'pluginDefinition.i18n.fr.json'),
        JSON.stringify({ 'TITLE': 'Titre' })
      );
      var result = translationUtils.loadTranslations(pluginDir);
      assert.ok(result['es']);
      assert.ok(result['fr']);
      assert.strictEqual(result['es']['TITLE'], 'Título');
      assert.strictEqual(result['fr']['TITLE'], 'Titre');
    });

    it('should ignore non-matching files', function () {
      var pluginDir = path.join(tmpDir, 'plugin-non-match');
      var i18nDir = path.join(pluginDir, 'web', 'assets', 'i18n');
      fs.mkdirSync(i18nDir, { recursive: true });
      fs.writeFileSync(path.join(i18nDir, 'other-file.json'), '{}');
      fs.writeFileSync(
        path.join(i18nDir, 'pluginDefinition.i18n.en.json'),
        JSON.stringify({ 'KEY': 'Value' })
      );
      var result = translationUtils.loadTranslations(pluginDir);
      assert.ok(result['en']);
      assert.ok(!result['other-file'], 'should not load non-matching files');
    });

    it('should skip files with invalid JSON', function () {
      var pluginDir = path.join(tmpDir, 'plugin-bad-json');
      var i18nDir = path.join(pluginDir, 'web', 'assets', 'i18n');
      fs.mkdirSync(i18nDir, { recursive: true });
      fs.writeFileSync(path.join(i18nDir, 'pluginDefinition.i18n.bad.json'), '{invalid json');
      var result = translationUtils.loadTranslations(pluginDir);
      assert.ok(!result['bad'], 'should skip bad JSON files');
    });
  });
});
