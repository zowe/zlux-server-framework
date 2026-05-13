/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

// Bootstrap the global logger before requiring any lib module that uses it.
require('../../lib/util');

// ProcessManager registers signal/exception handlers on the process emitter for
// every instance it creates. Across the test suite this exceeds Node's default
// MaxListeners limit of 10 and produces spurious warnings. Raise the limit here
// so the output stays clean.
process.setMaxListeners(50);

const assert = require('assert');
const ProcessManager = require('../../lib/process');

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a ProcessManager with a no-op langManagers array, stub out process.exit
 * so tests don't kill the test runner, and return cleanup.
 *
 * @returns {{ mgr: ProcessManager, exitCalls: string[], restoreExit: Function }}
 */
function makeManager(exitOnException = false) {
  const exitCalls = [];
  const originalExit = process.exit;
  process.exit = (code) => { exitCalls.push(code); };

  // Pass an empty langManagers array — endServer will call stopManager(0)
  // which short-circuits immediately when langManagers.length === 0.
  const mgr = new ProcessManager(exitOnException, []);

  function restoreExit() {
    process.exit = originalExit;
  }

  return { mgr, exitCalls, restoreExit };
}

/**
 * Wait for a child process to reach a running state (pid assigned) or timeout.
 */
function waitForPid(childProcess, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    if (childProcess.pid) { return resolve(); }
    const t = setTimeout(() => reject(new Error('timeout waiting for pid')), timeoutMs);
    childProcess.once('spawn', () => { clearTimeout(t); resolve(); });
    childProcess.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Wait for a child process to exit.
 */
function waitForExit(childProcess, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    if (childProcess.exitCode !== null) { return resolve(childProcess.exitCode); }
    const t = setTimeout(() => reject(new Error('timeout waiting for child exit')), timeoutMs);
    childProcess.once('close', (code) => { clearTimeout(t); resolve(code); });
  });
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('ProcessManager', function() {

  describe('addCleanupFunction / performCleanup', function() {
    let restoreExit;

    afterEach(function() { if (restoreExit) { restoreExit(); restoreExit = null; } });

    it('should call all registered cleanup functions', function() {
      const { mgr, restoreExit: re } = makeManager();
      restoreExit = re;

      const calls = [];
      mgr.addCleanupFunction(() => calls.push('first'));
      mgr.addCleanupFunction(() => calls.push('second'));
      mgr.performCleanup();

      assert.deepStrictEqual(calls, ['first', 'second']);
    });

    it('should continue calling remaining cleanup functions if one throws', function() {
      const { mgr, restoreExit: re } = makeManager();
      restoreExit = re;

      const calls = [];
      mgr.addCleanupFunction(() => { throw new Error('boom'); });
      mgr.addCleanupFunction(() => calls.push('after-error'));
      mgr.performCleanup();

      assert.deepStrictEqual(calls, ['after-error']);
    });

    it('should handle an empty cleanup list gracefully', function() {
      const { mgr, restoreExit: re } = makeManager();
      restoreExit = re;
      assert.doesNotThrow(() => mgr.performCleanup());
    });
  });

  describe('spawn / endChildren', function() {
    let restoreExit;
    let mgr;

    beforeEach(function() {
      const result = makeManager();
      mgr = result.mgr;
      restoreExit = result.restoreExit;
    });

    afterEach(function() {
      // Kill any surviving children and restore exit
      for (const child of mgr.childProcesses) {
        try { child.kill('SIGKILL'); } catch (_) {}
      }
      restoreExit();
    });

    it('should add a spawned process to childProcesses', async function() {
      // Spawn a long-lived node process: listens for stdin close
      mgr.spawn({ path: process.execPath, args: ['-e', 'setInterval(()=>{},60000)'] });
      assert.strictEqual(mgr.childProcesses.length, 1);
      await waitForPid(mgr.childProcesses[0]);
      assert.ok(mgr.childProcesses[0].pid > 0, 'child should have a pid');
    });

    it('should kill spawned child processes via endChildren', async function() {
      mgr.spawn({ path: process.execPath, args: ['-e', 'setInterval(()=>{},60000)'] });
      const child = mgr.childProcesses[0];
      await waitForPid(child);

      mgr.endChildren('SIGTERM');

      const exitCode = await waitForExit(child);
      // On SIGTERM the exit code is null and signal is 'SIGTERM'
      // (or code may be non-zero). Either way the process is no longer running.
      assert.strictEqual(child.killed, true);
    });

    it('should kill multiple children with endChildren', async function() {
      mgr.spawn({ path: process.execPath, args: ['-e', 'setInterval(()=>{},60000)'] });
      mgr.spawn({ path: process.execPath, args: ['-e', 'setInterval(()=>{},60000)'] });
      assert.strictEqual(mgr.childProcesses.length, 2);

      await waitForPid(mgr.childProcesses[0]);
      await waitForPid(mgr.childProcesses[1]);

      mgr.endChildren('SIGTERM');

      await Promise.all(mgr.childProcesses.map(waitForExit));
      assert.ok(mgr.childProcesses.every(c => c.killed));
    });

    it('should not throw when endChildren is called with no children', function() {
      assert.doesNotThrow(() => mgr.endChildren('SIGTERM'));
    });
  });

  describe('endServer', function() {
    let restoreExit;

    afterEach(function() { if (restoreExit) { restoreExit(); restoreExit = null; } });

    it('should call process.exit(0) when langManagers is empty', function() {
      const { mgr, exitCalls, restoreExit: re } = makeManager();
      restoreExit = re;

      mgr.endServer('SIGTERM', []);
      assert.deepStrictEqual(exitCalls, [0]);
    });

    it('should call performCleanup before exiting', function() {
      const { mgr, exitCalls, restoreExit: re } = makeManager();
      restoreExit = re;

      const cleaned = [];
      mgr.addCleanupFunction(() => cleaned.push('done'));
      mgr.endServer('SIGTERM', []);

      assert.deepStrictEqual(cleaned, ['done']);
      assert.deepStrictEqual(exitCalls, [0]);
    });

    it('should stop each langManager in order before exiting', function(done) {
      const { mgr, exitCalls, restoreExit: re } = makeManager();
      restoreExit = re;

      const order = [];
      const fakeLangManagers = [
        { stopAll: () => { order.push('lm1'); return Promise.resolve(); }, getSupportedTypes: () => [] },
        { stopAll: () => { order.push('lm2'); return Promise.resolve(); }, getSupportedTypes: () => [] },
      ];

      // Override process.exit to verify order then call done
      process.exit = (code) => {
        exitCalls.push(code);
        assert.deepStrictEqual(order, ['lm1', 'lm2']);
        done();
      };

      mgr.endServer('SIGTERM', fakeLangManagers);
    });

    it('should continue to the next langManager if one rejects', function(done) {
      const { mgr, exitCalls, restoreExit: re } = makeManager();
      restoreExit = re;

      const order = [];
      const fakeLangManagers = [
        { stopAll: () => Promise.reject(new Error('stop failed')), getSupportedTypes: () => ['java'] },
        { stopAll: () => { order.push('lm2'); return Promise.resolve(); }, getSupportedTypes: () => [] },
      ];

      process.exit = (code) => {
        exitCalls.push(code);
        assert.deepStrictEqual(order, ['lm2']);
        done();
      };

      mgr.endServer('SIGTERM', fakeLangManagers);
    });

    it('should kill active child processes as part of endServer', async function() {
      const { mgr, restoreExit: re } = makeManager();
      restoreExit = re;

      mgr.spawn({ path: process.execPath, args: ['-e', 'setInterval(()=>{},60000)'] });
      const child = mgr.childProcesses[0];
      await waitForPid(child);

      mgr.endServer('SIGTERM', []);

      await waitForExit(child);
      assert.ok(child.killed);
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
