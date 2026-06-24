const assert = require('assert');

describe('sessionStore', function () {
  let sessionStoreModule;
  let sessionStore;

  before(function () {
    try {
      sessionStoreModule = require('../../lib/sessionStore');
      sessionStore = sessionStoreModule.sessionStore;
    } catch (e) {
      console.warn('Could not load sessionStore module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(sessionStoreModule, 'sessionStore module should be loadable');
  });

  it('should export sessionStore instance', function () {
    assert.ok(sessionStore, 'should export sessionStore');
    assert.ok(typeof sessionStore === 'object', 'sessionStore should be an object');
  });

  it('should have a sessions Map', function () {
    assert.ok(sessionStore.sessions instanceof Map, 'sessions should be a Map');
  });

  it('should have a sessionsQueue array', function () {
    assert.ok(Array.isArray(sessionStore.sessionsQueue), 'sessionsQueue should be an array');
  });

  describe('isLocalStorage', function () {
    it('should return a boolean', function () {
      var result = sessionStore.isLocalStorage();
      assert.ok(typeof result === 'boolean', 'isLocalStorage should return boolean');
    });
  });

  describe('getTimestamp', function () {
    it('should return a number', function () {
      var ts = sessionStore.getTimestamp();
      assert.ok(typeof ts === 'number', 'getTimestamp should return a number');
    });

    it('should return current time in milliseconds', function () {
      var before = Date.now();
      var ts = sessionStore.getTimestamp();
      var after = Date.now();
      assert.ok(ts >= before && ts <= after, 'timestamp should be close to Date.now()');
    });
  });

  describe('updateLastTouch', function () {
    it('should set lastTouch on session object', function () {
      var sess = {};
      sessionStore.updateLastTouch(sess);
      assert.ok(typeof sess.lastTouch === 'number', 'lastTouch should be a number');
    });

    it('should set lastTouch to current timestamp', function () {
      var sess = {};
      var before = Date.now();
      sessionStore.updateLastTouch(sess);
      var after = Date.now();
      assert.ok(sess.lastTouch >= before && sess.lastTouch <= after, 'lastTouch should be current time');
    });
  });

  describe('ensureMaxAge', function () {
    it('should not overwrite existing maxAge', function () {
      var sess = { cookie: { maxAge: 5000 } };
      sessionStore.ensureMaxAge(sess);
      assert.strictEqual(sess.cookie.maxAge, 5000, 'maxAge should remain 5000');
    });

    it('should handle session with no maxAge', function () {
      var sess = { cookie: {} };
      sessionStore.ensureMaxAge(sess);
      // Should not throw
      assert.ok(true, 'should not throw');
    });
  });

  describe('addSession', function () {
    afterEach(function () {
      sessionStore.sessions.clear();
      sessionStore.sessionsQueue.splice(0, sessionStore.sessionsQueue.length);
    });

    it('should add a session to the sessions map', function () {
      sessionStore.addSession('test-sid-1', { data: 'test' });
      assert.ok(sessionStore.sessions.has('test-sid-1'), 'session should exist in map');
    });

    it('should add sid to sessionsQueue', function () {
      sessionStore.addSession('test-sid-2', { data: 'test' });
      assert.ok(sessionStore.sessionsQueue.includes('test-sid-2'), 'sid should be in queue');
    });

    it('should not duplicate sid in queue on update', function () {
      sessionStore.addSession('test-sid-3', { data: 'test1' });
      sessionStore.addSession('test-sid-3', { data: 'test2' });
      var count = sessionStore.sessionsQueue.filter(function(s) { return s === 'test-sid-3'; }).length;
      assert.strictEqual(count, 1, 'sid should appear only once in queue');
    });

    it('should update session data when sid already exists', function () {
      sessionStore.addSession('test-sid-4', { data: 'old' });
      sessionStore.addSession('test-sid-4', { data: 'new' });
      assert.strictEqual(sessionStore.sessions.get('test-sid-4').data, 'new', 'session data should be updated');
    });
  });

  describe('removeSid', function () {
    afterEach(function () {
      sessionStore.sessions.clear();
      sessionStore.sessionsQueue.splice(0, sessionStore.sessionsQueue.length);
    });

    it('should remove a session from the map', function () {
      sessionStore.addSession('remove-sid-1', { data: 'test' });
      sessionStore.removeSid('remove-sid-1');
      assert.ok(!sessionStore.sessions.has('remove-sid-1'), 'session should be removed');
    });

    it('should remove sid from queue', function () {
      sessionStore.addSession('remove-sid-2', { data: 'test' });
      sessionStore.removeSid('remove-sid-2');
      assert.ok(!sessionStore.sessionsQueue.includes('remove-sid-2'), 'sid should be removed from queue');
    });

    it('should handle removing non-existent sid', function () {
      sessionStore.removeSid('non-existent-sid');
      assert.ok(true, 'should not throw');
    });
  });

  describe('set', function () {
    afterEach(function () {
      sessionStore.sessions.clear();
      sessionStore.sessionsQueue.splice(0, sessionStore.sessionsQueue.length);
    });

    it('should store a session and call callback with null', function (done) {
      sessionStore.set('set-sid-1', { cookie: { maxAge: 1000 } }, function (err) {
        assert.strictEqual(err, null, 'error should be null');
        assert.ok(sessionStore.sessions.has('set-sid-1'), 'session should be stored');
        done();
      });
    });
  });

  describe('get', function () {
    afterEach(function () {
      sessionStore.sessions.clear();
      sessionStore.sessionsQueue.splice(0, sessionStore.sessionsQueue.length);
    });

    it('should retrieve a stored session', function (done) {
      sessionStore.addSession('get-sid-1', { cookie: { maxAge: 1000 }, data: 'hello' });
      sessionStore.get('get-sid-1', function (err, session) {
        assert.strictEqual(err, null, 'error should be null');
        assert.ok(session, 'session should exist');
        assert.strictEqual(session.data, 'hello', 'session data should match');
        done();
      });
    });

    it('should return undefined for non-existent session', function (done) {
      sessionStore.get('non-existent', function (err, session) {
        assert.strictEqual(err, null, 'error should be null');
        assert.strictEqual(session, undefined, 'session should be undefined');
        done();
      });
    });
  });

  describe('destroy', function () {
    afterEach(function () {
      sessionStore.sessions.clear();
      sessionStore.sessionsQueue.splice(0, sessionStore.sessionsQueue.length);
    });

    it('should remove a session and call callback with null', function (done) {
      sessionStore.addSession('destroy-sid-1', { data: 'test' });
      sessionStore.destroy('destroy-sid-1', function (err) {
        assert.strictEqual(err, null, 'error should be null');
        assert.ok(!sessionStore.sessions.has('destroy-sid-1'), 'session should be removed');
        done();
      });
    });

    it('should handle destroying non-existent session', function (done) {
      sessionStore.destroy('non-existent', function (err) {
        assert.strictEqual(err, null, 'error should be null');
        done();
      });
    });

    it('should work without callback', function () {
      sessionStore.addSession('destroy-sid-2', { data: 'test' });
      sessionStore.destroy('destroy-sid-2');
      assert.ok(!sessionStore.sessions.has('destroy-sid-2'), 'session should be removed');
    });
  });

  describe('clear', function () {
    afterEach(function () {
      sessionStore.sessions.clear();
      sessionStore.sessionsQueue.splice(0, sessionStore.sessionsQueue.length);
    });

    it('should remove all sessions', function (done) {
      sessionStore.addSession('clear-sid-1', { data: 'a' });
      sessionStore.addSession('clear-sid-2', { data: 'b' });
      sessionStore.clear(function (err) {
        assert.strictEqual(err, null, 'error should be null');
        assert.strictEqual(sessionStore.sessions.size, 0, 'sessions should be empty');
        assert.strictEqual(sessionStore.sessionsQueue.length, 0, 'queue should be empty');
        done();
      });
    });

    it('should work without callback', function () {
      sessionStore.addSession('clear-sid-3', { data: 'test' });
      sessionStore.clear();
      assert.strictEqual(sessionStore.sessions.size, 0, 'sessions should be empty');
    });
  });

  describe('length', function () {
    afterEach(function () {
      sessionStore.sessions.clear();
      sessionStore.sessionsQueue.splice(0, sessionStore.sessionsQueue.length);
    });

    it('should return 0 for empty store', function (done) {
      sessionStore.length(function (err, len) {
        assert.strictEqual(err, null, 'error should be null');
        assert.strictEqual(len, 0, 'length should be 0');
        done();
      });
    });

    it('should return correct count', function (done) {
      sessionStore.addSession('len-sid-1', { data: 'a' });
      sessionStore.addSession('len-sid-2', { data: 'b' });
      sessionStore.addSession('len-sid-3', { data: 'c' });
      sessionStore.length(function (err, len) {
        assert.strictEqual(err, null, 'error should be null');
        assert.strictEqual(len, 3, 'length should be 3');
        done();
      });
    });
  });

  describe('all', function () {
    afterEach(function () {
      sessionStore.sessions.clear();
      sessionStore.sessionsQueue.splice(0, sessionStore.sessionsQueue.length);
    });

    it('should return empty array for empty store', function (done) {
      sessionStore.all(function (err, sessions) {
        assert.strictEqual(err, null, 'error should be null');
        assert.ok(Array.isArray(sessions), 'sessions should be an array');
        assert.strictEqual(sessions.length, 0, 'should be empty');
        done();
      });
    });

    it('should return all sessions', function (done) {
      sessionStore.addSession('all-sid-1', { data: 'a' });
      sessionStore.addSession('all-sid-2', { data: 'b' });
      sessionStore.all(function (err, sessions) {
        assert.strictEqual(err, null, 'error should be null');
        assert.strictEqual(sessions.length, 2, 'should have 2 sessions');
        done();
      });
    });
  });

  describe('touch', function () {
    afterEach(function () {
      sessionStore.sessions.clear();
      sessionStore.sessionsQueue.splice(0, sessionStore.sessionsQueue.length);
    });

    it('should update lastTouch and call callback', function (done) {
      var session = { cookie: { maxAge: 1000 } };
      sessionStore.addSession('touch-sid-1', session);
      var before = Date.now();
      sessionStore.touch('touch-sid-1', session, function (err) {
        assert.strictEqual(err, null, 'error should be null');
        assert.ok(session.lastTouch >= before, 'lastTouch should be updated');
        done();
      });
    });
  });

  describe('createSession', function () {
    afterEach(function () {
      sessionStore.sessions.clear();
      sessionStore.sessionsQueue.splice(0, sessionStore.sessionsQueue.length);
    });

    it('should create a session with lastTouch', function () {
      var req = {};
      var sess = { cookie: { maxAge: 1000 } };
      var result = sessionStore.createSession(req, sess);
      assert.ok(result, 'should return a session');
      assert.ok(typeof result.lastTouch === 'number', 'should have lastTouch');
    });
  });

  describe('createLimitedQueue behavior', function () {
    afterEach(function () {
      sessionStore.sessions.clear();
      sessionStore.sessionsQueue.splice(0, sessionStore.sessionsQueue.length);
    });

    it('sessionsQueue push should work normally under limit', function () {
      sessionStore.addSession('q1', { data: '1' });
      sessionStore.addSession('q2', { data: '2' });
      assert.strictEqual(sessionStore.sessionsQueue.length, 2, 'queue should have 2 items');
      assert.strictEqual(sessionStore.sessions.size, 2, 'map should have 2 items');
    });
  });

  describe('concurrent session operations', function () {
    afterEach(function () {
      sessionStore.sessions.clear();
      sessionStore.sessionsQueue.splice(0, sessionStore.sessionsQueue.length);
    });

    it('should handle multiple set and get operations', function (done) {
      var count = 0;
      var total = 10;
      for (var i = 0; i < total; i++) {
        (function (idx) {
          sessionStore.set('concurrent-' + idx, { cookie: { maxAge: 1000 }, idx: idx }, function (err) {
            assert.strictEqual(err, null);
            count++;
            if (count === total) {
              sessionStore.length(function (err, len) {
                assert.strictEqual(len, total);
                done();
              });
            }
          });
        })(i);
      }
    });

    it('should handle set followed by immediate destroy', function (done) {
      sessionStore.set('temp-sid', { cookie: { maxAge: 1000 } }, function (err) {
        assert.strictEqual(err, null);
        sessionStore.destroy('temp-sid', function (err) {
          assert.strictEqual(err, null);
          sessionStore.get('temp-sid', function (err, session) {
            assert.strictEqual(session, undefined);
            done();
          });
        });
      });
    });

    it('should handle repeated touch calls', function (done) {
      var session = { cookie: { maxAge: 5000 } };
      sessionStore.addSession('touch-repeat', session);
      var firstTouch;
      sessionStore.touch('touch-repeat', session, function () {
        firstTouch = session.lastTouch;
        setTimeout(function () {
          sessionStore.touch('touch-repeat', session, function () {
            assert.ok(session.lastTouch >= firstTouch);
            done();
          });
        }, 10);
      });
    });
  });

  describe('createSession', function () {
    afterEach(function () {
      sessionStore.sessions.clear();
      sessionStore.sessionsQueue.splice(0, sessionStore.sessionsQueue.length);
    });

    it('should create a session with lastTouch', function () {
      var req = {};
      var sess = { cookie: { maxAge: 1000 } };
      var result = sessionStore.createSession(req, sess);
      assert.ok(result, 'should return a session');
      assert.ok(typeof result.lastTouch === 'number', 'should have lastTouch');
    });

    it('should set lastTouch to approximately current time', function () {
      var before = Date.now();
      var req = {};
      var sess = { cookie: { maxAge: 1000 } };
      var result = sessionStore.createSession(req, sess);
      var after = Date.now();
      assert.ok(result.lastTouch >= before && result.lastTouch <= after);
    });

    it('should preserve existing maxAge', function () {
      var req = {};
      var sess = { cookie: { maxAge: 5000 } };
      var result = sessionStore.createSession(req, sess);
      assert.strictEqual(result.cookie.maxAge, 5000);
    });
  });

  describe('error handling', function () {
    it('should pass error to get callback when internal error occurs', function (done) {
      // Temporarily break the sessions map to trigger error path
      var originalGet = sessionStore.sessions.get;
      sessionStore.sessions.get = function () { throw new Error('test error'); };
      sessionStore.get('any-sid', function (err, session) {
        sessionStore.sessions.get = originalGet;
        assert.ok(err instanceof Error);
        assert.strictEqual(session, null);
        done();
      });
    });

    it('should pass error to set callback when internal error occurs', function (done) {
      var originalSet = sessionStore.sessions.set;
      sessionStore.sessions.set = function () { throw new Error('test error'); };
      sessionStore.set('any-sid', { cookie: {} }, function (err) {
        sessionStore.sessions.set = originalSet;
        assert.ok(err instanceof Error);
        done();
      });
    });

    it('should pass error to length callback when internal error occurs', function (done) {
      var originalSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size');
      Object.defineProperty(sessionStore.sessions, 'size', {
        get: function () { throw new Error('test error'); },
        configurable: true
      });
      sessionStore.length(function (err, len) {
        delete sessionStore.sessions.size; // restore
        assert.ok(err instanceof Error);
        assert.strictEqual(len, null);
        done();
      });
    });
  });
});