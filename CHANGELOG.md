# Changelog

All notable changes to this package should be documented here.

This project follows a pragmatic changelog format inspired by Keep a Changelog.
Use the `Unreleased` section for work that has landed on `main` but has not
been released.

## Unreleased

### Added

- Added `c8` coverage support through `npm run coverage`.
- Added optional MQTT TLS configuration for CA, client certificate, client key,
  server name, and self-signed broker workflows.
- Added focused tests for device command execution and helper client request
  behavior.

### Changed

- Renamed the internal MQTT source module to `broker` so compiled code can use
  the external `mqtt` package without a postbuild rewrite script.
- Updated CI to run the package validation command across a Node.js version
  matrix.

## 0.1.0

### Added

- Initial Windows-first Bluetti BLE to MQTT bridge package.
