import * as express from 'express';
import * as WebSocket from 'ws';
import * as EventEmitter from 'events';
import { StorageDict, KeyVal } from './clusterManager';

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
  data: StorageAction;
}

interface StorageAction {
  type: 'init' | 'set-all' | 'set' | 'delete-all' | 'delete'
}

interface StorageActionInit extends StorageAction {
  type: 'init',
  data: StorageDict
}
interface StorageActionSetAll extends StorageAction {
  type: 'set-all',
  data: {
    pluginId: string;
    dict: KeyVal;
  }
}

interface StorageActionSet extends StorageAction {
  type: 'set',
  data: {
    pluginId: string;
    key: string;
    value: any;
  }
}

interface StorageActionDeleteAll extends StorageAction {
  type: 'delete-all',
  data: {
    pluginId: string;
  }
}

interface StorageActionDelete extends StorageAction {
  type: 'delete',
  data: {
    pluginId: string;
    key: string;
  }
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

function isStorageActionInit(action: StorageAction): action is StorageActionInit {
  return action.type === 'init';
}

function isStorageActionSetAll(action: StorageAction): action is StorageActionSetAll {
  return action.type === 'set-all';
}

function isStorageActionSet(action: StorageAction): action is StorageActionSet {
  return action.type === 'set';
}

function isStorageActionDeleteAll(action: StorageAction): action is StorageActionDeleteAll {
  return action.type === 'delete-all';
}

function isStorageActionDelete(action: StorageAction): action is StorageActionDelete {
  return action.type === 'delete';
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

export function initStorageForNewClient(ws: WebSocket, storage: Storage): void {
  const action: StorageActionInit = { type: 'init', data: storage };
  const storageLogEntry: StorageLogEntry = { type: 'storage', data: action };
  console.log(`initStorageForNewClient log entry ${JSON.stringify(storageLogEntry)}`);
  ws.send(JSON.stringify(storageLogEntry));
}

export function setAllStorageForPlugin(pluginId: string, dict: KeyVal): void {
  if (connected) {
    return;
  }
  const action: StorageActionSetAll = { type: 'set-all', data: { pluginId, dict } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', data: action };
  console.log(`setAllStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  emitter.emit('storage', storageLogEntry);
}

export function setStorageForPlugin(pluginId: string, key: string, value: string): void {
  if (connected) {
    return;
  }
  const action: StorageActionSet = { type: 'set', data: { pluginId, key, value } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', data: action };
  console.log(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  emitter.emit('storage', storageLogEntry);
}

export function deleteAllStorageForPlugin(pluginId: string): void {
  if (connected) {
    return;
  }
  const action: StorageActionDeleteAll = { type: 'delete-all', data: { pluginId } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', data: action };
  console.log(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  emitter.emit('storage', storageLogEntry);
}

export function deleteStorageForPlugin(pluginId: string, key: string): void {
  if (connected) {
    return;
  }
  const action: StorageActionDelete = { type: 'delete', data: { pluginId, key } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', data: action };
  console.log(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  emitter.emit('storage', storageLogEntry);
}

export class SyncEndpoint {
  constructor(
    private ws: WebSocket,
    private req: express.Request,
  ) {
    this.init();
  }

  private init(): void {
    const sessionChangeListener = this.onSessionChange.bind(this);
    const storageChangeListener = this.onStorageChange.bind(this);
    emitter.emit('connected', this.ws);
    this.initStorage();
    emitter.addListener('session', sessionChangeListener);
    emitter.addListener('storage', storageChangeListener);
    this.ws.on('close', () => {
      emitter.removeListener('session', sessionChangeListener);
      emitter.removeListener('storage', storageChangeListener);
    });
  }

  private onSessionChange(entry: SessionLogEntry) {
    console.log(`SyncEndpoint:onSessionChange: send to client entry ${JSON.stringify(entry)}`);
    this.ws.send(JSON.stringify(entry, null, 2));
  }

  private onStorageChange(entry: StorageLogEntry) {
    console.log(`SyncEndpoint:onStorageChange: send to client entry ${JSON.stringify(entry)}`);
    this.ws.send(JSON.stringify(entry, null, 2));
  }

  private initStorage(): void {
    const clusterManager = process.clusterManager;
    clusterManager.getStorageCluster().then(storage => {
      console.log(`[cluster storage: ${JSON.stringify(storage)}]`);
      initStorageForNewClient(this.ws, storage);
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
        if (isStorageActionInit(entry.data)) {
          for (const pluginId of Object.keys(entry.data.data)) {
            clusterManager.setStorageAll(pluginId, entry.data[pluginId])
          }
        } else if (isStorageActionSetAll(entry.data)) {
          clusterManager.setStorageAll(entry.data.data.pluginId, entry.data.data.dict);
        } else if (isStorageActionSet(entry.data)) {
          clusterManager.setStorageByKey(entry.data.data.pluginId, entry.data.data.key, entry.data.data.value);
        } else if (isStorageActionDeleteAll(entry.data)) {
          clusterManager.setStorageAll(entry.data.data.pluginId, {});
        } else if (isStorageActionDelete(entry.data)) {
          clusterManager.deleteStorageByKey(entry.data.data.pluginId, entry.data.data.key);
        }
      }
    });
  }
}

