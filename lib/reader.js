

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

const readline = require('readline');
var Prompt = require('prompt-password');
const readlineSync = require('readline-sync');
var Writable = require('stream').Writable;

var mutableStdout = new Writable({
  write: function(chunk, encoding, callback) {
    if (!this.muted)
      process.stdout.write(chunk, encoding);
    callback();
  }
});

mutableStdout.muted = false;
process.stdin.muted = true;

function Reader() {
  this.readlineReader = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });
}
Reader.prototype = {
  constructor: Reader,
  readlineReader: null,

  readPassword(question) {
    return new Promise((resolve, reject) => {

      var prompt = new Prompt({
        type: 'password',
        message: 'Enter your password please',
        name: 'password',
        mask: function(input) {
          return 'H' + new Array(String(input).length).join('H');
        }
      });
       
      prompt.run()
        .then(function(answers) {
          resolve(answers);
        });

        //process.stdin.resume();

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

