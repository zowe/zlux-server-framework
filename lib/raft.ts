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

export interface RaftLogEntry {
  Term: number;
  Command: any;
}

export interface RequestVoteArgs {
  term: number; // candidate’s term
  candidateId: number; // candidate requesting vote
  lastLogIndex?: number; // index of candidate’s last log entry (§5.4)
  lastLogTerm?: number; //term of candidate’s last log entry (§5.4)
}

export interface RequestVoteReply {
  Term: number;  // currentTerm, for candidate to update itself
  VoteGranted: boolean; // true means candidate received vote
}

export interface AppendEntriesArgs {
  Term: number;        // Leader’s term
  LeaderID: number;        // so follower can redirect clients
  PrevLogIndex: number;        // index of log entry immediately preceding new ones
  PrevLogTerm: number;        // term of prevLogIndex entry
  Entries: RaftLogEntry[]; // entries to store (empty for heartbeat; may send more than one for efficiency)
  LeaderCommit: number;        // leader’s commitIndex
}

export interface AppendEntriesReply {
  Term: number;  // currentTerm, for leader to update itself
  Success: boolean; // true if follower contained entry matching prevLogIndex and prevLogTerm
}

export interface RaftRPCDriver {
  sendRequestVote: (args: RequestVoteArgs) => Promise<RequestVoteReply>;
  sendAppendEntries: (args: AppendEntriesArgs) => Promise<AppendEntriesReply>;
}

export type State = 'Leader' | 'Follower' | 'Candidate'

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
  private nextIndex: number[];  //  for each server, index of the next log entry to send to that server (initialized to leader last log index + 1)
  private matchIndex: number[]; // for each server, index of highest log entry known to be replicated on server (initialized to 0, increases monotonically)
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
        const voteGranted = await this.callRequestVote(server, term);
        if (!voteGranted) {
          this.print("vote by peer %d not granted", server);
          return;
        }
        votes++;
        if (done) {
          this.print("got vote from peer %d but election already finished", server);
          return;
        } else if (this.state == 'Follower') {
          this.print("got heartbeat, stop election")
          done = true;
          return;
        } else if (votes <= peerCount / 2) {
          this.print("got vote from %d but not enough votes yet to become Leader", server);
          return;
        }
        this.print("got final vote from %d and became Leader of term %d", server, this.currentTerm);
        done = true;
        this.convertToLeader();
      });
    }
    this.scheduleElectionOnTimeout();
  }

  convertToLeader(): void {
    this.state = 'Leader';
    this.nextIndex = [];
    this.matchIndex = [];
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
        await this.callAppendEntries(server, this.currentTerm, -1);
        // this.print("got heartbeat response from %d at term %d", server, this.currentTerm);
      });
    }
    if (!this.isLeader()) {
      this.print("stop heartbeat because not leader anymore");
      return;
    }
    this.heartbeatTimeoutId = setTimeout(() => this.sendHeartbeat(), this.heartbeatInterval)
  }

  async callAppendEntries(server: number, currentTerm: any, index: number): Promise<boolean> {
    const entries: RaftLogEntry[] = [];
    if (index != -1) {
      entries.push(this.log[index])
    }
    const prevLogIndex = index - 1;
    let prevLogTerm = -1;
    if (prevLogIndex >= 0) {
      prevLogTerm = this.log[prevLogIndex].Term
    }
    const args: AppendEntriesArgs = {
      LeaderID: this.me,
      Term: this.currentTerm,
      Entries: entries,
      LeaderCommit: this.commitIndex,
      PrevLogIndex: prevLogIndex,
      PrevLogTerm: prevLogTerm,
    };
    const peer = this.peers[server];
    return peer.sendAppendEntries(args).then(reply => reply.Success).catch(() => false);
  }

  async callRequestVote(server: number, term: number): Promise<boolean> {
    const peer = this.peers[server];
    const requestVoteArgs: RequestVoteArgs = {
      candidateId: this.me,
      term: term,
    }
    return peer.sendRequestVote(requestVoteArgs)
      .then(reply => reply.VoteGranted)
      .catch(() => false);
  }

  appendEntries(args: AppendEntriesArgs): AppendEntriesReply {
    this.print("got append entries request from leader %d at term %d", args.LeaderID, args.Term)
    // 1. Reply false if term < currentTerm (§5.1)
    if (args.Term < this.currentTerm) {
      return {
        Success: false,
        Term: this.currentTerm,
      }
    }
    if (args.PrevLogIndex >= 0) {
      // 2. Reply false if log doesn’t contain an entry at prevLogIndex whose term matches prevLogTerm (§5.3)
      if (args.PrevLogIndex >= this.log.length) {
        return {
          Success: false,
          Term: this.currentTerm,
        }
      }
      // 3. If an existing entry conflicts with a new one (same index but different terms), delete the existing entry and all that follow it (§5.3)
      const prevLogTerm = this.log[args.PrevLogIndex].Term;
      if (prevLogTerm != args.PrevLogTerm) {
        this.log = this.log.slice(0, args.PrevLogIndex);
      }
    }
    // 4. Append any new entries not already in the log
    this.log = this.log.concat(args.Entries);
    // 5. If leaderCommit > commitIndex, set commitIndex = min(leaderCommit, index of last new entry)
    const lastNewEntryIndex = this.log.length - 1;
    if (args.LeaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(args.LeaderCommit, lastNewEntryIndex);
    }

    this.convertToFollower();
    return {
      Success: true,
      Term: args.Term,
    };
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
        Term: this.currentTerm,
        VoteGranted: false,
      };
    }
    if (args.term > this.currentTerm) {
      this.votedFor = -1;
    }
    if (this.votedFor == -1 || this.votedFor == this.me) {
      this.votedFor = args.candidateId;
      this.currentTerm = args.term;
      return {
        Term: this.currentTerm,
        VoteGranted: true
      };
    }
    return {
      Term: this.currentTerm,
      VoteGranted: false,
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
