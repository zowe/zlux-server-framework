import { EventEmitter } from "events";

interface KeyVal {
  [key: string]: any;
}

interface StorageDict {
  [pluginId: string]: KeyVal;
}

declare class ClusterManager extends EventEmitter{
  isMaster: boolean;
  setStorageAll: (pluginId: string, dict: KeyVal) => void;
  getStorageCluster: () => Promise<StorageDict>;
}

