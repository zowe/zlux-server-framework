/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const Promise   = require('bluebird');
const https     = require('https');
const http      = require('http');
const zluxUtil  = require('../../../lib/util.js');
const localJwt  = require('./localJwt');
const { ZosmfClient, ZOSMF_JWT_COOKIE_NAME, ZOSMF_LTPA_COOKIE_NAME, ZOSMF_CSRF_HEADER } = require('./zosmfClient');

const {
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
} = localJwt;

/*
 * Auth handler for deployments where APIML is unavailable.
 *
 * Implements JWT lifecycle methods (queryToken, getJwkSet) used in fallback routes.
 *
 * Credential validation is delegated to z/OSMF, while
 * all token issuance, session management, and transport-layer token extraction are here.
 */
class GatewayApiHandler {

  constructor(pluginDef, pluginConf, serverConf, context, zoweConf) {
    this.logger    = context.logger;
    this.zosmfConf = zoweConf.zOSMF;

    const isHttps = !zluxUtil.isClientAttls(zoweConf);
    let httpsAgent = null;
    let httpAgent  = null;
    let httpModule;

    if (isHttps) {
      // Strip key/cert so zlux's client certificate is NOT presented to z/OSMF.
      const agentTlsOptions = Object.assign({}, context.tlsOptions || {});
      delete agentTlsOptions.key;
      delete agentTlsOptions.cert;
      httpsAgent = new https.Agent(agentTlsOptions);
      httpModule = https;
    } else {
      httpAgent  = new http.Agent();
      httpModule = http;
    }

    const jwtAutoConfig = zoweConf?.components?.gateway?.apiml?.security?.auth?.zosmf?.jwtAutoconfiguration;
    this.jwtMode = (jwtAutoConfig === 'jwt');

    // In LTPA mode we sign local JWTs with the Zowe TLS private key.
    // In JWT mode z/OSMF owns the key; no local key material needed here.
    this.keyMaterial = this.jwtMode ? null : extractTlsKeyMaterial(this.logger, context.tlsOptions);

    this.zosmfClient = new ZosmfClient({
      logger: this.logger,
      zosmfConf: this.zosmfConf,
      isHttps,
      httpsAgent,
      httpAgent,
      httpModule,
    });

    this.logger.debug('host=%s:%d, mode=%s, isHttps=%s', this.zosmfConf.host, this.zosmfConf.port, jwtAutoConfig || 'ltpa', String(isHttps));
  }

  /*
   * Returns { apimlToken, expms, nativeCookieName, nativeCookieValue } or null
   * if no usable token is present.
   */
  _buildTokenFromZosmfCookies(setCookieHeaders, username) {
    const { zosmfJwt, ltpaToken } = this.zosmfClient._extractZosmfCookies(setCookieHeaders);

    if (this.jwtMode && zosmfJwt) {
      // JWT mode: z/OSMF's JWT is the session token; keep it as the native cookie.
      // Safe to decode without verification here only because zosmfJwt was just
      // received directly from z/OSMF's own Set-Cookie response, not from a client.
      const payload = decodeJwtPayloadUnsafe(zosmfJwt);
      const expms = (payload && payload.exp)
        ? Math.max(0, payload.exp * 1000 - Date.now())
        : DEFAULT_EXPIRATION_MS;
      return { apimlToken: zosmfJwt, expms,
               nativeCookieName: ZOSMF_JWT_COOKIE_NAME, nativeCookieValue: zosmfJwt };
    }

    if (!this.jwtMode && ltpaToken) {
      // LTPA mode: wrap the LTPA session in a locally-signed JWT the browser
      // stores as apimlAuthenticationToken; preserve the raw LtpaToken2 value
      // so it can be forwarded to z/OSMF on subsequent proxied calls.
      const expms = DEFAULT_EXPIRATION_MS;
      return { apimlToken: createLocalJwt(username, expms, this.keyMaterial), expms,
               nativeCookieName: ZOSMF_LTPA_COOKIE_NAME, nativeCookieValue: ltpaToken };
    }

    // Tolerance fallbacks: handle mode mismatches gracefully.
    if (zosmfJwt) {
      // Same as above: zosmfJwt here still came straight from z/OSMF's Set-Cookie, not a client.
      const payload = decodeJwtPayloadUnsafe(zosmfJwt);
      const expms = (payload && payload.exp)
        ? Math.max(0, payload.exp * 1000 - Date.now())
        : DEFAULT_EXPIRATION_MS;
      return { apimlToken: zosmfJwt, expms,
               nativeCookieName: ZOSMF_JWT_COOKIE_NAME, nativeCookieValue: zosmfJwt };
    }

    if (ltpaToken) {
      const expms = DEFAULT_EXPIRATION_MS;
      return { apimlToken: createLocalJwt(username, expms, this.keyMaterial), expms,
               nativeCookieName: ZOSMF_LTPA_COOKIE_NAME, nativeCookieValue: ltpaToken };
    }

    return null;
  }

  /*
   * Sends login credentials to z/OSMF and maps the response token to our token cookie.
   */
  doLogin(request, sessionState) {
    const username = request.body.username;
    const password = request.body.password;

    return this.zosmfClient.doLogin(username, password).then((result) => {
      if (!result.success) {
        return {
          success: false,
          reason: result.statusCode === 401 ? 'BadCredentials' : 'Unknown',
          error: {
            message: result.networkError
              ? `z/OSMF connection error: ${result.networkError}`
              : `z/OSMF ${result.statusCode} ${result.statusMessage}`
          }
        };
      }

      const tokenResult = this._buildTokenFromZosmfCookies(result.setCookieHeaders, username);
      if (!tokenResult) {
        this.logger.warn('GatewayApiHandler: login succeeded but no usable token in z/OSMF Set-Cookie.');
        return {
          success: false,
          reason: 'Unknown',
          error: { message: 'No security token in z/OSMF response' }
        };
      }

      const { apimlToken, expms, nativeCookieName, nativeCookieValue } = tokenResult;
      this.logger.debug('GatewayApiHandler: login succeeded for %s, nativeCookieName=%s, expms=%d', username, nativeCookieName, expms);
      sessionState.username               = username.toUpperCase();
      sessionState.zosmfToken             = apimlToken;
      sessionState.zosmfTokenExpMs        = Date.now() + expms;
      sessionState.zosmfNativeCookieName  = nativeCookieName;
      sessionState.zosmfNativeCookieValue = nativeCookieValue;

      return {
        success: true,
        username: sessionState.username,
        expms,
        cookies: [{ name: TOKEN_NAME, value: apimlToken, options: TOKEN_COOKIE_OPTIONS }]
      };
    });
  }

  /*
   * Converts decoded JWT claims into the {userId, creation, expiration, domain}
   * shape callers expect, rejecting already-expired tokens.
   */
  _claimsToQueryResult(payload) {
    const now        = Date.now();
    const creation   = payload.iat ? payload.iat * 1000 : now;
    const expiration = payload.exp * 1000;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)
        || !Number.isFinite(expiration) || expiration <= now) {
      throw new Error('Token expiration is missing, invalid, or expired');
    }
    return { userId: payload.sub, creation, expiration, domain: payload.dom || null };
  }

  /*
   * Validates an apimlAuthenticationToken and returns its claims.
   *
   * JWT mode  – the token is a z/OSMF-issued JWT presented by a client, so its
   *             claims cannot be trusted on their own. z/OSMF is asked to
   *             confirm the token's authenticity first (ZosmfClient.verifyToken,
   *             the same round-trip model APIML's AuthenticatedEndpointStrategy
   *             uses); only after that succeeds are the claims decoded.
   * LTPA mode – the token is a locally-signed RS256 JWT; verify the signature.
   *
   * Both modes also reject a token this server has recorded as revoked 
   * on an earlier logout, even though its signature/round-trip and exp claim
   * still check out.
   *
   * @param {string} token
   * @returns {Promise<{userId, creation, expiration, domain}>}
   */
  queryToken(token) {
    if (this.jwtMode) {
      return this.zosmfClient.verifyToken(token).then((result) => {
        if (!result.valid) {
          throw new Error(result.reason === 'unreachable'
            ? 'Cannot validate z/OSMF JWT: z/OSMF is not reachable'
            : 'Token rejected by z/OSMF');
        }
        const payload = decodeJwtPayloadUnsafe(token);
        if (!payload || !payload.sub) {
          throw new Error('Cannot decode z/OSMF JWT payload');
        }
        return isTokenRevoked(token, this.logger).then((revoked) => {
          if (revoked) {
            throw new Error('Token has been revoked');
          }
          return this._claimsToQueryResult(payload);
        });
      });
    }
    return new Promise((resolve, reject) => {
      const payload = verifyLocalJwt(token, this.keyMaterial);
      if (!payload) {
        reject(new Error('Invalid or tampered zlux-local JWT'));
        return;
      }
      isTokenRevoked(token, this.logger).then((revoked) => {
        if (revoked) {
          reject(new Error('Token has been revoked'));
          return;
        }
        try {
          resolve(this._claimsToQueryResult(payload));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  /*
   * Returns the JWK Set for verifying apimlAuthenticationTokens.
   *
   * LTPA mode: derives the public JWK from the local Zowe TLS certificate.
   * JWT mode:  fetches (and caches) from z/OSMF's Liberty JWK endpoint via
   *            ZosmfClient.getJwkSet().
   *
   * @returns {Promise<{ keys: object[] }>}
   */
  getJwkSet() {
    if (!this.jwtMode) {
      return Promise.resolve({ keys: [derivePublicJwk(this.keyMaterial)] });
    }
    return this.zosmfClient.getJwkSet();
  }

  /*
   * Validates the auth token already present in the request — cookie or
   * Authorization: Bearer header — without a fresh credential prompt.
   *
   * For JWT mode the token IS the z/OSMF JWT, so the native cookie can be
   * reconstructed directly.  For LTPA mode the native LtpaToken2 value is not
   * recoverable from the local JWT alone; it will only be available in the
   * session store when set by a fresh doLogin in the same session.
   */
  authenticateViaToken(token, sessionState) {
    return new Promise((resolve, reject) => {
      this.queryToken(token).then((data) => {
        const expms = data.expiration - Date.now();
        if (expms < 1) {
          this.cleanupSession(sessionState);
          resolve({ success: false, reason: 'Expired' });
          return;
        }
        sessionState.username    = data.userId.toUpperCase();
        sessionState.zosmfToken  = token;
        sessionState.zosmfTokenExpMs = data.expiration;
        if (this.jwtMode && !sessionState.zosmfNativeCookieName) {
          sessionState.zosmfNativeCookieName  = ZOSMF_JWT_COOKIE_NAME;
          sessionState.zosmfNativeCookieValue = token;
        }
        resolve({ success: true, username: sessionState.username, expms });
      }).catch((e) => {
        this.logger.debug('token query failed: %s', e.message);
        reject(e);
      });
    });
  }

  /*
   * Precedence:
   *   1. Request body with credentials: fresh z/OSMF login
   *   2. apimlAuthenticationToken cookie: re-validate existing token
   *   3. Authorization: Bearer <token>: re-validate existing token
   *   4. None of the above: { success: false }
   */
  authenticate(request, sessionState) {
    if (request.body && Object.keys(request.body).length !== 0) {
      return new Promise((resolve) => {
        this.doLogin(request, sessionState).then(resolve).catch(() => {
          resolve({ success: false });
        });
      });
    }
    const token = extractAuthToken(request, TOKEN_NAME);
    if (token) {
      return this.authenticateViaToken(token, sessionState);
    }
    return Promise.resolve({ success: false });
  }

  authorized(request, sessionState) {
    if (sessionState.authenticated) {
      request.username  = sessionState.username;
      request.ssoToken  = extractAuthToken(request, TOKEN_NAME);
      return Promise.resolve({ authenticated: true, authorized: true });
    }
    return Promise.resolve({ authenticated: false, authorized: false });
  }

  /*
   * Injects the z/OSMF native security cookie and mandatory CSRF header into
   * the options object for the outgoing proxied request.
   *
   * z/OSMF requires its own cookie (jwtToken or LtpaToken2) on every
   * authenticated REST call.  The CSRF header is required on all requests.
   *
   * The native cookie is stored in sessionState by doLogin/restoreSessionState
   * and persists across requests in the Express session store.
   */
  addProxyAuthorizations(req1, req2Options, sessionState) {
    if (!req2Options.headers) {
      req2Options.headers = {};
    }
    req2Options.headers[ZOSMF_CSRF_HEADER] = '*';

    const cookieName  = sessionState.zosmfNativeCookieName;
    const cookieValue = sessionState.zosmfNativeCookieValue;
    if (!cookieName || !cookieValue) {
      this.logger.debug('no native z/OSMF cookie in session; proxied request may be unauthenticated.');
      return;
    }

    // Append (not replace) so any cookies already in the outgoing headers are
    // preserved alongside the z/OSMF authentication cookie.
    const nativeCookieStr = `${cookieName}=${cookieValue}`;
    const existing        = req2Options.headers['cookie'];
    req2Options.headers['cookie'] = existing
      ? `${existing}; ${nativeCookieStr}`
      : nativeCookieStr;
  }

  cleanupSession(sessionState) {
    delete sessionState.zosmfToken;
    delete sessionState.zosmfTokenExpMs;
    delete sessionState.zosmfNativeCookieName;
    delete sessionState.zosmfNativeCookieValue;
  }

  logout(request, sessionState) {
    const token = sessionState.zosmfToken || extractAuthToken(request, TOKEN_NAME);
    const expMs = sessionState.zosmfTokenExpMs || (Date.now() + DEFAULT_EXPIRATION_MS);
    let nativeCookieName = sessionState.zosmfNativeCookieName;
    let nativeCookieValue = sessionState.zosmfNativeCookieValue;

    // In JWT mode the presented token is also the native z/OSMF credential.
    // A locally wrapped LTPA token cannot reveal the native LTPA credential.
    if (this.jwtMode && token && (!nativeCookieName || !nativeCookieValue)) {
      nativeCookieName = ZOSMF_JWT_COOKIE_NAME;
      nativeCookieValue = token;
    }

    const nativeInvalidation = nativeCookieName && nativeCookieValue
      ? Promise.resolve().then(() => (
          this.zosmfClient.invalidateToken(nativeCookieName, nativeCookieValue)
        )).catch((error) => {
          this.logger.warn('native z/OSMF credential invalidation failed unexpectedly (code=%s).' ,error.code || 'n/a');
          return { success: false, reason: 'unreachable' };
        })
      : Promise.resolve({ success: false, reason: 'missingCredential' });

    const localRevocation = token ? revokeToken(token, expMs, this.logger) : Promise.resolve();
    this.cleanupSession(sessionState);
    return Promise.all([nativeInvalidation, localRevocation]).then(() => ({
      success: true,
      cookies: [{
        name: TOKEN_NAME,
        value: 'non-token',
        options: makeTokenCookieOptions({ expires: new Date(1) })
      }]
    }));
  }

  /*
   * Restores session state from the auth token in the inbound request.
   * Accepts the token from either the cookie or the Authorization: Bearer
   * header so that stateless API clients are handled correctly on the first
   * request after a server restart (session store cleared).
   */
  restoreSessionState(request, sessionState) {
    const token = extractAuthToken(request, TOKEN_NAME);
    if (!token) {
      sessionState.authenticated = false;
      return Promise.resolve({ success: false });
    }
    return this.queryToken(token).then((data) => {
      const expms = data.expiration - Date.now();
      sessionState.username      = data.userId.toUpperCase();
      sessionState.zosmfToken    = token;
      sessionState.zosmfTokenExpMs = data.expiration;
      sessionState.authenticated = expms > 0;
      // In JWT mode the apimlAuthenticationToken IS the jwtToken cookie.
      // Restore the native cookie so addProxyAuthorizations can inject it.
      if (this.jwtMode) {
        sessionState.zosmfNativeCookieName  = ZOSMF_JWT_COOKIE_NAME;
        sessionState.zosmfNativeCookieValue = token;
      }
      this.logger.debug('session restored for %s, expms=%d', sessionState.username, expms);
      return { success: sessionState.authenticated, expms };
    }).catch(() => {
      sessionState.authenticated = false;
      return { success: false };
    });
  }
}

const factory = function(pluginDef, pluginConf, serverConf, context, zoweConf) {
  return new GatewayApiHandler(pluginDef, pluginConf, serverConf, context, zoweConf);
};

factory.TOKEN_NAME      = TOKEN_NAME;
factory.decodeJwtPayload = decodeJwtPayloadUnsafe;

module.exports = factory;

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
