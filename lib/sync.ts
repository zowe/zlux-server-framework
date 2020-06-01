/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

import * as EventEmitter from 'events';
import { KeyVal } from './clusterManager';
import { SessionSyncCommand, StorageActionSetAll, StorageSyncCommand, StorageActionSet, StorageActionDeleteAll, StorageActionDelete } from './raft-commands';
const zluxUtil = require('./util');
const raftLog = zluxUtil.loggers.raftLogger;

export const syncEventEmitter = new EventEmitter();

export function updateSession(sid: string, session: any): void {
  const data = { sid, session };
  const sessionLogEntry: SessionSyncCommand = { type: 'session', payload: data };
  raftLog.trace(`updateSession log entry ${JSON.stringify(sessionLogEntry)}`);
  syncEventEmitter.emit('session', sessionLogEntry);
}

export function setAllStorageForPlugin(pluginId: string, dict: KeyVal): void {
  const action: StorageActionSetAll = { type: 'set-all', data: { pluginId, dict } };
  const storageLogEntry: StorageSyncCommand = { type: 'storage', payload: action };
  raftLog.trace(`setAllStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

export function setStorageForPlugin(pluginId: string, key: string, value: string): void {
  const action: StorageActionSet = { type: 'set', data: { pluginId, key, value } };
  const storageLogEntry: StorageSyncCommand = { type: 'storage', payload: action };
  raftLog.trace(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

export function deleteAllStorageForPlugin(pluginId: string): void {
  const action: StorageActionDeleteAll = { type: 'delete-all', data: { pluginId } };
  const storageLogEntry: StorageSyncCommand = { type: 'storage', payload: action };
  raftLog.trace(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

export function deleteStorageForPlugin(pluginId: string, key: string): void {
  const action: StorageActionDelete = { type: 'delete', data: { pluginId, key } };
  const storageLogEntry: StorageSyncCommand = { type: 'storage', payload: action };
  raftLog.trace(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
