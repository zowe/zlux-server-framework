import * as WebSocket from 'ws';
import * as express from 'express';
import { RequestVoteArgs, RequestVoteReply, AppendEntriesArgs, AppendEntriesReply, RaftRPCDriver, Raft } from './raft';
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
  type: 'RequestVoteArgs' | 'RequestVoteReply' | 'AppendEntriesArgs' | 'AppendEntriesReply';
  // type: WebSocketMessageType,
  message: any;
}

interface WebSocketRequestVoteArgsMessage extends WebSocketMessage {
  type: 'RequestVoteArgs';
  // type: WebSocketMessageType.RequestVoteArgs
  message: RequestVoteArgs;
}

interface WebSocketRequestVoteReplyMessage extends WebSocketMessage {
  type: 'RequestVoteReply';
  // type: WebSocketMessageType.RequestVoteReply
  message: RequestVoteReply;
}

function isWebSocketRequestVoteArgsMessage(message: WebSocketMessage): message is WebSocketRequestVoteArgsMessage {
  return message.type === 'RequestVoteArgs';
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
    return this.call(message).then(reply => reply.message);
  }

  async sendAppendEntries(args: AppendEntriesArgs): Promise<AppendEntriesReply> {
    const message: WebSocketMessage = {
      seq: RaftRPCWebSocketDriver.seq++,
      type: 'AppendEntriesArgs',
      message: args,
    };
    return this.call(message).then(reply => reply.message);
  }

  private makeWebsocketAddress(): string {
    return `${this.secure ? 'wss' : 'ws'}://${this.host}:${this.port}/raft`;
  }

  private async connect(): Promise<void> {
    if (this.isConnected) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.address, { rejectUnauthorized: false });
      this.ws.on('open', () => {
        this.onOpen();
        resolve();
      });
      this.ws.on('error', () => reject());
      this.ws.on('message', (data: Buffer) => this.onMessage(data));
      this.ws.on('close', (code: number, reason: string) => this.onClose(code, reason));
    });
  }

  private async call(message: WebSocketMessage): Promise<WebSocketMessage> {
    await this.connect();
    const promise = new Promise<WebSocketMessage>((resolve, reject) => {
      const seq = message.seq;
      const pendingRequest: PendingRequest = { message, resolve, reject };
      this.pendingRequests.set(seq, pendingRequest);
    });
    raftLog.debug(`send websocket message ${JSON.stringify(message)} to ${this.address}`);
    this.ws.send(JSON.stringify(message));
    return promise;
  }

  private onOpen(): void {
    this.isConnected = true;
    raftLog.info(`connection to ${this.address} established`);
  }

  private onMessage(data: Buffer): void {
    raftLog.debug(`message ${data}`);
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
    raftLog.debug(`successfully resolve pending request with seq ${seq}`);
  }

  private onClose(code: number, reason: string): void {
    raftLog.debug(`connection to ${this.address} closed ${code} ${reason}`);
    this.isConnected = false;
    this.ws = undefined;
    this.pendingRequests.forEach((request => {
      request.reject(new Error('connection closed'));
    }));
    this.pendingRequests.clear();
  }

  private onError(ws: WebSocket, err: Error): void {
    raftLog.debug(`connection error ${JSON.stringify(err)}`);
  }

}

export class RaftRPCWebSocketService {
  constructor(
    private clientWS: WebSocket,
    private req: express.Request,
    private raft: Raft,
  ) {
    this.log('constructor');
    this.init();
  }

  private init(): void {
    this.log(`connected client`);
    this.clientWS.on('close', () => this.onClose());
    this.clientWS.on('message', (data: Buffer) => this.onMessage(data));
  }

  private onClose(): void {
    this.log('connection closed');
  }

  private onMessage(data: Buffer): void {
    this.log(`received message ${data}`);
    let message: WebSocketMessage;
    try {
      message = JSON.parse(data.toString());
    } catch (e) {
      this.log(`ignore invalid message`);
      return;
    }
    this.log(`got message ${JSON.stringify(message)}`);
    if (isWebSocketRequestVoteArgsMessage(message)) {
      raftLog.debug(`got request vote message ${JSON.stringify(message)}`);
      this.processRequestVoteMessage(message);
    } else if (isWebSocketAppendEntriesArgsMessage(message)) {
      raftLog.debug(`got append entries message ${JSON.stringify(message)}`);
      this.processAppendEntriesMessage(message);
    }

  }
  private processAppendEntriesMessage(message: WebSocketAppendEntriesArgsMessage): void {
    const seq = message.seq;
    const args = message.message;
    const reply = this.raft.appendEntriesAndWritePersistentState(args);
    const replyMessage: WebSocketAppendEntriesReplyMessage = {
      type: 'AppendEntriesReply',
      seq,
      message: reply,
    };
    this.clientWS.send(JSON.stringify(replyMessage));
  }

  private processRequestVoteMessage(message: WebSocketRequestVoteArgsMessage): void {
    const seq = message.seq;
    const args = message.message;
    const reply = this.raft.requestVoteAndWritePersistentState(args);
    const replyMessage: WebSocketRequestVoteReplyMessage = {
      type: 'RequestVoteReply',
      seq,
      message: reply,
    };
    this.clientWS.send(JSON.stringify(replyMessage));
  }
  
  private log(msg: string): void {
    raftLog.debug(`RaftRPCWebSocketService: ${msg}`);
  }
}