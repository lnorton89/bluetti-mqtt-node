import assert from "node:assert/strict";
import { DeviceSession } from "../dist/bluetooth/device-session.js";
import { CommandTimeoutError } from "../dist/bluetooth/errors.js";
import { MockBluetoothTransport } from "../dist/bluetooth/mock-transport.js";
import { ReadHoldingRegisters, WriteMultipleRegisters, WriteSingleRegister } from "../dist/core/commands.js";
import { appendModbusCrc } from "../dist/core/crc.js";

async function run() {
  await testChunkedResponse();
  await testCommandTimeout();
  await testDisconnectFailureStillResetsSessionState();
  testValidatesModbusResponseIdentityAndPayload();
  testRejectsInvalidRegisterQuantities();
  testValidatesCompleteExceptionResponses();
  console.log("device-session smoke test passed");
}

async function testChunkedResponse() {
  const transport = new MockBluetoothTransport({
    characteristics: {
      [DeviceSession.DEVICE_NAME_UUID]: asciiBytes("EB3A1234567890"),
    },
  });

  const session = new DeviceSession("00:11:22:33:44:55", transport);
  await session.connectAndInitialize();

  const command = new ReadHoldingRegisters(10, 2);
  const pending = session.perform(command);

  const response = fullResponse([0x00, 0x01, 0x00, 0x02]);
  transport.emit(DeviceSession.NOTIFY_UUID, response.slice(0, 4));
  transport.emit(DeviceSession.NOTIFY_UUID, response.slice(4));

  const completed = await pending;
  assert.equal(completed.length, command.responseSize());
  assert.deepEqual(command.parseResponse(completed), new Uint8Array([0x00, 0x01, 0x00, 0x02]));
}

async function testCommandTimeout() {
  const transport = new MockBluetoothTransport({
    characteristics: {
      [DeviceSession.DEVICE_NAME_UUID]: asciiBytes("EB3A1234567890"),
    },
  });

  const session = new DeviceSession("00:11:22:33:44:55", transport, 25);
  await session.connectAndInitialize();

  const command = new ReadHoldingRegisters(10, 2);
  await assert.rejects(session.perform(command), CommandTimeoutError);
  assert.equal(session.state, "command_error_wait");

  await session.disconnect();
  assert.equal(session.state, "not_connected");
}

async function testDisconnectFailureStillResetsSessionState() {
  const transport = new DisconnectFailingTransport();
  const session = new DeviceSession("00:11:22:33:44:55", transport);
  session.name = "AC5001234567890";
  session.state = "ready";

  await assert.rejects(session.disconnect(), /disconnect failed/);

  assert.equal(session.state, "not_connected");
  assert.equal(session.name, null);
}

class DisconnectFailingTransport {
  async connect() {}
  async disconnect() {
    throw new Error("disconnect failed");
  }
  async readCharacteristic() {
    return new Uint8Array(0);
  }
  async writeCharacteristic() {}
  async subscribe() {}
}

function testValidatesModbusResponseIdentityAndPayload() {
  const read = new ReadHoldingRegisters(10, 2);
  const validRead = fullResponse([0x00, 0x01, 0x00, 0x02]);
  assert.equal(read.isValidResponse(validRead), true);
  assert.equal(read.isValidResponse(withCrc([0x02, 0x03, 0x04, 0x00, 0x01, 0x00, 0x02])), false);
  assert.equal(read.isValidResponse(withCrc([0x01, 0x04, 0x04, 0x00, 0x01, 0x00, 0x02])), false);
  assert.equal(read.isValidResponse(withCrc([0x01, 0x03, 0x03, 0x00, 0x01, 0x00, 0x02])), false);

  const writeSingle = new WriteSingleRegister(10, 42);
  assert.equal(writeSingle.isValidResponse(writeSingle.toBytes()), true);
  assert.equal(writeSingle.isValidResponse(withCrc([0x01, 0x06, 0x00, 0x0a, 0x00, 0x2b])), false);

  const writeMultiple = new WriteMultipleRegisters(20, new Uint8Array([0x00, 0x01, 0x00, 0x02]));
  const writeMultipleReply = withCrc([...writeMultiple.toBytes().slice(0, 6)]);
  assert.equal(writeMultiple.isValidResponse(writeMultipleReply), true);
  assert.equal(writeMultiple.isValidResponse(withCrc([0x01, 0x10, 0x00, 0x14, 0x00, 0x03])), false);
}

function testRejectsInvalidRegisterQuantities() {
  assert.throws(() => new ReadHoldingRegisters(0, 0), /1 to 125/);
  assert.throws(() => new ReadHoldingRegisters(0, 126), /1 to 125/);
  assert.throws(() => new WriteMultipleRegisters(0, new Uint8Array(0)), /1 to 123/);
  assert.throws(() => new WriteMultipleRegisters(0, new Uint8Array(248)), /1 to 123/);
}

function testValidatesCompleteExceptionResponses() {
  const command = new ReadHoldingRegisters(10, 2);
  const valid = withCrc([0x01, 0x83, 0x05]);
  assert.equal(command.isExceptionResponse(valid), true);
  assert.equal(command.isExceptionResponse(valid.slice(0, 2)), false);
  assert.equal(command.isExceptionResponse(new Uint8Array([0x01, 0x83, 0x05, 0x00, 0x00])), false);
  assert.equal(command.isExceptionResponse(withCrc([0x02, 0x83, 0x05])), false);
}

function asciiBytes(value) {
  return new Uint8Array(Buffer.from(value, "ascii"));
}

function fullResponse(registerBytes) {
  const body = new Uint8Array([0x01, 0x03, registerBytes.length, ...registerBytes]);
  return appendModbusCrc(body);
}

function withCrc(bytes) {
  return appendModbusCrc(new Uint8Array(bytes));
}

await run();
