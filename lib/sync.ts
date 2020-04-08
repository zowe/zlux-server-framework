import * as express from 'express';
import * as WebSocket from 'ws';
import * as EventEmitter from 'events';

interface LogEntry {
  type: 'session' | 'service',
  data: any;
}

export interface SessionLogEntry extends LogEntry {
  type: 'session',
  data: {
    sid: string,
    session: any;
  }
}

function isSessionLogEntry(entry: LogEntry): entry is SessionLogEntry {
  return entry.type === 'session';
}

let connected = false;
export const emitter = new EventEmitter();
emitter.on('error', (e) => console.log(`EMITTER: error ${JSON.stringify(e)}`));

export function updateSession(sid: string, session: any): void {
  if (connected) {
    console.log(`update session do nothing`);
    return;
  }
  const data = { sid, session };
  const sessionLogEntry: SessionLogEntry = { type: 'session', data };
  console.log(`updateSession log entry ${JSON.stringify(sessionLogEntry)}`);
  emitter.emit('session', sessionLogEntry);
}

export function updateSessionForNewClient(ws: WebSocket, sid: string, session: any): void {
  const data = { sid, session };
  const sessionLogEntry: SessionLogEntry = { type: 'session', data };
  console.log(`updateSessionForNewClient log entry ${JSON.stringify(sessionLogEntry)}`);
  ws.send(JSON.stringify(sessionLogEntry));
}

export class SyncEndpoint {
  constructor(
    private ws: WebSocket,
    private req: express.Request,
  ) {
    this.init();
  }

  private init(): void {
    const listener = this.onSessionChange.bind(this);
    emitter.emit('connected', this.ws);
    emitter.addListener('session', listener);
    this.ws.on('close', () => emitter.removeListener('session', listener));
  }

  private onSessionChange(entry: SessionLogEntry) {
    console.log(`SyncEndpoint:onSessionChange: send to client entry ${JSON.stringify(entry)}`);
    this.ws.send(JSON.stringify(entry, null, 2));
  }
}

export const syncEmitter = new EventEmitter();

export class SyncClient {
  private ws: WebSocket;

  constructor() {
    this.ws = new WebSocket('wss://localhost:8544/sync', { rejectUnauthorized: false });
    this.ws.on('open', () => {
      console.log('opened');
      connected = true;
    });
    this.ws.on('message', (data) => {
      console.log(`message ${data}`);
      const entry: LogEntry = JSON.parse(data.toString());
      if (isSessionLogEntry(entry)) {
        syncEmitter.emit('session', entry.data);
      }
    });
  }
}

