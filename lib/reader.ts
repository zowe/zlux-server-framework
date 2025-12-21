

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

import * as BBPromise from 'bluebird';
import * as readline from 'node:readline';

class Reader {
  readlineReader: readline.Interface;
  
  constructor() {
    this.readlineReader = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  
  readPassword(question) {
    return new BBPromise((resolve, reject) => {
      const stdin = process.openStdin();
      stdin.on('data', function(c) {
        c+='';
        switch (c) {
        case '\n':
        case '\r':
          stdin.pause();
          break;
        default:
          process.stdout.write('\b*');
        }
      });
      this.readlineReader.question(question, (answer) => {
        resolve(answer);
        //do not retain the history of the password for future questions
        (this.readlineReader as any).history = (this.readlineReader as any).history.slice(1); 
      });
    })
  }

  close() {
    this.readlineReader.close();
  }
};

export = Reader;


var _unitTest = false;
if (_unitTest) {

  var unitTest = BBPromise.coroutine(function* (app) {
    let password;
    const r1 = new Reader();
    try {
      password = yield r1.readPassword("Enter password (should not be displayed): ");
      console.log("password is: ", password);
    } finally {
      r1.close();
    }
    const r2 = new Reader();
    try {
      password = yield r2.readPassword("One more time: ");
      console.log("password is: ", password);
    } finally {
      r2.close();
    }
  });
  unitTest();
};



/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

