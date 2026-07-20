import assert from "node:assert/strict";
import {
	DeviceSession,
	DeviceSessionState,
} from "../dist/bluetooth/device-session.js";
import {
	CommandTimeoutError,
	DeviceBusyError,
	ModbusError,
} from "../dist/bluetooth/errors.js";
import {
	SimulatedBluettiDevice,
	createSimulatedFleet,
	createSimulatedRuntime,
} from "../dist/bluetooth/simulated-device.js";
import { DeviceCommand, ReadHoldingRegisters } from "../dist/core/commands.js";
import {
	createDeviceFromAdvertisement,
	isSupportedBluettiName,
} from "../dist/devices/registry.js";

/**
 * Smoke-test runner for the simulated Bluetti device runtime.
 *
 * Covers session initialization, seeded telemetry round-trips, notification
 * chunking, setter write-back, exception and fault injection paths, and
 * fleet discovery.
 */
async function run() {
	await testConnectAndInitialize();
	await testSeededTelemetryRoundTrip();
	await testResponseChunking();
	await testSetterRoundTrip();
	await testUnknownFunctionCodeRejected();
	await testFaultInjection();
	await testFleetDiscovery();
	console.log("simulated-device smoke test passed");
}

/** Creates a connected session over a fresh single-device AC500 runtime. */
async function connectedSession(deviceOptions = {}, timeoutMs = undefined) {
	const device = new SimulatedBluettiDevice({
		model: "AC500",
		address: "00:11:22:33:44:55",
		dynamicValues: false,
		notifyDelayMs: 1,
		...deviceOptions,
	});
	const runtime = createSimulatedRuntime([device]);
	const transport = runtime.transportFactory.create();
	const session = new DeviceSession(device.address, transport, timeoutMs);
	await session.connectAndInitialize();
	return { device, session };
}

/** Session reaches Ready and the advertised name maps to a registry model. */
async function testConnectAndInitialize() {
	const { session } = await connectedSession();
	assert.equal(session.state, DeviceSessionState.Ready);
	assert.equal(session.name, "AC5002401234567890");
	assert.equal(isSupportedBluettiName(session.name), true);

	const model = createDeviceFromAdvertisement(session.address, session.name);
	assert.equal(model.type, "AC500");
	assert.equal(model.serialNumber, "2401234567890");
	await session.disconnect();
}

/** A real polling window returns CRC-valid, parseable seeded telemetry. */
async function testSeededTelemetryRoundTrip() {
	const { session } = await connectedSession();
	const model = createDeviceFromAdvertisement(session.address, session.name);

	const command = new ReadHoldingRegisters(10, 40);
	const response = await session.perform(command);
	assert.equal(command.isValidResponse(response), true);

	const parsed = model.parse(
		command.startingAddress,
		command.parseResponse(response),
	);
	assert.equal(parsed.device_type, "AC500");
	assert.equal(parsed.serial_number, 2401234567890n);
	assert.equal(parsed.total_battery_percent, 88);
	assert.equal(parsed.ac_output_on, true);
	assert.equal(parsed.ac_output_power, 350);
	await session.disconnect();
}

/** Responses longer than chunkSize assemble from multiple notifications. */
async function testResponseChunking() {
	const chunks = [];
	const device = new SimulatedBluettiDevice({
		model: "AC500",
		address: "00:11:22:33:44:55",
		dynamicValues: false,
		notifyDelayMs: 1,
		chunkSize: 8,
	});
	const runtime = createSimulatedRuntime([device]);
	const transport = runtime.transportFactory.create();

	// Observe raw notification sizes through a wrapped subscribe.
	const originalSubscribe = transport.subscribe.bind(transport);
	transport.subscribe = (uuid, onData) =>
		originalSubscribe(uuid, (data) => {
			chunks.push(data.length);
			onData(data);
		});

	const session = new DeviceSession(device.address, transport);
	await session.connectAndInitialize();

	const command = new ReadHoldingRegisters(10, 40);
	const response = await session.perform(command);
	assert.equal(response.length, command.responseSize());
	assert.equal(chunks.length, Math.ceil(command.responseSize() / 8));
	assert.ok(chunks.every((size) => size <= 8));
	await session.disconnect();
}

/** A writable-field setter echoes correctly and persists to later reads. */
async function testSetterRoundTrip() {
	const { device, session } = await connectedSession();
	const model = createDeviceFromAdvertisement(session.address, session.name);

	assert.equal(device.registers.get(3007), 1);
	const setter = model.buildSetterCommand("ac_output_on", false);
	const echo = await session.perform(setter);
	assert.equal(setter.isValidResponse(echo), true);
	assert.equal(device.registers.get(3007), 0);

	const readBack = new ReadHoldingRegisters(3001, 61);
	const parsed = model.parse(
		readBack.startingAddress,
		readBack.parseResponse(await session.perform(readBack)),
	);
	assert.equal(parsed.ac_output_on, false);
	await session.disconnect();
}

/** Unsupported MODBUS function codes surface as ModbusError. */
async function testUnknownFunctionCodeRejected() {
	const { session } = await connectedSession();

	class UnsupportedCommand extends DeviceCommand {
		constructor() {
			super(0x08, new Uint8Array([0x00, 0x00]));
		}

		responseSize() {
			return 7;
		}
	}

	await assert.rejects(
		session.perform(new UnsupportedCommand()),
		(error) => error instanceof ModbusError && error.code === 1,
	);
	await session.disconnect();
}

/** Queued exceptions and dropped responses reach the typed error paths. */
async function testFaultInjection() {
	const { device, session } = await connectedSession({}, 100);

	device.queueException(5);
	await assert.rejects(
		session.perform(new ReadHoldingRegisters(10, 40)),
		(error) => error instanceof DeviceBusyError,
	);

	device.dropNextResponse();
	await assert.rejects(
		session.perform(new ReadHoldingRegisters(10, 40)),
		(error) => error instanceof CommandTimeoutError,
	);
	await session.disconnect();
}

/** Fleet discovery lists every simulated device with deterministic addresses. */
async function testFleetDiscovery() {
	const fleet = createSimulatedFleet(["AC500", "EB3A"]);
	const runtime = createSimulatedRuntime(fleet);
	const devices = await runtime.discovery.discover();

	assert.equal(devices.length, 2);
	assert.equal(devices[0].address, "00:11:22:33:44:55");
	assert.equal(devices[1].address, "00:11:22:33:44:56");
	assert.ok(devices[0].name.startsWith("AC500"));
	assert.ok(devices[1].name.startsWith("EB3A"));
	assert.ok(devices.every((device) => isSupportedBluettiName(device.name)));

	assert.throws(
		() => createSimulatedFleet(["NOTAMODEL"]),
		/Unknown simulated device model/,
	);
}

await run();
