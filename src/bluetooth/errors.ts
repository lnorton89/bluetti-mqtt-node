export class BadConnectionError extends Error {}

export class CommandTimeoutError extends Error {}

export class ModbusError extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
  }
}

export class DeviceBusyError extends ModbusError {
  constructor(message = "Device reported MODBUS busy", code = 5) {
    super(message, code);
  }
}

export class ParseError extends Error {}
