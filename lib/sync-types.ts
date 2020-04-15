/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

import { StorageDict, KeyVal } from './clusterManager';

export interface LogEntry {
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

export interface StorageAction {
  type: 'init' | 'set-all' | 'set' | 'delete-all' | 'delete'
  data: any;
}

export interface StorageActionInit extends StorageAction {
  type: 'init',
  data: StorageDict
}
export interface StorageActionSetAll extends StorageAction {
  type: 'set-all',
  data: {
    pluginId: string;
    dict: KeyVal;
  }
}

export interface StorageActionSet extends StorageAction {
  type: 'set',
  data: {
    pluginId: string;
    key: string;
    value: any;
  }
}

export interface StorageActionDeleteAll extends StorageAction {
  type: 'delete-all',
  data: {
    pluginId: string;
  }
}

export interface StorageActionDelete extends StorageAction {
  type: 'delete',
  data: {
    pluginId: string;
    key: string;
  }
}

export interface Storage {
  [pluginId: string]: {
    [key: string]: any;
  }
}

export interface SessionData {
  sid: string,
  session: any;
}

export function isSessionLogEntry(entry: LogEntry): entry is SessionLogEntry {
  return entry.type === 'session';
}

export function isSessionsLogEntry(entry: LogEntry): entry is SessionsLogEntry {
  return entry.type === 'sessions';
}

export function isStorageLogEntry(entry: LogEntry): entry is StorageLogEntry {
  return entry.type === 'storage';
}

export function isStorageActionInit(action: StorageAction): action is StorageActionInit {
  return action.type === 'init';
}

export function isStorageActionSetAll(action: StorageAction): action is StorageActionSetAll {
  return action.type === 'set-all';
}

export function isStorageActionSet(action: StorageAction): action is StorageActionSet {
  return action.type === 'set';
}

export function isStorageActionDeleteAll(action: StorageAction): action is StorageActionDeleteAll {
  return action.type === 'delete-all';
}

export function isStorageActionDelete(action: StorageAction): action is StorageActionDelete {
  return action.type === 'delete';
}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
