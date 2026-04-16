/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

/**
 * attlsChecker.js
 *
 * Pure-logic module (no file I/O, no process.exit) for validating that an
 * AT-TLS Policy Agent configuration file provides adequate coverage for Zowe
 * components described in a zowe.yaml file.
 *
 * The companion CLI script check-zowe-attls.js handles I/O and the exit code.
 */

'use strict';

const yaml = require('yaml');

// ─────────────────────────────────────────────────────────────────────────────
// AT-TLS policy file parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses an AT-TLS Policy Agent file and returns { declarations }
 * where declarations is a Map<itemName, { typeName, name, props, startLine }>.
 *
 * Only well-formed declarations (non-indented TypeKeyword Name followed by a
 * lone '{' on the next non-blank line) are included.  All properties inside the
 * block are captured in a key→value/array map.
 *
 * The first declaration for a given name wins when duplicates exist (mirrors
 * the Policy Agent's own behaviour of using the first match).
 */
function parseAttlsFile(content) {
  // Strip comments and preserve line structure
  const lines = content.split(/\r?\n/).map(l => {
    // Only treat '#' as a comment when it appears at the start of the line
    // or immediately after whitespace.  A '#' embedded in a word (e.g. a
    // rule name like "zowe#3_Client") must be kept intact.
    const ci = l.search(/(?:^|\s)#/);
    return ci >= 0 ? l.slice(0, ci) : l;
  });

  const declarations  = new Map();
  const parseWarnings = [];

  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i];
    const trimmed = line.trim();

    // Top-level declaration: optional leading whitespace, TypeKeyword  ItemName  (nothing else)
    // Leading whitespace is explicitly allowed: some sites indent their policy stanzas.
    const declMatch = /^\s*([A-Za-z]\w*)\s+(\S+)\s*$/.exec(line);
    if (!declMatch) {
      // Warn about non-blank lines outside blocks that don't look like AT-TLS syntax.
      // Skip pure structural tokens ({, }) and truly blank lines.
      if (trimmed && trimmed !== '{' && trimmed !== '}') {
        parseWarnings.push({
          type:    'unexpected-syntax',
          lineNum: i + 1,
          content: trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed,
          message: `Unexpected content on line ${i + 1} (outside a declaration block): "${trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed}"`,
        });
      }
      continue;
    }

    const typeName = declMatch[1];
    const itemName = declMatch[2];

    // Find opening brace on the next non-blank line
    let braceIdx = i + 1;
    while (braceIdx < lines.length && lines[braceIdx].trim() === '') braceIdx++;
    if (braceIdx >= lines.length || lines[braceIdx].trim() !== '{') continue;

    // Walk forward to the matching closing brace, tracking nested depth
    let depth = 1;
    let closeIdx = braceIdx + 1;
    while (closeIdx < lines.length && depth > 0) {
      const t = lines[closeIdx].trim();
      if (t === '{') depth++;
      else if (t === '}') depth--;
      if (depth > 0) closeIdx++;
    }

    const bodyLines = lines.slice(braceIdx + 1, closeIdx);
    const props     = parseBlockProps(bodyLines);

    // First declaration wins (deduplicate by name)
    if (!declarations.has(itemName)) {
      declarations.set(itemName, { typeName, name: itemName, props, startLine: i + 1 });
    }

    i = closeIdx; // skip to end of block
  }

  // ── Post-parse semantic validation ──────────────────────────────────────────
  // Validate Jobname patterns in TTLSRule declarations.  AT-TLS only permits
  // letters, digits, @, #, $, and a single trailing '*' wildcard.  Other
  // characters (like '.' from regex/glob notation) make a rule effectively dead
  // because no real z/OS job name will ever match the pattern.
  for (const [, decl] of declarations) {
    if (decl.typeName !== 'TTLSRule') continue;
    const jobPatterns = decl.props['Jobname']
      ? (Array.isArray(decl.props['Jobname']) ? decl.props['Jobname'] : [decl.props['Jobname']])
      : [];
    for (const pat of jobPatterns) {
      // Valid: letters, digits, @, #, $, trailing *
      if (/[^A-Za-z0-9@#$*]/.test(pat)) {
        parseWarnings.push({
          type:    'invalid-jobname',
          lineNum: decl.startLine,
          rule:    decl.name,
          jobname: pat,
          message: `TTLSRule "${decl.name}" has Jobname pattern "${pat}" containing characters not valid in ` +
                   `z/OS job names (only A-Z, 0-9, @, #, $, and trailing * are allowed). ` +
                   `This rule will never match any z/OS job.`,
        });
      }
    }
  }

  return { declarations, parseWarnings };
}

/**
 * Parses property lines from inside an AT-TLS block body.
 * Keys that appear more than once are collected into an array.
 */
function parseBlockProps(bodyLines) {
  const props = {};
  for (const line of bodyLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '{' || trimmed === '}') continue;
    const m = /^([\w.]+)\s+(.+)$/.exec(trimmed);
    if (!m) continue;
    const key   = m[1];
    const value = m[2].trim();
    if (key in props) {
      if (!Array.isArray(props[key])) props[key] = [props[key]];
      props[key].push(value);
    } else {
      props[key] = value;
    }
  }
  return props;
}

// ─────────────────────────────────────────────────────────────────────────────
// Port range utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if portStr covers port.
 * Accepted forms: "7554", "7552-7558", "1024-65535", "ALL".
 */
function portRangeCoversPort(portStr, port) {
  if (!portStr) return false;
  const s = portStr.trim();
  if (s.toUpperCase() === 'ALL') return true;
  const dash = s.indexOf('-');
  if (dash >= 0) {
    return port >= parseInt(s.slice(0, dash), 10) &&
           port <= parseInt(s.slice(dash + 1), 10);
  }
  return parseInt(s, 10) === port;
}

/**
 * Resolves the port range(s) for a TTLSRule to an array of range strings.
 * Handles both inline values (LocalPortRange 7552-7558) and Ref-based values
 * (LocalPortRangeRef portR1 → PortRange portR1 { Port 7552-7558 }).
 * Returns ['0-65535'] when no port restriction is specified.
 */
function resolveRulePortRange(declarations, props, forLocalPort) {
  const inlineKey   = forLocalPort ? 'LocalPortRange'    : 'RemotePortRange';
  const refKey      = forLocalPort ? 'LocalPortRangeRef' : 'RemotePortRangeRef';
  const groupRefKey = forLocalPort ? 'LocalPortGroupRef' : 'RemotePortGroupRef';

  if (props[inlineKey]) {
    const v = props[inlineKey];
    return Array.isArray(v) ? v : [v];
  }

  // PortRange declaration: TTLSRule … LocalPortRangeRef portR4
  //   → PortRange portR4 { Port 7552 }
  if (props[refKey]) {
    const refNames = Array.isArray(props[refKey]) ? props[refKey] : [props[refKey]];
    const ranges = [];
    for (const refName of refNames) {
      const portDecl = declarations.get(refName);
      if (portDecl && portDecl.props['Port']) {
        const pv = portDecl.props['Port'];
        if (Array.isArray(pv)) ranges.push(...pv);
        else ranges.push(pv);
      }
    }
    if (ranges.length > 0) return ranges;
  }

  // PortGroup declaration: TTLSRule … LocalPortGroupRef TN3270_ports
  //   → PortGroup TN3270_ports { PortRange { Port 992 } PortRange { Port 923 } … }
  // parseBlockProps flattens all Port values from nested PortRange sub-blocks
  // into the same props['Port'] array as a regular PortRange declaration.
  if (props[groupRefKey]) {
    const groupNames = Array.isArray(props[groupRefKey]) ? props[groupRefKey] : [props[groupRefKey]];
    const ranges = [];
    for (const groupName of groupNames) {
      const groupDecl = declarations.get(groupName);
      if (groupDecl && groupDecl.props['Port']) {
        const pv = groupDecl.props['Port'];
        if (Array.isArray(pv)) ranges.push(...pv);
        else ranges.push(pv);
      }
    }
    if (ranges.length > 0) return ranges;
  }

  return ['0-65535']; // unconstrained
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyring utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalises a zowe.yaml keystore file value to a comparable keyring identifier.
 * SAF keyring URIs of the form safkeyring://OWNER/RING (or safkeyring:////OWNER/RING)
 * are reduced to "OWNER/RING" (upper-cased).
 * Returns null for PKCS12 paths or any non-SAF keyring (skip the check).
 */
function normalizeZoweKeyring(keystoreFile) {
  if (!keystoreFile) return null;
  const m = /^safkeyring:\/+(.+)/i.exec(String(keystoreFile));
  if (!m) return null;
  // Strip any additional leading slashes (safkeyring:////OWNER/RING)
  return m[1].replace(/^\/+/, '').toUpperCase();
}

/**
 * Returns true if a TTLSKeyringParms Keyring value matches the expected Zowe
 * keyring (in "OWNER/RING" form from zowe.yaml).
 *
 * AT-TLS allows the Keyring value to be specified as:
 *   - "OWNER/RING"  — fully qualified; compare as-is
 *   - "RING"        — owner is implied (the job's current user); we can only
 *                     compare the ring name since we don't know the runtime
 *                     user here.  If the ring names match we treat it as ok.
 */
function keyringMatches(ruleKeyring, zoweKeyring) {
  if (ruleKeyring === zoweKeyring) return true;
  // If the rule omits the owner, compare only the ring name portion
  if (!ruleKeyring.includes('/')) {
    const ringName = zoweKeyring.includes('/') ? zoweKeyring.split('/').slice(1).join('/') : zoweKeyring;
    return ruleKeyring === ringName;
  }
  return false;
}

/**
 * Traces a TTLSRule declaration through its environment action to the keyring
 * value it uses.
 *
 * Chain: TTLSRule.TTLSEnvironmentActionRef
 *          → TTLSEnvironmentAction.TTLSKeyringParmsRef
 *            → TTLSKeyringParms.Keyring
 *
 * Returns the Keyring string value (upper-cased) or null if the chain is broken.
 */
function resolveKeyringForRule(declarations, ruleDecl) {
  if (!ruleDecl) return null;
  const envRef = ruleDecl.props['TTLSEnvironmentActionRef'];
  if (!envRef) return null;
  const envName = Array.isArray(envRef) ? envRef[0] : envRef;
  const envDecl = declarations.get(envName);
  if (!envDecl) return null;
  const kpRef = envDecl.props['TTLSKeyringParmsRef'];
  if (!kpRef) return null;
  const kpName = Array.isArray(kpRef) ? kpRef[0] : kpRef;
  const kpDecl = declarations.get(kpName);
  if (!kpDecl) return null;
  const kv = kpDecl.props['Keyring'];
  const raw = Array.isArray(kv) ? kv[0] : kv;
  return raw ? raw.trim().toUpperCase() : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Jobname matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if AT-TLS Jobname pattern matches job.
 * AT-TLS supports a single trailing '*' wildcard.
 * An absent/empty pattern matches all jobs.
 */
function jobnameMatches(pattern, job) {
  if (!pattern || !pattern.trim()) return true;
  const p = pattern.trim().toUpperCase();
  const j = job.trim().toUpperCase();
  if (p.endsWith('*')) return j.startsWith(p.slice(0, -1));
  return p === j;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the highest-priority TTLSRule that actively enables AT-TLS for the
 * connection described by (direction, port, jobName), along with metadata about
 * whether a higher-priority disabled rule shadows it.
 *
 * @returns {{ covered: boolean, rule: object|null, warn: boolean, shadower: object|null }}
 */
function findBestRule(declarations, direction, port, jobName) {
  const enabled  = [];
  const disabled = [];

  for (const [, decl] of declarations) {
    if (decl.typeName !== 'TTLSRule') continue;

    const p        = decl.props;
    const ruleDir  = (p['Direction'] || 'Both').toUpperCase();
    if (ruleDir !== 'BOTH' && ruleDir !== direction.toUpperCase()) continue;

    // Jobname filter
    const jobPatterns = p['Jobname']
      ? (Array.isArray(p['Jobname']) ? p['Jobname'] : [p['Jobname']])
      : [];
    if (jobPatterns.length > 0 &&
        !jobPatterns.some(pat => jobnameMatches(pat, jobName))) continue;

    // Port filter
    const isInbound = direction.toUpperCase() === 'INBOUND';
    const ranges    = resolveRulePortRange(declarations, p, isInbound);
    if (!ranges.some(r => portRangeCoversPort(r, port))) continue;

    // For outbound connections Zowe uses an ephemeral source port (e.g. 1024).
    // If a rule constrains its LocalPortRange to specific non-ephemeral values
    // (e.g. LocalPortGroupRef PortB_Zowe = 1234/1337/9999) it cannot
    // actually match a Zowe connection, so skip it.
    if (!isInbound) {
      const localRanges = resolveRulePortRange(declarations, p, true);
      const unconstrained = localRanges.length === 1 && localRanges[0] === '0-65535';
      if (!unconstrained && !localRanges.some(r => portRangeCoversPort(r, 1024))) continue;
    }

    const priority = parseInt(p['Priority'] || '0', 10);

    // Check whether the GroupAction actually enables AT-TLS
    const groupRef = p['TTLSGroupActionRef'];
    if (!groupRef) continue;
    const refName  = Array.isArray(groupRef) ? groupRef[0] : groupRef;
    const ga       = declarations.get(refName);
    const ttlsOn   = ga
      ? (ga.props['TTLSEnabled'] || 'On').trim().toUpperCase() === 'ON'
      : false;

    if (ttlsOn) enabled.push({ decl, priority });
    else        disabled.push({ decl, priority });
  }

  enabled.sort( (a, b) => b.priority - a.priority);
  disabled.sort((a, b) => b.priority - a.priority);

  const bestEnabled  = enabled[0]  || null;
  const bestDisabled = disabled[0] || null;
  const shadowed     = bestEnabled && bestDisabled &&
                       bestDisabled.priority > bestEnabled.priority;

  return {
    covered:  bestEnabled !== null && !shadowed,
    rule:     bestEnabled  ? bestEnabled.decl  : null,
    shadower: shadowed      ? bestDisabled.decl : null,
    warn:     !!shadowed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Zowe YAML parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Well-known Zowe component metadata.
 * suffix  = address-space name suffix appended to zowe.job.prefix
 * defaultPort = port used when none is specified in components.<id>.port
 */
const COMPONENT_META = {
  'api-catalog':     { suffix: 'AC', defaultPort: 7552, desc: 'API Catalog'       },
  'discovery':       { suffix: 'AD', defaultPort: 7553, desc: 'Discovery Service' },
  'gateway':         { suffix: 'AG', defaultPort: 7554, desc: 'API Gateway'       },
  'caching-service': { suffix: 'CS', defaultPort: 7555, desc: 'Caching Service'   },
  'app-server':      { suffix: 'DS', defaultPort: 7556, desc: 'App Server'        },
  'zss':             { suffix: 'SZ', defaultPort: 7557, desc: 'ZSS'               },
  'zaas':            { suffix: 'AZ', defaultPort: 7558, desc: 'ZAAS'              },
};

/** Safely traverses nested object keys; returns undefined if any level is missing. */
function dig(obj, ...keys) {
  return keys.reduce((cur, k) => (cur != null ? cur[k] : undefined), obj);
}

/**
 * Parses a zowe.yaml string and extracts AT-TLS-relevant configuration.
 *
 * @returns {{
 *   serverAttls: boolean,
 *   clientAttlsMismatches: Array<{context: string, serverAttls: boolean, clientAttls: boolean}>,
 *   jobPrefix: string,
 *   jobName: string,
 *   enabledComponents: Array,
 *   infinispanPorts: Array,
 *   zosmf: { host: string|undefined, port: number }
 * }}
 */
function parseZoweYaml(content) {
  let doc;
  try { doc = yaml.parse(content); }
  catch (e) { throw new Error(`YAML parse error: ${e.message}`); }

  const zowe = doc.zowe || {};
  const job  = zowe.job || {};

  const jobPrefix   = job.prefix || 'ZWE1';
  const jobName     = job.name   || `${jobPrefix}SV`;

  // Global server AT-TLS flag — default for all components unless overridden per-component at
  // components.<id>.zowe.network.server.tls.attls.  The client AT-TLS setting is deprecated;
  // server attls determines both inbound and outbound AT-TLS behaviour.
  const serverAttls = !!(dig(zowe, 'network', 'server', 'tls', 'attls'));

  // Detect global client/server mismatch.  If explicitly set and differing from server attls,
  // record it so the CLI can surface it as a configuration error to the user.
  const globalClientAttls = dig(zowe, 'network', 'client', 'tls', 'attls');
  const clientAttlsMismatches = [];
  if (globalClientAttls !== undefined && !!globalClientAttls !== serverAttls) {
    clientAttlsMismatches.push({
      context: 'global (zowe.network)',
      serverAttls,
      clientAttls: !!globalClientAttls,
    });
  }

  const components = doc.components || {};

  // Whether the API ML is running in single-service deployment mode
  // (components.apiml.enabled: true).  When true, the api-catalog, discovery,
  // gateway, caching-service, and zaas components are all merged into one job
  // (${prefix}AG).  Their individual enabled flags are ignored.
  // app-server (${prefix}DS) and zss (${prefix}SZ) are unaffected.
  const apimlSingleService = !!(dig(components, 'apiml', 'enabled'));

  // APIML component IDs that are absorbed into the single-service job
  const APIML_BUNDLED = new Set(['api-catalog', 'discovery', 'gateway', 'caching-service', 'zaas']);

  // Components that use the pre-v2.18.4 legacy AT-TLS indicator
  // (components.<id>.server.ssl.enabled: false) instead of the current
  // zowe.network.server.tls.attls property.
  const legacyAttlsComponents = [];

  const enabledComponents = [];
  for (const [id, meta] of Object.entries(COMPONENT_META)) {
    const comp = components[id];
    if (apimlSingleService && APIML_BUNDLED.has(id)) {
      // Always included; all run under the single ${prefix}AG job
      const rawSA = comp ? dig(comp, 'zowe', 'network', 'server', 'tls', 'attls') : undefined;
      // Legacy AT-TLS signal: components.<id>.server.ssl.enabled: false
      const legacySsl = comp ? dig(comp, 'server', 'ssl', 'enabled') : undefined;
      if (legacySsl === false) legacyAttlsComponents.push(id);
      const compAttls = rawSA !== undefined ? !!rawSA : (legacySsl === false ? true : serverAttls);
      const rawCA = comp ? dig(comp, 'zowe', 'network', 'client', 'tls', 'attls') : undefined;
      if (rawCA !== undefined && !!rawCA !== compAttls) {
        clientAttlsMismatches.push({ context: `components.${id}`, serverAttls: compAttls, clientAttls: !!rawCA });
      }
      enabledComponents.push({
        id,
        desc:    meta.desc,
        jobName: `${jobPrefix}AG`,
        port:    (comp && comp.port) || meta.defaultPort,
        attls:   compAttls,
        raw:     comp || {},
      });
    } else {
      // Multi-service, or non-apiml components: respect the enabled flag
      if (!comp || comp.enabled === false) continue;
      const rawSA = dig(comp, 'zowe', 'network', 'server', 'tls', 'attls');
      // Legacy AT-TLS signal: components.<id>.server.ssl.enabled: false
      const legacySsl = dig(comp, 'server', 'ssl', 'enabled');
      if (legacySsl === false) legacyAttlsComponents.push(id);
      const compAttls = rawSA !== undefined ? !!rawSA : (legacySsl === false ? true : serverAttls);
      const rawCA = dig(comp, 'zowe', 'network', 'client', 'tls', 'attls');
      if (rawCA !== undefined && !!rawCA !== compAttls) {
        clientAttlsMismatches.push({ context: `components.${id}`, serverAttls: compAttls, clientAttls: !!rawCA });
      }
      enabledComponents.push({
        id,
        desc:    meta.desc,
        jobName: `${jobPrefix}${meta.suffix}`,
        port:    comp.port || meta.defaultPort,
        attls:   compAttls,
        raw:     comp,
      });
    }
  }

  // Caching Service infinispan cluster-communication ports.
  // In single-service mode caching is always part of the apiml job, so we
  // look for infinispan config regardless of the caching-service.enabled flag.
  const cachingCompRaw  = components['caching-service'];
  const infinispanPorts = [];
  const cachingActive   = apimlSingleService
    ? !!cachingCompRaw
    : !!(cachingCompRaw && cachingCompRaw.enabled !== false);
  if (cachingActive) {
    const jg = dig(cachingCompRaw, 'storage', 'infinispan', 'jgroups') || {};
    if (jg.port)                 infinispanPorts.push({ port: jg.port, label: 'jgroups' });
    if (jg.keyExchange && jg.keyExchange.port)
      infinispanPorts.push({ port: jg.keyExchange.port, label: 'keyExchange' });
  }

  const zosmfSection = doc.zOSMF || doc.zosmf || {};

  // Detect whether app-server cluster mode is enabled.
  // When ZLUX_NO_CLUSTER is 1/'1'/true the app-server runs as a single process
  // under ${prefix}DS, which is both the port listener and the only worker.
  // Otherwise (default) the parent STC job (zowe.job.name, e.g. ZWE1SV) holds
  // the listening socket, while worker processes run as ${prefix}DS.
  //
  // This matters for AT-TLS INBOUND rules: the rule must match the job that
  // owns the listening socket (the local port owner), not the workers.
  const zwedNoCluster = dig(zowe, 'environments', 'ZLUX_NO_CLUSTER');
  const appServerClustered = !(zwedNoCluster === 1 || zwedNoCluster === '1' || zwedNoCluster === true);

  // Extract the Zowe SAF keyring from zowe.certificate.keystore.file.
  // Only SAF keyrings (safkeyring://OWNER/RING) are checked; PKCS12 paths return null.
  const keystoreFile = dig(zowe, 'certificate', 'keystore', 'file') || '';
  const zoweKeyring  = normalizeZoweKeyring(keystoreFile);

  // Collect enabled components that are not in COMPONENT_META.  Zowe extensions
  // add components with arbitrary IDs; the checker cannot validate their AT-TLS
  // coverage but can at least surface their presence and highlight relevant rules.
  // 'apiml' is a deployment-mode flag, not a real component — skip it.
  const unknownComponents = [];
  for (const [id, comp] of Object.entries(components)) {
    if (id === 'apiml') continue;
    if (COMPONENT_META[id]) continue;
    if (!comp || comp.enabled === false) continue;
    if (!comp.port) continue;  // no port — cannot be AT-TLS relevant
    unknownComponents.push({ id, port: comp.port, raw: comp });
  }

  return {
    serverAttls,
    clientAttlsMismatches,
    legacyAttlsComponents,
    jobPrefix,
    jobName,
    apimlSingleService,
    appServerClustered,
    enabledComponents,
    unknownComponents,
    infinispanPorts,
    zosmf:      { host: zosmfSection.host, port: zosmfSection.port || 443 },
    zoweKeyring,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension-component rule finder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns AT-TLS rules that could potentially match Zowe extension component
 * jobs.  Extension components (Zowe plugins) follow the naming convention
 * ${prefix}X<suffix> for their address spaces, e.g. ZWE1XABC.
 *
 * Only rules whose LocalPortRange covers at least one of the supplied
 * extensionPorts are returned.  Rules that target entirely unrelated ports
 * (e.g. a non-Zowe application on a different port) are excluded even if their
 * Jobname pattern would otherwise match.
 *
 * @param {Map}      declarations    parsed AT-TLS declarations map
 * @param {string}   jobPrefix       e.g. 'ZWE1'
 * @param {number[]} extensionPorts  ports of the unknown extension components
 * @returns {Array<{
 *   name: string,
 *   direction: string,
 *   localPortRange: string,
 *   jobname: string,
 *   ttlsEnabled: boolean,
 *   priority: number,
 * }>}
 */
function findRulesAffectingExtensions(declarations, jobPrefix, extensionPorts) {
  if (!extensionPorts || extensionPorts.length === 0) return [];
  const probeJob = `${jobPrefix}XEXT`;
  const results  = [];

  for (const [, decl] of declarations) {
    if (decl.typeName !== 'TTLSRule') continue;
    const p = decl.props;

    // Jobname check: does this rule's pattern match the extension probe job?
    const jobPatterns = p['Jobname']
      ? (Array.isArray(p['Jobname']) ? p['Jobname'] : [p['Jobname']])
      : [];
    const coversExtensions = jobPatterns.length === 0 ||
      jobPatterns.some(pat => jobnameMatches(pat, probeJob));
    if (!coversExtensions) continue;

    // Port check: the rule's LocalPortRange must cover at least one extension port.
    const isInbound = (p['Direction'] || 'Both').toUpperCase() !== 'OUTBOUND';
    const ranges    = resolveRulePortRange(declarations, p, isInbound);
    const coversAPort = extensionPorts.some(port =>
      ranges.some(r => portRangeCoversPort(r, port))
    );
    if (!coversAPort) continue;

    // Resolve TTLSEnabled from the group action
    const groupRef = p['TTLSGroupActionRef'];
    let ttlsEnabled = false;
    if (groupRef) {
      const refName = Array.isArray(groupRef) ? groupRef[0] : groupRef;
      const ga = declarations.get(refName);
      ttlsEnabled = ga
        ? (ga.props['TTLSEnabled'] || 'On').trim().toUpperCase() === 'ON'
        : false;
    }

    // Display the resolved port range (not just the raw inline value) so that
    // rules using LocalPortGroupRef / LocalPortRangeRef show actual ports.
    const resolvedRanges = ranges[0] === '0-65535' && ranges.length === 1
      ? 'all'
      : ranges.join(', ');

    results.push({
      name:          decl.name,
      direction:     p['Direction'] || 'Both',
      localPortRange: resolvedRanges,
      jobname:       jobPatterns.length > 0 ? jobPatterns.join(', ') : '(any)',
      ttlsEnabled,
      priority:      parseInt(p['Priority'] || '0', 10),
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Required-connection builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the list of (direction, port, jobName) tuples that must be covered by
 * active AT-TLS rules given the Zowe configuration.
 *
 * Branches automatically on zoweConfig.apimlSingleService:
 *   true  → single-service mode (api-catalog/discovery/gateway/caching/zaas
 *             all run in one ${prefix}AG job; only discovery+gateway inbound
 *             ports are externally exposed).
 *   false → multi-service mode (each component has its own job and port).
 */
function buildRequiredConnections(zoweConfig) {
  if (zoweConfig.apimlSingleService) {
    return _buildRequiredConnectionsSingleService(zoweConfig);
  }
  return _buildRequiredConnectionsMultiService(zoweConfig);
}

/** Multi-service connection requirements (one job per component). */
function _buildRequiredConnectionsMultiService(zoweConfig) {
  const req = [];
  const px  = zoweConfig.jobPrefix;

  const comp = (id) => zoweConfig.enabledComponents.find(c => c.id === id);

  // ── Inbound ────────────────────────────────────────────────────────────────
  // Per-component AT-TLS gate: each component carries an .attls flag derived
  // from zowe.network.server.tls.attls overridden by
  // components.<id>.zowe.network.server.tls.attls when present.
  for (const c of zoweConfig.enabledComponents) {
    if (!c.attls) continue;
      // App-server has a dual-jobname complication: when Node.js clustering is
      // enabled (default), the parent STC job (zowe.job.name, e.g. ZWE1SV)
      // holds the listening socket, so AT-TLS inbound rules must match THAT
      // job.  Worker processes run as ${prefix}DS but do not own the port.
      // When clustering is disabled (ZLUX_NO_CLUSTER=1), ${prefix}DS is both
      // the listener and the worker, so the rule must match ${prefix}DS.
      let candidates;
      let effectiveJob;
      if (c.id === 'app-server') {
        if (zoweConfig.appServerClustered) {
          effectiveJob = zoweConfig.jobName;  // e.g. ZWE1SV
          candidates   = [zoweConfig.jobName, `${px}*`];
        } else {
          effectiveJob = c.jobName;           // e.g. ZWE1DS
          candidates   = [c.jobName, `${px}*`];
        }
      } else {
        effectiveJob = c.jobName;
        candidates   = [c.jobName, `${px}*`, `${px}`];
      }
      req.push({
        id:         `inbound:${c.id}`,
        label:      `Inbound: ${c.desc} (job ${effectiveJob}, port ${c.port})`,
        direction:  'Inbound',
        port:       c.port,
        candidates,
      });
    }

  // Caching Service infinispan ports (only when caching has AT-TLS enabled)
  if (comp('caching-service')?.attls) {
    for (const { port, label } of zoweConfig.infinispanPorts) {
      req.push({
        id:         `inbound:caching-${label}`,
        label:      `Inbound: Caching infinispan ${label} (job ${px}CS, port ${port})`,
        direction:  'Inbound',
        port,
        candidates: [`${px}CS`, `${px}*`],
      });
    }
  }

  // ── Outbound ───────────────────────────────────────────────────────────────
  // Each outbound connection is gated on the source component's .attls flag.
  {
    const gw   = comp('gateway');
    const zaas = comp('zaas');
    const disc = comp('discovery');
    const cs   = comp('caching-service');
    const app  = comp('app-server');
    const zss  = comp('zss');

    // API Gateway → ZAAS (X.509 client cert required)
    if (gw && gw.attls && zaas) {
      req.push({
        id: 'outbound:gw→zaas', label: `Outbound: Gateway (${px}AG) → ZAAS port ${zaas.port}`,
        direction: 'Outbound', port: zaas.port,
        candidates: [`${px}AG`, `${px}A*`, `${px}*`],
      });
    }

    // ZAAS → Gateway
    if (zaas && zaas.attls && gw) {
      req.push({
        id: 'outbound:zaas→gw', label: `Outbound: ZAAS (${px}AZ) → Gateway port ${gw.port}`,
        direction: 'Outbound', port: gw.port,
        candidates: [`${px}AZ`, `${px}A*`, `${px}*`],
      });
    }

    // All registrants → Discovery (X.509 client cert for onboarding)
    if (disc) {
      const registrants = [
        gw   && gw.attls   && `${px}AG`,
        zaas && zaas.attls && `${px}AZ`,
        comp('api-catalog') && comp('api-catalog').attls && `${px}AC`,
        cs   && cs.attls   && `${px}CS`,
      ].filter(Boolean);

      for (const jobName of registrants) {
        req.push({
          id: `outbound:${jobName}→discovery`,
          label: `Outbound: ${jobName} → Discovery port ${disc.port}`,
          direction: 'Outbound', port: disc.port,
          candidates: [jobName, `${px}*`],
        });
      }
    }

    // Core services → Caching Service (X.509 client cert required)
    if (cs) {
      const users = [gw && gw.attls && `${px}AG`, zaas && zaas.attls && `${px}AZ`, disc && disc.attls && `${px}AD`].filter(Boolean);
      for (const jobName of users) {
        req.push({
          id: `outbound:${jobName}→caching`,
          label: `Outbound: ${jobName} → Caching Service port ${cs.port}`,
          direction: 'Outbound', port: cs.port,
          candidates: [jobName, `${px}*`],
        });
      }
    }

    if (app && (gw?.attls || zaas?.attls)) {
      req.push({
        id: 'outbound:any→appserver',
        label: `Outbound: Zowe services → App Server port ${app.port}`,
        direction: 'Outbound', port: app.port,
        candidates: [`${px}AG`, `${px}DS`, `${px}*`],
      });
    }

    if (zss && app?.attls) {
      req.push({
        id: 'outbound:any→zss',
        label: `Outbound: Zowe services → ZSS port ${zss.port}`,
        direction: 'Outbound', port: zss.port,
        candidates: [`${px}DS`, `${px}AG`, `${px}*`],
      });
    }

    // Gateway / ZAAS → z/OSMF (no X.509 client cert on this rule)
    if ((gw?.attls || zaas?.attls) && zoweConfig.zosmf.port) {
      req.push({
        id: 'outbound:gw/zaas→zosmf',
        label: `Outbound: Gateway/ZAAS → z/OSMF port ${zoweConfig.zosmf.port}`,
        direction: 'Outbound', port: zoweConfig.zosmf.port,
        candidates: [`${px}AG`, `${px}AZ`, `${px}A*`, `${px}*`],
      });
    }

    // Caching Service infinispan outbound
    if (cs && cs.attls) {
      for (const { port, label } of zoweConfig.infinispanPorts) {
        req.push({
          id: `outbound:caching-${label}`,
          label: `Outbound: Caching infinispan ${label} (${px}CS, port ${port})`,
          direction: 'Outbound', port,
          candidates: [`${px}CS`, `${px}*`],
        });
      }
    }
  }

  return req;
}

/**
 * Single-service connection requirements (components.apiml.enabled: true).
 *
 * api-catalog, discovery, gateway, caching-service, and zaas all run inside
 * the single ${prefix}AG job.  Only the discovery and gateway ports are
 * externally exposed as inbound; the others (api-catalog/caching/zaas) are
 * internal to the process and require no AT-TLS inbound rule.
 *
 * app-server (${prefix}DS) and zss (${prefix}SZ) are unaffected and still
 * have their own inbound rules.
 *
 * Outbound: there are no cross-APIML-component connections (all in-process).
 * Required outbound rules are: ${prefix}AG → discovery (HA replica),
 * ${prefix}AG → app-server, ${prefix}AG → zss, ${prefix}AG → z/OSMF,
 * and ${prefix}AG → infinispan.
 */
function _buildRequiredConnectionsSingleService(zoweConfig) {
  const req = [];
  const px  = zoweConfig.jobPrefix;
  const comp = (id) => zoweConfig.enabledComponents.find(c => c.id === id);

  const disc = comp('discovery');
  const gw   = comp('gateway');
  const app  = comp('app-server');
  const zss  = comp('zss');

  // Effective AT-TLS state for the bundled ${prefix}AG job.  In single-service
  // mode all APIML components run in one process; AT-TLS is on for the job if
  // any of the bundled components has it enabled.
  const agAttls = [disc, gw, comp('api-catalog'), comp('caching-service'), comp('zaas')]
    .some(c => c && c.attls);

  // ── Inbound ────────────────────────────────────────────────────────────────
  {
    // Discovery and gateway are the only externally-exposed inbound ports.
    // All APIML components run under ${prefix}AG.
    if (disc && agAttls) {
      req.push({
        id: 'inbound:discovery', direction: 'Inbound', port: disc.port,
        label: `Inbound: Discovery Service (job ${px}AG, port ${disc.port})`,
        candidates: [`${px}AG`, `${px}*`],
      });
    }
    if (gw && agAttls) {
      req.push({
        id: 'inbound:gateway', direction: 'Inbound', port: gw.port,
        label: `Inbound: API Gateway (job ${px}AG, port ${gw.port})`,
        candidates: [`${px}AG`, `${px}*`],
      });
    }

    // app-server and zss remain as separate jobs
    if (app && app.attls) {
      // Same clustering logic as multi-service: in cluster mode the STC
      // (zowe.job.name) holds the inbound socket; workers are ${prefix}DS.
      const appJob = zoweConfig.appServerClustered ? zoweConfig.jobName : `${px}DS`;
      const appCandidates = zoweConfig.appServerClustered
        ? [zoweConfig.jobName, `${px}*`]
        : [`${px}DS`, `${px}*`];
      req.push({
        id: 'inbound:app-server', direction: 'Inbound', port: app.port,
        label: `Inbound: App Server (job ${appJob}, port ${app.port})`,
        candidates: appCandidates,
      });
    }
    if (zss && zss.attls) {
      req.push({
        id: 'inbound:zss', direction: 'Inbound', port: zss.port,
        label: `Inbound: ZSS (job ${px}SZ, port ${zss.port})`,
        candidates: [`${px}SZ`, `${px}*`],
      });
    }

    // Infinispan (caching runs inside the apiml single-service job)
    if (agAttls) {
      for (const { port, label } of zoweConfig.infinispanPorts) {
        req.push({
          id: `inbound:caching-${label}`, direction: 'Inbound', port,
          label: `Inbound: Caching infinispan ${label} (job ${px}AG, port ${port})`,
          candidates: [`${px}AG`, `${px}*`],
        });
      }
    }
  }

  // ── Outbound ───────────────────────────────────────────────────────────────
  // ${prefix}AG is the source for all outbound connections in single-service mode.
  // Only emit outbound requirements when the AG job has AT-TLS enabled.
  if (agAttls) {
    // ${prefix}AG → discovery (for HA replica between instances)
    if (disc) {
      req.push({
        id: 'outbound:ag→discovery', direction: 'Outbound', port: disc.port,
        label: `Outbound: APIML (${px}AG) → Discovery port ${disc.port}`,
        candidates: [`${px}AG`, `${px}*`],
      });
    }

    // ${prefix}AG → app-server (gateway routing)
    if (app) {
      req.push({
        id: 'outbound:ag→appserver', direction: 'Outbound', port: app.port,
        label: `Outbound: APIML (${px}AG) → App Server port ${app.port}`,
        candidates: [`${px}AG`, `${px}*`],
      });
    }

    // ${prefix}AG → zss (app-server / desktop routing through gateway)
    if (zss) {
      req.push({
        id: 'outbound:ag→zss', direction: 'Outbound', port: zss.port,
        label: `Outbound: APIML (${px}AG) → ZSS port ${zss.port}`,
        candidates: [`${px}AG`, `${px}*`],
      });
    }

    // ${prefix}AG → z/OSMF (user authentication — exempt from keyring check)
    if (zoweConfig.zosmf.port) {
      req.push({
        id: 'outbound:gw/zaas→zosmf', direction: 'Outbound', port: zoweConfig.zosmf.port,
        label: `Outbound: Gateway → z/OSMF port ${zoweConfig.zosmf.port}`,
        candidates: [`${px}AG`, `${px}A*`, `${px}*`],
      });
    }

    // ${prefix}AG → infinispan (caching replication)
    for (const { port, label } of zoweConfig.infinispanPorts) {
      req.push({
        id: `outbound:caching-${label}`, direction: 'Outbound', port,
        label: `Outbound: Caching infinispan ${label} (${px}AG, port ${port})`,
        candidates: [`${px}AG`, `${px}*`],
      });
    }
  }

  return req;
}

// ─────────────────────────────────────────────────────────────────────────────
// Coverage checker
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tests each required connection against the AT-TLS declarations map and
 * returns an array of result objects with status 'ok' | 'warn' | 'miss'.
 *
 * Each result carries:
 *   warnReasons: string[]  — reasons for a 'warn' status:
 *     'shadow'  — a higher-priority TTLSEnabled Off rule shadows the match
 *     'keyring' — the matched rule uses a TTLSKeyringParms whose Keyring value
 *                 does not match zowe.yaml's SAF keyring (Zowe-to-Zowe only;
 *                 z/OSMF outbound is exempt).
 *   keyringUsed: string|null — the keyring value found in the matched rule.
 */
function checkCoverage(declarations, zoweConfig) {
  const required = buildRequiredConnections(zoweConfig);
  return required.map(req => {
    // Deduplicate candidates while preserving order
    const seen = new Set();
    const candidates = req.candidates.filter(j => !seen.has(j) && seen.add(j));

    for (const jobName of candidates) {
      const { covered, rule, warn, shadower } = findBestRule(
        declarations, req.direction, req.port, jobName
      );
      if (covered || warn) {
        const warnReasons = warn ? ['shadow'] : [];
        let keyringUsed = null;

        // Keyring check: skip z/OSMF outbound (may legitimately use a different
        // CA-only keyring) and skip when zowe.yaml has no SAF keyring configured.
        const isZosmfConn = req.id === 'outbound:gw/zaas→zosmf';
        if (!isZosmfConn && zoweConfig.zoweKeyring && rule) {
          keyringUsed = resolveKeyringForRule(declarations, rule);
          if (keyringUsed && !keyringMatches(keyringUsed, zoweConfig.zoweKeyring)) {
            warnReasons.push('keyring');
          }
        }

        return {
          ...req,
          status:      warnReasons.length > 0 ? 'warn' : 'ok',
          rule,
          shadower,
          matchedJob:  jobName,
          warnReasons,
          keyringUsed,
        };
      }
    }
    return { ...req, status: 'miss', rule: null, warnReasons: [], keyringUsed: null };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary helper (used by report builder and tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a plain object summarising the coverage results.
 * Suitable for programmatic consumption (tests, JSON output, etc.).
 */
function summariseResults(results) {
  const total           = results.length;
  const ok              = results.filter(r => r.status === 'ok').length;
  const warn            = results.filter(r => r.status === 'warn').length;
  const miss            = results.filter(r => r.status === 'miss').length;
  const missed          = results.filter(r => r.status === 'miss').map(r => r.id);
  const warnings        = results.filter(r => r.status === 'warn').map(r => r.id);
  const keyringWarnings = results
    .filter(r => r.warnReasons && r.warnReasons.includes('keyring'))
    .map(r => r.id);

  return { total, ok, warn, miss, missed, warnings, keyringWarnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  parseAttlsFile,
  parseZoweYaml,
  buildRequiredConnections,
  checkCoverage,
  summariseResults,
  findRulesAffectingExtensions,
  // Exported for unit testing
  _internal: {
    parseBlockProps,
    portRangeCoversPort,
    resolveRulePortRange,
    jobnameMatches,
    findBestRule,
    normalizeZoweKeyring,
    resolveKeyringForRule,
    keyringMatches,
    findRulesAffectingExtensions,
  },
};
