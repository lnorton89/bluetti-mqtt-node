# Changelog

All notable changes to this package should be documented here.

This project follows a pragmatic changelog format inspired by Keep a Changelog.
Use the `Unreleased` section for work that has landed on `main` but has not
been released.

## Unreleased

### Added

- Simulated Bluetti devices (`SimulatedBluettiDevice`,
  `createSimulatedRuntime`, `createSimulatedFleet`) that answer the full
  MODBUS-over-BLE dialect — CRC-validated reads, write echoes, chunked
  notifications, exception frames, and fault injection — so the entire
  stack can run without Bluetti hardware on any platform.
- `--mock` flag on every CLI (and `"mock": true` in the JSON config) to run
  against the simulated fleet; `bluetti-mqtt-node --mock` auto-polls the
  fleet when no addresses are given, and `--mock-device <model>` adds
  simulated models.
- `createPlatformRuntime` backend selector: Windows helper on `win32`,
  simulated devices in mock mode, and a clear error elsewhere (native
  Linux/macOS BLE is planned on `@stoprocent/noble`).

### Changed

- Removed the `"os": ["win32"]` package restriction so the package installs
  on Linux and macOS; native BLE remains Windows-only for now, but mock mode
  works everywhere.

### Fixed

- Battery-pack-only busy responses now back off slow/full polling without
  stretching the independent fast power/state telemetry interval.
- Transient Windows GATT characteristic-missing responses are now classified
  as recoverable connection failures and retried during device initialization.

## 1.0.1

### Refactored

- **cli:** split `src/cli/shared.ts` (362 lines) into `errors.ts`
  (`UsageError`, `HelpError`), `args.ts` (`hasHelpFlag`, single/optional
  address arg, `validateBluetoothAddress`, `normalizeValue`), `process.ts`
  (`runCli`, `installSignalHandlers`), plus the `withConnectedDevice` and
  `runPollingCommands` residue. Six sibling CLI entry files and
  `test/cli-shared.test.mjs` updated to the new import paths.
- **broker:** extracted six standalone payload helpers (`serializeValue`,
  `parseCommandValue`, `normalizeRecord`, `normalizeValue`, `deviceKey`,
  `stringifyError`) from `src/broker/client.ts` into a new
  `src/broker/payload-utils.ts`. The bridge class and supporting interfaces
  (`BluettiMqttClientOptions`, `MqttTlsOptions`, `RawMqttClientLike`,
  `MqttConnector`, `PollingCommand` type alias) stay in `client.ts`. Added a
  cross-reference comment on the broker `normalizeValue` highlighting its
  intentional divergence from the CLI sibling in `@cli/args.ts`.
- **bluetooth:** extracted four helpers (`isRetryableInitializationError`,
  `sleep`, `concatBytes`, `isAsciiControlMessage`) from
  `src/bluetooth/device-session.ts` into a new
  `src/bluetooth/session-utils.ts`, along with the five bluetooth constants
  those helpers reference (`GATT_UNREACHABLE_TEXT`,
  `GATT_FAILED_UNREACHABLE_TEXT`, `UNREACHABLE_ERROR_TEXT`,
  `AT_CONTROL_NAME_MESSAGE`, `AT_CONTROL_ADV_MESSAGE`). The `DeviceSession`
  class and `DeviceSessionState` enum stay in `device-session.ts` so the
  public surface is unchanged.
- **app:** `src/app/device-handler.ts` was reviewed for a parallel split
  but **left as-is**. The residue is tightly-coupled orchestrator glue
  whose `run()` body interleaves five instance fields; the previous
  extractions (`device-connection.ts`, `device-executor.ts`,
  `device-queue.ts`, `polling-state.ts`) already captured every cohesive
  concern with closed state. Three plausible splits were considered and
  rejected as net-negative clarity; the deferral is recorded in the commit
  log for traceability.

### Tooling

- Biome auto-fixup folded in for the four test files affected by the import
  rewrites (`broker-client.test.mjs`, `device-executor.test.mjs`,
  `helper-client.test.mjs`, `helper-request.test.mjs`).

No runtime behavior changes. No public API changes. No new tests; existing
tests are unchanged in outcome.

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
