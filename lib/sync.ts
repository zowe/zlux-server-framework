import * as express from 'express';
import * as WebSocket from 'ws';
import * as EventEmitter from 'events';
import { StorageDict } from './clusterManager';

interface LogEntry {
  type: 'session' | 'sessions' | 'storage',
  data: any;
}

export interface SessionLogEntry extends LogEntry {
  type: 'session',
  data: SessionData;
}

export interface SessionsLogEntry extends LogEntry {
  type: 'sessions',
  data: SessionData[];
}

export interface StorageLogEntry extends LogEntry {
  type: 'storage',
  data: Storage;
}

interface Storage {
  [pluginId: string]: {
    [key: string]: any;
  }
}

interface SessionData {
  sid: string,
  session: any;
}

function isSessionLogEntry(entry: LogEntry): entry is SessionLogEntry {
  return entry.type === 'session';
}

function isSessionsLogEntry(entry: LogEntry): entry is SessionsLogEntry {
  return entry.type === 'sessions';
}

function isStorageLogEntry(entry: LogEntry): entry is StorageLogEntry {
  return entry.type === 'storage';
}

let connected = false;
export const emitter = new EventEmitter();
emitter.on('error', (e) => console.log(`EMITTER: error ${JSON.stringify(e)}`));

export function updateSession(sid: string, session: any): void {
  if (connected) {
    console.log(`update session do nothing`);
    return;
  }
  const data = { sid, session };
  const sessionLogEntry: SessionLogEntry = { type: 'session', data };
  console.log(`updateSession log entry ${JSON.stringify(sessionLogEntry)}`);
  emitter.emit('session', sessionLogEntry);
}

export function updateSessionsForNewClient(ws: WebSocket, data: SessionData[]): void {
  const sessionsLogEntry: SessionsLogEntry = { type: 'sessions', data };
  console.log(`updateSessionsForNewClient log entry ${JSON.stringify(sessionsLogEntry)}`);
  ws.send(JSON.stringify(sessionsLogEntry));
}

export function updateStorageForNewClient(ws: WebSocket, data: StorageDict): void {
  const storageLogEntry: StorageLogEntry = { type: 'storage', data };
  console.log(`updateStorageForNewClient log entry ${JSON.stringify(storageLogEntry)}`);
  ws.send(JSON.stringify(storageLogEntry));
}

export class SyncEndpoint {
  constructor(
    private ws: WebSocket,
    private req: express.Request,
  ) {
    this.init();
  }

  private init(): void {
    const listener = this.onSessionChange.bind(this);
    emitter.emit('connected', this.ws);
    emitter.addListener('session', listener);
    this.sendStorage();
    this.ws.on('close', () => emitter.removeListener('session', listener));
  }

  private onSessionChange(entry: SessionLogEntry) {
    console.log(`SyncEndpoint:onSessionChange: send to client entry ${JSON.stringify(entry)}`);
    this.ws.send(JSON.stringify(entry, null, 2));
  }

  private sendStorage() {
    const clusterManager = process.clusterManager;
    clusterManager.getStorageCluster().then(storage => {
      console.log(`[cluster storage: ${JSON.stringify(storage)}]`);
      updateStorageForNewClient(this.ws, storage);
    });
  }
}

export const syncEmitter = new EventEmitter();

export class SyncClient {
  private ws: WebSocket;

  constructor() {
    this.ws = new WebSocket('wss://localhost:8544/sync', { rejectUnauthorized: false });
    this.ws.on('open', () => {
      console.log('opened');
      connected = true;
    });
    this.ws.on('message', (data) => {
      console.log(`message ${data}`);
      const entry: LogEntry = JSON.parse(data.toString());
      if (isSessionLogEntry(entry)) {
        syncEmitter.emit('session', entry.data);
      } else if (isSessionsLogEntry(entry)) {
        for (const session of entry.data) {
          syncEmitter.emit('session', session);
        }
      } else if (isStorageLogEntry(entry)) {
        const clusterManager = process.clusterManager;
        for (const pluginId of Object.keys(entry.data)) {
          clusterManager.setStorageAll(pluginId, entry.data[pluginId])
        }
      }
    });
  }
}

