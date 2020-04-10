import * as express from 'express';
import * as WebSocket from 'ws';
import * as EventEmitter from 'events';
const sessionStore = require('./sessionStore').sessionStore;
import { StorageDict, KeyVal } from './clusterManager';

interface LogEntry {
  type: 'session' | 'sessions' | 'storage',
  payload: any;
}

export interface SessionLogEntry extends LogEntry {
  type: 'session',
  payload: SessionData;
}

export interface SessionsLogEntry extends LogEntry {
  type: 'sessions',
  payload: SessionData[];
}

export interface StorageLogEntry extends LogEntry {
  type: 'storage',
  payload: StorageAction;
}

interface StorageAction {
  type: 'init' | 'set-all' | 'set' | 'delete-all' | 'delete'
  data: any;
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
  const sessionLogEntry: SessionLogEntry = { type: 'session', payload: data };
  console.log(`updateSession log entry ${JSON.stringify(sessionLogEntry)}`);
  emitter.emit('session', sessionLogEntry);
}

export function setAllStorageForPlugin(pluginId: string, dict: KeyVal): void {
  if (connected) {
    return;
  }
  const action: StorageActionSetAll = { type: 'set-all', data: { pluginId, dict } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  console.log(`setAllStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  emitter.emit('storage', storageLogEntry);
}

export function setStorageForPlugin(pluginId: string, key: string, value: string): void {
  if (connected) {
    return;
  }
  const action: StorageActionSet = { type: 'set', data: { pluginId, key, value } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  console.log(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  emitter.emit('storage', storageLogEntry);
}

export function deleteAllStorageForPlugin(pluginId: string): void {
  if (connected) {
    return;
  }
  const action: StorageActionDeleteAll = { type: 'delete-all', data: { pluginId } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  console.log(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  emitter.emit('storage', storageLogEntry);
}

export function deleteStorageForPlugin(pluginId: string, key: string): void {
  if (connected) {
    return;
  }
  const action: StorageActionDelete = { type: 'delete', data: { pluginId, key } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  console.log(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  emitter.emit('storage', storageLogEntry);
}

export class SyncEndpoint {
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
    emitter.addListener('session', sessionChangeListener);
    emitter.addListener('storage', storageChangeListener);
    this.clientWS.on('close', () => {
      emitter.removeListener('session', sessionChangeListener);
      emitter.removeListener('storage', storageChangeListener);
    });
  }

  private onSessionChange(entry: SessionLogEntry) {
    console.log(`SyncEndpoint:onSessionChange: send to client entry ${JSON.stringify(entry)}`);
    this.clientWS.send(JSON.stringify(entry, null, 2));
  }

  private onStorageChange(entry: StorageLogEntry) {
    console.log(`SyncEndpoint:onStorageChange: send to client entry ${JSON.stringify(entry)}`);
    this.clientWS.send(JSON.stringify(entry, null, 2));
  }

  private sendCurrentStateToClient(): void {
    console.log(`New client connected. sendCurrentStateToClient`);
    this.sendCurrentSessionsToClient();
    this.sendCurrentStorageStateToClient();
  }

  private sendCurrentSessionsToClient(): void {
    console.log(`sendCurrentSessionsToClient`);
    sessionStore.all((err: Error | null, sessions: { [sid: string]: any }) => {
      const sessionData: SessionData[] = [];
      Object.keys(sessions).forEach(sid => {
        const session = sessions[sid];
        sessionData.push({ sid, session });
      });
      console.log(`send all sessions as array ${JSON.stringify(sessionData)}`);
      const sessionsLogEntry: SessionsLogEntry = { type: 'sessions', payload: sessionData };
      this.clientWS.send(JSON.stringify(sessionsLogEntry));
    });
  }

  private sendCurrentStorageStateToClient(): void {
    const clusterManager = process.clusterManager;
    clusterManager.getStorageCluster().then(storage => {
      console.log(`[cluster storage: ${JSON.stringify(storage)}]`);
      const action: StorageActionInit = { type: 'init', data: storage };
      const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
      console.log(`initStorageForNewClient log entry ${JSON.stringify(storageLogEntry)}`);
      this.clientWS.send(JSON.stringify(storageLogEntry));
    });
  }
}

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

