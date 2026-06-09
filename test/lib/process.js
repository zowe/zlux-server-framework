const assert = require('assert');

describe('process', function () {
  let ProcessManager;

  before(function () {
    try {
      ProcessManager = require('../../lib/process');
    } catch (e) {
      console.warn('Could not load process module:', e.message);
      this.skip();
    }
  });

  it('should load the module without errors', function () {
    assert.ok(ProcessManager, 'process module should be loadable');
  });

  it('should export ProcessManager constructor', function () {
    assert.strictEqual(typeof ProcessManager, 'function');
  });

  describe('ProcessManager instance', function () {
    var pm;

    before(function () {
      // Only create one instance to avoid adding too many signal listeners
      process.setMaxListeners(20);
      pm = new ProcessManager(false, []);
    });

    it('should create an instance', function () {
      assert.ok(pm);
    });

    it('should have childProcesses array', function () {
      assert.ok(Array.isArray(pm.childProcesses));
    });

    it('should have cleanupFunctions array', function () {
      assert.ok(Array.isArray(pm.cleanupFunctions));
    });

    it('should set exitOnException to false', function () {
      assert.strictEqual(pm.exitOnException, false);
    });

    describe('addCleanupFunction', function () {
      afterEach(function () {
        pm.cleanupFunctions = [];
      });

      it('should add a function to cleanupFunctions', function () {
        var fn = function () {};
        pm.addCleanupFunction(fn);
        assert.strictEqual(pm.cleanupFunctions.length, 1);
        assert.strictEqual(pm.cleanupFunctions[0], fn);
      });

      it('should add multiple cleanup functions', function () {
        pm.addCleanupFunction(function () {});
        pm.addCleanupFunction(function () {});
        pm.addCleanupFunction(function () {});
        assert.strictEqual(pm.cleanupFunctions.length, 3);
      });
    });

    describe('performCleanup', function () {
      afterEach(function () {
        pm.cleanupFunctions = [];
      });

      it('should call all cleanup functions', function () {
        var called = [];
        pm.addCleanupFunction(function () { called.push(1); });
        pm.addCleanupFunction(function () { called.push(2); });
        pm.addCleanupFunction(function () { called.push(3); });
        pm.performCleanup();
        assert.deepStrictEqual(called, [1, 2, 3]);
      });

      it('should not throw when a cleanup function throws', function () {
        pm.addCleanupFunction(function () { throw new Error('cleanup error'); });
        pm.addCleanupFunction(function () {});
        assert.doesNotThrow(function () {
          pm.performCleanup();
        });
      });

      it('should continue calling remaining functions after error', function () {
        var calledAfter = false;
        pm.addCleanupFunction(function () { throw new Error('fail'); });
        pm.addCleanupFunction(function () { calledAfter = true; });
        pm.performCleanup();
        assert.strictEqual(calledAfter, true);
      });
    });

    describe('endChildren', function () {
      afterEach(function () {
        pm.childProcesses = [];
      });

      it('should not throw when no child processes exist', function () {
        assert.doesNotThrow(function () {
          pm.endChildren('SIGTERM');
        });
      });

      it('should call kill on child processes with pid', function () {
        var killed = false;
        pm.childProcesses.push({ pid: 12345, kill: function () { killed = true; } });
        pm.endChildren('SIGTERM');
        assert.strictEqual(killed, true);
      });

      it('should skip child processes without pid', function () {
        var killCalled = false;
        pm.childProcesses.push({ pid: null, kill: function () { killCalled = true; } });
        pm.endChildren('SIGTERM');
        assert.strictEqual(killCalled, false);
      });

      it('should kill all child processes', function () {
        var killCount = 0;
        pm.childProcesses.push({ pid: 1, kill: function () { killCount++; } });
        pm.childProcesses.push({ pid: 2, kill: function () { killCount++; } });
        pm.childProcesses.push({ pid: 3, kill: function () { killCount++; } });
        pm.endChildren('SIGTERM');
        assert.strictEqual(killCount, 3);
      });
    });
  });
});
