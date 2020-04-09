import { ClusterManager } from "./clusterManager";

declare global {
  namespace NodeJS {
    export interface Process {
      clusterManager: ClusterManager;
    }
  }
}