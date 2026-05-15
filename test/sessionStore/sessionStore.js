'use strict';
const { expect } = require('chai');
const sinon = require('sinon');

// SessionStore requires express-session and process.clusterManager
// We need to mock those before requiring
const expressSession = require('express-session');

describe('sessionStore.js', function () {

  let SessionStore, store;

  beforeEach(function () {
    // Fresh require each time to get a clean singleton
    delete require.cache[require.resolve('../../lib/sessionStore')];
    const mod = require('../../lib/sessionStore');
    store = mod.sessionStore;
  });

  describe('SessionStore initialization', function () {
    it('should be an instance with sessions Map and sessionsQueue', function () {
      expect(store.sessions).to.be.instanceOf(Map);
      expect(store.sessionsQueue).to.be.an('array');
    });

    it('should start with zero sessions', function () {
      expect(store.sessions.size).to.equal(0);
    });
  });

  describe('addSession / get', function () {
    it('should store and retrieve a session by sid', function (done) {
      store.addSession('sid1', { cookie: {}, data: 'test' });
      store.get('sid1', (err, session) => {
        expect(err).to.be.null;
        expect(session.data).to.equal('test');
        done();
      });
    });

    it('should return undefined for non-existent sid', function (done) {
      store.get('nonexistent', (err, session) => {
        expect(err).to.be.null;
        expect(session).to.be.undefined;
        done();
      });
    });

    it('should track sids in sessionsQueue', function () {
      store.addSession('sid-a', { cookie: {} });
      store.addSession('sid-b', { cookie: {} });
      expect(store.sessionsQueue).to.include('sid-a');
      expect(store.sessionsQueue).to.include('sid-b');
    });

    it('should not duplicate sid in queue on update', function () {
      store.addSession('sid-x', { cookie: {}, v: 1 });
      store.addSession('sid-x', { cookie: {}, v: 2 });
      const count = store.sessionsQueue.filter(s => s === 'sid-x').length;
      expect(count).to.equal(1);
    });
  });

  describe('set', function () {
    it('should store a session and callback without error', function (done) {
      store.set('sid-set', { cookie: { maxAge: 1000 } }, (err) => {
        expect(err).to.be.null;
        store.get('sid-set', (err2, session) => {
          expect(session).to.have.property('cookie');
          done();
        });
      });
    });
  });

  describe('destroy', function () {
    it('should remove the session', function (done) {
      store.addSession('sid-del', { cookie: {} });
      store.destroy('sid-del', (err) => {
        expect(err).to.be.null;
        store.get('sid-del', (err2, session) => {
          expect(session).to.be.undefined;
          done();
        });
      });
    });

    it('should remove sid from queue', function (done) {
      store.addSession('sid-q', { cookie: {} });
      store.destroy('sid-q', () => {
        expect(store.sessionsQueue).to.not.include('sid-q');
        done();
      });
    });

    it('should not error when destroying non-existent session', function (done) {
      store.destroy('nope', (err) => {
        expect(err).to.be.null;
        done();
      });
    });
  });

  describe('clear', function () {
    it('should remove all sessions', function (done) {
      store.addSession('a', { cookie: {} });
      store.addSession('b', { cookie: {} });
      store.clear((err) => {
        expect(err).to.be.null;
        expect(store.sessions.size).to.equal(0);
        expect(store.sessionsQueue.length).to.equal(0);
        done();
      });
    });
  });

  describe('length', function () {
    it('should return the number of sessions', function (done) {
      store.addSession('l1', { cookie: {} });
      store.addSession('l2', { cookie: {} });
      store.length((err, len) => {
        expect(err).to.be.null;
        expect(len).to.equal(2);
        done();
      });
    });
  });

  describe('all', function () {
    it('should return all session values', function (done) {
      store.addSession('all-1', { cookie: {}, v: 1 });
      store.addSession('all-2', { cookie: {}, v: 2 });
      store.all((err, sessions) => {
        expect(err).to.be.null;
        expect(sessions).to.be.an('array').with.lengthOf(2);
        done();
      });
    });
  });

  describe('touch', function () {
    it('should update lastTouch on the session', function (done) {
      const sess = { cookie: { maxAge: 5000 }, lastTouch: 0 };
      store.addSession('touch-1', sess);
      const before = store.getTimestamp();
      store.touch('touch-1', sess, (err) => {
        expect(err).to.be.null;
        expect(sess.lastTouch).to.be.at.least(before);
        done();
      });
    });
  });

  describe('createSession', function () {
    it('should set lastTouch on created session', function () {
      const req = {
        sessionID: 'cs-1',
        session: undefined,
        sessionStore: store
      };
      const sess = { cookie: { maxAge: 60000, _expires: new Date(Date.now() + 60000) } };
      const created = store.createSession(req, sess);
      expect(created.lastTouch).to.be.a('number');
      expect(created.lastTouch).to.be.greaterThan(0);
    });
  });

  describe('ensureMaxAge', function () {
    it('should not override existing maxAge', function () {
      const sess = { cookie: { maxAge: 5000 } };
      store.ensureMaxAge(sess);
      expect(sess.cookie.maxAge).to.equal(5000);
    });
  });

  describe('getTimestamp', function () {
    it('should return current epoch ms', function () {
      const ts = store.getTimestamp();
      const now = Date.now();
      expect(Math.abs(ts - now)).to.be.lessThan(100);
    });
  });

  describe('isLocalStorage', function () {
    it('should return true when clusterManager is not set', function () {
      delete process.clusterManager;
      expect(store.isLocalStorage()).to.be.true;
    });
  });

  describe('limited queue behavior (overflow)', function () {

    it('should evict oldest session when queue exceeds limit', function () {
      // The default limit is from env var storedSessionsLimit (default 500000)
      // We test the createLimitedQueue mechanism directly
      const originalLimit = process.env.storedSessionsLimit;
      process.env.storedSessionsLimit = '3';
      
      delete require.cache[require.resolve('../../lib/sessionStore')];
      const mod = require('../../lib/sessionStore');
      const limitedStore = mod.sessionStore;

      limitedStore.addSession('s1', { cookie: {} });
      limitedStore.addSession('s2', { cookie: {} });
      limitedStore.addSession('s3', { cookie: {} });
      limitedStore.addSession('s4', { cookie: {} });

      // s1 should have been evicted from queue (but the queue push override
      // only removes from queue, not from Map — this is a potential FLAW)
      expect(limitedStore.sessionsQueue.length).to.be.at.most(3);
      
      process.env.storedSessionsLimit = originalLimit;
    });
  });

  describe('concurrent session operations', function () {

    it('should handle rapid set/get/destroy cycles', function (done) {
      const ops = [];
      for (let i = 0; i < 100; i++) {
        const sid = `rapid-${i}`;
        store.set(sid, { cookie: {}, i }, () => {});
      }
      store.length((err, len) => {
        expect(len).to.equal(100);
        for (let i = 0; i < 100; i++) {
          store.destroy(`rapid-${i}`, () => {});
        }
        store.length((err2, len2) => {
          expect(len2).to.equal(0);
          done();
        });
      });
    });
  });

  describe('FLAW: removeSid uses indexOf on array — O(n) per removal', function () {
    it('should correctly remove even with many sessions', function (done) {
      for (let i = 0; i < 1000; i++) {
        store.addSession(`perf-${i}`, { cookie: {} });
      }
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        store.removeSid(`perf-${i}`);
      }
      const elapsed = Date.now() - start;
      expect(store.sessions.size).to.equal(0);
      done();
    });
  });
});
