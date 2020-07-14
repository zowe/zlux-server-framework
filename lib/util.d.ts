/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

export interface KeyVal {
  [key: string]: any;
}

export interface StorageDict {
  [pluginId: string]: KeyVal;
}

declare class DataserviceStorage {
  get(key: string, pluginId?: string): any;
  getAll(pluginId?: string): any;
  set(key: string, value: any, pluginId?: string): void;
  setAll(dict: any, pluginId?: string): void;
  delete(key: string, pluginId?: string): void;
}

declare var loggers: any;


/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/
