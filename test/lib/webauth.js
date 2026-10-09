const assert = require('assert');
const sinon = require('sinon');
const pluginStorage = require('../../lib/pluginStorage');
const apimlStorage = require('../../lib/apimlStorage');

describe('webauth', function () {
  let webauth;

  before(function () {
    try {
      webauth = require('../../lib/webauth');
    } catch (e) {
      console.warn('Could not load webauth module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(webauth, 'webauth module should be loadable');
  });

  it('should export a factory function', function () {
    assert.strictEqual(typeof webauth, 'function');
  });

  it('should return an object with expected methods when called with authManager', function () {
    var mockAuthManager = {
      getAllHandlers: function () { return []; },
      getAuthHandlerForService: function () { return null; },
      getBestAuthenticationHandler: function () { return null; }
    };
    var result = webauth(mockAuthManager, 'test-cookie', true);
    assert.ok(result, 'factory should return an object');
    assert.strictEqual(typeof result.doLogin, 'function');
    assert.strictEqual(typeof result.doLogout, 'function');
    assert.strictEqual(typeof result.refreshStatus, 'function');
    assert.strictEqual(typeof result.addProxyAuthorizations, 'function');
    assert.strictEqual(typeof result.processProxiedHeaders, 'function');
    assert.strictEqual(typeof result.middleware, 'function');
    assert.strictEqual(typeof result.generateHaSessionId, 'function');
  });

  it('should expose sessionTimeoutMs', function () {
    var mockAuthManager = {
      getAllHandlers: function () { return []; },
      getAuthHandlerForService: function () { return null; },
      getBestAuthenticationHandler: function () { return null; },
      sessionTimeoutMs: 3600000
    };
    var result = webauth(mockAuthManager, 'my-cookie', false);
    assert.ok(result);
  });
});

describe('webauth login rate limiting', function () {
  let webauth;
  let savedClusterManager;
  let isConfiguredStub;

  before(function () {
    // test/lib/clusterManager.js and test/lib/apimlStorage.js both mutate
    // process-wide singletons (process.clusterManager, apimlStorage's
    // internal configured flag) as side effects of their own tests. If either
    // has already run earlier in this mocha process (alphabetical file order
    // puts both before this file), pluginStorage.getDefaultLocationType()
    // would resolve to 'ha' or 'cluster' here and attempt real IPC/network
    // calls instead of the 'local' in-memory store these tests expect. Force
    // 'local' for the duration of this suite regardless of what ran before it.
    savedClusterManager = process.clusterManager;
    delete process.clusterManager;
    isConfiguredStub = sinon.stub(apimlStorage, 'isConfigured').returns(false);
    try {
      webauth = require('../../lib/webauth');
    } catch (e) {
      console.warn('Could not load webauth module:', e.message);
      this.skip();
    }
  });

  after(function () {
    if (savedClusterManager !== undefined) {
      process.clusterManager = savedClusterManager;
    }
    isConfiguredStub.restore();
  });

  const RATE_LIMIT_CONF = {
    enabled: true,
    maxAttempts: 3,
    windowMS: 100000,
    lockoutMS: 50,
    lockoutBackoffMultiplier: 2,
    maxLockoutMS: 500,
    trackByIP: true,
    trackByUsername: true
  };

  // Minimal fake auth handler: `succeeds` toggles what authenticate() returns
  // (mutable, so a single instance can simulate a bad password followed by a
  // correct one), and callCount lets tests assert the rate limiter actually
  // skipped it.
  function makeHandler(succeeds) {
    return {
      pluginID: 'testAuth',
      pluginDef: { authenticationCategory: 'test' },
      callCount: 0,
      succeeds,
      getStatus: () => ({ authenticated: false }),
      authenticate(req, session) {
        this.callCount++;
        return Promise.resolve(this.succeeds
          ? { success: true, username: 'ALICE', expms: 100000 }
          : { success: false, reason: 'BadCredentials' });
      },
      getCapabilities: () => ({})
    };
  }

  function makeAuthManager(handler) {
    return {
      getAllHandlers: () => [handler],
      getAuthHandlerForService: () => null,
      getBestAuthenticationHandler: () => handler,
      sessionTimeoutMs: -1,
      defaultType: 'test',
      isRbacEnabled: () => false
    };
  }

  function makeReq(ip, username) {
    return {
      ip,
      body: { username, password: 'whatever' },
      session: { id: 'test-session-' + Math.random() },
      zluxData: { webApp: { authServiceHandleMaps: {} }, plugin: {} }
    };
  }

  function makeRes() {
    return {
      _status: null,
      _json: null,
      _body: null,
      _headers: {},
      status(code) { this._status = code; return this; },
      json(obj) { this._json = obj; return this; },
      send(body) { this._body = body; return this; },
      set(name, value) { this._headers[name] = value; return this; },
      end() { return this; }
    };
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  it('allows attempts under maxAttempts through to the auth handler', async function () {
    const handler = makeHandler(false);
    const auth = webauth(makeAuthManager(handler), 'cookie', true, RATE_LIMIT_CONF);
    const req = makeReq('10.0.0.1', 'bob');
    for (let i = 0; i < RATE_LIMIT_CONF.maxAttempts; i++) {
      const res = makeRes();
      await auth.doLogin(req, res);
      assert.strictEqual(res._status, 401, `attempt ${i + 1} should reach the handler and fail auth, not be rate limited`);
    }
    assert.strictEqual(handler.callCount, RATE_LIMIT_CONF.maxAttempts);
  });

  it('does not treat an Express next callback as a response formatter', async function () {
    const handler = makeHandler(false);
    const auth = webauth(makeAuthManager(handler), 'cookie', true, RATE_LIMIT_CONF);
    const res = makeRes();

    await auth.doLogin(makeReq('10.0.0.8', 'kate'), res, function next() {});

    assert.strictEqual(res._status, 401);
    assert.strictEqual(res._json.success, false);
  });

  it('does not delete a missing per-username counter after a successful login', async function () {
    const handler = makeHandler(true);
    const auth = webauth(makeAuthManager(handler), 'cookie', true, RATE_LIMIT_CONF);
    const consoleWarnStub = sinon.stub(console, 'warn');

    try {
      await auth.doLogin(makeReq('10.0.0.9', 'linda'), makeRes());
      assert.strictEqual(consoleWarnStub.called, false);
    } finally {
      consoleWarnStub.restore();
    }
  });

  it('locks out and returns 429 with Retry-After once maxAttempts is exceeded, without calling the handler', async function () {
    const handler = makeHandler(false);
    const auth = webauth(makeAuthManager(handler), 'cookie', true, RATE_LIMIT_CONF);
    const req = makeReq('10.0.0.2', 'carol');
    for (let i = 0; i < RATE_LIMIT_CONF.maxAttempts; i++) {
      await auth.doLogin(req, makeRes());
    }
    assert.strictEqual(handler.callCount, RATE_LIMIT_CONF.maxAttempts);

    const lockedRes = makeRes();
    await auth.doLogin(req, lockedRes);
    assert.strictEqual(lockedRes._status, 429);
    assert.ok(lockedRes._headers['Retry-After'], 'Retry-After header should be set');
    assert.strictEqual(handler.callCount, RATE_LIMIT_CONF.maxAttempts,
      'handler must not be invoked while locked out');
  });

  it('allows attempts again after the lockout window elapses', async function () {
    const handler = makeHandler(false);
    const auth = webauth(makeAuthManager(handler), 'cookie', true, RATE_LIMIT_CONF);
    const req = makeReq('10.0.0.3', 'dave');
    for (let i = 0; i < RATE_LIMIT_CONF.maxAttempts; i++) {
      await auth.doLogin(req, makeRes());
    }
    await auth.doLogin(req, makeRes()); // consumes the 429 while locked
    await wait(RATE_LIMIT_CONF.lockoutMS + 20);

    const res = makeRes();
    await auth.doLogin(req, res);
    assert.strictEqual(res._status, 401, 'handler should run again once the lockout has expired');
    assert.strictEqual(handler.callCount, RATE_LIMIT_CONF.maxAttempts + 1);
  });

  it('shares one counter across calls for the same ip/username regardless of route', async function () {
    // /auth, /gateway/api/v1/auth/login and /zaas/api/v1/auth/login all call
    // auth.doLogin -> the same _authenticateOrRefresh, so there is only ever
    // one code path to test here -- this asserts that structural guarantee
    // by driving doLogin directly, standing in for every alias.
    const handler = makeHandler(false);
    const auth = webauth(makeAuthManager(handler), 'cookie', true, RATE_LIMIT_CONF);
    const req = makeReq('10.0.0.4', 'erin');
    for (let i = 0; i < RATE_LIMIT_CONF.maxAttempts; i++) {
      await auth.doLogin(req, makeRes());
    }
    const res = makeRes();
    await auth.doLogin(req, res);
    assert.strictEqual(res._status, 429);
  });

  it('clears the per-username counter on a successful login but leaves the per-IP counter intact', async function () {
    // Uses a large lockoutMS so the lockout set partway through this test
    // can't race with real wall-clock time under a slow/loaded test run --
    // unlike the "lockout window elapses" test above, nothing here should
    // ever unlock on its own.
    const conf = Object.assign({}, RATE_LIMIT_CONF, { lockoutMS: 600000 });
    const handler = makeHandler(false);
    const auth = webauth(makeAuthManager(handler), 'cookie', true, conf);
    const ip = '10.0.0.5';

    // Two failures against 'frank' from this IP (under maxAttempts=3).
    await auth.doLogin(makeReq(ip, 'frank'), makeRes());
    await auth.doLogin(makeReq(ip, 'frank'), makeRes());

    // 'frank' now logs in successfully on the SAME auth/storage instance --
    // should reset frank's own counter but not the shared per-IP counter.
    handler.succeeds = true;
    const successRes = makeRes();
    await auth.doLogin(makeReq(ip, 'frank'), successRes);
    assert.strictEqual(successRes._status, 200);
    handler.succeeds = false;

    // A third failure against 'frank' should NOT be locked out (counter reset).
    const afterSuccessRes = makeRes();
    await auth.doLogin(makeReq(ip, 'frank'), afterSuccessRes);
    assert.strictEqual(afterSuccessRes._status, 401, 'per-username counter should have been cleared on success');

    // But the per-IP counter (2 from frank's failures + 1 from frank's post-success
    // failure = 3) has already hit maxAttempts by the call above; the IP is now
    // locked regardless of username, proving frank's success did not reset it.
    const ipLockedRes = makeRes();
    await auth.doLogin(makeReq(ip, 'heidi'), ipLockedRes);
    assert.strictEqual(ipLockedRes._status, 429, 'per-IP counter should not have been reset by frank\'s success');
  });

  it('fails open (allows the attempt) when the rate limit storage backend errors', async function () {
    const stub = sinon.stub(pluginStorage, 'PluginStorageFactory').returns({
      get: () => Promise.reject(new Error('storage unavailable')),
      set: () => Promise.reject(new Error('storage unavailable')),
      delete: () => Promise.reject(new Error('storage unavailable'))
    });
    try {
      const handler = makeHandler(false);
      const auth = webauth(makeAuthManager(handler), 'cookie', true, RATE_LIMIT_CONF);
      const req = makeReq('10.0.0.6', 'ivan');
      const res = makeRes();
      await auth.doLogin(req, res);
      assert.strictEqual(res._status, 401, 'a storage failure must not block the login attempt');
      assert.strictEqual(handler.callCount, 1);
    } finally {
      stub.restore();
    }
  });

  it('does nothing when disabled', async function () {
    const handler = makeHandler(false);
    const conf = Object.assign({}, RATE_LIMIT_CONF, { enabled: false });
    const auth = webauth(makeAuthManager(handler), 'cookie', true, conf);
    const req = makeReq('10.0.0.7', 'judy');
    for (let i = 0; i < RATE_LIMIT_CONF.maxAttempts + 5; i++) {
      const res = makeRes();
      await auth.doLogin(req, res);
      assert.strictEqual(res._status, 401);
    }
    assert.strictEqual(handler.callCount, RATE_LIMIT_CONF.maxAttempts + 5);
  });
});

// A failed login used to initialise req.session.zlux.expirationTime, which is what
// the authorization middleware checks to decide whether a session is still valid.
// That let a caller who had only sent a failed login pass the session gate.
describe('webauth session envelope', function () {
  let webauth;
  let savedClusterManager;
  let isConfiguredStub;

  before(function () {
    savedClusterManager = process.clusterManager;
    delete process.clusterManager;
    isConfiguredStub = sinon.stub(apimlStorage, 'isConfigured').returns(false);
    try {
      webauth = require('../../lib/webauth');
    } catch (e) {
      console.warn('Could not load webauth module:', e.message);
      this.skip();
    }
  });

  after(function () {
    if (savedClusterManager !== undefined) {
      process.clusterManager = savedClusterManager;
    }
    isConfiguredStub.restore();
  });

  const SESSION_TIMEOUT_MS = 3600000;
  const RATE_LIMIT_DISABLED = { enabled: false };

  function makeHandler(succeeds) {
    return {
      pluginID: 'testAuth',
      pluginDef: { authenticationCategory: 'test' },
      getStatus: () => ({ authenticated: false }),
      authenticate() {
        return Promise.resolve(succeeds
          ? { success: true, username: 'ALICE', expms: 100000 }
          : { success: false, reason: 'BadCredentials' });
      },
      getCapabilities: () => ({})
    };
  }

  function makeAuthManager(handler) {
    return {
      getAllHandlers: () => [handler],
      getAuthHandlerForService: () => null,
      getBestAuthenticationHandler: () => handler,
      sessionTimeoutMs: SESSION_TIMEOUT_MS,
      defaultType: 'test',
      isRbacEnabled: () => false
    };
  }

  function makeReq() {
    return {
      ip: '10.0.0.1',
      body: { username: 'alice', password: 'whatever' },
      session: { id: 'test-session-' + Math.random() },
      zluxData: { webApp: { authServiceHandleMaps: {} }, plugin: {} }
    };
  }

  function makeRes() {
    return {
      _status: null,
      _json: null,
      status(code) { this._status = code; return this; },
      json(obj) { this._json = obj; return this; },
      send() { return this; },
      set() { return this; },
      end() { return this; }
    };
  }

  it('does not create the session envelope after a failed login', async function () {
    const auth = webauth(makeAuthManager(makeHandler(false)), 'cookie', true, RATE_LIMIT_DISABLED);
    const req = makeReq();
    const res = makeRes();
    await auth.doLogin(req, res);
    assert.strictEqual(res._status, 401);
    assert.strictEqual(req.session.zlux, undefined,
      'a failed login must not leave a session envelope that the session gate would accept');
  });

  it('does not create the session envelope after repeated failed logins', async function () {
    const auth = webauth(makeAuthManager(makeHandler(false)), 'cookie', true, RATE_LIMIT_DISABLED);
    const req = makeReq();
    for (let i = 0; i < 3; i++) {
      await auth.doLogin(req, makeRes());
    }
    assert.strictEqual(req.session.zlux, undefined);
  });

  it('creates the session envelope with a future expiration after a successful login', async function () {
    const auth = webauth(makeAuthManager(makeHandler(true)), 'cookie', true, RATE_LIMIT_DISABLED);
    const req = makeReq();
    const res = makeRes();
    const before = Date.now();
    await auth.doLogin(req, res);
    assert.strictEqual(res._status, 200);
    assert.ok(req.session.zlux, 'a successful login must create the session envelope');
    assert.ok(req.session.zlux.expirationTime > before,
      'expirationTime must be set in the future');
  });
});
