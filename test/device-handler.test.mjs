import assert from "node:assert/strict";
import { DeviceHandler } from "../dist/app/device-handler.js";
import { EventBus } from "../dist/core/event-bus.js";
import { ReadHoldingRegisters } from "../dist/core/commands.js";
import { appendModbusCrc } from "../dist/core/crc.js";
import { BluettiDevice } from "../dist/devices/device.js";
import { DeviceStruct } from "../dist/devices/struct.js";
import {
  BadConnectionError,
  CommandTimeoutError,
  ModbusError,
  ParseError,
} from "../dist/bluetooth/errors.js";

async function run() {
  await testPublishesParsedMessages();
  await testSwallowsExpectedReadErrors();
  await testStopInterruptsSleep();
  console.log("device handler smoke test passed");
}

async function testPublishesParsedMessages() {
  const manager = new FakeManager({
    "00:11:22:33:44:55": new FakeSession(new Map([[10, registers([1, 42, 2])]])),
  });
  const bus = new EventBus();
  const published = [];
  bus.addParserListener(async (message) => {
    published.push(message);
  });

  const handler = new DeviceHandler(manager, bus, 0, true);
  await handler.connectAll();
  handler.devices.set("00:11:22:33:44:55", createTestDevice());
  await handler.pollOnce("00:11:22:33:44:55");

  assert.equal(published.length, 1);
  assert.equal(published[0].device.type, "TEST");
  assert.equal(published[0].parsed.ac_output_on, true);
  assert.equal(published[0].parsed.dc_output_on, false);
}

async function testSwallowsExpectedReadErrors() {
  for (const error of [
    new CommandTimeoutError("timeout"),
    new ParseError("parse"),
    new ModbusError("modbus"),
    new BadConnectionError("connection"),
  ]) {
    const manager = new FakeManager({
      "00:11:22:33:44:55": new FakeSession(new Map(), error),
    });
    const bus = new EventBus();
    const published = [];
    bus.addParserListener(async (message) => {
      published.push(message);
    });

    const handler = new DeviceHandler(manager, bus, 0, true);
    await handler.connectAll();
    handler.devices.set("00:11:22:33:44:55", createTestDevice());
    await handler.pollOnce("00:11:22:33:44:55");
    assert.equal(published.length, 0);
  }
}

function createTestDevice() {
  const struct = new DeviceStruct()
    .addBoolField("ac_output_on", 10)
    .addUintField("output_power", 11)
    .addBoolField("dc_output_on", 12);

  return new TestBluettiDevice("00:11:22:33:44:55", "TEST", "1234567890", struct);
}

async function testStopInterruptsSleep() {
  const manager = new FakeManager({
    "00:11:22:33:44:55": new FakeSession(new Map([[10, registers([1, 42, 2])]])),
  });
  const bus = new EventBus();
  const handler = new DeviceHandler(manager, bus, 10_000, false);
  const runPromise = handler.run();
  await flushAsync();
  handler.stop();
  await runPromise;
}

function registers(words) {
  const bytes = [];
  for (const word of words) {
    bytes.push((word >> 8) & 0xff, word & 0xff);
  }
  return new Uint8Array(bytes);
}

async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeManager {
  constructor(sessionsByAddress) {
    this.addresses = Object.keys(sessionsByAddress);
    this.sessionsByAddress = sessionsByAddress;
  }

  async connectAll() {}

  getName() {
    return "AC5001234567890";
  }

  getSession(address) {
    return this.sessionsByAddress[address];
  }
}

class FakeSession {
  constructor(responsesByAddress, errorToThrow) {
    this.responsesByAddress = responsesByAddress;
    this.errorToThrow = errorToThrow;
  }

  async perform(command) {
    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    if (command.functionCode === 6) {
      return new Uint8Array(8);
    }

    const registerBytes = this.responsesByAddress.get(command.startingAddress) ?? new Uint8Array(0);
    const body = new Uint8Array([0x01, 0x03, registerBytes.length, ...registerBytes]);
    return appendModbusCrc(body);
  }
}

class TestBluettiDevice extends BluettiDevice {
  get pollingCommands() {
    return [new ReadHoldingRegisters(10, 3)];
  }

  get loggingCommands() {
    return [new ReadHoldingRegisters(10, 3)];
  }
}

await run();
