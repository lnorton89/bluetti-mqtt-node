/** Sequentially imports and runs all test modules. */
await import("./device-session.test.mjs");
await import("./mqtt-client.test.mjs");
await import("./device-setter.test.mjs");
await import("./struct.test.mjs");
await import("./cli-shared.test.mjs");
await import("./device-executor.test.mjs");
await import("./device-handler.test.mjs");
await import("./helper-client.test.mjs");
await import("./server.test.mjs");
await import("./logger.test.mjs");
await import("./devices.test.mjs");
