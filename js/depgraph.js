"use strict";

const semver = require('semver');

module.exports = DependencyGraph;

const logger = {
  debug() {
    
  }
}
/**
 * Checks if all plugin dependencies are met, including versions.
 * Sorts the plugins so that they can be installed in that order.
 */
function DependencyGraph() {
  this.pluginsById = {};
}

DependencyGraph.prototype = {
  constructor: DependencyGraph,
  
  pluginsById: null,
  
  addPlugin(plugin) {
    logger.debug(`Adding plugin ${plugin.identifier}`);
    this.pluginsById[plugin.identifier] = plugin;
  },
  
  /**
   * "n -> m" means "m depends on n". Note that this is the opposite of an import. 
   * 
   * This is the graph of the plugins' desires based on imports in the defs:
   * if there's an edge "n -> m" here then we know that plugin m actually 
   * exists, but n might either exist or just be m's dream.
   */
  _buildGraph() {
    const g = {};
    for (const plugin of Object.values(this.pluginsById)) {
      logger.debug("processing plugin ", plugin, "\n")
      const importerId = plugin.identifier;
      if (!(plugin.dataServicesGrouped && plugin.dataServicesGrouped.import 
          && plugin.dataServicesGrouped.import.length)) {
        const notAnImporter = { 
          pluginId: importerId,
          deps: []
        };
        logger.debug('registering non-importer: ', importerId)
        g[importerId] = notAnImporter;
        continue;
      }
      for (const serviceImport of plugin.dataServicesGrouped.import) {
        const providerId = serviceImport.sourcePlugin;
        let providerNode = g[providerId];
        if (!providerNode) {
          providerNode = g[providerId] = { 
            pluginId: providerId,
            deps: []
          };
        }
        if (!g[importerId]) {
          g[importerId] = { 
            pluginId: importerId,
            deps: []
          };
        }
        const depNode = {
          provider: providerId,
          service: serviceImport.sourceName,
          importer: importerId,
          alias: serviceImport.localName,
          requiredVersionRange: serviceImport.version,
        };
        validateDep(depNode, this.pluginsById[providerId]);
        logger.debug('Found dependency: ', providerId, depNode)
        providerNode.deps.push(Object.freeze(depNode));
        if (depNode.valid) {
          serviceImport.targetService = depNode.targetService;
        }
      }
    }
    return g;
  },
  
  /**
   * Produces a topologically sorted array of plugins. Separates all invalid 
   * imports into a separate object.
   * 
   * If there's an edge "n -> m" and it turns out to be invalid for some reason
   * (plugin/service n doesn't exist, wrong version) then m and the entire subgraph 
   * reachable from m needs to be removed. It's not only m's wish that cannot
   * be fulfilled, but also everyone who depends on m cannot be properly 
   * instantiated.
   * 
   * Note that the sorted list returned can contain "dream" plugins - those that 
   * were required but don't exist. The caller needs to filter them out (the
   * importers will of course be correctly rejected)
   * 
   */
  _traverse(graph) {
    logger.debug('graph: ', graph)
    const rejects = {};
    const pluginsSorted = [];
    const importedPlugins = Object.values(graph);
    for (let importedPlugin of importedPlugins) {
      visit(importedPlugin, true);
    }
    function visit(pluginNode, prefixValid, validationError) {
      logger.debug('visiting node ', pluginNode, ', prefixValid: ', prefixValid)
      const invalidating = pluginNode.valid && !prefixValid;
      if (pluginNode.visited && !invalidating) {
        return;
      } 
      if (pluginNode.visiting) {
        //TODO deal with a cyclic dependency. Not really clear what to do,
        //perhaps, reject the entire cycle but leave the unaffected nodes there.
        //Implementing a cycle detection algorithm is a different story.
        //TODO good diagnostics
        throw new Error("cyclic dependency: " + pluginNode.pluginId);
      }
      pluginNode.valid = prefixValid;
      pluginNode.validationError = validationError;
      pluginNode.visiting = true;
      for (const dep of pluginNode.deps) {
        const importer = graph[dep.importer];
        logger.debug("following link: ", dep)
        const linkValid = pluginNode.valid && dep.valid;
        logger.debug("linkValid: ", linkValid)
        let error;
        if (!dep.valid) {
          error = dep.validationError;
        } else if (!pluginNode.valid) {
          error = dep.validationError;
          error = {
            status: "REQUIRED_PLUGIN_FAILED_TO_LOAD",
            pluginId: dep.provider
          }
        }
        visit(importer, linkValid, error);
      }
      pluginNode.visiting = false;
      pluginNode.visited = true;
      if (pluginNode.valid) {
        pluginsSorted.unshift(pluginNode);
      } else {
        /**
         * TODO good diagnostics: what service is missing, etc
         */
        logger.debug('Rejecting ', pluginNode);
        rejects[pluginNode.pluginId] = pluginNode;
      }
    } 
    return {
      pluginsSorted,
      rejects
    }
  },
  
  processImports() {
    const listAndRejects = this._traverse(this._buildGraph());
    const pluginsSorted = [];
    const nonRejectedPlugins = {};
    for (const plugin of Object.values(this.pluginsById)) {
      if (!listAndRejects.rejects[plugin.identifier]) {
        nonRejectedPlugins[plugin.identifier] = plugin;
      }
    }
    for (const node of listAndRejects.pluginsSorted) {
      const plugin = nonRejectedPlugins[node.pluginId];
      if (plugin) {
        pluginsSorted.push(plugin);
      }
      delete nonRejectedPlugins[node.pluginId];
    }
    logger.debug("*** pluginsSorted: ", pluginsSorted)
    logger.debug("*** rejects: ", listAndRejects.rejects)
    return {
      plugins: pluginsSorted,
      rejects: Object.values(listAndRejects.rejects)
    }
  }
}

/**
 * Checks if the provider plugin (1) exists (2) contains a service that could
 * satisfy the import
 */
function validateDep(dep, providerPlugin) {
  let valid = false;
  let validationError;
  
  if (!providerPlugin) {
    valid = false;
    validationError = {
      status: "REQUIRED_PLUGIN_NOT_FOUND",
      pluginId: dep.provider
    }
  } else {
    let found = false;
    let foundAtDifferentVersion = false;
    for (const service of providerPlugin.dataServices) {
      if (service.name == dep.service) {
        if (service.type === "import") {
          validationError = {
            status: "IMPORTED_SERVICE_IS_AN_IMPORT",
            pluginId: providerPlugin.identifier,
            serviceName: service.name
          }
          found = true;
          break;
        } else if (!semver.satisfies(service.version, dep.requiredVersionRange)) {
          foundAtDifferentVersion = true;
        } else {
          valid = true;
          found = true;
          dep.targetService = service;
          break;
        }
      }
    }
    if (!found) {
      if (foundAtDifferentVersion) {
        validationError = {
          status: "REQUIRED_SERVICE_VERSION_MISMATCH",
          pluginId: providerPlugin.identifier,
          requiredVersion: dep.requiredVersionRange
        }
      } else {
        validationError = {
          status: "REQUIRED_SERVICE_NOT_FOUND",
          pluginId: providerPlugin.identifier,
        }
      }
    }
  }
  dep.valid = valid;
  dep.validationError = validationError;
  logger.debug('dep.valid: ', dep.valid)
}
