import assert from "node:assert/strict";
import { ConsoleLogger } from "../dist/core/logger.js";

await run();

async function run() {
  testInfoLoggingWritesJson();
  testWarnLoggingUsesStderr();
  testLevelFiltering();
  testBigIntContextNormalization();
  console.log("logger smoke test passed");
}

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

function withCapturedConsole(stdout, stderr, callback) {
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (line) => {
    stdout.push(String(line));
  };
  console.error = (line) => {
    stderr.push(String(line));
  };

  try {
    return callback();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}
