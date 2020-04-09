"use strict";
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
var WebSocket = require("ws");
var zluxUtil = require('./util');
var raftLog = zluxUtil.loggers.raftLogger;
var WebSocketMessageType;
(function (WebSocketMessageType) {
    WebSocketMessageType[WebSocketMessageType["RequestVoteArgs"] = 0] = "RequestVoteArgs";
    WebSocketMessageType[WebSocketMessageType["RequestVoteReply"] = 1] = "RequestVoteReply";
    WebSocketMessageType[WebSocketMessageType["AppendEntriesArgs"] = 2] = "AppendEntriesArgs";
    WebSocketMessageType[WebSocketMessageType["AppendEntriesReply"] = 3] = "AppendEntriesReply";
})(WebSocketMessageType || (WebSocketMessageType = {}));
;
function isWebSocketRequestVoteArgsMessage(message) {
    return message.type === 'RequestVoteArgs';
}
function isWebSocketInstallSnapshotArgsMessage(message) {
    return message.type === 'InstallSnapshotArgs';
}
function isWebSocketAppendEntriesArgsMessage(message) {
    return message.type === 'AppendEntriesArgs';
}
var RaftRPCWebSocketDriver = /** @class */ (function () {
    function RaftRPCWebSocketDriver(host, port, secure) {
        this.host = host;
        this.port = port;
        this.secure = secure;
        this.isConnected = false;
        this.pendingRequests = new Map();
        this.address = this.makeWebsocketAddress();
    }
    RaftRPCWebSocketDriver.prototype.sendRequestVote = function (args) {
        return __awaiter(this, void 0, void 0, function () {
            var message;
            return __generator(this, function (_a) {
                message = {
                    seq: RaftRPCWebSocketDriver.seq++,
                    type: 'RequestVoteArgs',
                    message: args,
                };
                return [2 /*return*/, this.call(message).then(function (reply) { return reply.message; })];
            });
        });
    };
    RaftRPCWebSocketDriver.prototype.sendAppendEntries = function (args) {
        return __awaiter(this, void 0, void 0, function () {
            var message;
            return __generator(this, function (_a) {
                message = {
                    seq: RaftRPCWebSocketDriver.seq++,
                    type: 'AppendEntriesArgs',
                    message: args,
                };
                return [2 /*return*/, this.call(message).then(function (reply) { return reply.message; })];
            });
        });
    };
    RaftRPCWebSocketDriver.prototype.sendInstallSnapshot = function (args) {
        return __awaiter(this, void 0, void 0, function () {
            var message;
            return __generator(this, function (_a) {
                message = {
                    seq: RaftRPCWebSocketDriver.seq++,
                    type: 'InstallSnapshotArgs',
                    message: args,
                };
                return [2 /*return*/, this.call(message).then(function (reply) { return reply.message; })];
            });
        });
    };
    RaftRPCWebSocketDriver.prototype.makeWebsocketAddress = function () {
        return (this.secure ? 'wss' : 'ws') + "://" + this.host + ":" + this.port + "/raft";
    };
    RaftRPCWebSocketDriver.prototype.connect = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                if (this.isConnected) {
                    return [2 /*return*/, Promise.resolve()];
                }
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        _this.ws = new WebSocket(_this.address, { rejectUnauthorized: false });
                        _this.ws.on('open', function () {
                            _this.onOpen();
                            resolve();
                        });
                        _this.ws.on('error', function () { return reject(); });
                        _this.ws.on('message', function (data) { return _this.onMessage(data); });
                        _this.ws.on('close', function (code, reason) { return _this.onClose(code, reason); });
                    })];
            });
        });
    };
    RaftRPCWebSocketDriver.prototype.call = function (message) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            var promise;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.connect()];
                    case 1:
                        _a.sent();
                        promise = new Promise(function (resolve, reject) {
                            var seq = message.seq;
                            var pendingRequest = { message: message, resolve: resolve, reject: reject };
                            _this.pendingRequests.set(seq, pendingRequest);
                        });
                        raftLog.debug("send websocket message " + JSON.stringify(message) + " to " + this.address);
                        this.ws.send(JSON.stringify(message));
                        return [2 /*return*/, promise];
                }
            });
        });
    };
    RaftRPCWebSocketDriver.prototype.onOpen = function () {
        this.isConnected = true;
        raftLog.info("connection to " + this.address + " established");
    };
    RaftRPCWebSocketDriver.prototype.onMessage = function (data) {
        raftLog.debug("message " + data);
        var message;
        try {
            message = JSON.parse(data.toString());
        }
        catch (e) {
            raftLog.warn("ignore invalid message");
            return;
        }
        var seq = message.seq;
        var pendingRequest = this.pendingRequests.get(seq);
        if (!pendingRequest) {
            raftLog.warn("no request found with seq " + seq + ", ignore it");
            return;
        }
        this.pendingRequests.delete(seq);
        pendingRequest.resolve(message);
        raftLog.debug("successfully resolve pending request with seq " + seq);
    };
    RaftRPCWebSocketDriver.prototype.onClose = function (code, reason) {
        raftLog.debug("connection to " + this.address + " closed " + code + " " + reason);
        this.isConnected = false;
        this.ws = undefined;
        this.pendingRequests.forEach((function (request) {
            request.reject(new Error('connection closed'));
        }));
        this.pendingRequests.clear();
    };
    RaftRPCWebSocketDriver.prototype.onError = function (ws, err) {
        raftLog.debug("connection error " + JSON.stringify(err));
    };
    RaftRPCWebSocketDriver.seq = 1;
    return RaftRPCWebSocketDriver;
}());
exports.RaftRPCWebSocketDriver = RaftRPCWebSocketDriver;
var RaftRPCWebSocketService = /** @class */ (function () {
    function RaftRPCWebSocketService(clientWS, req, raft) {
        this.clientWS = clientWS;
        this.req = req;
        this.raft = raft;
        this.log('constructor');
        this.init();
    }
    RaftRPCWebSocketService.prototype.init = function () {
        var _this = this;
        this.log("connected client");
        // if (!this.raft.isStarted()) {
        //   this.clientWS.close();
        //   this.log('disconnect client because raft not started yet');
        //   return;
        // }
        this.clientWS.on('close', function () { return _this.onClose(); });
        this.clientWS.on('message', function (data) { return _this.onMessage(data); });
    };
    RaftRPCWebSocketService.prototype.onClose = function () {
        this.log('connection closed');
    };
    RaftRPCWebSocketService.prototype.onMessage = function (data) {
        this.log("received message " + data);
        var message;
        try {
            message = JSON.parse(data.toString());
        }
        catch (e) {
            this.log("ignore invalid message");
            return;
        }
        this.log("got message " + JSON.stringify(message));
        if (isWebSocketRequestVoteArgsMessage(message)) {
            raftLog.debug("got request vote message " + JSON.stringify(message));
            this.processRequestVoteMessage(message);
        }
        else if (isWebSocketAppendEntriesArgsMessage(message)) {
            raftLog.debug("got append entries message " + JSON.stringify(message));
            this.processAppendEntriesMessage(message);
        }
        else if (isWebSocketInstallSnapshotArgsMessage(message)) {
            raftLog.debug("got install snapshot message " + JSON.stringify(message));
            this.processInstallSnapshotMessage(message);
        }
    };
    RaftRPCWebSocketService.prototype.processAppendEntriesMessage = function (message) {
        return __awaiter(this, void 0, void 0, function () {
            var seq, args, reply, replyMessage;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        seq = message.seq;
                        args = message.message;
                        return [4 /*yield*/, this.raft.invokeAppendEntriesAndWritePersistentState(args)];
                    case 1:
                        reply = _a.sent();
                        replyMessage = {
                            type: 'AppendEntriesReply',
                            seq: seq,
                            message: reply,
                        };
                        this.clientWS.send(JSON.stringify(replyMessage));
                        return [2 /*return*/];
                }
            });
        });
    };
    RaftRPCWebSocketService.prototype.processRequestVoteMessage = function (message) {
        return __awaiter(this, void 0, void 0, function () {
            var seq, args, reply, replyMessage;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        seq = message.seq;
                        args = message.message;
                        return [4 /*yield*/, this.raft.invokeRequestVoteAndWritePersistentState(args)];
                    case 1:
                        reply = _a.sent();
                        replyMessage = {
                            type: 'RequestVoteReply',
                            seq: seq,
                            message: reply,
                        };
                        this.clientWS.send(JSON.stringify(replyMessage));
                        return [2 /*return*/];
                }
            });
        });
    };
    RaftRPCWebSocketService.prototype.processInstallSnapshotMessage = function (message) {
        return __awaiter(this, void 0, void 0, function () {
            var seq, args, reply, replyMessage;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        seq = message.seq;
                        args = message.message;
                        return [4 /*yield*/, this.raft.invokeInstallSnapshot(args)];
                    case 1:
                        reply = _a.sent();
                        replyMessage = {
                            type: 'InstallSnapshotReply',
                            seq: seq,
                            message: reply,
                        };
                        this.clientWS.send(JSON.stringify(replyMessage));
                        return [2 /*return*/];
                }
            });
        });
    };
    RaftRPCWebSocketService.prototype.log = function (msg) {
        raftLog.debug("RaftRPCWebSocketService: " + msg);
    };
    return RaftRPCWebSocketService;
}());
exports.RaftRPCWebSocketService = RaftRPCWebSocketService;
//# sourceMappingURL=raft-rpc-ws.js.map