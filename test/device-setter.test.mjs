import assert from "node:assert/strict";
import { ReadHoldingRegisters, WriteSingleRegister } from "../dist/core/commands.js";
import { BluettiDevice } from "../dist/devices/device.js";
import { DeviceStruct } from "../dist/devices/struct.js";

/**
 * Smoke-test runner for BluettiDevice.buildSetterCommand.
 *
 * Exercises bool, integer, enum, and read-only field setter construction
 * plus type/range validation for each variant.
 */
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

/** Builds a WriteSingleRegister for a bool field with value `true`. */
function testBoolSetter() {
  const command = createTestDevice().buildSetterCommand("charge_enabled", true);
  assert.ok(command instanceof WriteSingleRegister);
  assert.equal(command.address, 10);
  assert.equal(command.value, 1);
}

/** Builds a WriteSingleRegister for an integer field with an exact value. */
function testIntegerSetter() {
  const command = createTestDevice().buildSetterCommand("output_power", 42);
  assert.equal(command.address, 11);
  assert.equal(command.value, 42);
}

/** Builds a WriteSingleRegister for an enum field using the human-readable name. */
function testEnumSetterByName() {
  const command = createTestDevice().buildSetterCommand("mode", "eco");
  assert.equal(command.address, 12);
  assert.equal(command.value, 2);
}

/** Builds a WriteSingleRegister for an enum field using the raw numeric value. */
function testEnumSetterByNumber() {
  const command = createTestDevice().buildSetterCommand("mode", 1);
  assert.equal(command.value, 1);
}

/** An unknown field name is rejected with a "not writable" error. */
function testRejectsUnknownField() {
  assert.throws(() => createTestDevice().buildSetterCommand("missing_field", 1), /not writable/);
}

/** A non-boolean value supplied to a bool field is rejected. */
function testRejectsWrongBoolType() {
  assert.throws(() => createTestDevice().buildSetterCommand("charge_enabled", "ON"), /boolean value/);
}

/** A non-integer value supplied to a uint field is rejected. */
function testRejectsWrongIntegerType() {
  assert.throws(() => createTestDevice().buildSetterCommand("output_power", 7.5), /integer value/);
}

/** An enum value not present in the field's value map is rejected. */
function testRejectsUnknownEnumOption() {
  assert.throws(() => createTestDevice().buildSetterCommand("mode", "turbo"), /known enum option/);
}

/** A read-only field (outside writable ranges) is rejected with "not writable". */
function testRejectsReadOnlyField() {
  assert.throws(() => createTestDevice().buildSetterCommand("read_only_status", 1), /not writable/);
}

/** Creates a test BluettiDevice with bool, uint, enum, and read-only fields. */
function createTestDevice() {
  const struct = new DeviceStruct()
    .addBoolField("charge_enabled", 10)
    .addUintField("output_power", 11)
    .addEnumField("mode", 12, { normal: 1, eco: 2 })
    .addUintField("read_only_status", 13);

  return new TestBluettiDevice("00:11:22:33:44:55", "TEST", "1234567890", struct);
}

/** Minimal BluettiDevice subclass for setter testing with a known field layout. */
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
