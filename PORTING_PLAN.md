# bluetti-mqtt-node Porting Status

## Outcome

The Windows-first, MQTT-only TypeScript port has been implemented.

## Scope

- Windows is the primary runtime
- MQTT bridge support is included
- Home Assistant support is intentionally excluded
- BLE is implemented through a Windows-native .NET helper instead of a Node-native BLE addon

## Phase Status

### Phase 1: Protocol Core

Completed.

- `ReadHoldingRegisters`, `WriteSingleRegister`, `WriteMultipleRegisters`
- MODBUS CRC generation/validation
- byte-level smoke verification

### Phase 2: Field Parsing

Completed.

- uint, bool, enum, decimal, decimal-array, string, swapped-string, version, serial-number parsing

### Phase 3: Device Definitions

Completed.

Ported models:

- AC200M
- AC300
- AC500
- AC60
- EB3A
- EP500
- EP500P
- EP600

### Phase 4: BLE Transport and Session Layer

Completed for the Windows-first scope.

- transport abstraction
- Windows helper protocol
- helper-backed transport
- session state machine
- notification reassembly and CRC validation

### Phase 5: Runtime Orchestration

Completed.

- multi-device manager
- polling loops
- pack polling loop support
- one-shot and continuous runtime modes
- tolerant handling of expected read failures such as MODBUS exceptions

### Phase 6: MQTT

Completed for the agreed scope.

- state publishing to `bluetti/state/<MODEL>-<SERIAL>/<FIELD>`
- raw JSON publication to `_raw`
- command subscription from `bluetti/command/<MODEL>-<SERIAL>/<FIELD>`
- setter dispatch into the BLE session layer

### Phase 7: CLI Parity

Completed.

Implemented commands:

- discovery
- logger
- probe
- poll
- single-command parity check
- full polling-suite parity check
- MQTT bridge runtime

### Phase 8: Verification

Completed for the target runtime and live device used during implementation.

Verified live on Windows against AC500 `24:4C:AB:2C:24:8E`:

- BLE scan
- device connect
- characteristic read/write/subscribe path
- `ReadHoldingRegisters(10, 40)` live probe
- full AC500 polling command parity against the Python library
- one-shot MQTT publish into a local broker on `mqtt://127.0.0.1:1883`

## Validation Commands Run

- `npm run probe -- 24:4C:AB:2C:24:8E`
- `npm run poll -- 24:4C:AB:2C:24:8E`
- `npm run parity -- 24:4C:AB:2C:24:8E`
- `npm run parity:suite -- 24:4C:AB:2C:24:8E`
- `npm run bluetti-mqtt -- --broker mqtt://127.0.0.1:1883 --once 24:4C:AB:2C:24:8E`
- `npm test`
- `npm run typecheck`
- `dotnet build helper/BluettiMqtt.BluetoothHelper/BluettiMqtt.BluetoothHelper.csproj`

## Remaining Work

No planned phase remains open for the agreed Windows-first MQTT scope.

Possible future enhancements:

- broader live parity coverage for additional device models
- richer MQTT command coercion and validation
- packaged release flow and npm `bin` metadata
- deeper integration with the existing `bluetti-monitor` project
