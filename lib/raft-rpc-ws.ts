import * as WebSocket from 'ws';
import * as express from 'express';
import { RequestVoteArgs, RequestVoteReply, AppendEntriesArgs, AppendEntriesReply, RaftRPCDriver, Raft, InstallSnapshotArgs, InstallSnapshotReply } from './raft';
const zluxUtil = require('./util');
const raftLog = zluxUtil.loggers.raftLogger;

enum WebSocketMessageType {
  RequestVoteArgs,
  RequestVoteReply,
  AppendEntriesArgs,
  AppendEntriesReply,
};

interface WebSocketMessage {
  seq: number;
  type: 'RequestVoteArgs' | 'RequestVoteReply' | 'AppendEntriesArgs' | 'AppendEntriesReply' | 'InstallSnapshotArgs' | 'InstallSnapshotReply'
  // type: WebSocketMessageType,
  message: any;
}

interface WebSocketRequestVoteArgsMessage extends WebSocketMessage {
  type: 'RequestVoteArgs';
  // type: WebSocketMessageType.RequestVoteArgs
  message: RequestVoteArgs;
}

interface WebSocketInstallSnapshotArgsMessage extends WebSocketMessage {
  type: 'InstallSnapshotArgs';
  // type: WebSocketMessageType.InstallSnapshotArgs
  message: InstallSnapshotArgs;
}

interface WebSocketInstallSnapshotReplyMessage extends WebSocketMessage {
  type: 'InstallSnapshotReply';
  // type: WebSocketMessageType.InstallSnapshotArgs
  message: InstallSnapshotReply;
}

interface WebSocketRequestVoteReplyMessage extends WebSocketMessage {
  type: 'RequestVoteReply';
  // type: WebSocketMessageType.RequestVoteReply
  message: RequestVoteReply;
}

function isWebSocketRequestVoteArgsMessage(message: WebSocketMessage): message is WebSocketRequestVoteArgsMessage {
  return message.type === 'RequestVoteArgs';
}

function isWebSocketInstallSnapshotArgsMessage(message: WebSocketMessage): message is WebSocketInstallSnapshotArgsMessage {
  return message.type === 'InstallSnapshotArgs';
}

interface WebSocketAppendEntriesArgsMessage extends WebSocketMessage {
  type: 'AppendEntriesArgs';
  // type: WebSocketMessageType.AppendEntriesArgs
  message: AppendEntriesArgs;
}

interface WebSocketAppendEntriesReplyMessage extends WebSocketMessage {
  type: 'AppendEntriesReply';
  // type: WebSocketMessageType.AppendEntriesReply
  message: AppendEntriesReply;
}

function isWebSocketAppendEntriesArgsMessage(message: WebSocketMessage): message is WebSocketAppendEntriesArgsMessage {
  return message.type === 'AppendEntriesArgs';
}

interface PendingRequest {
  message: WebSocketMessage;
  resolve: (data: WebSocketMessage) => void;
  reject: (err: Error) => void;
}

export class RaftRPCWebSocketDriver implements RaftRPCDriver {
  private static seq = 1;
  private ws: WebSocket;
  private isConnected = false;
  readonly address: string;

  private pendingRequests = new Map<number, PendingRequest>();
  connectPromise: Promise<void>;
  isConnecting: boolean = false;


  constructor(
    public host: string,
    public port: number,
    public secure: boolean
  ) {
    this.address = this.makeWebsocketAddress();
  }

  async sendRequestVote(args: RequestVoteArgs): Promise<RequestVoteReply> {
    const message: WebSocketMessage = {
      seq: RaftRPCWebSocketDriver.seq++,
      type: 'RequestVoteArgs',
      message: args,
    };
    try {
      const reply = await this.call(message).then(reply => reply.message);
      return reply;
    } catch (e) {
      throw e;
    }
  }

  async sendAppendEntries(args: AppendEntriesArgs): Promise<AppendEntriesReply> {
    const message: WebSocketMessage = {
      seq: RaftRPCWebSocketDriver.seq++,
      type: 'AppendEntriesArgs',
      message: args,
    };
    try {
      const reply = await this.call(message).then(reply => reply.message);
      return reply;
    } catch (e) {
      throw e;
    }
  }

  async sendInstallSnapshot(args: InstallSnapshotArgs): Promise<InstallSnapshotReply> {
    const message: WebSocketMessage = {
      seq: RaftRPCWebSocketDriver.seq++,
      type: 'InstallSnapshotArgs',
      message: args,
    };
    try {
      const reply = await this.call(message).then(reply => reply.message);
      return reply;
    } catch (e) {
     throw e;
    }
  }

  private makeWebsocketAddress(): string {
    return `${this.secure ? 'wss' : 'ws'}://${this.host}:${this.port}/raft`;
  }

  private async connect(): Promise<void> {
    if (this.isConnected) {
      return Promise.resolve();
    } else if (this.isConnecting && this.connectPromise) {
      return this.connectPromise;
    }
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.address, { rejectUnauthorized: false });
      this.ws.on('open', () => {
        this.onOpen();
        resolve();
      });
      this.ws.on('error', () => reject());
      this.ws.on('message', (data: Buffer) => this.onMessage(data));
      this.ws.on('close', (code: number, reason: string) => this.onClose(code, reason));
    });
    this.isConnecting = true;
    return this.connectPromise;
  }

  private async call(message: WebSocketMessage): Promise<WebSocketMessage> {
    try {
      await this.connect();
      const promise = new Promise<WebSocketMessage>((resolve, reject) => {
        const seq = message.seq;
        const pendingRequest: PendingRequest = { message, resolve, reject };
        this.pendingRequests.set(seq, pendingRequest);
      });
      raftLog.trace(`send websocket message ${JSON.stringify(message)} to ${this.address}`);
      this.ws.send(JSON.stringify(message));
      const replyMessage = await promise;
      return replyMessage;
    } catch (e) {
      throw e;
    }
  }

  private onOpen(): void {
    this.isConnected = true;
    this.isConnecting = false;
    this.connectPromise = undefined;
    raftLog.trace(`connection to ${this.address} established`);
  }

  private onMessage(data: Buffer): void {
    raftLog.trace(`message ${data}`);
    let message: WebSocketMessage;
    try {
      message = JSON.parse(data.toString());
    } catch (e) {
      raftLog.warn(`ignore invalid message`);
      return;
    }
    const seq = message.seq;
    const pendingRequest = this.pendingRequests.get(seq);
    if (!pendingRequest) {
      raftLog.warn(`no request found with seq ${seq}, ignore it`);
      return;
    }
    this.pendingRequests.delete(seq);
    pendingRequest.resolve(message);
    raftLog.trace(`successfully resolve pending request with seq ${seq}`);
  }

  private onClose(code: number, reason: string): void {
    raftLog.trace(`connection to ${this.address} closed ${code} ${reason}`);
    this.isConnected = false;
    this.isConnecting = false;
    this.ws = undefined;
    this.pendingRequests.forEach((request => {
      request.reject(new Error('connection closed'));
    }));
    this.pendingRequests.clear();
  }

  private onError(ws: WebSocket, err: Error): void {
    raftLog.trace(`connection error ${JSON.stringify(err)}`);
  }

}

export class RaftRPCWebSocketService {
  constructor(
    private clientWS: WebSocket,
    private req: express.Request,
    private raft: Raft,
  ) {
    this.init();
  }

  private init(): void {
    this.tracePrintf(`connected client`);
    this.clientWS.on('close', () => this.onClose());
    this.clientWS.on('message', (data: Buffer) => this.onMessage(data));
  }

  private onClose(): void {
    this.tracePrintf('connection closed');
  }

  private onMessage(data: Buffer): void {
    this.tracePrintf(`received message ${data}`);
    let message: WebSocketMessage;
    try {
      message = JSON.parse(data.toString());
    } catch (e) {
      this.tracePrintf(`ignore invalid message`);
      return;
    }
    this.tracePrintf(`got message ${JSON.stringify(message)}`);
    if (isWebSocketRequestVoteArgsMessage(message)) {
      raftLog.trace(`got request vote message ${JSON.stringify(message)}`);
      this.processRequestVoteMessage(message);
    } else if (isWebSocketAppendEntriesArgsMessage(message)) {
      raftLog.trace(`got append entries message ${JSON.stringify(message)}`);
      this.processAppendEntriesMessage(message);
    } else if (isWebSocketInstallSnapshotArgsMessage(message)) {
      raftLog.trace(`got install snapshot message ${JSON.stringify(message)}`);
      this.processInstallSnapshotMessage(message);
    }

  }
  private async processAppendEntriesMessage(message: WebSocketAppendEntriesArgsMessage): Promise<void> {
    const seq = message.seq;
    const args = message.message;
    const reply = await this.raft.invokeAppendEntriesAndWritePersistentState(args);
    const replyMessage: WebSocketAppendEntriesReplyMessage = {
      type: 'AppendEntriesReply',
      seq,
      message: reply,
    };
    this.clientWS.send(JSON.stringify(replyMessage));
  }

  private async processRequestVoteMessage(message: WebSocketRequestVoteArgsMessage): Promise<void> {
    const seq = message.seq;
    const args = message.message;
    const reply = await this.raft.invokeRequestVoteAndWritePersistentState(args);
    const replyMessage: WebSocketRequestVoteReplyMessage = {
      type: 'RequestVoteReply',
      seq,
      message: reply,
    };
    this.clientWS.send(JSON.stringify(replyMessage));
  }

  private async processInstallSnapshotMessage(message: WebSocketInstallSnapshotArgsMessage): Promise<void> {
    const seq = message.seq;
    const args = message.message;
    const reply = await this.raft.invokeInstallSnapshot(args);
    const replyMessage: WebSocketInstallSnapshotReplyMessage = {
      type: 'InstallSnapshotReply',
      seq,
      message: reply,
    };
    this.clientWS.send(JSON.stringify(replyMessage));
  }

  private tracePrintf(msg: string): void {
    raftLog.trace(`RaftRPCWebSocketService: ${msg}`);
  }
}