import assert from "node:assert/strict";
import { DeviceSession } from "../dist/bluetooth/device-session.js";
import { MockBluetoothTransport } from "../dist/bluetooth/mock-transport.js";
import { ReadHoldingRegisters } from "../dist/core/commands.js";
import { appendModbusCrc } from "../dist/core/crc.js";

await run();

async function run() {
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
  console.log("device-session smoke test passed");
}

function asciiBytes(value) {
  return new Uint8Array(Buffer.from(value, "ascii"));
}

function fullResponse(registerBytes) {
  const body = new Uint8Array([0x01, 0x03, registerBytes.length, ...registerBytes]);
  return appendModbusCrc(body);
}
