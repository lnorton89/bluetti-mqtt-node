# Contributing

Thanks for improving `bluetti-mqtt-node`. This package is intentionally small,
hardware-adjacent, and Windows-first, so changes should keep local operation
predictable.

## Development Setup

1. Install Node.js 22 or newer.
2. Install .NET 6 SDK for the Windows Bluetooth helper.
3. Install dependencies with `npm ci`.
4. Run `npm run validate` before opening a pull request.

## Validation

`npm run validate` is the CI contract. It runs:

- TypeScript type checking
- Biome lint checks
- The smoke/unit test suite
- `c8` coverage
- The .NET helper build

Use narrower commands while iterating:

- `npm test`
- `npm run coverage`
- `npm run lint`
- `npm run helper:build`

## Change Guidelines

- Keep BLE helper protocol changes covered by tests.
- Keep MQTT broker changes covered without requiring a live broker.
- Update `CHANGELOG.md` under `Unreleased` for user-visible behavior,
  configuration, packaging, or workflow changes.
- Prefer small extraction helpers over broad rewrites; this package is used as a
  local submodule and should stay easy to audit.
