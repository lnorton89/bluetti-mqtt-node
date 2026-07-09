import { appendModbusCrc, hasValidModbusCrc } from "./crc.js";
import {
  EXCEPTION_FLAG_MASK,
  EXCEPTION_FRAME_SIZE,
  FC_READ_HOLDING_REGISTERS,
  FC_WRITE_MULTIPLE_REGISTERS,
  FC_WRITE_SINGLE_REGISTER,
  MAX_READ_REGISTER_COUNT,
  MAX_WRITE_REGISTER_COUNT,
  MODBUS_UNIT_ADDRESS,
  WRITE_ECHO_SIZE,
} from "./constants.js";

/**
 * Base class for immutable MODBUS RTU requests sent to a Bluetti device.
 *
 * Each command serializes itself into a CRC-protected frame with unit address
 * `1` (the fixed Bluetti slave address). Subclasses implement
 * {@link DeviceCommand.responseSize} and may override
 * {@link DeviceCommand.parseResponse} / {@link DeviceCommand.isValidResponse}
 * to specialize response validation.
 *
 * Command instances are immutable; {@link DeviceCommand.toBytes} returns a
 * defensive copy so the cached frame cannot be mutated by callers.
 *
 * @remarks
 * The Bluetti MODBUS variant prepends a unit-address byte (`0x01`) before the
 * function code, then appends a low-byte-first CRC-16. This base constructor
 * handles that framing; subclasses only supply the function code and payload
 * data.
 *
 * @see ReadHoldingRegisters
 * @see WriteSingleRegister
 * @see WriteMultipleRegisters
 */
export abstract class DeviceCommand {
  /** MODBUS function code for this request (e.g. `3` for read holding). */
  readonly functionCode: number;
  /** Complete CRC-protected request frame, including unit address and CRC. */
  readonly frame: Uint8Array;

  /**
   * Builds the request frame from a function code and function-specific data.
   *
   * @param functionCode - MODBUS function code.
   * @param data - Function-specific payload bytes (excluding unit address and CRC).
   */
  protected constructor(functionCode: number, data: Uint8Array) {
    this.functionCode = functionCode;

    const body = new Uint8Array(data.length + 2);
    body[0] = MODBUS_UNIT_ADDRESS;
    body[1] = functionCode;
    body.set(data, 2);
    this.frame = appendModbusCrc(body);
  }

  /**
   * Returns a defensive copy of the serialized request frame.
   *
   * @returns A new `Uint8Array` containing the full frame (unit address,
   *   function code, payload, and CRC).
   *
   * @example
   * ```ts
   * const cmd = new ReadHoldingRegisters(10, 40);
   * const bytes = cmd.toBytes(); // safe to mutate without affecting cmd
   * ```
   */
  toBytes(): Uint8Array {
    return this.frame.slice();
  }

  /**
   * Returns the exact byte count expected in a successful response.
   *
   * Used by {@link DeviceSession} to know when a notification stream contains a
   * complete response.
   *
   * @returns Expected response length in bytes.
   */
  abstract responseSize(): number;

  /**
   * Recognizes a complete, CRC-valid MODBUS exception response.
   *
   * @param response - Accumulated notification bytes to test.
   * @returns `true` when `response` is a 5-byte exception frame whose function
   *   code has the high bit set (`0x80`) and whose CRC is valid.
   *
   * @remarks
   * A MODBUS exception frame has the form `[unit, functionCode | 0x80,
   * exceptionCode, crcLo, crcHi]`.
   */
  isExceptionResponse(response: Uint8Array): boolean {
    return response.length === EXCEPTION_FRAME_SIZE
      && response[0] === MODBUS_UNIT_ADDRESS
      && response[1] === this.functionCode + EXCEPTION_FLAG_MASK
      && hasValidModbusCrc(response);
  }

  /**
   * Validates response identity, function code, length, and CRC.
   *
   * @param response - Accumulated notification bytes to test.
   * @returns `true` when `response` has the expected length, the correct unit
   *   address and function code, and a valid CRC.
   */
  isValidResponse(response: Uint8Array): boolean {
    return response.length === this.responseSize()
      && response[0] === MODBUS_UNIT_ADDRESS
      && response[1] === this.functionCode
      && hasValidModbusCrc(response);
  }

  /**
   * Extracts command-specific payload bytes from a validated response.
   *
   * The base implementation returns the full frame slice. Subclasses override
   * to strip the unit/function/length header and trailing CRC.
   *
   * @param response - A response that has already passed
   *   {@link DeviceCommand.isValidResponse}.
   * @returns Payload bytes relevant to this command.
   */
  parseResponse(response: Uint8Array): Uint8Array {
    return response.slice();
  }
}

/**
 * Writes a 16-bit big-endian value into a buffer at the given offset.
 *
 * @param buffer - Target buffer (must have room for two bytes at `offset`).
 * @param offset - Byte offset where the high byte is written.
 * @param value - Unsigned integer in the range `[0, 0xFFFF]`.
 * @throws {RangeError} When `value` is not an integer or exceeds 16 bits.
 */
function writeUint16BigEndian(buffer: Uint8Array, offset: number, value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`Expected uint16 value, got ${value}`);
  }

  buffer[offset] = (value >> 8) & 0xff;
  buffer[offset + 1] = value & 0xff;
}

/**
 * MODBUS function `0x03` request: read a contiguous window of holding registers.
 *
 * @remarks
 * This is the primary read command used by device polling. The response carries
 * `quantity × 2` data bytes plus the standard 5-byte MODBUS framing (unit,
 * function, byte-count, CRC).
 *
 * @example
 * ```ts
 * // Read 40 registers starting at address 10
 * const cmd = new ReadHoldingRegisters(10, 40);
 * const response = await session.perform(cmd);
 * const payload = cmd.parseResponse(response);
 * ```
 *
 * @see DeviceSession.perform
 */
export class ReadHoldingRegisters extends DeviceCommand {
  /** First register address to read. */
  readonly startingAddress: number;
  /** Number of 16-bit registers to read (1–125). */
  readonly quantity: number;

  /**
   * Creates a read-holding-registers command.
   *
   * @param startingAddress - First register address to read.
   * @param quantity - Number of 16-bit registers (must be an integer 1–125).
   * @throws {RangeError} When `quantity` is not in `[1, 125]`.
   */
  constructor(startingAddress: number, quantity: number) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_READ_REGISTER_COUNT) {
      throw new RangeError(`Read quantity must be an integer from 1 to 125, got ${quantity}`);
    }

    const data = new Uint8Array(4);
    writeUint16BigEndian(data, 0, startingAddress);
    writeUint16BigEndian(data, 2, quantity);
    super(FC_READ_HOLDING_REGISTERS, data);
    this.startingAddress = startingAddress;
    this.quantity = quantity;
  }

  /** @returns Expected response length: `quantity × 2 + 5`. */
  responseSize(): number {
    return 2 * this.quantity + 5;
  }

  /**
   * Strips the 3-byte header and 2-byte CRC, returning the register data.
   *
   * @param response - A validated response frame.
   * @returns Register payload bytes (`response.slice(3, -2)`).
   */
  override parseResponse(response: Uint8Array): Uint8Array {
    return response.slice(3, -2);
  }

  /**
   * Validates the standard response plus the byte-count field.
   *
   * @param response - Accumulated notification bytes to test.
   * @returns `true` when the base validation passes **and** the byte-count
   *   field equals `quantity × 2`.
   */
  override isValidResponse(response: Uint8Array): boolean {
    return super.isValidResponse(response) && response[2] === this.quantity * 2;
  }
}

/**
 * MODBUS function `0x06` request: write a single 16-bit register.
 *
 * @remarks
 * A valid echo response mirrors the request frame exactly (unit, function,
 * address, value, CRC), so {@link WriteSingleRegister.isValidResponse} compares
 * the response against the original request frame.
 *
 * @example
 * ```ts
 * const cmd = new WriteSingleRegister(3007, 1); // turn AC output on
 * await session.perform(cmd);
 * ```
 *
 * @see BluettiDevice.buildSetterCommand
 */
export class WriteSingleRegister extends DeviceCommand {
  /** Target register address. */
  readonly address: number;
  /** 16-bit value to write. */
  readonly value: number;

  /**
   * Creates a write-single-register command.
   *
   * @param address - Register address to write.
   * @param value - Unsigned 16-bit value (`[0, 0xFFFF]`).
   * @throws {RangeError} When `value` is not a valid uint16.
   */
  constructor(address: number, value: number) {
    const data = new Uint8Array(4);
    writeUint16BigEndian(data, 0, address);
    writeUint16BigEndian(data, 2, value);
    super(FC_WRITE_SINGLE_REGISTER, data);
    this.address = address;
    this.value = value;
  }

  /** @returns Fixed echo-response length of 8 bytes. */
  responseSize(): number {
    return WRITE_ECHO_SIZE;
  }

  /**
   * Extracts the echoed value bytes from the response.
   *
   * @param response - A validated response frame.
   * @returns The two value bytes (`response.slice(4, 6)`).
   */
  override parseResponse(response: Uint8Array): Uint8Array {
    return response.slice(4, 6);
  }

  /**
   * Validates that the response echoes the request frame exactly.
   *
   * @param response - Accumulated notification bytes to test.
   * @returns `true` when base validation passes **and** the first six bytes
   *   match the original request frame.
   */
  override isValidResponse(response: Uint8Array): boolean {
    return super.isValidResponse(response)
      && response.slice(0, 6).every((value, index) => value === this.frame[index]);
  }
}

/**
 * MODBUS function `0x10` request: write contiguous 16-bit registers.
 *
 * @remarks
 * The request body carries the starting address, register count, byte count,
 * and raw register data. As with {@link WriteSingleRegister}, a valid response
 * echoes the leading six bytes of the request.
 *
 * @example
 * ```ts
 * const data = new Uint8Array([0x00, 0x01, 0x00, 0x02]);
 * const cmd = new WriteMultipleRegisters(3015, data);
 * await session.perform(cmd);
 * ```
   *
   * @see WriteSingleRegister
 */
export class WriteMultipleRegisters extends DeviceCommand {
  /** First register address to write. */
  readonly startingAddress: number;
  /** Raw register data (length must be even). */
  readonly data: Uint8Array;

  /**
   * Creates a write-multiple-registers command.
   *
   * @param startingAddress - First register address to write.
   * @param data - Register payload; length must be even and represent 1–123
   *   registers.
   * @throws {Error} When `data.length` is odd.
   * @throws {RangeError} When the register count is not in `[1, 123]`.
   */
  constructor(startingAddress: number, data: Uint8Array) {
    if (data.length % 2 !== 0) {
      throw new Error("Register payload size must be a multiple of 2");
    }

    const registerCount = data.length / 2;
    if (registerCount < 1 || registerCount > MAX_WRITE_REGISTER_COUNT) {
      throw new RangeError(`Write quantity must be from 1 to 123 registers, got ${registerCount}`);
    }

    const body = new Uint8Array(data.length + 5);
    writeUint16BigEndian(body, 0, startingAddress);
    writeUint16BigEndian(body, 2, registerCount);
    body[4] = data.length;
    body.set(data, 5);
    super(FC_WRITE_MULTIPLE_REGISTERS, body);
    this.startingAddress = startingAddress;
    this.data = data.slice();
  }

  /** @returns Fixed echo-response length of 8 bytes. */
  responseSize(): number {
    return WRITE_ECHO_SIZE;
  }

  /**
   * Validates that the response echoes the leading six request bytes.
   *
   * @param response - Accumulated notification bytes to test.
   * @returns `true` when base validation passes **and** the first six bytes
   *   match the original request frame.
   */
  override isValidResponse(response: Uint8Array): boolean {
    return super.isValidResponse(response)
      && response.slice(0, 6).every((value, index) => value === this.frame[index]);
  }
}
