import * as express from 'express';
import * as ws from 'ws';
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
const emitter = new EventEmitter();
emitter.on('error', (e) => console.log(`EMITTER: error ${JSON.stringify(e)}`));

export function updateSession(sid: string, session: any): void {
  const data = { sid, session };
  const sessionLogEntry: SessionLogEntry = { type: 'session', data };
  console.log(`updateSession log entry ${JSON.stringify(sessionLogEntry)}`);
  emitter.emit('session', sessionLogEntry);
}

export class SyncEndpoint {
  constructor(
    private ws: ws,
    private req: express.Request,
  ) {
    this.init();
  }

  private init(): void {
    const listener = this.onSessionChange.bind(this);
    emitter.addListener('session', listener);
    this.ws.on('close', () => emitter.removeListener('session', listener));
  }

  private onSessionChange(entry: SessionLogEntry) {
    console.log(`SyncEndpoint:onSessionChange: send to client entry ${JSON.stringify(entry)}`);
    this.ws.send(JSON.stringify(entry, null, 2));
  }
}

