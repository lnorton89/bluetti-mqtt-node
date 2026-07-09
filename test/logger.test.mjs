import assert from "node:assert/strict";
import { ConsoleLogger } from "../dist/core/logger.js";

await run();

/**
 * Smoke-test runner for ConsoleLogger output format, routing, and filtering.
 *
 * Covers JSON structure on stdout/stderr, level-based filtering above the
 * configured threshold, and BigInt-to-string normalization in context payloads.
 */
async function run() {
	testInfoLoggingWritesJson();
	testWarnLoggingUsesStderr();
	testLevelFiltering();
	testBigIntContextNormalization();
	console.log("logger smoke test passed");
}

/** Info-level output is written as a JSON line to stdout with level, message, context, and timestamp. */
function testInfoLoggingWritesJson() {
	const stdout = [];
	const stderr = [];
	const logger = withCapturedConsole(stdout, stderr, () => {
		const candidate = new ConsoleLogger("info");
		candidate.info("hello world", { address: "24:4C:AB:2C:24:8E" });
		return candidate;
	});

	assert.ok(logger instanceof ConsoleLogger);
	assert.equal(stdout.length, 1);

	const payload = JSON.parse(stdout[0]);
	assert.equal(payload.level, "info");
	assert.equal(payload.message, "hello world");
	assert.equal(payload.context.address, "24:4C:AB:2C:24:8E");
	assert.equal(typeof payload.timestamp, "string");
}

/** Warn-level output is written as a JSON line to stderr. */
function testWarnLoggingUsesStderr() {
	const stdout = [];
	const stderr = [];
	withCapturedConsole(stdout, stderr, () => {
		const logger = new ConsoleLogger("debug");
		logger.warn("careful now", { retry: true });
	});

	assert.equal(stderr.length, 1);
	const payload = JSON.parse(stderr[0]);
	assert.equal(payload.level, "warn");
	assert.equal(payload.context.retry, true);
}

/** Messages below the configured log level are silently dropped. */
function testLevelFiltering() {
	const stdout = [];
	const stderr = [];
	withCapturedConsole(stdout, stderr, () => {
		const logger = new ConsoleLogger("warn");
		logger.debug("hidden");
		logger.info("hidden");
		logger.warn("shown");
		logger.error("shown");
	});

	assert.equal(stdout.length, 0);
	assert.equal(stderr.length, 2);
}

/** BigInt values in context are serialised as strings to avoid JSON.stringify failures. */
function testBigIntContextNormalization() {
	const stdout = [];
	const stderr = [];
	withCapturedConsole(stdout, stderr, () => {
		const logger = new ConsoleLogger("debug");
		logger.debug("normalized", { serial: 1234567890123456789n });
	});

	const payload = JSON.parse(stdout[0]);
	assert.equal(payload.context.serial, "1234567890123456789");
}

/**
 * Temporarily replaces console.log/warn/error with capturing stubs.
 *
 * @param stdout - Array that receives console.log calls (as strings).
 * @param stderr - Array that receives console.warn and console.error calls (as strings).
 * @param callback - Function to run with captured console methods.
 * @returns The return value of `callback`.
 */
function withCapturedConsole(stdout, stderr, callback) {
	const originalLog = console.log;
	const originalWarn = console.warn;
	const originalError = console.error;

	console.log = (line) => {
		stdout.push(String(line));
	};
	console.warn = (line) => {
		stderr.push(String(line));
	};
	console.error = (line) => {
		stderr.push(String(line));
	};

	try {
		return callback();
	} finally {
		console.log = originalLog;
		console.warn = originalWarn;
		console.error = originalError;
	}
}
