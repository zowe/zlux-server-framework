# Zlux Server Framework Changelog

All notable changes to the Zlux Server Framework package will be documented in this file.
This repo is part of the app-server Zowe Component, and the change logs here may appear on Zowe.org in that section.

## 1.14.0

- Bugfix: Plugin default server config could not exist in plugins own directory, and had to exist in the instance
- Bugfix: Terminal handlers had to exist within the root directory, rather than also being possible to exist within the instance directory
- Bugfix: Support more config parameters as env vars for edge case characters *, ., and _
- Bugfix: Fix for regression where session would expire prematurely because app server would not request a refresh from ZSS
- Server will now load recognizers & actions from appDir/config/recognizers or /actions into the config

## 1.12.0

- Bugfix: Server handles if implementationDefaults or mediationLayer objects are missing
- Bugfix: SSH connecting from terminal-proxy was very slow on node v12+
- Bugfix: Lease info for mediation layer was a value that caused periodic heartbeat failure
- Add ability to state where a plugin path is relative to, instead of just where the server is running.
- Bugfix: Logout now allows security plugins to clear cookies
- Removed tokenInjector from sso-auth, since when SSO is being used token injection logic is not needed anymore.
- Bugfix: When trying to dynamically load a plugin with unmet dependencies, the response from the server would hang
- Support for reading keys, certificates, and certificate authority content from SAF keyrings via safkeyring:// specification in the node.https configuration object
- App server will now reattempt to connect to zss if it doesn't initially

