/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

import { EventEmitter } from "events";

export interface RaftPeer {

}

export interface RaftLogEntry {

}

export type State = 'Leader' | 'Follower' | 'Candidate'

const minElectionTimeout = 150;
const maxElectionTimeout = 300;

export class Raft {
  private peers: RaftPeer[]; // RPC end points of all peers
  private me: number;                             // this peer's index into peers[]
  private state: State = 'Follower'
  private readonly electionTimeout = Math.floor(Math.random() * (maxElectionTimeout - minElectionTimeout) + minElectionTimeout);
  private heartBeatEmitter = new EventEmitter();
  private debug = true

  // persistent state
  private currentTerm: number = 0;
  private votedFor = -1
  private log: RaftLogEntry[];

  // volatile state on all servers
  private commitIndex: number = -1;
  private lastApplied: number = -1;

  // volatile state on leaders(Reinitialized after election):
  private nextIndex: number[];  //  for each server, index of the next log entry to send to that server (initialized to leader last log index + 1)
  private matchIndex: number[]; // for each server, index of highest log entry known to be replicated on server (initialized to 0, increases monotonically)
  private electionTimeoutId: NodeJS.Timer;
  private readonly heartbeatInterval: number = 50;
  private heartbeatTimeoutId: NodeJS.Timer;

  static make(peers: RaftPeer[], me: number): Raft {
    const raft = new Raft();
    raft.startElectionOnTimeout();
    return raft;
  }

  constructor() {

  }

  startElectionOnTimeout(): void {
    this.electionTimeoutId = setTimeout(() => {
      if (this.isLeader()) {
        this.startElectionOnTimeout();
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
        if (false) {
          this.print("got heartbeat response from %d at term %d", server, this.currentTerm);
        }
      });
    }
    if (!this.isLeader()) {
      this.print("stop heartbeat because not leader anymore");
      return;
    }
    this.heartbeatTimeoutId = setTimeout(() => this.sendHeartbeat(), this.heartbeatInterval)
  }

  async callAppendEntries(server: number, currentTerm: any, arg2: number): Promise<void> {

  }

  async callRequestVote(server: number, term: number): Promise<boolean> {
    return Promise.resolve(true);
  }

  private print(...args: any[]): void {
    if (this.debug) {
      console.log(...args);
    }
  }

}

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
