import { EurekaInstanceConfig } from 'eureka-js-client';

declare class ApimlConnector {
  registerMainServerInstance(): Promise<void>;
  getInstanceId(): string;
  getZluxInstances(): EurekaInstanceConfig[];
  waitUntilZluxClusterIsReady(clusterSize: number): Promise<EurekaInstanceConfig[]>;
  takeIntoService(): Promise<void>;
  takeOutOfService(): Promise<void>;
  takeInstanceOutOfService(instanceId: string): Promise<void>;
  takeInstanceIntoService(instanceId: string): Promise<void>;
}