/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

import { KeyVal } from './clusterManager';
import { Snapshot } from './raft';

export interface SyncCommand {
  type: 'session' | 'sessions' | 'storage' | 'snapshot',
  payload: any;
}

export interface SessionSyncCommand extends SyncCommand {
  type: 'session',
  payload: SessionData;
}

export interface StorageSyncCommand extends SyncCommand {
  type: 'storage',
  payload: StorageAction;
}

export interface StorageAction {
  type: 'set-all' | 'set' | 'delete-all' | 'delete'
  data: any;
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

export interface SnapshotSyncCommand extends SyncCommand {
  type: 'snapshot',
  payload: Snapshot;
}

export interface SessionData {
  sid: string,
  session: any;
}

export interface SessionDict {
  [sid:string]: any;
}

export function isSessionSyncCommand(entry: SyncCommand): entry is SessionSyncCommand {
  return entry.type === 'session';
}

export function isStorageSyncCommand(entry: SyncCommand): entry is StorageSyncCommand {
  return entry.type === 'storage';
}

export function isSnapshotSyncCommand(entry: SyncCommand): entry is SnapshotSyncCommand {
  return entry.type === 'snapshot';
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
