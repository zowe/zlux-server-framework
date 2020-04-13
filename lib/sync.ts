import * as EventEmitter from 'events';
import { KeyVal } from './clusterManager';
import { SessionLogEntry, StorageActionSetAll, StorageLogEntry, StorageActionSet, StorageActionDeleteAll, StorageActionDelete } from './sync-types';
const zluxUtil = require('./util');
const syncLog = zluxUtil.loggers.utilLogger;

type Role = 'Master' | 'Backup';

let isMaster = false;

export function setAsBackup() {
  isMaster = false;
}
export function setAsMaster(): void {
  isMaster = true;
}

export function getRole(): Role {
  return isMaster ? 'Master' : 'Backup';
}

export const syncEventEmitter = new EventEmitter();

export function updateSession(sid: string, session: any): void {
  if (!isMaster) {
    return;
  }
  const data = { sid, session };
  const sessionLogEntry: SessionLogEntry = { type: 'session', payload: data };
  syncLog.info(`updateSession log entry ${JSON.stringify(sessionLogEntry)}`);
  syncEventEmitter.emit('session', sessionLogEntry);
}

export function setAllStorageForPlugin(pluginId: string, dict: KeyVal): void {
  if (!isMaster) {
    return;
  }
  const action: StorageActionSetAll = { type: 'set-all', data: { pluginId, dict } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  syncLog.info(`setAllStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

export function setStorageForPlugin(pluginId: string, key: string, value: string): void {
  if (!isMaster) {
    return;
  }
  const action: StorageActionSet = { type: 'set', data: { pluginId, key, value } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  syncLog.info(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

export function deleteAllStorageForPlugin(pluginId: string): void {
  if (!isMaster) {
    return;
  }
  const action: StorageActionDeleteAll = { type: 'delete-all', data: { pluginId } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  syncLog.info(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

export function deleteStorageForPlugin(pluginId: string, key: string): void {
  if (!isMaster) {
    return;
  }
  const action: StorageActionDelete = { type: 'delete', data: { pluginId, key } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  syncLog.info(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

