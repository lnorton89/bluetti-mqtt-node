const MODBUS_POLYNOMIAL = 0xa001;

export function modbusCrc(data: Uint8Array): number {
  let crc = 0xffff;

  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const lsb = crc & 0x0001;
      crc >>= 1;
      if (lsb !== 0) {
        crc ^= MODBUS_POLYNOMIAL;
      }
    }
  }

  return crc & 0xffff;
}

export function appendModbusCrc(data: Uint8Array): Uint8Array {
  const crc = modbusCrc(data);
  const result = new Uint8Array(data.length + 2);
  result.set(data, 0);
  result[result.length - 2] = crc & 0xff;
  result[result.length - 1] = (crc >> 8) & 0xff;
  return result;
}

export function hasValidModbusCrc(frame: Uint8Array): boolean {
  if (frame.length < 3) {
    return false;
  }

  const expected = modbusCrc(frame.subarray(0, -2));
  const low = frame[frame.length - 2];
  const high = frame[frame.length - 1];
  return low === (expected & 0xff) && high === ((expected >> 8) & 0xff);
}
