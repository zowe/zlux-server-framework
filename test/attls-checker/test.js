/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const path   = require('path');
const fs     = require('fs');
const chai   = require('chai');
const expect = chai.expect;

const checker = require('../../utils/attlsChecker');
const {
  parseAttlsFile,
  parseZoweYaml,
  buildRequiredConnections,
  checkCoverage,
  summariseResults,
  findRulesAffectingExtensions,
  _internal,
} = checker;

// ── Fixture loader ────────────────────────────────────────────────────────────

const FIX = path.join(__dirname, 'fixtures');

function loadAttls(name) {
  return fs.readFileSync(path.join(FIX, name), 'utf8');
}

function loadYaml(name) {
  return fs.readFileSync(path.join(FIX, name), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// _internal.portRangeCoversPort
// ─────────────────────────────────────────────────────────────────────────────

describe('_internal.portRangeCoversPort', function () {
  const { portRangeCoversPort } = _internal;

  it('returns true for "ALL"', function () {
    expect(portRangeCoversPort('ALL', 7554)).to.be.true;
    expect(portRangeCoversPort('all', 80)).to.be.true;
  });

  it('returns true for exact single-port match', function () {
    expect(portRangeCoversPort('7554', 7554)).to.be.true;
  });

  it('returns false for exact single-port non-match', function () {
    expect(portRangeCoversPort('7554', 7553)).to.be.false;
  });

  it('returns true when port falls inside range', function () {
    expect(portRangeCoversPort('7552-7558', 7552)).to.be.true;
    expect(portRangeCoversPort('7552-7558', 7555)).to.be.true;
    expect(portRangeCoversPort('7552-7558', 7558)).to.be.true;
  });

  it('returns false when port is outside range', function () {
    expect(portRangeCoversPort('7552-7558', 7551)).to.be.false;
    expect(portRangeCoversPort('7552-7558', 7559)).to.be.false;
  });

  it('returns false for falsy portStr', function () {
    expect(portRangeCoversPort('', 7554)).to.be.false;
    expect(portRangeCoversPort(null, 7554)).to.be.false;
    expect(portRangeCoversPort(undefined, 7554)).to.be.false;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _internal.jobnameMatches
// ─────────────────────────────────────────────────────────────────────────────

describe('_internal.jobnameMatches', function () {
  const { jobnameMatches } = _internal;

  it('returns true for exact match (case-insensitive)', function () {
    expect(jobnameMatches('ZWE1AG', 'ZWE1AG')).to.be.true;
    expect(jobnameMatches('zwe1ag', 'ZWE1AG')).to.be.true;
  });

  it('returns false for exact non-match', function () {
    expect(jobnameMatches('ZWE1AG', 'ZWE1AC')).to.be.false;
  });

  it('matches with trailing wildcard', function () {
    expect(jobnameMatches('ZWE1*', 'ZWE1AG')).to.be.true;
    expect(jobnameMatches('ZWE1*', 'ZWE1CS')).to.be.true;
    expect(jobnameMatches('ZWE1A*', 'ZWE1AG')).to.be.true;
    expect(jobnameMatches('ZWE1A*', 'ZWE1AZ')).to.be.true;
  });

  it('does not match when wildcard prefix does not match', function () {
    expect(jobnameMatches('ZWE1A*', 'ZWE1CS')).to.be.false;
    expect(jobnameMatches('MYCICS*', 'ZWE1AG')).to.be.false;
  });

  it('returns true for empty / absent pattern (matches all)', function () {
    expect(jobnameMatches('', 'ZWE1AG')).to.be.true;
    expect(jobnameMatches(null, 'ZWE1AG')).to.be.true;
    expect(jobnameMatches(undefined, 'ZWE1AG')).to.be.true;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseAttlsFile
// ─────────────────────────────────────────────────────────────────────────────

describe('parseAttlsFile', function () {
  it('parses a minimal TTLSGroupAction declaration', function () {
    const content = `TTLSGroupAction MyGroup\n{\n  TTLSEnabled On\n}\n`;
    const { declarations } = parseAttlsFile(content);
    expect(declarations.has('MyGroup')).to.be.true;
    const decl = declarations.get('MyGroup');
    expect(decl.typeName).to.equal('TTLSGroupAction');
    expect(decl.props['TTLSEnabled']).to.equal('On');
  });

  it('strips comments before parsing', function () {
    const content = `# leading comment\nTTLSGroupAction Grp1\n{\n  TTLSEnabled On # inline\n}\n`;
    const { declarations } = parseAttlsFile(content);
    expect(declarations.has('Grp1')).to.be.true;
  });

  it('parses nested block without absorbing its outer block', function () {
    const content = [
      'TTLSGroupAction GrpOuter',
      '{',
      '  TTLSEnabled On',
      '}',
      'TTLSRule MyRule',
      '{',
      '  LocalPortRange 7554',
      '  Jobname ZWE1AG',
      '  Direction Inbound',
      '  Priority 100',
      '  TTLSGroupActionRef GrpOuter',
      '}',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    expect(declarations.has('GrpOuter')).to.be.true;
    expect(declarations.has('MyRule')).to.be.true;
    expect(declarations.get('MyRule').props['LocalPortRange']).to.equal('7554');
  });

  it('uses the first declaration when duplicate names appear', function () {
    const content = [
      'TTLSGroupAction Dup\n{\n  TTLSEnabled On\n}',
      'TTLSGroupAction Dup\n{\n  TTLSEnabled Off\n}',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    expect(declarations.get('Dup').props['TTLSEnabled']).to.equal('On');
  });

  it('preserves # embedded in a rule name (not treated as comment start)', function () {
    // AT-TLS policy files use '#' as a numbering convention in names like
    // "MyRule#2_Client".  The comment-stripper must only treat '#' as a
    // comment delimiter when it is at the start of the line or preceded by
    // whitespace, NOT when it is embedded in an identifier.
    const content = [
      'TTLSGroupAction Grp\n{\n  TTLSEnabled On\n}',
      'TTLSRule MyRule#1_Client\n{\n  Jobname AAA*\n  Direction Outbound\n  Priority 250\n  TTLSGroupActionRef Grp\n}',
      'TTLSRule MyRule#2_Client\n{\n  Jobname BBB*\n  Direction Outbound\n  Priority 250\n  TTLSGroupActionRef Grp\n}',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    expect(declarations.has('MyRule#1_Client')).to.be.true;
    expect(declarations.has('MyRule#2_Client')).to.be.true;
    expect(declarations.get('MyRule#1_Client').props['Jobname']).to.equal('AAA*');
    expect(declarations.get('MyRule#2_Client').props['Jobname']).to.equal('BBB*');
  });

  it('still strips a trailing inline comment separated by whitespace', function () {
    const content = 'TTLSGroupAction Grp\n{\n  TTLSEnabled On # this is a comment\n}\n';
    const { declarations } = parseAttlsFile(content);
    // TTLSEnabled value should not include "# this is a comment"
    expect(declarations.get('Grp').props['TTLSEnabled']).to.equal('On');
  });

  it('parses all declarations in attls-good-complete.txt', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-good-complete.txt'));
    expect(declarations.has('ZoweServerGroup')).to.be.true;
    expect(declarations.has('ZoweClientGroup')).to.be.true;
    expect(declarations.has('ZoweInboundMain')).to.be.true;
    expect(declarations.has('ZoweInboundInfinispan')).to.be.true;
    expect(declarations.has('ZoweOutboundInternal')).to.be.true;
    expect(declarations.has('ZoweOutboundZosmf')).to.be.true;
  });

  it('parses PortRange declarations from attls-good-portref.txt', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-good-portref.txt'));
    expect(declarations.has('zoweInboundPorts')).to.be.true;
    expect(declarations.get('zoweInboundPorts').typeName).to.equal('PortRange');
    expect(declarations.get('zoweInboundPorts').props['Port']).to.equal('7552-7558');
  });

  it('returns empty declarations for attls-bad-empty.txt (no TTLSRule)', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-bad-empty.txt'));
    // Should have non-TTLSRule declarations but zero TTLSRule entries
    let ruleCount = 0;
    for (const [, d] of declarations) if (d.typeName === 'TTLSRule') ruleCount++;
    expect(ruleCount).to.equal(0);
  });

  // ── Indented declarations ──────────────────────────────────────────────────
  // Some production AT-TLS files indent all stanzas (e.g. pagent_TTLS.conf.txt).
  // The parser must not silently drop such rules.

  it('parses declarations that are indented with leading spaces', function () {
    const content = [
      ' TTLSGroupAction IndentedGroup',
      ' {',
      '   TTLSEnabled On',
      ' }',
      ' TTLSRule IndentedRule',
      ' {',
      '   LocalPortRange 7554',
      '   Direction Inbound',
      '   Priority 100',
      '   TTLSGroupActionRef IndentedGroup',
      ' }',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    expect(declarations.has('IndentedGroup')).to.be.true;
    expect(declarations.has('IndentedRule')).to.be.true;
    expect(declarations.get('IndentedRule').props['LocalPortRange']).to.equal('7554');
  });

  it('parses declarations indented with tabs', function () {
    const content = '\tTTLSGroupAction TabGroup\n\t{\n\t  TTLSEnabled On\n\t}\n';
    const { declarations } = parseAttlsFile(content);
    expect(declarations.has('TabGroup')).to.be.true;
  });

  // ── Parse warnings ─────────────────────────────────────────────────────────

  it('returns empty parseWarnings for a well-formed file', function () {
    const { parseWarnings } = parseAttlsFile(loadAttls('attls-good-complete.txt'));
    expect(parseWarnings).to.have.length(0);
  });

  it('warns about bare "..." lines (unexpected syntax outside a block)', function () {
    const content = [
      'TTLSGroupAction Grp\n{\n  TTLSEnabled On\n}',
      '...',
      'TTLSRule MyRule\n{\n  LocalPortRange 7554\n  Direction Inbound\n  Priority 100\n  TTLSGroupActionRef Grp\n}',
    ].join('\n');
    const { declarations, parseWarnings } = parseAttlsFile(content);
    // The rule and group must still be parsed
    expect(declarations.has('MyRule')).to.be.true;
    expect(declarations.has('Grp')).to.be.true;
    // And we must get one unexpected-syntax warning for the "..." line
    const syntaxWarns = parseWarnings.filter(w => w.type === 'unexpected-syntax');
    expect(syntaxWarns).to.have.length(1);
    expect(syntaxWarns[0].content).to.equal('...');
  });

  it('warns for each unexpected-syntax line and records its line number', function () {
    // Use lines that cannot be mistaken for a TypeName ItemName declaration
    const content = 'TTLSGroupAction G\n{\n  TTLSEnabled On\n}\n???\n===section===\n';
    const { parseWarnings } = parseAttlsFile(content);
    const syntaxWarns = parseWarnings.filter(w => w.type === 'unexpected-syntax');
    expect(syntaxWarns).to.have.length(2);
    expect(syntaxWarns.map(w => w.content)).to.include.members(['???', '===section===']);
  });

  it('does not warn for blank lines outside blocks', function () {
    const content = 'TTLSGroupAction G\n{\n  TTLSEnabled On\n}\n\n\n';
    const { parseWarnings } = parseAttlsFile(content);
    expect(parseWarnings.filter(w => w.type === 'unexpected-syntax')).to.have.length(0);
  });

  // ── Invalid Jobname warnings ───────────────────────────────────────────────

  it('warns about Jobname patterns containing "." (regex/glob confusion)', function () {
    const content = [
      'TTLSGroupAction Grp\n{\n  TTLSEnabled On\n}',
      'TTLSRule BadJobname\n{\n  Jobname ZWE1AG.*\n  Direction Outbound\n  Priority 100\n  TTLSGroupActionRef Grp\n}',
    ].join('\n');
    const { parseWarnings } = parseAttlsFile(content);
    const jnWarns = parseWarnings.filter(w => w.type === 'invalid-jobname');
    expect(jnWarns).to.have.length(1);
    expect(jnWarns[0].rule).to.equal('BadJobname');
    expect(jnWarns[0].jobname).to.equal('ZWE1AG.*');
  });

  it('does not warn for valid Jobname patterns (ZWE*, ZWE1AG, ZWE1*)', function () {
    const content = [
      'TTLSGroupAction Grp\n{\n  TTLSEnabled On\n}',
      'TTLSRule R1\n{\n  Jobname ZWE*\n  Direction Outbound\n  Priority 100\n  TTLSGroupActionRef Grp\n}',
      'TTLSRule R2\n{\n  Jobname ZWE1AG\n  Direction Inbound\n  Priority 100\n  TTLSGroupActionRef Grp\n}',
    ].join('\n');
    const { parseWarnings } = parseAttlsFile(content);
    expect(parseWarnings.filter(w => w.type === 'invalid-jobname')).to.have.length(0);
  });

  it('warns for rules with no Jobname that would shadow via unexpected-syntax orphans', function () {
    // Regression: a rule with no Jobname is valid (matches any job) — should not warn
    const content = 'TTLSGroupAction G\n{\n  TTLSEnabled On\n}\nTTLSRule NoJobname\n{\n  Direction Inbound\n  Priority 100\n  TTLSGroupActionRef G\n}\n';
    const { parseWarnings } = parseAttlsFile(content);
    expect(parseWarnings.filter(w => w.type === 'invalid-jobname')).to.have.length(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseZoweYaml
// ─────────────────────────────────────────────────────────────────────────────

describe('parseZoweYaml', function () {
  it('reads serverAttls and no clientAttlsMismatches from zowe-full-attls.yaml', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-full-attls.yaml'));
    expect(cfg.serverAttls).to.be.true;
    // client.attls matches server.attls — no mismatches
    expect(cfg.clientAttlsMismatches).to.have.length(0);
  });

  it('reads job prefix and all 7 components from zowe-full-attls.yaml', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-full-attls.yaml'));
    expect(cfg.jobPrefix).to.equal('ZWE1');
    expect(cfg.enabledComponents).to.have.length(7);
  });

  it('reads infinispan ports from zowe-full-attls.yaml', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-full-attls.yaml'));
    expect(cfg.infinispanPorts).to.have.length(2);
    const ports = cfg.infinispanPorts.map(p => p.port);
    expect(ports).to.include(7600);
    expect(ports).to.include(7601);
  });

  it('reports serverAttls=false and no mismatches for zowe-attls-disabled.yaml', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-attls-disabled.yaml'));
    expect(cfg.serverAttls).to.be.false;
    // No client attls key in that fixture at all
    expect(cfg.clientAttlsMismatches).to.have.length(0);
  });

  it('reads custom prefix and ports from zowe-custom-ports.yaml', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-custom-ports.yaml'));
    expect(cfg.jobPrefix).to.equal('ZPRD');
    const gw = cfg.enabledComponents.find(c => c.id === 'gateway');
    expect(gw).to.exist;
    expect(gw.port).to.equal(8554);
    expect(gw.jobName).to.equal('ZPRDAG');
  });

  it('throws on invalid YAML', function () {
    expect(() => parseZoweYaml(': bad:\n  {{oops')).to.throw(/YAML parse error/);
  });

  it('reads z/OSMF port from zowe-custom-ports.yaml', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-custom-ports.yaml'));
    expect(cfg.zosmf.port).to.equal(10443);
  });

  it('reads zoweKeyring from SAF keyring URI in zowe-full-attls.yaml', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-full-attls.yaml'));
    expect(cfg.zoweKeyring).to.equal('ZOWE/ZOWE_RING');
  });

  it('reads zoweKeyring from custom-prefix yaml ZPRD/ZPRD_RING', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-custom-ports.yaml'));
    expect(cfg.zoweKeyring).to.equal('ZPRD/ZPRD_RING');
  });

  it('returns null zoweKeyring when no certificate section is present', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-attls-disabled.yaml'));
    expect(cfg.zoweKeyring).to.be.null;
  });

  it('detects single-service mode when components.apiml.enabled is true', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-apiml-single-service.yaml'));
    expect(cfg.apimlSingleService).to.be.true;
  });

  it('reports apimlSingleService=false for multi-service yaml', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-full-attls.yaml'));
    expect(cfg.apimlSingleService).to.be.false;
  });

  it('sets jobName to ${prefix}AG for all bundled APIML components in single-service mode', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-apiml-single-service.yaml'));
    const bundled = ['api-catalog', 'discovery', 'gateway', 'caching-service', 'zaas'];
    for (const id of bundled) {
      const c = cfg.enabledComponents.find(e => e.id === id);
      expect(c, `${id} should be in enabledComponents`).to.exist;
      expect(c.jobName, `${id} should run under ZWE1AG`).to.equal('ZWE1AG');
    }
  });

  it('keeps app-server and zss under their own jobs in single-service mode', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-apiml-single-service.yaml'));
    const app = cfg.enabledComponents.find(c => c.id === 'app-server');
    const zss = cfg.enabledComponents.find(c => c.id === 'zss');
    expect(app).to.exist;
    expect(app.jobName).to.equal('ZWE1DS');
    expect(zss).to.exist;
    expect(zss.jobName).to.equal('ZWE1SZ');
  });

  it('detects infinispan ports from caching-service config in single-service mode', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-apiml-single-service.yaml'));
    expect(cfg.infinispanPorts).to.have.length(2);
    const ports = cfg.infinispanPorts.map(p => p.port);
    expect(ports).to.include(7600);
    expect(ports).to.include(7601);
  });

  describe('per-component AT-TLS overrides', function () {
    let cfg;
    before(function () {
      cfg = parseZoweYaml(loadYaml('zowe-partial-attls.yaml'));
    });

    it('api-catalog has attls=false when components.api-catalog.zowe.network.server.tls.attls is false', function () {
      const ac = cfg.enabledComponents.find(c => c.id === 'api-catalog');
      expect(ac).to.exist;
      expect(ac.attls).to.be.false;
    });

    it('all other components inherit the global serverAttls=true', function () {
      const others = cfg.enabledComponents.filter(c => c.id !== 'api-catalog');
      for (const c of others) {
        expect(c.attls, `${c.id} should have attls=true`).to.be.true;
      }
    });

    it('records no clientAttlsMismatches when no client.attls key is set', function () {
      expect(cfg.clientAttlsMismatches).to.have.length(0);
    });
  });

  describe('client/server attls mismatch detection', function () {
    it('records a global mismatch when client.attls differs from server.attls', function () {
      const cfg = parseZoweYaml(loadYaml('zowe-server-attls-only.yaml'));
      expect(cfg.clientAttlsMismatches).to.have.length(1);
      expect(cfg.clientAttlsMismatches[0].context).to.equal('global (zowe.network)');
      expect(cfg.clientAttlsMismatches[0].serverAttls).to.be.true;
      expect(cfg.clientAttlsMismatches[0].clientAttls).to.be.false;
    });

    it('records no mismatch when client.attls matches server.attls', function () {
      const cfg = parseZoweYaml(loadYaml('zowe-full-attls.yaml'));
      expect(cfg.clientAttlsMismatches).to.have.length(0);
    });

    it('records no mismatch when client.attls is absent', function () {
      const cfg = parseZoweYaml(loadYaml('zowe-partial-attls.yaml'));
      expect(cfg.clientAttlsMismatches).to.have.length(0);
    });
  });

  // ─── Legacy AT-TLS (pre-v2.18.4): components.<id>.server.ssl.enabled: false ─

  describe('legacy AT-TLS detection (pre-v2.18.4: server.ssl.enabled: false)', function () {
    let cfg;
    before(function () {
      cfg = parseZoweYaml(loadYaml('zowe-legacy-attls.yaml'));
    });

    it('populates legacyAttlsComponents for each component using the old flag', function () {
      expect(cfg.legacyAttlsComponents).to.be.an('array');
      expect(cfg.legacyAttlsComponents).to.include('gateway');
      expect(cfg.legacyAttlsComponents).to.include('discovery');
      expect(cfg.legacyAttlsComponents).to.include('api-catalog');
      expect(cfg.legacyAttlsComponents).to.include('zaas');
      expect(cfg.legacyAttlsComponents).to.include('caching-service');
    });

    it('does not include app-server or zss in legacyAttlsComponents (they lack the flag)', function () {
      expect(cfg.legacyAttlsComponents).to.not.include('app-server');
      expect(cfg.legacyAttlsComponents).to.not.include('zss');
    });

    it('treats legacy components as attls=true', function () {
      for (const id of ['gateway', 'discovery', 'api-catalog', 'zaas', 'caching-service']) {
        const c = cfg.enabledComponents.find(e => e.id === id);
        expect(c, `component ${id} missing`).to.exist;
        expect(c.attls, `${id} should have attls=true`).to.be.true;
      }
    });

    it('leaves app-server and zss with attls=false (no legacy or new-style flag)', function () {
      const app = cfg.enabledComponents.find(e => e.id === 'app-server');
      const zss = cfg.enabledComponents.find(e => e.id === 'zss');
      expect(app.attls).to.be.false;
      expect(zss.attls).to.be.false;
    });

    it('returns legacyAttlsComponents=[] for a modern config (no ssl.enabled flag)', function () {
      const modernCfg = parseZoweYaml(loadYaml('zowe-full-attls.yaml'));
      expect(modernCfg.legacyAttlsComponents).to.have.length(0);
    });

    it('works with inline yaml: single old-style component produces legacyAttlsComponents entry', function () {
      const content = [
        'zowe:',
        '  job:',
        '    name: ZWE1SV',
        '    prefix: ZWE1',
        'components:',
        '  gateway:',
        '    enabled: true',
        '    port: 7554',
        '    server:',
        '      ssl:',
        '        enabled: false',
      ].join('\n');
      const c = parseZoweYaml(content);
      expect(c.legacyAttlsComponents).to.deep.equal(['gateway']);
      const gw = c.enabledComponents.find(e => e.id === 'gateway');
      expect(gw.attls).to.be.true;
    });

    it('new-style zowe.network.server.tls.attls takes precedence over legacy flag', function () {
      // If both old and new flags are present, the new-style value wins for attls,
      // but the component is still recorded in legacyAttlsComponents for the warning.
      const content = [
        'zowe:',
        '  job:',
        '    name: ZWE1SV',
        '    prefix: ZWE1',
        '  network:',
        '    server:',
        '      tls:',
        '        attls: true',
        'components:',
        '  gateway:',
        '    enabled: true',
        '    port: 7554',
        '    server:',
        '      ssl:',
        '        enabled: false',
        '  discovery:',
        '    enabled: true',
        '    port: 7553',
        '    zowe:',
        '      network:',
        '        server:',
        '          tls:',
        '            attls: false',
        '    server:',
        '      ssl:',
        '        enabled: false',
      ].join('\n');
      const c = parseZoweYaml(content);
      // gateway has legacy flag + global new-style=true → attls=true (global wins via fallback)
      const gw = c.enabledComponents.find(e => e.id === 'gateway');
      expect(gw.attls).to.be.true;
      // discovery has per-component new-style=false → attls=false (new-style takes precedence)
      const disc = c.enabledComponents.find(e => e.id === 'discovery');
      expect(disc.attls).to.be.false;
      // both should be in legacyAttlsComponents since they both have ssl.enabled: false
      expect(c.legacyAttlsComponents).to.include('gateway');
      expect(c.legacyAttlsComponents).to.include('discovery');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseZoweYaml — unknown/extension components
// ─────────────────────────────────────────────────────────────────────────────

describe('parseZoweYaml — unknown extension components', function () {
  it('collects enabled unknown components in unknownComponents', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-with-extension.yaml'));
    expect(cfg.unknownComponents).to.have.length(1);
    expect(cfg.unknownComponents[0].id).to.equal('widget');
    expect(cfg.unknownComponents[0].port).to.equal(7590);
  });

  it('does not include disabled unknown components', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-with-extension.yaml'));
    expect(cfg.unknownComponents.map(c => c.id)).to.not.include('foobar');
  });

  it('does not include portless unknown components', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-with-extension.yaml'));
    expect(cfg.unknownComponents.map(c => c.id)).to.not.include('noport');
  });

  it('returns an empty unknownComponents array when all components are known', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-full-attls.yaml'));
    expect(cfg.unknownComponents).to.have.length(0);
  });

  it('does not include "apiml" in unknownComponents (it is a deployment-mode flag)', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-apiml-single-service.yaml'));
    expect(cfg.unknownComponents.map(c => c.id)).to.not.include('apiml');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _internal.findRulesAffectingExtensions
// ─────────────────────────────────────────────────────────────────────────────

describe('_internal.findRulesAffectingExtensions', function () {
  const { findRulesAffectingExtensions } = _internal;
  // The widget extension component is on port 7590 (from zowe-with-extension.yaml).
  // ZoweInboundMain covers 7552-7558, ZoweOutboundInternal covers all outbound.
  // Port 7590 is NOT inside 7552-7558, but ZoweOutboundInternal has no LocalPortRange
  // restriction → resolves to 0-65535 → covers 7590.
  // We use port 7590 throughout so it matches the fixture intent.
  const EXT_PORTS = [7590];

  it('returns rules whose jobname pattern matches the extension probe job (ZWE1X*) AND cover an extension port', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-good-complete.txt'));
    const rules = findRulesAffectingExtensions(declarations, 'ZWE1', EXT_PORTS);
    const names = rules.map(r => r.name);
    // ZoweOutboundInternal: Jobname ZWE1*, no LocalPortRange → covers all ports → matches
    expect(names).to.include('ZoweOutboundInternal');
  });

  it('excludes rules whose port range does not cover any extension port', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-good-complete.txt'));
    const rules = findRulesAffectingExtensions(declarations, 'ZWE1', EXT_PORTS);
    const names = rules.map(r => r.name);
    // ZoweInboundMain covers 7552-7558 — port 7590 is outside that range
    expect(names).to.not.include('ZoweInboundMain');
    // ZoweInboundInfinispan: Jobname ZWE1CS — already excluded by jobname; port 7590 outside 7600-7601 too
    expect(names).to.not.include('ZoweInboundInfinispan');
  });

  it('does not return rules with specific jobname patterns that cannot match ZWE1X*', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-good-complete.txt'));
    const rules = findRulesAffectingExtensions(declarations, 'ZWE1', [443]);
    const names = rules.map(r => r.name);
    // ZoweOutboundZosmf uses Jobname ZWE1A* — cannot match ZWE1XEXT
    expect(names).to.not.include('ZoweOutboundZosmf');
  });

  it('returns an empty array when no rules exist', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-bad-empty.txt'));
    const rules = findRulesAffectingExtensions(declarations, 'ZWE1', EXT_PORTS);
    expect(rules).to.have.length(0);
  });

  it('returns an empty array when extensionPorts is empty', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-good-complete.txt'));
    expect(findRulesAffectingExtensions(declarations, 'ZWE1', [])).to.have.length(0);
    expect(findRulesAffectingExtensions(declarations, 'ZWE1')).to.have.length(0);
  });

  it('includes correct ttlsEnabled status for each rule', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-good-complete.txt'));
    const rules = findRulesAffectingExtensions(declarations, 'ZWE1', EXT_PORTS);
    for (const r of rules) {
      expect(r.ttlsEnabled).to.be.a('boolean');
    }
  });

  it('returns Off rules too — detects when extension jobs are explicitly disabled', function () {
    // attls-bad-partial-shadow.txt: ZoweOffGatewayZaasAppServer has Jobname ZWE1* +
    // LocalPortRange 7554/7556/7558 — none of which are 7590, so it won't match.
    // ZoweInboundBroad covers 7552-7558 which also doesn't include 7590.
    // ZoweOutboundInternal (no local port restriction) WILL match.
    const { declarations } = parseAttlsFile(loadAttls('attls-bad-partial-shadow.txt'));
    const rules = findRulesAffectingExtensions(declarations, 'ZWE1', EXT_PORTS);
    // The Off rule for 7554/7556/7558 should NOT appear for port 7590
    const offRule = rules.find(r => r.name === 'ZoweOffGatewayZaasAppServer');
    expect(offRule).to.be.undefined;
    // But a broad outbound On rule (ZoweOutboundInternal) should appear
    const outbound = rules.find(r => r.name === 'ZoweOutboundInternal');
    expect(outbound).to.exist;
    expect(outbound.ttlsEnabled).to.be.true;
  });

  it('correctly finds an Off rule when it covers the extension port', function () {
    // Build a synthetic rule set: ZWE1* Off rule on port 7590 (the extension port)
    const content = [
      'TTLSGroupAction OffGrp\n{\n  TTLSEnabled Off\n}',
      'TTLSRule WideOff\n{\n  LocalPortRange 7580-7600\n  Jobname ZWE1*\n  Direction Inbound\n  Priority 100\n  TTLSGroupActionRef OffGrp\n}',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    const rules = findRulesAffectingExtensions(declarations, 'ZWE1', [7590]);
    expect(rules).to.have.length(1);
    expect(rules[0].name).to.equal('WideOff');
    expect(rules[0].ttlsEnabled).to.be.false;
  });

  it('resolves LocalPortGroupRef — excludes rules whose PortGroup does not cover the extension port', function () {
    // TN3270-style rule: LocalPortGroupRef covers only 992, 3270, 23, etc.
    // Extension is on port 7590 — none of those match; rule should be excluded.
    const content = [
      'TTLSGroupAction OnGrp\n{\n  TTLSEnabled On\n}',
      'PortGroup TN3270_ports\n{\n  PortRange\n  {\n    Port 992\n  }\n  PortRange\n  {\n    Port 3270\n  }\n  PortRange\n  {\n    Port 23\n  }\n}',
      'TTLSRule TN3270Rule\n{\n  LocalAddr ALL\n  RemoteAddr ALL\n  LocalPortGroupRef TN3270_ports\n  Jobname ZWE1*\n  Direction Inbound\n  Priority 255\n  TTLSGroupActionRef OnGrp\n}',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    const rules = findRulesAffectingExtensions(declarations, 'ZWE1', [7590]);
    // TN3270 ports (992, 3270, 23) do not include 7590 → should be excluded
    expect(rules.map(r => r.name)).to.not.include('TN3270Rule');
  });

  it('resolves LocalPortGroupRef — includes rules whose PortGroup covers the extension port', function () {
    const content = [
      'TTLSGroupAction OnGrp\n{\n  TTLSEnabled On\n}',
      'PortGroup ExtPorts\n{\n  PortRange\n  {\n    Port 7580-7600\n  }\n}',
      'TTLSRule ExtRule\n{\n  LocalAddr ALL\n  LocalPortGroupRef ExtPorts\n  Jobname ZWE1*\n  Direction Inbound\n  Priority 100\n  TTLSGroupActionRef OnGrp\n}',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    const rules = findRulesAffectingExtensions(declarations, 'ZWE1', [7590]);
    expect(rules.map(r => r.name)).to.include('ExtRule');
    // localPortRange should show the resolved ports, not 'all'
    expect(rules[0].localPortRange).to.equal('7580-7600');
  });

  it('shows resolved port ranges in localPortRange field (not raw "all" for group refs)', function () {
    const content = [
      'TTLSGroupAction OnGrp\n{\n  TTLSEnabled On\n}',
      'PortRange MyRange\n{\n  Port 7590\n}',
      'TTLSRule RefRule\n{\n  LocalPortRangeRef MyRange\n  Jobname ZWE1*\n  Direction Inbound\n  Priority 100\n  TTLSGroupActionRef OnGrp\n}',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    const rules = findRulesAffectingExtensions(declarations, 'ZWE1', [7590]);
    expect(rules).to.have.length(1);
    expect(rules[0].localPortRange).to.equal('7590');
  });

  it('includes direction and localPortRange fields', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-good-complete.txt'));
    const rules = findRulesAffectingExtensions(declarations, 'ZWE1', EXT_PORTS);
    const outbound = rules.find(r => r.name === 'ZoweOutboundInternal');
    expect(outbound).to.exist;
    expect(outbound.direction).to.equal('Outbound');
  });

  it('works with a different jobPrefix (ZPRD)', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-good-complete.txt'));
    const rules = findRulesAffectingExtensions(declarations, 'ZPRD', EXT_PORTS);
    expect(rules).to.have.length(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildRequiredConnections
// ─────────────────────────────────────────────────────────────────────────────

describe('buildRequiredConnections', function () {
  it('returns empty array when both attls flags are false', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-attls-disabled.yaml'));
    expect(buildRequiredConnections(cfg)).to.have.length(0);
  });

  it('generates outbound entries even when the (deprecated) client.attls=false, because server.attls=true wins', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-server-attls-only.yaml'));
    const required = buildRequiredConnections(cfg);
    // server.attls=true means ALL components have attls=true — outbound is required
    const outbound = required.filter(r => r.direction === 'Outbound');
    expect(outbound.length).to.be.greaterThan(0);
    // A mismatch should be recorded
    expect(cfg.clientAttlsMismatches).to.have.length.greaterThan(0);
  });

  it('returns both inbound and outbound entries for fully-enabled config', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-full-attls.yaml'));
    const required = buildRequiredConnections(cfg);
    const inbound  = required.filter(r => r.direction === 'Inbound');
    const outbound = required.filter(r => r.direction === 'Outbound');
    expect(inbound.length).to.be.greaterThan(0);
    expect(outbound.length).to.be.greaterThan(0);
  });

  it('includes infinispan inbound entries when infinispan ports are configured', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-full-attls.yaml'));
    const required = buildRequiredConnections(cfg);
    const infPorts = required.filter(r => r.id.includes('caching-'));
    expect(infPorts.length).to.be.greaterThan(0);
  });

  it('does not include infinispan entries when no jgroups ports are configured', function () {
    // zowe-server-attls-only.yaml has no infinispan ports
    const cfg = parseZoweYaml(loadYaml('zowe-server-attls-only.yaml'));
    const required = buildRequiredConnections(cfg);
    const infPorts = required.filter(r => r.id.includes('caching-jgroups') || r.id.includes('caching-keyExchange'));
    expect(infPorts).to.have.length(0);
  });

  it('includes z/OSMF outbound entry for custom port', function () {
    const cfg = parseZoweYaml(loadYaml('zowe-custom-ports.yaml'));
    const required = buildRequiredConnections(cfg);
    const zosmf = required.filter(r => r.id.includes('zosmf'));
    expect(zosmf.length).to.be.greaterThan(0);
    expect(zosmf[0].port).to.equal(10443);
  });

  describe('per-component AT-TLS override: api-catalog disabled', function () {
    let cfg, required;
    before(function () {
      cfg      = parseZoweYaml(loadYaml('zowe-partial-attls.yaml'));
      required = buildRequiredConnections(cfg);
    });

    it('omits inbound:api-catalog because api-catalog has attls=false', function () {
      expect(required.find(r => r.id === 'inbound:api-catalog')).to.be.undefined;
    });

    it('still includes inbound entries for all other enabled components', function () {
      const ids = required.map(r => r.id);
      expect(ids).to.include('inbound:gateway');
      expect(ids).to.include('inbound:discovery');
      expect(ids).to.include('inbound:app-server');
      expect(ids).to.include('inbound:zss');
      expect(ids).to.include('inbound:zaas');
      expect(ids).to.include('inbound:caching-service');
    });

    it('still includes outbound entries (all non-api-catalog sources have attls=true)', function () {
      const outbound = required.filter(r => r.direction === 'Outbound');
      expect(outbound.length).to.be.greaterThan(0);
    });

    it('excludes api-catalog from the discovery registrants list (no outbound:ZWE1AC→discovery)', function () {
      // api-catalog has attls=false so it is not a registrant that needs an AT-TLS outbound rule
      expect(required.find(r => r.id === 'outbound:ZWE1AC→discovery')).to.be.undefined;
    });
  });

  describe('single-service mode (components.apiml.enabled: true)', function () {
    let cfg, required;
    before(function () {
      cfg      = parseZoweYaml(loadYaml('zowe-apiml-single-service.yaml'));
      required = buildRequiredConnections(cfg);
    });

    it('generates no inbound entry for api-catalog, caching-service, or zaas', function () {
      const ids = required.map(r => r.id);
      expect(ids).to.not.include('inbound:api-catalog');
      expect(ids).to.not.include('inbound:caching-service');
      expect(ids).to.not.include('inbound:zaas');
    });

    it('generates inbound entries for discovery and gateway (both ZWE1AG)', function () {
      const disc = required.find(r => r.id === 'inbound:discovery');
      const gw   = required.find(r => r.id === 'inbound:gateway');
      expect(disc).to.exist;
      expect(disc.candidates[0]).to.equal('ZWE1AG');
      expect(gw).to.exist;
      expect(gw.candidates[0]).to.equal('ZWE1AG');
    });

    it('generates inbound entries for app-server (ZWE1SV in cluster mode) and zss (ZWE1SZ)', function () {
      const app = required.find(r => r.id === 'inbound:app-server');
      const zss = required.find(r => r.id === 'inbound:zss');
      expect(app).to.exist;
      // zowe-apiml-single-service.yaml has no ZLUX_NO_CLUSTER — cluster mode is
      // enabled by default, so the STC (ZWE1SV) holds the inbound socket.
      expect(app.candidates[0]).to.equal('ZWE1SV');
      expect(zss).to.exist;
      expect(zss.candidates[0]).to.equal('ZWE1SZ');
    });

    it('generates inbound entries for infinispan ports (ZWE1AG)', function () {
      const inf = required.filter(r => r.id.startsWith('inbound:caching-'));
      expect(inf).to.have.length(2);
      expect(inf[0].candidates[0]).to.equal('ZWE1AG');
    });

    it('generates no cross-APIML outbound entries (gw→zaas, zaas→gw, →caching)', function () {
      const ids = required.map(r => r.id);
      // No cross-service APIML calls — they are all in-process in single-service mode
      expect(ids).to.not.include('outbound:gw→zaas');
      expect(ids).to.not.include('outbound:zaas→gw');
      expect(ids.some(id => id.includes('→caching'))).to.be.false;
    });

    it('generates outbound entries for discovery, app-server, zss, z/OSMF, infinispan', function () {
      const ids = required.map(r => r.id);
      expect(ids).to.include('outbound:ag→discovery');
      expect(ids).to.include('outbound:ag→appserver');
      expect(ids).to.include('outbound:ag→zss');
      expect(ids).to.include('outbound:gw/zaas→zosmf');
      expect(ids.some(id => id.startsWith('outbound:caching-'))).to.be.true;
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _internal.findBestRule
// ─────────────────────────────────────────────────────────────────────────────

describe('_internal.findBestRule', function () {
  const { findBestRule } = _internal;

  it('finds enabled rule for matching port + jobname', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-good-complete.txt'));
    const r = findBestRule(declarations, 'Inbound', 7554, 'ZWE1AG');
    expect(r.covered).to.be.true;
    expect(r.warn).to.be.false;
    expect(r.shadower).to.be.null;
  });

  it('returns covered=false when no rule matches', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-bad-empty.txt'));
    const r = findBestRule(declarations, 'Inbound', 7554, 'ZWE1AG');
    expect(r.covered).to.be.false;
  });

  it('detects shadowing: high-priority Off rule over lower-priority On rule', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-bad-priority-shadow.txt'));
    // GatewayShadow (priority 200, Off) shadows ZoweInboundMain (priority 100, On) for port 7554
    const r = findBestRule(declarations, 'Inbound', 7554, 'ZWE1AG');
    expect(r.covered).to.be.false;
    expect(r.warn).to.be.true;
    expect(r.shadower).to.exist;
    expect(r.shadower.name).to.equal('GatewayShadow');
  });

  it('does not flag shadowing when Off rule has lower priority than On rule', function () {
    // Build a synthetic scenario: On at priority 200, Off at priority 100
    const content = [
      'TTLSGroupAction OnGroup\n{\n  TTLSEnabled On\n}',
      'TTLSGroupAction OffGroup\n{\n  TTLSEnabled Off\n}',
      'TTLSRule HighPriorityOn\n{\n  LocalPortRange 7554\n  Jobname ZWE1AG\n  Direction Inbound\n  Priority 200\n  TTLSGroupActionRef OnGroup\n}',
      'TTLSRule LowPriorityOff\n{\n  LocalPortRange 7554\n  Jobname ZWE1AG\n  Direction Inbound\n  Priority 100\n  TTLSGroupActionRef OffGroup\n}',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    const r = findBestRule(declarations, 'Inbound', 7554, 'ZWE1AG');
    expect(r.covered).to.be.true;
    expect(r.warn).to.be.false;
  });

  it('returns covered=false when only rule has wrong direction', function () {
    const content = [
      'TTLSGroupAction Grp\n{\n  TTLSEnabled On\n}',
      'TTLSRule OutRule\n{\n  LocalPortRange 7554\n  Direction Outbound\n  Priority 100\n  TTLSGroupActionRef Grp\n}',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    const r = findBestRule(declarations, 'Inbound', 7554, 'ZWE1AG');
    expect(r.covered).to.be.false;
  });

  it('outbound: skips rule whose LocalPortRange excludes ephemeral ports', function () {
    // A rule with LocalPortRange 1245 only makes sense for a server that
    // listens on port 1245.  Zowe processes connect OUTBOUND using ephemeral
    // source ports (~1024+), so this rule can never apply and must be ignored.
    const content = [
      'TTLSGroupAction Grp\n{\n  TTLSEnabled On\n}',
      // This rule restricts source port to 1245 — cannot match ephemeral source
      'TTLSRule ServerRule\n{\n  LocalPortRange 1245\n  RemotePortRange 1024-65535\n  Direction Both\n  Priority 249\n  TTLSGroupActionRef Grp\n}',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    const r = findBestRule(declarations, 'Outbound', 7553, 'ZWE1AG');
    expect(r.covered).to.be.false;
  });

  it('outbound: prefers specific ZWE* rule over generic lower-priority rule with restricted LocalPort', function () {
    // Simulates the real-world scenario where a broad "Both" direction rule
    // has a lower priority than a correct ZWE*-specific outbound rule, but
    // the broad rule also restricts LocalPort to non-ephemeral values.
    const content = [
      'TTLSGroupAction Grp\n{\n  TTLSEnabled On\n}',
      // Lower priority, LocalPort restricted to 1245 — must be excluded from outbound
      'TTLSRule BroadBothRule\n{\n  LocalPortRange 1245\n  RemotePortRange 1024-65535\n  Direction Both\n  Priority 249\n  TTLSGroupActionRef Grp\n}',
      // Higher priority, correct ZWE* outbound rule with no LocalPort restriction
      'TTLSRule ZweOutboundRule\n{\n  RemotePortRange 1024-65535\n  Jobname ZWE*\n  Direction Outbound\n  Priority 250\n  TTLSGroupActionRef Grp\n}',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    const r = findBestRule(declarations, 'Outbound', 7553, 'ZWE1AG');
    expect(r.covered).to.be.true;
    expect(r.rule.name).to.equal('ZweOutboundRule');
  });

  it('outbound: unconstrained LocalPortRange (0-65535) passes ephemeral check', function () {
    const content = [
      'TTLSGroupAction Grp\n{\n  TTLSEnabled On\n}',
      'TTLSRule OpenRule\n{\n  LocalPortRange 0-65535\n  RemotePortRange 7553\n  Jobname ZWE*\n  Direction Outbound\n  Priority 100\n  TTLSGroupActionRef Grp\n}',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    const r = findBestRule(declarations, 'Outbound', 7553, 'ZWE1AG');
    expect(r.covered).to.be.true;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _internal.normalizeZoweKeyring
// ─────────────────────────────────────────────────────────────────────────────

describe('_internal.normalizeZoweKeyring', function () {
  const { normalizeZoweKeyring } = _internal;

  it('normalizes safkeyring://OWNER/RING to OWNER/RING (upper-cased)', function () {
    expect(normalizeZoweKeyring('safkeyring://ZWESVUSR/ZWERING')).to.equal('ZWESVUSR/ZWERING');
  });

  it('normalizes lower-case URI and upper-cases result', function () {
    expect(normalizeZoweKeyring('safkeyring://zowe/zowe_ring')).to.equal('ZOWE/ZOWE_RING');
  });

  it('handles double-slash form safkeyring:////OWNER/RING', function () {
    expect(normalizeZoweKeyring('safkeyring:////ZWESVUSR/ZWERING')).to.equal('ZWESVUSR/ZWERING');
  });

  it('returns null for a PKCS12 path', function () {
    expect(normalizeZoweKeyring('/var/zowe/keystore/zowe.p12')).to.be.null;
  });

  it('returns null for empty string', function () {
    expect(normalizeZoweKeyring('')).to.be.null;
  });

  it('returns null for null/undefined', function () {
    expect(normalizeZoweKeyring(null)).to.be.null;
    expect(normalizeZoweKeyring(undefined)).to.be.null;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _internal.resolveKeyringForRule
// ─────────────────────────────────────────────────────────────────────────────

describe('_internal.resolveKeyringForRule', function () {
  const { resolveKeyringForRule } = _internal;

  it('resolves keyring via full chain: rule → env action → keyring parms', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-good-complete.txt'));
    const ruleDecl = declarations.get('ZoweInboundMain');
    expect(ruleDecl).to.exist;
    const keyring = resolveKeyringForRule(declarations, ruleDecl);
    expect(keyring).to.equal('ZOWE/ZOWE_RING');
  });

  it('resolves wrong keyring in attls-bad-wrong-keyring.txt', function () {
    const { declarations } = parseAttlsFile(loadAttls('attls-bad-wrong-keyring.txt'));
    const ruleDecl = declarations.get('ZoweInboundMain');
    expect(ruleDecl).to.exist;
    const keyring = resolveKeyringForRule(declarations, ruleDecl);
    expect(keyring).to.equal('WRONG/KEYRING');
  });

  it('returns null when rule has no TTLSEnvironmentActionRef', function () {
    const content = [
      'TTLSGroupAction Grp\n{\n  TTLSEnabled On\n}',
      'TTLSRule NoEnvRule\n{\n  LocalPortRange 7554\n  Direction Inbound\n  TTLSGroupActionRef Grp\n}',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    const ruleDecl = declarations.get('NoEnvRule');
    expect(resolveKeyringForRule(declarations, ruleDecl)).to.be.null;
  });

  it('returns null when the referenced env action has no TTLSKeyringParmsRef', function () {
    const content = [
      'TTLSGroupAction Grp\n{\n  TTLSEnabled On\n}',
      'TTLSEnvironmentAction EnvNoKeyring\n{\n  HandshakeRole Server\n}',
      'TTLSRule RuleNoKeyring\n{\n  LocalPortRange 7554\n  Direction Inbound\n  TTLSGroupActionRef Grp\n  TTLSEnvironmentActionRef EnvNoKeyring\n}',
    ].join('\n');
    const { declarations } = parseAttlsFile(content);
    const ruleDecl = declarations.get('RuleNoKeyring');
    expect(resolveKeyringForRule(declarations, ruleDecl)).to.be.null;
  });

  it('returns null for null ruleDecl', function () {
    const { declarations } = parseAttlsFile('');
    expect(resolveKeyringForRule(declarations, null)).to.be.null;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _internal.keyringMatches
// ─────────────────────────────────────────────────────────────────────────────

describe('_internal.keyringMatches', function () {
  const { keyringMatches } = _internal;

  it('matches when both are identical fully-qualified values', function () {
    expect(keyringMatches('ZOWE/ZOWE_RING', 'ZOWE/ZOWE_RING')).to.be.true;
  });

  it('matches when rule uses ring-only (no owner) and names are equal', function () {
    expect(keyringMatches('ZOWE_RING', 'ZOWE/ZOWE_RING')).to.be.true;
  });

  it('matches when ring-only value equals ring portion of a multi-segment zoweKeyring', function () {
    expect(keyringMatches('ZOWESSL', 'ZWESTCU/ZOWESSL')).to.be.true;
  });

  it('does not match when ring names differ', function () {
    expect(keyringMatches('WRONG_RING', 'ZOWE/ZOWE_RING')).to.be.false;
  });

  it('does not match when fully-qualified values differ', function () {
    expect(keyringMatches('OTHER/ZOWE_RING', 'ZOWE/ZOWE_RING')).to.be.false;
  });

  it('does not match when owner differs even if ring name is same', function () {
    expect(keyringMatches('BADOWNER/ZOWE_RING', 'ZOWE/ZOWE_RING')).to.be.false;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkCoverage + summariseResults — scenario-level tests
// ─────────────────────────────────────────────────────────────────────────────

describe('checkCoverage scenarios', function () {

  // Helper to run a scenario end-to-end
  function run(attlsFile, yamlFile) {
    const { declarations } = parseAttlsFile(loadAttls(attlsFile));
    const zoweConfig        = parseZoweYaml(loadYaml(yamlFile));
    const results           = checkCoverage(declarations, zoweConfig);
    return { results, summary: summariseResults(results) };
  }

  // ── AT-TLS disabled ─────────────────────────────────────────────────────────

  describe('AT-TLS disabled in zowe.yaml', function () {
    it('reports zero required connections when attls is disabled', function () {
      const { summary } = run('attls-good-complete.txt', 'zowe-attls-disabled.yaml');
      expect(summary.total).to.equal(0);
      expect(summary.miss).to.equal(0);
    });
  });

  // ── Good scenarios ──────────────────────────────────────────────────────────

  describe('Good: complete coverage (inline port ranges)', function () {
    it('has no misses and no warnings', function () {
      const { summary } = run('attls-good-complete.txt', 'zowe-full-attls.yaml');
      expect(summary.miss).to.equal(0);
      expect(summary.warn).to.equal(0);
      expect(summary.ok).to.equal(summary.total);
    });
  });

  describe('Good: complete coverage via PortRange references', function () {
    it('resolves PortRange refs and finds no misses', function () {
      const { summary } = run('attls-good-portref.txt', 'zowe-full-attls.yaml');
      expect(summary.miss).to.equal(0);
      expect(summary.warn).to.equal(0);
    });
  });

  describe('Good: inbound-only policy with server-only zowe.yaml', function () {
    it('covers inbound requirements (outbound also required since server.attls=true→all components attls=true)', function () {
      // With the new model, client.attls is deprecated and server.attls drives
      // both inbound and outbound AT-TLS.  zowe-server-attls-only.yaml has
      // server.attls=true so outbound rules are still needed.
      // attls-good-inbound-only.txt only has inbound rules so outbound will miss.
      const { summary, results } = run('attls-good-inbound-only.txt', 'zowe-server-attls-only.yaml');
      const inboundMisses = results.filter(r => r.direction === 'Inbound' && r.status === 'miss');
      expect(inboundMisses).to.have.length(0);
      // Some outbound connections will miss (no client.attls workaround anymore)
      const outboundMisses = results.filter(r => r.direction === 'Outbound' && r.status === 'miss');
      expect(outboundMisses.length).to.be.greaterThan(0);
    });
  });

  describe('Good: custom port prefix and ports', function () {
    it('covers all ZPRD* requirements on custom ports', function () {
      const { summary } = run('attls-good-custom-ports.txt', 'zowe-custom-ports.yaml');
      expect(summary.miss).to.equal(0);
      expect(summary.warn).to.equal(0);
    });
  });

  // ── Bad scenarios ───────────────────────────────────────────────────────────

  describe('Bad: missing inbound rules for most components', function () {
    it('reports misses for uncovered inbound connections', function () {
      const { summary } = run('attls-bad-missing-inbound.txt', 'zowe-full-attls.yaml');
      expect(summary.miss).to.be.greaterThan(0);
      // discovery(7553), caching(7555), app-server(7556), zss(7557), zaas(7558),
      // infinispan(7600), infinispan(7601) should all be missed inbound
      expect(summary.missed.some(id => id.startsWith('inbound:'))).to.be.true;
    });

    it('does not report misses for the two covered inbound ports (7552, 7554)', function () {
      const { results } = run('attls-bad-missing-inbound.txt', 'zowe-full-attls.yaml');
      const apiCatalogInbound = results.find(r => r.id === 'inbound:api-catalog');
      const gatewayInbound    = results.find(r => r.id === 'inbound:gateway');
      expect(apiCatalogInbound && apiCatalogInbound.status).to.equal('ok');
      expect(gatewayInbound    && gatewayInbound.status   ).to.equal('ok');
    });
  });

  describe('Bad: no outbound rules', function () {
    it('reports misses for all outbound connections', function () {
      const { summary } = run('attls-bad-missing-outbound.txt', 'zowe-full-attls.yaml');
      expect(summary.miss).to.be.greaterThan(0);
      expect(summary.missed.every(id => id.startsWith('outbound:'))).to.be.true;
    });

    it('has no inbound misses (inbound rules are complete)', function () {
      const { results } = run('attls-bad-missing-outbound.txt', 'zowe-full-attls.yaml');
      const inboundMisses = results.filter(r => r.id.startsWith('inbound:') && r.status === 'miss');
      expect(inboundMisses).to.have.length(0);
    });
  });

  describe('Bad: priority shadowing disables AT-TLS for gateway', function () {
    it('produces a warn entry for the gateway inbound connection', function () {
      const { summary, results } = run('attls-bad-priority-shadow.txt', 'zowe-full-attls.yaml');
      expect(summary.warn).to.be.greaterThan(0);
      const gwInbound = results.find(r => r.id === 'inbound:gateway');
      expect(gwInbound).to.exist;
      expect(gwInbound.status).to.equal('warn');
      expect(gwInbound.shadower).to.exist;
    });

    it('still marks other inbound connections as ok', function () {
      const { results } = run('attls-bad-priority-shadow.txt', 'zowe-full-attls.yaml');
      const apiCatalog = results.find(r => r.id === 'inbound:api-catalog');
      expect(apiCatalog && apiCatalog.status).to.equal('ok');
    });
  });

  describe('Bad: broad low-priority On rule partially overridden by specific high-priority Off rule', function () {
    // This is the "I thought my broad rule covered everything" mistake.
    // A broad On rule at priority 100 covers all Zowe ports, but a specific Off
    // rule at priority 200 punches holes in it for gateway (7554), app-server
    // (7556), and ZAAS (7558).  Ports NOT covered by the Off rule (api-catalog,
    // discovery, caching-service, zss) remain ok.
    let results;
    before(function () {
      results = run('attls-bad-partial-shadow.txt', 'zowe-full-attls.yaml').results;
    });

    it('reports warn for gateway inbound (7554) — Off rule at priority 200 shadows On rule', function () {
      const r = results.find(r => r.id === 'inbound:gateway');
      expect(r).to.exist;
      expect(r.status).to.equal('warn');
      expect(r.warnReasons).to.include('shadow');
      expect(r.shadower).to.exist;
      expect(r.shadower.name).to.equal('ZoweOffGatewayZaasAppServer');
    });

    it('reports warn for app-server inbound (7556) — Off rule matches ZWE1SV (cluster STC)', function () {
      const r = results.find(r => r.id === 'inbound:app-server');
      expect(r).to.exist;
      expect(r.status).to.equal('warn');
      expect(r.warnReasons).to.include('shadow');
    });

    it('reports warn for zaas inbound (7558) — Off rule at priority 200 shadows On rule', function () {
      const r = results.find(r => r.id === 'inbound:zaas');
      expect(r).to.exist;
      expect(r.status).to.equal('warn');
      expect(r.warnReasons).to.include('shadow');
    });

    it('reports ok for api-catalog, discovery, caching-service, and zss (broad On rule still applies)', function () {
      const unaffected = ['inbound:api-catalog', 'inbound:discovery',
                          'inbound:caching-service', 'inbound:zss'];
      for (const id of unaffected) {
        const r = results.find(r => r.id === id);
        expect(r, `${id} should exist`).to.exist;
        expect(r.status, `${id} should be ok`).to.equal('ok');
      }
    });

    it('reports ok for all outbound connections (Off rule only targeted inbound)', function () {
      const outboundMisses = results.filter(r => r.direction === 'Outbound' && r.status !== 'ok');
      expect(outboundMisses).to.have.length(0);
    });
  });

  describe('Bad: rules exist but jobname does not match Zowe', function () {
    it('reports all connections as missed', function () {
      const { summary } = run('attls-bad-wrong-jobname.txt', 'zowe-full-attls.yaml');
      expect(summary.miss).to.equal(summary.total);
      expect(summary.ok).to.equal(0);
      expect(summary.warn).to.equal(0);
    });
  });

  describe('Bad: empty policy (no TTLSRule declarations)', function () {
    it('reports all connections as missed', function () {
      const { summary } = run('attls-bad-empty.txt', 'zowe-full-attls.yaml');
      expect(summary.miss).to.equal(summary.total);
      expect(summary.ok).to.equal(0);
    });
  });

  describe('Bad: wrong keyring for Zowe-to-Zowe connections', function () {
    it('warns for every covered Zowe-to-Zowe connection', function () {
      const { summary } = run('attls-bad-wrong-keyring.txt', 'zowe-full-attls.yaml');
      expect(summary.miss).to.equal(0);         // all connections are covered
      expect(summary.warn).to.be.greaterThan(0); // but all have keyring mismatches
      expect(summary.keyringWarnings.length).to.equal(summary.warn);
    });

    it('includes "keyring" in warnReasons for every covered non-zosmf connection', function () {
      const { results } = run('attls-bad-wrong-keyring.txt', 'zowe-full-attls.yaml');
      const covered = results.filter(r => r.status !== 'miss');
      const zosmfConn = covered.find(r => r.id === 'outbound:gw/zaas\u2192zosmf');
      const nonZosmf  = covered.filter(r => r.id !== 'outbound:gw/zaas\u2192zosmf');

      // Every non-z/OSMF covered connection should flag keyring mismatch
      for (const r of nonZosmf) {
        expect(r.warnReasons, `${r.id} should have keyring warnReason`).to.include('keyring');
        expect(r.keyringUsed).to.equal('WRONG/KEYRING');
      }
    });

    it('exempts the z/OSMF outbound connection from keyring check', function () {
      const { results } = run('attls-bad-wrong-keyring.txt', 'zowe-full-attls.yaml');
      const zosmfConn = results.find(r => r.id === 'outbound:gw/zaas\u2192zosmf');
      expect(zosmfConn).to.exist;
      // z/OSMF is exempt: status should be 'ok' even though the keyring is wrong
      expect(zosmfConn.status).to.equal('ok');
      expect(zosmfConn.warnReasons).to.not.include('keyring');
    });

    it('reports keyringUsed in each warn result', function () {
      const { results } = run('attls-bad-wrong-keyring.txt', 'zowe-full-attls.yaml');
      const keyringWarns = results.filter(r => r.warnReasons && r.warnReasons.includes('keyring'));
      for (const r of keyringWarns) {
        expect(r.keyringUsed).to.be.a('string').and.not.be.empty;
      }
    });

    it('does not warn when zowe.yaml has no SAF keyring (PKCS12 config)', function () {
      // Build a minimal yaml with PKCS12 keystore (no safkeyring:// prefix)
      const pkcs12Yaml = loadYaml('zowe-full-attls.yaml').replace(
        /file:\s*"safkeyring:\/\/ZOWE\/ZOWE_RING"/g,
        'file: "/var/zowe/keystore/zowe.p12"'
      );
      const zoweConfig       = parseZoweYaml(pkcs12Yaml);
      expect(zoweConfig.zoweKeyring).to.be.null;

      const { declarations } = parseAttlsFile(loadAttls('attls-bad-wrong-keyring.txt'));
      const results          = checkCoverage(declarations, zoweConfig);
      const summary          = summariseResults(results);

      // No keyring warnings when zoweKeyring is null
      expect(summary.keyringWarnings).to.have.length(0);
      expect(summary.warn).to.equal(0);
    });
  });

  // ── Single-service mode ────────────────────────────────────────────────────

  describe('Single-service: good complete coverage', function () {
    it('reports no misses and no warnings', function () {
      const { summary } = run('attls-good-single-service.txt', 'zowe-apiml-single-service.yaml');
      expect(summary.miss).to.equal(0);
      expect(summary.warn).to.equal(0);
      expect(summary.ok).to.equal(summary.total);
    });
  });

  describe('Single-service: multi-service rules also satisfy single-service requirements', function () {
    it('broad ZWE1* rules from attls-good-complete.txt cover non-infinispan single-service connections', function () {
      // attls-good-complete.txt uses ZWE1* and covers all standard ports.
      // It will cover the narrower single-service requirements EXCEPT infinispan
      // inbound, because its ZoweInboundInfinispan rule uses Jobname ZWE1CS
      // (multi-service caching-service job) which does not match the single-
      // service infinispan candidates (ZWE1AG).
      const { results, summary } = run('attls-good-complete.txt', 'zowe-apiml-single-service.yaml');
      // Only infinispan inbound entries should be missed
      const missed = summary.missed;
      expect(missed.every(id => id.startsWith('inbound:caching-'))).to.be.true;
      // Everything else should be covered
      const nonInfMisses = results.filter(
        r => r.status === 'miss' && !r.id.startsWith('inbound:caching-')
      );
      expect(nonInfMisses).to.have.length(0);
    });
  });

  describe('Single-service: missing inbound rules for gateway', function () {
    it('misses the gateway inbound but not incorrectly missed api-catalog/caching/zaas', function () {
      // attls-bad-missing-inbound.txt only covers api-catalog (7552) and gateway (7554).
      // In single-service mode there is no inbound:api-catalog requirement, only discovery+gateway.
      // Gateway (7554) IS covered; discovery (7553) is NOT.
      const { results } = run('attls-bad-missing-inbound.txt', 'zowe-apiml-single-service.yaml');

      // gateway inbound (7554) covered
      const gwInbound = results.find(r => r.id === 'inbound:gateway');
      expect(gwInbound && gwInbound.status).to.equal('ok');

      // discovery inbound (7553) NOT covered
      const discInbound = results.find(r => r.id === 'inbound:discovery');
      expect(discInbound && discInbound.status).to.equal('miss');

      // No entry for api-catalog, caching-service, zaas inbound
      // (they are not required in single-service mode)
      expect(results.find(r => r.id === 'inbound:api-catalog')).to.be.undefined;
      expect(results.find(r => r.id === 'inbound:caching-service')).to.be.undefined;
      expect(results.find(r => r.id === 'inbound:zaas')).to.be.undefined;
    });
  });

  describe('Single-service: empty policy', function () {
    it('reports all connections as missed', function () {
      const { summary } = run('attls-bad-empty.txt', 'zowe-apiml-single-service.yaml');
      expect(summary.miss).to.equal(summary.total);
      expect(summary.ok).to.equal(0);
    });
  });
});
