

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

/* json streamer is a stream-based port of json printer */
const JSON_STREAMER_OS = 'NotZ';
const JSON_MODE_NATIVE_CHARSET = 0;
const JSON_MODE_CONVERT_TO_UTF8 = 1;
const SOURCE_CODE_CHARSET = 'utf8'; //until it isnt


function JsonStreamer(stream) {
  //stream = fs.createWriteStream(foo), res.pipe(stream)
  //or, res.writeHead, stream=res, res.write, res.end
  this.stream = stream; 
  this.isEnd = false;
  this.depth = 0;
  this.isFirstLine = true;
  this.isStart = true;
  this.indentString = "  ";
  this.mode = JSON_MODE_NATIVE_CHARSET;
}

JsonStreamer.prototype.write = function(data) {
  if (this.stream) {
    this.stream.write(data);
  }
  else {
    console.log('ZWED0288I - Json streamer has no stream to write to');
  }
};

function jsonWriteBufferInternal(streamer, text, len) {
  var bytesWritten = 0;
  var loopCount = 0;
  var returnCode = 0;
  var reasonCode = 0;
  streamer.write(text);
}

function jsonPrintObject(streamer,jsonObject) {
  if (jsonObject) {
    var jsonString = JSON.stringify(jsonObject);
    streamer.write(jsonString.slice(1,jsonString.length-1));
  }
}


/*2 because it prints including brackets, which i believe COMMON could would not. */
function jsonPrintObject2(streamer,jsonObject,keyOrNull) {
  if (jsonObject) {
    if (streamer.isFirstLine) {
      streamer.isFirstLine = false;
    }
    else {
      jsonNewLine(streamer);
    }
    if (keyOrNull) {
      jsonWriteKeyAndSemicolon(streamer, keyOrNull);
    }
    streamer.write(JSON.stringify(jsonObject));
  }
}

function respondWithJsonStreamer(response) {
  //TODO some response setup? how do we do chunked encoding?
  //NOTE: expressjs automatically sets transfer encoding to chunked! at least when using res.write
  response.type('json');
  var jStreamer = new JsonStreamer(response);
  return jStreamer;
}

function jsonWriteEscapedString(streamer, s, len) {
  var i = 0;
  var specialCharCount = 0;
  for (i = 0; i < len; i++) {
    var c = s.charAt(i);
    if (c == '"' || c == '\\' || c == '\n' || c == '\r') {
      specialCharCount++;
    }
  }
  if (specialCharCount > 0) {
    var pos = 0;
    var escapedSize = len + specialCharCount;
    var escaped = [];
    for (i = 0; i < len; i++) {
      var c = s.charAt(i);
      if (c == '\n') {
        escaped.push('\\');
        escaped.push('n');
      } else if (c == '\r') {
        escaped.push('\\');
        escaped.push('r');
      } else {
        if (c == '"' || c == '\\') {
          escaped.push('\\');
        }
        escaped.push(c);
      }
    }
    var escapedString = escaped.join('');
    jsonWriteBufferInternal(streamer, escapedString, escapedSize);
  } else {
    jsonWriteBufferInternal(streamer, s, len);
  }
}


function jsonWriteQuotedString(streamer, s) {
  jsonWrite(streamer, "\"", false, SOURCE_CODE_CHARSET);
  jsonWrite(streamer, s, true, streamer.inputCCSID);
  jsonWrite(streamer, "\"", false, SOURCE_CODE_CHARSET);
}

function jsonWriteQuotedUnterminatedString(streamer, s, len) {
  jsonWrite(streamer, "\"", false, SOURCE_CODE_CHARSET);
  jsonConvertAndWriteBuffer(streamer, s, len, true, streamer.inputCCSID);
  jsonWrite(streamer, "\"", false, SOURCE_CODE_CHARSET);
}


function jsonWriteKeyAndSemicolon(streamer, key) {
  if (key) {
    jsonWriteQuotedString(streamer, key);
    if (streamer.prettyPrint) {
      jsonWrite(streamer, ": ", false, SOURCE_CODE_CHARSET);
    } else {
      jsonWrite(streamer, ":", false, SOURCE_CODE_CHARSET);
    }
  }
}


function jsonConvertAndWriteBuffer(streamer, text, len, escape, inputCCSID) {
  if (escape) {
    jsonWriteEscapedString(streamer, text, len);
  } else {
    jsonWriteBufferInternal(streamer, text, len);
  }
}

function jsonStartObject(streamer, keyOrNull) {
  if (streamer.isFirstLine) {
    streamer.isFirstLine = false;
  } else {
    jsonNewLine(streamer);
  }
  jsonWriteKeyAndSemicolon(streamer, keyOrNull);
  jsonWrite(streamer, "{", false, SOURCE_CODE_CHARSET);
  streamer.depth++;
  streamer.isStart = true;
  streamer.isEnd = false;
}

function jsonEndObject(streamer) {
  streamer.depth--;
  streamer.isStart = false;
  streamer.isEnd = true;
  jsonNewLine(streamer);
  jsonWrite(streamer, "}", false, SOURCE_CODE_CHARSET);
}

function jsonStartArray(streamer, keyOrNull) {
  if (streamer.isFirstLine) {
    streamer.isFirstLine = false;
  } else {
    jsonNewLine(streamer);
  }
  jsonWriteKeyAndSemicolon(streamer, keyOrNull);
  jsonWrite(streamer, "[", false, SOURCE_CODE_CHARSET);
  streamer.depth++;
  streamer.isStart = true;
  streamer.isEnd = false;
}

function jsonEndArray(streamer) {
  streamer.depth--;
  streamer.isStart = false;
  streamer.isEnd = true;
  jsonNewLine(streamer);
  jsonWrite(streamer, "]", false, SOURCE_CODE_CHARSET);
}

function jsonWrite(streamer, text, escape, inputCCSID) {
  jsonConvertAndWriteBuffer(streamer, text, text.length, escape, inputCCSID);
}

function jsonEnd(streamer) {
  jsonEndObject(streamer);
}

function jsonWriteInt(streamer, value) {
  jsonWrite(streamer, ''+value, false, SOURCE_CODE_CHARSET);
}

function jsonAddInt(streamer, value, keyOrNull) {
  if (streamer.isFirstLine) {
    streamer.isFirstLine = false;
  }
  else {
    jsonNewLine(streamer);
  }  
  jsonWriteKeyAndSemicolon(streamer,keyOrNull);
  jsonWrite(streamer, ''+value, false, SOURCE_CODE_CHARSET);
}

function jsonWriteInt64(streamer, value) {
  jsonWrite(streamer, ''+value, false, SOURCE_CODE_CHARSET);
}

function jsonWriteBoolean(streamer, value) {
  jsonWrite(streamer, ''+value, false, SOURCE_CODE_CHARSET);
}

function jsonWriteNull(streamer) {
  jsonWrite(streamer, "null", false, SOURCE_CODE_CHARSET);
}

function jsonIndent(streamer) {
  var depth = streamer.depth;
  while (depth > 0) {
    jsonWrite(streamer, streamer.indentString, false, SOURCE_CODE_CHARSET);
    depth--;
  }
}

function jsonNewLine(streamer) {
  if (streamer.isEnd) {
    streamer.isEnd = false;
  } else if (streamer.isStart) {
    streamer.isStart = false;
  } else {
    jsonWrite(streamer, ",", false, SOURCE_CODE_CHARSET);
  }
  if (streamer.prettyPrint) {
    jsonWrite(streamer, "\n", false, SOURCE_CODE_CHARSET);
    jsonIndent(streamer);
  }
}

function jsonStart(streamer) {
  jsonStartObject(streamer, null);
}

function jsonAddString(streamer, keyOrNull, value) {
  if (streamer.isFirstLine) {
    streamer.isFirstLine = false;
  } else {
    jsonNewLine(streamer);
  }
  jsonWriteKeyAndSemicolon(streamer, keyOrNull);
  jsonWriteQuotedString(streamer, value);
}


/* json streamer is a stream-based port of json printer */

exports.jsonStart = jsonStart;
exports.JsonStreamer = JsonStreamer;
exports.jsonEnd = jsonEnd;
exports.jsonPrintObject = jsonPrintObject;
exports.jsonPrintObject2 = jsonPrintObject2;
exports.respondWithJsonStreamer = respondWithJsonStreamer;
exports.jsonStartObject = jsonStartObject;
exports.jsonEndObject = jsonEndObject;
exports.jsonStartArray = jsonStartArray;
exports.jsonEndArray = jsonEndArray;
exports.jsonAddString = jsonAddString;
exports.jsonAddInt = jsonAddInt;


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

