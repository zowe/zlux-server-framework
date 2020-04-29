/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

import * as EventEmitter from 'events';
import { KeyVal } from './clusterManager';
import { SessionLogEntry, StorageActionSetAll, StorageLogEntry, StorageActionSet, StorageActionDeleteAll, StorageActionDelete } from './sync-types';
const zluxUtil = require('./util');
const syncLog = zluxUtil.loggers.utilLogger;

export const syncEventEmitter = new EventEmitter();

export function updateSession(sid: string, session: any): void {
  const data = { sid, session };
  const sessionLogEntry: SessionLogEntry = { type: 'session', payload: data };
  syncLog.info(`updateSession log entry ${JSON.stringify(sessionLogEntry)}`);
  syncEventEmitter.emit('session', sessionLogEntry);
}

export function setAllStorageForPlugin(pluginId: string, dict: KeyVal): void {
  const action: StorageActionSetAll = { type: 'set-all', data: { pluginId, dict } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  syncLog.info(`setAllStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

export function setStorageForPlugin(pluginId: string, key: string, value: string): void {
  const action: StorageActionSet = { type: 'set', data: { pluginId, key, value } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  syncLog.info(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

export function deleteAllStorageForPlugin(pluginId: string): void {
  const action: StorageActionDeleteAll = { type: 'delete-all', data: { pluginId } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  syncLog.info(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

export function deleteStorageForPlugin(pluginId: string, key: string): void {
  const action: StorageActionDelete = { type: 'delete', data: { pluginId, key } };
  const storageLogEntry: StorageLogEntry = { type: 'storage', payload: action };
  syncLog.info(`setStorageForPlugin log entry ${JSON.stringify(storageLogEntry)}`);
  syncEventEmitter.emit('storage', storageLogEntry);
}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
