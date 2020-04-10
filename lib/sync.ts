import * as EventEmitter from 'events';
import { KeyVal } from './clusterManager';
import { SessionLogEntry, StorageActionSetAll, StorageLogEntry, StorageActionSet, StorageActionDeleteAll, StorageActionDelete } from './sync-types';

let isMaster = false;

export function setAsBackup() {
  isMaster = false;
}
export function setAsMaster(): void {
  isMaster = true;
}

export const syncEventEmitter = new EventEmitter();

export function updateSession(sid: string, session: any): void {
  if (!isMaster) {
    return;
  }
  const data = { sid, session };
  const sessionLogEntry: SessionLogEntry = { type: 'session', payload: data };
  console.log(`updateSession log entry ${JSON.stringify(sessionLogEntry)}`);
  syncEventEmitter.emit('session', sessionLogEntry);
}

export function setAllStorageForPlugin(pluginId: string, dict: KeyVal): void {
  if (!isMaster) {
    return;
  }
  const action: StorageActionSetAll = { type: 'set-all', data: { pluginId, dict } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  console.log(`setAllStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

export function setStorageForPlugin(pluginId: string, key: string, value: string): void {
  if (!isMaster) {
    return;
  }
  const action: StorageActionSet = { type: 'set', data: { pluginId, key, value } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  console.log(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

export function deleteAllStorageForPlugin(pluginId: string): void {
  if (!isMaster) {
    return;
  }
  const action: StorageActionDeleteAll = { type: 'delete-all', data: { pluginId } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  console.log(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

export function deleteStorageForPlugin(pluginId: string, key: string): void {
  if (!isMaster) {
    return;
  }
  const action: StorageActionDelete = { type: 'delete', data: { pluginId, key } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  console.log(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

