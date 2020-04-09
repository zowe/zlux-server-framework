"use strict";
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
Object.defineProperty(exports, "__esModule", { value: true });
var sync_1 = require("./sync");
var zluxUtil = require('./util');
var raftLog = zluxUtil.loggers.raftLogger;
var SyncService = /** @class */ (function () {
    function SyncService(raft) {
        this.raft = raft;
        this.init();
    }
    SyncService.prototype.init = function () {
        var _this = this;
        var sessionChangeListener = this.onSessionChange.bind(this);
        var storageChangeListener = this.onStorageChange.bind(this);
        this.raft.stateEmitter.on('state', function (state) {
            if (state === 'Leader') {
                _this.raft.takeIntoService().then(function () {
                    sync_1.syncEventEmitter.addListener('session', sessionChangeListener);
                    sync_1.syncEventEmitter.addListener('storage', storageChangeListener);
                });
            }
            else {
                sync_1.syncEventEmitter.removeListener('session', sessionChangeListener);
                sync_1.syncEventEmitter.removeListener('storage', storageChangeListener);
                _this.raft.takeOutOfService().then(function () { });
            }
        });
    };
    SyncService.prototype.onSessionChange = function (entry) {
        raftLog.debug("SyncEndpoint:onSessionChange: send command " + JSON.stringify(entry));
        this.raft.startCommand(entry);
    };
    SyncService.prototype.onStorageChange = function (entry) {
        raftLog.debug("SyncEndpoint:onStorageChange: send command entry " + JSON.stringify(entry));
        this.raft.startCommand(entry);
    };
    return SyncService;
}());
exports.SyncService = SyncService;
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
//# sourceMappingURL=sync-service.js.map