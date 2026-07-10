import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	optionalSingleAddressArg,
	requireSingleAddressArg,
	validateBluetoothAddress,
} from "../dist/cli/args.js";
import { HelpError, UsageError } from "../dist/cli/errors.js";

const execFileAsync = promisify(execFile);

await run();

/**
 * Smoke-test runner for CLI argument parsing and config validation.
 *
 * Covers Bluetooth address normalisation, required/optional address arg
 * extraction, and end-to-end CLI invocations for help output, missing
 * broker, invalid interval, config help, invalid JSON, and invalid
 * config values.
 */
async function run() {
	testValidatesBluetoothAddress();
	testRejectsInvalidBluetoothAddress();
	testRequireSingleAddressArg();
	testOptionalSingleAddressArg();
	await testMqttCliHelp();
	await testMqttCliMissingBroker();
	await testMqttCliInvalidInterval();
	await testMqttCliConfigHelp();
	await testMqttCliInvalidConfigJson();
	await testMqttCliConfigTlsFiles();
	await testMqttCliRejectsInvalidConfigValues();
	console.log("cli shared smoke test passed");
}

/** Bluetooth addresses in colon, hyphen, or bare-hex format are normalised to uppercase colon form. */
function testValidatesBluetoothAddress() {
	assert.equal(
		validateBluetoothAddress("24:4c:ab:2c:24:8e"),
		"24:4C:AB:2C:24:8E",
	);
	assert.equal(
		validateBluetoothAddress("24-4c-ab-2c-24-8e"),
		"24:4C:AB:2C:24:8E",
	);
	assert.equal(validateBluetoothAddress("244cab2c248e"), "24:4C:AB:2C:24:8E");
}

/** An unparseable address string throws UsageError. */
function testRejectsInvalidBluetoothAddress() {
	assert.throws(() => validateBluetoothAddress("bad-mac"), UsageError);
}

/** requireSingleAddressArg returns the normalised address or throws UsageError/HelpError. */
function testRequireSingleAddressArg() {
	assert.equal(
		requireSingleAddressArg(["244cab2c248e"], "help"),
		"24:4C:AB:2C:24:8E",
	);
	assert.throws(() => requireSingleAddressArg([], "help"), UsageError);
	assert.throws(() => requireSingleAddressArg(["--help"], "help"), HelpError);
}

/** optionalSingleAddressArg returns undefined when no args are given, or throws on multiple args. */
function testOptionalSingleAddressArg() {
	assert.equal(optionalSingleAddressArg([], "help"), undefined);
	assert.equal(
		optionalSingleAddressArg(["24-4c-ab-2c-24-8e"], "help"),
		"24:4C:AB:2C:24:8E",
	);
	assert.throws(() => optionalSingleAddressArg(["a", "b"], "help"), UsageError);
}

/** The CLI --help flag prints usage text to stdout. */
async function testMqttCliHelp() {
	const result = await execFileAsync(
		"node",
		["./dist/cli/bluetti-mqtt.js", "--help"],
		{
			cwd: process.cwd(),
		},
	);
	assert.match(result.stdout, /Usage: bluetti-mqtt-node/);
}

/** Running the CLI without --broker prints usage to stderr and exits non-zero. */
async function testMqttCliMissingBroker() {
	const error = await captureExecError(
		execFileAsync(
			"node",
			["./dist/cli/bluetti-mqtt.js", "24:4C:AB:2C:24:8E"],
			{
				cwd: process.cwd(),
			},
		),
	);
	assert.match(error.stderr, /Usage: bluetti-mqtt-node/);
}

/** Running the CLI with a negative --interval prints usage to stderr. */
async function testMqttCliInvalidInterval() {
	const error = await captureExecError(
		execFileAsync(
			"node",
			[
				"./dist/cli/bluetti-mqtt.js",
				"--broker",
				"mqtt://127.0.0.1:1883",
				"--interval",
				"-1",
				"24:4C:AB:2C:24:8E",
			],
			{
				cwd: process.cwd(),
			},
		),
	);
	assert.match(error.stderr, /Usage: bluetti-mqtt-node/);
}

/** The CLI --config flag with --help prints usage to stdout. */
async function testMqttCliConfigHelp() {
	const result = await execFileAsync(
		"node",
		[
			"./dist/cli/bluetti-mqtt.js",
			"--config",
			"./config.example.json",
			"--help",
		],
		{
			cwd: process.cwd(),
		},
	);
	assert.match(result.stdout, /Usage: bluetti-mqtt-node/);
}

/** A config file with malformed JSON produces a "must be valid JSON" error on stderr. */
async function testMqttCliInvalidConfigJson() {
	const tempDir = await mkdtemp(join(tmpdir(), "bluetti-mqtt-node-"));
	const configPath = join(tempDir, "bad-config.json");
	await writeFile(configPath, "{not-valid-json", "utf8");

	const error = await captureExecError(
		execFileAsync(
			"node",
			["./dist/cli/bluetti-mqtt.js", "--config", configPath, "--help"],
			{
				cwd: process.cwd(),
			},
		),
	);
	assert.match(error.stderr, /must be valid JSON/);
}

/** TLS config entries are validated and PEM files are read even when --help exits early. */
async function testMqttCliConfigTlsFiles() {
	const tempDir = await mkdtemp(join(tmpdir(), "bluetti-mqtt-node-"));
	const caPath = join(tempDir, "ca.pem");
	const certPath = join(tempDir, "cert.pem");
	const keyPath = join(tempDir, "key.pem");
	const configPath = join(tempDir, "config.json");
	await writeFile(caPath, "ca-pem", "utf8");
	await writeFile(certPath, "cert-pem", "utf8");
	await writeFile(keyPath, "key-pem", "utf8");
	await writeFile(
		configPath,
		JSON.stringify({
			broker: "mqtts://127.0.0.1:8883",
			tls: {
				caPath,
				certPath,
				keyPath,
				rejectUnauthorized: false,
				servername: "broker.local",
			},
		}),
		"utf8",
	);

	const result = await execFileAsync(
		"node",
		["./dist/cli/bluetti-mqtt.js", "--config", configPath, "--help"],
		{
			cwd: process.cwd(),
		},
	);
	assert.match(result.stdout, /--mqtt-ca/);

	const missingConfigPath = join(tempDir, "missing-config.json");
	await writeFile(
		missingConfigPath,
		JSON.stringify({
			broker: "mqtts://127.0.0.1:8883",
			tls: { caPath: join(tempDir, "missing-ca.pem") },
		}),
		"utf8",
	);
	const error = await captureExecError(
		execFileAsync(
			"node",
			[
				"./dist/cli/bluetti-mqtt.js",
				"--config",
				missingConfigPath,
				"--help",
			],
			{
				cwd: process.cwd(),
			},
		),
	);
	assert.match(error.stderr, /Failed to read MQTT TLS CA file/);
}

/** A config file with semantically invalid values (interval range, address type, etc.) is rejected. */
async function testMqttCliRejectsInvalidConfigValues() {
	for (const config of [
		{ interval: -1 },
		{ interval: 3_000_000 },
		{ addresses: "24:4C:AB:2C:24:8E" },
		{ once: "yes" },
		{ logLevel: "verbose" },
		{ tls: "yes" },
		{ tls: { caPath: "" } },
		{ tls: { rejectUnauthorized: "no" } },
	]) {
		const tempDir = await mkdtemp(join(tmpdir(), "bluetti-mqtt-node-"));
		const configPath = join(tempDir, "bad-config.json");
		await writeFile(configPath, JSON.stringify(config), "utf8");

		const error = await captureExecError(
			execFileAsync(
				"node",
				["./dist/cli/bluetti-mqtt.js", "--config", configPath, "--help"],
				{
					cwd: process.cwd(),
				},
			),
		);
		assert.match(error.stderr, /invalid '.+' value/);
	}
}

/**
 * Awaits a promise that is expected to reject and returns the rejection reason.
 *
 * @param promise - A promise expected to reject.
 * @returns The rejection reason.
 * @throws If the promise resolves instead of rejecting.
 */
async function captureExecError(promise) {
	try {
		await promise;
	} catch (error) {
		return error;
	}

	throw new Error("Expected command to fail");
}
