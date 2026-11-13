/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

import * as https from 'https';
import { request, Agent, Dispatcher } from 'undici';

export interface EurekaInstanceConfig {
  instanceId?: string;
  app: string;
  hostName: string;
  ipAddr: string;
  vipAddress: string;
  status: string;
  port: { '$': number; '@enabled': string };
  securePort: { '$': number; '@enabled': string };
  healthCheckUrl: string;
  statusPageUrl: string;
  homePageUrl: string;
  dataCenterInfo: {
    '@class': string;
    name: string;
  };
  leaseInfo: {
    durationInSecs: number;
    renewalIntervalInSecs: number;
  };
  metadata: { [key: string]: string };
  [key: string]: any;
}

export interface EurekaServerConfig {
  heartbeatInterval: number;
  requestRetryDelay: number;
  serviceUrls?: { default: string[] };
  [key: string]: any;
}

export interface EurekaClientConfig {
  instance: EurekaInstanceConfig;
  eureka: EurekaServerConfig;
  ssl: boolean;
  tlsOptions?: https.AgentOptions;
  logger?: EurekaLogger;
}

export interface EurekaLogger {
  info(...args: any[]): void;
  warn(...args: any[]): void;
  debug(...args: any[]): void;
  error(...args: any[]): void;
}

const DEFAULT_LOGGER: EurekaLogger = {
  info: console.log,
  warn: console.warn,
  debug: console.debug,
  error: console.error,
};

interface EurekaRequestOptions {
  method: 'POST' | 'PUT' | 'DELETE' | 'GET';
  uri: string;
  body?: object;
}

interface EurekaResponse {
  statusCode: number;
  body: string;
}

export interface EurekaApplication {
  application?: {
    instance?: EurekaRegisteredInstance | EurekaRegisteredInstance[];
    [key: string]: any;
  };
  [key: string]: any;
}

export interface EurekaRegisteredInstance {
  instanceId: string;
  app: string;
  hostName: string;
  ipAddr: string;
  status: string;
  [key: string]: any;
}

export class EurekaClient {
  private config: EurekaClientConfig;
  private serviceUrls: string[];
  private serviceUrlIndex: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null;
  private dispatcher: Dispatcher | undefined;
  private startingUp: boolean;
  readonly logger: EurekaLogger;

  constructor(config: EurekaClientConfig) {
    this.config = config;
    this.serviceUrls = config.eureka.serviceUrls?.default || [];
    this.serviceUrlIndex = 0;
    this.heartbeatTimer = null;
    this.logger = config.logger || DEFAULT_LOGGER;
    this.startingUp = false;

    if (config.ssl && config.tlsOptions) {
      this.dispatcher = new Agent({ connect: config.tlsOptions });
    }
  }

  get instanceId(): string {
    return this.config.instance.instanceId || this.config.instance.hostName;
  }

  start(callback: (error?: Error | null) => void): void {
    this.startingUp = true;
    this.register((error) => {
      this.startingUp = false;
      if (error) {
        callback(error);
        return;
      }
      this.startHeartbeats();
      callback(null);
    });
  }

  stop(callback: (error?: Error | null) => void = () => {}): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.deregister(callback);
  }

  private register(callback: (error?: Error | null) => void): void {
    this.eurekaRequest({
      method: 'POST',
      uri: this.config.instance.app,
      body: { instance: this.config.instance },
    }, (error, response) => {
      if (!error && response && response.statusCode === 204) {
        this.logger.info('registered with eureka: ',
          this.config.instance.app + '/' + this.instanceId);
        callback(null);
      } else if (error) {
        this.logger.warn('Error registering with eureka client.', error);
        callback(error);
      } else {
        const statusCode = response ? response.statusCode : 'unknown';
        const body = response ? response.body : '';
        callback(new Error(
          'eureka registration FAILED: status: ' + statusCode + ' body: ' + body));
      }
    });
  }

  private deregister(callback: (error?: Error | null) => void): void {
    this.eurekaRequest({
      method: 'DELETE',
      uri: this.config.instance.app + '/' + this.instanceId,
    }, (error, response) => {
      if (!error && response && response.statusCode === 200) {
        this.logger.info('de-registered with eureka: '
          + this.config.instance.app + '/' + this.instanceId);
        callback(null);
      } else if (error) {
        this.logger.warn('Error deregistering with eureka', error);
        callback(error);
      } else {
        const statusCode = response ? response.statusCode : 'unknown';
        const body = response ? response.body : '';
        callback(new Error(
          'eureka deregistration FAILED: status: ' + statusCode + ' body: ' + body));
      }
    });
  }

  private startHeartbeats(): void {
    this.heartbeatTimer = setInterval(() => {
      this.renew();
    }, this.config.eureka.heartbeatInterval);
  }

  renew(): void {
    this.eurekaRequest({
      method: 'PUT',
      uri: this.config.instance.app + '/' + this.instanceId,
    }, (error, response) => {
      if (!error && response && response.statusCode === 200) {
        this.logger.debug('eureka heartbeat success');
      } else if (!error && response && response.statusCode === 404) {
        this.logger.warn('eureka heartbeat FAILED, Re-registering app');
        this.register(() => {});
      } else {
        this.logger.warn('eureka heartbeat FAILED, error:',
          error ? error.message : `status ${response ? response.statusCode : 'unknown'}`);
      }
    });
  }

  getInstancesByAppId(
    appId: string,
    callback: (error: Error | null, application?: EurekaApplication) => void
  ): void {
    this.eurekaRequest({
      method: 'GET',
      uri: appId,
    }, (error, response) => {
      if (error) {
        callback(error);
        return;
      }
      if (!response || response.statusCode !== 200) {
        const statusCode = response ? response.statusCode : 'unknown';
        callback(null, undefined);
        return;
      }
      try {
        const parsed: EurekaApplication = JSON.parse(response.body);
        callback(null, parsed);
      } catch (parseError: any) {
        callback(parseError);
      }
    });
  }

  private resolveServiceUrl(retryAttempt: number): string {
    if (this.serviceUrls.length === 0) {
      throw new Error('No eureka service URLs configured');
    }
    // Rotate to the next URL on retries
    if (retryAttempt > 0 && this.serviceUrls.length > 1) {
      this.serviceUrlIndex = (this.serviceUrlIndex + 1) % this.serviceUrls.length;
    }
    return this.serviceUrls[this.serviceUrlIndex];
  }

  private eurekaRequest(
    opts: EurekaRequestOptions,
    callback: (error: Error | null, response?: EurekaResponse) => void,
    retryAttempt: number = 0
  ): void {
    let baseUrl: string;
    try {
      baseUrl = this.resolveServiceUrl(retryAttempt);
    } catch (e: any) {
      callback(e);
      return;
    }
    // baseUrl is like "https://host:port/eureka/apps"
    // opts.uri is like "zlux" or "zlux/host:zlux:8544"
    const fullUrl = baseUrl + (baseUrl.endsWith('/') ? '' : '/') + opts.uri;

    const requestOptions: {
      method: Dispatcher.HttpMethod;
      headers: { [key: string]: string };
      body?: string;
      dispatcher?: Dispatcher;
    } = {
      method: opts.method,
      headers: {
        'accept': 'application/json',
      },
    };

    if (opts.body) {
      requestOptions.headers['content-type'] = 'application/json';
      requestOptions.body = JSON.stringify(opts.body);
    }

    if (this.dispatcher) {
      requestOptions.dispatcher = this.dispatcher;
    }

    request(fullUrl, requestOptions).then(async (response) => {
      const bodyText = await response.body.text();
      const statusCode = response.statusCode;
      const responseInvalid = String(statusCode)[0] === '5';

      if (responseInvalid) {
        // During startup, retry noise is expected — log at debug level
        const retryLog = this.startingUp ? this.logger.debug : this.logger.warn;
        retryLog.call(this.logger,
          'Eureka request failed to endpoint ' + baseUrl
          + ', retrying in ' + this.config.eureka.requestRetryDelay + 'ms');
        setTimeout(() => {
          this.eurekaRequest(opts, callback, retryAttempt + 1);
        }, this.config.eureka.requestRetryDelay);
        return;
      }

      callback(null, { statusCode, body: bodyText });
    }).catch((error: Error) => {
      // During startup, connection errors are expected — log at debug level
      if (this.startingUp) {
        this.logger.debug('Problem making eureka request', error);
      } else {
        this.logger.error('Problem making eureka request', error);
      }

      if (retryAttempt < this.config.eureka.maxRetries) {
        const nextRetryDelay =
          this.config.eureka.requestRetryDelay * (retryAttempt + 1);
        const retryLog = this.startingUp ? this.logger.debug : this.logger.warn;
        retryLog.call(this.logger,
          'Eureka request failed to endpoint ' + baseUrl
          + ', next server retry in ' + nextRetryDelay + 'ms');
        setTimeout(() => {
          this.eurekaRequest(opts, callback, retryAttempt + 1);
        }, nextRetryDelay);
        return;
      }

      callback(error);
    });
  }
}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
