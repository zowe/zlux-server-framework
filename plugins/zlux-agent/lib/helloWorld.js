"use strict";
exports.__esModule = true;
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
var express = require('express');
var Promise = require('bluebird');
var obfuscator = require('zlux-shared/src/obfuscator/htmlObfuscator.js');
var HelloWorldDataservice = /** @class */ (function () {
    function HelloWorldDataservice(context) {
        var htmlObfuscator = new obfuscator.HtmlObfuscator();
        this.context = context;
        var router = express.Router();
        router.use(function noteRequest(req, res, next) {
            context.logger.info('Saw request, method=' + req.method);
            next();
        });
        context.addBodyParseMiddleware(router);
        router.post('/', function (req, res) {
            var messageFromClient = req.body ? req.body.messageFromClient : "<No/Empty Message Received from Client>";
            var safeMessage = htmlObfuscator.findAndReplaceHTMLEntities(messageFromClient);
            var responseBody = {
                "_objectType": "org.zowe.zlux.sample.service.hello",
                "_metaDataVersion": "1.0.0",
                "requestBody": req.body,
                "requestURL": req.originalUrl,
                "serverResponse": "Router received\n        \n        '" + safeMessage + "'\n        \n        from client"
            };
            res.status(200).json(responseBody);
        });
        this.router = router;
    }
    HelloWorldDataservice.prototype.getRouter = function () {
        return this.router;
    };
    return HelloWorldDataservice;
}());
exports.helloWorldRouter = function (context) {
    return new Promise(function (resolve, reject) {
        var dataservice = new HelloWorldDataservice(context);
        resolve(dataservice.getRouter());
    });
};
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
//# sourceMappingURL=helloWorld.js.map