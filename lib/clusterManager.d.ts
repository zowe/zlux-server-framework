/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

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
  callClusterMethodRemote: (moduleName: string | null, importedName: string, methodName: string, argsArray: any[], callback: (result: any[]) => void, onerror?: (err: Error) => void, timeout?: number) => Promise<any>;
}



/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
