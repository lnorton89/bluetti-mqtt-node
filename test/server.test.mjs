import assert from "node:assert/strict";
import { BluettiMqttServer } from "../dist/app/server.js";
import { BadConnectionError } from "../dist/bluetooth/errors.js";

/**
 * Smoke-test runner for BluettiMqttServer lifecycle and error handling.
 *
 * Verifies that disconnect failures during cleanup are downgraded to
 * warnings instead of propagating as hard errors.
 */
async function run() {
  await testCleanupErrorsAreWarnings();
  console.log("server smoke test passed");
}

/** A transport disconnect failure during server cleanup is logged as a warning. */
async function testCleanupErrorsAreWarnings() {
  const logger = new CapturingLogger();
  const server = new BluettiMqttServer({
    addresses: ["00:11:22:33:44:55"],
    transportFactory: new DisconnectFailingTransportFactory(
      new BadConnectionError("command_failed: Cannot access a disposed object."),
    ),
    mqtt: { url: "mock://broker" },
    runOnce: true,
    logger,
  });

  server.mqttBridge.run = async () => {};
  server.mqttBridge.stop = async () => {};

  await server.run();

  assert.equal(logger.warnings.length, 1);
  assert.equal(logger.warnings[0].message, "Bluetooth cleanup failed");
  assert.match(logger.warnings[0].context.error, /Cannot access a disposed object/);
}

/** Transport factory that always produces transports whose disconnect call fails. */
class DisconnectFailingTransportFactory {
  constructor(errorToThrow) {
    this.errorToThrow = errorToThrow;
  }

  create() {
    return new DisconnectFailingTransport(this.errorToThrow);
  }
}

/** Bluetooth transport whose disconnect method always throws. */
class DisconnectFailingTransport {
  constructor(errorToThrow) {
    this.errorToThrow = errorToThrow;
  }

  async connect() {}

  async disconnect() {
    throw this.errorToThrow;
  }

  async readCharacteristic(uuid) {
    if (uuid === "00002a00-0000-1000-8000-00805f9b34fb") {
      return Buffer.from("AC5001234567890", "ascii");
    }

    return new Uint8Array(0);
  }

  async writeCharacteristic() {}

  async subscribe() {}
}

/** Logger that captures warning messages for assertion. */
class CapturingLogger {
  warnings = [];

  debug() {}

  info() {}

  warn(message, context) {
    this.warnings.push({ message, context });
  }

  error() {}
}

await run();
