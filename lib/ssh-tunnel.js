/*
  SSH Tunnel for Zowe Desktop (simplified / single-user mode)

  Creates a local HTTP proxy that forwards every request to a remote ZSS
  instance through SSH exec + curl.  This works even when the z/OS sshd
  blocks TCP forwarding (direct-tcpip), because we only use exec channels.

  Design:
    - One persistent SSH connection (ssh2 library)
    - One local http.Server on the agent port
    - Each incoming HTTP request → ssh.exec('curl …') → parse response → reply

  Eventually the credentials will come from the browser login; for now
  they are read from zowe.yaml (agent.ssh section).
*/

const { Client } = require('ssh2');
const http = require('http');

// z/OS environment prefix — sets up PATH to find curl from zopen,
// and disables EBCDIC auto-conversion so we get clean ASCII bytes.
const ZOS_ENV = 'export _BPXK_AUTOCVT=OFF'
  + ' PATH=$HOME/zopen/usr/local/altbin:$HOME/zopen/usr/local/bin'
  + ':$HOME/zopen/usr/bin:$HOME/zopen/bin:$HOME/zopen/boot:/bin:$PATH;';

/** Shell-escape a string using single quotes. */
function esc(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

class SshTunnel {
  /**
   * @param {object} opts
   * @param {string} opts.sshHost      - Remote z/OS hostname
   * @param {number} opts.sshPort      - SSH port (default 22)
   * @param {string} opts.sshUser      - z/OS username
   * @param {string} opts.sshPassword  - z/OS password
   * @param {string} opts.remoteHost   - Host ZSS is listening on (usually 127.0.0.1)
   * @param {number} opts.remotePort   - Port ZSS is listening on (e.g. 7557)
   * @param {number} opts.localPort    - Local port to expose (defaults to same as remotePort)
   * @param {string} opts.localHost    - Local bind address (defaults to 127.0.0.1)
   */
  constructor(opts) {
    this.sshHost = opts.sshHost;
    this.sshPort = opts.sshPort || 22;
    this.sshUser = opts.sshUser;
    this.sshPassword = opts.sshPassword;
    this.remoteHost = opts.remoteHost || '127.0.0.1';
    this.remotePort = opts.remotePort;
    this.localPort = opts.localPort || opts.remotePort;
    this.localHost = opts.localHost || '127.0.0.1';

    this._sshClient = null;
    this._server = null;
  }

  /**
   * Open SSH connection and start local HTTP proxy.
   * Resolves once the proxy is listening.
   */
  start() {
    return new Promise((resolve, reject) => {
      const ssh = new Client();
      this._sshClient = ssh;

      ssh.on('ready', () => {
        console.log(`[ssh-tunnel] SSH connected to ${this.sshHost}`);

        const server = http.createServer((req, res) => {
          this._proxyRequest(req, res);
        });

        server.on('error', (err) => {
          console.error('[ssh-tunnel] Local server error:', err.message);
          reject(err);
        });

        server.listen(this.localPort, this.localHost, () => {
          console.log(`[ssh-tunnel] HTTP proxy on ${this.localHost}:${this.localPort}`
            + ` -> ${this.remoteHost}:${this.remotePort} via SSH`);
          this._server = server;
          resolve();
        });
      });

      ssh.on('error', (err) => {
        console.error('[ssh-tunnel] SSH error:', err.message);
        reject(err);
      });

      ssh.on('close', () => {
        console.log('[ssh-tunnel] SSH connection closed');
      });

      ssh.connect({
        host: this.sshHost,
        port: this.sshPort,
        username: this.sshUser,
        password: this.sshPassword,
        readyTimeout: 30000,
      });
    });
  }

  /**
   * Proxy one HTTP request to ZSS via ssh exec + curl.
   */
  _proxyRequest(req, res) {
    const targetUrl = `http://${this.remoteHost}:${this.remotePort}${req.url}`;
    const bodyChunks = [];

    req.on('data', (chunk) => bodyChunks.push(chunk));
    req.on('end', () => {
      const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : null;

      // Build curl command
      let args = '-s -i --max-time 60';
      args += ' -X ' + req.method;

      // Forward request headers (skip hop-by-hop)
      const skip = new Set(['host', 'connection', 'transfer-encoding']);
      for (const [key, val] of Object.entries(req.headers)) {
        if (!skip.has(key.toLowerCase())) {
          args += ' -H ' + esc(key + ': ' + val);
        }
      }

      if (body && body.length > 0) {
        args += ' --data-binary @-';
      }

      args += ' ' + esc(targetUrl);

      const cmd = ZOS_ENV + ' curl ' + args;

      console.log(`[ssh-tunnel] ${req.method} ${req.url}`);

      this._sshClient.exec(cmd, (err, stream) => {
        if (err) {
          console.error('[ssh-tunnel] exec error:', err.message);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('SSH exec error');
          }
          return;
        }

        const chunks = [];
        stream.on('data', (d) => chunks.push(d));
        stream.stderr.on('data', (d) => {
          // curl writes progress / errors to stderr; log them
          const msg = d.toString().trim();
          if (msg) console.error('[ssh-tunnel] curl stderr:', msg);
        });

        stream.on('close', () => {
          const raw = Buffer.concat(chunks);
          this._sendParsedResponse(raw, res);
        });

        // Send request body to curl stdin, then close stdin
        if (body) stream.write(body);
        stream.end();
      });
    });
  }

  /**
   * Parse `curl -i` output (status line + headers + body) and write to `res`.
   */
  _sendParsedResponse(raw, res) {
    if (raw.length === 0) {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Empty response from ZSS');
      }
      return;
    }

    // curl -i format:
    //   HTTP/1.1 200 OK\r\n
    //   Header: value\r\n
    //   \r\n
    //   <body bytes>
    // Use latin1 for a 1:1 byte→char mapping so we can split on \r\n\r\n
    const text = raw.toString('latin1');

    let splitIdx = text.indexOf('\r\n\r\n');
    let delimLen = 4;
    if (splitIdx === -1) {
      splitIdx = text.indexOf('\n\n');
      delimLen = 2;
    }

    if (splitIdx === -1) {
      // Can't parse — send raw bytes as 200
      if (!res.headersSent) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(raw);
      }
      return;
    }

    const headerText = text.substring(0, splitIdx);
    const bodyOffset = Buffer.byteLength(headerText, 'latin1') + delimLen;
    const bodyBuf = raw.slice(bodyOffset);

    const lines = headerText.split(/\r?\n/);

    // Status line
    const statusMatch = lines[0].match(/^HTTP\/[\d.]+ (\d+)/);
    const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 200;

    // Response headers
    const headers = {};
    for (let i = 1; i < lines.length; i++) {
      const colon = lines[i].indexOf(':');
      if (colon > 0) {
        const k = lines[i].substring(0, colon).trim().toLowerCase();
        const v = lines[i].substring(colon + 1).trim();
        // skip hop-by-hop headers
        if (k !== 'transfer-encoding' && k !== 'connection') {
          headers[k] = v;
        }
      }
    }

    // Override content-length with actual body size
    headers['content-length'] = bodyBuf.length;

    if (!res.headersSent) {
      res.writeHead(statusCode, headers);
      res.end(bodyBuf);
    }
  }

  /** Tear everything down. */
  stop() {
    if (this._server) {
      this._server.close();
      this._server = null;
    }
    if (this._sshClient) {
      this._sshClient.end();
      this._sshClient = null;
    }
  }
}

module.exports = SshTunnel;
