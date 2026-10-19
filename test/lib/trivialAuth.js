const assert = require('assert');

describe('trivial-auth plugin', function () {
  let factory;
  const pluginDef = { identifier: 'org.zowe.zlux.auth.trivial' };

  before(function () {
    try {
      factory = require('../../devPlugins/trivial-auth/lib/trivialAuth');
    } catch (e) {
      console.warn('Could not load trivial-auth module:', e.message);
      this.skip();
    }
  });

  describe('development', function () {
    async function assertRefused(serverConf) {
      await assert.rejects(factory(pluginDef, {}, serverConf), /node\.development/);
    }

    it('should refuse to load without any server configuration', async function () {
      await assertRefused(undefined);
    });

    it('should refuse to load when the node section is missing', async function () {
      await assertRefused({});
    });

    it('should refuse to load when the flag is not set', async function () {
      await assertRefused({ node: {} });
    });

    it('should refuse to load when the flag is false', async function () {
      await assertRefused({ node: { development: false } });
    });

    it('should refuse to load for values that are not boolean true', async function () {
      await assertRefused({ node: { development: 'true' } });
      await assertRefused({ node: { development: 1 } });
    });

    it('should load when the flag is true', async function () {
      const authenticator = await factory(pluginDef, {}, { node: { development: true } });
      assert.strictEqual(typeof authenticator.authenticate, 'function');
      assert.strictEqual(authenticator.authPluginID, pluginDef.identifier);
    });
  });

  describe('authenticator once enabled', function () {
    it('should still refuse a request without a username or token', async function () {
      const authenticator = await factory(pluginDef, {}, { node: { development: true } });
      const result = await authenticator.authenticate({ body: {}, cookies: {} }, {});
      assert.strictEqual(result.success, false);
    });
  });
});
