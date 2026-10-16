/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

import * as crypto from 'node:crypto';

export function encryptWithKeyAndIV(text,key,iv) {
  var cipher = crypto.createCipheriv('AES-256-CBC',key,iv);
  var encrypted = cipher.update(text,'utf8','hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

export function decryptWithKeyAndIV(text,key,iv) {
  var cipher = crypto.createDecipheriv('AES-256-CBC',key,iv);
  var decrypted = cipher.update(text,'hex','utf8');
  decrypted += cipher.final('utf8');
  return decrypted;
}
