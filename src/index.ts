/**
 * Windows-first Bluetti BLE transport, device models, and MQTT bridge.
 *
 * @remarks
 * This package connects to Bluetti power stations over Bluetooth Low Energy
 * (via a native Windows helper process), polls device state through the
 * Bluetti MODBUS-over-BLE protocol, and publishes that state to MQTT.
 *
 * The public API is organized into layers:
 * - **core** — MODBUS commands, CRC, shared types, event bus, logging
 * - **bluetooth** — transport abstraction, session state machine, helper client
 * - **devices** — device models with typed field parsing for supported hardware
 * - **app** — polling orchestration and runtime server wiring
 * - **mqtt** — MQTT bridge for state publishing and command ingestion
 *
 * @packageDocumentation
 */
export * from "@app/server.js";
export * from "@bluetooth/device-session.js";
export * from "@bluetooth/errors.js";
export * from "@bluetooth/helper-client.js";
export * from "@bluetooth/helper-protocol.js";
export * from "@bluetooth/manager.js";
export * from "@bluetooth/mock-transport.js";
export * from "@bluetooth/transport.js";
export * from "@core/commands.js";
export * from "@core/crc.js";
export * from "@core/event-bus.js";
export * from "@core/logger.js";
export * from "@core/types.js";
export * from "@devices/definition.js";
export * from "@devices/device.js";
export * from "@devices/device-builders.js";
export * from "@devices/enums.js";
export * from "@devices/field.js";
export * from "@devices/registry.js";
export * from "@devices/struct.js";
export * from "@mqtt/client.js";
