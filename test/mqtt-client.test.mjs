import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { BluettiMqttBridge } from "../dist/mqtt/client.js";
import { EventBus } from "../dist/core/event-bus.js";
import { ReadHoldingRegisters, WriteSingleRegister } from "../dist/core/commands.js";
import { BluettiDevice } from "../dist/devices/device.js";
import { DeviceStruct } from "../dist/devices/struct.js";

async function run() {
  await testPublishesStateTopics();
  await testDispatchesIncomingCommand();
  await testRejectsUnknownDeviceCommand();
  await testRejectsNonWritableFieldCommand();
  await testRejectsInvalidCommandPayloads();
  console.log("mqtt bridge smoke test passed");
}

async function testPublishesStateTopics() {
  const bus = new EventBus();
  const mqtt = new FakeRawMqttClient();
  const bridge = new BluettiMqttBridge(
    bus,
    { url: "mqtt://unit-test" },
    async () => mqtt,
    silentLogger,
  );

  await bridge.run();

  const device = createTestDevice();
  await bus.publishParserMessage({
    device,
    parsed: {
      charge_enabled: true,
      output_power: 42,
      mode: { name: "eco", value: 2 },
      waveform: [1, 2, 3],
      serial_number: 1234567890123456789n,
    },
  });

  assert.deepEqual(mqtt.subscriptions, ["bluetti/command/#"]);
  assert.deepEqual(mqtt.published, [
    {
      topic: "bluetti/state/TEST-1234567890/charge_enabled",
      payload: "ON",
    },
    {
      topic: "bluetti/state/TEST-1234567890/output_power",
      payload: "42",
    },
    {
      topic: "bluetti/state/TEST-1234567890/mode",
      payload: "eco",
    },
    {
      topic: "bluetti/state/TEST-1234567890/waveform",
      payload: "[1,2,3]",
    },
    {
      topic: "bluetti/state/TEST-1234567890/serial_number",
      payload: "1234567890123456789",
    },
    {
      topic: "bluetti/state/TEST-1234567890/_raw",
      payload: JSON.stringify({
        charge_enabled: true,
        output_power: 42,
        mode: "eco",
        waveform: [1, 2, 3],
        serial_number: "1234567890123456789",
      }),
    },
  ]);

  await bridge.stop();
  assert.equal(mqtt.ended, true);
}

async function testDispatchesIncomingCommand() {
  const bus = new EventBus();
  const mqtt = new FakeRawMqttClient();
  const bridge = new BluettiMqttBridge(
    bus,
    { url: "mqtt://unit-test" },
    async () => mqtt,
    silentLogger,
  );

  const commands = [];
  bus.addCommandListener(async (message) => {
    commands.push(message.command);
  });

  await bridge.run();

  const device = createTestDevice();
  await bus.publishParserMessage({
    device,
    parsed: {
      charge_enabled: false,
    },
  });

  mqtt.emitMessage("bluetti/command/TEST-1234567890/charge_enabled", "ON");
  mqtt.emitMessage("bluetti/command/TEST-1234567890/output_power", "77");
  mqtt.emitMessage("bluetti/command/TEST-1234567890/mode", "eco");
  await flushAsync();

  assert.equal(commands.length, 3);
  assert.ok(commands[0] instanceof WriteSingleRegister);
  assert.equal(commands[0].address, 10);
  assert.equal(commands[0].value, 1);
  assert.equal(commands[1].address, 11);
  assert.equal(commands[1].value, 77);
  assert.equal(commands[2].address, 12);
  assert.equal(commands[2].value, 2);

  await bridge.stop();
}

async function testRejectsUnknownDeviceCommand() {
  const bus = new EventBus();
  const mqtt = new FakeRawMqttClient();
  const bridge = new BluettiMqttBridge(bus, { url: "mqtt://unit-test" }, async () => mqtt, silentLogger);
  const commands = [];
  bus.addCommandListener(async (message) => {
    commands.push(message.command);
  });

  await bridge.run();
  mqtt.emitMessage("bluetti/command/TEST-9999999999/charge_enabled", "ON");
  await flushAsync();
  assert.equal(commands.length, 0);
  await bridge.stop();
}

async function testRejectsNonWritableFieldCommand() {
  const bus = new EventBus();
  const mqtt = new FakeRawMqttClient();
  const bridge = new BluettiMqttBridge(bus, { url: "mqtt://unit-test" }, async () => mqtt, silentLogger);
  const commands = [];
  bus.addCommandListener(async (message) => {
    commands.push(message.command);
  });

  await bridge.run();
  await bus.publishParserMessage({
    device: createTestDevice(),
    parsed: { charge_enabled: true },
  });

  mqtt.emitMessage("bluetti/command/TEST-1234567890/read_only_status", "1");
  await flushAsync();
  assert.equal(commands.length, 0);
  await bridge.stop();
}

async function testRejectsInvalidCommandPayloads() {
  const bus = new EventBus();
  const mqtt = new FakeRawMqttClient();
  const bridge = new BluettiMqttBridge(bus, { url: "mqtt://unit-test" }, async () => mqtt, silentLogger);
  const commands = [];
  bus.addCommandListener(async (message) => {
    commands.push(message.command);
  });

  await bridge.run();
  await bus.publishParserMessage({
    device: createTestDevice(),
    parsed: { charge_enabled: true },
  });

  mqtt.emitMessage("bluetti/command/TEST-1234567890/charge_enabled", "maybe");
  mqtt.emitMessage("bluetti/command/TEST-1234567890/output_power", "7.5");
  mqtt.emitMessage("bluetti/command/TEST-1234567890/mode", "turbo");
  await flushAsync();
  assert.equal(commands.length, 0);
  await bridge.stop();
}

function createTestDevice() {
  const struct = new DeviceStruct()
    .addBoolField("charge_enabled", 10)
    .addUintField("output_power", 11)
    .addEnumField("mode", 12, { normal: 1, eco: 2 })
    .addUintField("read_only_status", 13);

  return new TestBluettiDevice("00:11:22:33:44:55", "TEST", "1234567890", struct);
}

async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

class TestBluettiDevice extends BluettiDevice {
  get pollingCommands() {
    return [new ReadHoldingRegisters(10, 3)];
  }

  get loggingCommands() {
    return [new ReadHoldingRegisters(10, 3)];
  }

  get writableRanges() {
    return [{ start: 10, endExclusive: 13 }];
  }
}

class FakeRawMqttClient extends EventEmitter {
  subscriptions = [];
  published = [];
  ended = false;

  async subscribe(topic) {
    this.subscriptions.push(topic);
  }

  async publish(topic, payload) {
    this.published.push({ topic, payload });
  }

  async endAsync() {
    this.ended = true;
  }

  emitMessage(topic, payload) {
    this.emit("message", topic, Buffer.from(payload, "utf8"));
  }
}

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

await run();
