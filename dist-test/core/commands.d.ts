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
export declare abstract class DeviceCommand {
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
    protected constructor(functionCode: number, data: Uint8Array);
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
    toBytes(): Uint8Array;
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
    isExceptionResponse(response: Uint8Array): boolean;
    /**
     * Validates response identity, function code, length, and CRC.
     *
     * @param response - Accumulated notification bytes to test.
     * @returns `true` when `response` has the expected length, the correct unit
     *   address and function code, and a valid CRC.
     */
    isValidResponse(response: Uint8Array): boolean;
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
    parseResponse(response: Uint8Array): Uint8Array;
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
export declare class ReadHoldingRegisters extends DeviceCommand {
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
    constructor(startingAddress: number, quantity: number);
    /** @returns Expected response length: `quantity × 2 + 5`. */
    responseSize(): number;
    /**
     * Strips the 3-byte header and 2-byte CRC, returning the register data.
     *
     * @param response - A validated response frame.
     * @returns Register payload bytes (`response.slice(3, -2)`).
     */
    parseResponse(response: Uint8Array): Uint8Array;
    /**
     * Validates the standard response plus the byte-count field.
     *
     * @param response - Accumulated notification bytes to test.
     * @returns `true` when the base validation passes **and** the byte-count
     *   field equals `quantity × 2`.
     */
    isValidResponse(response: Uint8Array): boolean;
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
export declare class WriteSingleRegister extends DeviceCommand {
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
    constructor(address: number, value: number);
    /** @returns Fixed echo-response length of 8 bytes. */
    responseSize(): number;
    /**
     * Extracts the echoed value bytes from the response.
     *
     * @param response - A validated response frame.
     * @returns The two value bytes (`response.slice(4, 6)`).
     */
    parseResponse(response: Uint8Array): Uint8Array;
    /**
     * Validates that the response echoes the request frame exactly.
     *
     * @param response - Accumulated notification bytes to test.
     * @returns `true` when base validation passes **and** the first six bytes
     *   match the original request frame.
     */
    isValidResponse(response: Uint8Array): boolean;
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
export declare class WriteMultipleRegisters extends DeviceCommand {
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
    constructor(startingAddress: number, data: Uint8Array);
    /** @returns Fixed echo-response length of 8 bytes. */
    responseSize(): number;
    /**
     * Validates that the response echoes the leading six request bytes.
     *
     * @param response - Accumulated notification bytes to test.
     * @returns `true` when base validation passes **and** the first six bytes
     *   match the original request frame.
     */
    isValidResponse(response: Uint8Array): boolean;
}
