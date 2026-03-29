import assert from "node:assert/strict";
import { DeviceStruct } from "../dist/devices/struct.js";

await run();

async function run() {
  testParsesStringField();
  testParsesSwapStringField();
  testParsesSerialNumberField();
  testParsesVersionField();
  testSkipsFieldsOutsideWindow();
  testSkipsOutOfRangeValues();
  console.log("struct smoke test passed");
}

function testParsesStringField() {
  const struct = new DeviceStruct().addStringField("device_type", 10, 3);
  const parsed = struct.parse(10, asciiWords("AC500\0"));
  assert.equal(parsed.device_type, "AC500");
}

function testParsesSwapStringField() {
  const struct = new DeviceStruct().addSwapStringField("device_type", 10, 3);
  const parsed = struct.parse(10, new Uint8Array([
    0x43, 0x41,
    0x30, 0x35,
    0x00, 0x30,
  ]));
  assert.equal(parsed.device_type, "AC500");
}

function testParsesSerialNumberField() {
  const struct = new DeviceStruct().addSerialNumberField("serial_number", 10);
  const parsed = struct.parse(10, registers([1, 2, 3, 4]));
  assert.equal(parsed.serial_number, 1n + (2n << 16n) + (3n << 32n) + (4n << 48n));
}

function testParsesVersionField() {
  const struct = new DeviceStruct().addVersionField("arm_version", 10);
  const parsed = struct.parse(10, registers([234, 1]));
  assert.equal(parsed.arm_version, 657.7);
}

function testSkipsFieldsOutsideWindow() {
  const struct = new DeviceStruct()
    .addUintField("inside", 10)
    .addUintField("outside", 11);
  const parsed = struct.parse(10, registers([7]));
  assert.deepEqual(parsed, { inside: 7 });
}

function testSkipsOutOfRangeValues() {
  const struct = new DeviceStruct().addUintField("battery_percent", 10, [0, 100]);
  const parsed = struct.parse(10, registers([101]));
  assert.deepEqual(parsed, {});
}

function registers(words) {
  const bytes = [];
  for (const word of words) {
    bytes.push((word >> 8) & 0xff, word & 0xff);
  }
  return new Uint8Array(bytes);
}

function asciiWords(value) {
  return new Uint8Array(Buffer.from(value, "ascii"));
}
