import assert from "node:assert/strict";
import { ReadHoldingRegisters, WriteSingleRegister } from "../dist/core/commands.js";
import { BluettiDevice } from "../dist/devices/device.js";
import { DeviceStruct } from "../dist/devices/struct.js";

async function run() {
  testBoolSetter();
  testIntegerSetter();
  testEnumSetterByName();
  testEnumSetterByNumber();
  testRejectsUnknownField();
  testRejectsWrongBoolType();
  testRejectsWrongIntegerType();
  testRejectsUnknownEnumOption();
  testRejectsReadOnlyField();
  console.log("device setter smoke test passed");
}

function testBoolSetter() {
  const command = createTestDevice().buildSetterCommand("charge_enabled", true);
  assert.ok(command instanceof WriteSingleRegister);
  assert.equal(command.address, 10);
  assert.equal(command.value, 1);
}

function testIntegerSetter() {
  const command = createTestDevice().buildSetterCommand("output_power", 42);
  assert.equal(command.address, 11);
  assert.equal(command.value, 42);
}

function testEnumSetterByName() {
  const command = createTestDevice().buildSetterCommand("mode", "eco");
  assert.equal(command.address, 12);
  assert.equal(command.value, 2);
}

function testEnumSetterByNumber() {
  const command = createTestDevice().buildSetterCommand("mode", 1);
  assert.equal(command.value, 1);
}

function testRejectsUnknownField() {
  assert.throws(() => createTestDevice().buildSetterCommand("missing_field", 1), /not writable/);
}

function testRejectsWrongBoolType() {
  assert.throws(() => createTestDevice().buildSetterCommand("charge_enabled", "ON"), /boolean value/);
}

function testRejectsWrongIntegerType() {
  assert.throws(() => createTestDevice().buildSetterCommand("output_power", 7.5), /integer value/);
}

function testRejectsUnknownEnumOption() {
  assert.throws(() => createTestDevice().buildSetterCommand("mode", "turbo"), /known enum option/);
}

function testRejectsReadOnlyField() {
  assert.throws(() => createTestDevice().buildSetterCommand("read_only_status", 1), /not writable/);
}

function createTestDevice() {
  const struct = new DeviceStruct()
    .addBoolField("charge_enabled", 10)
    .addUintField("output_power", 11)
    .addEnumField("mode", 12, { normal: 1, eco: 2 })
    .addUintField("read_only_status", 13);

  return new TestBluettiDevice("00:11:22:33:44:55", "TEST", "1234567890", struct);
}

class TestBluettiDevice extends BluettiDevice {
  get pollingCommands() {
    return [new ReadHoldingRegisters(10, 4)];
  }

  get loggingCommands() {
    return [new ReadHoldingRegisters(10, 4)];
  }

  get writableRanges() {
    return [{ start: 10, endExclusive: 13 }];
  }
}

await run();
