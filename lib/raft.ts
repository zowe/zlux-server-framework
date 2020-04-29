/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

import { RaftRPCWebSocketDriver } from "./raft-rpc-ws";
const zluxUtil = require('./util');
const raftLog = zluxUtil.loggers.raftLogger;

export class RaftPeer extends RaftRPCWebSocketDriver {
  constructor(
    host: string,
    port: number,
    secure: boolean
  ) {
    super(host, port, secure);
  }
}

export type Command = any;
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
}

export interface RaftRPCDriver {
  sendRequestVote: (args: RequestVoteArgs) => Promise<RequestVoteReply>;
  sendAppendEntries: (args: AppendEntriesArgs) => Promise<AppendEntriesReply>;
}

export type State = 'Leader' | 'Follower' | 'Candidate';

const minElectionTimeout = 150;
const maxElectionTimeout = 300;

export class Raft {
  private peers: RaftPeer[]; // RPC end points of all peers
  private me: number;  // this peer's index into peers[]
  private state: State = 'Follower'
  private readonly electionTimeout = Math.floor(Math.random() * (maxElectionTimeout - minElectionTimeout) + minElectionTimeout);
  private debug = true

  // persistent state
  private currentTerm: number = 0;
  private votedFor = -1
  private log: RaftLogEntry[] = [];

  // volatile state on all servers
  private commitIndex: number = -1;
  private lastApplied: number = -1;

  // volatile state on leaders(Reinitialized after election):
  private nextIndex: number[] = [];  //  for each server, index of the next log entry to send to that server (initialized to leader last log index + 1)
  private matchIndex: number[] = []; // for each server, index of highest log entry known to be replicated on server (initialized to 0, increases monotonically)
  private electionTimeoutId: NodeJS.Timer;
  private readonly heartbeatInterval: number = 50;
  private heartbeatTimeoutId: NodeJS.Timer;


  constructor() {

  }

  start(peers: RaftPeer[], me: number): void {
    raftLog.info(`starting peer ${me}`);
    this.peers = peers;
    this.me = me;
    this.scheduleElectionOnTimeout();
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
    this.state = 'Candidate';
    this.currentTerm++;
    this.votedFor = this.me;
    let votes = 1;
    let done = false;
    const term = this.currentTerm;
    const peerCount = this.peers.length;
    this.print("attempting election at term %d", this.currentTerm)

    for (let server = 0; server < peerCount; server++) {
      if (server == this.me) {
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
        } else if (votes <= peerCount / 2) {
          this.print("got vote from %s but not enough votes yet to become Leader", peerAddress);
          return;
        }
        this.print("got final vote from %s and became Leader of term %d", peerAddress, this.currentTerm);
        done = true;
        this.convertToLeader();
      });
    }
    this.scheduleElectionOnTimeout();
  }

  convertToLeader(): void {
    this.state = 'Leader';
    // When a leader first comes to power, it initializes all nextIndex values to the index just after the last one in its log (11 in Figure 7)
    for (let i = 0; i < this.peers.length; i++) {
      this.nextIndex[i] = this.log.length;
      this.matchIndex[i] = -1;
    }
    this.print("nextIndex %s", JSON.stringify(this.nextIndex));
    this.print("matchIndex %s", JSON.stringify(this.matchIndex));
    this.sendHeartbeat();
  }

  sendHeartbeat(): void {
    const peerCount = this.peers.length;

    for (let server = 0; server < peerCount; server++) {
      if (server == this.me) {
        continue;
      }
      setImmediate(async () => {
        this.print("sends heartbeat to %d at term %d", server, this.currentTerm);
        if (!this.isLeader()) {
          return;
        }
        const { ok, success } = await this.callAppendEntries(server, this.currentTerm, 'heartbeat');
        if (ok && !success) {
          if (this.isLeader()) {
            this.nextIndex[server]--;
            this.print("got unsuccessful heartbeat response from %d at term %d, decrease nextIndex", server, this.currentTerm);
          }
        } else if (ok && success) {
          this.print("got successful heartbeat response from %d at term %d, update nextIndex", server, this.currentTerm);
        }
      });
    }
    if (!this.isLeader()) {
      this.print("stop heartbeat because not leader anymore");
      return;
    }
    this.heartbeatTimeoutId = setTimeout(() => this.sendHeartbeat(), this.heartbeatInterval)
  }

  async callAppendEntries(server: number, currentTerm: number, kind: AppendEntriesKind): Promise<{ ok: boolean, success: boolean }> {
    const entries: RaftLogEntry[] = [];
    let last = this.log.length;
    if (kind == "appendentries") {
      last = this.commitIndex + 1;
    } else {
      last = this.commitIndex;
    }
    let start = this.nextIndex[server];
    if (start < 0) {
      start = 0;
    }
    for (let ni = start; ni <= last; ni++) {
      entries.push(this.log[ni]);
    }
    let prevLogIndex = this.nextIndex[server] - 1;
    let prevLogTerm = -1;
    if (prevLogIndex >= 0) {
      prevLogTerm = this.log[prevLogIndex].term;
    }
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
      .then(reply => ({ ok: true, success: reply.success }))
      .catch(() => ({ ok: false, success: false }));
  }

  async callRequestVote(server: number, term: number): Promise<boolean> {
    const peer = this.peers[server];
    let lastTerm = 0;
    const lastCommitted = this.commitIndex;
    if (lastCommitted >= 0) {
      lastTerm = this.log[lastCommitted].term;
    }
    const requestVoteArgs: RequestVoteArgs = {
      candidateId: this.me,
      term: term,
      lastLogIndex: lastCommitted,
      lastLogTerm: lastTerm,
    }
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

  appendEntries(args: AppendEntriesArgs): AppendEntriesReply {
    let requestType = "heartbeat";
    if (args.entries.length > 0) {
      requestType = "appendentries";
    }
    this.ensureRequestTerm(args.term);
    this.convertToFollower();
    this.print("got %s request from leader %d at term %d, my term %d, entries %+v, prevLogIndex %d",
      requestType, args.leaderId, args.term, this.currentTerm, args.entries, args.prevLogIndex)

    // 1. Reply false if term < currentTerm (§5.1)
    if (args.term < this.currentTerm) {
      this.print("1. Reply false if term < currentTerm (§5.1)")
      return {
        success: false,
        term: this.currentTerm,
      }
    }
    if (args.prevLogIndex >= 0) {
      // 2. Reply false if log doesn’t contain an entry at prevLogIndex whose term matches prevLogTerm (§5.3)
      if (args.prevLogIndex >= this.log.length) {
        this.print("2. Reply false if log doesn’t contain an entry at prevLogIndex whose term matches prevLogTerm (§5.3)");
        return {
          success: false,
          term: this.currentTerm,
        }
      }
      // 3. If an existing entry conflicts with a new one (same index but different terms), delete the existing entry and all that follow it (§5.3)
      const prevLogTerm = this.log[args.prevLogIndex].term;
      if (prevLogTerm != args.prevLogTerm) {
        this.print("3. If an existing entry conflicts with a new one (same index but different terms), delete the existing entry and all that follow it (§5.3)")
        this.log = this.log.slice(0, args.prevLogIndex);
      }
    }
    if (args.entries.length > 0) {
      // 4. Append any new entries not already in the log
      this.print("4. Append any new entries not already in the log: %+v", args.entries);
      this.log = this.log.concat(args.entries);
    }
    // 5. If leaderCommit > commitIndex, set commitIndex = min(leaderCommit, index of last new entry)
    const lastNewEntryIndex = this.log.length - 1;
    if (args.leaderCommit > this.commitIndex) {
      this.print("5. If leaderCommit > commitIndex, set commitIndex = min(leaderCommit, index of last new entry) = %d", this.commitIndex);
      this.commitIndex = Math.min(args.leaderCommit, lastNewEntryIndex);
    }

    for (; this.lastApplied <= this.commitIndex; this.lastApplied++) {
      if (this.lastApplied < 0) {
        continue
      }
      const applyMsg: ApplyMsg = {
        commandValid: true,
        commandIndex: this.lastApplied + 1,
        command: this.log[this.lastApplied].command,
      }
      this.applyCommand(applyMsg);
    }
    this.print("%s reply with success = true", requestType)
    return {
      success: true,
      term: args.term,
    };
  }

  applyCommand(applyMsg: ApplyMsg): void {
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
    this.state = 'Follower';
    this.cancelCurrentElectionTimeoutAndReschedule();
    this.cancelHeartbeat();
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
    this.print("got vote request from %d at term %d, my term is %d", args.candidateId, args.term, this.currentTerm)
    if (args.term < this.currentTerm) {
      this.print("got vote request from %d at term %d", args.candidateId, args.term);
      return {
        term: this.currentTerm,
        voteGranted: false,
      };
    }
    if (args.term > this.currentTerm) {
      this.votedFor = -1;
    }
    if (this.votedFor == -1 || this.votedFor == this.me && args.lastLogIndex >= this.commitIndex && args.lastLogTerm >= this.currentTerm) {
      this.votedFor = args.candidateId;
      this.currentTerm = args.term;
      return {
        term: this.currentTerm,
        voteGranted: true
      };
    }
    return {
      term: this.currentTerm,
      voteGranted: false,
    };
  }

  private print(...args: any[]): void {
    if (this.debug) {
      console.log(...args);
    }
  }

}


export const peers: RaftPeer[] = [
  new RaftPeer('localhost', 8544, true),
  new RaftPeer('localhost', 8545, true),
  new RaftPeer('localhost', 8546, true),
];

export const raft = new Raft();

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
