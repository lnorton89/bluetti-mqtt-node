import assert from "node:assert/strict";
import {
	applyBusyBackoff,
	applyPackBusyBackoff,
	createDevicePollingState,
	DEFAULT_POLLING_OPTIONS,
} from "../dist/app/polling-state.js";

function run() {
	testPackBusyBackoffPreservesFastCadence();
	testGeneralBusyBackoffStillSlowsFastCadence();
	console.log("polling state smoke test passed");
}

/** Pack-only pressure slows full polling without degrading live telemetry. */
function testPackBusyBackoffPreservesFastCadence() {
	const state = createDevicePollingState(DEFAULT_POLLING_OPTIONS);

	applyPackBusyBackoff(state, DEFAULT_POLLING_OPTIONS);

	assert.equal(state.fastIntervalMs, 2_500);
	assert.equal(state.fullIntervalMs, 16_500);
	assert.equal(state.commandDelayMs, 200);
}

/** Busy responses from the main command set still protect the whole device. */
function testGeneralBusyBackoffStillSlowsFastCadence() {
	const state = createDevicePollingState(DEFAULT_POLLING_OPTIONS);

	applyBusyBackoff(state, DEFAULT_POLLING_OPTIONS);

	assert.equal(state.fastIntervalMs, 3_250);
	assert.equal(state.fullIntervalMs, 16_500);
	assert.equal(state.commandDelayMs, 200);
}

run();
