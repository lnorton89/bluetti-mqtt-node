import assert from "node:assert/strict";
import { BadConnectionError } from "../dist/bluetooth/errors.js";
import { sendHelperRequest } from "../dist/bluetooth/helper-request.js";

async function run() {
	await testSendsJsonLineAndResolvesCorrelatedResponse();
	await testRejectsDisposedClientBeforeWriting();
	await testTimeoutRemovesPendingRequest();
	await testWriteFailureRemovesPendingRequest();
	console.log("helper request smoke test passed");
}

/** Requests are framed as JSON lines and resolved through the pending map. */
async function testSendsJsonLineAndResolvesCorrelatedResponse() {
	const pending = new Map();
	const stdin = new FakeStdin();
	const response = sendHelperRequest({
		disposed: false,
		ready: Promise.resolve(),
		pending,
		stdin,
		command: "connect",
		argumentsObject: { address: "00:11:22:33:44:55" },
		timeoutMs: 30_000,
	});
	await Promise.resolve();

	assert.equal(stdin.lines.length, 1);
	const request = JSON.parse(stdin.lines[0]);
	assert.equal(request.command, "connect");
	assert.deepEqual(request.arguments, { address: "00:11:22:33:44:55" });
	assert.equal(typeof request.id, "string");
	assert.equal(pending.size, 1);

	const entry = pending.get(request.id);
	clearTimeout(entry.timeout);
	pending.delete(request.id);
	entry.resolve({ ok: true });

	assert.deepEqual(await response, { ok: true });
	assert.equal(pending.size, 0);
}

/** Disposed clients reject before touching stdin or pending correlation state. */
async function testRejectsDisposedClientBeforeWriting() {
	const pending = new Map();
	const stdin = new FakeStdin();

	await assert.rejects(
		sendHelperRequest({
			disposed: true,
			ready: Promise.resolve(),
			pending,
			stdin,
			command: "scan",
			timeoutMs: 30_000,
		}),
		/Windows BLE helper disposed/,
	);

	assert.equal(stdin.lines.length, 0);
	assert.equal(pending.size, 0);
}

/** Request deadlines reject as BadConnectionError and remove pending state. */
async function testTimeoutRemovesPendingRequest() {
	const pending = new Map();
	const stdin = new FakeStdin();

	await assert.rejects(
		sendHelperRequest({
			disposed: false,
			ready: Promise.resolve(),
			pending,
			stdin,
			command: "readCharacteristic",
			timeoutMs: 0,
		}),
		(error) => error instanceof BadConnectionError,
	);

	assert.equal(pending.size, 0);
}

/** A synchronous stdin write failure rolls back pending state. */
async function testWriteFailureRemovesPendingRequest() {
	const pending = new Map();
	const stdin = new FakeStdin();
	stdin.error = new Error("stdin failed");

	await assert.rejects(
		sendHelperRequest({
			disposed: false,
			ready: Promise.resolve(),
			pending,
			stdin,
			command: "scan",
			timeoutMs: 30_000,
		}),
		/stdin failed/,
	);

	assert.equal(pending.size, 0);
}

class FakeStdin {
	lines = [];
	error = null;

	write(line) {
		if (this.error !== null) {
			throw this.error;
		}
		this.lines.push(line);
	}
}

await run();
