import { EurekaInstanceConfig } from 'eureka-js-client';

declare type Status = 'UP' | 'DOWN' | 'STARTING' | 'OUT_OF_SERVICE' | 'UNKNOWN';

declare class ApimlConnector {
  registerMainServerInstance(): Promise<void>;
  getInstanceId(): string;
  getZluxInstances(): EurekaInstanceConfig[];
  waitUntilZluxClusterIsReady(clusterSize: number): Promise<EurekaInstanceConfig[]>;
  takeIntoService(): Promise<void>;
  takeOutOfService(): Promise<void>;
  takeInstanceOutOfService(instanceId: string): Promise<void>;
  takeInstanceIntoService(instanceId: string): Promise<void>;
  overrideStatus(status: Status): Promise<void>;
  overrideStatusForInstance(instanceId: string, status: Status): Promise<void>;
  onReRegister(callback: () => void): void;
}