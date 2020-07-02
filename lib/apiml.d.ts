import { EurekaInstanceConfig } from 'eureka-js-client';

declare type Status = 'UP' | 'DOWN' | 'STARTING' | 'OUT_OF_SERVICE' | 'UNKNOWN';

declare class ApimlConnector {
  constructor(config: any);
  registerMainServerInstance(instanceConfigOverrides?: Partial<EurekaInstanceConfig>): Promise<void>;
  getInstanceId(): string;
  getZluxInstances(): EurekaInstanceConfig[];
  waitUntilRaftClusterIsReady(clusterSize: number): Promise<EurekaInstanceConfig[]>;
  takeIntoService(): Promise<void>;
  takeOutOfService(): Promise<void>;
  takeInstanceOutOfService(instanceId: string): Promise<void>;
  takeInstanceIntoService(instanceId: string): Promise<void>;
  overrideStatus(status: Status): Promise<void>;
  overrideStatusForInstance(instanceId: string, status: Status): Promise<void>;
  onReRegister(callback: () => void): void;
}

declare function makeApiml(userConfig: any): ApimlConnector;