#!/usr/bin/env node
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

/**
 * check-zowe-attls.js
 *
 * CLI entry point for the Zowe AT-TLS coverage checker.
 *
 * Usage:
 *   node utils/check-zowe-attls.js <attls-policy-file> <zowe.yaml>
 *
 * Exit codes:
 *   0  – all required connections are covered, or AT-TLS is disabled in zowe.yaml
 *   1  – one or more required connections are missing or have priority conflicts
 *   2  – usage / parse error
 */

'use strict';

const fs      = require('fs');
const checker = require('./attlsChecker');

// ─── ANSI colour helpers ──────────────────────────────────────────────────────
const C = { reset:'\x1b[0m', bold:'\x1b[1m', red:'\x1b[31m', green:'\x1b[32m',
            yellow:'\x1b[33m', cyan:'\x1b[36m', gray:'\x1b[90m' };
const col  = (c, t) => `${C[c]}${t}${C.reset}`;
const bold = (t) => `${C.bold}${t}${C.reset}`;

// ─── Report printer ───────────────────────────────────────────────────────────
function printReport(zoweConfig, results, declarations) {
  const { serverAttls, clientAttlsMismatches, legacyAttlsComponents, jobPrefix, jobName,
          enabledComponents, infinispanPorts, zosmf } = zoweConfig;

  console.log(`\n${bold('═══════════════════════════════════════════')}`);
  console.log(`${bold('  Zowe AT-TLS Coverage Report')}`);
  console.log(`${bold('═══════════════════════════════════════════')}\n`);

  console.log(bold('Zowe configuration (from zowe.yaml):'));
  console.log(`  Job prefix: ${col('cyan', jobPrefix)}    Job name: ${col('cyan', jobName)}`);
  console.log(`  zowe.network.server.tls.attls : ${serverAttls
    ? col('green', 'true  ← AT-TLS required')
    : col('yellow', 'false — AT-TLS disabled globally')}`);

  // Show per-component AT-TLS overrides (only components that differ from global)
  for (const c of enabledComponents) {
    if (c.attls !== serverAttls) {
      console.log(`  components.${c.id.padEnd(18)} : ${
        c.attls ? col('green', 'true  (override: AT-TLS ON)')
                : col('yellow', 'false (override: AT-TLS OFF)')}`);
    }
  }

  // Surface client/server attls mismatches as errors
  if (clientAttlsMismatches && clientAttlsMismatches.length > 0) {
    console.log();
    for (const m of clientAttlsMismatches) {
      console.log(`  ${col('red', '✗')} Configuration error at ${col('cyan', m.context)}: ` +
        `zowe.network.client.tls.attls=${m.clientAttls} but server AT-TLS is ${m.serverAttls}. ` +
        `Client AT-TLS is deprecated — set it to match server AT-TLS or remove it.`);
    }
  }

  // ── Legacy AT-TLS configuration warning ──────────────────────────────────
  // Pre-v2.18.4 Zowe used components.<id>.server.ssl.enabled: false instead of
  // zowe.network.server.tls.attls: true.  That era of Zowe had serious AT-TLS
  // bugs; the user must be warned to upgrade regardless of policy correctness.
  if (legacyAttlsComponents && legacyAttlsComponents.length > 0) {
    console.log();
    console.log(`  ${col('red', bold('╔══════════════════════════════════════════════════════════════╗'))}`);
    console.log(`  ${col('red', bold('║  ⚠  LEGACY AT-TLS CONFIGURATION DETECTED                    ║'))}`);
    console.log(`  ${col('red', bold('╚══════════════════════════════════════════════════════════════╝'))}`);
    console.log();
    console.log(`  ${col('red', bold('The following component(s) use the old-style AT-TLS indicator:'))}`);
    for (const id of legacyAttlsComponents) {
      console.log(`    ${col('red', '•')} ${col('cyan', `components.${id}.server.ssl.enabled: false`)}`);
    }
    console.log();
    console.log(`  This property was used in Zowe versions ${col('red', 'prior to v2.18.4')} and implies`);
    console.log(`  you are running a vintage of Zowe that contained ${col('red', 'significant AT-TLS bugs')}.`);
    console.log(`  Even if the AT-TLS policy rules shown below appear correct, Zowe's`);
    console.log(`  behaviour with this configuration ${col('red', 'is unreliable')} and errors are expected.`);
    console.log();
    console.log(`  ${col('yellow', bold('Action required:'))}`);
    console.log(`    1. Upgrade Zowe to ${bold('v2.18.4')} or later.`);
    console.log(`    2. Replace the legacy property with:`);
    console.log(`       ${col('cyan', 'zowe.network.server.tls.attls: true')}`);
    console.log(`       (and remove the per-component server.ssl.enabled settings)`);
    console.log(`    3. See ${col('cyan', 'https://docs.zowe.org')} for the current AT-TLS configuration guide.`);
    console.log();
    console.log(`  Continuing analysis, treating legacy components as AT-TLS-enabled...`);
    console.log();
  }

  const anyAttls = enabledComponents.some(c => c.attls);
  if (!anyAttls) {
    console.log(`\n${col('yellow', '⚠  AT-TLS is disabled for all components in zowe.yaml.')}`);
    console.log(`  Set zowe.network.server.tls.attls: true to enable AT-TLS with Zowe.\n`);
    return clientAttlsMismatches && clientAttlsMismatches.length > 0 ? 1 : 0;
  }

  console.log(`\n${bold('Enabled components:')}`);
  for (const c of enabledComponents) {
    console.log(`  ${col('cyan', c.desc.padEnd(22))}  port ${String(c.port).padStart(5)}  job ${c.jobName}`);
  }
  if (zosmf.host) {
    console.log(`  ${'z/OSMF (external)'.padEnd(22)}  port ${String(zosmf.port).padStart(5)}  host ${zosmf.host}`);
  }
  if (infinispanPorts.length) {
    console.log(`  ${'Caching infinispan'.padEnd(22)}  ports ${infinispanPorts.map(p => p.port).join(', ')}  job ${jobPrefix}CS`);
  }

  if (zoweConfig.zoweKeyring) {
    console.log(`\n${bold('Zowe SAF keyring:')} ${col('cyan', zoweConfig.zoweKeyring)}`);
  }

  // ── Extension / unknown components ──────────────────────────────────────────
  if (zoweConfig.unknownComponents && zoweConfig.unknownComponents.length > 0) {
    console.log(`\n${bold('Unknown extension components (cannot validate AT-TLS coverage):')}`)
    for (const c of zoweConfig.unknownComponents) {
      console.log(`  ${col('yellow', '⚠')} ${col('cyan', c.id.padEnd(20))} port ${c.port}`);
      console.log(`      Extension jobs use pattern ${col('cyan', `${zoweConfig.jobPrefix}X*`)} — AT-TLS coverage cannot be validated.`);
    }
    if (declarations) {
      const extPorts = zoweConfig.unknownComponents.map(c => c.port);
      const extRules = checker.findRulesAffectingExtensions(declarations, zoweConfig.jobPrefix, extPorts);
      if (extRules.length > 0) {
        console.log(`\n  ${bold(`AT-TLS rules matching ${zoweConfig.jobPrefix}X* extension jobs:`)}`)
        for (const r of extRules) {
          const onOff = r.ttlsEnabled ? col('green', 'On ') : col('red', 'Off');
          const dir   = r.direction.padEnd(8);
          const ports = r.localPortRange.length <= 20
            ? r.localPortRange.padEnd(20)
            : r.localPortRange;
          console.log(`    [${onOff}] priority ${String(r.priority).padStart(3)}  ${dir}  ports ${ports}  job ${r.jobname}  → ${r.name}`);
        }
      } else {
        console.log(`\n  ${col('yellow', `No AT-TLS rules found matching ${zoweConfig.jobPrefix}X* — extension components may be unprotected.`)}`);
      }
    }
  }

  const inbound  = results.filter(r => r.direction === 'Inbound');
  const outbound = results.filter(r => r.direction === 'Outbound');
  let issues = 0, warnings = 0;

  function printSection(title, items) {
    if (!items.length) return;
    console.log(`\n${bold(title)}`);
    for (const item of items) {
      if (item.status === 'ok') {
        console.log(`  ${col('green','✓')} ${item.label}`);
        console.log(`      ${col('gray', `→ TTLSRule ${item.rule.name}  (job matched: ${item.matchedJob})`)}`);
      } else if (item.status === 'warn') {
        warnings++;
        console.log(`  ${col('yellow','⚠')} ${item.label}`);
        if (item.warnReasons.includes('shadow')) {
          console.log(`      ${col('yellow',`Covered by TTLSRule ${item.rule.name}, BUT`)}`);
          console.log(`      ${col('yellow',`TTLSRule ${item.shadower.name} has higher priority with TTLSEnabled Off — may disable AT-TLS!`)}`);
        }
        if (item.warnReasons.includes('keyring')) {
          console.log(`      ${col('yellow',`Covered by TTLSRule ${item.rule.name}, BUT`)}`);
          console.log(`      ${col('yellow',`Keyring mismatch: rule uses "${item.keyringUsed}" — expected Zowe keyring "${zoweConfig.zoweKeyring}"`)}`);
        }
      } else {
        issues++;
        console.log(`  ${col('red','✗')} ${item.label}`);
        console.log(`      ${col('red','NOT COVERED')} — no active TTLSRule matches this connection.`);
      }
    }
  }

  printSection('Inbound rule coverage:', inbound);
  printSection('Outbound rule coverage:', outbound);

  const sum = checker.summariseResults(results);
  console.log(`\n${bold('─────────────────────────────────────────────')}`);

  if (issues === 0 && warnings === 0) {
    console.log(`${col('green', bold(`✓ All ${sum.total} required connections are covered.`))}\n`);
    return 0;
  }
  if (issues === 0) {
    const kwCount = sum.keyringWarnings ? sum.keyringWarnings.length : 0;
    const msgs = [];
    if (warnings - kwCount > 0)
      msgs.push(`${warnings - kwCount} with priority conflict${warnings - kwCount === 1 ? '' : 's'}`);
    if (kwCount > 0)
      msgs.push(`${kwCount} with keyring mismatch${kwCount === 1 ? '' : 'es'}`);
    console.log(`${col('yellow', `⚠ ${sum.ok}/${sum.total} connections covered, ${msgs.join(', ')}.`)}\n`);
    return 1;
  }
  console.log(col('red', bold(`✗ ${issues} of ${sum.total} required connection${issues === 1 ? '' : 's'} not covered.`)));
  if (warnings) console.log(col('yellow', `  Additionally, ${warnings} covered connection${warnings === 1 ? '' : 's'} have priority-conflict warnings.`));
  console.log(`  Check jobname patterns, port ranges, and TTLSEnabled settings.\n`);
  return 1;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    process.stderr.write(
      `Usage: node utils/check-zowe-attls.js <attls-policy-file> <zowe.yaml>\n\n` +
      `  attls-policy-file  AT-TLS Policy Agent configuration file\n` +
      `  zowe.yaml          Zowe instance configuration file\n`
    );
    process.exit(2);
  }

  const [attlsPath, zowePath] = args;

  let attlsContent, zoweContent;
  try { attlsContent = fs.readFileSync(attlsPath, 'utf8'); }
  catch (e) { process.stderr.write(`Cannot read AT-TLS file: ${e.message}\n`); process.exit(2); }
  try { zoweContent  = fs.readFileSync(zowePath,  'utf8'); }
  catch (e) { process.stderr.write(`Cannot read zowe.yaml: ${e.message}\n`); process.exit(2); }

  let policy, zoweConfig;
  try { policy     = checker.parseAttlsFile(attlsContent); }
  catch (e) { process.stderr.write(`AT-TLS parse error: ${e.message}\n`); process.exit(2); }
  try { zoweConfig = checker.parseZoweYaml(zoweContent); }
  catch (e) { process.stderr.write(`zowe.yaml parse error: ${e.message}\n`); process.exit(2); }

  const ruleCount = [...policy.declarations.values()].filter(d => d.typeName === 'TTLSRule').length;
  console.log(`Parsed ${policy.declarations.size} AT-TLS declarations (${ruleCount} TTLSRules) from ${attlsPath}`);
  console.log(`Parsed zowe.yaml from ${zowePath}`);

  // ── Surface parser / semantic warnings from the AT-TLS file ─────────────────
  if (policy.parseWarnings && policy.parseWarnings.length > 0) {
    console.log(`\n${bold('AT-TLS policy file warnings:')}`);
    for (const w of policy.parseWarnings) {
      if (w.type === 'invalid-jobname') {
        console.log(`  ${col('red', '✗')} ${col('yellow', `[invalid-jobname]`)} ${w.message}`);
        console.log(`      ${col('gray', 'Hint: only A-Z 0-9 @#$ and a trailing * are valid in z/OS job names.')}`);
        console.log(`      ${col('gray', `      This rule will NEVER match — it should be corrected or removed.`)}`);
      } else {
        // unexpected-syntax or anything else
        console.log(`  ${col('yellow', '⚠')} ${col('yellow', `[unexpected-syntax line ${w.lineNum}]`)} ${w.message}`);
        console.log(`      ${col('gray', 'Hint: this may be a truncated export, an editor artefact, or unsupported syntax.')}`);
      }
    }
    console.log();
  }

  const results  = checker.checkCoverage(policy.declarations, zoweConfig);
  const exitCode = printReport(zoweConfig, results, policy.declarations);
  process.exit(exitCode);
}

main();
