"use strict";
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
Object.defineProperty(exports, "__esModule", { value: true });
function isSessionSyncCommand(entry) {
    return entry.type === 'session';
}
exports.isSessionSyncCommand = isSessionSyncCommand;
function isStorageSyncCommand(entry) {
    return entry.type === 'storage';
}
exports.isStorageSyncCommand = isStorageSyncCommand;
function isSnapshotSyncCommand(entry) {
    return entry.type === 'snapshot';
}
exports.isSnapshotSyncCommand = isSnapshotSyncCommand;
function isStorageActionSetAll(action) {
    return action.type === 'set-all';
}
exports.isStorageActionSetAll = isStorageActionSetAll;
function isStorageActionSet(action) {
    return action.type === 'set';
}
exports.isStorageActionSet = isStorageActionSet;
function isStorageActionDeleteAll(action) {
    return action.type === 'delete-all';
}
exports.isStorageActionDeleteAll = isStorageActionDeleteAll;
function isStorageActionDelete(action) {
    return action.type === 'delete';
}
exports.isStorageActionDelete = isStorageActionDelete;
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
//# sourceMappingURL=raft-commands.js.map