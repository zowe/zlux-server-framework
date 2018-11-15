

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

const readline = require('readline');
const readlineSync = require('readline-sync');

function Reader() {
  this.readlineReader = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}
Reader.prototype = {
  constructor: Reader,
  readlineReader: null,

  readPassword(question) {
    return new Promise((resolve, reject) => {
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
        this.readlineReader.history = this.readlineReader.history.slice(1); 
      });
    })
  },

  close() {
    this.readlineReader.close();
  }, 

  readPasswordSync (question) {
    let passPhrase = readlineSync.question(question, {hideEchoBack: true, caseSensitive: true, print: function(display, encoding)
      { process.stdout.write("Passphrase received...\n", encoding); }} );
    return passPhrase
  }
};


module.exports = Reader;


_unitTest = false;
if (_unitTest) {
  const Promise = require('bluebird');
  unitTest = Promise.coroutine(function* (app) {
    let password;
    const r1 = makeReader();
    try {
      password = yield r1.readPassword("Enter password (should not be displayed): ");
      console.log("password is: ", password);
    } finally {
      r1.close();
    }
    const r2 = makeReader();
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

