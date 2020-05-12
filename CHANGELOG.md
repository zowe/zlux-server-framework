# Zlux Server Framework Changelog

All notable changes to the Zlux Server Framework package will be documented in this file.
This repo is part of the app-server Zowe Component, and the change logs here may appear on Zowe.org in that section.

## Recent Changes

- Add ability to state where a plugin path is relative to, instead of just where the server is running.
- Bugfix: Logout now allows security plugins to clear cookies
- Removed tokenInjector from sso-auth, since when SSO is being used token injection logic is not needed anymore.
- Bugfix: When trying to dynamically load a plugin with unmet dependencies, the response from the server would hang
- Support for reading keys, certificates, and certificate authority content from SAF keyrings via safkeyring:// specification in the node.https configuration object
- App server will now reattempt to connect to zss if it doesn't initially

