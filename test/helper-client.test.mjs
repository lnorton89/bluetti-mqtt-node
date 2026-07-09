import assert from "node:assert/strict";
import { BadConnectionError } from "../dist/bluetooth/errors.js";
import {
	createWindowsHelperRuntime,
	WindowsHelperClient,
} from "../dist/bluetooth/helper-client.js";

/**
 * Smoke-test runner for the Windows BLE helper client and its transport.
 *
 * Covers notification routing, error-to-exception mapping (including GATT
 * unreachable and disposed-object detection), malformed JSON handling, and
 * transport-level subscribe/disconnect/connect rollback behaviour.
 */
async function run() {
	testNotificationRouting();
	testErrorMapping();
	testDisposedObjectErrorMapping();
	testGattUnreachableErrorMapping();
	testGattWriteUnreachableErrorMapping();
	testMalformedJsonBeforeReady();
	await testPublicRequestMethodsValidatePayloads();
	await testScanFiltersMalformedDevices();
	await testTransportSubscribeRollsBackCallback();
	await testTransportDisconnectCleansLocalStateOnFailure();
	await testTransportConnectRollsBackWhenNotificationWiringFails();
	console.log("helper client smoke test passed");
}

/** A helper "notification" event is routed to registered listeners with base64-decoded data. */
function testNotificationRouting() {
	const client = makeClientHarness();
	const events = [];
	client.notificationListeners.add((event) => {
		events.push(event);
	});

	client.handleLine(
		JSON.stringify({
			type: "event",
			name: "notification",
			payload: {
				sessionId: "session-1",
				uuid: "0000ff01-0000-1000-8000-00805f9b34fb",
				dataBase64: Buffer.from([1, 2, 3]).toString("base64"),
			},
		}),
		() => {},
		() => {},
	);

	assert.deepEqual(events, [
		{
			sessionId: "session-1",
			uuid: "0000ff01-0000-1000-8000-00805f9b34fb",
			data: new Uint8Array([1, 2, 3]),
		},
	]);
}

/** A helper "error" response with a generic command_failed code is mapped to a plain Error. */
function testErrorMapping() {
	const client = makeClientHarness();
	const errors = [];
	client.pending.set("request-1", {
		resolve: () => {},
		reject: (error) => {
			errors.push(error);
		},
	});

	client.handleLine(
		JSON.stringify({
			type: "error",
			id: "request-1",
			error: {
				code: "command_failed",
				message: "bad address",
			},
		}),
		() => {},
		() => {},
	);

	assert.equal(errors.length, 1);
	assert.match(String(errors[0]), /command_failed: bad address/);
}

/** A "Cannot access a disposed object" error is mapped to BadConnectionError. */
function testDisposedObjectErrorMapping() {
	const client = makeClientHarness();
	const errors = [];
	client.pending.set("request-1", {
		resolve: () => {},
		reject: (error) => {
			errors.push(error);
		},
	});

	client.handleLine(
		JSON.stringify({
			type: "error",
			id: "request-1",
			error: {
				code: "command_failed",
				message: "Cannot access a disposed object.",
			},
		}),
		() => {},
		() => {},
	);

	assert.equal(errors.length, 1);
	assert.ok(errors[0] instanceof BadConnectionError);
	assert.match(
		String(errors[0]),
		/command_failed: Cannot access a disposed object/,
	);
}

/** A GATT services unreachable error is mapped to BadConnectionError. */
function testGattUnreachableErrorMapping() {
	const client = makeClientHarness();
	const errors = [];
	client.pending.set("request-1", {
		resolve: () => {},
		reject: (error) => {
			errors.push(error);
		},
	});

	client.handleLine(
		JSON.stringify({
			type: "error",
			id: "request-1",
			error: {
				code: "command_failed",
				message: "Failed to enumerate GATT services: Unreachable.",
			},
		}),
		() => {},
		() => {},
	);

	assert.equal(errors.length, 1);
	assert.ok(errors[0] instanceof BadConnectionError);
	assert.match(
		String(errors[0]),
		/command_failed: Failed to enumerate GATT services: Unreachable/,
	);
}

/** A GATT characteristic write unreachable error is mapped to BadConnectionError. */
function testGattWriteUnreachableErrorMapping() {
	const client = makeClientHarness();
	const errors = [];
	client.pending.set("request-1", {
		resolve: () => {},
		reject: (error) => {
			errors.push(error);
		},
	});

	client.handleLine(
		JSON.stringify({
			type: "error",
			id: "request-1",
			error: {
				code: "command_failed",
				message:
					"Failed to write characteristic 0000ff02-0000-1000-8000-00805f9b34fb: Unreachable.",
			},
		}),
		() => {},
		() => {},
	);

	assert.equal(errors.length, 1);
	assert.ok(errors[0] instanceof BadConnectionError);
}

/** Malformed JSON before the helper signals ready triggers the error callback. */
function testMalformedJsonBeforeReady() {
	const client = makeClientHarness();
	const readyErrors = [];
	client.handleLine(
		"{not-json",
		() => {},
		(error) => {
			readyErrors.push(error);
		},
	);
	assert.equal(readyErrors.length, 1);
}

/** Creates a minimal WindowsHelperClient instance without a subprocess for unit testing. */
function makeClientHarness() {
	const client = Object.create(WindowsHelperClient.prototype);
	client.pending = new Map();
	client.notificationListeners = new Set();
	client.readyResolved = false;
	client.requestTimeoutMs = 30_000;
	return client;
}

/** Public helper methods translate request payloads and reject malformed helper responses. */
async function testPublicRequestMethodsValidatePayloads() {
	const client = makeRequestHarness({
		connect: {
			sessionId: "session-1",
			address: "00:11:22:33:44:55",
			name: "AC500123",
		},
		readCharacteristic: {
			dataBase64: Buffer.from([4, 5, 6]).toString("base64"),
		},
	});

	assert.deepEqual(await client.connect("00:11:22:33:44:55"), {
		sessionId: "session-1",
		address: "00:11:22:33:44:55",
		name: "AC500123",
	});
	assert.deepEqual(
		await client.readCharacteristic("session-1", "read-uuid"),
		new Uint8Array([4, 5, 6]),
	);
	await client.writeCharacteristic(
		"session-1",
		"write-uuid",
		new Uint8Array([1, 2]),
		false,
	);
	await client.subscribe("session-1", "notify-uuid");
	await client.disconnect("session-1");

	assert.deepEqual(client.calls, [
		["connect", { address: "00:11:22:33:44:55" }, undefined],
		[
			"readCharacteristic",
			{ sessionId: "session-1", uuid: "read-uuid" },
			undefined,
		],
		[
			"writeCharacteristic",
			{
				sessionId: "session-1",
				uuid: "write-uuid",
				dataBase64: Buffer.from([1, 2]).toString("base64"),
				withoutResponse: false,
			},
			undefined,
		],
		["subscribe", { sessionId: "session-1", uuid: "notify-uuid" }, undefined],
		["disconnect", { sessionId: "session-1" }, undefined],
	]);

	await assert.rejects(
		makeRequestHarness({ connect: { sessionId: "session-1" } }).connect(
			"address",
		),
		/invalid connect payload/,
	);
	await assert.rejects(
		makeRequestHarness({ readCharacteristic: {} }).readCharacteristic(
			"session-1",
			"uuid",
		),
		/invalid readCharacteristic payload/,
	);
}

/** Scans return only well-formed devices and use the scan timeout plus buffer. */
async function testScanFiltersMalformedDevices() {
	const client = makeRequestHarness({
		scan: {
			devices: [
				{ address: "00:11:22:33:44:55", name: "AC500123" },
				{ address: "missing-name" },
				null,
				{ address: "AA:BB:CC:DD:EE:FF", name: "EB3A123" },
			],
		},
	});

	assert.deepEqual(await client.discover(), [
		{ address: "00:11:22:33:44:55", name: "AC500123" },
		{ address: "AA:BB:CC:DD:EE:FF", name: "EB3A123" },
	]);
	assert.deepEqual(await makeRequestHarness({ scan: {} }).scan(), []);
	assert.equal(client.calls[0][0], "scan");
	assert.deepEqual(client.calls[0][1], { timeoutMs: 5000 });
	assert.equal(client.calls[0][2], 30000);
}

/** Creates a helper client harness whose private request method is replaced by a recorder. */
function makeRequestHarness(responses) {
	const client = makeClientHarness();
	client.calls = [];
	client.request = async (command, argumentsObject, timeoutMs) => {
		client.calls.push([command, argumentsObject, timeoutMs]);
		return responses[command];
	};
	return client;
}

/** A subscription that fails on the helper side does not register the notification callback. */
async function testTransportSubscribeRollsBackCallback() {
	const client = new FakeHelperClient();
	const transport =
		createWindowsHelperRuntime(client).transportFactory.create();
	await transport.connect("00:11:22:33:44:55");
	client.subscribeError = new Error("subscribe failed");
	let notificationCount = 0;

	await assert.rejects(
		transport.subscribe("0000ff01-0000-1000-8000-00805f9b34fb", () => {
			notificationCount += 1;
		}),
		/subscribe failed/,
	);

	client.emitNotification("0000ff01-0000-1000-8000-00805f9b34fb");
	assert.equal(notificationCount, 0);
}

/** A disconnect that throws still clears local transport state and notification subscriptions. */
async function testTransportDisconnectCleansLocalStateOnFailure() {
	const client = new FakeHelperClient();
	const transport =
		createWindowsHelperRuntime(client).transportFactory.create();
	await transport.connect("00:11:22:33:44:55");
	let notificationCount = 0;
	await transport.subscribe("0000ff01-0000-1000-8000-00805f9b34fb", () => {
		notificationCount += 1;
	});
	client.disconnectError = new Error("disconnect failed");

	await assert.rejects(transport.disconnect(), /disconnect failed/);
	client.emitNotification("0000ff01-0000-1000-8000-00805f9b34fb");

	assert.equal(notificationCount, 0);
	await assert.rejects(
		transport.readCharacteristic("characteristic"),
		/not connected/,
	);
}

/** A connect that fails during notification wiring still issues a disconnect rollback. */
async function testTransportConnectRollsBackWhenNotificationWiringFails() {
	const client = new FakeHelperClient();
	client.notificationError = new Error("listener failed");
	const transport =
		createWindowsHelperRuntime(client).transportFactory.create();

	await assert.rejects(
		transport.connect("00:11:22:33:44:55"),
		/listener failed/,
	);

	assert.deepEqual(client.disconnectCalls, ["session-1"]);
	await assert.rejects(
		transport.readCharacteristic("characteristic"),
		/not connected/,
	);
}

/** Stub helper client that simulates connect, subscribe, disconnect, and notification flows. */
class FakeHelperClient {
	listeners = new Set();
	disconnectCalls = [];
	subscribeError = null;
	disconnectError = null;
	notificationError = null;

	async connect(address) {
		return { sessionId: "session-1", address, name: "AC5001234567890" };
	}

	async disconnect(sessionId) {
		this.disconnectCalls.push(sessionId);
		if (this.disconnectError) throw this.disconnectError;
	}

	onNotification(listener) {
		if (this.notificationError) throw this.notificationError;
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async subscribe() {
		if (this.subscribeError) throw this.subscribeError;
	}

	async readCharacteristic() {
		return new Uint8Array(0);
	}

	async writeCharacteristic() {}

	emitNotification(uuid) {
		for (const listener of this.listeners) {
			listener({ sessionId: "session-1", uuid, data: new Uint8Array([1]) });
		}
	}
}

await run();
