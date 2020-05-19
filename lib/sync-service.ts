/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

import { syncEventEmitter } from './sync';
import {
  SessionSyncCommand,
  StorageSyncCommand,
} from './raft-commands';
import { Raft, State } from './raft';
const zluxUtil = require('./util');
const raftLog = zluxUtil.loggers.raftLogger;

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
    raftLog.debug(`SyncEndpoint:onSessionChange: send command ${JSON.stringify(entry)}`);
    this.raft.startCommand(entry);
  }

  private onStorageChange(entry: StorageSyncCommand) {
    raftLog.debug(`SyncEndpoint:onStorageChange: send command entry ${JSON.stringify(entry)}`);
    this.raft.startCommand(entry);
  }

}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
