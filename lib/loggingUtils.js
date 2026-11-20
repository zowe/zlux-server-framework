/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const REDACTED_VALUE = '<redacted>';
const MAX_LOGGED_HEADER_VALUE_LENGTH = 1024;

const headersWithSafeValues = new Set([
  'accept',
  'accept-encoding',
  'access-control-allow-credentials',
  'access-control-allow-origin',
  'connection',
  'content-encoding',
  'content-length',
  'content-type',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'host',
  'referrer-policy',
  'strict-transport-security',
  'transfer-encoding',
  'x-content-type-options',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-frame-options'
]);

function sanitizeHeaderValue(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => String(entry)
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .slice(0, MAX_LOGGED_HEADER_VALUE_LENGTH));
}

function sanitizeHeadersForLogging(headers) {
  const sanitizedHeaders = {};
  for (const headerName of Object.keys(headers || {})) {
    if (headersWithSafeValues.has(headerName.toLowerCase())) {
      const sanitizedValues = sanitizeHeaderValue(headers[headerName]);
      sanitizedHeaders[headerName] = Array.isArray(headers[headerName])
        ? sanitizedValues
        : sanitizedValues[0];
    } else {
      sanitizedHeaders[headerName] = REDACTED_VALUE;
    }
  }
  return sanitizedHeaders;
}

module.exports = {
  REDACTED_VALUE,
  sanitizeHeadersForLogging
};