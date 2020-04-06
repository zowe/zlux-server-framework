const WebSocket = require('ws');
const https = require('https');
const axios = require('axios');
const argParser = require('../../../utils/argumentParser');
const args = [
  new argParser.CLIArgument('host', 'h', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('port', 'o', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('user', 'u', argParser.constants.ARG_TYPE_VALUE),
  new argParser.CLIArgument('pass', 'p', argParser.constants.ARG_TYPE_VALUE)
]
const commandArgs = process.argv.slice(2);
const argumentParser = argParser.createParser(args);
const userInput = argumentParser.parse(commandArgs);

if (!userInput.user || !userInput.pass || !userInput.port || !userInput.host) {
  console.warn(`Usage: node ${__filename} -u user -p pass -h host -o port`);
} else {
  const url = `wss://${userInput.host}:${userInput.port}/ZLUX/plugins/org.zowe.terminal.tn3270/services/terminalstream/_current/`;

  console.log('Getting cookie');
  axios.request({method: 'post',
                 httpsAgent: new https.Agent({rejectUnauthorized: false}),
                 url:`https://${userInput.host}:${userInput.port}/auth`,
                 data: {username: userInput.user, password: userInput.pass}})
    .then(function(response) {    
      let cookieKey;
      let cookieVal;
      if (response.headers['set-cookie']) {
        let cookie = response.headers['set-cookie'][0].split('=');
        cookieKey = cookie[0];
        let semi = cookie[1].indexOf(';');
        cookieVal = cookie[1].substr(0,semi != -1 ? semi : undefined);
        console.log(`${cookieKey}=${cookieVal}`);
      } else {
        console.warn('No cookie found from app-server');
        process.exit(1);
      }
 
      console.log('Connecting to '+url);
      let ws0 = new WebSocket(url, undefined, {
        perMessageDeflate: false,
        rejectUnauthorized: false,
        headers: {Cookie: `${cookieKey}=${cookieVal}`}
      });

      ws0.on('open',function open() {
        console.log(`Uncompressed ws open succeeded. State=${ws0.readyState}. Protocol=`+ws0.protocol);
        setTimeout(function() {
          ws0.send(JSON.stringify({t:'CONFIG', msg: 'Uncompressed response'}));
          console.log('Uncompressed sent response');
        },1000);
      });

      ws0.on('unexpected-response', function error(e) {
        console.warn('Uncompressed unexpected res=',e.response);
        process.exit(1);
      });

      ws0.on('error', function error(e) {
        console.warn('Uncompressed ws failed, e=',e);
        process.exit(1);
      });

      ws0.on('close', function error(code, reason) {
        console.warn(`Uncompressed ws closed. Code=${code}. Reason=${reason}`);
      });

      ws0.on('message', function message(data) {
        console.log('Uncompressed response recieved. data=',data);
      });

      //wait a moment
      setTimeout(function() {
        let ws1 = new WebSocket(url, undefined, {
          perMessageDeflate: true,
          rejectUnauthorized: false,
          headers: {Cookie: `${cookieKey}=${cookieVal}`}
        });

        ws1.on('open',function open() {
          console.log(`Compressed ws open succeeded. State=${ws0.readyState}. Protocol=`+ws0.protocol);
          setTimeout(function() {
            ws1.send(JSON.stringify({t:'CONFIG', msg:'Compressed response'}));
            console.log('Compressed sent response');
          },1000);
        });

        ws1.on('unexpected-response', function error(e) {
          console.warn('Compressed unexpected res=',e.response);
          process.exit(1);
        });
        
        ws1.on('error', function error(e) {
          console.warn('Compressed ws failed, e=',e);
          process.exit(1);
        });

        ws1.on('close', function error(code, reason) {
          console.warn(`Compressed ws closed. Code=${code}. Reason=${reason}`);
        });

        ws1.on('message', function message(data) {
          console.log('Compressed response recieved. data=',data);
        });
      },2000);

      //wait another moment
      setTimeout(function() {
        console.log('Sending mystery message');

        const req = https.request(url.replace('wss:','https:'),{
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version': 13,
            headers: {Cookie: `${cookieKey}=${cookieVal}`}
          },
          rejectUnauthorized: false
        });

        req.end(Buffer.from([0xC1, 0x05, 0x5f, 0xeb, 0xe5, 0xf0, 0x1c]));
        setTimeout(function() {
          process.exit(0);
        }, 1000);

      },5000);
    });
}

