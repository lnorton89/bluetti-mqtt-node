# bluetti-mqtt-node

Windows-first TypeScript port of the Python [`bluetti_mqtt`](https://github.com/warhammerkid/bluetti_mqtt) library.

This project connects to Bluetti power stations over Bluetooth Low Energy, polls device state through the Bluetti MODBUS-over-BLE protocol, and publishes that state to MQTT.

The repository is designed around Windows as the primary runtime. BLE access is handled by a small .NET helper using native Windows Bluetooth APIs, while the protocol logic, parsing, polling, and MQTT bridge live in TypeScript.

## Features

- Windows-native BLE transport
- TypeScript implementation of Bluetti MODBUS command framing and CRC handling
- Typed field parsing for supported Bluetti devices
- MQTT state publishing
- MQTT command-topic ingestion for writable fields
- Live polling, logging, and probe CLIs

## Scope

Included:

- Windows runtime
- MQTT bridge
- BLE polling and command dispatch

Explicitly out of scope:

- Home Assistant discovery/config publishing
- Linux-first or macOS-first BLE support

## Supported Device Models

The TypeScript registry currently supports the same models ported from the Python library:

- AC200M
- AC300
- AC500
- AC60
- EB3A
- EP500
- EP500P
- EP600

## Architecture

The project is split into a few clear layers:

- `src/core`
  - MODBUS commands, CRC, shared types, event bus
- `src/devices`
  - device models and typed field parsing
- `src/bluetooth`
  - Windows-helper transport abstraction, session state machine, helper client, mock transport
- `src/app`
  - polling orchestration and runtime wiring
- `src/mqtt`
  - MQTT publishing and command-topic handling
- `src/cli`
  - user-facing command entrypoints
- `helper/BluettiMqtt.BluetoothHelper`
  - Windows-native BLE helper implemented in .NET / WinRT

## Why a Windows Helper Exists

Node-native BLE libraries on Windows are workable in some environments, but they tend to be more fragile than the native Windows Bluetooth stack and often require native addon toolchains. This project uses a small .NET helper process instead, and the old experimental `noble` path has been removed from the supported runtime surface.

That gives us:

- native Windows BLE APIs for scan/connect/GATT operations
- a simpler Node runtime surface
- a cleaner separation between transport concerns and protocol logic
- fewer issues with `node-gyp` and Windows BLE adapter quirks

The helper communicates with Node over line-delimited JSON on stdio.

## Requirements

Runtime requirements:

- Windows
- Node.js 22+ recommended
- npm
- .NET SDK 6.0+ if you are building the Windows helper from source
- Bluetooth adapter supported by Windows BLE APIs
- MQTT broker reachable from the machine running this project

Development requirements:

- Docker optional, but useful for spinning up a local MQTT broker for testing

## Installation

Install Node dependencies:

```powershell
npm install
```

Build the TypeScript project:

```powershell
npm run build
```

Build the Windows helper:

```powershell
dotnet build helper\BluettiMqtt.BluetoothHelper\BluettiMqtt.BluetoothHelper.csproj
```

Publish a self-contained Windows helper for distribution:

```powershell
npm run helper:publish
```

Publish a smaller framework-dependent helper instead:

```powershell
npm run helper:publish:portable
```

Run the full local validation suite:

```powershell
npm run validate
```

## Installed CLI Names

If this package is installed as a CLI package, the declared executable names are:

- `bluetti-mqtt-node`
- `bluetti-mqtt-node-discovery`
- `bluetti-mqtt-node-logger`
- `bluetti-mqtt-node-poll`
- `bluetti-mqtt-node-probe`

The repo-local `npm run ...` scripts remain the easiest way to use the commands during development.

## Helper Resolution

The Node runtime resolves the Windows helper in this order:

1. `BLUETTI_HELPER_PATH` if you set it
2. published helper artifact at `artifacts/helper/win-x64/BluettiMqtt.BluetoothHelper.exe`
3. source fallback through `dotnet run --project helper/BluettiMqtt.BluetoothHelper/BluettiMqtt.BluetoothHelper.csproj`

That means:

- contributors can work directly from source without changing anything
- release builds can ship a published helper executable
- end users can override the helper path explicitly when needed

Example override:

```powershell
$env:BLUETTI_HELPER_PATH = "C:\tools\BluettiMqtt.BluetoothHelper.exe"
```

If you publish the framework-dependent helper, point `BLUETTI_HELPER_PATH` at `artifacts/helper/win-x64-fdd/BluettiMqtt.BluetoothHelper.exe`.

## CLI Usage

### Discover Nearby Devices

```powershell
npm run bluetti-discovery
```

This scans nearby BLE devices through the Windows helper and prints discovered devices as JSON.

Use `--help` with any CLI to print its usage text.

### Probe a Device

```powershell
npm run probe -- <BLUETOOTH_MAC>
```

This:

- connects to the device
- reads the device name characteristic
- executes `ReadHoldingRegisters(10, 40)`
- parses and prints the result

### Poll the Device's Standard Polling Set

```powershell
npm run poll -- <BLUETOOTH_MAC>
```

This runs the device's `pollingCommands` set and prints:

- per-command responses
- parsed output for each command
- a merged view of the parsed state

### Log the Device's Logging Command Set

```powershell
npm run bluetti-logger -- <BLUETOOTH_MAC>
```

This runs the broader `loggingCommands` set for the device and prints the parsed output.

### Run the MQTT Bridge Once

```powershell
npm run bluetti-mqtt -- --broker mqtt://127.0.0.1:1883 --once <BLUETOOTH_MAC>
```

This performs one poll/publish cycle, publishes MQTT state topics, and exits.

### Run the MQTT Bridge Continuously

```powershell
npm run bluetti-mqtt -- --broker mqtt://127.0.0.1:1883 --interval 5 <BLUETOOTH_MAC>
```

Supported flags:

- `--broker <mqtt-url>`
- `--config <path>`
- `--username <username>`
- `--password <password>`
- `--interval <seconds>`
- `--log-level <level>`
- `--once`

Example:

```powershell
npm run bluetti-mqtt -- --broker mqtt://127.0.0.1:1883 --interval 5 24:4C:AB:2C:24:8E
```

Config-file example:

```powershell
npm run bluetti-mqtt -- --config .\config.example.json
```

The config file is JSON and supports:

- `broker`
- `username`
- `password`
- `interval`
- `once`
- `logLevel`
- `addresses`

CLI flags override config-file values when both are provided.

## MQTT Topic Layout

State topics:

```text
bluetti/state/<MODEL>-<SERIAL>/<FIELD>
```

Examples:

```text
bluetti/state/AC500-2237000003358/ac_input_power
bluetti/state/AC500-2237000003358/total_battery_percent
```

Each parser message also publishes a raw JSON snapshot to:

```text
bluetti/state/<MODEL>-<SERIAL>/_raw
```

Command topics:

```text
bluetti/command/<MODEL>-<SERIAL>/<FIELD>
```

Payload expectations:

- booleans: `ON` / `OFF`
- integer fields: numeric string
- enum fields: enum name string

## Validation and Current Confidence

This project has been validated live on this machine against:

- AC500 `24:4C:AB:2C:24:8E`

Successful live validation includes:

- BLE scan
- connect + device-name read
- characteristic read/write/subscribe path
- `probe`
- `poll`
- one-shot MQTT publish to a local broker

## Limitations

- Windows is the only runtime this repository is currently designed for.
- The Windows helper is the only supported BLE runtime path in this repository.
- MQTT command handling is implemented, but broader live validation of writable fields is still lighter than read-path validation.

## Development Notes

Useful commands:

```powershell
npm run typecheck
npm test
npm run build
npm run helper:publish
npm run helper:publish:portable
npm run pack:dry-run
npm run validate
dotnet build helper\BluettiMqtt.BluetoothHelper\BluettiMqtt.BluetoothHelper.csproj
```

GitHub Actions validates:

- `npm run typecheck`
- `npm test`
- `npm run helper:build`

## Distribution Notes

For npm packaging, `prepack` builds the TypeScript output and publishes a self-contained Windows helper into `artifacts/helper/win-x64`.

That gives the package a better installation story than requiring every user to run the helper from source. A typical release flow is:

```powershell
npm run validate
npm run pack:dry-run
npm publish
```

If you are distributing outside npm, the simplest layout is:

- `dist/`
- `artifacts/helper/win-x64/BluettiMqtt.BluetoothHelper.exe`
- `README.md`

The CLI will automatically use the published helper artifact when it exists.

## Helper Size Tradeoff

There are two practical helper distribution modes:

- self-contained single-file publish
  - biggest artifact
  - no separate .NET runtime install required on the target machine
  - this is the default npm package artifact
- framework-dependent single-file publish
  - much smaller artifact
  - requires a compatible .NET runtime on the target machine
  - useful when you control the installation environment

On the current implementation, the framework-dependent helper is roughly one quarter the size of the self-contained helper.
