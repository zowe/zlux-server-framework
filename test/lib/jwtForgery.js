/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const crypto = require('crypto');

// Forged-JWT generators mirroring APIML's JwtPenTest.java (integration-tests/
// src/test/java/org/zowe/apiml/integration/penetration/JwtPenTest.java), used
// to prove zlux's own auth endpoints reject the same attack shapes APIML tests for.

function base64urlEncode(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4 !== 0) {
    str += '=';
  }
  return Buffer.from(str, 'base64');
}

function encodeSegments(header, payload) {
  return [
    base64urlEncode(Buffer.from(JSON.stringify(header))),
    base64urlEncode(Buffer.from(JSON.stringify(payload)))
  ];
}

function rs256Token(header, payload, privateKeyPem) {
  const [encodedHeader, encodedPayload] = encodeSegments(header, payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = base64urlEncode(
    crypto.createSign('RSA-SHA256').update(signingInput).sign(privateKeyPem)
  );
  return `${signingInput}.${signature}`;
}

// Corresponds to JwtPenTest#getTokenNoneAlgorithm: strips the signature entirely.
function noneAlgToken(payload) {
  const [header, body] = encodeSegments({ alg: 'none', typ: 'JWT' }, payload);
  return `${header}.${body}.`;
}

// Corresponds to JwtPenTest#getTokenWithHs256Signature: the classic RS256->HS256
// key-confusion attack, signing with HMAC using the server's PUBLIC key bytes
// (public, by definition, so an attacker can obtain them) as the HMAC secret.
function hs256KeyConfusionToken(payload, certificatePem) {
  const [header, body] = encodeSegments({ alg: 'HS256', typ: 'JWT' }, payload);
  const signingInput = `${header}.${body}`;
  const publicKeyDer = new crypto.X509Certificate(certificatePem).publicKey
    .export({ type: 'spki', format: 'der' });
  const signature = base64urlEncode(
    crypto.createHmac('sha256', publicKeyDer).update(signingInput).digest()
  );
  return `${signingInput}.${signature}`;
}

// Corresponds to JwtPenTest#getTokenChangedRealm / #getTokenChangedUser: edits a
// claim in an otherwise validly-signed token, leaving its (now stale) signature intact.
function tamperClaim(token, claimName, newValue) {
  const [header, body, signature] = token.split('.');
  const payload = JSON.parse(base64urlDecode(body).toString('utf8'));
  payload[claimName] = newValue;
  const newBody = base64urlEncode(Buffer.from(JSON.stringify(payload)));
  return `${header}.${newBody}.${signature}`;
}

module.exports = {
  rs256Token,
  noneAlgToken,
  hs256KeyConfusionToken,
  tamperClaim
};
