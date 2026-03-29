import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import {
  HelpError,
  UsageError,
  optionalSingleAddressArg,
  requireSingleAddressArg,
  validateBluetoothAddress,
} from "../dist/cli/shared.js";

const execFileAsync = promisify(execFile);

await run();

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
  console.log("cli shared smoke test passed");
}

function testValidatesBluetoothAddress() {
  assert.equal(validateBluetoothAddress("24:4c:ab:2c:24:8e"), "24:4C:AB:2C:24:8E");
  assert.equal(validateBluetoothAddress("24-4c-ab-2c-24-8e"), "24:4C:AB:2C:24:8E");
  assert.equal(validateBluetoothAddress("244cab2c248e"), "24:4C:AB:2C:24:8E");
}

function testRejectsInvalidBluetoothAddress() {
  assert.throws(() => validateBluetoothAddress("bad-mac"), UsageError);
}

function testRequireSingleAddressArg() {
  assert.equal(
    requireSingleAddressArg(["244cab2c248e"], "help"),
    "24:4C:AB:2C:24:8E",
  );
  assert.throws(() => requireSingleAddressArg([], "help"), UsageError);
  assert.throws(() => requireSingleAddressArg(["--help"], "help"), HelpError);
}

function testOptionalSingleAddressArg() {
  assert.equal(optionalSingleAddressArg([], "help"), undefined);
  assert.equal(optionalSingleAddressArg(["24-4c-ab-2c-24-8e"], "help"), "24:4C:AB:2C:24:8E");
  assert.throws(() => optionalSingleAddressArg(["a", "b"], "help"), UsageError);
}

async function testMqttCliHelp() {
  const result = await execFileAsync("node", [".\\dist\\cli\\bluetti-mqtt.js", "--help"], {
    cwd: process.cwd(),
  });
  assert.match(result.stdout, /Usage: bluetti-mqtt-node/);
}

async function testMqttCliMissingBroker() {
  const error = await captureExecError(
    execFileAsync("node", [".\\dist\\cli\\bluetti-mqtt.js", "24:4C:AB:2C:24:8E"], {
      cwd: process.cwd(),
    }),
  );
  assert.match(error.stderr, /Usage: bluetti-mqtt-node/);
}

async function testMqttCliInvalidInterval() {
  const error = await captureExecError(
    execFileAsync("node", [
      ".\\dist\\cli\\bluetti-mqtt.js",
      "--broker",
      "mqtt://127.0.0.1:1883",
      "--interval",
      "-1",
      "24:4C:AB:2C:24:8E",
    ], {
      cwd: process.cwd(),
    }),
  );
  assert.match(error.stderr, /Usage: bluetti-mqtt-node/);
}

async function testMqttCliConfigHelp() {
  const result = await execFileAsync("node", [
    ".\\dist\\cli\\bluetti-mqtt.js",
    "--config",
    ".\\config.example.json",
    "--help",
  ], {
    cwd: process.cwd(),
  });
  assert.match(result.stdout, /Usage: bluetti-mqtt-node/);
}

async function testMqttCliInvalidConfigJson() {
  const tempDir = await mkdtemp(join(tmpdir(), "bluetti-mqtt-node-"));
  const configPath = join(tempDir, "bad-config.json");
  await writeFile(configPath, "{not-valid-json", "utf8");

  const error = await captureExecError(
    execFileAsync("node", [
      ".\\dist\\cli\\bluetti-mqtt.js",
      "--config",
      configPath,
      "--help",
    ], {
      cwd: process.cwd(),
    }),
  );
  assert.match(error.stderr, /must be valid JSON/);
}

async function captureExecError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected command to fail");
}
