/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

import { RaftRPCWebSocketDriver } from "./raft-rpc-ws";
import { EventEmitter } from "events";
import {
  SyncCommand,
  isSessionSyncCommand,
  isSessionsSyncCommand,
  isStorageSyncCommand,
  isStorageActionInit,
  isStorageActionSetAll,
  isStorageActionSet,
  isStorageActionDeleteAll,
  isStorageActionDelete,
  SnapshotSyncCommand,
  SessionDict,
  isSnapshotSyncCommand
} from "./raft-commands";
const sessionStore = require('./sessionStore').sessionStore;
import { EurekaInstanceConfig } from 'eureka-js-client';
import { ApimlConnector } from "./apiml";
import * as fs from 'fs';
import * as path from 'path';
import { Request, Response } from "express";
import { NextFunction } from "connect";
import { StorageDict } from "./clusterManager";
const zluxUtil = require('./util');
const raftLog = zluxUtil.loggers.raftLogger;

export class RaftPeer extends RaftRPCWebSocketDriver {
  constructor(
    host: string,
    port: number,
    secure: boolean,
    public readonly instanceId: string,
    public readonly apimlClient: ApimlConnector,
  ) {
    super(host, port, secure);
  }

  static make(masterInstance: EurekaInstanceConfig, apiml: ApimlConnector): RaftPeer {
    const host = masterInstance.hostName;
    const secure = masterInstance.securePort['@enabled'];
    const port = secure ? masterInstance.securePort.$ : masterInstance.port.$;
    const instanceId = masterInstance.instanceId;
    return new RaftPeer(host, port, secure, instanceId, apiml);
  }

  async takeOutOfService(): Promise<void> {
    return this.apimlClient.takeInstanceOutOfService(this.instanceId);
  }

  async takeIntoService(): Promise<void> {
    return this.apimlClient.takeIntoService();
  }

  get baseAddress(): string {
    return `${this.secure ? 'https' : 'https'}://${this.host}:${this.port}`;
  }
}

export interface Snapshot {
  session: SessionDict;
  storage: StorageDict;
  lastIncludedIndex: number;
  lastIncludedTerm: number;
}

export type Command = SyncCommand;
export interface ApplyMsg {
  command: Command;
  commandValid: boolean;
  commandIndex: number;
}
export interface RaftLogEntry {
  term: number;
  command: Command;
}

export interface RequestVoteArgs {
  term: number; // candidate’s term
  candidateId: number; // candidate requesting vote
  lastLogIndex: number; // index of candidate’s last log entry (§5.4)
  lastLogTerm: number; //term of candidate’s last log entry (§5.4)
}

export interface RequestVoteReply {
  term: number;  // currentTerm, for candidate to update itself
  voteGranted: boolean; // true means candidate received vote
}
export type AppendEntriesKind = 'heartbeat' | 'appendentries';
export interface AppendEntriesArgs {
  term: number;        // Leader’s term
  leaderId: number;        // so follower can redirect clients
  prevLogIndex: number;        // index of log entry immediately preceding new ones
  prevLogTerm: number;        // term of prevLogIndex entry
  entries: RaftLogEntry[]; // entries to store (empty for heartbeat; may send more than one for efficiency)
  leaderCommit: number;        // leader’s commitIndex
}

export interface AppendEntriesReply {
  term: number;  // currentTerm, for leader to update itself
  success: boolean; // true if follower contained entry matching prevLogIndex and prevLogTerm
  conflict?: Conflict;
}

export interface InstallSnapshotArgs {
  term: number
  snapshot: Snapshot;
}

export interface InstallSnapshotReply {
  success: boolean;
}

export interface Conflict {
  conflictIndex: number; // first index where conflict starts
  conflictTerm: number;
  logLength: number;
}

export interface RaftRPCDriver {
  sendRequestVote: (args: RequestVoteArgs) => Promise<RequestVoteReply>;
  sendAppendEntries: (args: AppendEntriesArgs) => Promise<AppendEntriesReply>;
  sendInstallSnapshot(args: InstallSnapshotArgs): Promise<InstallSnapshotReply>;
}

export interface Persister {
  saveState(state: string): void;
  saveStateAndSnapshot(state: string, snapshot: string): void;
  readState(): string | undefined;
  readSnapshot(): string | undefined;
}

export class FilePersister implements Persister {
  constructor(
    private stateFilename: string,
    private snapshotFilename: string,
  ) {
    raftLog.debug(`raft state file: ${stateFilename}`);
  }

  saveState(state: string): void {
    try {
      fs.writeFileSync(this.stateFilename, state, 'utf-8');
    } catch (e) {
      raftLog.warn(`unable to save raft persistent state: ${e}`, JSON.stringify(e));
    }
  }

  saveSnapshot(snapshot: string): void {
    try {
      fs.writeFileSync(this.snapshotFilename, snapshot, 'utf-8');
    } catch (e) {
      raftLog.warn(`unable to save storage snapshot: ${e}`, JSON.stringify(e));
    }
  }

  readState(): string | undefined {
    try {
      const buffer = fs.readFileSync(this.stateFilename);
      console.log(`state is ${JSON.stringify(buffer.toString())}`);
      return buffer.toString();
    } catch (e) {
      raftLog.warn(`unable to read raft persistent state: ${e}`, JSON.stringify(e));
    }
  }

  readSnapshot(): string | undefined {
    try {
      const buffer = fs.readFileSync(this.snapshotFilename);
      console.log(`snapshot is ${JSON.stringify(buffer.toString())}`);
      return buffer.toString();
    } catch (e) {
      raftLog.warn(`unable to read raft persistent state: ${e}`, JSON.stringify(e));
    }
  }

  saveStateAndSnapshot(state: string, snapshot: string): void {
    this.saveState(state);
    this.saveSnapshot(snapshot);
  }


}

export class DummyPersister implements Persister {
  constructor() { }

  saveState(state: string): void {
  }

  readSnapshot(): string | undefined {
    return;
  }

  readState(): string | undefined {
    return;
  }

  saveStateAndSnapshot(state: string, snapshot: string): void {

  }

}

export type State = 'Leader' | 'Follower' | 'Candidate';

const minElectionTimeout = 1000;
const maxElectionTimeout = 2000;

export class Raft {
  public readonly stateEmitter = new EventEmitter();
  private peers: RaftPeer[]; // RPC end points of all peers
  private me: number;  // this peer's index into peers[]
  private state: State = 'Follower';
  private readonly electionTimeout = Math.floor(Math.random() * (maxElectionTimeout - minElectionTimeout) + minElectionTimeout);
  private debug = true;
  private started = false;

  // persistent state
  private currentTerm: number = 0;
  private votedFor = -1
  private log: RaftLogEntry[] = [];
  private startIndex: number = 0;
  private startTerm: number = -1;

  // volatile state on all servers
  private commitIndex: number = -1;
  private lastApplied: number = -1;

  // volatile state on leaders(Reinitialized after election):
  private nextIndex: number[] = [];  //  for each server, index of the next log entry to send to that server (initialized to leader last log index + 1)
  private matchIndex: number[] = []; // for each server, index of highest log entry known to be replicated on server (initialized to 0, increases monotonically)
  private electionTimeoutId: NodeJS.Timer;
  private readonly heartbeatInterval: number = Math.round(minElectionTimeout * .75);
  private heartbeatTimeoutId: NodeJS.Timer;
  private leaderId: number = -1; // last observed leader id
  private discardCount: number = 0;
  private lastSnapshot: Snapshot;

  constructor(
    private persister: Persister,
    private maxLogSize: number
  ) {
  }

  start(peers: RaftPeer[], me: number): void {
    raftLog.info(`starting peer ${me} electionTimeout ${this.electionTimeout} ms heartbeatInterval ${this.heartbeatInterval} ms`);
    this.peers = peers;
    this.me = me;
    this.readSnapshot(this.persister.readSnapshot());
    this.readPersistentState(this.persister.readState());
    this.scheduleElectionOnTimeout();
    this.started = true;
    this.addOnReRegisterHandler();
    this.print(`peer ${me} started ${this.started} log: ${JSON.stringify(this.log)}`);
  }

  // This is a temporary protection against "eureka heartbeat FAILED, Re-registering app" issue
  private addOnReRegisterHandler(): void {
    const peer = this.peers[this.me];
    peer.apimlClient.onReRegister(() => {
      if (!this.isLeader()) {
        peer.takeOutOfService().then(() => this.print('force taken out of service because of re-registration in Eureka'));
      }
    })
  }

  isStarted(): boolean {
    return this.started;
  }

  getPeers(): RaftPeer[] {
    return this.peers;
  }

  private scheduleElectionOnTimeout(): void {
    if (this.isLeader()) {
      return;
    }
    this.electionTimeoutId = setTimeout(() => {
      if (this.isLeader()) {
        // this.scheduleElectionOnTimeout();
      } else {
        this.attemptElection();
      }
    }, this.electionTimeout);
  }


  isLeader(): boolean {
    return this.state === 'Leader';
  }

  attemptElection(): void {
    if (this.state !== 'Candidate') {
      this.state = 'Candidate';
      this.emitState();
    }
    this.currentTerm++;
    this.votedFor = this.me;
    let votes = 1;
    let done = false;
    const term = this.currentTerm;
    const peerCount = this.peers.length;
    this.print("attempting election at term %d", this.currentTerm)

    for (let server = 0; server < peerCount; server++) {
      if (server === this.me) {
        continue;
      }
      setImmediate(async () => {
        const peerAddress = this.peers[server].address;
        const voteGranted = await this.callRequestVote(server, term);
        if (!voteGranted) {
          this.print("vote by peer %s not granted", peerAddress);
          return;
        }
        votes++;
        if (done) {
          this.print("got vote from peer %s but election already finished", peerAddress);
          return;
        } else if (this.state == 'Follower') {
          this.print("got heartbeat, stop election")
          done = true;
          return;
        } else if (votes <= Math.floor(peerCount / 2)) {
          this.print("got vote from %s but not enough votes yet to become Leader", peerAddress);
          return;
        }
        if (this.state === 'Candidate') {
          this.print("got final vote from %s and became Leader of term %d", peerAddress, term);
          done = true;
          this.convertToLeader();
        }
      });
    }
    this.scheduleElectionOnTimeout();
  }

  convertToLeader(): void {
    this.state = 'Leader';
    // When a leader first comes to power, it initializes all nextIndex values to the index just after the last one in its log (11 in Figure 7)
    const logLen = this.len();
    for (let i = 0; i < this.peers.length; i++) {
      this.nextIndex[i] = logLen;
      this.matchIndex[i] = -1;
    }
    this.print("nextIndex %s", JSON.stringify(this.nextIndex));
    this.print("matchIndex %s", JSON.stringify(this.matchIndex));
    setImmediate(() => this.emitState());
    this.sendHeartbeat();
  }

  private emitState(): void {
    this.stateEmitter.emit('state', this.state);
  }

  sendHeartbeat(): void {
    const peerCount = this.peers.length;

    for (let server = 0; server < peerCount; server++) {
      if (server == this.me) {
        continue;
      }
      setImmediate(async () => {
        if (!this.isLeader()) {
          this.print("cancel heartbeat to %d at term %d because not leader anymore", server, this.currentTerm);
          return;
        }
        this.print("sends heartbeat to %d at term %d", server, this.currentTerm);
        const { ok, success, conflict } = await this.callAppendEntries(server, this.currentTerm, 'heartbeat');
        if (ok && !success) {
          if (this.isLeader() && conflict) {
            this.print("got unsuccessful heartbeat response from %d, adjust nextIndex because of conflict %s",
              server, JSON.stringify(conflict));
            this.adjustNextIndexForServer(server, conflict);
          }
        } else if (ok && success) {
          this.print("got successful heartbeat response from %d at term %d, nextIndex = %d, matchIndex = %d, commitIndex = %d",
            server, this.currentTerm, this.nextIndex[server], this.matchIndex[server], this.commitIndex)
          this.checkIfCommitted();
        }
      });
    }
    if (!this.isLeader()) {
      this.print("stop heartbeat because not leader anymore");
      return;
    }
    this.heartbeatTimeoutId = setTimeout(() => this.sendHeartbeat(), this.heartbeatInterval)
  }

  private adjustNextIndexForServer(server: number, conflict: Conflict) {
    if (conflict.conflictIndex === -1 && conflict.conflictTerm === -1) {
      if (conflict.logLength === 0 && this.lastSnapshot) {
        this.print("follower's log is empty(have it re-started?) and there is a snapshot, send the snapshot to the follower");
        setImmediate(() => this.installSnapshotForServer(server, this.currentTerm, this.lastSnapshot));
      } else {
        this.nextIndex[server] = conflict.logLength;
        this.print("set nextIndex for server %d = %d because there are missing entries in follower's log", server, this.nextIndex[server]);
      }
    } else if (conflict.conflictIndex !== -1) {
      this.nextIndex[server] = conflict.conflictIndex;
      this.print("set nextIndex for server %d = %d because conflictIndex given", server, this.nextIndex[server]);
    } else {
      if (this.nextIndex[server] > this.startIndex) {
        this.nextIndex[server]--;
        this.print("decrease nextIndex for server %d to %d", server, this.nextIndex[server])
      }
    }
  }

  checkIfCommitted(): void {
    const minPeers = Math.floor(this.peers.length / 2);
    const m = new Map<number, number>();
    for (let mi = 0; mi < this.matchIndex.length; mi++) {
      const matchIndex = this.matchIndex[mi];
      if (matchIndex > this.commitIndex) {
        if (m.has(matchIndex)) {
          m[matchIndex]++;
        } else {
          m[matchIndex] = 1;
        }
      }
    }
    m.forEach((count, matchIndex) => {
      if (matchIndex > this.commitIndex && count >= minPeers) {
        for (let i = this.commitIndex + 1; i <= matchIndex && i < this.len(); i++) {
          this.commitIndex = i;
          this.print("leader about to apply %d %s", this.commitIndex, JSON.stringify(this.item(this.commitIndex)));
          const applyMsg: ApplyMsg = {
            commandValid: true,
            commandIndex: this.commitIndex + 1,
            command: this.item(this.commitIndex).command,
          }
          this.applyCommand(applyMsg);
          this.lastApplied = this.commitIndex;
        }
        this.print("checkIfCommitted: adjust commitIndex to %d", matchIndex);
      }
    });
  }

  async callAppendEntries(server: number, currentTerm: number, kind: AppendEntriesKind): Promise<{ ok: boolean, success: boolean, conflict?: Conflict }> {
    const entries: RaftLogEntry[] = [];
    let last = this.len();
    if (kind == "appendentries") {
      last = this.commitIndex + 1;
    } else {
      last = last - 1;
    }
    let start = this.nextIndex[server];
    if (start < this.startIndex) {
      start = this.startIndex;
    }
    for (let ni = start; ni <= last && ni < this.len(); ni++) {
      entries.push(this.item(ni));
    }
    let prevLogIndex = this.nextIndex[server] - 1;
    let prevLogTerm = -1;
    if (prevLogIndex >= this.startIndex && prevLogIndex < this.len()) {
      prevLogTerm = this.item(prevLogIndex).term;
    }
    this.print("CallAppendEntries %s for follower %d entries %s, my log %s",
      kind, server, JSON.stringify(entries), JSON.stringify(this.log));
    const args: AppendEntriesArgs = {
      leaderId: this.me,
      term: this.currentTerm,
      entries: entries,
      leaderCommit: this.commitIndex,
      prevLogIndex: prevLogIndex,
      prevLogTerm: prevLogTerm,
    };
    const peer = this.peers[server];
    return peer.sendAppendEntries(args)
      .then(reply => {
        this.ensureResponseTerm(reply.term);
        if (reply.success && entries.length > 0) {
          this.nextIndex[server] = last + 1;
          this.matchIndex[server] = last;
        }
        this.print("successfully appended entries to server %d nextIndex %s matchIndex %s",
          server, JSON.stringify(this.nextIndex), JSON.stringify(this.matchIndex));
        return { ok: true, success: reply.success, conflict: reply.conflict };
      })
      .catch(() => ({ ok: false, success: false }));
  }

  async callRequestVote(server: number, term: number): Promise<boolean> {
    const peer = this.peers[server];
    let lastLogTerm = this.startTerm;
    const lastLogIndex = this.lastIndex();
    if (lastLogIndex >= this.startIndex) {
      lastLogTerm = this.item(lastLogIndex).term;
    }
    const requestVoteArgs: RequestVoteArgs = {
      candidateId: this.me,
      term: term,
      lastLogIndex: lastLogIndex,
      lastLogTerm: lastLogTerm,
    }
    this.print("CallRequestVote: my log %s", JSON.stringify(this.log));
    return peer.sendRequestVote(requestVoteArgs)
      .then(reply => {
        this.ensureResponseTerm(reply.term);
        return reply.voteGranted;
      })
      .catch(() => false);
  }

  private ensureResponseTerm(responseTerm: number) {
    if (responseTerm > this.currentTerm) {
      this.print(`If RPC response contains term(%d) > currentTerm(%d): set currentTerm = T, convert to follower (§5.1)`, responseTerm, this.currentTerm);
      this.currentTerm = responseTerm;
      this.convertToFollower();
    }
  }

  installSnapshot(args: InstallSnapshotArgs): InstallSnapshotReply {
    if (!this.started) {
      return {
        success: false,
      };
    }
    this.print("got InstallSnapshot request term %d, LastIncludedIndex %d, LastIncludedTerm %d",
      args.term, args.snapshot.lastIncludedIndex, args.snapshot.lastIncludedTerm);
    if (args.term < this.currentTerm) {
      this.print("Reply false immediately if term(%d) < currentTerm", args.term);
      return {
        success: false
      }
    }
    this.currentTerm = args.term;
    this.cancelCurrentElectionTimeoutAndReschedule();
    const applyMsg: ApplyMsg = {
      command: <SnapshotSyncCommand>{
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
  }

  private async callInstallSnapshot(server: number, term: number, snapshot: Snapshot): Promise<{ ok: boolean, success: boolean }> {
    const args: InstallSnapshotArgs = {
      term: term,
      snapshot: snapshot,
    };
    this.print("callInstallSnapshot for server %d with args %s", server, JSON.stringify(args));
    try {
      const reply = await this.peers[server].sendInstallSnapshot(args);
      return ({
        ok: true,
        success: reply.success,
      });
    } catch (e) {
      return ({ ok: false, success: false });
    }
  }

  appendEntries(args: AppendEntriesArgs): AppendEntriesReply {
    let requestType = "heartbeat";
    if (args.entries.length > 0) {
      requestType = "appendentries";
    }
    this.ensureRequestTerm(args.term);
    this.print("got %s request from leader %d at term %d, my term %d, prevLogIndex %d, entries %s",
      requestType, args.leaderId, args.term, this.currentTerm, args.prevLogIndex, JSON.stringify(args.entries));
    if (!this.started) {
      this.print("not started yet!, reply false");
      return {
        term: this.currentTerm,
        success: false,
      };
    }
    this.print("my log is %s", JSON.stringify(this.log))
    // 1. Reply false if term < currentTerm (§5.1)
    if (args.term < this.currentTerm) {
      this.print("1. Reply false if term < currentTerm (§5.1)")
      return {
        success: false,
        term: this.currentTerm,
      }
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
        }
      }
      // 3. If an existing entry conflicts with a new one (same index but different terms), delete the existing entry and all that follow it (§5.3)
      const prevLogTerm = this.item(args.prevLogIndex).term;
      if (prevLogTerm != args.prevLogTerm) {
        this.print("3. If an existing entry conflicts with a new one (same index but different terms), delete the existing entry and all that follow it (§5.3)");
        this.print("commit index %d, remove entries %s", this.commitIndex, JSON.stringify(this.log.slice(this.relativeIndex(args.prevLogIndex))));
        this.log = this.log.slice(0, this.relativeIndex(args.prevLogIndex));
        this.print("remaining entries %s", JSON.stringify(this.log));
        const conflict: Conflict = {
          conflictTerm: prevLogTerm,
          conflictIndex: this.findFirstEntryWithTerm(prevLogTerm),
          logLength: this.len(),
        };
        this.print("reply false, conflict %s", conflict);
        return {
          success: false,
          term: this.currentTerm,
          conflict: conflict,
        }
      }
    }
    this.print("leader commit %d my commit %d", args.leaderCommit, this.commitIndex);
    if (args.entries.length > 0) {
      // 4. Append any new entries not already in the log
      const lastLogIndex = this.lastIndex();
      if (args.prevLogIndex < lastLogIndex) {
        let trimIndex = args.prevLogIndex + 1;
        if (trimIndex < this.startIndex) {
          trimIndex = this.startIndex;
        }
        this.log = this.log.slice(0, this.relativeIndex(trimIndex));
        if (args.prevLogIndex >= this.startIndex) {
          this.print("truncate log, last log entry is [%d]=%s", lastLogIndex, JSON.stringify(this.item(lastLogIndex)));
        } else {
          this.print("truncate log: make long empty");
        }
      }
      this.print("4. Append any new entries not already in the log at index %d: %s", this.len(), JSON.stringify(args.entries));
      this.log = this.log.concat(args.entries);
    }
    // 5. If leaderCommit > commitIndex, set commitIndex = min(leaderCommit, index of last new entry)
    const lastNewEntryIndex = this.lastIndex();
    if (args.leaderCommit > this.commitIndex) {
      this.print("5. If leaderCommit(%d) > commitIndex(%d), set commitIndex = min(leaderCommit, index of last new entry) = %d",
        args.leaderCommit, this.commitIndex, Math.min(args.leaderCommit, lastNewEntryIndex));
      this.commitIndex = Math.min(args.leaderCommit, lastNewEntryIndex);
    }

    for (; this.lastApplied <= this.commitIndex; this.lastApplied++) {
      if (this.lastApplied < this.startIndex) {
        continue;
      }
      const applyMsg: ApplyMsg = {
        commandValid: true,
        commandIndex: this.lastApplied + 1,
        command: this.item(this.lastApplied).command,
      }
      this.applyCommand(applyMsg);
    }
    this.print("%s reply with success = true", requestType)
    return {
      success: true,
      term: args.term,
    };
  }

  private findFirstEntryWithTerm(term: number): number {
    let index = -1;
    for (let i = this.lastIndex(); i >= this.startIndex; i--) {
      const xterm = this.item(i).term;
      if (xterm === term) {
        index = i;
      } else if (xterm < term) {
        break;
      }
    }
    return index;
  }

  appendEntriesAndWritePersistentState(args: AppendEntriesArgs): AppendEntriesReply {
    if (!this.started) {
      return {
        success: false,
        term: 0,
      };
    }
    const reply = this.appendEntries(args);
    this.writePersistentState("after appendEntries");
    return reply;
  }

  applyCommand(applyMsg: ApplyMsg): void {
    if (!this.isLeader()) {
      this.applyCommandToFollower(applyMsg);
    } else {
      if (this.log.length > this.maxLogSize) {
        this.print("raft log size(%d) exceeds max log size(%d)", this.log.length, this.maxLogSize);
        setImmediate(() => {
          const snapshot = this.createSnapshot(this.lastApplied);
          this.discardLogIfLeader(snapshot);
          this.lastSnapshot = snapshot;
        });
      }
    }
    this.print("applied %s", JSON.stringify(applyMsg));
  }

  private ensureRequestTerm(requestTerm: number) {
    if (requestTerm > this.currentTerm) {
      this.print("If RPC request contains term(%d) > currentTerm(%d): set currentTerm = T, convert to follower (§5.1)", requestTerm, this.currentTerm);
      this.currentTerm = requestTerm;
      this.convertToFollower();
    }
  }

  convertToFollower(): void {
    if (this.state != 'Follower') {
      this.print('convert to Follower');
      this.state = 'Follower';
      this.cancelCurrentElectionTimeoutAndReschedule();
      this.cancelHeartbeat();
      this.emitState();
    }
  }

  cancelHeartbeat(): void {
    if (this.heartbeatTimeoutId) {
      clearTimeout(this.heartbeatTimeoutId);
      this.heartbeatTimeoutId = undefined;
    }
  }

  cancelCurrentElectionTimeoutAndReschedule(): void {
    clearTimeout(this.electionTimeoutId);
    this.scheduleElectionOnTimeout();
  }

  requestVote(args: RequestVoteArgs): RequestVoteReply {
    this.print("got vote request from %d at term %d, lastLogIndex %d, my term is %d, my commit index %d",
      args.candidateId, args.term, args.lastLogIndex, this.currentTerm, this.commitIndex);
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
    this.print("don't grant vote to %d because candidate's log is stale", args.candidateId)
    this.ensureRequestTerm(args.term)
    return {
      term: this.currentTerm,
      voteGranted: false,
    };
  }

  requestVoteAndWritePersistentState(args: RequestVoteArgs): RequestVoteReply {
    if (!this.started) {
      return {
        voteGranted: false,
        term: 0,
      };
    }
    const reply = this.requestVote(args);
    this.writePersistentState("after requestVote");
    return reply;
  }

  private checkIfCandidateLogIsUptoDateAtLeastAsMyLog(args: RequestVoteArgs): boolean {
    const myLastLogIndex = this.lastIndex();
    let myLastLogTerm = this.startTerm;
    if (myLastLogIndex >= this.startIndex) {
      myLastLogTerm = this.item(myLastLogIndex).term;
    }
    if (myLastLogTerm == args.lastLogTerm) {
      return args.lastLogIndex >= myLastLogIndex;
    }
    return args.lastLogTerm >= myLastLogTerm
  }

  startCommand(command: Command): { index: number, term: number, isLeader: boolean } {
    let index = -1;
    const term = this.currentTerm;
    const isLeader = this.isLeader();
    if (isLeader) {
      // If command received from client: append entry to local log,
      // respond after entry applied to state machine (§5.3)
      index = this.appendLogEntry(command);
      this.writePersistentState("after new command added into log");
      this.print("got command %s, would appear at index %d", JSON.stringify(command), index);
      setImmediate(async () => this.startAgreement(index));
    }
    return { index, term, isLeader };
  }

  private appendLogEntry(command: Command): number {
    const entry: RaftLogEntry = {
      term: this.currentTerm,
      command: command,
    }
    this.log.push(entry);
    this.print("leader appended a new entry %s %s", JSON.stringify(entry), JSON.stringify(this.log));
    return this.lastIndex();
  }

  private async startAgreement(index: number): Promise<void> {
    const alreadyCommitted = await this.waitForPreviousAgreement(index - 1);
    if (alreadyCommitted) {
      this.print("entry %d already committed", index);
      return;
    }
    if (!this.isLeader()) {
      this.print("not leader anymore cancel agreement on entry %d", index);
      return;
    }
    this.print("starts agreement on entry %d, nextIndex %s, matchIndex %s", index, JSON.stringify(this.nextIndex), JSON.stringify(this.matchIndex));
    const minPeers = Math.floor(this.peers.length / 2);
    let donePeers = 0;
    const agreementEmitter = new EventEmitter();
    agreementEmitter.on('done', () => {
      donePeers++;
      if (donePeers == minPeers) {
        this.print("agreement for entry [%d]=%s reached", index, JSON.stringify(this.item(index)));
        if (this.commitIndex >= index) {
          this.print("already committed %d inside checkIfCommitted", index);
          return;
        }
        this.commitIndex = index;
        const applyMsg: ApplyMsg = {
          commandValid: true,
          commandIndex: index + 1,
          command: this.item(index).command,
        };
        this.applyCommand(applyMsg);
        this.print("leader applied  after agreement %s", JSON.stringify(applyMsg));
        this.lastApplied = index
      }
    });
    for (let server = 0; server < this.peers.length; server++) {
      if (server == this.me) {
        continue;
      }
      setImmediate(async () => this.startAgreementForServer(server, index, agreementEmitter));
    }
  }

  private async startAgreementForServer(server: number, index: number, agreementEmitter: EventEmitter): Promise<void> {
    const matchIndex = this.matchIndex[server];
    const nextIndex = this.nextIndex[server];
    this.print("starts agreement for entry [%d]=%s for server %d at term %d, nextIndex = %d, matchIndex = %d",
      index, JSON.stringify(this.item(index)), server, this.currentTerm, nextIndex, matchIndex)
    const currentTerm = this.currentTerm;
    const isLeader = this.isLeader();
    if (!isLeader) {
      this.print("cancel agreement for entry [%d]=%s for server %d at term %d, nextIndex = %d, matchIndex = %d, because not leader anymore",
        index, JSON.stringify(this.item(index)), server, this.currentTerm, nextIndex, matchIndex)
      return;
    }
    const { ok, success } = await this.callAppendEntries(server, currentTerm, 'appendentries');
    if (!ok) {
      if (index >= this.len()) {
        this.print("agreement for entry [%d]=%s for server %d at term %d - not ok", index, "(removed)", server, this.currentTerm)
      } else {
        this.print("agreement for entry [%d]=%s for server %d at term %d - not ok", index, JSON.stringify(this.item(index)), server, this.currentTerm)
      }
    } else {
      if (success) {
        this.print("agreement for entry [%d]=%s for server %d at term %d - ok", index, JSON.stringify(this.item(index)), server, this.currentTerm)
        agreementEmitter.emit('done');
      } else {
        this.print("agreement for entry %d for server %d - failed", index, server)
      }
    }
  }

  private async waitForPreviousAgreement(index: number): Promise<boolean> {
    if (index < 0) {
      this.print("don't need to wait for agreement because no entries yet committed")
      return false;
    }
    return new Promise<boolean>((resolve, reject) => this.checkPreviousAgreement(index, resolve));
  }

  private checkPreviousAgreement(index: number, resolve: (alreadyAgreed: boolean) => void): void {
    const lastCommitted = this.commitIndex;
    if (!this.isLeader()) {
      resolve(false);
      return;
    }
    if (index < lastCommitted) {
      resolve(true);
    } else if (index == lastCommitted) {
      this.print("entry %d is committed, ready to start agreement on next entry", index)
      resolve(false);
    } else {
      this.print("wait because previous entry %d is not committed yet, commitIndex %d", index, lastCommitted);
      setTimeout(() => this.checkPreviousAgreement(index, resolve), 10);
    }
  }

  private applyCommandToFollower(applyMsg: ApplyMsg): void {
    this.print(`applyToFollower ${JSON.stringify(applyMsg)}`);
    const entry: SyncCommand = applyMsg.command;
    if (isSessionSyncCommand(entry)) {
      const sessionData = entry.payload;
      sessionStore.set(sessionData.sid, sessionData.session, () => { });
    } else if (isSessionsSyncCommand(entry)) {
      for (const sessionData of entry.payload) {
        sessionStore.set(sessionData.sid, sessionData.session, () => { });
      }
    } else if (isStorageSyncCommand(entry)) {
      const clusterManager = process.clusterManager;
      if (isStorageActionInit(entry.payload)) {
        for (const pluginId of Object.keys(entry.payload.data)) {
          clusterManager.setStorageAll(pluginId, entry.payload[pluginId])
        }
      } else if (isStorageActionSetAll(entry.payload)) {
        clusterManager.setStorageAll(entry.payload.data.pluginId, entry.payload.data.dict);
      } else if (isStorageActionSet(entry.payload)) {
        clusterManager.setStorageByKey(entry.payload.data.pluginId, entry.payload.data.key, entry.payload.data.value);
      } else if (isStorageActionDeleteAll(entry.payload)) {
        clusterManager.setStorageAll(entry.payload.data.pluginId, {});
      } else if (isStorageActionDelete(entry.payload)) {
        clusterManager.deleteStorageByKey(entry.payload.data.pluginId, entry.payload.data.key);
      }
    } else if (isSnapshotSyncCommand(entry)) {
      this.restoreStateFromSnapshot(entry.payload);
    }
  }

  private writePersistentState(site: string): void {
    this.print("save persistent state %s", site)
    const state = this.getState()
    this.persister.saveState(state);
  }

  private getState(): string {
    const data = JSON.stringify({
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      log: this.log,
      startIndex: this.startIndex,
      startTerm: this.startTerm,
    });
    return data;
  }

  private readPersistentState(data: string | undefined): void {
    if (!data || data.length < 1) {
      return;
    }
    this.print("read persistent state");
    try {
      const { votedFor, currentTerm, log, startIndex, startTerm } = JSON.parse(data);
      this.currentTerm = currentTerm;
      this.votedFor = votedFor;
      this.log = log;
      this.startIndex = startIndex;
      this.startTerm = startTerm;
      this.print("state: term %d, votedFor %d, log %s",
        this.currentTerm, this.votedFor, JSON.stringify(this.log));
    } catch (e) {
      this.print("unable to decode state: %s", JSON.stringify(e));
    }
  }

  private readSnapshot(data: string): void {
    if (!data || data.length < 1) {
      return;
    }
    this.print("read snapshot");
    try {
      const snapshot: Snapshot = JSON.parse(data);
      this.restoreStateFromSnapshot(snapshot);
    } catch (e) {
      this.print("unable to decode snapshot: %s", JSON.stringify(e));
    }
  }

  private discardLogIfLeader(snapshot: Snapshot): void {
    if (!this.isLeader()) {
      this.print("unable to discard log because not leader");
      return;
    }
    this.print("discardLogIfLeader");
    this.discardLog(snapshot);
    const term = this.currentTerm;
    for (let server = 0; server < this.peers.length; server++) {
      if (server != this.me) {
        setImmediate(async () => this.installSnapshotForServer(server, term, snapshot));
      }
    }
    this.print("discardLogIfLeader done");
  }

  private async installSnapshotForServer(server: number, term: number, snapshot: Snapshot): Promise<void> {
    const { ok, success } = await this.callInstallSnapshot(server, term, snapshot);
    if (ok && success) {
      this.print("snapshot successfully installed on server %d", server);
      return;
    } else if (ok && !success) {
      this.print("snapshot rejected by server %d", server);
      return;
    }
    this.print("snapshot not installed on server %d, repeat after a delay", server);
    setTimeout(async () => this.installSnapshotForServer(server, term, snapshot), 10);
  }

  private discardLog(snapshot: Snapshot): void {
    this.discardCount++;
    const { lastIncludedIndex, lastIncludedTerm } = snapshot;
    this.print("DiscardNonLocking %d prevStartIndex %d newStartIndex %d",
      this.discardCount, this.startIndex, lastIncludedIndex);
    this.print("my log %s", JSON.stringify(this.log));
    this.print("my log len %d %d", this.log.length, this.len());
    if (this.hasItemWithSameIndexAndTerm(lastIncludedIndex, lastIncludedTerm)) {
      this.print("If existing log entry has same index and term as snapshot’s last included entry, retain log entries following it and reply")
      this.log = this.log.slice(this.relativeIndex(lastIncludedIndex + 1));
      this.print("after discard my log %s", JSON.stringify(this.log));
    } else {
      this.print("7. Discard the entire log");
      this.log = [];
    }
    this.startIndex = lastIncludedIndex + 1;
    this.startTerm = lastIncludedTerm;
    this.print("log discarded startIndex = %d", this.startIndex);
    const state = this.getState();
    this.persister.saveStateAndSnapshot(state, JSON.stringify(snapshot));
  }

  async takeIntoService(): Promise<void> {
    for (let server = 0; server < this.peers.length; server++) {
      if (server == this.me) {
        await this.peers[server].takeIntoService();
      } else {
        await this.peers[server].takeOutOfService();
      }
    }
  }

  async takeOutOfService(): Promise<void> {
    await this.peers[this.me].takeOutOfService();
  }

  middleware() {
    return (request: Request, response: Response, next: NextFunction) => {
      if (this.started) {
        if (!this.isLeader() && !request.path.startsWith('/raft')) {
          if (this.state === 'Follower') {
            const leader = this.peers[this.leaderId];
            if (this.leaderId >= 0 && this.leaderId < this.peers.length) {
              response.redirect(`${leader.baseAddress}${request.path}`);
              return;
            } else {
              response.status(503).json({
                state: this.state,
                message: 'Leader is not elected yet'
              });
              return;
            }
          } else if (this.state === 'Candidate') {
            response.status(503).json({
              state: this.state,
            });
            return;
          }
        }
      }
      next();
    }
  }

  private item(index: number): RaftLogEntry {
    return this.log[index - this.startIndex];
  }

  private hasItemWithSameIndexAndTerm(index: number, term: number): boolean {
    if (index < this.startIndex || index >= this.len()) {
      return false;
    }
    return this.item(index).term === term;
  }

  private len(): number {
    return this.log.length + this.startIndex;
  }

  private lastIndex(): number {
    return this.len() - 1;
  }

  private relativeIndex(index: number): number {
    return index - this.startIndex;
  }

  private createSnapshot(lastIncludedIndex: number): Snapshot {
    const previousSnapshot = this.lastSnapshot;
    const lastIncludedTerm = this.item(lastIncludedIndex).term;
    let snapshot: Snapshot = {
      session: {},
      storage: {},
      lastIncludedIndex,
      lastIncludedTerm,
    };
    if (previousSnapshot) {
      snapshot = previousSnapshot;
    }
    for (let index = this.startIndex; index <= lastIncludedIndex; index++) {
      const item = this.item(index);
      this.applyItemToSnapshot(item, snapshot);
    }
    return snapshot;
  }

  private applyItemToSnapshot(item: RaftLogEntry, snapshot: Snapshot): void {
    const entry: SyncCommand = item.command;
    const { session, storage } = snapshot;
    if (isSessionSyncCommand(entry)) {
      const sessionData = entry.payload;
      session[sessionData.sid] = sessionData.session;
    } else if (isStorageSyncCommand(entry)) {
      if (isStorageActionSetAll(entry.payload)) {
        snapshot.storage[entry.payload.data.pluginId] = entry.payload.data.dict;
      } else if (isStorageActionSet(entry.payload)) {
        const { pluginId, key, value } = entry.payload.data;
        if (typeof storage[pluginId] !== 'object') {
          storage[pluginId] = {};
        }
        storage[pluginId][key] = value;
      } else if (isStorageActionDeleteAll(entry.payload)) {
        const { pluginId } = entry.payload.data;
        storage[pluginId] = {};
      } else if (isStorageActionDelete(entry.payload)) {
        const { pluginId, key } = entry.payload.data;
        if (typeof storage[pluginId] === 'object') {
          delete storage.pluginId[key];
        }
      }
    }
  }

  restoreStateFromSnapshot(snapshot: Snapshot): void {
    this.print("restore state from snapshot %s", JSON.stringify(snapshot));
    const { session, storage } = snapshot;
    for (const sid in session) {
      sessionStore.set(sid, session[sid], () => { });
    }
    const clusterManager = process.clusterManager;
    for (const pluginId of Object.keys(storage)) {
      for (const key of Object.keys(storage[pluginId])) {
        clusterManager.setStorageByKey(pluginId, key, storage[pluginId][key]);
      }
    }
  }


  private print(...args: any[]): void {
    if (this.debug) {
      raftLog.info(...args);
    }
  }

}

let persister: Persister;
if (process.env.ZLUX_RAFT_PERSISTENCE_ENABLED === "TRUE") {
  raftLog.info("raft persistence enabled");
  let logPath = process.env.ZLUX_LOG_PATH!;
  if (logPath.startsWith(`"`) && logPath.endsWith(`"`)) {
    logPath = logPath.substring(1, logPath.length - 1);
  }
  const stateFilename = path.join(path.dirname(logPath), 'raft.data');
  const snapshotFilename = path.join(path.dirname(logPath), 'snapshot.data');
  raftLog.debug(`log ${logPath} stateFilename ${stateFilename} snapshotFilename ${snapshotFilename}`);
  persister = new FilePersister(stateFilename, snapshotFilename);
} else {
  raftLog.info("raft persistence disabled");
  persister = new DummyPersister();
}
const maxLogSize = 10;
export const raft = new Raft(persister, maxLogSize);

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
