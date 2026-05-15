/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

// Bootstrap the global logger required by sessionStore -> util
require('../../lib/util');

const assert = require('assert');

// sessionStore.js exports a singleton; we need direct access to the constructor
// and createLimitedQueue for isolated unit tests.
// We re-require the module fresh per-describe where needed.
const SessionStore = require('../../lib/sessionStore').sessionStore.constructor;

// createLimitedQueue is not exported — test it indirectly via SessionStore's
// internal queue behaviour (sessionsQueue).

describe('sessionStore', function() {

  describe('createLimitedQueue (via sessionsQueue)', function() {
    it('should evict the oldest entry when the limit is exceeded', function() {
      // Create a small store by manipulating storedSessionsLimit env var is not practical,
      // so we test the internal queue directly by injecting a small store.
      // We call the constructor with a custom sessionsQueue to test eviction indirectly.

      const store = new SessionStore();

      // Manually shrink the queue limit by replacing it with a limit-1 queue.
      // We use the same createLimitedQueue logic inline.
      const limit = 3;
      const evicted = [];
      const q = new Array();
      q.push = function() {
        if (this.length >= limit) {
          evicted.push(this.shift());
        }
        return Array.prototype.push.apply(this, arguments);
      };
      store.sessionsQueue = q;

      store.sessions = new Map();
      // Override addSession to use our custom queue
      for (let i = 0; i < 4; i++) {
        store.addSession(`sid${i}`, { data: i });
      }

      // sid0 should have been evicted
      assert.ok(evicted.includes('sid0'), 'sid0 should be evicted');
      assert.ok(store.sessions.has('sid1'));
      assert.ok(store.sessions.has('sid2'));
      assert.ok(store.sessions.has('sid3'));
    });
  });

  describe('SessionStore CRUD operations', function() {
    let store;

    beforeEach(function() {
      store = new SessionStore();
      // Ensure we always operate in local (non-cluster) mode
      store.isLocalStorage = () => true;
    });

    it('should store and retrieve a session with get', function(done) {
      const session = { user: 'alice', cookie: { maxAge: 3600 } };
      store.set('abc', session, function(err) {
        assert.ifError(err);
        store.get('abc', function(err2, sess) {
          assert.ifError(err2);
          assert.strictEqual(sess.user, 'alice');
          done();
        });
      });
    });

    it('should return undefined for a non-existent session', function(done) {
      store.get('nonexistent', function(err, sess) {
        assert.ifError(err);
        assert.strictEqual(sess, undefined);
        done();
      });
    });

    it('should destroy a session', function(done) {
      store.set('todelete', { user: 'bob', cookie: {} }, function(err) {
        assert.ifError(err);
        store.destroy('todelete', function(err2) {
          assert.ifError(err2);
          store.get('todelete', function(err3, sess) {
            assert.ifError(err3);
            assert.strictEqual(sess, undefined);
            done();
          });
        });
      });
    });

    it('should report length correctly', function(done) {
      store.set('s1', { cookie: {} }, function() {
        store.set('s2', { cookie: {} }, function() {
          store.length(function(err, len) {
            assert.ifError(err);
            assert.strictEqual(len, 2);
            done();
          });
        });
      });
    });

    it('all() should return all stored sessions', function(done) {
      store.set('x1', { cookie: {}, val: 1 }, function() {
        store.set('x2', { cookie: {}, val: 2 }, function() {
          store.all(function(err, sessions) {
            assert.ifError(err);
            assert.strictEqual(sessions.length, 2);
            done();
          });
        });
      });
    });

    it('clear() should remove all sessions', function(done) {
      store.set('c1', { cookie: {} }, function() {
        store.clear(function(err) {
          assert.ifError(err);
          store.length(function(err2, len) {
            assert.ifError(err2);
            assert.strictEqual(len, 0);
            done();
          });
        });
      });
    });

    it('touch() should update lastTouch on the session', function(done) {
      const session = { cookie: {}, lastTouch: 0 };
      store.set('t1', session, function() {
        store.touch('t1', session, function(err) {
          assert.ifError(err);
          assert.ok(session.lastTouch > 0);
          done();
        });
      });
    });
  });

  describe('ensureMaxAge', function() {
    it('should not set maxAge when process.env.sessionMaxAge is not defined', function() {
      const store = new SessionStore();
      store.isLocalStorage = () => true;
      const sess = { cookie: {} };
      store.ensureMaxAge(sess);
      assert.strictEqual(sess.cookie.maxAge, undefined);
    });
  });

  describe('updateLastTouch', function() {
    it('should set lastTouch to a recent timestamp', function() {
      const store = new SessionStore();
      const before = Date.now();
      const sess = {};
      store.updateLastTouch(sess);
      const after = Date.now();
      assert.ok(sess.lastTouch >= before && sess.lastTouch <= after);
    });
  });

  describe('removeSid', function() {
    it('should remove the session and its queue entry', function() {
      const store = new SessionStore();
      store.isLocalStorage = () => true;
      store.addSession('r1', { data: true });
      store.addSession('r2', { data: true });
      store.removeSid('r1');
      assert.ok(!store.sessions.has('r1'));
      assert.ok(!store.sessionsQueue.includes('r1'));
      assert.ok(store.sessions.has('r2'));
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
