import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { BasicMqttClient, BluettiMqttBridge } from "../dist/broker/client.js";
import { buildMqttConnectionOptions } from "../dist/broker/connection-options.js";
import {
	ReadHoldingRegisters,
	WriteSingleRegister,
} from "../dist/core/commands.js";
import { EventBus } from "../dist/core/event-bus.js";
import { BluettiDevice } from "../dist/devices/device.js";
import { DeviceStruct } from "../dist/devices/struct.js";

/**
 * Smoke-test runner for the MQTT bridge and basic client.
 *
 * Covers publishing parsed telemetry to MQTT state topics, dispatching
 * incoming MQTT commands to the event bus, rejecting unknown devices
 * or non-writable fields, validation of command payloads, startup
 * rollback on subscription failure, and async callback error reporting.
 */
async function run() {
	testBuildsConnectionOptions();
	await testPassesTlsOptionsToConnector();
	await testPublishesStateTopics();
	await testDispatchesIncomingCommand();
	await testRejectsUnknownDeviceCommand();
	await testRejectsNonWritableFieldCommand();
	await testRejectsInvalidCommandPayloads();
	await testStartupSubscriptionFailureRollsBackBridge();
	await testBasicClientReportsAsyncCallbackFailures();
	console.log("mqtt bridge smoke test passed");
}

/** MQTT option building maps auth and TLS settings without bridge lifecycle setup. */
function testBuildsConnectionOptions() {
	assert.deepEqual(buildMqttConnectionOptions({ url: "mqtt://unit-test" }), {});
	assert.deepEqual(
		buildMqttConnectionOptions({
			url: "mqtts://unit-test:8883",
			username: "user",
			password: "pass",
			tls: {
				ca: "ca-pem",
				cert: "cert-pem",
				key: "key-pem",
				rejectUnauthorized: false,
				servername: "broker.local",
			},
		}),
		{
			username: "user",
			password: "pass",
			ca: "ca-pem",
			cert: "cert-pem",
			key: "key-pem",
			rejectUnauthorized: false,
			servername: "broker.local",
		},
	);
}

/** MQTT connection options include optional TLS material when configured. */
async function testPassesTlsOptionsToConnector() {
	const bus = new EventBus();
	const mqtt = new FakeRawMqttClient();
	const connections = [];
	const bridge = new BluettiMqttBridge(
		bus,
		{
			url: "mqtts://unit-test:8883",
			username: "user",
			password: "pass",
			tls: {
				ca: "ca-pem",
				cert: "cert-pem",
				key: "key-pem",
				rejectUnauthorized: false,
				servername: "broker.local",
			},
		},
		async (url, options) => {
			connections.push({ url, options });
			return mqtt;
		},
		silentLogger,
	);

	await bridge.run();
	await bridge.stop();

	assert.deepEqual(connections, [
		{
			url: "mqtts://unit-test:8883",
			options: {
				username: "user",
				password: "pass",
				ca: "ca-pem",
				cert: "cert-pem",
				key: "key-pem",
				rejectUnauthorized: false,
				servername: "broker.local",
			},
		},
	]);
}

/** Parsed telemetry is published to individual MQTT state topics plus a _raw JSON topic. */
async function testPublishesStateTopics() {
	const bus = new EventBus();
	const mqtt = new FakeRawMqttClient();
	const bridge = new BluettiMqttBridge(
		bus,
		{ url: "mqtt://unit-test" },
		async () => mqtt,
		silentLogger,
	);

	await bridge.run();

	const device = createTestDevice();
	await bus.publishParserMessage({
		device,
		parsed: {
			charge_enabled: true,
			output_power: 42,
			mode: { name: "eco", value: 2 },
			waveform: [1, 2, 3],
			serial_number: 1234567890123456789n,
		},
	});

	assert.deepEqual(mqtt.subscriptions, ["bluetti/command/#"]);
	assert.deepEqual(mqtt.published, [
		{
			topic: "bluetti/state/TEST-1234567890/charge_enabled",
			payload: "ON",
		},
		{
			topic: "bluetti/state/TEST-1234567890/output_power",
			payload: "42",
		},
		{
			topic: "bluetti/state/TEST-1234567890/mode",
			payload: "eco",
		},
		{
			topic: "bluetti/state/TEST-1234567890/waveform",
			payload: "[1,2,3]",
		},
		{
			topic: "bluetti/state/TEST-1234567890/serial_number",
			payload: "1234567890123456789",
		},
		{
			topic: "bluetti/state/TEST-1234567890/_raw",
			payload: JSON.stringify({
				charge_enabled: true,
				output_power: 42,
				mode: "eco",
				waveform: [1, 2, 3],
				serial_number: "1234567890123456789",
			}),
		},
	]);

	await bridge.stop();
	assert.equal(mqtt.ended, true);
}

/** Incoming MQTT commands are dispatched as WriteSingleRegister commands on the event bus. */
async function testDispatchesIncomingCommand() {
	const bus = new EventBus();
	const mqtt = new FakeRawMqttClient();
	const bridge = new BluettiMqttBridge(
		bus,
		{ url: "mqtt://unit-test" },
		async () => mqtt,
		silentLogger,
	);

	const commands = [];
	bus.addCommandListener(async (message) => {
		commands.push(message.command);
	});

	await bridge.run();

	const device = createTestDevice();
	await bus.publishParserMessage({
		device,
		parsed: {
			charge_enabled: false,
		},
	});

	mqtt.emitMessage("bluetti/command/TEST-1234567890/charge_enabled", "ON");
	mqtt.emitMessage("bluetti/command/TEST-1234567890/output_power", "77");
	mqtt.emitMessage("bluetti/command/TEST-1234567890/mode", "eco");
	await flushAsync();

	assert.equal(commands.length, 3);
	assert.ok(commands[0] instanceof WriteSingleRegister);
	assert.equal(commands[0].address, 10);
	assert.equal(commands[0].value, 1);
	assert.equal(commands[1].address, 11);
	assert.equal(commands[1].value, 77);
	assert.equal(commands[2].address, 12);
	assert.equal(commands[2].value, 2);

	await bridge.stop();
}

/** Commands referencing an unknown device serial are silently dropped. */
async function testRejectsUnknownDeviceCommand() {
	const bus = new EventBus();
	const mqtt = new FakeRawMqttClient();
	const bridge = new BluettiMqttBridge(
		bus,
		{ url: "mqtt://unit-test" },
		async () => mqtt,
		silentLogger,
	);
	const commands = [];
	bus.addCommandListener(async (message) => {
		commands.push(message.command);
	});

	await bridge.run();
	mqtt.emitMessage("bluetti/command/TEST-9999999999/charge_enabled", "ON");
	await flushAsync();
	assert.equal(commands.length, 0);
	await bridge.stop();
}

/** Commands targeting a field outside the device's writable ranges are silently dropped. */
async function testRejectsNonWritableFieldCommand() {
	const bus = new EventBus();
	const mqtt = new FakeRawMqttClient();
	const bridge = new BluettiMqttBridge(
		bus,
		{ url: "mqtt://unit-test" },
		async () => mqtt,
		silentLogger,
	);
	const commands = [];
	bus.addCommandListener(async (message) => {
		commands.push(message.command);
	});

	await bridge.run();
	await bus.publishParserMessage({
		device: createTestDevice(),
		parsed: { charge_enabled: true },
	});

	mqtt.emitMessage("bluetti/command/TEST-1234567890/read_only_status", "1");
	await flushAsync();
	assert.equal(commands.length, 0);
	await bridge.stop();
}

/** Commands with unparseable payloads (non-boolean, non-integer, unknown enum) are silently dropped. */
async function testRejectsInvalidCommandPayloads() {
	const bus = new EventBus();
	const mqtt = new FakeRawMqttClient();
	const bridge = new BluettiMqttBridge(
		bus,
		{ url: "mqtt://unit-test" },
		async () => mqtt,
		silentLogger,
	);
	const commands = [];
	bus.addCommandListener(async (message) => {
		commands.push(message.command);
	});

	await bridge.run();
	await bus.publishParserMessage({
		device: createTestDevice(),
		parsed: { charge_enabled: true },
	});

	mqtt.emitMessage("bluetti/command/TEST-1234567890/charge_enabled", "maybe");
	mqtt.emitMessage("bluetti/command/TEST-1234567890/output_power", "7.5");
	mqtt.emitMessage("bluetti/command/TEST-1234567890/mode", "turbo");
	await flushAsync();
	assert.equal(commands.length, 0);
	await bridge.stop();
}

/** If MQTT subscription fails at startup the bridge disconnects and publishes nothing. */
async function testStartupSubscriptionFailureRollsBackBridge() {
	const bus = new EventBus();
	const mqtt = new FakeRawMqttClient();
	mqtt.subscribeError = new Error("subscribe failed");
	const bridge = new BluettiMqttBridge(
		bus,
		{ url: "mqtt://unit-test" },
		async () => mqtt,
		silentLogger,
	);

	await assert.rejects(bridge.run(), /subscribe failed/);
	await bus.publishParserMessage({
		device: createTestDevice(),
		parsed: { output_power: 42 },
	});

	assert.equal(mqtt.ended, true);
	assert.deepEqual(mqtt.published, []);
}

/** Async callback failures in BasicMqttClient are reported to the configured error handler. */
async function testBasicClientReportsAsyncCallbackFailures() {
	const rawClient = new FakeBasicRawMqttClient();
	const failures = [];
	const client = new BasicMqttClient(rawClient, (error, message) => {
		failures.push({ error, message });
	});
	await client.subscribe("test/topic", async () => {
		throw new Error("callback failed");
	});

	rawClient.emit("message", "test/topic", Buffer.from("payload"));
	await flushAsync();

	assert.equal(failures.length, 1);
	assert.match(String(failures[0].error), /callback failed/);
	assert.equal(failures[0].message.topic, "test/topic");
}

/** Creates a test device with bool, uint, enum, and read-only fields for bridge tests. */
function createTestDevice() {
	const struct = new DeviceStruct()
		.addBoolField("charge_enabled", 10)
		.addUintField("output_power", 11)
		.addEnumField("mode", 12, { normal: 1, eco: 2 })
		.addUintField("read_only_status", 13);

	return new TestBluettiDevice(
		"00:11:22:33:44:55",
		"TEST",
		"1234567890",
		struct,
	);
}

/** Flushes pending microtasks so async callbacks can settle. */
async function flushAsync() {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Minimal BluettiDevice subclass for MQTT bridge testing. */
class TestBluettiDevice extends BluettiDevice {
	get pollingCommands() {
		return [new ReadHoldingRegisters(10, 3)];
	}

	get loggingCommands() {
		return [new ReadHoldingRegisters(10, 3)];
	}

	get writableRanges() {
		return [{ start: 10, endExclusive: 13 }];
	}
}

/** Stub raw MQTT client that records subscriptions and published messages in memory. */
class FakeRawMqttClient extends EventEmitter {
	subscriptions = [];
	published = [];
	ended = false;
	subscribeError = null;

	async subscribe(topic) {
		if (this.subscribeError) throw this.subscribeError;
		this.subscriptions.push(topic);
	}

	async publish(topic, payload) {
		this.published.push({ topic, payload });
	}

	async endAsync() {
		this.ended = true;
	}

	emitMessage(topic, payload) {
		this.emit("message", topic, Buffer.from(payload, "utf8"));
	}
}

/** Stub raw MQTT client that provides no-op subscribe/publish for BasicMqttClient testing. */
class FakeBasicRawMqttClient extends EventEmitter {
	async subscribeAsync() {}
	async publishAsync() {}
}

/** Suppresses all log output during MQTT bridge tests. */
const silentLogger = {
	debug() {},
	info() {},
	warn() {},
	error() {},
};

await run();
