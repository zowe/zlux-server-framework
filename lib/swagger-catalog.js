
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/


const express = require('express');
const zLuxUrl = require('./url')
const path = require('path');
const fs = require('fs');
const jsyaml = require('js-yaml');
const swaggerParser = require('swagger-parser')
const os = require('os');
const zluxUtil = require('./util');

var installLog = zluxUtil.loggers.installLogger;

function getServiceSummary(service) {
  switch (service.type) {
  case "router":
  case "nodeService":
    return `${service.name} node service`
  case "import":
    return `import ${service.sourceName} from ${service.sourcePlugin}`;
  default:
    return `${service.name} data service`
  }
}

function makeCatalogForPlugin(plugin, productCode, nodeContext) {
  return new Promise((resolve) => {
    const openApi = {
      openapi: "3.0.0",
      info: {
        title:  plugin.identifier,
        description: plugin.descriptionDefault,
        version: plugin.version || "0.0.1"
      },
      basePath: zLuxUrl.makePluginURL(productCode, plugin.identifier) + "/services",
      host: os.hostname(),
      schemes: getSchemesFromContext(nodeContext),
      paths: {}
    };
    getSwaggerDocs(plugin, productCode, nodeContext).then((swaggerDocs) => {
      if (swaggerDocs.length > 0) {
        // if there are swagger docs that were read create the paths from those 
        swaggerDocs.forEach((service) => {
          var tempPaths = service.serviceDoc.paths;
          var tempVersion = service.serviceDoc.info.version;
          for (key in tempPaths) {
            openApi.paths["/" + service.serviceName + "/" + tempVersion + key] = tempPaths[key];
          }
        });
      } else {
        // if there are no swagger docs that were read use this placeholder setup
        for (const service of plugin.dataServices || []) {
          //FIXME templates with an asterisk are not supported by open api
          //TODO we can actually somewhat inspect Express routers
          openApi.paths[zLuxUrl.makeServiceSubURL(service) + '/*'] = {
            summary: getServiceSummary(service),
            get: {
              responses: {
                200: {
                  description: "service call succeeded"
                }
              }
            },
            post: {
              responses: {
                200: {
                  description: "service call succeeded"
                }
              }
            },
            put: {
              responses: {
                200: {
                  description: "service call succeeded"
                }
              }
            },
            delete: {
              responses: {
                200: {
                  description: "service call succeeded"
                }
              }
            }
          };
        }
      }
      // pass everything back at once the plugin catalog with all services together
      // swaggerdocs is the list of all the docs for each service
      var allDocumentation = {
        pluginCatalog: openApi,
        serviceDocs: swaggerDocs
      }
      resolve(allDocumentation)
    });
  })
}

async function getSwaggerDocs(plugin, productCode, nodeContext) {
  var allServiceDocs = [];
  if (plugin.dataServices){
    for (let i = 0; i < plugin.dataServices.length; i++) {
      let service = plugin.dataServices[i]
      if (service.swaggerdoc) {
        let fileContent = await readSingleSwaggerFile(path.join(plugin.location, "doc/swagger"), service.swaggerdoc)
          .catch((err) => {
            installLog.warn('Invalid Swagger from file ' + service.swaggerdoc)
            installLog.warn(err);
          })
        if (fileContent) {
          fileContent = overwriteSwaggerFieldsForServer(fileContent, 
            zLuxUrl.makePluginURL(productCode, plugin.identifier), nodeContext);
          allServiceDocs.push({
            "serviceName" : service.name,
            "serviceDoc" : fileContent
          })
        }
      }
    }
  }
  return allServiceDocs;
}

function readSingleSwaggerFile (dirName, fileName) {
  // read one swagger file and validate the json that is returned
  return new Promise ((resolve, reject) => {
    let fileContent = fs.readFileSync(path.join(dirName, fileName), 'utf-8');
    let swaggerJson = jsyaml.safeLoad(fileContent);
    swaggerParser.validate(swaggerJson).then(function(valid) {
      resolve(swaggerJson)
    }).catch(function(err) {
      reject(err.message)
    });
  });
}

function overwriteSwaggerFieldsForServer (swaggerJson, urlBase, serverContext) {
  // overwrite swagger fields with more accurate info from server and config
  swaggerJson.basePath = urlBase + "/services" + swaggerJson.basePath + "/" + swaggerJson.info.version;
  swaggerJson.schemes = getSchemesFromContext(serverContext);
  swaggerJson.host = os.hostname();
  return swaggerJson;
}

function getSchemesFromContext (nodeContext) {
  let schemes = [];
  if (nodeContext.http) {
    schemes.push("http");
  }
  if (nodeContext.https) {
    schemes.push("https");
  }
  return schemes;
}

module.exports = makeCatalogForPlugin;

/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
