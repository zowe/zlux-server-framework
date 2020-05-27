"use strict";
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = y[op[0] & 2 ? "return" : op[0] ? "throw" : "next"]) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [0, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var raft_rpc_ws_1 = require("./raft-rpc-ws");
var events_1 = require("events");
var raft_commands_1 = require("./raft-commands");
var sessionStore = require('./sessionStore').sessionStore;
var fs = require("fs");
var path = require("path");
var sync_service_1 = require("./sync-service");
var zluxUtil = require('./util');
var raftLog = zluxUtil.loggers.raftLogger;
var RaftPeer = /** @class */ (function (_super) {
    __extends(RaftPeer, _super);
    function RaftPeer(host, port, secure, instanceId, apimlClient) {
        var _this = _super.call(this, host, port, secure) || this;
        _this.instanceId = instanceId;
        _this.apimlClient = apimlClient;
        return _this;
    }
    RaftPeer.make = function (masterInstance, apiml) {
        var host = masterInstance.hostName;
        var secure = masterInstance.securePort['@enabled'];
        var port = secure ? masterInstance.securePort.$ : masterInstance.port.$;
        var instanceId = masterInstance.instanceId;
        return new RaftPeer(host, port, secure, instanceId, apiml);
    };
    RaftPeer.prototype.takeOutOfService = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.apimlClient.takeInstanceOutOfService(this.instanceId)];
            });
        });
    };
    RaftPeer.prototype.takeIntoService = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.apimlClient.takeIntoService()];
            });
        });
    };
    Object.defineProperty(RaftPeer.prototype, "baseAddress", {
        get: function () {
            return (this.secure ? 'https' : 'https') + "://" + this.host + ":" + this.port;
        },
        enumerable: true,
        configurable: true
    });
    return RaftPeer;
}(raft_rpc_ws_1.RaftRPCWebSocketDriver));
exports.RaftPeer = RaftPeer;
var FilePersister = /** @class */ (function () {
    function FilePersister(stateFilename, snapshotFilename) {
        this.stateFilename = stateFilename;
        this.snapshotFilename = snapshotFilename;
        raftLog.debug("raft state file: " + stateFilename);
    }
    FilePersister.prototype.saveState = function (state) {
        try {
            fs.writeFileSync(this.stateFilename, state, 'utf-8');
        }
        catch (e) {
            raftLog.warn("unable to save raft persistent state: " + e, JSON.stringify(e));
        }
    };
    FilePersister.prototype.saveSnapshot = function (snapshot) {
        try {
            fs.writeFileSync(this.snapshotFilename, snapshot, 'utf-8');
        }
        catch (e) {
            raftLog.warn("unable to save storage snapshot: " + e, JSON.stringify(e));
        }
    };
    FilePersister.prototype.readState = function () {
        try {
            var buffer = fs.readFileSync(this.stateFilename);
            console.log("state is " + JSON.stringify(buffer.toString()));
            return buffer.toString();
        }
        catch (e) {
            raftLog.warn("unable to read raft persistent state: " + e, JSON.stringify(e));
        }
    };
    FilePersister.prototype.readSnapshot = function () {
        try {
            var buffer = fs.readFileSync(this.snapshotFilename);
            console.log("snapshot is " + JSON.stringify(buffer.toString()));
            return buffer.toString();
        }
        catch (e) {
            raftLog.warn("unable to read raft persistent state: " + e, JSON.stringify(e));
        }
    };
    FilePersister.prototype.saveStateAndSnapshot = function (state, snapshot) {
        this.saveState(state);
        this.saveSnapshot(snapshot);
    };
    return FilePersister;
}());
exports.FilePersister = FilePersister;
var DummyPersister = /** @class */ (function () {
    function DummyPersister() {
    }
    DummyPersister.prototype.saveState = function (state) {
    };
    DummyPersister.prototype.readSnapshot = function () {
        return;
    };
    DummyPersister.prototype.readState = function () {
        return;
    };
    DummyPersister.prototype.saveStateAndSnapshot = function (state, snapshot) {
    };
    return DummyPersister;
}());
exports.DummyPersister = DummyPersister;
var minElectionTimeout = 1000;
var maxElectionTimeout = 2000;
var Raft = /** @class */ (function () {
    function Raft() {
        this.stateEmitter = new events_1.EventEmitter();
        this.state = 'Follower';
        this.electionTimeout = Math.floor(Math.random() * (maxElectionTimeout - minElectionTimeout) + minElectionTimeout);
        this.debug = true;
        this.started = false;
        // persistent state
        this.currentTerm = 0;
        this.votedFor = -1;
        this.log = [];
        this.startIndex = 0;
        this.startTerm = -1;
        // volatile state on all servers
        this.commitIndex = -1;
        this.lastApplied = -1;
        // volatile state on leaders(Reinitialized after election):
        this.nextIndex = []; //  for each server, index of the next log entry to send to that server (initialized to leader last log index + 1)
        this.matchIndex = []; // for each server, index of highest log entry known to be replicated on server (initialized to 0, increases monotonically)
        this.heartbeatInterval = Math.round(minElectionTimeout * .75);
        this.leaderId = -1; // last observed leader id
        this.discardCount = 0;
        this.maxLogSize = -1;
    }
    Raft.prototype.start = function (apiml) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, peers, me;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        raftLog.info("starting peer electionTimeout " + this.electionTimeout + " ms heartbeatInterval " + this.heartbeatInterval + " ms");
                        this.apiml = apiml;
                        this.persister = Raft.makePersister();
                        this.maxLogSize = Raft.getMaxLogSize();
                        return [4 /*yield*/, this.waitUntilZluxClusterIsReady()];
                    case 1:
                        _a = _b.sent(), peers = _a.peers, me = _a.me;
                        this.peers = peers;
                        this.me = me;
                        if (me === -1) {
                            raftLog.warn("unable to find my instance among registered zlux instances");
                            return [2 /*return*/];
                        }
                        this.syncService = new sync_service_1.SyncService(this);
                        this.readSnapshot(this.persister.readSnapshot());
                        this.readPersistentState(this.persister.readState());
                        this.scheduleElectionOnTimeout();
                        this.addOnReRegisterHandler();
                        this.started = true;
                        raftLog.info("peer " + me + " started with %s log", this.log.length > 0 ? 'not empty' : 'empty');
                        return [2 /*return*/];
                }
            });
        });
    };
    Raft.prototype.waitUntilZluxClusterIsReady = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            var instanceId, appServerClusterSize, zluxInstances, me, peers;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.apiml.takeOutOfService()];
                    case 1:
                        _a.sent();
                        instanceId = this.apiml.getInstanceId();
                        appServerClusterSize = +process.env.ZOWE_APP_SERVER_CLUSTER_SIZE;
                        if (!Number.isInteger(appServerClusterSize) || appServerClusterSize < 3) {
                            appServerClusterSize = 3;
                        }
                        raftLog.info("my instance is " + instanceId + ", app-server cluster size " + appServerClusterSize);
                        return [4 /*yield*/, this.apiml.waitUntilZluxClusterIsReady(appServerClusterSize)];
                    case 2:
                        zluxInstances = _a.sent();
                        raftLog.debug("zlux cluster is ready, instances " + JSON.stringify(zluxInstances, null, 2));
                        me = zluxInstances.findIndex(function (instance) { return instance.instanceId === instanceId; });
                        raftLog.debug("my peer index is " + me);
                        peers = zluxInstances.map(function (instance) { return RaftPeer.make(instance, _this.apiml); });
                        return [2 /*return*/, { peers: peers, me: me }];
                }
            });
        });
    };
    Raft.makePersister = function () {
        var persister;
        if (process.env.ZLUX_RAFT_PERSISTENCE_ENABLED === "TRUE") {
            raftLog.info("raft persistence enabled");
            var logPath = process.env.ZLUX_LOG_PATH;
            if (logPath.startsWith("\"") && logPath.endsWith("\"")) {
                logPath = logPath.substring(1, logPath.length - 1);
            }
            var stateFilename = path.join(path.dirname(logPath), 'raft.data');
            var snapshotFilename = path.join(path.dirname(logPath), 'snapshot.data');
            raftLog.debug("log " + logPath + " stateFilename " + stateFilename + " snapshotFilename " + snapshotFilename);
            persister = new FilePersister(stateFilename, snapshotFilename);
        }
        else {
            raftLog.info("raft persistence disabled");
            persister = new DummyPersister();
        }
        return persister;
    };
    Raft.getMaxLogSize = function () {
        var maxLogSize = +process.env.ZLUX_RAFT_MAX_LOG_SIZE;
        if (!Number.isInteger(maxLogSize)) {
            maxLogSize = 100;
        }
        raftLog.info("raft max log size is %d", maxLogSize);
        return maxLogSize;
    };
    // This is a temporary protection against "eureka heartbeat FAILED, Re-registering app" issue
    Raft.prototype.addOnReRegisterHandler = function () {
        var _this = this;
        var peer = this.peers[this.me];
        peer.apimlClient.onReRegister(function () {
            if (!_this.isLeader()) {
                peer.takeOutOfService().then(function () { return _this.print('force taken out of service because of re-registration in Eureka'); });
            }
        });
    };
    Raft.prototype.isStarted = function () {
        return this.started;
    };
    Raft.prototype.getPeers = function () {
        return this.peers;
    };
    Raft.prototype.scheduleElectionOnTimeout = function () {
        var _this = this;
        if (this.isLeader()) {
            return;
        }
        this.electionTimeoutId = setTimeout(function () {
            if (_this.isLeader()) {
                // this.scheduleElectionOnTimeout();
            }
            else {
                _this.attemptElection();
            }
        }, this.electionTimeout);
    };
    Raft.prototype.isLeader = function () {
        return this.state === 'Leader';
    };
    Raft.prototype.attemptElection = function () {
        var _this = this;
        if (this.state !== 'Candidate') {
            this.state = 'Candidate';
            this.emitState();
        }
        this.currentTerm++;
        this.votedFor = this.me;
        var votes = 1;
        var done = false;
        var term = this.currentTerm;
        var peerCount = this.peers.length;
        this.print("attempting election at term %d", this.currentTerm);
        var _loop_1 = function (server) {
            if (server === this_1.me) {
                return "continue";
            }
            setImmediate(function () { return __awaiter(_this, void 0, void 0, function () {
                var peerAddress, voteGranted;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            peerAddress = this.peers[server].address;
                            return [4 /*yield*/, this.callRequestVote(server, term)];
                        case 1:
                            voteGranted = _a.sent();
                            if (!voteGranted) {
                                this.print("vote by peer %s not granted", peerAddress);
                                return [2 /*return*/];
                            }
                            votes++;
                            if (done) {
                                this.print("got vote from peer %s but election already finished", peerAddress);
                                return [2 /*return*/];
                            }
                            else if (this.state == 'Follower') {
                                this.print("got heartbeat, stop election");
                                done = true;
                                return [2 /*return*/];
                            }
                            else if (votes <= Math.floor(peerCount / 2)) {
                                this.print("got vote from %s but not enough votes yet to become Leader", peerAddress);
                                return [2 /*return*/];
                            }
                            if (this.state === 'Candidate') {
                                this.print("got final vote from %s and became Leader of term %d", peerAddress, term);
                                done = true;
                                this.convertToLeader();
                            }
                            return [2 /*return*/];
                    }
                });
            }); });
        };
        var this_1 = this;
        for (var server = 0; server < peerCount; server++) {
            _loop_1(server);
        }
        this.scheduleElectionOnTimeout();
    };
    Raft.prototype.convertToLeader = function () {
        var _this = this;
        this.state = 'Leader';
        // When a leader first comes to power, it initializes all nextIndex values to the index just after the last one in its log (11 in Figure 7)
        var logLen = this.len();
        for (var i = 0; i < this.peers.length; i++) {
            this.nextIndex[i] = logLen;
            this.matchIndex[i] = -1;
        }
        this.print("nextIndex %s", JSON.stringify(this.nextIndex));
        this.print("matchIndex %s", JSON.stringify(this.matchIndex));
        setImmediate(function () { return _this.emitState(); });
        this.sendHeartbeat();
    };
    Raft.prototype.emitState = function () {
        this.stateEmitter.emit('state', this.state);
    };
    Raft.prototype.sendHeartbeat = function () {
        var _this = this;
        var peerCount = this.peers.length;
        var _loop_2 = function (server) {
            if (server == this_2.me) {
                return "continue";
            }
            setImmediate(function () { return __awaiter(_this, void 0, void 0, function () {
                var _a, ok, success, conflict;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            if (!this.isLeader()) {
                                this.print("cancel heartbeat to %d at term %d because not leader anymore", server, this.currentTerm);
                                return [2 /*return*/];
                            }
                            this.print("sends heartbeat to %d at term %d", server, this.currentTerm);
                            return [4 /*yield*/, this.callAppendEntries(server, this.currentTerm, 'heartbeat')];
                        case 1:
                            _a = _b.sent(), ok = _a.ok, success = _a.success, conflict = _a.conflict;
                            if (ok && !success) {
                                if (this.isLeader() && conflict) {
                                    this.print("got unsuccessful heartbeat response from %d, adjust nextIndex because of conflict %s", server, JSON.stringify(conflict));
                                    this.adjustNextIndexForServer(server, conflict);
                                }
                            }
                            else if (ok && success) {
                                this.print("got successful heartbeat response from %d at term %d, nextIndex = %d, matchIndex = %d, commitIndex = %d", server, this.currentTerm, this.nextIndex[server], this.matchIndex[server], this.commitIndex);
                                this.checkIfCommitted();
                            }
                            return [2 /*return*/];
                    }
                });
            }); });
        };
        var this_2 = this;
        for (var server = 0; server < peerCount; server++) {
            _loop_2(server);
        }
        if (!this.isLeader()) {
            this.print("stop heartbeat because not leader anymore");
            return;
        }
        this.heartbeatTimeoutId = setTimeout(function () { return _this.sendHeartbeat(); }, this.heartbeatInterval);
    };
    Raft.prototype.adjustNextIndexForServer = function (server, conflict) {
        var _this = this;
        if (conflict.conflictIndex === -1 && conflict.conflictTerm === -1) {
            if (conflict.logLength === 0 && this.lastSnapshot) {
                this.print("follower's log is empty(have it re-started?) and there is a snapshot, send the snapshot to the follower");
                setImmediate(function () { return _this.installSnapshotForServer(server, _this.currentTerm, _this.lastSnapshot); });
            }
            else {
                this.nextIndex[server] = conflict.logLength;
                this.print("set nextIndex for server %d = %d because there are missing entries in follower's log", server, this.nextIndex[server]);
            }
        }
        else if (conflict.conflictIndex !== -1) {
            this.nextIndex[server] = conflict.conflictIndex;
            this.print("set nextIndex for server %d = %d because conflictIndex given", server, this.nextIndex[server]);
        }
        else {
            if (this.nextIndex[server] > this.startIndex) {
                this.nextIndex[server]--;
                this.print("decrease nextIndex for server %d to %d", server, this.nextIndex[server]);
            }
        }
    };
    Raft.prototype.checkIfCommitted = function () {
        var _this = this;
        var minPeers = Math.floor(this.peers.length / 2);
        var m = new Map();
        for (var mi = 0; mi < this.matchIndex.length; mi++) {
            var matchIndex = this.matchIndex[mi];
            if (matchIndex > this.commitIndex) {
                if (m.has(matchIndex)) {
                    m[matchIndex]++;
                }
                else {
                    m[matchIndex] = 1;
                }
            }
        }
        m.forEach(function (count, matchIndex) {
            if (matchIndex > _this.commitIndex && count >= minPeers) {
                for (var i = _this.commitIndex + 1; i <= matchIndex && i < _this.len(); i++) {
                    _this.commitIndex = i;
                    _this.print("leader about to apply %d %s", _this.commitIndex, JSON.stringify(_this.item(_this.commitIndex)));
                    var applyMsg = {
                        commandValid: true,
                        commandIndex: _this.commitIndex + 1,
                        command: _this.item(_this.commitIndex).command,
                    };
                    _this.applyCommand(applyMsg);
                    _this.lastApplied = _this.commitIndex;
                }
                _this.print("checkIfCommitted: adjust commitIndex to %d", matchIndex);
            }
        });
    };
    Raft.prototype.callAppendEntries = function (server, currentTerm, kind) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            var entries, last, start, ni, prevLogIndex, prevLogTerm, args, peer;
            return __generator(this, function (_a) {
                entries = [];
                last = this.len();
                if (kind == "appendentries") {
                    last = this.commitIndex + 1;
                }
                else {
                    last = last - 1;
                }
                start = this.nextIndex[server];
                if (start < this.startIndex) {
                    start = this.startIndex;
                }
                for (ni = start; ni <= last && ni < this.len(); ni++) {
                    entries.push(this.item(ni));
                }
                prevLogIndex = this.nextIndex[server] - 1;
                prevLogTerm = -1;
                if (prevLogIndex >= this.startIndex && prevLogIndex < this.len()) {
                    prevLogTerm = this.item(prevLogIndex).term;
                }
                this.print("CallAppendEntries %s for follower %d entries %s, my log %s", kind, server, JSON.stringify(entries), JSON.stringify(this.log));
                args = {
                    leaderId: this.me,
                    term: this.currentTerm,
                    entries: entries,
                    leaderCommit: this.commitIndex,
                    prevLogIndex: prevLogIndex,
                    prevLogTerm: prevLogTerm,
                };
                peer = this.peers[server];
                return [2 /*return*/, peer.sendAppendEntries(args)
                        .then(function (reply) {
                        _this.ensureResponseTerm(reply.term);
                        if (reply.success && entries.length > 0) {
                            _this.nextIndex[server] = last + 1;
                            _this.matchIndex[server] = last;
                        }
                        _this.print("successfully appended entries to server %d nextIndex %s matchIndex %s", server, JSON.stringify(_this.nextIndex), JSON.stringify(_this.matchIndex));
                        return { ok: true, success: reply.success, conflict: reply.conflict };
                    })
                        .catch(function () { return ({ ok: false, success: false }); })];
            });
        });
    };
    Raft.prototype.callRequestVote = function (server, term) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            var peer, lastLogTerm, lastLogIndex, requestVoteArgs;
            return __generator(this, function (_a) {
                peer = this.peers[server];
                lastLogTerm = this.startTerm;
                lastLogIndex = this.lastIndex();
                if (lastLogIndex >= this.startIndex) {
                    lastLogTerm = this.item(lastLogIndex).term;
                }
                requestVoteArgs = {
                    candidateId: this.me,
                    term: term,
                    lastLogIndex: lastLogIndex,
                    lastLogTerm: lastLogTerm,
                };
                this.print("CallRequestVote: my log %s", JSON.stringify(this.log));
                return [2 /*return*/, peer.sendRequestVote(requestVoteArgs)
                        .then(function (reply) {
                        _this.ensureResponseTerm(reply.term);
                        return reply.voteGranted;
                    })
                        .catch(function () { return false; })];
            });
        });
    };
    Raft.prototype.ensureResponseTerm = function (responseTerm) {
        if (responseTerm > this.currentTerm) {
            this.print("If RPC response contains term(%d) > currentTerm(%d): set currentTerm = T, convert to follower (\u00A75.1)", responseTerm, this.currentTerm);
            this.currentTerm = responseTerm;
            this.convertToFollower();
        }
    };
    Raft.prototype.installSnapshot = function (args) {
        if (!this.started) {
            return {
                success: false,
            };
        }
        this.print("got InstallSnapshot request term %d, LastIncludedIndex %d, LastIncludedTerm %d", args.term, args.snapshot.lastIncludedIndex, args.snapshot.lastIncludedTerm);
        if (args.term < this.currentTerm) {
            this.print("Reply false immediately if term(%d) < currentTerm", args.term);
            return {
                success: false
            };
        }
        this.currentTerm = args.term;
        this.cancelCurrentElectionTimeoutAndReschedule();
        var applyMsg = {
            command: {
                type: 'snapshot',
                payload: args.snapshot,
            },
            commandValid: false,
            commandIndex: -1,
        };
        this.applyCommand(applyMsg);
        this.discardLog(args.snapshot);
        this.lastSnapshot = args.snapshot;
        if (args.snapshot.lastIncludedIndex > this.commitIndex) {
            this.commitIndex = args.snapshot.lastIncludedIndex;
        }
        if (args.snapshot.lastIncludedIndex > this.lastApplied) {
            this.lastApplied = args.snapshot.lastIncludedIndex;
        }
        this.print("snapshot installed");
        return {
            success: true
        };
    };
    Raft.prototype.invokeInstallSnapshot = function (args) {
        return this.invokeRPCMethod('invokeInstallSnapshotLocal', args);
    };
    Raft.prototype.invokeInstallSnapshotLocal = function (args, resultHandler) {
        var reply = this.installSnapshot(args);
        resultHandler(reply);
    };
    Raft.prototype.invokeRPCMethod = function (method, args) {
        if (!process.clusterManager || process.clusterManager.isMaster) {
            return this[method](args);
        }
        return process.clusterManager.callClusterMethodRemote('./raft', 'raft', method, [args], function (result) { return result[0]; });
    };
    Raft.prototype.invokeRaftMethod = function (method) {
        if (!process.clusterManager || process.clusterManager.isMaster) {
            return this[method]();
        }
        return process.clusterManager.callClusterMethodRemote('./raft', 'raft', method, [], function (result) { return result[0]; });
    };
    Raft.prototype.callInstallSnapshot = function (server, term, snapshot) {
        return __awaiter(this, void 0, void 0, function () {
            var args, reply, e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        args = {
                            term: term,
                            snapshot: snapshot,
                        };
                        this.print("callInstallSnapshot for server %d with args %s", server, JSON.stringify(args));
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this.peers[server].sendInstallSnapshot(args)];
                    case 2:
                        reply = _a.sent();
                        return [2 /*return*/, ({
                                ok: true,
                                success: reply.success,
                            })];
                    case 3:
                        e_1 = _a.sent();
                        return [2 /*return*/, ({ ok: false, success: false })];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    Raft.prototype.appendEntries = function (args) {
        var requestType = "heartbeat";
        if (args.entries.length > 0) {
            requestType = "appendentries";
        }
        this.ensureRequestTerm(args.term);
        this.print("got %s request from leader %d at term %d, my term %d, prevLogIndex %d, entries %s", requestType, args.leaderId, args.term, this.currentTerm, args.prevLogIndex, JSON.stringify(args.entries));
        if (!this.started) {
            this.print("not started yet!, reply false");
            return {
                term: this.currentTerm,
                success: false,
            };
        }
        this.print("my log is %s", JSON.stringify(this.log));
        // 1. Reply false if term < currentTerm (§5.1)
        if (args.term < this.currentTerm) {
            this.print("1. Reply false if term < currentTerm (§5.1)");
            return {
                success: false,
                term: this.currentTerm,
            };
        }
        this.leaderId = args.leaderId;
        this.convertToFollower();
        this.cancelCurrentElectionTimeoutAndReschedule();
        if (args.prevLogIndex >= this.startIndex) {
            // 2. Reply false if log doesn’t contain an entry at prevLogIndex whose term matches prevLogTerm (§5.3)
            if (args.prevLogIndex >= this.len()) {
                this.print("2. Reply false if log doesn’t contain an entry at prevLogIndex whose term matches prevLogTerm (§5.3)");
                return {
                    success: false,
                    term: this.currentTerm,
                    conflict: {
                        conflictIndex: this.startIndex - 1,
                        conflictTerm: this.startTerm,
                        logLength: this.len(),
                    }
                };
            }
            // 3. If an existing entry conflicts with a new one (same index but different terms), delete the existing entry and all that follow it (§5.3)
            var prevLogTerm = this.item(args.prevLogIndex).term;
            if (prevLogTerm != args.prevLogTerm) {
                this.print("3. If an existing entry conflicts with a new one (same index but different terms), delete the existing entry and all that follow it (§5.3)");
                this.print("commit index %d, remove entries %s", this.commitIndex, JSON.stringify(this.log.slice(this.relativeIndex(args.prevLogIndex))));
                this.log = this.log.slice(0, this.relativeIndex(args.prevLogIndex));
                this.print("remaining entries %s", JSON.stringify(this.log));
                var conflict = {
                    conflictTerm: prevLogTerm,
                    conflictIndex: this.findFirstEntryWithTerm(prevLogTerm),
                    logLength: this.len(),
                };
                this.print("reply false, conflict %s", conflict);
                return {
                    success: false,
                    term: this.currentTerm,
                    conflict: conflict,
                };
            }
        }
        this.print("leader commit %d my commit %d", args.leaderCommit, this.commitIndex);
        if (args.entries.length > 0) {
            // 4. Append any new entries not already in the log
            var lastLogIndex = this.lastIndex();
            if (args.prevLogIndex < lastLogIndex) {
                var trimIndex = args.prevLogIndex + 1;
                if (trimIndex < this.startIndex) {
                    trimIndex = this.startIndex;
                }
                this.log = this.log.slice(0, this.relativeIndex(trimIndex));
                if (args.prevLogIndex >= this.startIndex) {
                    this.print("truncate log, last log entry is [%d]=%s", lastLogIndex, JSON.stringify(this.item(lastLogIndex)));
                }
                else {
                    this.print("truncate log: make long empty");
                }
            }
            this.print("4. Append any new entries not already in the log at index %d: %s", this.len(), JSON.stringify(args.entries));
            this.log = this.log.concat(args.entries);
        }
        // 5. If leaderCommit > commitIndex, set commitIndex = min(leaderCommit, index of last new entry)
        var lastNewEntryIndex = this.lastIndex();
        if (args.leaderCommit > this.commitIndex) {
            this.print("5. If leaderCommit(%d) > commitIndex(%d), set commitIndex = min(leaderCommit, index of last new entry) = %d", args.leaderCommit, this.commitIndex, Math.min(args.leaderCommit, lastNewEntryIndex));
            this.commitIndex = Math.min(args.leaderCommit, lastNewEntryIndex);
        }
        for (; this.lastApplied <= this.commitIndex; this.lastApplied++) {
            if (this.lastApplied < this.startIndex) {
                continue;
            }
            var applyMsg = {
                commandValid: true,
                commandIndex: this.lastApplied + 1,
                command: this.item(this.lastApplied).command,
            };
            this.applyCommand(applyMsg);
        }
        this.print("%s reply with success = true", requestType);
        return {
            success: true,
            term: args.term,
        };
    };
    Raft.prototype.findFirstEntryWithTerm = function (term) {
        var index = -1;
        for (var i = this.lastIndex(); i >= this.startIndex; i--) {
            var xterm = this.item(i).term;
            if (xterm === term) {
                index = i;
            }
            else if (xterm < term) {
                break;
            }
        }
        return index;
    };
    Raft.prototype.appendEntriesAndWritePersistentState = function (args) {
        if (!this.started) {
            return {
                success: false,
                term: 0,
            };
        }
        var reply = this.appendEntries(args);
        this.writePersistentState("after appendEntries");
        return reply;
    };
    Raft.prototype.invokeAppendEntriesAndWritePersistentState = function (args) {
        return this.invokeRPCMethod('invokeAppendEntriesAndWritePersistentStateLocal', args);
    };
    Raft.prototype.invokeAppendEntriesAndWritePersistentStateLocal = function (args, resultHandler) {
        var reply = this.appendEntriesAndWritePersistentState(args);
        resultHandler(reply);
    };
    Raft.prototype.applyCommand = function (applyMsg) {
        var _this = this;
        if (!this.isLeader()) {
            this.applyCommandToFollower(applyMsg);
        }
        else {
            if (this.maxLogSize > 0 && this.log.length > this.maxLogSize) {
                this.print("raft log size(%d) exceeds max log size(%d)", this.log.length, this.maxLogSize);
                setImmediate(function () { return __awaiter(_this, void 0, void 0, function () {
                    var snapshot;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0: return [4 /*yield*/, this.createSnapshot(this.lastApplied)];
                            case 1:
                                snapshot = _a.sent();
                                this.discardLogIfLeader(snapshot);
                                this.lastSnapshot = snapshot;
                                return [2 /*return*/];
                        }
                    });
                }); });
            }
        }
        this.print("applied %s", JSON.stringify(applyMsg));
    };
    Raft.prototype.ensureRequestTerm = function (requestTerm) {
        if (requestTerm > this.currentTerm) {
            this.print("If RPC request contains term(%d) > currentTerm(%d): set currentTerm = T, convert to follower (§5.1)", requestTerm, this.currentTerm);
            this.currentTerm = requestTerm;
            this.convertToFollower();
        }
    };
    Raft.prototype.convertToFollower = function () {
        if (this.state != 'Follower') {
            this.print('convert to Follower');
            this.state = 'Follower';
            this.cancelCurrentElectionTimeoutAndReschedule();
            this.cancelHeartbeat();
            this.emitState();
        }
    };
    Raft.prototype.cancelHeartbeat = function () {
        if (this.heartbeatTimeoutId) {
            clearTimeout(this.heartbeatTimeoutId);
            this.heartbeatTimeoutId = undefined;
        }
    };
    Raft.prototype.cancelCurrentElectionTimeoutAndReschedule = function () {
        clearTimeout(this.electionTimeoutId);
        this.scheduleElectionOnTimeout();
    };
    Raft.prototype.requestVote = function (args) {
        this.print("got vote request from %d at term %d, lastLogIndex %d, my term is %d, my commit index %d", args.candidateId, args.term, args.lastLogIndex, this.currentTerm, this.commitIndex);
        if (!this.started) {
            this.print("not started yet!, reply false");
            return {
                term: this.currentTerm,
                voteGranted: false,
            };
        }
        this.print("my log %s", JSON.stringify(this.log));
        if (args.term < this.currentTerm) {
            this.print("got vote request from %d at term %d", args.candidateId, args.term);
            return {
                term: this.currentTerm,
                voteGranted: false,
            };
        }
        if (args.term > this.currentTerm) {
            this.print("new term observed, I haven't voted at term %d", args.term);
            this.votedFor = -1;
        }
        this.print("vote args %s", JSON.stringify(args));
        if (this.votedFor != -1 && this.votedFor != this.me) {
            this.print("don't grant vote because already voted at term %d", this.currentTerm);
            return {
                voteGranted: false,
                term: this.currentTerm
            };
        }
        if (this.checkIfCandidateLogIsUptoDateAtLeastAsMyLog(args)) {
            this.print("grant vote to %d because its log is up to date at least as mine log", args.candidateId);
            this.votedFor = args.candidateId;
            this.currentTerm = args.term;
            return {
                term: this.currentTerm,
                voteGranted: true
            };
        }
        this.print("don't grant vote to %d because candidate's log is stale", args.candidateId);
        this.ensureRequestTerm(args.term);
        return {
            term: this.currentTerm,
            voteGranted: false,
        };
    };
    Raft.prototype.requestVoteAndWritePersistentState = function (args) {
        if (!this.started) {
            return {
                voteGranted: false,
                term: 0,
            };
        }
        var reply = this.requestVote(args);
        this.writePersistentState("after requestVote");
        return reply;
    };
    Raft.prototype.invokeRequestVoteAndWritePersistentState = function (args) {
        return this.invokeRPCMethod('invokeRequestVoteAndWritePersistentStateLocal', args);
    };
    Raft.prototype.invokeRequestVoteAndWritePersistentStateLocal = function (args, resultHandler) {
        var reply = this.requestVoteAndWritePersistentState(args);
        resultHandler(reply);
    };
    Raft.prototype.checkIfCandidateLogIsUptoDateAtLeastAsMyLog = function (args) {
        var myLastLogIndex = this.lastIndex();
        var myLastLogTerm = this.startTerm;
        if (myLastLogIndex >= this.startIndex) {
            myLastLogTerm = this.item(myLastLogIndex).term;
        }
        if (myLastLogTerm == args.lastLogTerm) {
            return args.lastLogIndex >= myLastLogIndex;
        }
        return args.lastLogTerm >= myLastLogTerm;
    };
    Raft.prototype.startCommand = function (command) {
        var _this = this;
        var index = -1;
        var term = this.currentTerm;
        var isLeader = this.isLeader();
        if (isLeader) {
            // If command received from client: append entry to local log,
            // respond after entry applied to state machine (§5.3)
            index = this.appendLogEntry(command);
            this.writePersistentState("after new command added into log");
            this.print("got command %s, would appear at index %d", JSON.stringify(command), index);
            setImmediate(function () { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                return [2 /*return*/, this.startAgreement(index)];
            }); }); });
        }
        return { index: index, term: term, isLeader: isLeader };
    };
    Raft.prototype.appendLogEntry = function (command) {
        var entry = {
            term: this.currentTerm,
            command: command,
        };
        this.log.push(entry);
        this.print("leader appended a new entry %s %s", JSON.stringify(entry), JSON.stringify(this.log));
        return this.lastIndex();
    };
    Raft.prototype.startAgreement = function (index) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            var alreadyCommitted, minPeers, donePeers, agreementEmitter, _loop_3, this_3, server;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.waitForPreviousAgreement(index - 1)];
                    case 1:
                        alreadyCommitted = _a.sent();
                        if (alreadyCommitted) {
                            this.print("entry %d already committed", index);
                            return [2 /*return*/];
                        }
                        if (!this.isLeader()) {
                            this.print("not leader anymore cancel agreement on entry %d", index);
                            return [2 /*return*/];
                        }
                        this.print("starts agreement on entry %d, nextIndex %s, matchIndex %s", index, JSON.stringify(this.nextIndex), JSON.stringify(this.matchIndex));
                        minPeers = Math.floor(this.peers.length / 2);
                        donePeers = 0;
                        agreementEmitter = new events_1.EventEmitter();
                        agreementEmitter.on('done', function () {
                            donePeers++;
                            if (donePeers == minPeers) {
                                _this.print("agreement for entry [%d]=%s reached", index, JSON.stringify(_this.item(index)));
                                if (_this.commitIndex >= index) {
                                    _this.print("already committed %d inside checkIfCommitted", index);
                                    return;
                                }
                                _this.commitIndex = index;
                                var applyMsg = {
                                    commandValid: true,
                                    commandIndex: index + 1,
                                    command: _this.item(index).command,
                                };
                                _this.applyCommand(applyMsg);
                                _this.print("leader applied  after agreement %s", JSON.stringify(applyMsg));
                                _this.lastApplied = index;
                            }
                        });
                        _loop_3 = function (server) {
                            if (server == this_3.me) {
                                return "continue";
                            }
                            setImmediate(function () { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                                return [2 /*return*/, this.startAgreementForServer(server, index, agreementEmitter)];
                            }); }); });
                        };
                        this_3 = this;
                        for (server = 0; server < this.peers.length; server++) {
                            _loop_3(server);
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    Raft.prototype.startAgreementForServer = function (server, index, agreementEmitter) {
        return __awaiter(this, void 0, void 0, function () {
            var matchIndex, nextIndex, currentTerm, isLeader, _a, ok, success;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        matchIndex = this.matchIndex[server];
                        nextIndex = this.nextIndex[server];
                        this.print("starts agreement for entry [%d]=%s for server %d at term %d, nextIndex = %d, matchIndex = %d", index, JSON.stringify(this.item(index)), server, this.currentTerm, nextIndex, matchIndex);
                        currentTerm = this.currentTerm;
                        isLeader = this.isLeader();
                        if (!isLeader) {
                            this.print("cancel agreement for entry [%d]=%s for server %d at term %d, nextIndex = %d, matchIndex = %d, because not leader anymore", index, JSON.stringify(this.item(index)), server, this.currentTerm, nextIndex, matchIndex);
                            return [2 /*return*/];
                        }
                        return [4 /*yield*/, this.callAppendEntries(server, currentTerm, 'appendentries')];
                    case 1:
                        _a = _b.sent(), ok = _a.ok, success = _a.success;
                        if (!ok) {
                            if (index >= this.len()) {
                                this.print("agreement for entry [%d]=%s for server %d at term %d - not ok", index, "(removed)", server, this.currentTerm);
                            }
                            else {
                                this.print("agreement for entry [%d]=%s for server %d at term %d - not ok", index, JSON.stringify(this.item(index)), server, this.currentTerm);
                            }
                        }
                        else {
                            if (success) {
                                this.print("agreement for entry [%d]=%s for server %d at term %d - ok", index, JSON.stringify(this.item(index)), server, this.currentTerm);
                                agreementEmitter.emit('done');
                            }
                            else {
                                this.print("agreement for entry %d for server %d - failed", index, server);
                            }
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    Raft.prototype.waitForPreviousAgreement = function (index) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                if (index < 0) {
                    this.print("don't need to wait for agreement because no entries yet committed");
                    return [2 /*return*/, false];
                }
                return [2 /*return*/, new Promise(function (resolve, reject) { return _this.checkPreviousAgreement(index, resolve); })];
            });
        });
    };
    Raft.prototype.checkPreviousAgreement = function (index, resolve) {
        var _this = this;
        var lastCommitted = this.commitIndex;
        if (!this.isLeader()) {
            resolve(false);
            return;
        }
        if (index < lastCommitted) {
            resolve(true);
        }
        else if (index == lastCommitted) {
            this.print("entry %d is committed, ready to start agreement on next entry", index);
            resolve(false);
        }
        else {
            this.print("wait because previous entry %d is not committed yet, commitIndex %d", index, lastCommitted);
            setTimeout(function () { return _this.checkPreviousAgreement(index, resolve); }, 10);
        }
    };
    Raft.prototype.applyCommandToFollower = function (applyMsg) {
        this.print("applyToFollower " + JSON.stringify(applyMsg));
        var entry = applyMsg.command;
        if (raft_commands_1.isSessionSyncCommand(entry)) {
            var sessionData = entry.payload;
            sessionStore.set(sessionData.sid, sessionData.session, function () { });
        }
        else if (raft_commands_1.isStorageSyncCommand(entry)) {
            var clusterManager = process.clusterManager;
            if (raft_commands_1.isStorageActionSetAll(entry.payload)) {
                clusterManager.setStorageAll(entry.payload.data.pluginId, entry.payload.data.dict);
            }
            else if (raft_commands_1.isStorageActionSet(entry.payload)) {
                clusterManager.setStorageByKey(entry.payload.data.pluginId, entry.payload.data.key, entry.payload.data.value);
            }
            else if (raft_commands_1.isStorageActionDeleteAll(entry.payload)) {
                clusterManager.setStorageAll(entry.payload.data.pluginId, {});
            }
            else if (raft_commands_1.isStorageActionDelete(entry.payload)) {
                clusterManager.deleteStorageByKey(entry.payload.data.pluginId, entry.payload.data.key);
            }
        }
        else if (raft_commands_1.isSnapshotSyncCommand(entry)) {
            this.restoreStateFromSnapshot(entry.payload);
        }
    };
    Raft.prototype.writePersistentState = function (site) {
        this.print("save persistent state %s", site);
        var state = this.getState();
        this.persister.saveState(state);
    };
    Raft.prototype.getState = function () {
        var data = JSON.stringify({
            currentTerm: this.currentTerm,
            votedFor: this.votedFor,
            log: this.log,
            startIndex: this.startIndex,
            startTerm: this.startTerm,
        });
        return data;
    };
    Raft.prototype.readPersistentState = function (data) {
        if (!data || data.length < 1) {
            return;
        }
        this.print("read persistent state");
        try {
            var _a = JSON.parse(data), votedFor = _a.votedFor, currentTerm = _a.currentTerm, log = _a.log, startIndex = _a.startIndex, startTerm = _a.startTerm;
            this.currentTerm = currentTerm;
            this.votedFor = votedFor;
            this.log = log;
            this.startIndex = startIndex;
            this.startTerm = startTerm;
            this.print("state: term %d, votedFor %d, log %s", this.currentTerm, this.votedFor, JSON.stringify(this.log));
        }
        catch (e) {
            this.print("unable to decode state: %s", JSON.stringify(e));
        }
    };
    Raft.prototype.readSnapshot = function (data) {
        if (!data || data.length < 1) {
            return;
        }
        this.print("read snapshot");
        try {
            var snapshot = JSON.parse(data);
            this.restoreStateFromSnapshot(snapshot);
        }
        catch (e) {
            this.print("unable to decode snapshot: %s", JSON.stringify(e));
        }
    };
    Raft.prototype.discardLogIfLeader = function (snapshot) {
        var _this = this;
        if (!this.isLeader()) {
            this.print("unable to discard log because not leader");
            return;
        }
        this.print("discardLogIfLeader");
        this.discardLog(snapshot);
        var term = this.currentTerm;
        var _loop_4 = function (server) {
            if (server != this_4.me) {
                setImmediate(function () { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                    return [2 /*return*/, this.installSnapshotForServer(server, term, snapshot)];
                }); }); });
            }
        };
        var this_4 = this;
        for (var server = 0; server < this.peers.length; server++) {
            _loop_4(server);
        }
        this.print("discardLogIfLeader done");
    };
    Raft.prototype.installSnapshotForServer = function (server, term, snapshot) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            var _a, ok, success;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, this.callInstallSnapshot(server, term, snapshot)];
                    case 1:
                        _a = _b.sent(), ok = _a.ok, success = _a.success;
                        if (ok && success) {
                            this.print("snapshot successfully installed on server %d", server);
                            return [2 /*return*/];
                        }
                        else if (ok && !success) {
                            this.print("snapshot rejected by server %d", server);
                            return [2 /*return*/];
                        }
                        this.print("snapshot not installed on server %d, repeat after a delay", server);
                        setTimeout(function () { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                            return [2 /*return*/, this.installSnapshotForServer(server, term, snapshot)];
                        }); }); }, 10);
                        return [2 /*return*/];
                }
            });
        });
    };
    Raft.prototype.discardLog = function (snapshot) {
        this.discardCount++;
        var lastIncludedIndex = snapshot.lastIncludedIndex, lastIncludedTerm = snapshot.lastIncludedTerm;
        this.print("DiscardNonLocking %d prevStartIndex %d newStartIndex %d", this.discardCount, this.startIndex, lastIncludedIndex);
        this.print("my log %s", JSON.stringify(this.log));
        this.print("my log len %d %d", this.log.length, this.len());
        if (this.hasItemWithSameIndexAndTerm(lastIncludedIndex, lastIncludedTerm)) {
            this.print("If existing log entry has same index and term as snapshot’s last included entry, retain log entries following it and reply");
            this.log = this.log.slice(this.relativeIndex(lastIncludedIndex + 1));
            this.print("after discard my log %s", JSON.stringify(this.log));
        }
        else {
            this.print("7. Discard the entire log");
            this.log = [];
        }
        this.startIndex = lastIncludedIndex + 1;
        this.startTerm = lastIncludedTerm;
        this.print("log discarded startIndex = %d", this.startIndex);
        var state = this.getState();
        this.persister.saveStateAndSnapshot(state, JSON.stringify(snapshot));
    };
    Raft.prototype.takeIntoService = function () {
        return __awaiter(this, void 0, void 0, function () {
            var server;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        server = 0;
                        _a.label = 1;
                    case 1:
                        if (!(server < this.peers.length)) return [3 /*break*/, 6];
                        if (!(server == this.me)) return [3 /*break*/, 3];
                        return [4 /*yield*/, this.peers[server].takeIntoService()];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 3: return [4 /*yield*/, this.peers[server].takeOutOfService()];
                    case 4:
                        _a.sent();
                        _a.label = 5;
                    case 5:
                        server++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    Raft.prototype.takeOutOfService = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.peers[this.me].takeOutOfService()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    Raft.prototype.middleware = function () {
        var _this = this;
        return function (request, response, next) { return __awaiter(_this, void 0, void 0, function () {
            var state, e_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.invokeGetRaftState()];
                    case 1:
                        state = _a.sent();
                        if (state.started) {
                            if (state.raftState !== 'Leader' && !request.path.startsWith('/raft')) {
                                if (state.raftState === 'Follower') {
                                    if (typeof state.leaderBaseURL === 'string') {
                                        response.redirect("" + state.leaderBaseURL + request.path);
                                        return [2 /*return*/];
                                    }
                                    else {
                                        response.status(503).json({
                                            state: this.state,
                                            message: 'Leader is not elected yet'
                                        });
                                        return [2 /*return*/];
                                    }
                                }
                                else if (state.raftState === 'Candidate') {
                                    response.status(503).json({
                                        state: this.state,
                                    });
                                    return [2 /*return*/];
                                }
                            }
                        }
                        return [3 /*break*/, 3];
                    case 2:
                        e_2 = _a.sent();
                        raftLog.debug("unable to get raft state " + e_2.message);
                        return [3 /*break*/, 3];
                    case 3:
                        next();
                        return [2 /*return*/];
                }
            });
        }); };
    };
    Raft.prototype.getRaftStateLocal = function (resultHandler) {
        var reply = this.getRaftState();
        resultHandler(reply);
    };
    Raft.prototype.invokeGetRaftState = function () {
        return this.invokeRaftMethod('getRaftStateLocal');
    };
    Raft.prototype.getRaftState = function () {
        var leaderBaseURL;
        if (this.isStarted && this.state === 'Follower') {
            if (this.leaderId >= 0 && this.leaderId < this.peers.length) {
                var leader = this.peers[this.leaderId];
                leaderBaseURL = leader.baseAddress;
            }
        }
        return {
            started: this.started,
            raftState: this.state,
            leaderBaseURL: leaderBaseURL,
        };
    };
    Raft.prototype.item = function (index) {
        return this.log[index - this.startIndex];
    };
    Raft.prototype.hasItemWithSameIndexAndTerm = function (index, term) {
        if (index < this.startIndex || index >= this.len()) {
            return false;
        }
        return this.item(index).term === term;
    };
    Raft.prototype.len = function () {
        return this.log.length + this.startIndex;
    };
    Raft.prototype.lastIndex = function () {
        return this.len() - 1;
    };
    Raft.prototype.relativeIndex = function (index) {
        return index - this.startIndex;
    };
    Raft.prototype.createSnapshot = function (lastIncludedIndex) {
        return __awaiter(this, void 0, void 0, function () {
            var previousSnapshot, lastIncludedTerm, snapshot, index, item;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        previousSnapshot = this.lastSnapshot;
                        lastIncludedTerm = this.item(lastIncludedIndex).term;
                        snapshot = {
                            session: {},
                            storage: {},
                            lastIncludedIndex: lastIncludedIndex,
                            lastIncludedTerm: lastIncludedTerm,
                        };
                        if (previousSnapshot) {
                            snapshot = previousSnapshot;
                        }
                        index = this.startIndex;
                        _a.label = 1;
                    case 1:
                        if (!(index <= lastIncludedIndex)) return [3 /*break*/, 4];
                        item = this.item(index);
                        return [4 /*yield*/, this.applyItemToSnapshot(item, snapshot)];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        index++;
                        return [3 /*break*/, 1];
                    case 4: return [2 /*return*/, snapshot];
                }
            });
        });
    };
    Raft.prototype.applyItemToSnapshot = function (item, snapshot) {
        return __awaiter(this, void 0, void 0, function () {
            var entry, session, storage, sessionData, existingSession, _a, pluginId, key, value, pluginId, _b, pluginId, key;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        entry = item.command;
                        session = snapshot.session, storage = snapshot.storage;
                        if (!raft_commands_1.isSessionSyncCommand(entry)) return [3 /*break*/, 2];
                        sessionData = entry.payload;
                        return [4 /*yield*/, sessionStore.get(sessionData.sid)];
                    case 1:
                        existingSession = _c.sent();
                        if (typeof existingSession === 'object') {
                            session[sessionData.sid] = sessionData.session;
                        }
                        else {
                            raftLog.debug("session " + sessionData.sid + " has expired");
                        }
                        return [3 /*break*/, 3];
                    case 2:
                        if (raft_commands_1.isStorageSyncCommand(entry)) {
                            if (raft_commands_1.isStorageActionSetAll(entry.payload)) {
                                snapshot.storage[entry.payload.data.pluginId] = entry.payload.data.dict;
                            }
                            else if (raft_commands_1.isStorageActionSet(entry.payload)) {
                                _a = entry.payload.data, pluginId = _a.pluginId, key = _a.key, value = _a.value;
                                if (typeof storage[pluginId] !== 'object') {
                                    storage[pluginId] = {};
                                }
                                storage[pluginId][key] = value;
                            }
                            else if (raft_commands_1.isStorageActionDeleteAll(entry.payload)) {
                                pluginId = entry.payload.data.pluginId;
                                storage[pluginId] = {};
                            }
                            else if (raft_commands_1.isStorageActionDelete(entry.payload)) {
                                _b = entry.payload.data, pluginId = _b.pluginId, key = _b.key;
                                if (typeof storage[pluginId] === 'object') {
                                    delete storage.pluginId[key];
                                }
                            }
                        }
                        _c.label = 3;
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    Raft.prototype.restoreStateFromSnapshot = function (snapshot) {
        this.print("restore state from snapshot %s", JSON.stringify(snapshot));
        var session = snapshot.session, storage = snapshot.storage;
        for (var sid in session) {
            sessionStore.set(sid, session[sid], function () { });
        }
        var clusterManager = process.clusterManager;
        for (var _i = 0, _a = Object.keys(storage); _i < _a.length; _i++) {
            var pluginId = _a[_i];
            clusterManager.setStorageAll(pluginId, storage[pluginId]);
        }
    };
    Raft.prototype.print = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (this.debug) {
            raftLog.info.apply(raftLog, args);
        }
    };
    return Raft;
}());
exports.Raft = Raft;
exports.raft = new Raft();
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
//# sourceMappingURL=raft.js.map