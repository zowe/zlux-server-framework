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
const sessionStore = require('./sessionStore').sessionStore;
const zluxUtil = require('./util');
const syncLog = zluxUtil.loggers.utilLogger;

export class SyncClient {
  private ws: WebSocket;

  constructor() {
    
  }
  
  start(host: string, port: number, secure: boolean): void {
    const serverAddress = `${secure ? 'wss' : 'ws'}://${host}:${port}/sync`;
    this.ws = new WebSocket(serverAddress, { rejectUnauthorized: false });
    this.ws.on('open', () => syncLog.info(`connection to master ${serverAddress} established`));
    this.ws.on('message', (data: Buffer) => {
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
    });
  }
}