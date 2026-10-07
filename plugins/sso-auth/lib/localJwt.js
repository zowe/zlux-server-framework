/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const crypto = require('crypto');
const pluginStorage = require('../../../lib/pluginStorage');

/*
 * Shared JWT utilities for the sso-auth plugin as a backup for if APIML is unavailable.
 * All issuance and verification here is local to this Zowe instance.  
 */

// synthetic storage id, not a real plugin. namespaces this in the same cluster/HA storage other plugins use
const REVOKED_TOKENS_STORAGE_ID = 'org.zowe.zlux.revokedTokens';

// Lazily constructed: PluginStorageFactory snapshots apimlStorage.isConfigured()
// at construction time. Building this eagerly at module-load time could run
// before apimlStorage.configure() during server startup and permanently miss
// the HA/caching-service backing store (see webauth.js's login rate limiter,
// which hit the same ordering issue).
let revokedTokensStorage = null;
function _getRevokedTokensStorage(logger) {
  if (!revokedTokensStorage) {
    revokedTokensStorage = pluginStorage.PluginStorageFactory(REVOKED_TOKENS_STORAGE_ID, logger);
  }
  return revokedTokensStorage;
}

/*
 * Default session length — 495 minutes — used when the token itself does not
 * carry an expiration claim (e.g. a locally-issued JWT wrapping an LTPA session).
 * Matches the z/OSMF default.
 */
const DEFAULT_EXPIRATION_MS = 29700000;

const LOCAL_JWT_ALGORITHM = 'RS256';
const LOCAL_JWT_ISSUER = 'org.zowe.zlux';

const TOKEN_NAME = 'apimlAuthenticationToken';

const TOKEN_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/'
});

function makeTokenCookieOptions(overrides) {
  return Object.assign({}, TOKEN_COOKIE_OPTIONS, overrides);
}

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

/*
 * Reads the Zowe component TLS private key and certificate from tlsOptions and
 * returns them as a key-material object suitable for createLocalJwt /
 * verifyLocalJwt.
 *
 * If the required key material is absent, the process exits
 *
 * @returns {{ algorithm: 'RS256', privateKeyPem: Buffer|string, certificatePem: Buffer|string }}
 */
function extractTlsKeyMaterial(logger, tlsOptions) {
  const keyMat  = tlsOptions && Array.isArray(tlsOptions.key)  && tlsOptions.key[0]
    ? tlsOptions.key[0]  : null;
  const certMat = tlsOptions && Array.isArray(tlsOptions.cert) && tlsOptions.cert[0]
    ? tlsOptions.cert[0] : null;

  if (!keyMat || !certMat) {
    logger.severe('ZWED0171E'); //TLS key/certificate not available. JWTs cannot be generaated, shutting down.'
    process.exit(1);
  }

  return { algorithm: 'RS256', privateKeyPem: keyMat, certificatePem: certMat };
}

/*
 * Creates a locally-signed JWT for a user whose identity has already been
 * established by an upstream authentication backend (z/OSMF LTPA, ZSS, etc.).
 *
 * The token payload follows the standard Zowe convention:
 *   iss  = 'org.zowe.zlux'  (distinguishes local JWTs from APIML or z/OSMF tokens)
 *   sub  = username (uppercased by callers before passing in)
 *   iat  = issue time (seconds since epoch)
 *   exp  = expiry time (seconds since epoch, iat + expirationMs/1000)
 *
 * keyMaterial must be the value returned by extractTlsKeyMaterial().
 * Only RS256 is supported for locally-issued tokens.
 *
 * @param {string} username
 * @param {number} expirationMs - milliseconds until the token expires
 * @param {{ algorithm: string, privateKeyPem: Buffer|string, certificatePem: Buffer|string }} keyMaterial
 * @returns {string} compact JWT
 */
function createLocalJwt(username, expirationMs, keyMaterial) {
  if (!keyMaterial || keyMaterial.algorithm !== LOCAL_JWT_ALGORITHM
      || !keyMaterial.privateKeyPem) {
    throw new Error('Local JWT issuance requires RS256 private key material');
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = Math.floor((Date.now() + expirationMs) / 1000);
  const header  = { alg: LOCAL_JWT_ALGORITHM, typ: 'JWT' };
  const payload = { iss: LOCAL_JWT_ISSUER, sub: username, iat: nowSec, exp: expSec };

  const encodedHeader  = base64urlEncode(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64urlEncode(Buffer.from(JSON.stringify(payload)));
  const signingInput   = `${encodedHeader}.${encodedPayload}`;

  const signature = base64urlEncode(crypto.createSign('RSA-SHA256').update(signingInput).sign(keyMaterial.privateKeyPem));
  return `${signingInput}.${signature}`;
}

/*
 * Verifies a locally-issued JWT (iss === 'org.zowe.zlux') and returns its
 * decoded payload, or null if verification fails for any reason.
 *
 * The protected header must specify RS256, the signature must match the
 * configured certificate, the issuer must be exactly org.zowe.zlux, and exp
 * must be a finite NumericDate strictly in the future.
 *
 * @param {string} token
 * @param {{ algorithm: string, certificatePem: Buffer|string }} keyMaterial
 * @returns {object|null} decoded payload or null
 */
function verifyLocalJwt(token, keyMaterial) {
  if (typeof token !== 'string' || !keyMaterial
      || keyMaterial.algorithm !== LOCAL_JWT_ALGORITHM
      || !keyMaterial.certificatePem) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  let header;
  let payload;
  try {
    header = JSON.parse(base64urlDecode(parts[0]).toString('utf8'));
    payload = JSON.parse(base64urlDecode(parts[1]).toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!header || header.alg !== LOCAL_JWT_ALGORITHM) {
    return null;
  }

  const signingInput = `${parts[0]}.${parts[1]}`;
  let verified;
  try {
    verified = crypto.createVerify('RSA-SHA256')
      .update(signingInput)
      .verify(keyMaterial.certificatePem, base64urlDecode(parts[2]));
  } catch (e) {
    return null;
  }

  if (!verified) {
    return null;
  }
  const expirationMs = payload && payload.exp * 1000;
  if (!payload || payload.iss !== LOCAL_JWT_ISSUER
      || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)
      || !Number.isFinite(expirationMs) || Date.now() >= expirationMs) {
    return null;
  }
  return payload;
}

/*
 * Decodes only the payload portion of a JWT without verifying the signature.
 *
 * SAFE only for a token this server just received directly from z/OSMF's own
 * Set-Cookie response (server-to-server), or one already confirmed authentic
 * by a round-trip check (e.g. ZosmfClient.verifyToken). NEVER call this on a
 * token supplied by a client on a later request -- it carries no proof the
 * claims (sub, exp, ...) haven't been forged.
 *
 * @param {string} token
 * @returns {object|null} decoded payload or null
 */
function decodeJwtPayloadUnsafe(token) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    return JSON.parse(base64urlDecode(parts[1]).toString('utf8'));
  } catch (e) {
    return null;
  }
}

/*
 * Derives a JSON Web Key (JWK) object from the RSA public key embedded in the
 * Zowe TLS certificate carried by keyMaterial.
 *
 * @param {{ algorithm: string, privateKeyPem: Buffer|string, certificatePem: Buffer|string }} keyMaterial
 * @returns {{ kty: string, use: string, alg: string, kid: string, n: string, e: string }}
 */
function derivePublicJwk(keyMaterial) {
  const x509 = new crypto.X509Certificate(keyMaterial.certificatePem);

  // SHA-256 thumbprint of the DER-encoded certificate — stable identifier.
  const kid = crypto.createHash('sha256')
    .update(x509.raw)
    .digest('base64url')
    .slice(0, 16);

  // Export the RSA public key in JWK format (Node returns { kty, n, e, ... }).
  const jwk = x509.publicKey.export({ format: 'jwk' });

  return {
    kty: jwk.kty,
    use: 'sig',
    alg: 'RS256',
    kid,
    n: jwk.n,
    e: jwk.e,
  };
}

/*
 * Cookie takes precedence so that existing browser-based flows are unaffected.
 * Bearer support allows non-browser API clients (CLI tools, service-to-service
 * calls) that cannot store cookies to authenticate using the JWT directly.
 *
 * Returns null when neither source provides a non-empty token value.
 *
 * @param {object} req        - Express Request object
 * @param {string} cookieName - Name of the session cookie (usually TOKEN_NAME)
 * @returns {string|null}
 */
function extractAuthToken(req, cookieName) {
  const cookie = req.cookies && req.cookies[cookieName];
  if (cookie) {
    return cookie;
  }
  const authHeader = req.headers && req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim();
    return t || null;
  }
  return null;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('base64url');
}

/*
 * Records a token as revoked (called on logout) so authenticateViaToken /
 * restoreSessionState / queryJWT reject it even though its signature and
 * exp claim still check out.
 *
 * expirationMs is the token's own exp claim in epoch ms. It is not used to
 * enforce anything here
 *
 * Fails open (logs and resolves)
 *
 * @param {string} token
 * @param {number} expirationMs
 * @param {object} logger
 * @returns {Promise<void>}
 */
function revokeToken(token, expirationMs, logger) {
  return _getRevokedTokensStorage(logger).set(hashToken(token), {
    revokedAtMs: Date.now(),
    expMs: expirationMs
  }).catch((e) => {
    logger.warn('ZWED0188W', e.message); //Failed to record token revocation. Error=${e.message}`);
  });
}

/*
 * Fails open (resolves false, i.e. not revoked) on storage errors
 *
 * @param {string} token
 * @param {object} logger
 * @returns {Promise<boolean>}
 */
function isTokenRevoked(token, logger) {
  const storage = _getRevokedTokensStorage(logger);
  const key = hashToken(token);
  return storage.get(key).then((entry) => {
    if (!entry) {
      return false;
    }
    if (entry.expMs && entry.expMs <= Date.now()) {
      // Past its natural expiry -- the exp check rejects it regardless, so
      // opportunistically prune the entry instead of keeping it forever.
      storage.delete(key).catch(() => {});
      return false;
    }
    return true;
  }).catch((e) => {
    logger.warn('ZWED0189W', e.message); //Failed to check token revocation, allowing. Error=${e.message}`);
    return false;
  });
}

module.exports = {
  DEFAULT_EXPIRATION_MS,
  TOKEN_NAME,
  TOKEN_COOKIE_OPTIONS,
  makeTokenCookieOptions,
  extractTlsKeyMaterial,
  createLocalJwt,
  verifyLocalJwt,
  decodeJwtPayloadUnsafe,
  derivePublicJwk,
  extractAuthToken,
  revokeToken,
  isTokenRevoked,
};

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
