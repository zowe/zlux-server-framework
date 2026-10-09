/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const https = require('https');
const http = require('http');
const loggingUtils = require('../../../lib/loggingUtils');

const ZOSMF_AUTHENTICATE_PATH = '/zosmf/services/authenticate';
const ZOSMF_CSRF_HEADER = 'X-CSRF-ZOSMF-HEADER';
const ZOSMF_INFO_PATH = '/zosmf/info';
const ZOSMF_JWK_PATH = '/jwt/ibm/api/zOSMFBuilder/jwk';

const ZOSMF_JWK_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const ZOSMF_REQUEST_TIMEOUT_MS = 30 * 1000;

const ZOSMF_JWT_COOKIE_NAME = 'jwtToken';
const ZOSMF_LTPA_COOKIE_NAME = 'LtpaToken2';

/*
 * Handles communication with z/OSMF.  Has no knowledge of the
 * auth handler interface, Express sessions, or JWT lifecycle. 
 *
 * Token issuance and session management are the concern of GatewayApiHandler,
 * which owns this client as a dependency.
 */
class ZosmfClient {

  constructor({ logger, zosmfConf, isHttps, httpsAgent, httpAgent, httpModule }) {
    this.logger      = logger;
    this.zosmfConf   = zosmfConf;
    this.isHttps     = isHttps;
    this.httpsAgent  = httpsAgent;
    this.httpAgent   = httpAgent;
    this.httpModule  = httpModule;
  }

  _makeRequestOptions(path, method, additionalHeaders, body) {
    const headers = Object.assign({ [ZOSMF_CSRF_HEADER]: '' }, additionalHeaders || {});
    if ((method === 'POST' || method === 'PUT') && !headers['Content-Length'] && !headers['content-length']) {
      const bodyLen = body ? Buffer.byteLength(body) : 0;
      headers['Content-Length'] = String(bodyLen);
    }
    return {
      hostname: this.zosmfConf.host,
      port:     this.zosmfConf.port,
      path:     path,
      method:   method,
      headers,
      agent:    this.isHttps ? this.httpsAgent : this.httpAgent
    };
  }

  _extractCookieValue(setCookieHeaders, cookieName) {
    for (const setCookie of setCookieHeaders) {
      const nameValuePair = setCookie.split(';')[0].trim();
      if (nameValuePair.startsWith(cookieName + '=')) {
        return nameValuePair.substring(cookieName.length + 1);
      }
    }
    return null;
  }

  /*
   * Returns { zosmfJwt, ltpaToken } where either may be null.
   */
  _extractZosmfCookies(setCookieHeaders) {
    return {
      zosmfJwt:  this._extractCookieValue(setCookieHeaders, ZOSMF_JWT_COOKIE_NAME),
      ltpaToken: this._extractCookieValue(setCookieHeaders, ZOSMF_LTPA_COOKIE_NAME),
    };
  }

  /*
   * Always resolves (never rejects); the caller inspects the `success` field:
   *   { success: true,  setCookieHeaders: string[] }
   *   { success: false, statusCode: number, statusMessage: string, body: string }
   *   { success: false, networkError: string }
   */
  doLogin(username, password) {
    return new Promise((resolve) => {
      const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
      const options   = this._makeRequestOptions(ZOSMF_AUTHENTICATE_PATH, 'POST', {
        'Authorization': `Basic ${basicAuth}`
      });

      this.logger.debug(
        'ZosmfClient: login attempt for %s -> %s://%s:%d%s (isHttps=%s)',
        username,
        this.isHttps ? 'https' : 'http',
        options.hostname, options.port, options.path,
        String(this.isHttps)
      );
      this.logger.debug(
        'ZosmfClient: login request headers: %s',
        JSON.stringify(loggingUtils.sanitizeHeadersForLogging(options.headers))
      );

      const req = this.httpModule.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          this.logger.debug(
            'ZosmfClient: login response status=%d message=%s',
            res.statusCode, res.statusMessage
          );
          this.logger.debug(
            'ZosmfClient: login response headers: %s',
            JSON.stringify(loggingUtils.sanitizeHeadersForLogging(res.headers))
          );

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const body = Buffer.concat(chunks).toString();
            this.logger.warn(
              'ZosmfClient: login rejected by z/OSMF (HTTP %d %s), body: %s',
              res.statusCode, res.statusMessage, body.substring(0, 512)
            );
            resolve({ success: false, statusCode: res.statusCode, statusMessage: res.statusMessage, body });
            return;
          }

          const setCookieHeaders = res.headers['set-cookie'] || [];
          this.logger.debug(
            'ZosmfClient: Set-Cookie headers received: %d',
            setCookieHeaders.length
          );
          resolve({ success: true, setCookieHeaders });
        });
      });

      req.on('error', (error) => {
        this.logger.warn(
          'ZosmfClient: login request to %s://%s:%d%s failed: %s (code=%s)',
          this.isHttps ? 'https' : 'http',
          options.hostname, options.port, options.path,
          error.message, error.code || 'n/a'
        );
        resolve({ success: false, networkError: error.message });
      });

      // No body; Content-Length:0 is set by _makeRequestOptions so z/OSMF
      // knows the request is complete immediately.
      req.end();
    });
  }

  /*
   * Confirms token authenticity via z/OSMF query as the sole authority.
   *
   * Tries ZOSMF_AUTHENTICATE_PATH first, then ZOSMF_INFO_PATH.
   * The first endpoint to answer definitively (200 or 401) wins; if every
   * endpoint is inconclusive (network error, unexpected status), the token is
   * treated as unverifiable rather than trusted.
   *
   * @param {string} token
   * @returns {Promise<{valid: boolean, reason?: 'invalid'|'unreachable'}>}
   */
  verifyToken(token) {
    const cookieHeader = { 'Cookie': `${ZOSMF_JWT_COOKIE_NAME}=${token}` };
    const attempts = [
      { path: ZOSMF_AUTHENTICATE_PATH, method: 'POST' },
      { path: ZOSMF_INFO_PATH, method: 'GET' }
    ];

    const tryAt = (index) => {
      if (index >= attempts.length) {
        return Promise.resolve({ valid: false, reason: 'unreachable' });
      }
      const { path, method } = attempts[index];
      const options = this._makeRequestOptions(path, method, cookieHeader);

      return new Promise((resolve) => {
        const req = this.httpModule.request(options, (res) => {
          res.on('data', () => {});
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve({ valid: true });
            } else if (res.statusCode === 401) {
              resolve({ valid: false, reason: 'invalid' });
            } else {
              this.logger.debug(
                'ZosmfClient: verifyToken at %s returned inconclusive HTTP %d', path, res.statusCode
              );
              resolve(null);
            }
          });
        });
        req.on('error', (error) => {
          this.logger.debug('ZosmfClient: verifyToken at %s failed: %s', path, error.message);
          resolve(null);
        });
        req.end();
      }).then((result) => result || tryAt(index + 1));
    };

    return tryAt(0);
  }

  /*
   * Invalidates a native z/OSMF JWT or LTPA credential.
   * Always resolves so local logout can finish even when z/OSMF is unavailable.
   */
  invalidateToken(cookieName, token) {
    if (![ZOSMF_JWT_COOKIE_NAME, ZOSMF_LTPA_COOKIE_NAME].includes(cookieName) || !token) {
      this.logger.warn('ZosmfClient: native token invalidation skipped because the credential type is invalid.');
      return Promise.resolve({ success: false, reason: 'invalidCredential' });
    }

    const options = this._makeRequestOptions(ZOSMF_AUTHENTICATE_PATH, 'DELETE', {
      'Cookie': `${cookieName}=${token}`
    });

    return new Promise((resolve) => {
      let completed = false;
      const finish = (result) => {
        if (!completed) {
          completed = true;
          resolve(result);
        }
      };

      const req = this.httpModule.request(options, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            finish({ success: true });
            return;
          }
          const reason = res.statusCode === 404 ? 'unsupported' : 'rejected';
          this.logger.warn(
            'ZosmfClient: native %s invalidation failed with HTTP %d (%s).',
            cookieName, res.statusCode, reason
          );
          finish({ success: false, reason, statusCode: res.statusCode });
        });
      });

      req.on('error', (error) => {
        this.logger.warn(
          'ZosmfClient: native %s invalidation request failed (code=%s).',
          cookieName, error.code || 'n/a'
        );
        finish({ success: false, reason: 'unreachable' });
      });
      req.setTimeout(ZOSMF_REQUEST_TIMEOUT_MS, () => {
        this.logger.warn('ZosmfClient: native %s invalidation request timed out.', cookieName);
        finish({ success: false, reason: 'timeout' });
        req.destroy();
      });
      req.end();
    });
  }

  /*
   * Fetches the z/OSMF JWK Set from Liberty's public endpoint.
   * Used only in JWT mode when z/OSMF owns the signing key.
   * The result is cached for ZOSMF_JWK_CACHE_TTL_MS.
   *
   * Resolves with { keys: [...] }; resolves with { keys: [] } on any error so
   * that callers (ZSS, etc.) fall back to their configured fallback rather than
   * crashing.
   */
  getJwkSet() {
    const now = Date.now();
    if (this._jwkSetCache && (now - this._jwkSetCacheFetchedAt) < ZOSMF_JWK_CACHE_TTL_MS) {
      return Promise.resolve(this._jwkSetCache);
    }

    return new Promise((resolve) => {
      const options = this._makeRequestOptions(ZOSMF_JWK_PATH, 'GET', {});
      delete options.headers['Content-Length'];
      delete options.headers['content-length'];

      const req = this.httpModule.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            this.logger.warn(
              'ZosmfClient: z/OSMF JWK endpoint returned HTTP %d; returning empty key set.',
              res.statusCode
            );
            resolve({ keys: [] });
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString());
          } catch (e) {
            this.logger.warn('ZosmfClient: failed to parse z/OSMF JWK response: %s', e.message);
            resolve({ keys: [] });
            return;
          }
          if (!parsed || !Array.isArray(parsed.keys)) {
            this.logger.warn('ZosmfClient: z/OSMF JWK response missing "keys" array; returning empty key set.');
            resolve({ keys: [] });
            return;
          }
          this._jwkSetCache          = parsed;
          this._jwkSetCacheFetchedAt = Date.now();
          this.logger.debug(
            'ZosmfClient: fetched %d key(s) from z/OSMF JWK endpoint; cached for %d ms',
            parsed.keys.length, ZOSMF_JWK_CACHE_TTL_MS
          );
          resolve(parsed);
        });
      });

      req.on('error', (error) => {
        this.logger.warn(
          'ZosmfClient: error fetching z/OSMF JWK endpoint %s://%s:%d%s: %s',
          this.isHttps ? 'https' : 'http',
          this.zosmfConf.host, this.zosmfConf.port, ZOSMF_JWK_PATH,
          error.message
        );
        resolve({ keys: [] });
      });

      req.end();
    });
  }
}

module.exports = {
  ZosmfClient,
  ZOSMF_JWT_COOKIE_NAME,
  ZOSMF_LTPA_COOKIE_NAME,
  ZOSMF_CSRF_HEADER,
};

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
