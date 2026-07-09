# Changelog

All notable changes to this package should be documented here.

This project follows a pragmatic changelog format inspired by Keep a Changelog.
Use the `Unreleased` section for work that has landed on `main` but has not
been released.

## 1.0.0

### Added

- Initial Windows-first Bluetti BLE to MQTT bridge package as a TypeScript port
  of the Python `bluetti_mqtt` library, with the Windows BLE transport
  delegated to a small .NET helper that talks over line-delimited JSON on stdio.
- CLI entrypoints: `bluetti-mqtt-node`, `-discovery`, `-logger`, `-poll`, `-probe`.
- Config-file mode (`--config`) plus CLI flags
  (`--broker`, `--username`, `--password`, `--interval`, `--log-level`, `--once`).
- MQTT state publishing under `bluetti/state/<MODEL>-<SERIAL>/<FIELD>` and
  command-topic ingestion under `bluetti/command/<MODEL>-<SERIAL>/<FIELD>`,
  with raw `_raw` JSON snapshots per device.
- Structured logging (debug/info/warn/error) and a single
  `npm run validate` CI contract: typecheck + Biome lint + tests + `c8`
  coverage + .NET helper build.
- `c8` coverage script (`npm run coverage`).
- MQTT TLS configuration for `mqtts://` brokers: CA file, client certificate,
  client key, `servername` override, and an `--mqtt-insecure` flag for
  self-signed brokers; available via CLI flags and under `tls.*` JSON keys.
- DC1/DC2 separate solar input registers on AC500 and AC300.
- Polling improvements: improved backoff and telemetry, plus recovery after
  BLE link loss.
- GitHub Actions CI workflow validating `npm run validate` across a Node.js
  version matrix.
- Portable framework-dependent helper publish mode
  (`npm run helper:publish:portable`).

### Changed

- Renamed the internal MQTT source module from `src/mqtt/` to `src/broker/`
  so compiled code can use the external `mqtt` package without a postbuild
  rewrite script.
- `Logger.warn` calls now route through a dedicated warning output stream
  so they're distinguishable from info-level output.
- `CHANGELOG.md` `Unreleased` section semantics retained for changes
  landing on `main` before the next release.

### Refactored

- Devices: replaced per-device class files with a data-driven definition
  pattern (`DeviceDefinition` interface plus `BluettiDeviceModel` runtime).
- `device-handler`: extracted command execution into `DeviceCommandRunner`,
  and split connection retry and the work queue into dedicated modules.
- Constants: offloaded module-level constants (Modbus codes, command IDs,
  MQTT topic strings) into dedicated `constants.ts` files per module.
- Imports: introduced `@`-prefixed path aliases across all modules.

### Fixed

- Windows Bluetooth session cleanup hardened against disposal errors and
  unhandled background exceptions.
- Disposed BLE helper connection errors no longer crash the CLI;
  treated as recoverable bad-connection conditions.
- `GATT unreachable` is now treated as a bad connection rather than
  triggering the wrong recovery path.
- `Logger.warn` now routes to warning output, with tests updated for the
  new stream.
- Recoverable Bluetooth startup failures are now retried before exit.
- Bluetooth cleanup disposal errors no longer propagate as unhandled
  exceptions during shutdown.
- Polling now recovers after a BLE link loss without manual reset of
  the device-handler state.
- Bluetooth and MQTT resource cleanup hardened across the shutdown path.
- Modbus protocol frames and runtime configuration inputs are validated
  before forwarding.
- `@mqtt` path alias replaced with `@broker`, applied consistently
  throughout the broker tooling layer.

### Removed

- Removed the tracked `dist-test/` build artifact directory that was
  unintentionally committed during the build pipeline cleanup pass.
- Removed `scripts/postbuild.mjs`; the `src/mqtt` -> `src/broker` rename
  removed the need for the postbuild rewrite script that previously
  inlined the external `mqtt` package.

### Tooling

- Added Biome with the recommended rule set, plus `npm run lint` and
  `npm run lint:fix` scripts; mechanically applied Biome recommended
  auto-fixes to all source and test files.
- Tightened broker CI and module boundaries so the broker tooling layer
  matches the rest of the codebase's lint and validation contract.
- CI checkouts kept LF-normalized to prevent cross-platform CRLF
  regressions.
