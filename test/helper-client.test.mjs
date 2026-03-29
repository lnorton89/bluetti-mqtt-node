import assert from "node:assert/strict";
import { WindowsHelperClient } from "../dist/bluetooth/helper-client.js";

await run();

async function run() {
  testNotificationRouting();
  testErrorMapping();
  testMalformedJsonBeforeReady();
  console.log("helper client smoke test passed");
}

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

  assert.deepEqual(events, [{
    sessionId: "session-1",
    uuid: "0000ff01-0000-1000-8000-00805f9b34fb",
    data: new Uint8Array([1, 2, 3]),
  }]);
}

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

function testMalformedJsonBeforeReady() {
  const client = makeClientHarness();
  const readyErrors = [];
  client.handleLine("{not-json", () => {}, (error) => {
    readyErrors.push(error);
  });
  assert.equal(readyErrors.length, 1);
}

function makeClientHarness() {
  const client = Object.create(WindowsHelperClient.prototype);
  client.pending = new Map();
  client.notificationListeners = new Set();
  client.readyResolved = false;
  return client;
}
