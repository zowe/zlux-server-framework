
/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/

'use strict';

const zluxUtil = require('./util');
const bootstrapLogger = zluxUtil.loggers.bootstrapLogger;

// **************************************************************************************************************************************************
// Set up JSON Schema using ajv library

const Ajv = require('ajv')
const ajv = new Ajv({ allErrors: true, jsonPointers: true, verbose: true, $data: true })
require('ajv-errors')(ajv)

const semverRegex = "^[0-9]+\.[0-9]+\.[0-9]+(-.+)?$"

// **************************************************************************************************************************************************
// A JSON Schema that defines the fields of web content
const webContentSchema = Object.freeze({
    $schema: "http://json-schema.org/schema#",
    type: "object",
    if: {
        properties: {
            framework: {
                const: "iframe"
            }
        }
    },
    then: {
        required: ["startingPage"]
    },
    properties: {
        framework: {
            type: "string",
            enum: ["angular2", "react", "iframe"],
            errorMessage: {
                type: "must be a string",
                enum: "Valid values for framework are angular2, react, and iframe",
            }
        },
        launchDefinition: {
            type: "object",
            errorMessage: {
                type: "must be an object"
            },
            properties: {
                pluginShortNameKey: {
                    type: "string",
                    errorMessage: {
                        type: "must be a string"
                    }
                },
                pluginShortNameDefault: {
                    type: "string",
                    errorMessage: {
                        type: "must be a string"
                    }
                },
                imageSrc: {
                    type: "string",
                    errorMessage: {
                        type: "must be a string"
                    }
                }
            },
            required: ["pluginShortNameKey", "pluginShortNameDefault"]
        },
        startingPage: {
            type: "string",
            errorMessage: {
                type: "must be a string"
            }
        },
        descriptionDefault: {
            type: "string",
            errorMessage: {
                type: "must be a string"
            }
        },
        defaultWindowStyle: {
            type: "object",
            properties: {
                width: {
                    type: "integer",
                    errorMessage: {
                        type: "must be an integer"
                    }
                },
                height: {
                    type: "integer",
                    errorMessage: {
                        type: "must be an integer"
                    }
                },
                x: {
                    type: "integer",
                    errorMessage: {
                        type: "must be an integer"
                    }
                },
                y: {
                    type: "integer",
                    errorMessage: {
                        type: "must be an integer"
                    }
                }
            },
            errorMessage: {
                type: "must be an object"
            }
        }
    },
    errorMessage: {
        type: "must be an object"
    }
})

// **************************************************************************************************************************************************
// A JSON Schema that defines the fields of a plugin definition. Uses the web content schema defined above

const pluginDefinitionSchema = Object.freeze({
    $schema: "http://json-schema.org/schema#",
    type: "object",
    if: {
        properties: {
            pluginType: {
                const: "library"
            }
        }
    },
    then: {
        required: ["libraryName", "libraryVersion"]
    },
    else: {
        if: {
            properties: {
                pluginType: {
                    const: "nodeAuthentication"
                }
            }
        },
        then: {
            required: ["authenticationCategory", "filename"]
        },
        else: {
            if: {
                properties: {
                    pluginType: {
                        const: "desktop"
                    }
                }
            },
            then: {
                properties: {
                    webContent: {
                        if: {
                            additionalProperties: false //Checks if the webcontent is empty
                        },
                        then: {},
                        else: {
                            webContentSchema,
                            required: ["framework"]
                        }
                    }
                }
            },
            else: {
                properties: {
                    webContent: {
                        if: {
                            additionalProperties: false //Checks if the webcontent is empty
                        },
                        then: {},
                        else: {
                            webContentSchema,
                            required: ["framework", "launchDefinition", "descriptionKey", "descriptionDefault", "defaultWindowStyle"]
                        }
                    }
                }
            }
        }
    },
    properties: {
        pluginType: {
            type: "string",
            enum: ["application", "bootstrap", "desktop", "library", "nodeAuthentication", "windowManager"],
            errorMessage: {
                type: "must be a string",
                enum: "must be one of the following values: \n  application\n  bootstrap\n  desktop\n  library\n  nodeAuthentication\n  windowManager"
            }
        },
        identifier: {
            type: "string",
            errorMessage: {
                type: "must be a string"
            }
        },
        pluginVersion: {
            type: "string",
            pattern: semverRegex,
            errorMessage: {
                type: "must be a string",
                pattern: "must follow semantic versioning spec (x.y.z-anything)"
            }
        },
        apiVersion: {
            type: "string",
            pattern: semverRegex,
            errorMessage: {
                type: "must be a string",
                pattern: "must follow semantic versioning spec (x.y.z-anything)"
            }
        },
        configurationData: {
            type: "object",
            properties: {
                resources: {
                    type: "object",
                    errorMessage: {
                        type: "must be an object"
                    }
                },
            },
            required: ["resources"],
            errorMessage: {
                required: "is required for configurationData in plugin",
            }
        },
        dataServices: {
            type: "array",
            if: {
                maxItems: 0
            },
            then: {},
            else: {
                items: {
                    type: "object",
                    if: {
                        properties: {
                            type: {
                                const: "router"
                            }
                        }
                    },
                    then: {
                        required: ["name", "initializerLookupMethod", "filename", "dependenciesIncluded"]
                    },
                    else: {
                        if: {
                            properties: {
                                type: {
                                    const: "service"
                                }
                            }
                        },
                        then: {
                            required: ["name", "initializerLookupMethod", "initializerName", "methods"]
                        },
                        else: {
                            if: {
                                properties: {
                                    type: {
                                        const: "import"
                                    }
                                }
                            },
                            then: {
                                required: ["sourcePlugin", "sourceName", "localName"]
                            },
                            else: {
                                if: {
                                    properties: {
                                        type: {
                                            const: "external"
                                        }
                                    }
                                },
                                then: {
                                    required: ["name", "urlPrefix", "isHttps"]
                                }
                            }
                        }
                    },
                    properties: {
                        type: {
                            type: "string",
                            enum: ["import", "external", "service", "router"],
                            errorMessage: {
                                type: "must be a string",
                                enum: "must be one of the following values: \n  import\n  external\n  service\n  router"
                            }
                        },
                        sourcePlugin: {
                            type: "string",
                            errorMessage: {
                                type: "must be a string"
                            }
                        },
                        sourceName: {
                            type: "string",
                            errorMessage: {
                                type: "must be a string"
                            }
                        },
                        localName: {
                            type: "string",
                            errorMessage: {
                                type: "must be a string"
                            }
                        },
                        name: {
                            type: "string",
                            errorMessage: {
                                type: "must be a string"
                            }
                        },
                        urlPrefix: {
                            type: "string",
                            errorMessage: {
                                type: "must be a string"
                            }
                        },
                        isHttps: {
                            type: "boolean",
                            errorMessage: {
                                type: "must be a boolean"
                            }
                        },
                        initializerLookupMethod: {
                            type: "string",
                            enum: ["internal", "external"],
                            errorMessage: {
                                type: "must be a string",
                                enum: "must be one of the following values:\n  internal\n  external"
                            }
                        },
                        initializerName: {
                            type: "string",
                            errorMessage: {
                                type: "must be a string"
                            }
                        },
                        methods: {
                            type: "array",
                            errorMessage: {
                                type: "must be an array"
                            }
                        },
                        filename: {
                            type: "string",
                            errorMessage: {
                                type: "must be a string"
                            }
                        },
                        routerFactory: {
                            type: "string",
                            errorMessage: {
                                type: "must be a string"
                            }
                        },
                        dependenciesIncluded: {
                            type: "boolean",
                            errorMessage: {
                                type: "must be a boolean"
                            }
                        },
                    },
                    required: ["type"],
                    errorMessage: {
                        type: "must be an object",
                        required: "is required in non-empty data service"
                    }
                }
            },
            errorMessage: {
                type: "must be an array"
            }
        },
        libraryName: {
            type: "string",
            errorMessage: "must be a string"
        },
        libraryVersion: {
            type: "string",
            pattern: semverRegex,
            errorMessage: {
                type: "must be a string",
                pattern: "must follow semantic versioning spec (x.y.z-anything)"
            }
        },
        authenticationCategory: {
            type: "string",
            errorMessage: {
                type: "must be a string"
            }
        },
        filename: {
            type: "string",
            errorMessage: {
                type: "must be a string"
            }
        }
    },
    required: ["pluginType", "identifier", "pluginVersion", "apiVersion"],
    errorMessage: {
        type: "must be an object",
        required: "is required in pluginDefinition.json"
    }
})

// **************************************************************************************************************************************************
// Validates the plugin definition based on the json schema defined above
// Uses custom error messages in conjunction with the error messages defined in the schema

module.exports.validatePluginDef = function validatePluginDef(pluginDef) {
    const validate = ajv.compile(pluginDefinitionSchema)

    const valid = validate(pluginDef)
    if (!valid) {
        var errorMessage = "Unknown Error Occured";  // Default error message
        if (validate.errors.length > 0) {
            var failedField = ""
            if (validate.errors[0].params.errors) {
                failedField = searchErrors(validate.errors[0].params.errors[0], "keyword")
            }
            else {
                failedField = searchErrors(validate.errors[0], "keyword")
            }
            var message = searchErrors(validate.errors[0], "message")
            const failedData = searchErrors(validate.errors[0], "data")
            var key = replaceSlashes(searchErrors(validate.errors[0], "dataPath"))
            switch (failedField) {
                case "type":
                    errorMessage = `Key "${key}" of value ${JSON.stringify(failedData)} ${message}, is ${typeof (failedData)}`
                    break;
                case "enum":
                    errorMessage = `Key "${key}" is ${failedData}, ${message}`
                    break;
                case "pattern":
                    errorMessage = `Key "${key}" ${message}, is ${failedData}`
                    break;
                case "required":
                    if (validate.errors[0].params.errors) {
                        message = searchErrors(validate.errors[0].params.errors[0], "message")
                    }
                    if (key === "") {
                        key = "Plugin Definition"
                    }
                    errorMessage = `${key} ${message}`
                    break;
            }
        }
        else {
            errorMessage = JSON.stringify(validate.errors)
        }
        throw new Error(errorMessage);
        //TODO: Check for warnings and dont throw errors just log the warning (i.e. semantic versioning)
    }
    else {
        bootstrapLogger.info("Plugin Definition Validated")
    }
}


// **************************************************************************************************************************************************
// Replaces slashes with dot, and removes the first slash

function replaceSlashes(string) {
    var finalString = ""
    const splitString = string.split("/")
    for (var s in splitString) {
        if (splitString[s] !== "") {
            if (finalString === "") {
                finalString = splitString[s]
            }
            else if (/^\d+$/.test(splitString[s])) {
                finalString = finalString + "[" + splitString[s] + "]"
            }
            else {
                finalString = finalString + "." + splitString[s]
            }
        }
    }
    return finalString
};

// **************************************************************************************************************************************************
// Cycles through layers of validate JSON until a the input property field is found

function searchErrors(obj, search) {
    if (!obj.hasOwnProperty(search)) {
        if (obj.params.errors) {
            return searchErrors(obj.params.errors[0], search)
        }
    }
    else {
        return obj[search]
    }
}


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html
  
  SPDX-License-Identifier: EPL-2.0
  
  Copyright Contributors to the Zowe Project.
*/
