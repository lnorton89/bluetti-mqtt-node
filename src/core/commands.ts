import { appendModbusCrc, hasValidModbusCrc } from "./crc.js";

export abstract class DeviceCommand {
  readonly functionCode: number;
  readonly frame: Uint8Array;

  protected constructor(functionCode: number, data: Uint8Array) {
    this.functionCode = functionCode;

    const body = new Uint8Array(data.length + 2);
    body[0] = 1;
    body[1] = functionCode;
    body.set(data, 2);
    this.frame = appendModbusCrc(body);
  }

  toBytes(): Uint8Array {
    return this.frame.slice();
  }

  abstract responseSize(): number;

  isExceptionResponse(response: Uint8Array): boolean {
    return response.length >= 2 && response[1] === this.functionCode + 0x80;
  }

  isValidResponse(response: Uint8Array): boolean {
    return response.length >= 3 && hasValidModbusCrc(response);
  }

  parseResponse(response: Uint8Array): Uint8Array {
    return response.slice();
  }
}

function writeUint16BigEndian(buffer: Uint8Array, offset: number, value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`Expected uint16 value, got ${value}`);
  }

  buffer[offset] = (value >> 8) & 0xff;
  buffer[offset + 1] = value & 0xff;
}

export class ReadHoldingRegisters extends DeviceCommand {
  readonly startingAddress: number;
  readonly quantity: number;

  constructor(startingAddress: number, quantity: number) {
    const data = new Uint8Array(4);
    writeUint16BigEndian(data, 0, startingAddress);
    writeUint16BigEndian(data, 2, quantity);
    super(3, data);
    this.startingAddress = startingAddress;
    this.quantity = quantity;
  }

  responseSize(): number {
    return 2 * this.quantity + 5;
  }

  override parseResponse(response: Uint8Array): Uint8Array {
    return response.slice(3, -2);
  }
}

export class WriteSingleRegister extends DeviceCommand {
  readonly address: number;
  readonly value: number;

  constructor(address: number, value: number) {
    const data = new Uint8Array(4);
    writeUint16BigEndian(data, 0, address);
    writeUint16BigEndian(data, 2, value);
    super(6, data);
    this.address = address;
    this.value = value;
  }

  responseSize(): number {
    return 8;
  }

  override parseResponse(response: Uint8Array): Uint8Array {
    return response.slice(4, 6);
  }
}

export class WriteMultipleRegisters extends DeviceCommand {
  readonly startingAddress: number;
  readonly data: Uint8Array;

  constructor(startingAddress: number, data: Uint8Array) {
    if (data.length % 2 !== 0) {
      throw new Error("Register payload size must be a multiple of 2");
    }

    const body = new Uint8Array(data.length + 5);
    const registerCount = data.length / 2;
    writeUint16BigEndian(body, 0, startingAddress);
    writeUint16BigEndian(body, 2, registerCount);
    body[4] = data.length;
    body.set(data, 5);
    super(16, body);
    this.startingAddress = startingAddress;
    this.data = data.slice();
  }

  responseSize(): number {
    return 8;
  }
}
