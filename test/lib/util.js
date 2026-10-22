const assert = require('assert');

describe('util', function () {
  let util;

  before(function () {
    try {
      util = require('../../lib/util');
    } catch (e) {
      console.warn('Could not load util module:', e.message);
      this.skip();
    }
  });

  describe('terminal destination checks', function () {
    describe('checkHostAccess without an allowList', function () {
      it('should deny everything, since nothing is listed', async function () {
        const hosts = ['8.8.8.8', '127.0.0.1', '::1', 'localhost', 'zos.example.com'];
        for (const list of [null, undefined, [], util.prepareAllowList([]), util.prepareAllowList(null)]) {
          for (const host of hosts) {
            assert.deepStrictEqual(await util.checkHostAccess(list, host), { allowed: false, addresses: null }, host);
          }
        }
      });

      it('should still permit everything when the caller passes ["*"] explicitly', async function () {
        assert.deepStrictEqual(await util.checkHostAccess(['*'], '8.8.8.8'), { allowed: true, addresses: null });
        assert.deepStrictEqual(await util.checkHostAccess(['*'], '127.0.0.1'), { allowed: true, addresses: null });
      });
    });

    describe('checkHostAccess with an allowList', function () {
      it('should permit anything when the list contains *', async function () {
        const result = await util.checkHostAccess(util.prepareAllowList(['*']), '127.0.0.1');
        assert.deepStrictEqual(result, { allowed: true, addresses: null });
      });

      it('should reject empty and non-string hosts, even when everything is permitted', async function () {
        const list = util.prepareAllowList(['*']);
        for (const host of ['', undefined, null, 42, { toLowerCase: () => '8.8.8.8' }]) {
          assert.strictEqual((await util.checkHostAccess(list, host)).allowed, false, String(host));
        }
      });

      it('should permit exact and wildcard names without pinning', async function () {
        const list = util.prepareAllowList(['zos.example.com', '*.corp.example.com']);
        assert.deepStrictEqual(await util.checkHostAccess(list, 'ZOS.example.com'), { allowed: true, addresses: null });
        assert.deepStrictEqual(await util.checkHostAccess(list, 'a.corp.example.com'), { allowed: true, addresses: null });
      });

      it('should permit literal addresses inside a listed subnet and pin them', async function () {
        const list = util.prepareAllowList(['10.1.0.0/16']);
        assert.deepStrictEqual(await util.checkHostAccess(list, '10.1.2.3'), { allowed: true, addresses: ['10.1.2.3'] });
      });

      it('should reject everything not listed, including loopback and public addresses', async function () {
        const list = util.prepareAllowList(['10.1.0.0/16', 'zos.example.com']);
        for (const host of ['127.0.0.1', '10.2.0.1', '8.8.8.8', 'localhost', '::1', 'no-such-host.invalid']) {
          assert.strictEqual((await util.checkHostAccess(list, host)).allowed, false, host);
        }
      });

      it('should reject legacy numeric forms, which getaddrinfo may turn into loopback', async function () {
        const list = util.prepareAllowList(['10.1.0.0/16']);
        for (const host of ['127.1', '0x7f.1', '0177.0.0.1']) {
          assert.strictEqual((await util.checkHostAccess(list, host)).allowed, false, host);
        }
      });

      it('should let an admin explicitly allow loopback', async function () {
        const list = util.prepareAllowList(['127.0.0.0/8']);
        assert.strictEqual((await util.checkHostAccess(list, '127.0.0.1')).allowed, true);
      });

      it('should reject hosts that are not valid hostnames, so they cannot slip past a wildcard entry', async function () {
        const list = util.prepareAllowList(['*.corp.example.com', '10.1.0.0/16']);
        //the resolver stops at the NUL, so these would otherwise connect to 127.0.0.1
        const malformed = ['localhost\u0000.corp.example.com', '127.0.0.1\u0000.corp.example.com',
          'localhost .corp.example.com', 'a/b.corp.example.com', 'a..corp.example.com', '-a.corp.example.com',
          'a-.corp.example.com', 'zös.corp.example.com', 'x'.repeat(64) + '.corp.example.com',
          '[::1]', '10.1.2.3\u0000'];
        for (const host of malformed) {
          assert.strictEqual((await util.checkHostAccess(list, host)).allowed, false, JSON.stringify(host));
          assert.strictEqual((await util.checkHostAccess(util.prepareAllowList(['*']), host)).allowed, false,
            JSON.stringify(host));
        }
      });

      it('should still accept valid hostnames and IP literals', async function () {
        const list = util.prepareAllowList(['*.corp.example.com', 'fe80::/10']);
        for (const host of ['a.corp.example.com', 'a_b.corp.example.com', 'a-1.corp.example.com',
          'x'.repeat(63) + '.corp.example.com']) {
          assert.deepStrictEqual(await util.checkHostAccess(list, host), { allowed: true, addresses: null }, host);
        }
        assert.strictEqual((await util.checkHostAccess(list, 'fe80::1%eth0')).allowed, false);
      });

      it('should reject IPv6 zone IDs, including ones matching a hostname wildcard', async function () {
        for (const list of [['*.corp.example.com'], ['*']]) {
          for (const host of ['::1%x.corp.example.com', '::ffff:127.0.0.1%x.corp.example.com', 'fe80::1%eth0']) {
            assert.strictEqual((await util.checkHostAccess(list, host)).allowed, false, host);
          }
        }
      });

      it('should not let a wildcard match legacy IPv4 spellings, which getaddrinfo reads as addresses', async function () {
        const cases = [
          ['*.1', ['127.1', '10.1', '127.1.']],
          ['*.0.0.1', ['0x7f.0.0.1', '0177.0.0.1']],
          ['*.0x1', ['0x7f.0x1']]
        ];
        for (const [entry, hosts] of cases) {
          const list = util.prepareAllowList([entry]);
          for (const host of hosts) {
            assert.strictEqual((await util.checkHostAccess(list, host)).allowed, false, `${entry} vs ${host}`);
          }
        }
      });

      it('should treat a trailing dot as the same name, in a wildcard entry and in the host', async function () {
        const list = util.prepareAllowList(['*.corp.invalid.']);
        assert.deepStrictEqual(list.wildcards, ['.corp.invalid']);
        for (const entries of [['*.corp.invalid.'], ['*.corp.invalid']]) {
          const prepared = util.prepareAllowList(entries);
          for (const host of ['a.corp.invalid', 'a.corp.invalid.']) {
            assert.deepStrictEqual(await util.checkHostAccess(prepared, host), { allowed: true, addresses: null },
              `${entries[0]} vs ${host}`);
          }
          //the suffix is only a match after a label boundary, and a second dot is not a valid name
          for (const host of ['corp.invalid', 'evilcorp.invalid', 'a.corp.invalid..']) {
            assert.strictEqual((await util.checkHostAccess(prepared, host)).allowed, false, `${entries[0]} vs ${host}`);
          }
        }
      });

      it('should skip and warn about entries with a * anywhere but a leading "*."', async function () {
        const warnings = [];
        const originalWarn = util.loggers.network.warn;
        util.loggers.network.warn = function (id, entry) { warnings.push([id, entry]); };
        let list;
        try {
          list = util.prepareAllowList(['host*.example.com', '*host.example.com', 'foo.*', '*.*.example.com',
            '*.good.example.com']);
        } finally {
          util.loggers.network.warn = originalWarn;
        }
        assert.deepStrictEqual(warnings.map(w => w[1]),
          ['host*.example.com', '*host.example.com', 'foo.*', '*.*.example.com']);
        assert.ok(warnings.every(w => w[0] === 'ZWED0191W'));
        assert.strictEqual(list.exact.size, 0);
        assert.deepStrictEqual(list.wildcards, ['.good.example.com']);
        assert.strictEqual((await util.checkHostAccess(list, 'a.good.example.com')).allowed, true);
      });

      it('should fail closed when the only entry is an invalid wildcard', async function () {
        const list = util.prepareAllowList(['host*.example.com']);
        assert.strictEqual(list.configured, true);
        assert.strictEqual((await util.checkHostAccess(list, 'host1.example.com')).allowed, false);
        assert.strictEqual((await util.checkHostAccess(list, '8.8.8.8')).allowed, false);
      });

      it('should reject empty or malformed wildcard suffixes with a warning', async function () {
        const invalid = ['*.', '*..', '*.bad..example.com', '*.-bad.example.com', '*.bad-.example.com',
          '*.bad name', '*.::1', '*.fe80::1%eth0', '*.' + 'x'.repeat(64) + '.example.com'];
        const warnings = [];
        const originalWarn = util.loggers.network.warn;
        util.loggers.network.warn = (id, entry) => warnings.push([id, entry]);
        let list;
        try {
          list = util.prepareAllowList(invalid);
        } finally {
          util.loggers.network.warn = originalWarn;
        }
        assert.deepStrictEqual(warnings, invalid.map(entry => ['ZWED0191W', entry]));
        assert.deepStrictEqual(list.wildcards, []);
        assert.strictEqual(list.permitAll, false);
        assert.strictEqual((await util.checkHostAccess(list, 'localhost.')).allowed, false);
      });

      it('should fail closed when every configured entry is invalid', async function () {
        const list = util.prepareAllowList(['10.0.0.0/99']);
        assert.strictEqual((await util.checkHostAccess(list, '8.8.8.8')).allowed, false);
        assert.strictEqual((await util.checkHostAccess(list, '10.0.0.1')).allowed, false);
      });
    });

    describe('makePinnedLookup', function () {
      it('should answer with only the vetted addresses', function (done) {
        const lookup = util.makePinnedLookup('rebound.example.com', ['8.8.8.8', '2001:4860:4860::8888']);
        lookup('rebound.example.com', { all: true }, function (err, list) {
          assert.ifError(err);
          assert.deepStrictEqual(list, [
            { address: '8.8.8.8', family: 4 },
            { address: '2001:4860:4860::8888', family: 6 }
          ]);
          lookup('rebound.example.com', {}, function (err, address, family) {
            assert.ifError(err);
            assert.strictEqual(address, '8.8.8.8');
            assert.strictEqual(family, 4);
            done();
          });
        });
      });

      it('should accept the (hostname, callback) signature', function (done) {
        util.makePinnedLookup('x', ['8.8.8.8'])('x', function (err, address, family) {
          assert.ifError(err);
          assert.strictEqual(address, '8.8.8.8');
          assert.strictEqual(family, 4);
          done();
        });
      });

      it('should match the pinned hostname case-insensitively', function (done) {
        util.makePinnedLookup('Host.Example.com', ['8.8.8.8'])('HOST.example.COM', {}, function (err, address) {
          assert.ifError(err);
          assert.strictEqual(address, '8.8.8.8');
          done();
        });
      });

      it('should refuse to answer for a hostname other than the one it was pinned to', function (done) {
        const lookup = util.makePinnedLookup('good.example.com', ['8.8.8.8']);
        lookup('evil.example.com', { all: true }, function (err, list) {
          assert.strictEqual(err.code, 'EPINNEDHOST');
          assert.strictEqual(list, undefined);
          lookup('evil.example.com', {}, function (err, address) {
            assert.strictEqual(err.code, 'EPINNEDHOST');
            assert.strictEqual(address, undefined);
            lookup(undefined, {}, function (err) {
              assert.strictEqual(err.code, 'EPINNEDHOST');
              done();
            });
          });
        });
      });

      it('should honor the requested address family', function (done) {
        const lookup = util.makePinnedLookup('h.example.com', ['8.8.8.8', '2001:4860:4860::8888']);
        lookup('h.example.com', { family: 6 }, function (err, address, family) {
          assert.ifError(err);
          assert.strictEqual(address, '2001:4860:4860::8888');
          assert.strictEqual(family, 6);
          lookup('h.example.com', { family: 'IPv4', all: true }, function (err, list) {
            assert.ifError(err);
            assert.deepStrictEqual(list, [{ address: '8.8.8.8', family: 4 }]);
            done();
          });
        });
      });

      it('should fail with ENOTFOUND when no approved address fits', function (done) {
        util.makePinnedLookup('h.example.com', ['8.8.8.8'])('h.example.com', { family: 6 }, function (err) {
          assert.strictEqual(err.code, 'ENOTFOUND');
          util.makePinnedLookup('h.example.com', [])('h.example.com', {}, function (err) {
            assert.strictEqual(err.code, 'ENOTFOUND');
            done();
          });
        });
      });
    });

    describe('ports', function () {
      it('should normalize numbers and decimal strings only', function () {
        assert.strictEqual(util.normalizePort(23), 23);
        assert.strictEqual(util.normalizePort('992'), 992);
        assert.strictEqual(util.normalizePort(65535), 65535);
        for (const bad of [0, -1, 65536, 1.5, NaN, '0x17', '23 ', ' 23', '1e1', '', '0', '99999', null, undefined, {}, [23], true]) {
          assert.strictEqual(util.normalizePort(bad), null, String(bad));
        }
      });

      it('should use the defaults when nothing is configured', function () {
        assert.deepStrictEqual(util.preparePortList(undefined, [22, 23]), [[22, 22], [23, 23]]);
        assert.deepStrictEqual(util.preparePortList([], [22, 23]), [[22, 22], [23, 23]]);
      });

      it('should accept integers, numeric strings and ranges', function () {
        const ports = util.preparePortList([23, '992', '2000-2005'], [22]);
        for (const p of [23, 992, 2000, 2003, 2005, '2001']) {
          assert.strictEqual(util.isPortInList(ports, p), true, String(p));
        }
        for (const p of [22, 24, 1999, 2006, 0, -1, 70000, 'abc', null]) {
          assert.strictEqual(util.isPortInList(ports, p), false, String(p));
        }
      });

      it('should deny everything, not fall back to defaults, when every configured entry is invalid', function () {
        const ports = util.preparePortList(['abc', '5-1', 0, 70000], [22, 23]);
        assert.deepStrictEqual(ports, []);
        assert.strictEqual(util.isPortInList(ports, 23), false);
      });
    });
  });
});
