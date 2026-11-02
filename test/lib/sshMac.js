/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

const assert = require('assert');
const crypto = require('crypto');

const ssh = require('../../plugins/terminal-proxy/lib/ssh');

const SSH_MSG_DISCONNECT = ssh.MESSAGE.SSH_MSG_DISCONNECT;
const SSH_MESSAGE_ERROR = ssh.MESSAGE.ERROR;

describe('terminal-proxy ssh packet MAC', function () {
  const cipherKey = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const macKey = crypto.randomBytes(32);
  const SEQUENCE_NUMBER = 3;

  before(function () {
    ssh.setLogger({ log() {}, debug() {}, info() {}, warn() {}, severe() {} });
  });

  function sizedData(value) {
    const data = Buffer.from(value);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, data]);
  }

  // An SSH_MSG_DISCONNECT packet from the server, encrypted with aes128-ctr and authenticated with hmac-sha2-256
  function serverPacket(sequenceNumber) {
    const reason = Buffer.alloc(4);
    reason.writeUInt32BE(11);
    const payload = Buffer.concat([Buffer.from([SSH_MSG_DISCONNECT]), reason, sizedData('bye'), sizedData('')]);
    let paddingLength = 16 - ((payload.length + 5) % 16);
    if (paddingLength < 4) {
      paddingLength += 16;
    }
    const packet = Buffer.alloc(payload.length + paddingLength + 5);
    packet.writeUInt32BE(payload.length + paddingLength + 1, 0);
    packet.writeUInt8(paddingLength, 4);
    payload.copy(packet, 5);
    const seq = Buffer.alloc(4);
    seq.writeUInt32BE(sequenceNumber);
    const mac = crypto.createHmac('sha256', macKey).update(seq).update(packet).digest();
    const encrypted = crypto.createCipheriv('aes-128-ctr', cipherKey, iv).update(packet);
    return Buffer.concat([encrypted, mac]);
  }

  function makeProxy() {
    return {
      clientIP: '127.0.0.1',
      netSend() {},
      sshSessionData: {
        channels: {},
        highestChannel: 0,
        primaryShellChannel: null,
        incompletePacketBuffer: null,
        isFirstBlockDecrypted: false,
        messagesReceived: SEQUENCE_NUMBER,
        readCipherBlockLength: 16,
        decryptCipher: crypto.createDecipheriv('aes-128-ctr', cipherKey, iv),
        readingMACAlgorithm: 'hmac-sha2-256',
        readingMACKey: macKey,
        readingMACLength: 32
      }
    };
  }

  const receive = (data) => ssh.processEncryptedData(makeProxy(), data);
  const types = (messages) => messages.map((message) => message.type);

  it('accepts a packet with a valid MAC', function () {
    assert.deepStrictEqual(types(receive(serverPacket(SEQUENCE_NUMBER))), [SSH_MSG_DISCONNECT]);
  });

  it('rejects a packet whose ciphertext was modified', function () {
    const data = serverPacket(SEQUENCE_NUMBER);
    data[20] ^= 0x01;
    assert.deepStrictEqual(types(receive(data)), [SSH_MESSAGE_ERROR]);
  });

  it('rejects a packet whose MAC was modified', function () {
    const data = serverPacket(SEQUENCE_NUMBER);
    data[data.length - 1] ^= 0x01;
    assert.deepStrictEqual(types(receive(data)), [SSH_MESSAGE_ERROR]);
  });

  it('rejects a packet authenticated for another sequence number', function () {
    assert.deepStrictEqual(types(receive(serverPacket(SEQUENCE_NUMBER + 1))), [SSH_MESSAGE_ERROR]);
  });
});
