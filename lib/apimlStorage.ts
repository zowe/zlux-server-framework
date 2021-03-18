/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

import * as https from 'https';
import * as http from 'http';
import axios from 'axios';
import { AxiosInstance } from 'axios';

let apimlClient: AxiosInstance;

export function configureApimlStorage(settings: ApimlStorageSettings) {
  apimlClient = axios.create({
    baseURL: `https://${settings.host}:${settings.port}`,
    httpsAgent: new https.Agent(settings.tlsOptions)
  });
}

const CACHING_SERVICE_URI = '/cachingservice/api/v1/cache';

export interface ApimlStorageSettings {
  host: string;
  port: number;
  tlsOptions?: https.AgentOptions;
}

interface ApimlRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string;
  headers?: { [key: string]: string };
  body?: any;
  tlsOptions?: https.AgentOptions;
}

interface KeyValuePair {
  key: string;
  value: any;
}
interface ApimlResponse {
  statusCode: number;
  json?: any;
  headers: http.IncomingHttpHeaders;
}

type ApimlStorageErrorCode =
  'APIML_STORAGE_CONNECTION_ERROR' |
  'APIML_STORAGE_KEY_NOT_FOUND' |
  'APIML_STORAGE_JSON_ERROR' |
  'APIML_STORAGE_UNKNOWN_CLIENT_CERT' |
  'APIML_STORAGE_UNAUTHORIZED' |
  'APIML_STORAGE_NO_AUTH_PROVIDED' |
  'APIML_STORAGE_INVALID_PAYLOAD' |
  'APIML_STORAGE_UNKNOWN_ERROR' |
  'APIML_STORAGE_RESPONSE_ERROR' |
  'APIML_STORAGE_NOT_CONFIGURED';

class ApimlStorageError extends Error {
  constructor(
    public code: ApimlStorageErrorCode,
    public cause?: Error,
    public apimlResponse?: ApimlResponse) {
    super(code);
    Object.setPrototypeOf(this, ApimlStorageError.prototype);
  }

  toString(): string {
    const apimlMessages = this.getApimlMessages();
    const errorMessage = this.cause ? this.cause.message : undefined;
    let resultMessage = this.code;
    if (errorMessage) {
      resultMessage += ' ' + errorMessage;
    }
    if (apimlMessages) {
      resultMessage += ' ' + apimlMessages;
    }
    return resultMessage;
  }

  private getApimlMessages(): string | undefined {
    if (typeof this.apimlResponse !== 'object') {
      return undefined;
    }
    if (!isApimlErrorMessages(this.apimlResponse.json)) {
      return undefined;
    }
    return this.apimlResponse.json.messages.map(msg => getApimlErrorMessageString(msg)).join(';');
  }

}

function isApimlStorageKeyNotFoundError(e: Error) {
  return e instanceof ApimlStorageError && e.code === 'APIML_STORAGE_KEY_NOT_FOUND';
}

interface ApimlErrorMessage {
  messageType: 'ERROR' | 'INFO' | 'WARN';
  messageNumber: string;
  messageContent: string;
  messageKey: string;
}
interface ApimlErrorMessages {
  messages: ApimlErrorMessage[];
}

function isApimlErrorMessages(obj: any): obj is ApimlErrorMessages {
  if (typeof obj !== 'object') {
    return false;
  }
  if (!Array.isArray(obj.messages)) {
    return false;
  }
  return true;
}

function getApimlErrorMessageString(message: ApimlErrorMessage): string {
  return `${message.messageType}(${message.messageKey}) ${message.messageNumber} ${message.messageContent}`;
}

interface Credentials {
  username: string;
  password: string;
}

function apimlResponseGetMessageKey(response: ApimlResponse): string | undefined {
  if (
    typeof response.json === 'object' &&
    typeof response.json.messages === 'object' &&
    typeof response.json.messages[0] === 'object' &&
    typeof response.json.messages[0].messageKey == 'string'
  ) {
    return response.json.messages[0].messageKey;
  }
  return undefined;
}

async function apimlDoRequest(req: ApimlRequest): Promise<ApimlResponse> {
  if (!apimlClient) {
    throw new ApimlStorageError('APIML_STORAGE_NOT_CONFIGURED');
  }
  try {
    const response = await apimlClient.request({
      method: req.method,
      url: req.path,
      data: req.body,
      headers: req.headers,
    });
    const apimlResponse: ApimlResponse = {
      headers: response.headers,
      statusCode: response.status,
      json: response.data
    };
    return apimlResponse;
  } catch (e) {
    if (e.response) {
      const response = e.response;
      const apimlResponse: ApimlResponse = {
        headers: response.headers,
        statusCode: response.status,
        json: response.data
      };
      const err = checkHttpResponse(apimlResponse);
      if (err) {
        throw err;
      }
      return apimlResponse;
    } else if (e.request) {
      throw new ApimlStorageError('APIML_STORAGE_CONNECTION_ERROR', e);
    } else {
      throw new ApimlStorageError('APIML_STORAGE_UNKNOWN_ERROR', e);
    }
  }
}

function checkHttpResponse(response: ApimlResponse): ApimlStorageError | undefined {
  switch (response.statusCode) {
    case 404: /* HTTP_STATUS_NOT_FOUND */
      return new ApimlStorageError('APIML_STORAGE_KEY_NOT_FOUND', undefined, response);
    case 403: /* HTTP_STATUS_FORBIDDEN */
      return new ApimlStorageError('APIML_STORAGE_UNKNOWN_CLIENT_CERT', undefined, response);
    case 401: /* HTTP_STATUS_UNAUTHORIZED */
      return new ApimlStorageError('APIML_STORAGE_UNAUTHORIZED', undefined, response);
    case 400: /* HTTP_STATUS_BAD_REQUEST */
      const errorKey = apimlResponseGetMessageKey(response);
      if (errorKey === 'org.zowe.apiml.cache.invalidPayload') {
        return new ApimlStorageError('APIML_STORAGE_INVALID_PAYLOAD', undefined, response);
      } else if (errorKey === 'org.zowe.apiml.security.query.tokenNotProvided') {
        return new ApimlStorageError('APIML_STORAGE_NO_AUTH_PROVIDED', undefined, response);
      } else {
        return new ApimlStorageError('APIML_STORAGE_UNKNOWN_ERROR', undefined, response);
      }
    case 200: /* HTTP_STATUS_OK */
      return;
    case 204: /* HTTP_STATUS_NO_CONTENT */
      return;
    case 201: /* HTTP_STATUS_CREATED */
      return;
    default:
      return new ApimlStorageError('APIML_STORAGE_UNKNOWN_ERROR', undefined, response);
  }
}
export class ApimlStorage {
  private keyPrefix: string;

  constructor(
    private pluginId: string
  ) {
    this.keyPrefix = this.makeKeyPrefix(this.pluginId);
  }

  private makeKeyPrefix(pluginId: string): string {
    return pluginId.replace(/\./g, '');
  }

  async doRequest(req: ApimlRequest): Promise<ApimlResponse> {
    return apimlDoRequest(req);
  }

  async set(key: string, value: any): Promise<void> {
    try {
      await this.change(key, value);
    } catch (e) {
      if (isApimlStorageKeyNotFoundError(e)) {
        await this.create(key, value);
      } else {
        throw e;
      }
    }
  }

  async setAll(dict: { [key: string]: any }): Promise<void> {
    await this.deleteAll();
    for (const key in dict) {
      await this.set(key, dict[key]);
    }
  }

  async get(key: string): Promise<string | undefined> {
    const wrappedKey = this.wrapKey(key);
    const getRequest: ApimlRequest = {
      method: 'GET',
      path: `${CACHING_SERVICE_URI}/${wrappedKey}`,
    };
    let response: ApimlResponse;
    try {
      response = await this.doRequest(getRequest);
    } catch (e) {
      if (!isApimlStorageKeyNotFoundError(e)) {
        throw e;
      }
      return undefined;
    }
    if (response.statusCode === 200 && typeof response.json === 'object' && typeof response.json.value === 'string') {
      return this.unwrapValue(response.json.value);
    }
    throw new ApimlStorageError('APIML_STORAGE_RESPONSE_ERROR', undefined, response);
  }

  async getAll(): Promise<{ [key: string]: any }> {
    const getRequest: ApimlRequest = {
      method: 'GET',
      path: `${CACHING_SERVICE_URI}`,
    };
    const response = await this.doRequest(getRequest);
    if (response.statusCode !== 200 || typeof response.json !== 'object') {
      throw new ApimlStorageError('APIML_STORAGE_RESPONSE_ERROR', undefined, response);
    }
    if (typeof response.json !== 'object') {
      return {};
    }
    const json = response.json as { [key: string]: KeyValuePair };
    const validKeys = Object.keys(json).filter(key => this.keyHasPrefix(key));
    const result = {};
    for (const key of validKeys) {
      const kv = json[key];
      if (typeof kv.value === 'string') {
        result[this.unwrapKey(key)] = this.unwrapValue(kv.value);
      } else {
        throw new ApimlStorageError('APIML_STORAGE_RESPONSE_ERROR', undefined, response);
      }
    }
    return result;
  }

  async delete(key: string): Promise<void> {
    try {
      const wrappedKey = this.wrapKey(key);
      const getRequest: ApimlRequest = {
        method: 'DELETE',
        path: `${CACHING_SERVICE_URI}/${wrappedKey}`,
      };
      await this.doRequest(getRequest);
    } catch (e) {
      if (!isApimlStorageKeyNotFoundError(e)) {
        throw e;
      }
    }
  }

  async deleteAll(): Promise<void> {
    const data = await this.getAll();
    for (const key in data) {
      try {
        await this.delete(key);
      } catch (e) {
        if (!isApimlStorageKeyNotFoundError(e)) {
          throw e;
        }
      }
    }
  }

  private wrapKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private keyHasPrefix(key: string): boolean {
    return key.startsWith(this.keyPrefix);
  }

  private unwrapKey(key: string): string {
    if (this.keyHasPrefix(key)) {
      return key.substring(this.keyPrefix.length);
    }
    throw new Error(`Unable to unwrap ${key}`);
  }

  private wrapValue(value: any): string {
    return JSON.stringify({ value });
  }

  private unwrapValue(value: string): any {
    try {
      const parsed: { value: any } = JSON.parse(value);
      return parsed.value;
    } catch (err) {
      return undefined;
    }
  }

  private async create(key: string, value: any): Promise<void> {
    const createRequest: ApimlRequest = {
      method: 'POST',
      path: CACHING_SERVICE_URI,
      body: { key: this.wrapKey(key), value: this.wrapValue(value) },
    };
    const response = await this.doRequest(createRequest);
  }

  private async change(key: string, value: any): Promise<ApimlResponse> {
    const createRequest: ApimlRequest = {
      method: 'PUT',
      path: CACHING_SERVICE_URI,
      body: { key: this.wrapKey(key), value: this.wrapValue(value) },
    };
    const response = await this.doRequest(createRequest);
    return response;
  }

}



if (require.main === module) {
  const fs = require('fs');
  if (process.argv.length !== 6) {
    console.log(`Usage: `);
    console.log(`       node lib/apimlStorage.js <apiml-host> <apiml-port> <user-cert-file> <user-key-file>`);
    console.log(`for example:`)
    console.log(`       node lib/apimlStorage.js localhost 10010 ../../api-layer/keystore/client_cert/USER-cert.cer ../../api-layer/keystore/client_cert/USER-PRIVATEKEY.key`);
    process.exit(1);
  }

  const host = process.argv[2];
  const port = +process.argv[3];
  const certFile = process.argv[4];
  const keyFile = process.argv[5];
  (async () => {
    const settings: ApimlStorageSettings = {
      host: host,
      port: port,
      tlsOptions: {
        cert: fs.readFileSync(certFile),
        key: fs.readFileSync(keyFile),
        rejectUnauthorized: false,
      }
    };
    configureApimlStorage(settings);
    const pluginId = 'com.company.department.first' + Math.ceil(Math.random() * 1000);
    const storage = new ApimlStorage(pluginId);
    const key = 'keyA';
    const value = 'abcd';
    await storage.set(key, value);
    console.log(`set ${key}=${value} successful`);

    const data = await storage.getAll();
    console.log(`storage contains:`);
    console.log(`${JSON.stringify(data, null, 2)}`);
    const newValue = await storage.get(key);
    console.log(`got new value '${newValue}'`);
    if (newValue !== value) {
      throw new Error(`value doesn't match`);
    }
    await storage.deleteAll();
    await storage.delete(key);
    const newValueAgain = await storage.get(key);
    if (typeof newValueAgain !== 'undefined') {
      console.log(`got not undefined after delete ${newValueAgain}`);
    }
    const dict = { a: 1, b: 2 };
    await storage.setAll(dict);
    const newDict = await storage.getAll();
    console.log(`storage contains:`);
    console.log(`${JSON.stringify(newDict, null, 2)}`);
    console.log(`test complete`);
  })().catch(err => console.log(`Storage error: ${err}`));
}


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/