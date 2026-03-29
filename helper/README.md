# Windows Helper

This folder contains the Windows-native BLE helper used by the TypeScript port.

## Purpose

Windows BLE support is handled here through .NET / WinRT so the Node side can stay focused on:

- protocol parsing
- device models
- polling
- MQTT
- parity tooling

## Transport Contract

The helper talks to Node over line-delimited JSON on stdio.

Implemented protocol operations:

- `ready`
- `ping`
- `scan`
- `connect`
- `disconnect`
- `readCharacteristic`
- `writeCharacteristic`
- `subscribe`
- async `notification` events

## Status

This helper is the production Windows BLE path for this repository, not just a proof of concept.

It has been verified live against an AC500 for:

- scanning
- connection establishment
- device-name reads
- characteristic reads/writes
- notification delivery for the MODBUS session layer

## Build and Publish

Build from source:

```powershell
dotnet build helper\BluettiMqtt.BluetoothHelper\BluettiMqtt.BluetoothHelper.csproj
```

Publish the helper as a self-contained single-file Windows executable:

```powershell
npm run helper:publish
```

That writes the release artifact to:

```text
artifacts/helper/win-x64/BluettiMqtt.BluetoothHelper.exe
```

The Node runtime prefers that published executable when it exists, and falls back to `dotnet run` from source during development.
