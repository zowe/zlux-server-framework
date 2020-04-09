import { EventEmitter } from "events";

interface KeyVal {
  [key: string]: any;
}

interface StorageDict {
  [pluginId: string]: KeyVal;
}

declare class ClusterManager extends EventEmitter {
  isMaster: boolean;
  setStorageAll: (pluginId: string, dict: KeyVal) => Promise<true>;
  setStorageByKey: (pluginId: string, key: string, value: string) => Promise<true>;
  deleteStorageByKey: (pluginId: string, key: string) => Promise<true>;
  getStorageCluster: () => Promise<StorageDict>;
}

