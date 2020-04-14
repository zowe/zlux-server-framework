import * as WebSocket from 'ws';
import {
  isSessionLogEntry,
  isSessionsLogEntry,
  isStorageActionDelete,
  isStorageActionDeleteAll,
  isStorageActionInit,
  isStorageActionSet,
  isStorageActionSetAll,
  isStorageLogEntry,
  LogEntry,
} from './sync-types';
import { EurekaInstanceConfig } from 'eureka-js-client';
const sessionStore = require('./sessionStore').sessionStore;
const zluxUtil = require('./util');
const syncLog = zluxUtil.loggers.utilLogger;

export class SyncClient {
  private ws: WebSocket;
  private isAlive: boolean;
  private timerId: NodeJS.Timer;
  private masterAddress: string;
  private onFailureHandler: (masterInstance: EurekaInstanceConfig) => void;
  private readonly timeout = 8000;
  private masterInstance: EurekaInstanceConfig;

  constructor() { }

  start(masterInstance: EurekaInstanceConfig): void {
    this.masterInstance = masterInstance;
    this.masterAddress = this.makeMasterWebSocketAddress(masterInstance);
    this.ws = new WebSocket(this.masterAddress, { rejectUnauthorized: false });
    this.ws.on('open', () => this.onOpen());
    this.ws.on('message', (data: Buffer) => this.onMessage(data));
    this.ws.on('close', (code: number, reason: string) => this.onClose(code, reason));
    this.ws.on('error', (ws: WebSocket, err: Error) => this.onError(ws, err));
    this.ws.on('ping', (ws: WebSocket, data: Buffer) => this.onPing(ws, data));
    this.ws.on('pong', (ws: WebSocket, data: Buffer) => this.onPong(ws, data));
  }

  stop(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
      this.masterAddress = undefined;
      this.masterInstance = undefined;
      this.isAlive = false;
      clearTimeout(this.timerId);
      this.onFailureHandler = undefined;
    }
  }

  onConnectionFailure(handler: () => void): void {
    this.onFailureHandler = handler;
  }
  
  private makeMasterWebSocketAddress(masterInstance: EurekaInstanceConfig): string {
    const hostname = masterInstance.hostName;
    const secure = masterInstance.securePort['@enabled'];
    const port = secure ? masterInstance.securePort.$ : masterInstance.port.$;
    return `${secure ? 'wss' : 'ws'}://${hostname}:${port}/sync`;
  }

  private onOpen(): void {
    syncLog.info(`connection to master ${this.masterAddress} established`);
    this.pingAndWait();
  }

  private onMessage(data: Buffer): void {
    syncLog.info(`message ${data}`);
    const entry: LogEntry = JSON.parse(data.toString());
    if (isSessionLogEntry(entry)) {
      const sessionData = entry.payload;
      sessionStore.set(sessionData.sid, sessionData.session, () => { });
    } else if (isSessionsLogEntry(entry)) {
      for (const sessionData of entry.payload) {
        sessionStore.set(sessionData.sid, sessionData.session, () => { });
      }
    } else if (isStorageLogEntry(entry)) {
      const clusterManager = process.clusterManager;
      if (isStorageActionInit(entry.payload)) {
        for (const pluginId of Object.keys(entry.payload.data)) {
          clusterManager.setStorageAll(pluginId, entry.payload[pluginId])
        }
      } else if (isStorageActionSetAll(entry.payload)) {
        clusterManager.setStorageAll(entry.payload.data.pluginId, entry.payload.data.dict);
      } else if (isStorageActionSet(entry.payload)) {
        clusterManager.setStorageByKey(entry.payload.data.pluginId, entry.payload.data.key, entry.payload.data.value);
      } else if (isStorageActionDeleteAll(entry.payload)) {
        clusterManager.setStorageAll(entry.payload.data.pluginId, {});
      } else if (isStorageActionDelete(entry.payload)) {
        clusterManager.deleteStorageByKey(entry.payload.data.pluginId, entry.payload.data.key);
      }
    }
  }

  private onClose(code: number, reason: string): void {
    syncLog.info(`syncClient: connection to master closed ${code} ${reason}`);
  }

  private onError(ws: WebSocket, err: Error): void {
    syncLog.info(`syncClient: connection to master error ${JSON.stringify(err)}`);
  }

  onPing(ws: WebSocket, data: Buffer): void {
    ws.pong();
  }

  onPong(ws: WebSocket, data: Buffer): void {
    clearTimeout(this.timerId);
    this.isAlive = true;
    this.pingAndWait();
  }

  private pingAndWait() {
    if (this.ws) {
      this.ws.ping();
      this.timerId = setTimeout(() => this.onTimeout(), this.timeout);
    }
  }

  private onTimeout(): void {
    this.isAlive = false;
    syncLog.info(`syncClient: connection to master timed out. stop client`);
    if (typeof this.onFailureHandler === 'function') {
      this.onFailureHandler(this.masterInstance);
    }
    this.stop();
  }

}