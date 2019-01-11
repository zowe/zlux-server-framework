This program and the accompanying materials are
made available under the terms of the Eclipse Public License v2.0 which accompanies
this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

SPDX-License-Identifier: EPL-2.0

Copyright Contributors to the Zowe Project.
# zlux-server-framework
This is a framework for the construction of a Zowe App Server instance. It is an HTTP, HTTPS, and Websocket server built upon NodeJS and ExpressJS. It serves static content via "Plugins", and is extensible by REST and Websocket "Dataservices" optionally present within Plugins.

The js folder contains the core bootstrapping and routing of the server, while the plugins folder contains plugins with essential dataservices.
For more information about how to make use of this server framework, such as how to build dataservices or Apps, checkout the [zLUX wiki](https://github.com/zowe/zlux/wiki)
For a ready-to-use server built on this framework, try out the [zlux-app-server](https://github.com/zowe/zlux-app-server), which includes a README on how to set it up.


This program and the accompanying materials are
made available under the terms of the Eclipse Public License v2.0 which accompanies
this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

SPDX-License-Identifier: EPL-2.0

Copyright Contributors to the Zowe Project.
