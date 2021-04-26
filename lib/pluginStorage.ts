import * as apimlStorage from './apimlStorage';


//suppress warning on missing definitions
declare var process: {
  clusterManager: any;
};

export enum StorageLocationType {
  Local = 0,
  Cluster = 1,
  HA = 2,
}


function getLocationType(apimlStorage) {
  if (apimlStorage) {
    return StorageLocationType.HA;
  } else if (process.clusterManager) {
    return StorageLocationType.Cluster;
  } else {
    return StorageLocationType.Local;
  }
}

export interface IPluginStorage {
  get(key: string, locationType?: StorageLocationType): Promise<any>;
  set(key: string, value: any, locationType?: StorageLocationType): Promise<void>;
  delete(key: string, locationType?: StorageLocationType): Promise<void>;
  getAll(locationType?: StorageLocationType): Promise<{ [key: string]: any }>;
  setAll(dict: { [key: string]: any }, locationType?: StorageLocationType): Promise<void>;
  deleteAll(locationType?: StorageLocationType): Promise<void>;

  getSync(key: string, locationType?: StorageLocationType): any;
  setSync(key: string, value: any, locationType?: StorageLocationType): void;
  deleteSync(key: string, locationType?: StorageLocationType): void;
  getAllSync(locationType?: StorageLocationType): { [key: string]: any };
  setAllSync(dict: { [key: string]: any }, locationType?: StorageLocationType): void;
  deleteAllSync(locationType?: StorageLocationType): void;
}

export interface IPluginSyncStorage {
  get(key: string, locationType?: StorageLocationType): any;
  set(key: string, value: any, locationType?: StorageLocationType): void;
  delete(key: string, locationType?: StorageLocationType): void;
  getAll(locationType?: StorageLocationType): { [key: string]: any };
  setAll(dict: { [key: string]: any }, locationType?: StorageLocationType): void;
  deleteAll(locationType?: StorageLocationType): void;

}

export interface ILocalStorage {
  get(key: string, pluginId?: string): any;
  set(key: string, value: any, pluginId?: string): void;
  delete(key: string, pluginId?: string): void;
  getAll(pluginId?: string): any;
  setAll(dict: { [key: string]: any }, pluginId?: string): void;
}

export interface IHAStorage {
  get(key: string, locationType?: StorageLocationType): Promise<any>;
  set(key: string, value: any, locationType?: StorageLocationType): Promise<void>;
  delete(key: string, locationType?: StorageLocationType): Promise<void>;
  getAll(locationType?: StorageLocationType): Promise<any>;
  setAll(dict: { [key: string]: any }, locationType?: StorageLocationType): Promise<void>;
  deleteAll(locationType?: StorageLocationType): Promise<void>;
}

export function PluginStorageSyncFactory(pluginId: string, logger): IPluginSyncStorage {
  const storage:any = PluginStorageFactory(pluginId, logger);
  storage.get = storage.getSync;
  storage.set = storage.setSync;
  storage.delete = storage.deleteSync;
  storage.getAll = storage.getAllSync;
  storage.setAll = storage.setAllSync;
  storage.deleteAll = storage.deleteAllSync;
  return (storage as IPluginSyncStorage);
}

export function PluginStorageFactory(pluginId: string, logger): IPluginStorage {

  const localStorage: ILocalStorage = LocalStorageFactory(pluginId);
  const haStorage = apimlStorage.isConfigured() ? apimlStorage.makeStorageForPlugin(pluginId) : undefined;

  if (process.clusterManager) { // Cluster mode
    process.clusterManager.getStorageAll(pluginId).then(() => {
      /* Then, once the cluster is done creating its own storage, we merge the local one
         with the cluster. This is useful for having storage capability even if clusterManager hasn't
         fully finished yet i. e. at startup, inside an app's constructor */
      process.clusterManager.mergeStorage(pluginId, localStorage.getAll(pluginId));
    });
  }

  return {
    get: (key: string, locationType?:StorageLocationType): Promise<any> => {
      return new Promise((resolve, reject)=> {
        if (locationType===undefined) {
          locationType = this.getDefaultLocationType();
        } else if ((typeof locationType != 'number') || locationType < 0 || locationType > 2) {
          return reject(logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType));
        }

        if (locationType == StorageLocationType.Local) {
          resolve(localStorage.get(key));
        } else if (locationType == StorageLocationType.Cluster || locationType == StorageLocationType.HA && !haStorage) {
          resolve(process.clusterManager.getStorageByKey(pluginId, key));
        } else if (locationType == StorageLocationType.HA) {
          return haStorage.get(key);
        } else {
          reject(logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType));
        }
      });
    },

    getSync: (key: string, locationType?:StorageLocationType): any => {
      if (locationType===undefined) {
        locationType = this.getDefaultLocationType();
      } else if ((typeof locationType != 'number') || locationType < 0 || locationType > 2) {
        return logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType);
      }
      if (StorageLocationType.HA) {
        return logger.warn(`Plugin ${pluginId} storage error, storage type HA is not supported in sync mode`);
      }

      if (locationType == StorageLocationType.Local) {
        return localStorage.get(key);
      } else if (locationType == StorageLocationType.Cluster || locationType == StorageLocationType.HA && !haStorage) {
        return process.clusterManager.getStorageByKey(pluginId, key);
      } else {
        return logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType);
      }
    },

    set: (key: string, value: any, locationType?:StorageLocationType): Promise<void> => {
      return new Promise((resolve, reject)=> {
        if (locationType===undefined) {
          locationType = this.getDefaultLocationType();
        } else if ((typeof locationType != 'number') || locationType < 0 || locationType > 2) {
          return reject(logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType));
        }

        if (locationType == StorageLocationType.Local) {
          resolve(localStorage.set(key, value));
        } else if (locationType == StorageLocationType.Cluster || locationType == StorageLocationType.HA && !haStorage) {
          resolve(process.clusterManager.setStorageByKey(pluginId, key, value));
        } else if (locationType == StorageLocationType.HA) {
          return haStorage.set(key, value);
        } else {
          reject(logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType));
        }
      });
    },
    
    setSync: (key: string, value: any, locationType?:StorageLocationType): void => {
      if (locationType===undefined) {
        locationType = this.getDefaultLocationType();
      } else if ((typeof locationType != 'number') || locationType < 0 || locationType > 2) {
        return logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType);
      }
      if (StorageLocationType.HA) {
        return logger.warn(`Plugin ${pluginId} storage error, storage type HA is not supported in sync mode`);
      }

      
      if (locationType == StorageLocationType.Local) {
        return localStorage.set(key, value);
      } else if (locationType == StorageLocationType.Cluster || locationType == StorageLocationType.HA && !haStorage) {
        return process.clusterManager.setStorageByKey(pluginId, key, value);
      } else {
        return logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType);
      }
    },
    
    delete: (key: string, locationType?:StorageLocationType): Promise<void> => {
      return new Promise((resolve, reject)=> {
        if (locationType===undefined) {
          locationType = this.getDefaultLocationType();
        } else if ((typeof locationType != 'number') || locationType < 0 || locationType > 2) {
          return reject(logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType));
        }

        if (locationType == StorageLocationType.Local) {
          resolve(localStorage.delete(key));
        } else if (locationType == StorageLocationType.Cluster || locationType == StorageLocationType.HA && !haStorage) {
          resolve(process.clusterManager.deleteStorageByKey(pluginId, key));
        } else if (locationType == StorageLocationType.HA) {
          return haStorage.delete(key);
        } else {
          reject(logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType));
        }
      });
    },

    deleteSync: (key: string, locationType?:StorageLocationType): void => {
      if (locationType===undefined) {
        locationType = this.getDefaultLocationType();
      } else if ((typeof locationType != 'number') || locationType < 0 || locationType > 2) {
        return logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType);
      }
      if (StorageLocationType.HA) {
        return logger.warn(`Plugin ${pluginId} storage error, storage type HA is not supported in sync mode`);
      }

      if (locationType == StorageLocationType.Local) {
        return localStorage.delete(key);
      } else if (locationType == StorageLocationType.Cluster) {
        return process.clusterManager.deleteStorageByKey(pluginId, key);
      } else {
        return logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType);
      }
    },
                         
    getAll: (locationType?:StorageLocationType): Promise<{ [key: string]: any }> => {
      return new Promise((resolve, reject)=> {
        if (locationType===undefined) {
          locationType = this.getDefaultLocationType();
        } else if ((typeof locationType != 'number') || locationType < 0 || locationType > 2) {
          return reject(logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType));
        }

        if (locationType == StorageLocationType.Local) {
          resolve(localStorage.getAll());
        } else if (locationType == StorageLocationType.Cluster || locationType == StorageLocationType.HA && !haStorage) {
          resolve(process.clusterManager.getStorageAll(pluginId));
        } else if (locationType == StorageLocationType.HA) {
          return haStorage.getAll();
        } else {
          reject(logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType));
        }
      });
    },

    getAllSync: (locationType?:StorageLocationType): { [key: string]: any } => {
      if (locationType===undefined) {
        locationType = this.getDefaultLocationType();
      } else if ((typeof locationType != 'number') || locationType < 0 || locationType > 2) {
        return logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType);
      }
      if (StorageLocationType.HA) {
        return logger.warn(`Plugin ${pluginId} storage error, storage type HA is not supported in sync mode`);
      }

      if (locationType == StorageLocationType.Local) {
        return localStorage.getAll();
      } else if (locationType == StorageLocationType.Cluster) {
        return process.clusterManager.getStorageAll(pluginId);
      } else {
        return logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType);
      }
    },
                         
    setAll: (dict:any, locationType?:StorageLocationType): Promise<void> => {
      return new Promise((resolve, reject)=> {
        if (locationType===undefined) {
          locationType = this.getDefaultLocationType();
        } else if ((typeof locationType != 'number') || locationType < 0 || locationType > 2) {
          return reject(logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType));
        }

        if (locationType == StorageLocationType.Local) {
          resolve(localStorage.setAll(dict));
        } else if (locationType == StorageLocationType.Cluster || locationType == StorageLocationType.HA && !haStorage) {
          resolve(process.clusterManager.setStorageAll(pluginId, dict));
        } else if (locationType == StorageLocationType.HA) {
          return haStorage.setAll(dict);
        } else {
          reject(logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType));
        }
      });
    },
    
    setAllSync: (dict:any, locationType?:StorageLocationType): void => {
      if (locationType===undefined) {
        locationType = this.getDefaultLocationType();
      } else if ((typeof locationType != 'number') || locationType < 0 || locationType > 2) {
        return logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType);
      }
      if (StorageLocationType.HA) {
        return logger.warn(`Plugin ${pluginId} storage error, storage type HA is not supported in sync mode`);
      }

      if (locationType == StorageLocationType.Local) {
        return localStorage.setAll(dict);
      } else if (locationType == StorageLocationType.Cluster) {
        return process.clusterManager.setStorageAll(pluginId, dict);
      } else {
        return logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType);
      }
    },

    deleteAll: (locationType?:StorageLocationType): Promise<void> => {
      return new Promise((resolve, reject)=> {
        if (locationType===undefined) {
          locationType = this.getDefaultLocationType();
        } else if ((typeof locationType != 'number') || locationType < 0 || locationType > 2) {
          return reject(logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType));
        }

        if (locationType == StorageLocationType.Local) {
          resolve(localStorage.setAll({}));
        } else if (locationType == StorageLocationType.Cluster || locationType == StorageLocationType.HA && !haStorage) {
          resolve(process.clusterManager.setStorageAll(pluginId, {}));
        } else if (locationType == StorageLocationType.HA) {
          return haStorage.deleteAll();
        } else {
          reject(logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType));
        }
      });
    },

    deleteAllSync: (locationType?:StorageLocationType): void => {
      if (locationType===undefined) {
        locationType = this.getDefaultLocationType();
      } else if ((typeof locationType != 'number') || locationType < 0 || locationType > 2) {
        return logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType);
      }
      if (StorageLocationType.HA) {
        return logger.warn(`Plugin ${pluginId} storage error, storage type HA is not supported in sync mode`);
      }
      
      if (locationType == StorageLocationType.Local) {
        return localStorage.setAll({});
      } else if (locationType == StorageLocationType.Cluster) {
        return process.clusterManager.setStorageAll(pluginId, {});
      } else {
        return logger.warn(`Plugin ${pluginId} storage error, unknown locationType given=`,locationType);
      }
    }
  }
}

export function LocalStorageFactory(id?: string): ILocalStorage {
  
  const storageDict = {};
    
  if (id) {
    storageDict[id] = {};
  }

  return {
    get: (key:string, pluginId?:string): any => {
      const identifier = pluginId || id;
      
      if (storageDict[identifier]) { // If plugin storage exists
        if (storageDict[identifier][key]) { // and if the value, from key, exists
          return storageDict[identifier][key]; // return the value.
        } else {
          return null;
        }
      }
      return null;
    },

    getAll: (pluginId?:string): { [key: string]: any } => {
      if (pluginId === undefined) {
        if (id) { // This was set previously above
          return storageDict[id];
        } else {
          return storageDict;
        }
      }
      
      if (storageDict[pluginId]) { // However, this we need to check if exists
        return storageDict[pluginId];
      }
      
      /* Otherwise, return an empty set. This isn't null because null breaks things in the top-most layer (i.e. webapp, cluster)*/
      return {};
    },

    set: (key:string, value:any, pluginId?:string): void => {
      const identifier = pluginId || id;

      if (identifier) {
        // Are we attempting to put something inside storage that doesn't exist?
        if (storageDict[identifier] === undefined) {
          storageDict[identifier] = {}; // So then make the storage
        }

        storageDict[identifier][key] = value;
      } else {
        console.warn("No specified plugin identifier to set storage value");
      }
    },

    setAll: (dict:any, pluginId?:string): void => {
      const identifier = pluginId || id;

      if (identifier) {
        storageDict[identifier] = dict; // Set the whole storage object
      } else {
        console.warn("No specified plugin identifier to set storage value");
      }
    },

    delete: (key, pluginId): void => {
      const identifier = pluginId || id;

      if (storageDict[identifier]) { // If plugin storage exists
        if (storageDict[identifier][key]) { // and if the value, from key, exists
          delete storageDict[identifier][key]; // remove as desired.
        } else {
          console.warn("Storage for key '" + key + "' doesn't exist or has been already deleted");
        }
      } else {
        console.warn("Storage for id '" + identifier + "' doesn't exist or has been already deleted");
      }
    }
  }
}

