/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

const sessionStore = require('./sessionStore').sessionStore;
import { syncEventEmitter } from './sync';
import {
  SessionData,
  SessionSyncCommand,
  SessionsSyncCommand,
  StorageActionInit,
  StorageSyncCommand,
} from './raft-commands';
import { Raft, State } from './raft';
const zluxUtil = require('./util');
const syncLog = zluxUtil.loggers.utilLogger;

export class SyncService {
  constructor(
    private raft: Raft,
  ) {
    this.init();
  }

  private init(): void {
    const sessionChangeListener = this.onSessionChange.bind(this);
    const storageChangeListener = this.onStorageChange.bind(this);
    this.raft.stateEmitter.on('state', (state: State) => {
      if (state === 'Leader') {
        this.raft.takeIntoService().then(() => {
          syncEventEmitter.addListener('session', sessionChangeListener);
          syncEventEmitter.addListener('storage', storageChangeListener);
        });
      } else {
        syncEventEmitter.removeListener('session', sessionChangeListener);
        syncEventEmitter.removeListener('storage', storageChangeListener);
        this.raft.takeOutOfService().then(() => {});
      }
    });
  }

  private onSessionChange(entry: SessionSyncCommand) {
    syncLog.debug(`SyncEndpoint:onSessionChange: send command ${JSON.stringify(entry)}`);
    this.raft.startCommand(entry);
  }

  private onStorageChange(entry: StorageSyncCommand) {
    syncLog.info(`SyncEndpoint:onStorageChange: send command entry ${JSON.stringify(entry)}`);
    this.raft.startCommand(entry);
  }

  private sendCurrentStateToClient(): void {
    syncLog.debug(`SendCurrentStateToClient`);
    this.sendSessionStorageSnapshotToClient();
    this.sendDataserviceStorageSnapshotToClient();
  }

  private sendSessionStorageSnapshotToClient(): void {
    syncLog.debug(`sendSessionStorageSnapshotToClient`);
    sessionStore.all((err: Error | null, sessions: { [sid: string]: any }) => {
      const sessionData: SessionData[] = [];
      Object.keys(sessions).forEach(sid => {
        const session = sessions[sid];
        sessionData.push({ sid, session });
      });
      syncLog.debug(`send all sessions as array ${JSON.stringify(sessionData)}`);
      const sessionsLogEntry: SessionsSyncCommand = { type: 'sessions', payload: sessionData };
      this.raft.startCommand(sessionsLogEntry);
    });
  }

  private sendDataserviceStorageSnapshotToClient(): void {
    syncLog.debug(`sendDataserviceStorageSnapshotToClient`);
    const clusterManager = process.clusterManager;
    clusterManager.getStorageCluster().then(storage => {
      syncLog.debug(`[cluster storage: ${JSON.stringify(storage)}]`);
      const action: StorageActionInit = { type: 'init', data: storage };
      const storageLogEntry: StorageSyncCommand = { type: 'storage', payload: action };
      syncLog.debug(`initStorageForNewClient log entry ${JSON.stringify(storageLogEntry)}`);
      this.raft.startCommand(storageLogEntry);
    });
  }
}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
