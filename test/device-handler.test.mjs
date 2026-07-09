import assert from "node:assert/strict";
import { DeviceHandler } from "../dist/app/device-handler.js";
import {
	BadConnectionError,
	CommandTimeoutError,
	ModbusError,
	ParseError,
} from "../dist/bluetooth/errors.js";
import { ReadHoldingRegisters } from "../dist/core/commands.js";
import { appendModbusCrc } from "../dist/core/crc.js";
import { EventBus } from "../dist/core/event-bus.js";
import { BluettiDevice } from "../dist/devices/device.js";
import { DeviceStruct } from "../dist/devices/struct.js";

/**
 * Smoke-test runner for DeviceHandler polling, error recovery, and lifecycle.
 *
 * Covers successful message publishing, graceful swallowing of expected
 * read errors, retry of recoverable startup errors, one-shot error
 * propagation, reconnection after polling connection loss, and stop
 * interruption during the poll-interval sleep.
 */
async function run() {
	await testPublishesParsedMessages();
	await testSwallowsExpectedReadErrors();
	await testRetriesRecoverableStartupErrorsUntilStopped();
	await testRunOncePropagatesRecoverableStartupErrors();
	await testReconnectsAfterPollingConnectionLoss();
	await testStopInterruptsSleep();
	console.log("device handler smoke test passed");
}

/** Parsed device telemetry is published to the event bus. */
async function testPublishesParsedMessages() {
	const manager = new FakeManager({
		"00:11:22:33:44:55": new FakeSession(
			new Map([[10, registers([1, 42, 2])]]),
		),
	});
	const bus = new EventBus();
	const published = [];
	bus.addParserListener(async (message) => {
		published.push(message);
	});

	const handler = new DeviceHandler(manager, bus, 0, true);
	await handler.connectAll();
	handler.devices.set("00:11:22:33:44:55", createTestDevice());
	await handler.pollOnce("00:11:22:33:44:55");

	assert.equal(published.length, 1);
	assert.equal(published[0].device.type, "TEST");
	assert.equal(published[0].parsed.ac_output_on, true);
	assert.equal(published[0].parsed.dc_output_on, false);
}

/** Expected read errors (timeout, parse, modbus, bad-connection) are swallowed without publishing. */
async function testSwallowsExpectedReadErrors() {
	for (const error of [
		new CommandTimeoutError("timeout"),
		new ParseError("parse"),
		new ModbusError("modbus"),
		new BadConnectionError("connection"),
	]) {
		const manager = new FakeManager({
			"00:11:22:33:44:55": new FakeSession(new Map(), error),
		});
		const bus = new EventBus();
		const published = [];
		bus.addParserListener(async (message) => {
			published.push(message);
		});

		const handler = new DeviceHandler(manager, bus, 0, true);
		await handler.connectAll();
		handler.devices.set("00:11:22:33:44:55", createTestDevice());
		await handler.pollOnce("00:11:22:33:44:55");
		assert.equal(published.length, 0);
	}
}

/** Recoverable startup errors are retried with a warning log until stop is called. */
async function testRetriesRecoverableStartupErrorsUntilStopped() {
	const manager = new FailingConnectManager(
		new BadConnectionError("command_failed: Cannot access a disposed object."),
	);
	const logger = new CapturingLogger();
	const handler = new DeviceHandler(
		manager,
		new EventBus(),
		10_000,
		false,
		logger,
	);

	const runPromise = handler.run();
	await flushAsync();
	await flushAsync();
	handler.stop();
	await runPromise;

	assert.equal(manager.connectAttempts, 1);
	assert.equal(logger.warnings.length, 1);
	assert.equal(
		logger.warnings[0].message,
		"Bluetooth startup failed; retrying",
	);
	assert.equal(
		logger.warnings[0].context.error,
		"command_failed: Cannot access a disposed object.",
	);
}

/** In runOnce mode a recoverable startup error is propagated as a rejection. */
async function testRunOncePropagatesRecoverableStartupErrors() {
	const error = new BadConnectionError(
		"command_failed: Cannot access a disposed object.",
	);
	const manager = new FailingConnectManager(error);
	const handler = new DeviceHandler(manager, new EventBus(), 0, true);

	await assert.rejects(handler.run(), error);
}

/** A BadConnectionError during polling triggers a manager reconnect and emits recovery logs. */
async function testReconnectsAfterPollingConnectionLoss() {
	const address = "00:11:22:33:44:55";
	const failingSession = new FakeSession(
		new Map(),
		new BadConnectionError("write unreachable"),
	);
	const recoveredSession = new FakeSession(
		new Map([[10, registers([1, 42, 2])]]),
	);
	const manager = new RecoveringManager(
		address,
		failingSession,
		recoveredSession,
	);
	const logger = new CapturingLogger();
	const handler = new DeviceHandler(
		manager,
		new EventBus(),
		10_000,
		false,
		logger,
	);

	const runPromise = handler.run();
	while (manager.reconnectAttempts === 0) {
		await flushAsync();
	}
	handler.stop();
	await runPromise;

	assert.equal(manager.reconnectAttempts, 1);
	assert.equal(manager.sessionsByAddress[address], recoveredSession);
	assert.equal(
		logger.warnings[0].message,
		"Bluetooth connection lost; reconnecting",
	);
	assert.equal(logger.infos[0].message, "Bluetooth connection recovered");
}

/** Creates a test device with bool and uint fields for handler polling tests. */
function createTestDevice() {
	const struct = new DeviceStruct()
		.addBoolField("ac_output_on", 10)
		.addUintField("output_power", 11)
		.addBoolField("dc_output_on", 12);

	return new TestBluettiDevice(
		"00:11:22:33:44:55",
		"TEST",
		"1234567890",
		struct,
	);
}

/** Calling stop while the handler is sleeping between polls exits the run loop immediately. */
async function testStopInterruptsSleep() {
	const manager = new FakeManager({
		"00:11:22:33:44:55": new FakeSession(
			new Map([[10, registers([1, 42, 2])]]),
		),
	});
	const bus = new EventBus();
	const handler = new DeviceHandler(manager, bus, 10_000, false);
	const runPromise = handler.run();
	await flushAsync();
	handler.stop();
	await runPromise;
}

/**
 * Converts an array of 16-bit register words into a big-endian byte buffer.
 *
 * @param words - Register values (each 0..0xFFFF).
 * @returns Big-endian `Uint8Array` of length `words.length * 2`.
 */
function registers(words) {
	const bytes = [];
	for (const word of words) {
		bytes.push((word >> 8) & 0xff, word & 0xff);
	}
	return new Uint8Array(bytes);
}

/** Flushes pending microtasks so async callbacks can settle. */
async function flushAsync() {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Manager stub that returns pre-configured sessions and provides a fixed device name. */
class FakeManager {
	constructor(sessionsByAddress) {
		this.addresses = Object.keys(sessionsByAddress);
		this.sessionsByAddress = sessionsByAddress;
	}

	async connectAll() {}

	getName() {
		return "AC5001234567890";
	}

	getSession(address) {
		return this.sessionsByAddress[address];
	}
}

/** Manager stub whose connectAll throws on every call, tracking attempt count. */
class FailingConnectManager extends FakeManager {
	connectAttempts = 0;

	constructor(errorToThrow) {
		super({});
		this.errorToThrow = errorToThrow;
	}

	async connectAll() {
		this.connectAttempts += 1;
		throw this.errorToThrow;
	}
}

/** Manager stub that swaps from a failing session to a recovered session on reconnect. */
class RecoveringManager extends FakeManager {
	reconnectAttempts = 0;

	constructor(address, failingSession, recoveredSession) {
		super({ [address]: failingSession });
		this.recoveredSession = recoveredSession;
	}

	async reconnect(address) {
		this.reconnectAttempts += 1;
		this.sessionsByAddress[address] = this.recoveredSession;
	}
}

/** Session stub that returns pre-configured register responses or throws a configured error. */
class FakeSession {
	constructor(responsesByAddress, errorToThrow) {
		this.responsesByAddress = responsesByAddress;
		this.errorToThrow = errorToThrow;
	}

	async perform(command) {
		if (this.errorToThrow) {
			throw this.errorToThrow;
		}

		if (command.functionCode === 6) {
			return new Uint8Array(8);
		}

		const registerBytes =
			this.responsesByAddress.get(command.startingAddress) ?? new Uint8Array(0);
		const body = new Uint8Array([
			0x01,
			0x03,
			registerBytes.length,
			...registerBytes,
		]);
		return appendModbusCrc(body);
	}
}

/** Minimal BluettiDevice subclass for handler testing with a simple field layout. */
class TestBluettiDevice extends BluettiDevice {
	get pollingCommands() {
		return [new ReadHoldingRegisters(10, 3)];
	}

	get loggingCommands() {
		return [new ReadHoldingRegisters(10, 3)];
	}
}

/** Logger that captures info and warning messages for post-hoc assertion. */
class CapturingLogger {
	warnings = [];
	infos = [];

	debug() {}

	info(message, context) {
		this.infos.push({ message, context });
	}

	warn(message, context) {
		this.warnings.push({ message, context });
	}

	error() {}
}

await run();
