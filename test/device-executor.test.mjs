import assert from "node:assert/strict";
import { DeviceCommandRunner } from "../dist/app/device-executor.js";
import {
	BadConnectionError,
	CommandTimeoutError,
	DeviceBusyError,
} from "../dist/bluetooth/errors.js";
import { ReadHoldingRegisters } from "../dist/core/commands.js";
import { appendModbusCrc } from "../dist/core/crc.js";
import { EventBus } from "../dist/core/event-bus.js";
import { BluettiDevice } from "../dist/devices/device.js";
import { DeviceStruct } from "../dist/devices/struct.js";

async function run() {
	await testHandleCommandWritesThroughQueue();
	await testRunCommandSetPublishesTelemetryAndSleepsBetweenCommands();
	await testRunCommandSetClassifiesExpectedErrors();
	await testRunCommandSetStopsOnBusyAndConnectionErrors();
	await testRunPackCommandsSelectsPacksBeforeReading();
	await testRunPackCommandsSkipsPackAfterExpectedSelectionError();
	console.log("device executor smoke test passed");
}

/** External command handling serializes work and increments write telemetry. */
async function testHandleCommandWritesThroughQueue() {
	const device = createDevice();
	const command = device.buildSetterCommand("pack_num", 1);
	const session = new FakeSession();
	const harness = createRunnerHarness(session);

	await harness.runner.handleCommand({ device, command });

	assert.deepEqual(harness.queueAddresses, [device.address]);
	assert.deepEqual(session.performed, [command]);
	assert.equal(harness.telemetry.commandWriteCount, 1);
}

/** Successful command sets publish parsed telemetry and delay only between commands. */
async function testRunCommandSetPublishesTelemetryAndSleepsBetweenCommands() {
	const device = createDevice();
	const session = new FakeSession({
		readResponses: new Map([
			[10, registers([1])],
			[11, registers([42])],
		]),
	});
	const harness = createRunnerHarness(session);
	const published = [];
	harness.bus.addParserListener(async (message) => published.push(message));

	const result = await harness.runner.runCommandSet(
		device.address,
		device,
		[new ReadHoldingRegisters(10, 1), new ReadHoldingRegisters(11, 1)],
		{ commandDelayMs: 25 },
	);

	assert.equal(result, "ok");
	assert.equal(harness.telemetry.successfulCommandCount, 2);
	assert.equal(harness.telemetry.parserPublishCount, 2);
	assert.deepEqual(harness.sleeps, [25]);
	assert.deepEqual(
		published.map((message) => message.parsed),
		[{ ac_output_on: true }, { output_power: 42 }],
	);
}

/** Timeout-like expected read failures are aggregated without throwing. */
async function testRunCommandSetClassifiesExpectedErrors() {
	const device = createDevice();
	const harness = createRunnerHarness(
		new FakeSession({ error: new CommandTimeoutError("timeout") }),
	);

	const result = await harness.runner.runCommandSet(
		device.address,
		device,
		[new ReadHoldingRegisters(10, 1)],
		{ commandDelayMs: 0 },
	);

	assert.equal(result, "expected_error");
	assert.equal(harness.telemetry.expectedErrorCount, 1);
	assert.match(harness.telemetry.lastErrorAt, /^\d{4}-\d{2}-\d{2}T/);
}

/** Busy and connection read failures short-circuit with their specific result. */
async function testRunCommandSetStopsOnBusyAndConnectionErrors() {
	const device = createDevice();

	for (const [error, expectedResult] of [
		[new DeviceBusyError(), "busy"],
		[new BadConnectionError("unreachable"), "connection_error"],
	]) {
		const harness = createRunnerHarness(new FakeSession({ error }));
		const result = await harness.runner.runCommandSet(
			device.address,
			device,
			[new ReadHoldingRegisters(10, 1), new ReadHoldingRegisters(11, 1)],
			{ commandDelayMs: 1 },
		);

		assert.equal(result, expectedResult);
		assert.equal(harness.sleeps.length, 0);
	}
}

/** Pack polling writes pack_num before each pack read and applies the pack switch delay. */
async function testRunPackCommandsSelectsPacksBeforeReading() {
	const device = createDevice();
	const session = new FakeSession({
		readResponses: new Map([[12, registers([7])]]),
	});
	const harness = createRunnerHarness(session);

	const result = await harness.runner.runPackCommands(device.address, device, {
		commandDelayMs: 50,
	});

	assert.equal(result, "ok");
	assert.deepEqual(
		session.performed.map((command) =>
			command.functionCode === 6 ? ["write", command.address, command.value] : ["read", command.startingAddress],
		),
		[
			["write", 3006, 1],
			["read", 12],
			["write", 3006, 2],
			["read", 12],
		],
	);
	assert.deepEqual(harness.sleeps, [500, 500]);
}

/** Expected pack-selection errors skip that pack while allowing later packs to run. */
async function testRunPackCommandsSkipsPackAfterExpectedSelectionError() {
	const device = createDevice();
	const session = new FakeSession({
		readResponses: new Map([[12, registers([7])]]),
		writeErrors: [new CommandTimeoutError("pack switch timeout"), null],
	});
	const harness = createRunnerHarness(session);

	const result = await harness.runner.runPackCommands(device.address, device, {
		commandDelayMs: 0,
	});

	assert.equal(result, "ok");
	assert.deepEqual(
		session.performed.map((command) =>
			command.functionCode === 6 ? ["write", command.value] : ["read", command.startingAddress],
		),
		[
			["write", 1],
			["write", 2],
			["read", 12],
		],
	);
}

function createRunnerHarness(session) {
	const telemetry = createTelemetry();
	const bus = new EventBus();
	const queueAddresses = [];
	const sleeps = [];
	const manager = {
		getSession() {
			return session;
		},
	};
	const runner = new DeviceCommandRunner(
		manager,
		bus,
		() => telemetry,
		async (address, work) => {
			queueAddresses.push(address);
			return await work();
		},
		() => false,
		async (ms) => {
			sleeps.push(ms);
		},
	);

	return { bus, queueAddresses, runner, sleeps, telemetry };
}

function createTelemetry() {
	return {
		cycleCount: 0,
		fastCycleCount: 0,
		fullCycleCount: 0,
		successfulCommandCount: 0,
		expectedErrorCount: 0,
		busyErrorCount: 0,
		commandWriteCount: 0,
		parserPublishCount: 0,
		totalCycleDurationMs: 0,
		totalCommandDurationMs: 0,
		maxCycleDurationMs: 0,
		maxCommandDurationMs: 0,
		lastCycleStartedAt: null,
		lastCycleCompletedAt: null,
		lastBusyAt: null,
		lastErrorAt: null,
	};
}

function createDevice() {
	const struct = new DeviceStruct()
		.addBoolField("ac_output_on", 10)
		.addUintField("output_power", 11)
		.addUintField("pack_voltage", 12)
		.addUintField("pack_num", 3006);

	return new TestBluettiDevice(
		"00:11:22:33:44:55",
		"TEST",
		"1234567890",
		struct,
	);
}

function registers(words) {
	const bytes = [];
	for (const word of words) {
		bytes.push((word >> 8) & 0xff, word & 0xff);
	}
	return new Uint8Array(bytes);
}

function readResponse(registerBytes) {
	return appendModbusCrc(
		new Uint8Array([0x01, 0x03, registerBytes.length, ...registerBytes]),
	);
}

class FakeSession {
	performed = [];

	constructor({ error = null, readResponses = new Map(), writeErrors = [] } = {}) {
		this.error = error;
		this.readResponses = readResponses;
		this.writeErrors = writeErrors;
	}

	async perform(command) {
		this.performed.push(command);
		if (command.functionCode === 6) {
			const error = this.writeErrors.shift();
			if (error) {
				throw error;
			}
			return command.toBytes();
		}
		if (this.error) {
			throw this.error;
		}

		return readResponse(
			this.readResponses.get(command.startingAddress) ?? registers([0]),
		);
	}
}

class TestBluettiDevice extends BluettiDevice {
	get packNumMax() {
		return 2;
	}

	get pollingCommands() {
		return [new ReadHoldingRegisters(10, 1), new ReadHoldingRegisters(11, 1)];
	}

	get packPollingCommands() {
		return [new ReadHoldingRegisters(12, 1)];
	}

	get loggingCommands() {
		return this.pollingCommands;
	}

	get writableRanges() {
		return [{ start: 3006, endExclusive: 3007 }];
	}
}

await run();
