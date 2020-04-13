import * as express from 'express';
import * as WebSocket from 'ws';
const sessionStore = require('./sessionStore').sessionStore;
import { syncEventEmitter } from './sync';
import {
  SessionData,
  SessionLogEntry,
  SessionsLogEntry,
  StorageActionInit,
  StorageLogEntry,
} from './sync-types';
const zluxUtil = require('./util');
const syncLog = zluxUtil.loggers.utilLogger;

export class SyncService {
  constructor(
    private clientWS: WebSocket,
    private req: express.Request,
  ) {
    this.init();
  }

  private init(): void {
    const sessionChangeListener = this.onSessionChange.bind(this);
    const storageChangeListener = this.onStorageChange.bind(this);
    this.sendCurrentStateToClient();
    syncEventEmitter.addListener('session', sessionChangeListener);
    syncEventEmitter.addListener('storage', storageChangeListener);
    this.clientWS.on('close', () => {
      syncEventEmitter.removeListener('session', sessionChangeListener);
      syncEventEmitter.removeListener('storage', storageChangeListener);
    });
  }

  private onSessionChange(entry: SessionLogEntry) {
    syncLog.info(`SyncEndpoint:onSessionChange: send to client entry ${JSON.stringify(entry)}`);
    this.clientWS.send(JSON.stringify(entry, null, 2));
  }

  private onStorageChange(entry: StorageLogEntry) {
    syncLog.info(`SyncEndpoint:onStorageChange: send to client entry ${JSON.stringify(entry)}`);
    this.clientWS.send(JSON.stringify(entry, null, 2));
  }

  private sendCurrentStateToClient(): void {
    syncLog.info(`New client connected. sendCurrentStateToClient`);
    this.sendCurrentSessionsToClient();
    this.sendCurrentStorageStateToClient();
  }

  private sendCurrentSessionsToClient(): void {
    syncLog.info(`sendCurrentSessionsToClient`);
    sessionStore.all((err: Error | null, sessions: { [sid: string]: any }) => {
      const sessionData: SessionData[] = [];
      Object.keys(sessions).forEach(sid => {
        const session = sessions[sid];
        sessionData.push({ sid, session });
      });
      syncLog.info(`send all sessions as array ${JSON.stringify(sessionData)}`);
      const sessionsLogEntry: SessionsLogEntry = { type: 'sessions', payload: sessionData };
      this.clientWS.send(JSON.stringify(sessionsLogEntry));
    });
  }

  private sendCurrentStorageStateToClient(): void {
    const clusterManager = process.clusterManager;
    clusterManager.getStorageCluster().then(storage => {
      syncLog.info(`[cluster storage: ${JSON.stringify(storage)}]`);
      const action: StorageActionInit = { type: 'init', data: storage };
      const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
      syncLog.info(`initStorageForNewClient log entry ${JSON.stringify(storageLogEntry)}`);
      this.clientWS.send(JSON.stringify(storageLogEntry));
    });
  }
}