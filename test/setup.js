/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

'use strict';

/**
 * Global test setup — loaded via mocha --require test/setup.js.
 *
 * Stubs the COM_RS_COMMON_LOGGER global so that library modules (lib/util.js,
 * lib/depgraph.js, etc.) can be loaded without the external zlux-shared repo.
 * The stub provides all logger methods used across the codebase.
 */
const noop = () => {};

global.COM_RS_COMMON_LOGGER = {
  makeComponentLogger: () => ({
    info: noop,
    warn: noop,
    debug: noop,
    severe: noop,
    log: noop,
    trace: noop
  }),
  setLogLevelForComponentPattern: noop,
  setLogLevelForComponentName: noop,
  getConfig: () => ({})
};
